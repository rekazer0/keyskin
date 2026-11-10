import { drawVisualPreview, type ToolbarVisual } from "../atlas.ts"
import { element } from "../dom-element.ts"
import { appState } from "./state"
import { visualResolver } from "./bda-documents"
import { commitBatch, isEditing, updateDirty } from "./edit-history"
import { refreshPreview } from "./preview-render"
import { runFileOperation } from "./file-operations"
import { section } from "./property-rows"
import { showPickerWindow } from "./image-pickers"
import type { TileRect } from "../tiles.ts"
import type { Change } from "../history.ts"
import { createIcon } from "../icons.ts"
import { SsfStyles } from "../ssf/ssf-scene.ts"
import { openPalmSkin, sxiPointer } from "./sxi-documents"
import { actionDescription } from "../actions.ts"
import { actionText, asObject } from "../palm/sxi-ini.ts"
import { sxiFragment } from "../palm/sxi-json.ts"
import { ssfPackage, ssfTheme } from "./ssf-documents"
import { decodeSkinText } from "../palm/palm-ini.ts"

/** 只在确认替换后补齐缺失的声明；保留原 XML 的其他功能与状态。 */
function toolbarIconBinding(visual: ToolbarVisual): Change[] {
  const menu = visual.menu
  const archive = appState.archive
  if (!menu?.id || !archive) return []
  const before = archive.getBytes(menu.path)
  const xml = before ? decodeSkinText(before) : '<plist version="1.0"><array/></plist>'
  if (!xml) throw new Error("无法读取工具栏图标配置")
  const document = new DOMParser().parseFromString(xml, "application/xml")
  const array = document.querySelector("plist > array")
  if (document.querySelector("parsererror") || !array) throw new Error("工具栏图标配置格式无效，请先修复源文件")
  const value = (dict: Element, key: string) => Array.from(dict.children).find((node) => node.tagName === "key" && node.textContent === key)?.nextElementSibling
  const ensure = (dict: Element, key: string, tag: string): Element => {
    const existing = value(dict, key)
    if (existing) {
      if (existing.tagName !== tag) throw new Error(`工具栏图标配置 ${key} 格式无效`)
      return existing
    }
    const name = document.createElement("key")
    name.textContent = key
    const node = document.createElement(tag)
    dict.append(name, node)
    return node
  }
  let item = Array.from(array.children).find((node) => node.tagName === "dict" && value(node, "Name")?.textContent === menu.id)
  const normal = item && value(item, "Images")
  const states = normal && value(normal, "Normal")
  if (states && value(states, "Normal")?.textContent?.replace(/^\/+/, "").replace(/\.png$/i, "") === menu.image) return []
  if (!item) {
    item = document.createElement("dict")
    array.append(item)
    ensure(item, "Name", "string").textContent = menu.id
    ensure(item, "Position", "string").textContent = menu.position
    const titles = ensure(ensure(item, "Titles", "dict"), "Normal", "dict")
    ensure(titles, "Normal", "string").textContent = visual.label ?? ""
  }
  const images = ensure(item, "Images", "dict")
  for (const state of ["Normal", "Theme"]) ensure(ensure(images, state, "dict"), "Normal", "string").textContent = menu.image
  return [{ kind: "bytes", path: menu.path, before, after: new TextEncoder().encode(new XMLSerializer().serializeToString(document)) }]
}

async function replaceIcon(visual: ToolbarVisual, imagePath: string, source?: TileRect): Promise<boolean> {
  const archive = appState.archive
  const path = visual.imagePath
  if (!archive || !path || !isEditing()) return false
  const bytes = archive.getBytes(imagePath)
  if (!bytes) throw new Error("所选图片已不存在")
  const replacement = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: "image/png" }))
  try {
    if (appState.archive !== archive || !isEditing()) return false
    const before = archive.getBytes(path)
    const original = before && await createImageBitmap(new Blob([new Uint8Array(before)], { type: "image/png" })).catch(() => undefined)
    try {
      const canvas = element("canvas")
      canvas.width = original?.width ?? source?.[2] ?? replacement.width
      canvas.height = original?.height ?? source?.[3] ?? replacement.height
      const context = canvas.getContext("2d")!
      if (original) context.drawImage(original, 0, 0)
      const rect = visual.imageSource ?? visual.source ?? [0, 0, canvas.width, canvas.height]
      context.clearRect(...rect)
      context.drawImage(replacement, ...(source ?? [0, 0, replacement.width, replacement.height] as TileRect), ...rect)
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("无法生成图标图片")), "image/png"))
      const after = new Uint8Array(await blob.arrayBuffer())
      if (appState.archive !== archive || !isEditing()) return false
      if (archive.getBytes(path) !== before) throw new Error("图标图片已改变，请重新选择后替换")
      commitBatch([{ kind: "bytes", path, before, after }, ...toolbarIconBinding(visual)])
      refreshPreview()
      updateDirty()
      void refreshToolbarIconCards()
      return true
    } finally {
      original?.close()
    }
  } finally {
    replacement.close()
  }
}


