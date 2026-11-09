import { type StyleImagePickerTarget, type SoundEntry } from "./types"
import { appState } from "./state"
import { resourceSearchControl, source, keySoundBuffers, releaseKeySound } from "./canvas-interaction"
import { openImagePickerList, openImageSlicePicker, pickableImagePaths } from "./image-pickers"
import { type BdaStyleRef, bdaStyleID } from "../bda.ts"
import { updateBdaRefs } from "./key-inspector"
import { isEditing, commitText, updateDirty, commitBytes } from "./edit-history"
import { currentBdaAppearance, bdaAppearancePart, visualResolver, bdaAppearanceStyleGroups } from "./bda-documents"
import { resourceImagePaths } from "../resources.ts"
import { theme, orientation, resourceName, resourceMeta, imageResourceDetail, styleResourceDetail, styleDetailPreviews, styleDetailFields, styleDetailNormal, styleDetailHighlighted, resourceListView, resourceDetail, resourceInspector, tileModeButtons, resourceGallery, resourceCategory, resourceSearch, resourceListTitle, resourceCount, resourceUploadButton, resourceDownloadButton, resourceDeleteButton, resourceUploadInput, sourceName, atlasCanvas, assetImage, workspaceImageError, workspaceImageFigure, deviceShell, sourceEditor } from "./dom"
import { selectFile } from "./navigation"
import { populateTileInspector, drawAtlas, loadTiles, syncAtlasWorkspace, bdaImageUsageCounts, bdaImageResourceID, setDrawingTile } from "./tile-editing"
import { styleConfigPath, setSourceValue, scrollSelectedSource } from "./config-context"
import { IniDocument } from "../ini.ts"
import { renderBdaStyleEditor } from "../bda-editor.ts"
import { drawVisualPreview, retinaThumbnail, thumbnailRecycler } from "../atlas.ts"
import { looksNumeric, translatedConfigLabel } from "./document-inspector"
import { refreshPreview } from "./preview-render"
import { soundPathForFilename, soundResourcePaths, SOUND_ACCEPT, isSoundPath } from "../sounds.ts"
import { addStyle, availableStyleIDs, canAddStyle, duplicateStyle, removeStyle, styleKind, styleConfigDocument, styleSoundFile, styleLibraryCategories } from "./style-picker"
import { styleUsages } from "./style-references"
import { SXI_SKIN_PATH } from "../palm/sxi-json.ts"
import { asObject } from "../palm/sxi-ini.ts"
import { renderSxiGroup } from "./sxi-fields"
import { palmStyle, palmStyleImage, palmStylePointer } from "./sxi-styles"
import { palmTileSlices } from "../palm/palm-style-edit.ts"
import { openPalmSkin } from "./sxi-documents"
import { showImage, showError, showStatus } from "./file-operations"
import { updateSourceHighlight } from "./source-panel"
import { decorateStyleAnimationField, styleAnimationPlayers, styleAnimationSummary } from "./legacy-animation-inspector"
import { previewStyleAnimation } from "./animation-resource"
import { configField } from "./config-value-control"
import { field, section as sectionNode } from "./property-rows"
import { renderSoundLibrary } from "./sound-library"
import { skinFontNameOptions } from "./skin-fonts"
import { keySoundSample } from "./style-card-preview"
import { imageResourceCard, styleAddCard, styleCard, styleMatches, styleTypeOptions, styleUsageOptions, textStyleSample } from "../style-card"
import { STYLE_ANIM_FIELDS } from "../legacy-animation.ts"
import { bindListActionKeys, emptyState, listToolbar } from "../dom-element.ts"

export function openStyleImageResourceChooser(target: StyleImagePickerTarget): void {
  appState.resourcePickerSelect = undefined
  appState.pickerTarget = target
  openImagePickerList()
}

export function openImageResourceChooser(onSelect: (resourceID: string) => void): void {
  appState.pickerTarget = undefined
  appState.resourcePickerSelect = onSelect
  openImagePickerList()
}

function openBdaStyleImageResourceChooser(ref: BdaStyleRef, highlighted: boolean): void {
  appState.pickerTarget = undefined
  appState.resourcePickerSelect = (resourceID) => {
    const property = highlighted ? "HL_IMG" : "NM_IMG"
    if (updateBdaRefs([ref], property, resourceID)) void renderStyleResourceDetail()
  }
  openImagePickerList()
}

