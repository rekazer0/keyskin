import { asObject } from "../palm/sxi-ini.ts"
import { editSxi } from "./sxi-fields"
import { palmKeyForegrounds, palmKeyPointer, palmValue, setPalmStyleImage } from "./sxi-styles"
import { addPalmStyle, palmTileSlices } from "../palm/palm-style-edit.ts"
import { openPalmSkin, palmTheme } from "./sxi-documents"
import { IniDocument } from "../ini.ts"
import { appState } from "./state"
import { styleConfigPath, effectiveKeyValue, currentSkinState, setSourceValue } from "./config-context"
import { isListCell } from "../layout.ts"
import { type StyleImagePickerTarget, type NativeResourcePickerPayload } from "./types"
import { setStyleField } from "../keyboard.ts"
import { commitText, updateDirty, isEditing } from "./edit-history"
import { refreshPreview } from "./preview-render"
import { renderStyleResourceDetail } from "./resource-inspector"
import { populateKeyInspector, selectedBdaRefs, updateBdaRefs } from "./key-inspector"
import { stylePickerLabel, emitStyleLibrary } from "./style-picker"
import { WebviewWindow } from "@tauri-apps/api/webviewWindow"
import { resourceImagePaths } from "../resources.ts"
import { theme, orientation, pickerDialog, pickerFrame } from "./dom"
import { nativePickerWindow, pickerEmitter, pickerListener } from "../picker-channel.ts"
import { WHOLE_IMAGE_INDEX } from "../slice-picker-canvas.ts"
import { type TileRect, tileSlices } from "../tiles.ts"
import { ssfPackage, ssfThemeFolder } from "./ssf-documents"

export function selectedStyleImageSections(source: "BACK_STYLE" | "FORE_STYLE"): { document: IniDocument; path: string; sections: string[] } | undefined {
  if (!appState.archive || !appState.layoutDocument || !appState.selectedKeySections.length) return
  const path = styleConfigPath()
  if (!appState.archive.isText(path)) return
  const document = IniDocument.parse(appState.archive.getText(path))
  const sections = source === "BACK_STYLE"
    ? [...new Set(appState.selectedKeySections.flatMap((key) => {
        const backStyle = isListCell(key)
          ? appState.layoutDocument?.get("LIST", "BACK_STYLE") ?? ""
          : effectiveKeyValue(key, source) ?? ""
        const id = backStyle.split(",")[0]?.trim()
        return id && /^\d+$/.test(id) ? [`STYLE${id}`] : []
      }))]
    : [...new Set(appState.selectedKeySections.flatMap((key) => {
        const foreStyle = isListCell(key)
          ? appState.layoutDocument?.get("LIST", "FORE_STYLE") ?? ""
          : effectiveKeyValue(key, source) ?? ""
        // Images live in STYLE<id> only (STYLE<id/100> is a text fallback, see styleWriteTarget), and a
        // text layer of the same foreground must not turn into an image.
        return foreStyle.split(",").map((token) => `STYLE${token.trim()}`).filter((section) =>
          document.get(section, "NM_IMG") !== undefined || document.get(section, "HL_IMG") !== undefined)
      }))]
  return sections.length ? { document, path, sections } : undefined
}

