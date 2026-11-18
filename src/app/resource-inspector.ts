import { showImageBrowser, clearImageBrowser } from "./resource-image-preview"
import { type StyleImagePickerTarget, type SoundEntry } from "./types"
import { appState } from "./state"
import { source, keySoundBuffers, releaseKeySound } from "./canvas-interaction"
import { openImagePickerList, openImageSlicePicker, pickableImagePaths } from "./image-pickers"
import { type BdaStyleRef, bdaStyleID } from "../bda.ts"
import { updateBdaRefs } from "./key-inspector"
import { isEditing, commitText, updateDirty, commitBytes } from "./edit-history"
import { currentBdaAppearance, bdaAppearancePart, visualResolver, bdaAppearanceStyleGroups, bdaAppearanceStylePath } from "./bda-documents"
import { resourceImagePaths } from "../resources.ts"
import { theme, orientation, resourceName, resourceMeta, imageResourceDetail, styleResourceDetail, styleDetailPreviews, styleDetailFields, styleDetailNormal, styleDetailHighlighted, resourceListView, resourceDetail, resourceInspector, tileModeButtons, resourceGallery, resourceCategory, resourceSearch, resourceListTitle, resourceCount, resourceUploadButton, resourceSelectionActions, imageResourcePreview, soundResourceDetail, resourceDownloadButton, resourceRenameButton, resourceDeleteButton, resourceUploadInput, sourceName, atlasCanvas, assetImage, workspaceImageError, workspaceImageFigure, deviceShell, sourceEditor } from "./dom"
import { selectFile } from "./navigation"
import { populateTileInspector, drawAtlas, loadTiles, syncAtlasWorkspace, setDrawingTile } from "./tile-editing"
import { styleConfigPath, setSourceValue, scrollSelectedSource } from "./config-context"
import { IniDocument } from "../ini.ts"
import { renderBdaStyleEditor } from "../bda-editor.ts"
import { drawVisualPreview, retinaThumbnail, thumbnailRecycler } from "../atlas.ts"
import { translatedConfigLabel } from "./document-inspector"
import { refreshPreview } from "./preview-render"
import { soundPathForFilename, soundResourcePaths, SOUND_ACCEPT, isSoundPath } from "../sounds.ts"
import { addStyle, availableStyleIDs, canAddStyle, duplicateStyle, removeStyleIDs, styleKind, styleConfigDocument, styleSoundFile, styleLibraryCategories } from "./style-picker"
import { styleUsages } from "./style-references"
import { SXI_SKIN_PATH } from "../palm/sxi-json.ts"
import { asObject } from "../palm/sxi-ini.ts"
import { renderSxiGroup } from "./sxi-fields"
import { palmStyle, palmStyleImage, palmStylePointer } from "./sxi-styles"
import { palmTileSlices } from "../palm/palm-style-edit.ts"
import { openPalmSkin } from "./sxi-documents"
import { showImage, showError, showStatus } from "./file-operations"
import { updateInspectorView, updateSourceHighlight } from "./source-panel"
import { decorateStyleAnimationField, styleAnimationPlayers, styleAnimationSummary } from "./legacy-animation-inspector"
import { previewStyleAnimation } from "./animation-resource"
import { configField } from "./config-value-control"
import { field, section as sectionNode } from "./property-rows"
import { renderSoundLibrary } from "./sound-library"
import { baiduTypographyRows } from "./text-styles"
import { keySoundSample } from "./style-card-preview"
import { imageResourceCard, styleAddCard, styleCard, styleMatches, textStyleSample } from "../style-card"
import { STYLE_ANIM_FIELDS } from "../legacy-animation.ts"
import { bindListActionKeys, emptyState, listToolbar } from "../dom-element.ts"
import { releaseOnRemove } from "../dom-lifecycle.ts"
import { bindResourceCard, selectGalleryItem, syncResourceSelection } from "./resource-gallery"
import type { Change } from "../history"
import { renderResourceCatalogSearch, renderStyleFilters, resourceStyleMatchesUsage, sortResources, updateResourcePage } from "./resource-page"

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
    styleResourceDetail.hidden = appState.inspectorTab === "source"
    soundResourceDetail.hidden = true
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
    styleResourceDetail.hidden = appState.inspectorTab === "source"
    soundResourceDetail.hidden = true
    styleDetailPreviews.hidden = animated
    const resolver = visualResolver()
    if (resolver && !animated) {
      const archive = appState.archive
      const visuals = await Promise.all([false, true].map(highlighted => resolver.resolve(styleID, highlighted).catch(() => undefined)))
      if (appState.archive !== archive || appState.selectedStyleID !== styleID || styleConfigPath() !== path) return
      drawVisualPreview(retinaThumbnail(styleDetailNormal, 128, 88), [visuals[0]], false)
      drawVisualPreview(retinaThumbnail(styleDetailHighlighted, 128, 88), [visuals[1]], false)
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
  const fontKeys = ["FONT_NAME", "FONT_SIZE", "FONT_WEIGHT", "FONT_CLEARTYPE"]
  const colorKeys = ["NM_COLOR", "HL_COLOR", "BORDER_COLOR", "BORDER_SIZE"]
  const common = ["SHOW", "INFO", "PRESS_SOUND_PATH"]
  const keys = [...new Set([...common, ...STYLE_ANIM_FIELDS, ...existing.map((entry) => entry.key).filter((key) => key !== "NM_IMG" && key !== "HL_IMG")])]
  const groups = [
    ["typography", "文字"],
    ["color", "颜色"],
    ["content", "内容与说明", (key: string) => key === "SHOW" || key === "INFO"],
    ["animation", "动画", (key: string) => /ANIM|^EVENT\d+$/.test(key)],
    ["sound", "音效", (key: string) => key.endsWith("SOUND_PATH")],
    ["advanced", "边框与扩展", () => true],
  ] as const
  const groupRows = new Map<string, HTMLElement[]>(groups.map(([id]) => [id, []]))
  const files = currentSoundEntries().map((entry) => entry.filename)
  const textKeys = [...fontKeys, ...colorKeys]
  const write = (key: string, next: string) => {
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
  for (const row of baiduTypographyRows(key => [stylesDocument.get(section, key) ?? ""], write, textKeys, isEditing())) {
    const key = row.dataset.documentKey?.split(" ")[0] ?? ""
    groupRows.get(colorKeys.includes(key) ? "color" : "typography")!.push(row)
  }
  for (const key of keys) {
    if (textKeys.includes(key)) continue
    const label = translatedConfigLabel(key)
    const value = stylesDocument.get(section, key) ?? ""
    const commit = (next: string) => write(key, next)
    const options = { key, label, commit, rowKey: [path, section, key] }
    let row: HTMLElement
    if (key.endsWith("SOUND_PATH")) {
      const sample = keySoundSample(value || undefined, soundPathForFilename(archive.names(), theme.value, orientation.value, value))
      row = field({ ...options, spec: { kind: "sound", value, files, sample } })
    } else {
      // 百度配置值的类型化控件（颜色、开关……）。
      row = configField(section, key, label, value, isEditing(), commit) ?? field({ ...options, spec: { kind: "text", value } })
      decorateStyleAnimationField(row, key, value)
    }
    groupRows.get(groups.find(([, , matches]) => matches?.(key))![0])!.push(row)
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
  source.commit()
  let galleryID = `STYLE${styleID}`
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
    if (browsingResources()) galleryID = `STYLE${bdaStyleID({ type: part.group === "imageStyles" ? "image" : part.group === "textStyles" ? "text" : "color", key: Number(styleID) })}`
  } else if (!availableStyleIDs().includes(styleID)) return
  appState.selectedStyleID = styleID
  resourceListView.hidden = !document.body.classList.contains("style-workspace")
  selectGalleryItem(galleryID)
  resourceDetail.hidden = false
  resourceInspector.scrollTop = 0
  void renderStyleResourceDetail()
  updateInspectorView()
  updateSourceHighlight()
  scrollSelectedSource()
}

export function selectResourceImage(path: string): void {
  if (!appState.archive?.isImage(path)) return
  appState.selectedResourcePath = path
  appState.selectedResourceGalleryPath = path
  imageResourcePreview.hidden = true
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
  if (appState.slices.length && (document.body.classList.contains("resource-workspace") || appState.slices.length === 1 && matchMedia("(max-width: 760px) and (orientation: portrait)").matches)) {
    appState.selectedTileIndex = appState.slices[0].index
    populateTileInspector()
    drawAtlas()
  }
  syncAtlasWorkspace()
  selectGalleryItem(path)
}

/** 列表头：标题、数量角标与搜索框的名字（搜索框 placeholder 固定「搜索」）。 */
function listHeader(title: string, count: number): void {
  resourceListTitle.textContent = title
  resourceCount.textContent = String(count)
  resourceSearch.setAttribute("aria-label", `搜索${title}`)
  resourceCategory.parentElement!.hidden = true
  updateResourcePage(title, count)
}

function setUploadAction(label: string): void {
  const caption = resourceUploadButton.querySelector("span:last-child")
  if (caption) caption.textContent = label
  resourceUploadButton.setAttribute("aria-label", label)
  resourceUploadButton.removeAttribute("title")
}

function browsingResources(): boolean {
  return document.body.classList.contains("resource-workspace")
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
  const category = browsingResources() ? appState.resourceStyleType : resourceCategory.value
  // What a style says about itself: INFO / SHOW in default.css, a Palm style's text (`s_1.text`).
  const notes = (styleID: string) => stylesDocument
    ? stylesDocument.entries(`STYLE${styleID}`).filter((entry) => entry.key === "INFO" || entry.key === "SHOW").map((entry) => entry.value)
    : [String(asObject(palmStyle(styleID)?.s_1)?.text ?? "")]
  const categories = styleLibraryCategories()
  const styleIDs = sortResources(availableStyleIDs().filter((styleID) => {
    return resourceStyleMatchesUsage(styleID) && styleMatches({ kind: styleKind(styleID, stylesDocument), sound: Boolean(styleSoundFile(styleID, stylesDocument)),
      categories: categories.get(styleID) ?? [], search: [styleID, ...notes(styleID)].join(" ") }, category, appState.styleUsageFilter, query)
  }))
  listHeader("样式", styleIDs.length)
  resourceUploadButton.hidden = true
  resourceDownloadButton.hidden = true
  resourceDeleteButton.hidden = true
  soundResourceDetail.hidden = true
  resourceListView.hidden = Boolean(appState.selectedStyleID) && !document.body.classList.contains("style-workspace")
  resourceDetail.hidden = !appState.selectedStyleID
  const resolver = visualResolver()
  if (!resolver) return
  resourceGallery.setAttribute("role", "listbox")
  resourceGallery.setAttribute("aria-label", "样式")
  const editable = canAddStyle() && isEditing()
  styleListToolbar.hidden = !editable
  bindListActionKeys(resourceGallery, styleListToolbar)
  const cards = document.createDocumentFragment()
  for (const styleID of styleIDs) {
    const kind = styleKind(styleID, stylesDocument)
    const soundFilename = styleSoundFile(styleID, stylesDocument)
    const soundPath = soundFilename ? soundPathForFilename(appState.archive.names(), theme.value, orientation.value, soundFilename) : undefined
    const button = styleCard({
      id: styleID, label: `STYLE${styleID}`, kind,
      info: stylesDocument?.get(`STYLE${styleID}`, "INFO")?.trim() || undefined,
      canvas: galleryCanvas,
      draw: async (canvas, highlighted) => {
        if (kind === "text") await textStyleSample(canvas, resolver, styleID, highlighted)
        else drawVisualPreview(canvas, [await resolver.resolve(styleID, highlighted).catch(() => undefined)], false)
      },
      animation: () => stylesDocument ? styleAnimationPlayers(styleID, stylesDocument, true) : [],
      summary: kind === "anim" && stylesDocument ? styleAnimationSummary(styleID, stylesDocument) : undefined,
      sound: soundFilename ? () => keySoundSample(soundFilename, soundPath) : undefined,
    })
    button.classList.add("resource-item", "style-resource-item")
    button.dataset.path = `STYLE${styleID}`
    if (kind === "anim") button.addEventListener("mouseenter", () => previewStyleAnimation([styleID]))
    bindResourceCard(button, `STYLE${styleID}`, () => selectStyleResource(styleID), () => {
      if (document.body.classList.contains("style-workspace")) selectStyleResource(styleID)
    })
    cards.append(button)
  }
  resourceGallery.append(cards)
  if (!styleIDs.length) resourceGallery.append(emptyState(query ? "search-x" : "layers"))
  if (editable) resourceGallery.append(styleAddCard(() => {
    const id = addStyle()
    if (id) showStyle(id)
  }))
  syncResourceSelection()
  if (!appState.selectedStyleID && document.body.classList.contains("style-workspace") && styleIDs.length) selectStyleResource(styleIDs[0])
}

// 新建在网格末尾；复制与删除集中在工具条，快捷键共用同一动作。
const styleListToolbar = listToolbar({
  duplicate: { label: "复制样式", run: () => {
    const id = appState.selectedStyleID && duplicateStyle(appState.selectedStyleID)
    if (id) showStyle(id)
  } },
  remove: { label: "删除样式", run: () => {
    if (removeStyleIDs(appState.selectedResourceGalleryPaths.map(path => path.replace(/^STYLE/, "")))) renderResourceInspector()
  } },
})
styleListToolbar.hidden = true
resourceDeleteButton.parentElement!.append(styleListToolbar)
bindListActionKeys(resourceGallery, resourceDeleteButton.parentElement!)

/** 新建或复制出的样式：重画列表并选中它。 */
export function showStyle(styleID: string): void {
  appState.selectedResourceGalleryPath = `STYLE${styleID}`
  appState.selectedResourceGalleryPaths = [appState.selectedResourceGalleryPath]
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
  const desktop = browsingResources()
  renderStyleFilters(definition.type)
  resourceCategory.dataset.styleCategories = "bda"
  resourceCategory.replaceChildren(...bdaAppearanceStyleGroups.map(([value, label]) => new Option(label, value)))
  resourceCategory.value = part.group
  const query = resourceSearch.value.trim().toLowerCase()
  const categories = styleLibraryCategories()
  const entries = sortResources((desktop ? Object.values(definitions) : [definition]).flatMap(({ type, styles }) =>
    [...styles.keys()].map(key => ({ type, key }))).filter(ref => styleMatches({ kind: ref.type, categories: categories.get(bdaStyleID(ref)) ?? [], search: String(ref.key) }, desktop ? appState.resourceStyleType : "all", appState.styleUsageFilter, query)), ref => String(ref.key))
  listHeader("样式", entries.length)
  resourceUploadButton.hidden = true
  resourceGallery.setAttribute("role", "listbox")
  resourceGallery.setAttribute("aria-label", "样式")
  resourceDownloadButton.hidden = true
  resourceDeleteButton.hidden = true
  soundResourceDetail.hidden = true
  resourceListView.hidden = Boolean(appState.selectedStyleID) && !document.body.classList.contains("style-workspace")
  resourceDetail.hidden = !appState.selectedStyleID
  const resolver = visualResolver()
  const cards = document.createDocumentFragment()
  const choose = (ref: BdaStyleRef) => {
    const group = ref.type === "image" ? "imageStyles" : ref.type === "text" ? "textStyles" : "colorStyles"
    if (group !== part.group) {
      appState.selectedBdaStyleGroup = group
      selectFile(bdaAppearanceStylePath(group), "overview", "style")
    }
    selectStyleResource(String(ref.key))
  }
  for (const ref of entries) {
    const button = styleCard({
      id: bdaStyleID(ref), label: `STYLE ${ref.key}`, kind: ref.type,
      canvas: galleryCanvas,
      draw: async (canvas, highlighted) => {
        if (ref.type === "text" && resolver) await textStyleSample(canvas, resolver, bdaStyleID(ref), highlighted)
        else drawVisualPreview(canvas, [await resolver?.resolve(bdaStyleID(ref), highlighted).catch(() => undefined)], false)
      },
    })
    button.classList.add("resource-item", "style-resource-item")
    bindResourceCard(button, `STYLE${desktop ? bdaStyleID(ref) : ref.key}`, () => choose(ref), () => {
      if (document.body.classList.contains("style-workspace")) choose(ref)
    })
    cards.append(button)
  }
  resourceGallery.append(cards)
  if (!entries.length) resourceGallery.append(emptyState(query ? "search-x" : "layers"))
  syncResourceSelection()
  if (!appState.selectedStyleID && document.body.classList.contains("style-workspace") && entries.length) choose(entries[0])
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
  const desktop = browsingResources()
  listHeader("音效", entries.length)
  resourceUploadInput.accept = SOUND_ACCEPT
  resourceUploadButton.hidden = !desktop
  if (desktop) setUploadAction("添加")
  resourceDownloadButton.hidden = true
  resourceDownloadButton.title = "下载选中按键音效"
  resourceDownloadButton.setAttribute("aria-label", resourceDownloadButton.title)
  resourceDeleteButton.hidden = true
  resourceRenameButton.hidden = true
  resourceListView.hidden = false
  imageResourceDetail.hidden = true
  styleResourceDetail.hidden = true
  renderSoundLibrary(entries, updateResourceActionButtons, desktop ? soundResourceDetail : undefined)
  soundResourceDetail.hidden = !desktop
  resourceDetail.hidden = !desktop
}

export function renderResourceInspector(): void {
  if (!appState.archive) return
  if (renderResourceCatalogSearch()) return
  syncAtlasWorkspace()
  const galleryCanvas = thumbnailRecycler(resourceGallery)
  const styleFilters = resourceListView.querySelector<HTMLElement>(".ui-style-filter-bar")
  if (styleFilters) styleFilters.hidden = appState.resourceInspectorMode !== "style"
  resourceGallery.replaceChildren()
  delete resourceGallery.dataset.kind
  resourceGallery.removeAttribute("role")
  styleListToolbar.hidden = true
  resourceRenameButton.hidden = appState.resourceInspectorMode !== "image"
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
  setUploadAction("上传")
  soundResourceDetail.hidden = true
  resourceDownloadButton.hidden = false
  resourceDownloadButton.title = "下载选中图片"
  resourceDownloadButton.setAttribute("aria-label", resourceDownloadButton.title)
  resourceDeleteButton.hidden = false
  resourceDeleteButton.title = "删除选中图片"
  resourceDeleteButton.setAttribute("aria-label", resourceDeleteButton.title)
  const query = resourceSearch.value.trim().toLowerCase()
  const paths = sortResources(pickableImagePaths()
    .filter((path) => !query || path.toLowerCase().includes(query)))
  listHeader("图片", paths.length)
  const browsing = browsingResources()
  resourceListView.hidden = Boolean(appState.selectedResourcePath) && !browsing
  resourceDetail.hidden = !appState.selectedResourcePath && !browsing
  const archive = appState.archive
  const cards = document.createDocumentFragment()
  for (const path of paths) {
    let url: string | undefined
    const button = imageResourceCard({
      path,
      load: async () => {
        const bytes = archive.getBytes(path)
        if (!bytes) return
        return url ??= URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "image/png" }))
      },
      til: archive.isText(path.replace(/\.png$/i, ".til")),
      slices: archive.format === "sxi" ? palmTileSlices(openPalmSkin(), path).length : undefined,
    })
    releaseOnRemove(button.querySelector("img")!, () => { if (url) URL.revokeObjectURL(url) })
    bindResourceCard(button, path, () => selectResourceImage(path))
    cards.append(button)
  }
  resourceGallery.append(cards)
  if (!paths.length) resourceGallery.append(emptyState(query ? "search-x" : "image-off"))
  resourceGallery.setAttribute("role", "listbox")
  resourceGallery.setAttribute("aria-label", "图片")
  if (browsing && !appState.selectedResourceGalleryPath && paths[0]) {
    appState.selectedResourceGalleryPaths = [paths[0]]
    appState.selectedResourceGalleryPath = paths[0]
    appState.resourceSelectionAnchor = paths[0]
  }
  syncResourceSelection()
  bindListActionKeys(resourceGallery, resourceSelectionActions)
  updateResourceActionButtons()
  syncAtlasWorkspace()
  if (browsingResources()) {
    if (appState.selectedResourceGalleryPath) showImageBrowser(appState.selectedResourceGalleryPath)
    else clearImageBrowser()
  }
}

