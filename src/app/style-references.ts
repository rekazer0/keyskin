import { appState } from "./state"
import { styleConfigPath } from "./config-context"
import { IniDocument } from "../ini.ts"
import { soundPathForFilename } from "../sounds.ts"
import { theme, orientation, keyFields, toolbarFields, quickInspector } from "./dom"
import { keyboardFields } from "./canvas-interaction"
import { openStylePicker, styleConfigDocument, styleKind, availableStyleIDs, styleSoundFile } from "./style-picker"
import { openPalmSkin, palmTheme, sxiPointer } from "./sxi-documents"
import { drawVisualPreview } from "../atlas.ts"
import { visualResolver, bdaAppearanceStylePath } from "./bda-documents"
import { type StyleImagePickerTarget } from "./types"
import { openImageSlicePicker } from "./image-pickers"
import { openStyleImageResourceChooser, selectStyleResource } from "./resource-inspector"
import { bdaStyleRef, type BdaAppearanceStyleGroup, type BdaStyleRef, bdaStyleID } from "../bda.ts"
import { NEW_FORE_LAYER } from "../bda-layout-styles.ts"
import { selectFile } from "./navigation"
import { previewStyleAnimation } from "./animation-resource"
import { updateBdaAppearanceStyleRef } from "./key-inspector"
import { styleAnimationReferenceStates } from "./legacy-animation-inspector"
import { keySoundSample, palmStyleAnimationStates } from "./style-card-preview"
import { styleKindIcon, styleReferenceAddButton, styleReferenceCard, type StyleReferenceState } from "../style-card"
import { palmStyleLocation } from "../palm/palm-style-edit.ts"
import { palmFieldLabel } from "../palm/palm-labels.ts"
import { asObject, type Json } from "../palm/sxi-ini.ts"
import { palmStylePointer } from "./sxi-styles"
import type { SkinArchive } from "../skin.ts"

export const layoutAnimationFields = new Set(["ANIM_STYLE", "BACK_ANIM_STYLE", "FORE_ANIM_STYLE", "PRESS_STYLE"])

export function styleReferenceKey(input: HTMLInputElement): string {
  return input.dataset.keyboardField ?? input.dataset.toolbarField ?? input.dataset.keyField ?? input.dataset.documentStyleKey ?? ""
}

export function isStyleReferenceKey(key: string): boolean {
  if (key === "STAT_STYLE") return false
  return key === "styleID" || /(?:^|\.)(?:[A-Z0-9_]*STYLE(?:_INDEX)?|FIRST_BACK|FIRST_FORE|PARTICLE_IMAGE)$/i.test(key)
}

function soundPathForStyle(styleID: string): string | undefined {
  if (!appState.archive) return
  const filename = styleSoundFile(styleID)
  return filename ? soundPathForFilename(appState.archive.names(), theme.value, orientation.value, filename) : undefined
}

/** 把一个样式引用输入框换成引用卡列表（.ui-style-ref）：输入框本身隐藏，仍是写回与改动标记的来源。 */
export function decorateStyleReferenceInput(input: HTMLInputElement, key = styleReferenceKey(input)): void {
  if (!isStyleReferenceKey(key) || input.closest(".ui-style-ref-list")) return
  input.dataset.documentStyleKey ||= key
  const parent = input.parentNode
  if (!parent) return
  const list = document.createElement("span")
  list.className = "ui-style-ref-list"
  parent.insertBefore(list, input)
  list.append(input)
  // 卡片布局靠这个 class 而不是 :has()：检查器每次重建都会让 :has() 重算整个右栏样式。
  list.closest(".ui-field")?.classList.add("style-reference-field")
  // 动画样式没有静态外观可看：悬停时在画布上播放它（DESIGN.md §10）。
  if (key !== "SOUND_STYLE") list.addEventListener("mouseenter", () => {
    previewStyleAnimation(input.value.split(",").map((value) => value.trim()).filter((styleID) => styleKind(styleID) === "anim"))
  })
  input.addEventListener("input", () => refreshStyleReferenceThumbnail(list, input, key))
  input.addEventListener("change", () => refreshStyleReferenceThumbnail(list, input, key))
  refreshStyleReferenceThumbnail(list, input, key)
}

/**
 * 重建一个引用字段的卡片：每个编号一张，每张已绑定的卡都可移除。前景、粒子图片、前景动画可以有多张，字段标签右端的 `plus` 追加；
 * 动画槽位按位置保留，空的或 0 不显示卡片，移除写 0（末尾的空槽位一并去掉）。
 */
