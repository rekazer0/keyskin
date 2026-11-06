import { appState } from "./state"
import { bdaStyleRef, bdaStyleID } from "../bda.ts"
import { currentBdaAppearance, visualResolver } from "./bda-documents"
import { styleConfigPath } from "./config-context"
import { IniDocument } from "../ini.ts"
import { type StyleKind } from "./types"
import { isStyleReferenceKey, styleReferenceForeground, styleWriteTarget, styleReferenceKey, openStyleReferenceEditor, openStyleReferenceStateImage, refreshStyleReferenceThumbnail, layoutAnimationFields, styleUsages } from "./style-references"
import { commitText, isEditing, updateDirty } from "./edit-history"
import { updateBdaRefs } from "./key-inspector"
import { bdaImageResourceID } from "./tile-editing"
import { theme, orientation } from "./dom"
import { openImageSlicePicker, imageDataURL, showPickerWindow, closePickerWindow, emitToPicker, clearImageSlicePicker } from "./image-pickers"
import { type Visual, type VisualResolver } from "../atlas.ts"
import { afterNextPaint } from "./canvas-interaction"
import { selectFile } from "./navigation"
import { resourceImagePaths } from "../resources.ts"
import { soundPathForFilename } from "../sounds.ts"
import { type StyleLibraryPayload, type StyleLibraryVisual } from "../picker-window.ts"
import { SkinArchive } from "../skin.ts"
import { palmStyle, palmStyleCategories, palmStyleIDs, palmStyleKind, palmStyleSound } from "./sxi-styles"
import { styleAnimationSources, styleAnimationSummary } from "./legacy-animation-inspector"
import { nextStyleID } from "../layout-image.ts"
import { addPalmStyle, removePalmStyle } from "../palm/palm-style-edit.ts"
import { editSxi } from "./sxi-fields"
import { palmOrientation, palmTheme } from "./sxi-documents"
import { setSourceValue } from "./config-context"
import { refreshPreview } from "./preview-render"
import { type JsonObject } from "../palm/sxi-ini.ts"

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

/** 按样式内容判定类型：有图即图片样式，其次动画、颜色、声音，只剩文字属性的归为文字样式；INFO 只是备注，不算属性。 */
export function styleKind(styleID: string, styles = styleConfigDocument()): StyleKind {
  if (appState.archive?.format === "bda") return bdaStyleRef(styleID)?.type ?? "empty"
  if (appState.archive?.format === "sxi") return palmStyleKind(styleID)
  const keys = new Set(styles?.entries(`STYLE${styleID}`).filter((entry) => entry.key !== "INFO" && entry.value.trim()).map((entry) => entry.key) ?? [])
  const has = (pattern: RegExp) => [...keys].some((key) => pattern.test(key))
  if (has(/^(?:NM|HL)_IMG$/)) return "image"
  if (has(/ANIM|^EVENT\d+$/)) return "anim"
  if (has(/^(SHOW|FONT_SIZE|FONT_NAME|FONT|BOLD|ITALIC)$/)) return "text"
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

/**
 * default.css 的一次改动：一个撤销步骤，源码编辑器正显示它时同步。STYLE_NUM 记的是最大编号，
 * 新建超过它就跟上，删掉的正是它就退到剩下的最大编号。
 */
function editStyleConfig(change: (styles: IniDocument) => void): boolean {
  const path = styleConfigPath()
  if (!appState.archive?.isText(path) || !isEditing()) return false
  const styles = IniDocument.parse(appState.archive.getText(path))
  const before = styles.toString()
  const counter = Number(styles.get("GLOBAL", "STYLE_NUM") ?? -1)
  const had = styles.sections().includes(`STYLE${counter}`)
  change(styles)
  const ids = styles.sections().flatMap((section) => /^STYLE(\d+)$/.exec(section)?.[1] ?? []).map(Number)
  const max = Math.max(0, ...ids)
  if (!Number.isFinite(counter) || max > counter || had && !ids.includes(counter)) styles.set("GLOBAL", "STYLE_NUM", String(max))
  const text = styles.toString()
  if (text === before) return false
  commitText(path, before, text)
  if (appState.selectedPath === path) setSourceValue(text)
  refreshPreview()
  updateDirty()
  return true
}

/** 新建一个样式，编号自动取下一个（BDI/BDS 写 default.css，手心写 skin.json）；给了动画编号时按下播放它。返回新编号。 */
export function addStyle(pressAnimation?: number): string | undefined {
  if (!canAddStyle() || !isEditing()) return
  let id: string | undefined
  if (appState.archive?.format === "sxi") editSxi((skin) => { id = addPalmStyle(skin, palmTheme(), pressAnimation === undefined ? {} : { s_5: { "1": pressAnimation } }) })
  else editStyleConfig((styles) => {
    id = String(nextStyleID(styles))
    styles.appendSection(`STYLE${id}`, pressAnimation === undefined ? [] : [{ key: "PRESS_ANIM", value: String(pressAnimation) }])
  })
  return id
}

/** 复制一个样式的全部属性到下一个编号；返回新编号。 */
export function duplicateStyle(styleID: string): string | undefined {
  if (!canAddStyle() || !isEditing() || !availableStyleIDs().includes(styleID)) return
  let id: string | undefined
  if (appState.archive?.format === "sxi") editSxi((skin) => {
    const model = structuredClone(palmStyle(styleID, skin) ?? {}) as JsonObject
    delete model.id
    id = addPalmStyle(skin, palmTheme(), model)
  })
  else editStyleConfig((styles) => {
    id = String(nextStyleID(styles))
    styles.appendSection(`STYLE${id}`, styles.entries(`STYLE${styleID}`).map(({ key, value }) => ({ key, value })))
  })
  return id
}

/** 删除没有被引用的样式；可撤销，不弹确认。被引用（含文字回退）的样式不能删。 */
export function removeStyle(styleID: string): boolean {
  if (!canAddStyle() || !isEditing() || styleUsages(styleID).length) return false
  if (appState.selectedStyleID === styleID) appState.selectedStyleID = ""
  if (appState.selectedResourceGalleryPath === `STYLE${styleID}`) appState.selectedResourceGalleryPath = ""
  if (appState.archive?.format !== "sxi") return editStyleConfig((styles) => { styles.removeSections([`STYLE${styleID}`]) })
  editSxi((skin) => { removePalmStyle(skin, palmTheme(), palmOrientation(), styleID) })
  return true
}

/** 由引用字段推断应优先展示的样式类型，打开样式库时据此预选筛选。 */
function styleKindForKey(key: string): StyleKind | "all" {
  if (layoutAnimationFields.has(key)) return "anim"
  if (key === "HW_FORE_STYLE") return "color"
  return "all"
}

export function styleLibraryCategories(): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>()
  if (appState.archive?.format === "sxi") {
    for (const id of availableStyleIDs()) result.set(id, palmStyleCategories(id))
    return result
  }
  const prefix = `${theme.value}/skin/${orientation.value}/`
  const documents = appState.archive?.format === "bda" ? [appState.layoutDocument] :
    (appState.archive?.names() ?? []).filter(path => path.startsWith(prefix) && /\.(ini|cnd|pop)$/i.test(path))
      .map(path => path === appState.layoutPath ? appState.layoutDocument : IniDocument.parse(appState.archive!.getText(path)))
  for (const document of documents) for (const { section, key, value } of document?.entries() ?? []) {
    if (!isStyleReferenceKey(key)) continue
    const category = /CAND|INPUT|CELL/.test(section + key) ? "candidate" : styleReferenceForeground(key) ? "foreground" : section === "PANEL" ? "panel" : "key"
    for (const id of value.split(",").map(value => value.trim()).filter(Boolean)) {
      const categories = result.get(id) ?? new Set<string>()
      categories.add(category)
      result.set(id, categories)
    }
  }
  return result
}