function replaceBdaStyleImage(ref: BdaStyleRef, highlighted: boolean): void {
  if (ref.type !== "image" || !isEditing()) return
  openBdaStyleImageResourceChooser(ref, highlighted)
}

function editBdaStyleImageSlice(ref: BdaStyleRef, highlighted: boolean): void {
  const info = currentBdaAppearance()
  const style = ref.type === "image" ? info?.appearance.imageStyles.get(ref.key) : undefined
  const atom = highlighted ? style?.highlightImage : style?.normalImage
  const resourceID = atom?.resource?.resourceID.replace(/\.png$/i, "")
  if (!info || !resourceID) return
  const path = resourceImagePaths(appState.archive?.names() ?? [], theme.value, orientation.value)
    .find((candidate) => candidate.split("/").pop()?.replace(/\.png$/i, "") === resourceID)
  if (!path) return
  const returnState = { path: appState.selectedPath, styleID: appState.selectedStyleID }
  selectFile(info.path, "overview", "image")
  appState.bdaSliceReturn = returnState
  selectResourceImage(path)
  appState.selectedTileIndex = appState.bdaTileUsages.find((usage) =>
    usage.ref.type === ref.type && usage.ref.key === ref.key && usage.highlighted === highlighted)?.index
    ?? appState.selectedTileIndex
  populateTileInspector()
  drawAtlas()
}

export function chooseStyleImageSlice(property: "NM_IMG" | "HL_IMG"): void {
  const target = styleSectionTarget(appState.selectedStyleID, property)
  const image = appState.archive?.format === "sxi"
    ? palmStyleImage(appState.selectedStyleID, property === "HL_IMG")
    : styleConfigDocument()?.get(`STYLE${appState.selectedStyleID}`, property)
  const current = image?.split(",")[0]?.trim()
  const imagePath = resourceImagePaths(appState.archive?.names() ?? [], theme.value, orientation.value)
    .find((candidate) => candidate.split("/").pop()?.replace(/\.png$/i, "") === current)
  appState.stylePickerTarget = undefined
  if (imagePath && target) openImageSlicePicker(imagePath, target)
  else if (target) openStyleImageResourceChooser(target)
}

function styleSectionTarget(styleID: string, property: "NM_IMG" | "HL_IMG"): StyleImagePickerTarget | undefined {
  const path = styleConfigPath()
  // A Palm style's images are written in skin.json by its id (image-pickers.ts).
  if (appState.archive?.format === "sxi") return palmStylePointer(styleID) ? { source: "BACK_STYLE", property, path, sections: [`STYLE${styleID}`] } : undefined
  if (!appState.archive?.isText(path)) return
  return {
    source: "BACK_STYLE",
    property,
    document: IniDocument.parse(appState.archive.getText(path)),
    path,
    sections: [`STYLE${styleID}`],
  }
}