export function updateSelectedImageReference(target: StyleImagePickerTarget | undefined, value: string): boolean {
  if (!appState.archive || !target) return false
  const { document, path, sections } = target
  if (appState.archive.format === "sxi") {
    if (!isEditing()) return false
    const pressed = target.property === "HL_IMG"
    const ids = (sections ?? []).map((section) => section.replace(/^STYLE/, ""))
    const input = appState.stylePickerTarget
    if (!ids.length && input?.dataset.keyField !== "FORE_STYLE") return false
    let added: string | undefined
    editSxi((skin) => {
      if (ids.length) return setPalmStyleImage(skin, ids, pressed, value)
      // A new image layer on the selected keys: the foreground card's 添加, or an empty card.
      added = addPalmStyle(skin, palmTheme(), { s_2: { normal: value, ...pressed ? { hl: value } : {} } })
      const state = currentSkinState()
      for (const section of appState.selectedKeySections) {
        const pointer = palmKeyPointer(skin, section, state)
        const model = pointer && asObject(palmValue(skin, pointer))
        if (!model) throw new Error(`找不到手心按键 ${section}`)
        const fores = palmKeyForegrounds(skin, section, state)
        if (input?.dataset.styleReferenceAppend === "true") fores.push(Number(added))
        else fores[Number(input?.dataset.styleReferenceIndex ?? 0)] = Number(added)
        model.b = { ...asObject(model.b), base_f: fores }
      }
    })
    if (added) {
      target.path = styleConfigPath()
      target.sections = [`STYLE${added}`]
    }
    if (appState.resourceInspectorMode === "style" && appState.resourceConfigActive) void renderStyleResourceDetail()
    return true
  }
  if (document && path && sections?.length) {
    const before = document.toString()
    setStyleField(document, sections, target.property, value)
    const text = document.toString()
    commitText(path, before, text)
    if (appState.selectedPath === path) setSourceValue(text)
    refreshPreview()
    if (appState.resourceInspectorMode === "style" && appState.resourceConfigActive) {
      void renderStyleResourceDetail()
    }
    populateKeyInspector()
    updateDirty()
    return true
  }
  if (appState.archive?.format === "bda") {
    const refs = target.source === "FORE_STYLE"
      ? selectedBdaRefs("FORE_STYLE", "image", "BACK_STYLE")
      : selectedBdaRefs("BACK_STYLE", "image")
    return updateBdaRefs(refs, target.property, value)
  }
  const context = selectedStyleImageSections(target.source)
  if (!appState.archive || !context) return false
  const before = context.document.toString()
  setStyleField(context.document, context.sections, target.property, value)
  const text = context.document.toString()
  commitText(context.path, before, text)
  if (appState.selectedPath === context.path) setSourceValue(text)
  refreshPreview()
  populateKeyInspector()
  updateDirty()
  return true
}

// 切片窗口标题栏显示所属样式：优先用引用目标里的 STYLE 段，其次退回资源检查器正在查看的样式。
export function imagePickerStyleName(target: StyleImagePickerTarget): string {
  const section = target.sections?.find((name) => /^STYLE\d+$/i.test(name))
  const styleID = section ? section.replace(/^STYLE/i, "") : appState.selectedStyleID
  return styleID ? `样式 ${stylePickerLabel(styleID)}` : ""
}

export function imageDataURL(bytes: Uint8Array): string {
  let binary = ""
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return `data:image/png;base64,${btoa(binary)}`
}

export const emitToPicker = pickerEmitter("image-picker", () => pickerFrame.contentWindow)
export const onPickerEvent = pickerListener(() => pickerFrame.contentWindow)

export async function emitPickerView(view: "image" | "list" | "styles"): Promise<void> {
  if (view === "list") await emitToPicker("image-picker-show-list")
  else if (view === "styles") await emitStyleLibrary()
  else if (appState.nativeImagePickerPayload) await emitToPicker("image-picker-data", appState.nativeImagePickerPayload)
}

// 图片切片、「全部图片」与「全部样式」共用一个窗口：桌面端是原生窗口，网页端和安卓是嵌着同一页面的弹窗。
export async function showPickerWindow(
  view: "image" | "list" | "styles",
  title: string,
  width: number,
  height: number,
): Promise<void> {
  if (!nativePickerWindow) {
    appState.pickerRequestedView = view
    if (appState.pickerFrameReady) await emitPickerView(view)
    else if (!pickerDialog.open) {
      // 每次打开都重新加载，和桌面端每次新建窗口一样不带上一次的状态。
      pickerFrame.src = "picker.html"
      pickerDialog.showModal()
    }
    return
  }
  const existing = await WebviewWindow.getByLabel("image-picker")
  if (existing) {
    await emitPickerView(view)
    await existing.setFocus()
    return
  }
  appState.pickerRequestedView = view
  new WebviewWindow("image-picker", {
    url: "picker.html",
    title,
    width,
    height,
    minWidth: 720,
    minHeight: 480,
    center: true,
    decorations: true,
    resizable: true,
  })
}