resourceGallery.addEventListener("resource-selection-change", () => {
  if (appState.resourceInspectorMode !== "image" || !browsingResources()) return
  if (appState.selectedResourceGalleryPath) showImageBrowser(appState.selectedResourceGalleryPath)
  else clearImageBrowser()
})

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
  appState.selectedResourcePath = ""
  hideImageWorkspace()
  appState.movingTile = undefined
  appState.selectedTileIndex = undefined
  if (appState.selectedDocument) setSourceValue(appState.selectedDocument.toString())
  sourceName.textContent = appState.selectedPath
  populateTileInspector()
  syncAtlasWorkspace()
  if (appState.resourceInspectorMode === "image" && browsingResources()) {
    if (appState.selectedResourceGalleryPath) showImageBrowser(appState.selectedResourceGalleryPath)
    else clearImageBrowser()
  }
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
  const selected = appState.selectedResourceGalleryPaths
  const imageSelected = appState.resourceInspectorMode === "image" && selected.length > 0
  const soundSelected = appState.resourceInspectorMode === "sound"
    && selected.some(path => currentSoundEntries().some(entry => entry.id === path))
  resourceDownloadButton.disabled = !imageSelected && !soundSelected
  resourceRenameButton.disabled = !imageSelected || selected.length !== 1 || !isEditing()
  resourceDeleteButton.disabled = !imageSelected || !isEditing()
  resourceUploadButton.disabled = !isEditing()
  const styleSelected = appState.resourceInspectorMode === "style" && selected.length > 0 && isEditing() && canAddStyle()
  styleListToolbar.querySelector("button")!.disabled = !styleSelected || selected.length !== 1
  const uses = styleSelected ? selected.reduce((count, path) => count + styleUsages(path.replace(/^STYLE/, "")).length, 0) : 0
  const remove = styleListToolbar.querySelector<HTMLButtonElement>('[data-list-action="remove"]')!
  remove.disabled = !styleSelected || Boolean(uses)
  remove.title = uses ? `被 ${uses} 处引用` : "删除样式"
  syncAtlasWorkspace()
}

