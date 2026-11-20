import { confirmDeletion } from "./ask"
import { showImageBrowser, clearImageBrowser } from "./resource-image-preview"
import { type StyleImagePickerTarget, type SoundEntry } from "./types"
import { appState } from "./state"
import { source, mobilePortraitQuery, keySoundBuffers, releaseKeySound } from "./canvas-interaction"
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
import { parseColor, retinaThumbnail, thumbnailRecycler } from "../atlas.ts"
import { paintLayerOf } from "../paint/panel.ts"
import { paintLayerPreview } from "../paint/layer.ts"
import { styleText } from "../skin-model/style.ts"
import type { SkinModel } from "../skin-model/model.ts"
import { skinModel } from "./skin-model-state"
import { argbColor } from "../native-scene.ts"
import { translatedConfigLabel } from "./document-inspector"
import { refreshPreview } from "./preview-render"
import { soundPathForFilename, soundResourcePaths, SOUND_ACCEPT, isSoundPath } from "../sounds.ts"
import { addStyle, availableStyleIDs, canAddStyle, duplicateStyle, removeStyleIDs, styleKind, styleConfigDocument, styleSoundFile, styleLibraryCategories } from "./style-picker"
import { styleUsages } from "./style-references"
import { SXI_SKIN_PATH } from "../palm/sxi-json.ts"
import { asObject } from "../palm/sxi-ini.ts"
import { PALM_ANIMATION_EVENTS } from "../palm/sxi-animation.ts"
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
import { appendResourceCards, clearResourceWindow } from "./resource-grid-window"
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

export function replaceBdaStyleImage(ref: BdaStyleRef, highlighted: boolean): void {
  if (ref.type !== "image" || !isEditing()) return
  const archive = appState.archive
  const path = currentBdaAppearance()?.path
  openImageResourceChooser(resourceID => {
    if (appState.archive !== archive || currentBdaAppearance()?.path !== path || !isEditing()) return
    const property = highlighted ? "HL_IMG" : "NM_IMG"
    if (updateBdaRefs([ref], property, resourceID) && appState.resourceConfigActive) void renderStyleResourceDetail()
  })
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
  const { selectedPath, selectedStyleID, styleReturnPath, styleReturnCandidate } = appState
  selectFile(info.path, "overview", "image")
  appState.bdaSliceReturn = { path: selectedPath, styleID: selectedStyleID, styleReturnPath, styleReturnCandidate }
  selectResourceImage(path)
  appState.selectedTileIndex = appState.bdaTileUsages.find((usage) =>
    usage.ref.type === ref.type && usage.ref.key === ref.key && usage.highlighted === highlighted)?.index
    ?? appState.selectedTileIndex
  populateTileInspector()
  drawAtlas()
}