export function refreshStyleReferenceThumbnail(list: HTMLElement, input: HTMLInputElement, key: string, resolver = visualResolver()): void {
  const animationReference = layoutAnimationFields.has(key)
  const multiple = input.dataset.keyField === "FORE_STYLE" || key === "PARTICLE_IMAGE"
  const values = () => {
    const items = input.value.split(",").map((value) => value.trim())
    return animationReference ? items : items.filter(Boolean)
  }
  const write = (next: string[]) => {
    input.value = animationReference ? next.join(",") : next.filter(Boolean).join(",")
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
  }
  // 打开样式库或输入编号用的克隆输入框：选定后只改这一张卡对应的位置（`index` 为长度时追加）。
  const slotInput = (index: number, value: string) => {
    const target = input.cloneNode(false) as HTMLInputElement
    target.removeAttribute("id")
    target.value = value
    // 手心新建图片样式时据此写回这一层或追加一层（image-pickers.ts updateSelectedImageReference）。
    target.dataset.styleReferenceIndex = String(index)
    if (index >= values().length) target.dataset.styleReferenceAppend = "true"
    target.addEventListener("change", () => {
      const next = values()
      if (index >= next.length && !target.value.trim()) return
      next[index] = target.value.trim()
      write(next)
    })
    return target
  }
  const styles = styleConfigDocument()
  const foreground = styleReferenceForeground(key)
  const styleIDs = values()
  const mixed = input.placeholder === "混合"
  const emptySlot = (styleID: string) => !styleID || animationReference && styleID === "0"
  const bound = styleIDs.some((styleID) => !emptySlot(styleID))
  const cards = (mixed && !bound ? [""] : styleIDs).flatMap((styleID, index) => {
    if (emptySlot(styleID) && !mixed) return []
    const name = slotInput(index, styleID)
    name.setAttribute("aria-label", key === "FORE_ANIM_STYLE" ? `前景 ${index + 1} 动画样式编号` : `样式 ${index + 1} 编号`)
    const choose = (highlighted = false) => openStylePicker(slotInput(index, styleID), highlighted)
    const empty = emptySlot(styleID)
    let states: StyleReferenceState[] = mixed && empty ? [{ label: "混合", content: "混合", onClick: () => choose() }] : []
    if (key === "SOUND_STYLE" && !empty) {
      const path = soundPathForStyle(styleID)
      states = [{ label: "音效", content: keySoundSample(path?.split("/").pop() ?? styleSoundFile(styleID), path), onClick: (edit) => edit ? openStyleReferenceEditor(styleID) : choose() }]
    } else if (animationReference && !empty) {
      states = appState.archive?.format === "sxi" ? palmStyleAnimationStates(styleID, () => choose()) : styleAnimationReferenceStates(styleID, styles ?? IniDocument.parse(""), () => choose())
    } else if (!empty) {
      states = [false, true].map((highlighted) => ({
        label: highlighted ? "按下" : "正常",
        draw: async (canvas: HTMLCanvasElement) => drawVisualPreview(canvas, [await resolver?.resolve(styleID, highlighted).catch(() => undefined)], foreground),
        onClick: (edit: boolean) => edit ? openStyleReferenceEditor(styleID) : choose(highlighted),
      }))
    }
    const removable = !input.disabled && !empty
    return [styleReferenceCard({
      name,
      kind: empty ? undefined : styleKindIcon(styleKind(styleID, styles)),
      states,
      remove: removable ? {
        label: "移除",
        run: () => {
          if (!animationReference) return write(values().filter((_, at) => at !== index))
          const next = values().map((value, at) => at === index ? "0" : value)
          while (next.length > 1 && (!next.at(-1) || next.at(-1) === "0")) next.pop()
          write(next)
        },
      } : undefined,
      disabled: input.disabled,
    })]
  })
  list.replaceChildren(input, ...cards)
  // 多张前景、粒子图片、前景动画：追加按钮在字段标签右端（没有标签时排在卡片末尾）。
  const caption = list.closest(".ui-field")?.firstElementChild
  const captionHost = caption && caption !== list ? caption : list
  captionHost.querySelector(":scope > .ui-style-ref-append")?.remove()
  list.hidden = !cards.length && captionHost !== list
  if (!bound || multiple || key === "FORE_ANIM_STYLE") {
    const index = !bound ? Math.max(0, styleIDs.findIndex(emptySlot)) : styleIDs.length
    captionHost.append(styleReferenceAddButton("添加", () => openStylePicker(slotInput(index, "")), input.disabled))
  }
}

export function styleReferenceForeground(key: string): boolean {
  return /FORE|INPUT_STYLE|SCAND_STYLE|CELL_STYLE/.test(key)
}