export async function prepareResourceImage(file: File): Promise<Extract<Change, { kind: "bytes" }> & { after: Uint8Array }> {
  const archive = appState.archive!
  const filename = file.name.split(/[\\/]/).pop() ?? ""
  if (!/^[^\u0000-\u001f]+\.png$/i.test(filename)) throw new Error("请选择 PNG 图片")
  const base = pickableImagePaths()[0]?.split("/").slice(0, -1).join("/") ?? `${theme.value}/skin/res`
  const path = `${base}/${filename}`
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71) throw new Error("图片不是有效的 PNG 文件")
  const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }))
  bitmap.close()
  return { kind: "bytes", path, before: archive.getBytes(path)?.slice(), after: bytes }
}

export async function uploadResourceImage(file: File): Promise<string | undefined> {
  const archive = appState.archive
  if (!archive || !isEditing()) return
  const change = await prepareResourceImage(file)
  if (appState.archive !== archive || !isEditing()) return
  commitBytes(change.path, change.before, change.after)
  updateDirty()
  return change.path
}

export async function uploadKeySound(file: File, replacePath?: string): Promise<boolean> {
  if (!appState.archive || !isSoundPath(file.name)) throw new Error("按键音效仅支持 OGG、WAV、AIFF 或 MP3 文件")
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
  appState.selectedResourceGalleryPaths = [appState.selectedSoundID]
  appState.selectedResourceGalleryPath = appState.selectedSoundID
  renderResourceInspector()
  updateDirty()
  showStatus(`按键音效文件已更新：${filename}`)
  return true
}