function drawToolbarIconPreview(preview: HTMLElement, visual: ToolbarVisual): void {
  if (!visual.image) {
    preview.replaceChildren(createIcon(visual.defaultIcon ?? "image-off", 20))
    return
  }
  const canvas = element("canvas")
  canvas.width = visual.source?.[2] ?? visual.image.width
  canvas.height = visual.source?.[3] ?? visual.image.height
  canvas.setAttribute("aria-hidden", "true")
  drawVisualPreview(canvas, [visual], false)
  preview.replaceChildren(canvas)
}

async function toolbarImages(): Promise<ToolbarVisual[]> {
  const pkg = ssfPackage()
  if (pkg && appState.archive) return new SsfStyles(appState.archive, pkg, ssfTheme()).toolbarImages()
  const resolver = visualResolver()
  const visuals = await resolver?.resolveToolbarImages(Number.POSITIVE_INFINITY) ?? []
  const skin = openPalmSkin()
  const pointer = sxiPointer(appState.selectedPath)
  if (!skin || pointer?.[2] !== "c") return visuals
  const icons = asObject(sxiFragment(skin, pointer))?.icon_list
  if (!Array.isArray(icons)) return visuals
  const fixed = await Promise.all(icons.map(async (value) => {
    const icon = asObject(value)
    if (icon?.k === "switchContainer") return []
    const base = asObject(icon?.b)
    const ids = Array.isArray(base?.base_f) ? base.base_f : [base?.base_f]
    const layers = await Promise.all(ids.map((id) => resolver?.resolve(String(id ?? ""), false)))
    return layers.flatMap((visual) => visual?.imagePath ? [{ ...visual, label: actionDescription(actionText(icon?.k) ?? "") }] : [])
  }))
  return [...fixed.flat(), ...visuals]
}

async function refreshToolbarIconCards(): Promise<void> {
  const visuals = await toolbarImages()
  for (const [index, visual] of visuals.entries()) {
    const preview = document.querySelector<HTMLElement>(`[data-document-key="TOOLBAR_ICON_${index + 1}"] .ui-toolbar-icon-preview`)
    if (preview) drawToolbarIconPreview(preview, visual)
  }
}
/** F14 的图标是原生图片资源，不是 SWITCH 的文字样式。 */
export function toolbarIconSection(): HTMLElement {
  const group = section("工具栏图标", [])
  const archive = appState.archive
  const images = toolbarImages()
  void images.then(visuals => {
    if (!group.isConnected || appState.archive !== archive) return
    const cards = element("div", "ui-toolbar-icons")
    cards.setAttribute("role", "group")
    cards.setAttribute("aria-label", "工具栏图标")
    for (const [index, visual] of visuals.entries()) {
      const label = visual.label ?? "未知功能"
      const pick = () => {
        appState.resourcePickerSelect = undefined
        appState.stylePickerTarget = undefined
        appState.pickerTarget = {
          source: "FORE_STYLE", property: "NM_IMG",
          selectImage: (path, source) => {
            if (appState.archive !== archive) return
            void runFileOperation("修改工具栏图标", () => replaceIcon(visual, path, source))
          },
        }
        void showPickerWindow("styles", "全部图片", 1100, 760)
      }
      const card = element("button", "ui-toolbar-icon")
      card.type = "button"
      card.dataset.documentKey = `TOOLBAR_ICON_${index + 1}`
      card.setAttribute("aria-label", `更换${label}图标`)
      card.disabled = !isEditing()
      card.addEventListener("click", pick)
      const preview = element("span", "ui-toolbar-icon-preview ui-checker")
      drawToolbarIconPreview(preview, visual)
      card.append(preview, Object.assign(element("span", "ui-toolbar-icon-label"), { textContent: label }))
      cards.append(card)
    }
    group.append(cards)
  }).catch(() => {})
  return group
}