/** Each style id's reference locations, built once per archive revision (thousands of cards ask for it). */
const usageIndex: { archive?: SkinArchive; key?: string; index?: Map<string, string[]> } = {}

function styleUsageIndex(): Map<string, string[]> {
  const archive = appState.archive
  if (!archive) return new Map()
  const key = `${archive.revision}|${theme.value}|${orientation.value}|${styleConfigPath()}`
  if (usageIndex.archive === archive && usageIndex.key === key && usageIndex.index) return usageIndex.index
  const index = new Map<string, string[]>()
  const add = (id: string, location: string) => index.set(id, [...index.get(id) ?? [], location])
  if (archive.format === "sxi") {
    const skin = openPalmSkin()
    const walk = (value: Json, path: string[], orientation: string) => {
      if (Array.isArray(value)) { value.forEach((item, at) => walk(item, [...path, String(at)], orientation)); return }
      const object = asObject(value)
      if (!object) return
      for (const [name, child] of Object.entries(object)) {
        if (/^(?:base_(?:b|f|s|ba|fa|a|pa)|asi)$/.test(name)) for (const id of [child].flat().map(String)) add(`${orientation}:${id}`, `skin.json · ${[...path, name].join(".")}（${palmFieldLabel(name)}）`)
        else walk(child, [...path, name], orientation)
      }
    }
    for (const orientation of ["port", "land"] as const) walk(asObject(skin?.[palmTheme()])?.[`${orientation}_layout`], [palmTheme(), `${orientation}_layout`], orientation)
  } else for (const path of archive.names()) {
    if (!path.startsWith(`${theme.value}/`) || !/\.(ini|cnd|pop)$/i.test(path) || !archive.isText(path)) continue
    const local = /^(.*\/skin\/(?:port|land))\//.exec(path)?.[1]
    const effectiveStyles = local && archive.isText(`${local}/res/default.css`) ? `${local}/res/default.css` : `${theme.value}/skin/res/default.css`
    if (styleConfigPath() !== effectiveStyles) continue
    const document = path === appState.layoutPath && appState.layoutDocument ? appState.layoutDocument : IniDocument.parse(archive.getText(path))
    for (const { section, key, value } of document.entries()) {
      if (isStyleReferenceKey(key)) for (const id of new Set(value.split(",").map((part) => part.trim()).filter(Boolean))) add(id, `${path} · [${section}] ${key}`)
    }
  }
  Object.assign(usageIndex, { archive, key, index })
  return index
}

/**
 * 实际引用一个样式的位置（含当前画布外的布局）。BDI/BDS 的文字还会回退到 STYLE<id/100>，
 * 所以引用 id*100…id*100+99 的位置也算在内，删掉它会悄悄改变那些按键的文字。
 */
export function styleUsages(id: string): string[] {
  const index = styleUsageIndex()
  if (appState.archive?.format === "sxi") {
    const skin = openPalmSkin()
    const selected = palmStylePointer(id, skin)?.join(".")
    return (["port", "land"] as const).flatMap((orientation) =>
      skin && palmStyleLocation(skin, palmTheme(), orientation, id)?.join(".") === selected ? index.get(`${orientation}:${id}`) ?? [] : [])
  }
  const number = Number(id)
  const fallback = Number.isSafeInteger(number) ? Array.from({ length: 100 }, (_, offset) => String(number * 100 + offset)).filter((other) => other !== id) : []
  return [id, ...fallback].flatMap((other) => index.get(other) ?? [])
}

export function styleWriteTarget(
  source: "BACK_STYLE" | "FORE_STYLE",
  property: "NM_IMG" | "HL_IMG",
  styleIDs: string[],
): StyleImagePickerTarget {
  if (appState.archive?.format === "bda") return { source, property }
  const path = styleConfigPath()
  // A Palm style is written in skin.json (image-pickers.ts) by its id.
  if (appState.archive?.format === "sxi") {
    const ids = new Set(availableStyleIDs())
    const sections = [...new Set(styleIDs.map((token) => token.trim()).filter((id) => ids.has(id)).map((id) => `STYLE${id}`))]
    return sections.length ? { source, property, path, sections } : { source, property }
  }
  if (!appState.archive?.isText(path)) return { source, property }
  const document = IniDocument.parse(appState.archive.getText(path))
  // Images are read from STYLE<id> only (atlas.ts resolveVisualSpec); STYLE<id/100> is a text fallback
  // and is often another key's text style, so an image must never be written there.
  const sections = [...new Set(styleIDs.map((token) => `STYLE${token.trim()}`).filter((section) => document.sections().includes(section)))]
  return sections.length ? { source, property, document, path, sections } : { source, property }
}