/** The same style fields are used in the style library and the animation workspace. */
export async function renderStyleResourceDetail(embedded?: { container: HTMLElement; id: string; refresh(): void }): Promise<void> {
  const styleID = embedded?.id ?? appState.selectedStyleID
  const fieldsHost = embedded?.container ?? styleDetailFields
  const appearancePart = bdaAppearancePart(appState.selectedPath)
  const appearanceInfo = currentBdaAppearance()
  if (!embedded && appState.archive?.format === "bda" && appearancePart?.kind === "styles" && appearanceInfo && styleID) {
    const type = appearancePart.group === "imageStyles" ? "image" : appearancePart.group === "textStyles" ? "text" : "color"
    const ref: BdaStyleRef = { type, key: Number(styleID) }
    resourceName.textContent = `STYLE ${styleID}`
    resourceMeta.textContent = appearancePart.group
    imageResourceDetail.hidden = true
    styleResourceDetail.hidden = false
    styleDetailPreviews.hidden = true
    renderBdaStyleEditor(fieldsHost, {
      appearance: appearanceInfo.appearance,
      ref,
      resolver: visualResolver(),
      editable: isEditing(),
      onStyleChange: (styleRef, property, value) => { updateBdaRefs([styleRef], property, value) },
      onImageAction: (ref, highlighted, action) => {
        if (action === "slice") editBdaStyleImageSlice(ref, highlighted)
        else replaceBdaStyleImage(ref, highlighted)
      },
    })
    return
  }
  const path = styleConfigPath()
  const palm = appState.archive?.format === "sxi" ? palmStylePointer(styleID) : undefined
  if (!appState.archive?.isText(path) && !palm || !styleID) return
  const section = `STYLE${styleID}`
  const animated = !palm && styleKind(styleID) === "anim"
  if (!embedded) {
    resourceName.textContent = section
    resourceMeta.textContent = palm ? `${SXI_SKIN_PATH} · ${palm.join(".")}` : path
    imageResourceDetail.hidden = true
    styleResourceDetail.hidden = false
    styleDetailPreviews.hidden = animated
    const resolver = visualResolver()
    if (resolver && !animated) {
      drawVisualPreview(retinaThumbnail(styleDetailNormal, 128, 88), [await resolver.resolve(styleID, false).catch(() => undefined)], false)
      drawVisualPreview(retinaThumbnail(styleDetailHighlighted, 128, 88), [await resolver.resolve(styleID, true).catch(() => undefined)], false)
    }
  }
  if (palm) {
    const group = renderSxiGroup("样式", [{ targets: [palm] }], { code: palm.slice(1).join(".") })
    fieldsHost.replaceChildren(...group ? [group] : [])
    return
  }
  const archive = appState.archive!
  const stylesDocument = IniDocument.parse(archive.getText(path))
  fieldsHost.replaceChildren(...animated && !embedded ? styleAnimationPlayers(styleID, stylesDocument) : [])
  const existing = stylesDocument.entries(section)
  const common = ["NM_COLOR", "HL_COLOR", "FONT_NAME", "FONT_SIZE", "FONT_CLEARTYPE", "SHOW", "INFO", "BORDER_COLOR", "BORDER_SIZE", "PRESS_SOUND_PATH"]
  const keys = [...new Set([...common, ...STYLE_ANIM_FIELDS, ...existing.map((entry) => entry.key).filter((key) => key !== "NM_IMG" && key !== "HL_IMG")])]
  const groups = [
    ["colors", "状态颜色", (key: string) => key === "NM_COLOR" || key === "HL_COLOR"],
    ["typography", "字体", (key: string) => key.startsWith("FONT_")],
    ["content", "内容与说明", (key: string) => key === "SHOW" || key === "INFO"],
    ["animation", "动画", (key: string) => /ANIM|^EVENT\d+$/.test(key)],
    ["sound", "音效", (key: string) => key.endsWith("SOUND_PATH")],
    ["advanced", "边框与扩展", () => true],
  ] as const
  const groupRows = new Map<string, HTMLElement[]>(groups.map(([id]) => [id, []]))
  const files = currentSoundEntries().map((entry) => entry.filename)
  const fonts = skinFontNameOptions()
  for (const key of keys) {
    const label = translatedConfigLabel(key)
    const value = stylesDocument.get(section, key) ?? ""
    const commit = (next: string) => {
      if (!appState.archive?.isText(path) || !isEditing()) return
      const current = IniDocument.parse(appState.archive.getText(path))
      const before = current.toString()
      if (current.get(section, key) === undefined && !next) return
      if (!current.set(section, key, next)) return
      commitText(path, before, current.toString())
      if (!embedded) setSourceValue(current.toString())
      refreshPreview()
      if (embedded) embedded.refresh()
      else void renderStyleResourceDetail()
      updateDirty()
    }
    const options = { key, label, commit, rowKey: [path, section, key] }
    let row: HTMLElement
    if (key.endsWith("SOUND_PATH")) {
      const sample = keySoundSample(value || undefined, soundPathForFilename(archive.names(), theme.value, orientation.value, value))
      row = field({ ...options, spec: { kind: "sound", value, files, sample } })
    } else if (key === "FONT_NAME") {
      row = field({ ...options, spec: { kind: "choice", value, options: [["", "系统默认"], ...fonts.map((font) => [font, font] as const)], layout: "select" } })
    } else if ((key === "FONT_SIZE" || key === "BORDER_SIZE") && (!value || looksNumeric(value))) {
      row = field({ ...options, spec: { kind: "number", value, range: key === "FONT_SIZE" ? "fontSize" : "border" } })
    } else {
      // 百度配置值的类型化控件（颜色、开关……）。
      row = configField(section, key, label, value, isEditing(), commit) ?? field({ ...options, spec: { kind: "text", value } })
      decorateStyleAnimationField(row, key, value)
    }
    groupRows.get(groups.find(([, , matches]) => matches(key))![0])!.push(row)
  }
  for (const [id, title] of groups) {
    const rows = groupRows.get(id)!
    if (!rows.length) continue
    const group = sectionNode(title, rows)
    group.dataset.styleDetailGroup = id
    fieldsHost.append(group)
  }
}

