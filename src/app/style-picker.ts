import { appState } from "./state"
import { bdaStyleRef, bdaStyleID } from "../bda.ts"
import { currentBdaAppearance, visualResolver } from "./bda-documents"
import { styleConfigPath } from "./config-context"
import { IniDocument } from "../ini.ts"
import { type StyleKind } from "./types"
import { createIcon } from "../icons"
import { isStyleReferenceKey, styleReferenceForeground, styleWriteTarget, styleReferenceKey, openStyleReferenceEditor, refreshStyleReferenceThumbnail } from "./style-references"
import { isEditing } from "./edit-history"
import { updateBdaRefs } from "./key-inspector"
import { bdaImageResourceID } from "./tile-editing"
import { theme, orientation, styleAddButton, newStyleError } from "./dom"
import { openImageSlicePicker, imageDataURL, showPickerWindow, closePickerWindow, emitToPicker } from "./image-pickers"
import { type Visual, type VisualResolver } from "../atlas.ts"
import { afterNextPaint } from "./canvas-interaction"
import { selectFile } from "./navigation"
import { resourceImagePaths } from "../resources.ts"
import { soundPathForFilename } from "../sounds.ts"
import { type StyleLibraryPayload, type StyleLibraryVisual } from "../picker-window.ts"
import { SkinArchive } from "../skin.ts"
import { SXI_SKIN_PATH } from "../palm/sxi-json.ts"
import { palmStyleCategories, palmStyleIDs, palmStyleKind, palmStyleSound } from "./sxi-styles"

export function stylePickerLabel(styleID: string): string {
  return appState.archive?.format === "bda" ? String(bdaStyleRef(styleID)?.key ?? styleID) : styleID
}

export function availableStyleIDs(): string[] {
  if (!appState.archive) return []
  if (appState.archive.format === "bda") {
    const appearance = currentBdaAppearance()?.appearance
    if (!appearance) return []
    return [
      ...[...appearance.imageStyles.keys()].map((key) => bdaStyleID({ type: "image", key })),
      ...[...appearance.colorStyles.keys()].map((key) => bdaStyleID({ type: "color", key })),
      ...[...appearance.textStyles.keys()].map((key) => bdaStyleID({ type: "text", key })),
    ]
  }
  if (appState.archive.format === "sxi") return palmStyleIDs()
  const path = styleConfigPath()
  if (!appState.archive.isText(path)) return []
  return IniDocument.parse(appState.archive.getText(path)).sections()
    .flatMap((section) => section.match(/^STYLE(\d+)$/)?.[1] ?? [])
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}

export const styleKinds: Record<StyleKind, { label: string; icon: string }> = {
  image: { label: "图片", icon: "image" },
  color: { label: "颜色", icon: "palette" },
  anim: { label: "动画", icon: "clapperboard" },
  text: { label: "文字", icon: "type" },
  sound: { label: "声音", icon: "volume-2" },
  empty: { label: "空", icon: "square-dashed" },
}

/** 按样式内容判定类型：有图即图片样式，其次动画、颜色、声音，只剩文字属性的归为文字样式；INFO 只是备注，不算属性。 */
export function styleKind(styleID: string, styles = styleConfigDocument()): StyleKind {
  if (appState.archive?.format === "bda") return bdaStyleRef(styleID)?.type ?? "empty"
  if (appState.archive?.format === "sxi") return palmStyleKind(styleID)
  const keys = new Set(styles?.entries(`STYLE${styleID}`).filter((entry) => entry.key !== "INFO" && entry.value.trim()).map((entry) => entry.key) ?? [])
  const has = (pattern: RegExp) => [...keys].some((key) => pattern.test(key))
  if (has(/^(?:NM|HL)_IMG$/)) return "image"
  if (has(/ANIM|^EVENT\d+$/)) return "anim"
  if (has(/^(?:NM|HL)_COLOR$/)) return "color"
  if (keys.has("PRESS_SOUND_PATH")) return "sound"
  return keys.size ? "text" : "empty"
}

/** The press sound file a style plays: default.css PRESS_SOUND_PATH, or a Palm style's `s_4.path_1`. */
export function styleSoundFile(styleID: string, styles = styleConfigDocument()): string | undefined {
  if (appState.archive?.format === "sxi") return palmStyleSound(styleID)
  return styles?.get(`STYLE${styleID}`, "PRESS_SOUND_PATH")?.trim() || undefined
}

/** Whether new styles can be added: BDI/BDS to their default.css, Palm to skin.json; BDA styles are typed. */
export function canAddStyle(): boolean {
  const archive = appState.archive
  return archive?.format === "sxi" ? Boolean(palmStyleIDs().length) : Boolean(archive?.isText(styleConfigPath()) && archive.format !== "bda")
}

export function styleConfigDocument(): IniDocument | undefined {
  const path = styleConfigPath()
  return appState.archive?.isText(path) ? IniDocument.parse(appState.archive.getText(path)) : undefined
}