function pairedBackgroundStyleID(input: HTMLInputElement, key: string): string | undefined {
  const backgroundKey = key.replace(/FORE_STYLE$/, "BACK_STYLE").replace(/FIRST_FORE$/, "FIRST_BACK")
  if (backgroundKey === key) return
  const fields = input.dataset.keyField !== undefined
    ? keyFields
    : input.dataset.toolbarField !== undefined
      ? toolbarFields
      : input.dataset.keyboardField !== undefined
        ? keyboardFields
        : []
  return fields.find((field) => styleReferenceKey(field) === backgroundKey)?.value.split(",")[0]?.trim()
}

export async function openStyleReferenceStateImage(
  input: HTMLInputElement,
  key: string,
  highlighted: boolean,
  styleIDs = input.value.split(",").map((value) => value.trim()).filter(Boolean),
): Promise<void> {
  if (input.disabled) return
  const resolver = visualResolver()
  if (!resolver) return
  const foreground = styleReferenceForeground(key)
  const source: "BACK_STYLE" | "FORE_STYLE" = foreground ? "FORE_STYLE" : "BACK_STYLE"
  const property = highlighted ? "HL_IMG" : "NM_IMG"
  let targetSource = source
  let visual = (await Promise.all(styleIDs.map((styleID) => resolver.resolve(styleID, highlighted).catch(() => undefined))))
    .find((item) => item?.imagePath)
  // 颜色 / 动画样式没有图片可切，改为在样式库里更换引用的样式；不能回退去改背景图片。
  if (!visual && styleIDs.some((styleID) => ["color", "anim"].includes(styleKind(styleID)))) return openStylePicker(input, highlighted)
  if (!visual && foreground && appState.archive?.format !== "sxi") {
    const backgroundID = pairedBackgroundStyleID(input, key)
    if (backgroundID) {
      styleIDs = [backgroundID]
      targetSource = "BACK_STYLE"
      visual = await resolver.resolve(backgroundID, highlighted).catch(() => undefined)
    }
  }
  const target = styleWriteTarget(targetSource, property, styleIDs)
  appState.stylePickerTarget = input
  appState.styleLibraryHighlighted = highlighted
  if (visual?.imagePath) openImageSlicePicker(visual.imagePath, target, visual.source)
  else openStyleImageResourceChooser(target)
}

export function openStyleReferenceEditor(styleID: string): void {
  if (!styleID || !availableStyleIDs().includes(styleID) || !appState.archive) return
  const returnPath = appState.selectedPath
  const returnSelection = [...appState.selectedKeySections]
  const returnCandidate = appState.selectedCandidate
  const returnScrollTop = quickInspector.scrollTop
  const returnInspectorGroup = quickInspector.dataset.mobileInspectorGroup ?? ""
  if (appState.archive.format === "bda") {
    const ref = bdaStyleRef(styleID)
    if (!ref) return
    const group = `${ref.type}Styles` as BdaAppearanceStyleGroup
    const path = bdaAppearanceStylePath(group)
    selectFile(path, "overview", "style")
    appState.styleReturnPath = returnPath === path ? "" : returnPath
    appState.styleReturnSelection = returnSelection
    appState.styleReturnCandidate = returnCandidate
    appState.styleReturnScrollTop = returnScrollTop
    appState.styleReturnInspectorGroup = returnInspectorGroup
    selectStyleResource(String(ref.key))
    return
  }
  const path = styleConfigPath()
  if (!appState.archive.isText(path) && !sxiPointer(path)) return
  selectFile(path, "overview", "style")
  appState.styleReturnPath = returnPath === path ? "" : returnPath
  appState.styleReturnSelection = returnSelection
  appState.styleReturnScrollTop = returnScrollTop
  appState.styleReturnInspectorGroup = returnInspectorGroup
  selectStyleResource(styleID)
}

export function openBdaStyleReferencePicker(paths: string[][], ref: BdaStyleRef, field: string, owner: HTMLElement, highlighted = false): void {
  const input = document.createElement("input")
  // A reference the skin does not set yet (key -1) opens the picker with nothing chosen.
  input.value = ref.key >= 0 ? bdaStyleID(ref) : ""
  input.dataset.documentStyleKey = field
  // A new foreground layer can be any kind of style: an image, a text or a colour.
  if (field !== NEW_FORE_LAYER) input.dataset.bdaStyleType = ref.type
  input.addEventListener("change", () => {
    const next = bdaStyleRef(input.value)
    if (next) updateBdaAppearanceStyleRef(paths, next, owner)
  })
  openStylePicker(input, highlighted)
}