export function selectStyleResource(styleID: string): void {
  if (appState.archive?.format === "bda") {
    const part = bdaAppearancePart(appState.selectedPath)
    const appearance = currentBdaAppearance()?.appearance
    if (part?.kind !== "styles" || !appearance) return
    const styles = part.group === "imageStyles"
      ? appearance.imageStyles
      : part.group === "textStyles"
        ? appearance.textStyles
        : appearance.colorStyles
    if (!styles.has(Number(styleID))) return
  } else if (!availableStyleIDs().includes(styleID)) return
  appState.selectedStyleID = styleID
  resourceListView.hidden = !document.body.classList.contains("style-workspace")
  selectGalleryItem(`STYLE${styleID}`, resourceGallery)
  resourceDetail.hidden = false
  resourceInspector.scrollTop = 0
  void renderStyleResourceDetail()
}

export function selectResourceImage(path: string): void {
  if (!appState.archive?.isImage(path)) return
  appState.selectedResourcePath = path
  appState.selectedResourceGalleryPath = path
  resourceListView.hidden = true
  resourceDetail.hidden = false
  resourceInspector.scrollTop = 0
  resourceName.textContent = path.split("/").pop() ?? path
  resourceMeta.textContent = path
  imageResourceDetail.hidden = false
  styleResourceDetail.hidden = true
  appState.tileMode = "select"
  tileModeButtons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.tileMode === appState.tileMode)))
  showImage(path)
  loadTiles(path)
  syncAtlasWorkspace()
  selectGalleryItem(path, resourceGallery)
}

function releaseResourceURLs(): void {
  for (const url of appState.resourceURLs) URL.revokeObjectURL(url)
  appState.resourceURLs = []
}

/** 列表头：标题、数量角标与搜索框的名字（搜索框 placeholder 固定「搜索」）。 */
function listHeader(title: string, count: number): void {
  resourceListTitle.textContent = title
  resourceCount.textContent = String(count)
  resourceSearch.setAttribute("aria-label", `搜索${title}`)
  resourceCategory.parentElement!.hidden = true
}

function renderStyleFilters(bdaGroup?: string): void {
  let bar = resourceListView.querySelector<HTMLElement>(".ui-style-filter-bar")
  if (!bar) {
    bar = document.createElement("span")
    bar.className = "ui-style-filter-bar"
    resourceSearchControl.after(bar)
  }
  if (!bdaGroup && resourceCategory.dataset.styleCategories !== "bdi") {
    resourceCategory.replaceChildren(...styleTypeOptions.map(([value, label]) => new Option(label, value)))
    resourceCategory.dataset.styleCategories = "bdi"
  }
  const select = (label: string, options: readonly (readonly [string, string])[], value: string, change: (value: string) => void) => {
    const wrap = document.createElement("span")
    wrap.className = "ui-input ui-select"
    const control = document.createElement("select")
    control.setAttribute("aria-label", label)
    control.replaceChildren(...options.map(([value, label]) => new Option(label, value)))
    control.value = value
    control.addEventListener("change", () => change(control.value))
    wrap.append(control)
    return wrap
  }
  // 未筛选时下拉只显示维度名（类型 / 用途），窄侧栏里也不会被截断。
  const unfiltered = (options: readonly (readonly [string, string])[], name: string) => options.map(([value, label]) => [value, value === "all" ? name : label] as const)
  bar.hidden = false
  bar.replaceChildren(
    select("样式类型", bdaGroup ? styleTypeOptions.filter(([kind]) => ["image", "color", "text"].includes(kind)) : unfiltered(styleTypeOptions, "类型"), bdaGroup ?? resourceCategory.value, value => {
      resourceCategory.value = bdaGroup ? value === "image" ? "imageStyles" : value === "text" ? "textStyles" : "colorStyles" : value
      if (bdaGroup) resourceCategory.dispatchEvent(new Event("change"))
      else renderResourceInspector()
    }),
    select("样式用途", unfiltered(styleUsageOptions, "用途"), appState.styleUsageFilter, value => { appState.styleUsageFilter = value; renderResourceInspector() }),
  )
}