/** 样式类型徽标：样式库、检查器缩略图、样式配置列表共用，保证同一类型处处同一图标与文字。 */
export function styleKindBadge(kind: StyleKind, iconOnly = false): HTMLElement {
  const badge = document.createElement("span")
  badge.className = "style-kind-badge"
  badge.dataset.styleKind = kind
  badge.title = `${styleKinds[kind].label}样式`
  badge.append(createIcon(styleKinds[kind].icon, 11))
  if (!iconOnly) badge.append(styleKinds[kind].label)
  return badge
}

/** 由引用字段推断应优先展示的样式类型，打开样式库时据此预选筛选。 */
export function styleKindForKey(key: string): StyleKind | "all" {
  if (/ANIM_STYLE$/.test(key)) return "anim"
  if (key === "HW_FORE_STYLE") return "color"
  return "all"
}

export function styleLibraryCategories(styleID: string): Set<string> {
  if (appState.archive?.format === "sxi") return palmStyleCategories(styleID)
  const categories = new Set<string>()
  for (const { section, key, value } of appState.layoutDocument?.entries() ?? []) {
    if (!isStyleReferenceKey(key) || !value.split(",").map((value) => value.trim()).includes(styleID)) continue
    if (/CAND|INPUT|CELL/.test(section + key)) categories.add("candidate")
    else if (styleReferenceForeground(key)) categories.add("foreground")
    else if (section === "PANEL") categories.add("panel")
    else categories.add("key")
  }
  return categories
}

export function applyStyleLibrarySelection(): void {
  const target = appState.stylePickerTarget
  const selected = appState.styleLibrarySelected
  if (!target || target.disabled || !selected || !isEditing()) return
  if (selected.styleID) {
    const ref = bdaStyleRef(selected.styleID)
    if (target.dataset.bdaStyleType && ref?.type !== target.dataset.bdaStyleType) return
    target.value = selected.styleID
    target.dispatchEvent(new Event("input", { bubbles: true }))
    target.dispatchEvent(new Event("change", { bubbles: true }))
    closeStylePicker()
  } else if (selected.imagePath) {
    const styleID = target.value.split(",")[0]?.trim() ?? ""
    if (appState.archive?.format === "bda") {
      const ref = bdaStyleRef(styleID)
      if (ref?.type !== "image") return
      if (updateBdaRefs([ref], appState.styleLibraryHighlighted ? "HL_IMG" : "NM_IMG", bdaImageResourceID(selected.imagePath))) {
        closeStylePicker()
        void refreshStyleReferenceThumbnails()
      }
    } else {
      openImageSlicePicker(selected.imagePath, styleWriteTarget(styleReferenceForeground(styleReferenceKey(target)) ? "FORE_STYLE" : "BACK_STYLE", appState.styleLibraryHighlighted ? "HL_IMG" : "NM_IMG", [styleID]))
    }
  }
}

export function closeStylePicker(): void {
  closePickerWindow()
}

export function editStyleLibrarySelection(): void {
  const selected = appState.styleLibrarySelected
  if (!selected) return
  closeStylePicker()
  if (selected.styleID) openStyleReferenceEditor(selected.styleID)
  else if (selected.imagePath) selectFile(selected.imagePath, "overview")
}

export function openStylePicker(input: HTMLInputElement, highlighted = false): void {
  appState.styleLibraryHighlighted = highlighted
  if (input.disabled || !availableStyleIDs().length) return
  appState.stylePickerTarget = input
  appState.styleLibrarySelected = undefined
  void showPickerWindow("styles", "全部样式", 1100, 760)
}

