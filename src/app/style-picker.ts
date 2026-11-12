import { appState } from "./state"
import { bdaStyleRef, bdaStyleID } from "../bda.ts"
import { currentBdaAppearance, visualResolver } from "./bda-documents"
import { styleConfigPath } from "./config-context"
import { IniDocument } from "../ini.ts"
import { cachedIniDocument } from "./style-document"
import { type StyleKind } from "./types"
import { isStyleReferenceKey, styleReferenceForeground, styleWriteTarget, styleReferenceKey, openStyleReferenceEditor, openStyleReferenceStateImage, refreshStyleReferenceThumbnail, layoutAnimationFields, styleUsages } from "./style-references"
import { commitText, commitBytes, isEditing, updateDirty, updateHistoryButtons } from "./edit-history"
import { addBdaStyle, updateBdaStyle } from "../bda-encode"
import { updateBdaRefs } from "./key-inspector"
import { bdaImageResourceID } from "./tile-editing"
import { theme, orientation } from "./dom"
import { openImageSlicePicker, imageDataURL, showPickerWindow, closePickerWindow, emitToPicker, clearImageSlicePicker } from "./image-pickers"
import { type Visual, type VisualResolver } from "../atlas.ts"
import { afterNextPaint } from "./canvas-interaction"
import { selectFile } from "./navigation"
import { resourceImagePaths } from "../resources.ts"
import { soundPathForFilename } from "../sounds.ts"
import { type StyleLibraryPayload, type StyleLibraryVisual, type StyleLibraryPreview } from "../picker-window.ts"
import { SkinArchive } from "../skin.ts"
import { palmStyle, palmStyleCategories, palmStyleIDs, palmStyleKind, palmStyleSound } from "./sxi-styles"
import { styleAnimationSources, styleAnimationSummary } from "./legacy-animation-inspector"
import { nextStyleID } from "../layout-image.ts"
import { addPalmStyle, removePalmStyle } from "../palm/palm-style-edit.ts"
import { editSxi } from "./sxi-fields"
import { openPalmSkin, palmOrientation, palmTheme } from "./sxi-documents"
import { setSourceValue } from "./config-context"
import { refreshPreview } from "./preview-render"
import { asObject, type JsonObject } from "../palm/sxi-ini.ts"

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
  return (styleConfigDocument()?.sections() ?? [])
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
  return archive?.format === "sxi" ? Boolean(asObject(openPalmSkin()?.[palmTheme()])) : Boolean(archive?.isText(styleConfigPath()) && archive.format !== "bda")
}