export function openImagePickerList(): void {
  if (!appState.archive || (!appState.pickerTarget && !appState.resourcePickerSelect)) return
  void showPickerWindow("list", "全部图片", 960, 680)
}

/** Images a style can use: Baidu res/ folders, or the folders a Sogou look looks images up in. */
export function pickableImagePaths(): string[] {
  const archive = appState.archive
  const names = archive?.names() ?? []
  if (archive?.format !== "ssf") return resourceImagePaths(names, theme.value, orientation.value)
  const pkg = ssfPackage()
  const roots = [ssfThemeFolder(), pkg && `${pkg.resolution}/`, "default/", "default/res/"].filter((root): root is string => Boolean(root))
  return names.filter((path) => /\.(?:png|webp|jpe?g)$/i.test(path)
    && roots.some((root) => path.startsWith(root) && !path.slice(root.length).includes("/")))
}

export function resourcePickerPayload(): NativeResourcePickerPayload {
  return pickableImagePaths().flatMap((path) => {
    const bytes = appState.archive?.getBytes(path)
    return bytes ? [{ path, dataURL: imageDataURL(bytes) }] : []
  })
}

export function closePickerWindow(): void {
  if (nativePickerWindow) void WebviewWindow.getByLabel("image-picker").then((pickerWindow) => pickerWindow?.close())
  else pickerDialog.close()
}

export function selectImageResource(path: string): void {
  const select = appState.resourcePickerSelect
  if (select) {
    const resourceID = path.split("/").pop()?.replace(/\.png$/i, "") ?? path
    clearImageSlicePicker()
    select(resourceID)
    return
  }
  if (appState.pickerTarget) openImageSlicePicker(path, appState.pickerTarget)
}

export function clearImageSlicePicker(): void {
  appState.pickerSlices = []
  appState.pickerPath = ""
  appState.pickerTarget = undefined
  appState.resourcePickerSelect = undefined
  appState.pickerSelectedIndex = undefined
  appState.nativeImagePickerPayload = undefined
  appState.pickerRequestedView = "image"
  closePickerWindow()
}

export function pickerImageReference(index: number): string {
  const name = appState.pickerPath.split("/").pop()?.replace(/\.png$/i, "") ?? appState.pickerPath
  return index === WHOLE_IMAGE_INDEX ? name : `${name},${index}`
}

export function openImageSlicePicker(path: string, target: StyleImagePickerTarget, selectedSource?: TileRect): void {
  if (!appState.archive?.isImage(path)) return
  const bytes = appState.archive.getBytes(path)
  if (!bytes) return
  appState.pickerPath = path
  appState.pickerTarget = target
  const tilePathForPicker = path.replace(/\.png$/i, ".til")
  appState.pickerSlices = appState.archive.format === "sxi" ? palmTileSlices(openPalmSkin(), path)
    : appState.archive.isText(tilePathForPicker) ? tileSlices(IniDocument.parse(appState.archive.getText(tilePathForPicker))) : []
  appState.pickerSelectedIndex = !appState.pickerSlices.length && selectedSource
    ? WHOLE_IMAGE_INDEX
    : appState.pickerSlices.find((slice) => selectedSource && slice.source.join(",") === selectedSource.join(","))?.index
  appState.nativeImagePickerPayload = {
    path,
    dataURL: imageDataURL(bytes),
    slices: appState.pickerSlices,
    selectedIndex: appState.pickerSelectedIndex,
    editable: isEditing(),
    styleName: imagePickerStyleName(target),
    // 行内缩略图传入的是未挂载的克隆输入框，只要有引用目标就能回到样式库。
    styleLibrary: Boolean(appState.stylePickerTarget),
  }
  void showPickerWindow("image", "图片切片", 1100, 760)
}