async function renderStyleResourceGallery(galleryCanvas: ReturnType<typeof thumbnailRecycler>): Promise<void> {
  if (appState.archive?.format === "bda") {
    await renderBdaStyleResourceGallery(galleryCanvas)
    return
  }
  const stylesDocument = styleConfigDocument()
  if (!appState.archive || !stylesDocument && appState.archive.format !== "sxi") return
  renderStyleFilters()
  const query = resourceSearch.value.trim().toLowerCase()
  const category = resourceCategory.value
  // What a style says about itself: INFO / SHOW in default.css, a Palm style's text (`s_1.text`).
  const notes = (styleID: string) => stylesDocument
    ? stylesDocument.entries(`STYLE${styleID}`).filter((entry) => entry.key === "INFO" || entry.key === "SHOW").map((entry) => entry.value)
    : [String(asObject(palmStyle(styleID)?.s_1)?.text ?? "")]
  const categories = styleLibraryCategories()
  const styleIDs = availableStyleIDs().filter((styleID) => {
    return styleMatches({ kind: styleKind(styleID, stylesDocument), sound: Boolean(styleSoundFile(styleID, stylesDocument)),
      categories: categories.get(styleID) ?? [], search: [styleID, ...notes(styleID)].join(" ") }, category, appState.styleUsageFilter, query)
  })
  listHeader("样式", styleIDs.length)
  resourceUploadButton.hidden = true
  resourceDownloadButton.hidden = true
  resourceDeleteButton.hidden = true
  resourceListView.hidden = Boolean(appState.selectedStyleID) && !document.body.classList.contains("style-workspace")
  resourceDetail.hidden = !appState.selectedStyleID
  const resolver = visualResolver()
  if (!resolver) return
  resourceGallery.setAttribute("role", "listbox")
  resourceGallery.setAttribute("aria-label", "样式")
  const editable = canAddStyle() && isEditing()
  styleListToolbar.hidden = !editable
  for (const styleID of styleIDs) {
    const kind = styleKind(styleID, stylesDocument)
    const soundFilename = styleSoundFile(styleID, stylesDocument)
    const soundPath = soundFilename ? soundPathForFilename(appState.archive.names(), theme.value, orientation.value, soundFilename) : undefined
    const uses = styleUsages(styleID).length
    const button = styleCard({
      id: styleID, label: `STYLE${styleID}`, kind,
      info: stylesDocument?.get(`STYLE${styleID}`, "INFO")?.trim() || undefined,
      canvas: galleryCanvas,
      draw: async (canvas, highlighted) => {
        if (kind === "text") await textStyleSample(canvas, resolver, styleID, highlighted)
        else drawVisualPreview(canvas, [await resolver.resolve(styleID, highlighted).catch(() => undefined)], false)
      },
      animation: () => stylesDocument ? styleAnimationPlayers(styleID, stylesDocument, true) : [],
      summary: stylesDocument ? styleAnimationSummary(styleID, stylesDocument) : undefined,
      sound: soundFilename ? () => keySoundSample(soundFilename, soundPath) : undefined,
      uses,
      remove: editable ? { run: () => { if (removeStyle(styleID)) renderResourceInspector() }, blocked: uses ? `被 ${uses} 处引用` : undefined } : undefined,
    })
    button.classList.add("resource-item", "style-resource-item")
    button.dataset.path = `STYLE${styleID}`
    if (kind === "anim") button.addEventListener("mouseenter", () => previewStyleAnimation([styleID]))
    button.addEventListener("click", () => selectStyleResource(styleID))
    resourceGallery.append(button)
  }
  if (!styleIDs.length && !editable) resourceGallery.append(emptyState(query ? "search-x" : "layers"))
  if (editable) resourceGallery.append(styleAddCard(() => {
    const id = addStyle()
    if (id) showStyle(id)
  }))
  if (appState.selectedResourceGalleryPath) selectGalleryItem(appState.selectedResourceGalleryPath, resourceGallery)
  if (!appState.selectedStyleID && document.body.classList.contains("style-workspace") && styleIDs.length) selectStyleResource(styleIDs[0])
}