export function nativeStyleLibraryPayload(sliceBack: boolean): Promise<StyleLibraryPayload | undefined> {
  const target = appState.stylePickerTarget
  if (!appState.archive || !target) return Promise.resolve(undefined)
  const source = appState.archive
  const key = styleReferenceKey(target)
  const soundOnly = key === "SOUND_STYLE"
  const styles = styleConfigDocument()
  const currentID = target.value.split(",")[0]?.trim() ?? ""
  const targetType = appState.archive.format === "bda" ? target.dataset.bdaStyleType : undefined
  const bitmaps: Record<string, string> = {}
  const bitmapKeys = new Map<ImageBitmap, string>()
  // 位图不能跨窗口传：有归档路径就直接编码原始 PNG，否则（如 BDA 基础皮肤里的图）画到画布再导出。
  const wireVisual = (visual: Visual | undefined): StyleLibraryVisual | null => {
    if (!visual) return null
    const { image, ...rest } = visual
    if (!image) return rest
    const bytes = visual.imagePath ? source.getBytes(visual.imagePath) : undefined
    const imageKey = bytes ? visual.imagePath! : bitmapKeys.get(image) ?? `bitmap:${bitmapKeys.size}`
    bitmapKeys.set(image, imageKey)
    if (!bitmaps[imageKey]) {
      if (bytes) bitmaps[imageKey] = imageDataURL(bytes)
      else {
        const canvas = document.createElement("canvas")
        canvas.width = image.width
        canvas.height = image.height
        canvas.getContext("2d")?.drawImage(image, 0, 0)
        bitmaps[imageKey] = canvas.toDataURL()
      }
    }
    return { ...rest, imageKey }
  }
  const payload = {
    sliceBack,
    editable: isEditing() && !target.disabled,
    canAdd: canAddStyle(),
    soundOnly,
    foreground: styleReferenceForeground(key),
    bda: appState.archive.format === "bda",
    kind: styleKindForKey(key),
    currentID,
    currentLabel: currentID ? stylePickerLabel(currentID) : "",
    source: appState.archive.format === "sxi" ? SXI_SKIN_PATH : (soundOnly ? styleConfigPath() : appState.layoutPath).split("/").pop() || "当前皮肤",
    imagesCompatible: !targetType || bdaStyleRef(currentID)?.type === "image",
    bitmaps,
    styles: [] as StyleLibraryPayload["styles"],
    images: [] as StyleLibraryPayload["images"],
    sounds: [] as StyleLibraryPayload["sounds"],
  }
  if (soundOnly) {
    payload.sounds = availableStyleIDs().flatMap((styleID) => {
      const filename = styleSoundFile(styleID, styles) ?? ""
      if (!filename) return []
      const playable = Boolean(soundPathForFilename(source.names(), theme.value, orientation.value, filename))
      return [{ styleID, filename, playable }]
    })
    return Promise.resolve(payload)
  }
  const resolver = visualResolver()
  if (!resolver) return Promise.resolve(payload)
  return Promise.all(availableStyleIDs().map(async (styleID) => ({
    styleID,
    visuals: await Promise.all([resolver.resolve(styleID, false).catch(() => undefined), resolver.resolve(styleID, true).catch(() => undefined)]),
  }))).then((items) => {
    const imageCategories = new Map<string, Set<string>>()
    payload.styles = items.map(({ styleID, visuals }) => {
      const categories = styleLibraryCategories(styleID)
      for (const visual of visuals) {
        if (!visual?.imagePath) continue
        const merged = imageCategories.get(visual.imagePath) ?? new Set<string>()
        for (const category of categories) merged.add(category)
        imageCategories.set(visual.imagePath, merged)
      }
      const kind = styleKind(styleID, styles)
      return {
        styleID,
        label: stylePickerLabel(styleID),
        kind,
        kindLabel: styleKinds[kind].label,
        kindIcon: styleKinds[kind].icon,
        categories: [...categories],
        compatible: !targetType || bdaStyleRef(styleID)?.type === targetType,
        imagePaths: visuals.flatMap((visual) => visual?.imagePath ? [visual.imagePath] : []),
        visuals: visuals.map(wireVisual),
      }
    })
    payload.images = resourceImagePaths(source.names(), theme.value, orientation.value).flatMap((path) => {
      const bytes = source.getBytes(path)
      if (!bytes) return []
      bitmaps[path] ??= imageDataURL(bytes)
      return [{ path, categories: [...imageCategories.get(path) ?? []], referenced: imageCategories.has(path) }]
    })
    return payload
  })
}

export async function emitStyleLibrary(sliceBack = false): Promise<void> {
  const payload = await nativeStyleLibraryPayload(sliceBack)
  if (payload) await emitToPicker("style-library-data", payload)
}

export function addStyleFromLibrary(): void {
  appState.newStyleApplyTarget = appState.stylePickerTarget
  closeStylePicker()
  styleAddButton.click()
}

export async function updateStylePreviews(): Promise<void> {
  if (appState.stylePreviewsPending) return
  appState.stylePreviewsPending = true
  afterNextPaint(() => {
    appState.stylePreviewsPending = false
    refreshStyleReferenceThumbnails()
  })
}

// What each thumbnail was last drawn from; selecting a key re-runs this for every
// trigger, and rebuilding unchanged ones dominated the click cost.
export const styleReferenceThumbnailInputs = new WeakMap<HTMLElement, { archive: SkinArchive; signature: string }>()

export function refreshStyleReferenceThumbnails(): void {
  let resolver: VisualResolver | undefined
  for (const button of Array.from(document.querySelectorAll<HTMLElement>(".style-picker-trigger"))) {
    // 音效行的值藏在前面的卡片里；BDA 样式行前面不是输入框，它的缩略图另有绘制路径，这里跳过。
    const previous = button.previousElementSibling
    const input = previous?.classList.contains("sound-style-main") ? previous.querySelector("input") : previous
    if (!(input instanceof HTMLInputElement)) continue
    const key = styleReferenceKey(input)
    if (appState.archive) {
      const signature = `${appState.archive.revision}|${theme.value}|${orientation.value}|${key}|${input.value}`
      const previous = styleReferenceThumbnailInputs.get(button)
      if (previous?.archive === appState.archive && previous.signature === signature) continue
      styleReferenceThumbnailInputs.set(button, { archive: appState.archive, signature })
    } else styleReferenceThumbnailInputs.delete(button)
    resolver ??= visualResolver()
    void refreshStyleReferenceThumbnail(button, input, key, resolver)
  }
}

export function nextStyleID(): string {
  const ids = availableStyleIDs().map(Number).filter(Number.isSafeInteger)
  return String((ids.length ? Math.max(...ids) : -1) + 1)
}

export function showNewStyleError(text: string): void {
  newStyleError.textContent = text
  newStyleError.hidden = !text
}