export function chooseStyleImageSlice(property: "NM_IMG" | "HL_IMG"): void {
  if (styleDetailPreviews.hidden) return
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


const isStyleAnimationField = (key: string) => STYLE_ANIM_FIELDS.some(field => field === key) || /^(?:HOLD_ANIM|EVENT\d+)$/.test(key)

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
  const stylesDocument = palm ? undefined : styleConfigDocument()
  if (!styleID || !stylesDocument && !palm) return
  const section = `STYLE${styleID}`
  const existing = stylesDocument?.entries(section) ?? []
  const model = palm ? palmStyle(styleID) : undefined
  const palmEvents = asObject(model?.s_5)
  const hasOtherFields = palm
    ? Object.keys(model ?? {}).some(key => key !== "id" && key !== "f" && key !== "s_5")
    : existing.some(({ key, value }) => key !== "INFO" && !isStyleAnimationField(key) && value.trim())
  // 旧皮肤即使同时带图或颜色，也只在属性检查器中编辑动画；原字段不动。
  const animated = Boolean(embedded) || (palm
    ? Boolean(palmEvents && (!hasOtherFields || Object.keys(palmEvents).length))
    : existing.some(({ key, value }) => isStyleAnimationField(key) && (!hasOtherFields || value.trim())))
  if (!embedded) {
    resourceName.textContent = section
    resourceMeta.textContent = palm ? `${SXI_SKIN_PATH} · ${palm.join(".")}` : path
    imageResourceDetail.hidden = true
    styleResourceDetail.hidden = appState.inspectorTab === "source"
    soundResourceDetail.hidden = true
    styleDetailPreviews.hidden = animated
    const model = skinModel.model
    if (model && !animated) {
      const archive = appState.archive
      const paints = await Promise.all([false, true].map(highlighted => paintLayerOf(model, styleID, highlighted)))
      if (appState.archive !== archive || appState.selectedStyleID !== styleID || styleConfigPath() !== path) return
      paintLayerPreview(retinaThumbnail(styleDetailNormal, 128, 88), paints[0], false)
      paintLayerPreview(retinaThumbnail(styleDetailHighlighted, 128, 88), paints[1], false)
    }
  }
  if (palm) {
    const target = animated ? [...palm, "s_5"] : palm
    const group = renderSxiGroup(animated ? "动画" : "样式", [{
      targets: [target],
      only: animated ? PALM_ANIMATION_EVENTS.map(([key]) => key) : undefined,
      omit: !animated && hasOtherFields ? ["s_5"] : undefined,
    }], { code: target.slice(1).join(".") })
    fieldsHost.replaceChildren(...group ? [group] : [])
    return
  }
  if (!stylesDocument) return
  const archive = appState.archive!
  fieldsHost.replaceChildren(...animated && !embedded ? styleAnimationPlayers(styleID, stylesDocument) : [])
  const fontKeys = ["FONT_NAME", "FONT_SIZE", "FONT_WEIGHT", "FONT_CLEARTYPE"]
  const colorKeys = ["NM_COLOR", "HL_COLOR", "BORDER_COLOR", "BORDER_SIZE"]
  const common = ["SHOW", "INFO", "PRESS_SOUND_PATH"]
  const keys = [...new Set([...common, ...STYLE_ANIM_FIELDS, ...existing.map(({ key }) => key)])]
    .filter(key => animated ? isStyleAnimationField(key) : key !== "NM_IMG" && key !== "HL_IMG" && (!hasOtherFields || !isStyleAnimationField(key)))
  const groups = [
    ["typography", "文字"],
    ["color", "颜色"],
    ["content", "内容与说明", (key: string) => key === "SHOW" || key === "INFO"],
    ["animation", "动画", isStyleAnimationField],
    ["sound", "音效", (key: string) => key.endsWith("SOUND_PATH")],
    ["advanced", "边框与扩展", () => true],
  ] as const
  const groupRows = new Map<string, HTMLElement[]>(groups.map(([id]) => [id, []]))
  const files = animated ? [] : currentSoundEntries().map((entry) => entry.filename)
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
  if (!animated) {
    for (const row of baiduTypographyRows(key => [stylesDocument.get(section, key) ?? ""], write, textKeys, isEditing())) {
      const key = row.dataset.documentKey?.split(" ")[0] ?? ""
      groupRows.get(colorKeys.includes(key) ? "color" : "typography")!.push(row)
    }
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
    if (usesResourceStyleCategories()) galleryID = `STYLE${bdaStyleID({ type: part.group === "imageStyles" ? "image" : part.group === "textStyles" ? "text" : "color", key: Number(styleID) })}`
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

function usesResourceStyleCategories(): boolean {
  return browsingResources() || mobilePortraitQuery.matches
}

function sameTextPreview(model: SkinModel, id: string): boolean {
  return JSON.stringify(styleText(model, id, false)) === JSON.stringify(styleText(model, id, true))
}

function sameStylePreview(id: string, styles: IniDocument | undefined): boolean {
  const imageRef = (value: unknown) => typeof value === "string" ? value.trim().replace(/\s*,\s*/g, ",") : undefined
  if (styles) {
    const section = `STYLE${id}`
    const normal = styles.get(section, "NM_IMG")
    const color = styles.get(section, "NM_COLOR")
    return imageRef(normal) === imageRef(styles.get(section, "HL_IMG") ?? normal)
      && parseColor(color)?.toLowerCase() === parseColor(styles.get(section, "HL_COLOR") ?? color)?.toLowerCase()
  }
  const style = palmStyle(id)
  const image = asObject(style?.s_2)
  const fill = asObject(style?.s_1)
  return imageRef(image?.normal) === imageRef(image?.hl ?? image?.normal)
    && (fill?.for_back !== true || argbColor(fill.c_normal)?.toLowerCase() === argbColor(fill.c_hl ?? fill.c_normal)?.toLowerCase())
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
  const category = usesResourceStyleCategories() ? appState.resourceStyleType : resourceCategory.value
  // What a style says about itself: INFO / SHOW in default.css, a Palm style's text (`s_1.text`).
  const notes = (styleID: string) => stylesDocument
    ? stylesDocument.entries(`STYLE${styleID}`).filter((entry) => entry.key === "INFO" || entry.key === "SHOW").map((entry) => entry.value)
    : [String(asObject(palmStyle(styleID)?.s_1)?.text ?? "")]
  const categories = appState.styleUsageFilter !== "all" ? styleLibraryCategories() : undefined
  const styleIDs = sortResources(availableStyleIDs().filter((styleID) => {
    return resourceStyleMatchesUsage(styleID) && styleMatches({ kind: category === "all" ? "all" : styleKind(styleID, stylesDocument), sound: category === "sound" && Boolean(styleSoundFile(styleID, stylesDocument)),
      categories: categories?.get(styleID) ?? [], search: query ? [styleID, ...notes(styleID)].join(" ") : "" }, category, appState.styleUsageFilter, query)
  }))
  listHeader("样式", styleIDs.length)
  resourceUploadButton.hidden = true
  resourceDownloadButton.hidden = true
  resourceDeleteButton.hidden = true
  soundResourceDetail.hidden = true
  resourceListView.hidden = Boolean(appState.selectedStyleID) && !document.body.classList.contains("style-workspace")
  resourceDetail.hidden = !appState.selectedStyleID
  const model = skinModel.model
  if (!model) return
  resourceGallery.setAttribute("role", "listbox")
  resourceGallery.setAttribute("aria-label", "样式")
  const editable = canAddStyle() && isEditing()
  styleListToolbar.hidden = !editable
  const names = appState.archive.names()
  appendResourceCards(styleIDs.map(id => `STYLE${id}`), index => {
    const styleID = styleIDs[index]
    const kind = styleKind(styleID, stylesDocument)
    const soundFilename = styleSoundFile(styleID, stylesDocument)
    const soundPath = soundFilename ? soundPathForFilename(names, theme.value, orientation.value, soundFilename) : undefined
    const button = styleCard({
      id: styleID, label: `STYLE${styleID}`, kind,
      stateLayout: (kind === "text" ? sameTextPreview(model, styleID) : sameStylePreview(styleID, stylesDocument)) ? "single" : "joined",
      info: stylesDocument?.get(`STYLE${styleID}`, "INFO")?.trim() || undefined,
      canvas: galleryCanvas,
      draw: async (canvas, highlighted) => {
        if (kind === "text") await textStyleSample(canvas, model, styleID, highlighted)
        else paintLayerPreview(canvas, await paintLayerOf(model, styleID, highlighted))
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
    return button
  }, editable ? styleAddCard(() => {
    const id = addStyle()
    if (id) showStyle(id)
  }) : undefined)
  if (!styleIDs.length) resourceGallery.prepend(emptyState(query ? "search-x" : "layers"))
  syncResourceSelection()
  if (!appState.selectedStyleID && document.body.classList.contains("style-workspace") && styleIDs.length) selectStyleResource(styleIDs[0])
}

// 新建在网格末尾；复制与删除集中在工具条，快捷键共用同一动作。
const styleListToolbar = listToolbar({
  duplicate: { label: "复制样式", run: () => {
    const id = appState.selectedStyleID && duplicateStyle(appState.selectedStyleID)
    if (id) showStyle(id)
  } },
  remove: { label: "删除样式", run: async () => {
    const archive = appState.archive
    const revision = archive?.revision
    const ids = appState.selectedResourceGalleryPaths.map(path => path.replace(/^STYLE/, ""))
    if (!ids.length || !await confirmDeletion(`删除 ${ids.length} 个样式？`) || appState.archive !== archive || archive?.revision !== revision) return
    if (removeStyleIDs(ids)) renderResourceInspector()
  } },
})
styleListToolbar.hidden = true
resourceSelectionActions.append(styleListToolbar)
bindListActionKeys(resourceGallery, resourceSelectionActions)

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
  const sharedCategories = usesResourceStyleCategories()
  renderStyleFilters(definition.type)
  resourceCategory.dataset.styleCategories = "bda"
  resourceCategory.replaceChildren(...bdaAppearanceStyleGroups.map(([value, label]) => new Option(label, value)))
  resourceCategory.value = part.group
  const query = resourceSearch.value.trim().toLowerCase()
  const categories = appState.styleUsageFilter !== "all" ? styleLibraryCategories() : undefined
  const entries = sortResources((sharedCategories ? Object.values(definitions) : [definition]).flatMap(({ type, styles }) =>
    [...styles.keys()].map(key => ({ type, key }))).filter(ref => styleMatches({ kind: ref.type, categories: categories?.get(bdaStyleID(ref)) ?? [], search: String(ref.key) }, sharedCategories ? appState.resourceStyleType : "all", appState.styleUsageFilter, query)), ref => String(ref.key))
  listHeader("样式", entries.length)
  resourceUploadButton.hidden = true
  resourceGallery.setAttribute("role", "listbox")
  resourceGallery.setAttribute("aria-label", "样式")
  resourceDownloadButton.hidden = true
  resourceDeleteButton.hidden = true
  soundResourceDetail.hidden = true
  resourceListView.hidden = Boolean(appState.selectedStyleID) && !document.body.classList.contains("style-workspace")
  resourceDetail.hidden = !appState.selectedStyleID
  const model = skinModel.model
  const choose = (ref: BdaStyleRef) => {
    const group = ref.type === "image" ? "imageStyles" : ref.type === "text" ? "textStyles" : "colorStyles"
    if (group !== part.group) {
      appState.selectedBdaStyleGroup = group
      selectFile(bdaAppearanceStylePath(group), "overview", "style")
    }
    selectStyleResource(String(ref.key))
  }
  appendResourceCards(entries.map(ref => `STYLE${sharedCategories ? bdaStyleID(ref) : ref.key}`), index => {
    const ref = entries[index]
    const image = info.appearance.imageStyles.get(ref.key)
    const color = info.appearance.colorStyles.get(ref.key)
    const id = bdaStyleID(ref)
    const merged = ref.type === "text" ? Boolean(model && sameTextPreview(model, id))
      : ref.type === "image" ? JSON.stringify(image?.normalImage) === JSON.stringify(image?.highlightImage ?? image?.normalImage)
      : (color?.normalColor ?? 0) === (color?.highlightColor ?? color?.normalColor ?? 0)
    const button = styleCard({
      id, label: `STYLE ${ref.key}`, kind: ref.type,
      stateLayout: merged ? "single" : "joined",
      canvas: galleryCanvas,
      draw: async (canvas, highlighted) => {
        if (!model) return
        if (ref.type === "text") await textStyleSample(canvas, model, id, highlighted)
        else paintLayerPreview(canvas, await paintLayerOf(model, id, highlighted))
      },
    })
    button.classList.add("resource-item", "style-resource-item")
    bindResourceCard(button, `STYLE${sharedCategories ? bdaStyleID(ref) : ref.key}`, () => choose(ref), () => {
      if (document.body.classList.contains("style-workspace")) choose(ref)
    })
    return button
  })
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
  clearResourceWindow()
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
  appendResourceCards(paths, index => {
    const path = paths[index]
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
    return button
  })
  if (!paths.length) resourceGallery.append(emptyState(query ? "search-x" : "image-off"))
  resourceGallery.setAttribute("role", "listbox")
  resourceGallery.setAttribute("aria-label", "图片")
  if (browsing && !appState.selectedResourceGalleryPath && paths[0]) {
    appState.selectedResourceGalleryPaths = [paths[0]]
    appState.selectedResourceGalleryPath = paths[0]
    appState.resourceSelectionAnchor = paths[0]
  }
  syncResourceSelection()
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