// 样式列表的工具条：新建在网格末尾的虚线卡，删除在卡片上，这里只放复制（⌘D 同）。
const styleListToolbar = listToolbar({ duplicate: { label: "复制样式", run: () => {
  const id = appState.selectedStyleID && duplicateStyle(appState.selectedStyleID)
  if (id) showStyle(id)
} } })
styleListToolbar.hidden = true
resourceDeleteButton.parentElement!.append(styleListToolbar)
bindListActionKeys(resourceGallery, resourceDeleteButton.parentElement!)

/** 新建或复制出的样式：重画列表并选中它。 */
export function showStyle(styleID: string): void {
  appState.selectedResourceGalleryPath = `STYLE${styleID}`
  renderResourceInspector()
  selectStyleResource(styleID)
}

async function renderBdaStyleResourceGallery(galleryCanvas: ReturnType<typeof thumbnailRecycler>): Promise<void> {
  const info = currentBdaAppearance()
  const part = bdaAppearancePart(appState.selectedPath)
  if (!info || part?.kind !== "styles") return
  const definitions = {
    imageStyles: { type: "image", styles: info.appearance.imageStyles },
    textStyles: { type: "text", styles: info.appearance.textStyles },
    colorStyles: { type: "color", styles: info.appearance.colorStyles },
  } as const
  const definition = definitions[part.group]
  renderStyleFilters(definition.type)
  resourceCategory.dataset.styleCategories = "bda"
  resourceCategory.replaceChildren(...bdaAppearanceStyleGroups.map(([value, label]) => new Option(label, value)))
  resourceCategory.value = part.group
  const query = resourceSearch.value.trim().toLowerCase()
  const categories = styleLibraryCategories()
  const keys = [...definition.styles.keys()].filter(key => styleMatches({ kind: definition.type, categories: categories.get(bdaStyleID({ type: definition.type, key })) ?? [], search: String(key) }, "all", appState.styleUsageFilter, query))
  listHeader("样式", keys.length)
  resourceUploadButton.hidden = true
  resourceGallery.setAttribute("role", "listbox")
  resourceGallery.setAttribute("aria-label", "样式")
  resourceDownloadButton.hidden = true
  resourceDeleteButton.hidden = true
  resourceListView.hidden = Boolean(appState.selectedStyleID) && !document.body.classList.contains("style-workspace")
  resourceDetail.hidden = !appState.selectedStyleID
  const resolver = visualResolver()
  for (const key of keys) {
    const ref: BdaStyleRef = { type: definition.type, key }
    const button = styleCard({
      id: bdaStyleID(ref), label: `STYLE ${key}`, kind: definition.type,
      canvas: galleryCanvas,
      draw: async (canvas, highlighted) => {
        if (definition.type === "text" && resolver) await textStyleSample(canvas, resolver, bdaStyleID(ref), highlighted)
        else drawVisualPreview(canvas, [await resolver?.resolve(bdaStyleID(ref), highlighted).catch(() => undefined)], false)
      },
    })
    button.classList.add("resource-item", "style-resource-item")
    button.dataset.path = `STYLE${key}`
    button.addEventListener("click", () => selectStyleResource(String(key)))
    resourceGallery.append(button)
  }
  if (appState.selectedResourceGalleryPath) selectGalleryItem(appState.selectedResourceGalleryPath, resourceGallery)
  if (!appState.selectedStyleID && document.body.classList.contains("style-workspace") && keys.length) selectStyleResource(String(keys[0]))
}