/** default.css 的只读视图：检查器一次重建会问几十次，交给 style-document.ts 的缓存。 */
export function styleConfigDocument(): IniDocument | undefined {
  return cachedIniDocument(styleConfigPath())
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

export function applyStyleLibrarySelection(toStyle = false): void {
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
    if (target.dataset.bdaStyleType && target.dataset.bdaStyleType !== "image") return
    const styleID = target.value.split(",")[0]?.trim() ?? ""
    const highlighted = appState.styleLibraryHighlighted
    if (!toStyle) {
      if (appState.archive?.format === "bda") {
        createImageStyleReference(target, styleID, bdaImageResourceID(selected.imagePath), highlighted)
      } else {
        const source = appState.archive
        openImageSlicePicker(selected.imagePath, {
          source: styleReferenceForeground(styleReferenceKey(target)) ? "FORE_STYLE" : "BACK_STYLE",
          property: appState.styleLibraryHighlighted ? "HL_IMG" : "NM_IMG",
          selectReference: value => { if (appState.archive === source) createImageStyleReference(target, styleID, value, highlighted) },
        })
      }
      return
    }
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

function createImageStyleReference(target: HTMLInputElement, currentID: string, value: string, highlighted: boolean): void {
  if (!isEditing() || target.disabled) return
  const property = highlighted ? "HL_IMG" : "NM_IMG"
  const previous = appState.undoStack.at(-1)
  let id: string | undefined
  if (appState.archive?.format === "bda") {
    const info = currentBdaAppearance()
    if (!info) return
    const ref = bdaStyleRef(currentID)
    const added = addBdaStyle(info.bytes, "image", ref?.type === "image" ? ref.key : undefined)
    commitBytes(info.path, info.bytes, updateBdaStyle(added.bytes, added.ref, property, value))
    id = bdaStyleID(added.ref)
  } else if (appState.archive?.format === "sxi") {
    editSxi(skin => {
      const model = structuredClone(palmStyle(currentID, skin) ?? {}) as JsonObject
      delete model.id
      model.s_2 = { ...asObject(model.s_2), [property === "HL_IMG" ? "hl" : "normal"]: value }
      id = addPalmStyle(skin, palmTheme(), model)
    })
  } else editStyleConfig(styles => {
    id = String(nextStyleID(styles))
    styles.appendSection(`STYLE${id}`, styles.entries(`STYLE${currentID}`).map(({ key, value }) => ({ key, value })))
    styles.set(`STYLE${id}`, property, value)
  })
  if (!id) return
  target.value = id
  target.dispatchEvent(new Event("input", { bubbles: true }))
  target.dispatchEvent(new Event("change", { bubbles: true }))
  // 新建样式和替换引用是用户的一次操作，撤销时一起还原。
  const changes = appState.undoStack.splice(previous ? appState.undoStack.indexOf(previous) + 1 : 0)
  if (changes.length) appState.undoStack.push(changes.length === 1 ? changes[0] : { kind: "batch", changes })
  updateHistoryButtons()
  closeStylePicker()
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
  if (input.disabled) return
  appState.stylePickerTarget = input
  appState.pickerTarget = undefined
  appState.styleLibrarySelected = undefined
  void showPickerWindow("styles", "全部样式", 1100, 760)
}

async function nativeStyleLibraryPayload(sliceBack: boolean): Promise<StyleLibraryPayload | undefined> {
  const target = appState.stylePickerTarget
  const imageSelection = Boolean(appState.pickerTarget?.selectImage)
  if (!appState.archive || !target && !imageSelection) return
  const source = appState.archive
  const revision = source.revision
  const key = target ? styleReferenceKey(target) : "FORE_STYLE"
  const styles = styleConfigDocument()
  const currentID = target?.value.split(",")[0]?.trim() ?? ""
  const targetType = source.format === "bda" ? target?.dataset.bdaStyleType : undefined
  const names = source.names()
  const ids = availableStyleIDs()
  const resolver = visualResolver()
  const session = crypto.randomUUID()
  const images = new Map<string, () => string>()
  const bitmapKeys = new Map<ImageBitmap, string>()
  const wireVisual = (visual: Visual | undefined): StyleLibraryVisual | null => {
    if (!visual) return null
    const { image, ...rest } = visual
    if (!image) return rest
    const bytes = visual.imagePath ? source.getBytes(visual.imagePath) : undefined
    const imageKey = bytes ? visual.imagePath! : bitmapKeys.get(image) ?? `bitmap:${bitmapKeys.size}`
    bitmapKeys.set(image, imageKey)
    if (!images.has(imageKey)) images.set(imageKey, () => {
      if (bytes) return imageDataURL(bytes)
      const canvas = document.createElement("canvas")
      canvas.width = image.width
      canvas.height = image.height
      canvas.getContext("2d")?.drawImage(image, 0, 0)
      return canvas.toDataURL()
    })
    return { ...rest, imageKey }
  }
  const valid = () => appState.archive === source && source.revision === revision
  const previews = new Map<string, Promise<StyleLibraryPreview | undefined>>()
  appState.styleLibrarySession = {
    session,
    image: imageKey => valid() ? images.get(imageKey)?.() : undefined,
    preview: styleID => {
      if (!valid() || !ids.includes(styleID) || !resolver) return Promise.resolve(undefined)
      let preview = previews.get(styleID)
      if (!preview) {
        preview = (async () => {
          const animation = styleKind(styleID, styles) === "anim" && styles ? styleAnimationSources(styleID, styles) : undefined
          const particleVisuals: StyleLibraryPreview["particleVisuals"] = {}
          for (const id of animation?.particleIDs ?? []) particleVisuals[id] = wireVisual(await resolver.resolve(id, false).catch(() => undefined))
          const visuals = await Promise.all([false, true].map(pressed => resolver.resolve(styleID, pressed).catch(() => undefined)))
          return { session, styleID, visuals: visuals.map(wireVisual), particleVisuals,
            animationText: animation?.text, animationFiles: animation?.files, animationSections: animation?.sections }
        })().catch(() => undefined)
        previews.set(styleID, preview)
      }
      return preview
    },
  }
  const payload: StyleLibraryPayload = {
    session, sliceBack, imageSelection,
    editable: isEditing() && !target?.disabled,
    canAdd: canAddStyle(), soundOnly: key === "SOUND_STYLE",
    foreground: styleReferenceForeground(key), bda: source.format === "bda",
    kind: styleKindForKey(key), currentID,
    imagesCompatible: !targetType || targetType === "image",
    applyToStyle: Boolean(currentID && ids.includes(currentID) && (!targetType || bdaStyleRef(currentID)?.type === "image")),
    bitmaps: {}, animationText: "", animationFiles: {}, particleVisuals: {}, styles: [], images: [], sounds: [],
  }
  if (payload.soundOnly) {
    payload.sounds = ids.flatMap(styleID => {
      const filename = styleSoundFile(styleID, styles)
      return filename ? [{ styleID, filename, playable: Boolean(soundPathForFilename(names, theme.value, orientation.value, filename)),
        uses: payload.canAdd ? styleUsages(styleID).length : undefined }] : []
    })
    return payload
  }
  const imageCategories = new Map<string, Set<string>>()
  const imageUses = new Map<string, number>()
  const categories = styleLibraryCategories()
  payload.styles = ids.map(styleID => {
    const uses = categories.get(styleID) ?? new Set<string>()
    const imagePaths = [false, true].flatMap(pressed => resolver?.imagePath?.(styleID, pressed) ?? [])
    for (const path of imagePaths) {
      imageUses.set(path, (imageUses.get(path) ?? 0) + 1)
      const merged = imageCategories.get(path) ?? new Set<string>()
      for (const category of uses) merged.add(category)
      imageCategories.set(path, merged)
    }
    const kind = styleKind(styleID, styles)
    const sound = styleSoundFile(styleID, styles)
    return {
      styleID, label: stylePickerLabel(styleID), kind, categories: [...uses], imagePaths, visuals: [],
      info: styles?.get(`STYLE${styleID}`, "INFO")?.trim() || undefined,
      compatible: imageSelection ? kind === "image" : !targetType || bdaStyleRef(styleID)?.type === targetType,
      uses: payload.canAdd ? styleUsages(styleID).length : undefined,
      summary: kind === "anim" && styles ? styleAnimationSummary(styleID, styles) : undefined,
      textVisuals: kind === "text" ? [false, true].map(pressed => resolver?.resolveStyleText?.(styleID, pressed) ?? resolver?.resolveText(styleID, pressed)) : undefined,
      sound, soundPlayable: Boolean(sound && soundPathForFilename(names, theme.value, orientation.value, sound)),
    }
  })
  payload.images = resourceImagePaths(names, theme.value, orientation.value).map(path => {
    images.set(path, () => imageDataURL(source.getBytes(path)!))
    return { path, categories: [...imageCategories.get(path) ?? []], uses: imageUses.get(path) ?? 0 }
  })
  return payload
}

export async function emitStyleLibrary(sliceBack = false): Promise<void> {
  const payload = await nativeStyleLibraryPayload(sliceBack)
  if (payload) await emitToPicker("style-library-data", payload)
}

export async function emitStyleLibraryPreview(request: { session: string; styleID: string }): Promise<void> {
  const session = appState.styleLibrarySession
  if (session?.session !== request.session) return
  const preview = await session.preview(request.styleID)
  if (appState.styleLibrarySession === session) await emitToPicker("style-library-preview-data", preview ?? { ...request, visuals: [], particleVisuals: {} })
}

export async function emitStyleLibraryImage(request: { session: string; key: string }): Promise<void> {
  const session = appState.styleLibrarySession
  if (session?.session === request.session) await emitToPicker("style-library-image-data", { ...request, dataURL: session.image(request.key) })
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