export function applyStyleLibrarySelection(): void {
  const target = appState.stylePickerTarget
  const selected = appState.styleLibrarySelected
  const imageTarget = appState.pickerTarget
  if (imageTarget?.selectImage && selected && isEditing()) {
    if (selected.imagePath) openImageSlicePicker(selected.imagePath, imageTarget)
    else if (selected.styleID && styleKind(selected.styleID) === "image") {
      void visualResolver()?.resolve(selected.styleID, false).then(visual => {
        if (!visual?.imagePath || appState.pickerTarget !== imageTarget || !isEditing()) return
        clearImageSlicePicker()
        imageTarget.selectImage!(visual.imagePath, visual.source)
      })
    }
    return
  }
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

function closeStylePicker(): void {
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

function nativeStyleLibraryPayload(sliceBack: boolean): Promise<StyleLibraryPayload | undefined> {
  const target = appState.stylePickerTarget
  const imageSelection = Boolean(appState.pickerTarget?.selectImage)
  if (!appState.archive || !target && !imageSelection) return Promise.resolve(undefined)
  const source = appState.archive
  const key = target ? styleReferenceKey(target) : "FORE_STYLE"
  const soundOnly = key === "SOUND_STYLE"
  const styles = styleConfigDocument()
  const currentID = target?.value.split(",")[0]?.trim() ?? ""
  const targetType = appState.archive.format === "bda" ? target?.dataset.bdaStyleType : undefined
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
    imageSelection,
    editable: isEditing() && !target?.disabled,
    canAdd: canAddStyle(),
    soundOnly,
    foreground: styleReferenceForeground(key),
    bda: appState.archive.format === "bda",
    kind: styleKindForKey(key),
    currentID,
    imagesCompatible: !targetType || bdaStyleRef(currentID)?.type === "image",
    bitmaps,
    animationText: "",
    animationFiles: {} as Record<string, number[]>,
    particleVisuals: {} as Record<string, StyleLibraryVisual | null>,
    styles: [] as StyleLibraryPayload["styles"],
    images: [] as StyleLibraryPayload["images"],
    sounds: [] as StyleLibraryPayload["sounds"],
  }
  if (soundOnly) {
    payload.sounds = availableStyleIDs().flatMap((styleID) => {
      const filename = styleSoundFile(styleID, styles) ?? ""
      if (!filename) return []
      const playable = Boolean(soundPathForFilename(source.names(), theme.value, orientation.value, filename))
      return [{ styleID, filename, playable, uses: payload.canAdd ? styleUsages(styleID).length : undefined }]
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
    const imageUses = new Map<string, number>()
    const styleCategories = styleLibraryCategories()
    const particleIDs = new Set<string>()
    payload.styles = items.map(({ styleID, visuals }) => {
      const categories = styleCategories.get(styleID) ?? new Set<string>()
      for (const visual of visuals) {
        if (!visual?.imagePath) continue
        imageUses.set(visual.imagePath, (imageUses.get(visual.imagePath) ?? 0) + 1)
        const merged = imageCategories.get(visual.imagePath) ?? new Set<string>()
        for (const category of categories) merged.add(category)
        imageCategories.set(visual.imagePath, merged)
      }
      const kind = styleKind(styleID, styles)
      const animation = kind === "anim" && styles ? styleAnimationSources(styleID, styles) : undefined
      if (animation) {
        payload.animationText = animation.text
        Object.assign(payload.animationFiles, animation.files)
        for (const id of animation.particleIDs) particleIDs.add(id)
      }
      return {
        styleID,
        label: stylePickerLabel(styleID),
        info: styles?.get(`STYLE${styleID}`, "INFO")?.trim() || undefined,
        kind,
        categories: [...categories],
        compatible: imageSelection ? kind === "image" : !targetType || bdaStyleRef(styleID)?.type === targetType,
        uses: payload.canAdd ? styleUsages(styleID).length : undefined,
        imagePaths: visuals.flatMap((visual) => visual?.imagePath ? [visual.imagePath] : []),
        animationSections: animation?.sections,
        summary: kind === "anim" && styles ? styleAnimationSummary(styleID, styles) : undefined,
        textVisuals: kind === "text" ? [false, true].map(highlighted => resolver.resolveStyleText?.(styleID, highlighted) ?? resolver.resolveText(styleID, highlighted)) : undefined,
        sound: styleSoundFile(styleID, styles),
        soundPlayable: Boolean(soundPathForFilename(source.names(), theme.value, orientation.value, styleSoundFile(styleID, styles) ?? "")),
        visuals: visuals.map(wireVisual),
      }
    })
    payload.images = resourceImagePaths(source.names(), theme.value, orientation.value).flatMap((path) => {
      const bytes = source.getBytes(path)
      if (!bytes) return []
      bitmaps[path] ??= imageDataURL(bytes)
      return [{ path, categories: [...imageCategories.get(path) ?? []], uses: imageUses.get(path) ?? 0 }]
    })
    return Promise.all([...particleIDs].map(async id => {
      payload.particleVisuals[id] = wireVisual(await resolver.resolve(id, false).catch(() => undefined))
    })).then(() => payload)
  })
}

export async function emitStyleLibrary(sliceBack = false): Promise<void> {
  const payload = await nativeStyleLibraryPayload(sliceBack)
  if (payload) await emitToPicker("style-library-data", payload)
}

/** 弹窗里的新建：有可写的引用目标就应用并打开编辑器（关窗），否则留在弹窗里刷新。 */
export function addStyleFromLibrary(): void {
  const id = addStyle()
  if (!id) return
  const target = appState.stylePickerTarget
  if (target && !target.disabled) {
    appState.styleLibrarySelected = { styleID: id }
    applyStyleLibrarySelection()
    openStyleReferenceEditor(id)
  } else void emitStyleLibrary()
}

/** 预览栏的「选择切片」：改选中样式的图片切片，按打开弹窗时的状态（正常 / 按下）。 */
export function sliceStyleLibrarySelection(styleID: string): void {
  const target = appState.stylePickerTarget
  if (target) void openStyleReferenceStateImage(target, styleReferenceKey(target), appState.styleLibraryHighlighted, [styleID])
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
const styleReferenceThumbnailInputs = new WeakMap<HTMLElement, { archive: SkinArchive; signature: string }>()

export function refreshStyleReferenceThumbnails(): void {
  let resolver: VisualResolver | undefined
  for (const list of Array.from(document.querySelectorAll<HTMLElement>(".ui-style-ref-list"))) {
    // 列表的第一个子元素是隐藏的引用输入框（decorateStyleReferenceInput），卡片按它的值重建。
    const input = list.firstElementChild
    if (!(input instanceof HTMLInputElement)) continue
    const key = styleReferenceKey(input)
    if (appState.archive) {
      const signature = `${appState.archive.revision}|${theme.value}|${orientation.value}|${key}|${input.value}|${input.disabled}`
      const previous = styleReferenceThumbnailInputs.get(list)
      if (previous?.archive === appState.archive && previous.signature === signature) continue
      styleReferenceThumbnailInputs.set(list, { archive: appState.archive, signature })
    } else styleReferenceThumbnailInputs.delete(list)
    resolver ??= visualResolver()
    refreshStyleReferenceThumbnail(list, input, key, resolver)
  }
}