export function currentSoundEntries(): SoundEntry[] {
  if (!appState.archive) return []
  const names = appState.archive.names()
  // 搜狗的音效都放在 default/ 下。
  const paths = appState.archive.format === "ssf"
    ? names.filter((path) => path.startsWith("default/") && !path.slice(8).includes("/") && isSoundPath(path)).sort()
    : soundResourcePaths(names, theme.value, orientation.value)
  return paths.map((path) => {
    const filename = path.split("/").pop() ?? path
    return {
      id: `file:${path}`,
      label: filename,
      filename,
      path,
      usage: path.split("/").slice(0, -1).join("/"),
    }
  })
}

function renderSoundResourceGallery(): void {
  if (!appState.archive) return
  const entries = currentSoundEntries()
  listHeader("音效", entries.length)
  resourceUploadInput.accept = SOUND_ACCEPT
  resourceUploadButton.hidden = true
  resourceUploadButton.title = appState.selectedSoundID ? "替换选中按键音效" : "添加按键音效"
  resourceUploadButton.setAttribute("aria-label", resourceUploadButton.title)
  resourceDownloadButton.hidden = true
  resourceDownloadButton.title = "下载选中按键音效"
  resourceDownloadButton.setAttribute("aria-label", resourceDownloadButton.title)
  resourceDeleteButton.hidden = true
  resourceListView.hidden = false
  resourceDetail.hidden = true
  renderSoundLibrary(entries, updateResourceActionButtons)
}

export function renderResourceInspector(): void {
  if (!appState.archive) return
  syncAtlasWorkspace()
  releaseResourceURLs()
  const galleryCanvas = thumbnailRecycler(resourceGallery)
  const styleFilters = resourceListView.querySelector<HTMLElement>(".ui-style-filter-bar")
  if (styleFilters) styleFilters.hidden = appState.resourceInspectorMode !== "style"
  resourceGallery.replaceChildren()
  delete resourceGallery.dataset.kind
  resourceGallery.removeAttribute("role")
  styleListToolbar.hidden = true
  if (appState.resourceInspectorMode === "style") {
    void renderStyleResourceGallery(galleryCanvas)
    return
  }
  if (appState.resourceInspectorMode === "sound") {
    renderSoundResourceGallery()
    return
  }
  resourceUploadInput.accept = ".png,image/png"
  resourceUploadButton.hidden = false
  resourceUploadButton.title = "上传图片"
  resourceUploadButton.setAttribute("aria-label", resourceUploadButton.title)
  resourceDownloadButton.hidden = false
  resourceDownloadButton.title = "下载选中图片"
  resourceDownloadButton.setAttribute("aria-label", resourceDownloadButton.title)
  resourceDeleteButton.hidden = false
  const query = resourceSearch.value.trim().toLowerCase()
  const paths = pickableImagePaths()
    .filter((path) => !query || path.toLowerCase().includes(query))
  const bdaUsageCounts = appState.archive.format === "bda" ? bdaImageUsageCounts() : new Map<string, number>()
  listHeader("图片", paths.length)
  resourceListView.hidden = Boolean(appState.selectedResourcePath) && !document.body.classList.contains("atlas-workspace")
  resourceDetail.hidden = !appState.selectedResourcePath
  for (const path of paths) {
    const bytes = appState.archive.getBytes(path)
    if (!bytes) continue
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    const url = URL.createObjectURL(new Blob([copy.buffer], { type: "image/png" }))
    appState.resourceURLs.push(url)
    const bdaUses = bdaUsageCounts.get(bdaImageResourceID(path)) ?? 0
    const button = imageResourceCard({
      path, src: url,
      til: appState.archive.isText(path.replace(/\.png$/i, ".til")),
      slices: appState.archive.format === "sxi" ? palmTileSlices(openPalmSkin(), path).length : undefined,
      uses: appState.archive.format === "bda" ? bdaUses : undefined,
    })
    button.classList.add("resource-item")
    button.addEventListener("click", () => selectResourceImage(path))
    resourceGallery.append(button)
  }
  if (!paths.length) resourceGallery.append(emptyState(query ? "search-x" : "image-off"))
  resourceGallery.setAttribute("role", "listbox")
  resourceGallery.setAttribute("aria-label", "图片")
  if (appState.selectedResourceGalleryPath) selectGalleryItem(appState.selectedResourceGalleryPath, resourceGallery)
  updateResourceActionButtons()
  syncAtlasWorkspace()
}

export function showResourceList(): void {
  resourceListView.hidden = false
  resourceDetail.hidden = true
  resourceInspector.scrollTop = 0
  if (appState.resourceInspectorMode === "style") {
    appState.selectedStyleID = ""
    renderResourceInspector()
    return
  }
  setDrawingTile(false)
  appState.movingTile = undefined
  appState.selectedTileIndex = undefined
  if (appState.selectedDocument) setSourceValue(appState.selectedDocument.toString())
  sourceName.textContent = appState.selectedPath
  populateTileInspector()
}

export function clearImagePreviewError(): void {
  atlasCanvas.hidden = false
  assetImage.hidden = false
  workspaceImageError.hidden = true
  drawAtlas()
}

export function showImagePreviewError(): void {
  atlasCanvas.hidden = true
  assetImage.hidden = true
  workspaceImageError.hidden = false
}

export function hideImageWorkspace(): void {
  workspaceImageFigure.hidden = true
  deviceShell.hidden = false
}

export function loadVisibleSourceEditor(): void {
  if (sourceEditor.hidden) return
  void source.load()
    .then(() => requestAnimationFrame(() => {
      source.requestMeasure()
      scrollSelectedSource()
      updateSourceHighlight()
    }))
    .catch((error) => showError(error, "加载源码编辑器"))
}

export function updateResourceActionButtons(): void {
  const imageSelected = appState.resourceInspectorMode === "image" && Boolean(appState.selectedResourceGalleryPath)
  const soundSelected = appState.resourceInspectorMode === "sound"
    && Boolean(currentSoundEntries().find((entry) => entry.id === appState.selectedSoundID)?.path)
  resourceDownloadButton.disabled = !imageSelected && !soundSelected
  resourceDeleteButton.disabled = !imageSelected || !isEditing()
  resourceUploadButton.disabled = !isEditing()
  styleListToolbar.querySelector("button")!.disabled = appState.resourceInspectorMode !== "style" || !appState.selectedStyleID || !isEditing()
  syncAtlasWorkspace()
}

// 样式库可有几千张卡片：只改动之前选中和新选中的项，不逐个遍历。
function selectGalleryItem(path: string, container: HTMLElement): void {
  appState.selectedResourceGalleryPath = path
  for (const item of container.querySelectorAll<HTMLElement>('.resource-item[aria-selected="true"]')) item.setAttribute("aria-selected", "false")
  const selected = container.querySelector<HTMLElement>(`.resource-item[data-path="${CSS.escape(path)}"]`)
  selected?.setAttribute("aria-selected", "true")
  selected?.scrollIntoView({ block: "nearest" })
  updateResourceActionButtons()
}

export async function uploadKeySound(file: File, replacePath?: string): Promise<boolean> {
  if (!appState.archive || !isSoundPath(file.name)) throw new Error("按键音效仅支持 OGG、WAV 或 AIFF 文件")
  if (!isEditing()) return false
  const targetArchive = appState.archive
  const filename = file.name.split(/[\\/]/).pop() ?? file.name
  const entries = currentSoundEntries()
  if (replacePath && !entries.some(entry => entry.path === replacePath)) throw new Error("要替换的音效已不存在")
  if (replacePath && replacePath.split(".").pop()?.toLowerCase() !== filename.split(".").pop()?.toLowerCase()) {
    throw new Error("替换文件需与原音效格式相同；其他格式请用「添加音效」。")
  }
  const base = replacePath?.split("/").slice(0, -1).join("/")
    ?? entries[0]?.path.split("/").slice(0, -1).join("/")
    ?? (appState.archive.format === "ssf" ? "default" : `${theme.value}/skin/res`)
  const targetPath = replacePath ?? `${base}/${filename}`
  const beforeResource = appState.archive.getBytes(targetPath)?.slice()
  const resourceBytes = new Uint8Array(await file.arrayBuffer())
  if (appState.archive !== targetArchive || !isEditing()) return false
  keySoundBuffers.delete(targetPath)
  releaseKeySound()
  commitBytes(targetPath, beforeResource, resourceBytes)
  appState.selectedSoundID = `file:${targetPath}`
  renderResourceInspector()
  updateDirty()
  showStatus(`按键音效文件已更新：${filename}`)
  return true
}
