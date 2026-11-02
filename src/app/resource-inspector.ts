import { type StyleImagePickerTarget, type SoundEntry } from "./types"
import { appState } from "./state"
import { playSoundPath, resourceSearchControl, source, keySoundBuffers, releaseKeySound } from "./canvas-interaction"
import { openImagePickerList, openImageSlicePicker, pickableImagePaths } from "./image-pickers"
import { type BdaStyleRef, bdaStyleID } from "../bda.ts"
import { updateBdaRefs } from "./key-inspector"
import { isEditing, commitText, updateDirty, commitBytes } from "./edit-history"
import { currentBdaAppearance, bdaAppearancePart, visualResolver, bdaAppearanceStyleGroups } from "./bda-documents"
import { resourceImagePaths } from "../resources.ts"
import { theme, orientation, resourceName, resourceMeta, imageResourceDetail, styleResourceDetail, styleDetailPreviews, styleDetailFields, styleDetailNormal, styleDetailHighlighted, resourceListView, resourceDetail, resourceInspector, tileModeButtons, resourceGallery, resourceCategory, resourceSearch, resourceListTitle, resourceCount, resourceUploadButton, styleAddButton, resourceDownloadButton, resourceDeleteButton, resourceUploadInput, sourceName, atlasCanvas, assetImage, workspaceImageError, workspaceImageFigure, deviceShell, sourceEditor } from "./dom"
import { selectFile } from "./navigation"
import { populateTileInspector, drawAtlas, loadTiles, syncAtlasWorkspace, bdaImageUsageCounts, bdaImageResourceID, setDrawingTile } from "./tile-editing"
import { styleConfigPath, setSourceValue, scrollSelectedSource } from "./config-context"
import { IniDocument } from "../ini.ts"
import { renderBdaStyleEditor } from "../bda-editor.ts"
import { drawVisualPreview, retinaThumbnail, thumbnailRecycler } from "../atlas.ts"
import { translatedConfigLabel } from "./document-inspector"
import { refreshPreview } from "./preview-render"
import { soundPathForFilename, soundResourcePaths, SOUND_ACCEPT, isSoundPath } from "../sounds.ts"
import { symbolSpan } from "../icons"
import { availableStyleIDs, styleKinds, styleKind, styleConfigDocument, styleSoundFile, styleLibraryCategories } from "./style-picker"
import { SXI_SKIN_PATH } from "../palm/sxi-json.ts"
import { asObject } from "../palm/sxi-ini.ts"
import { renderSxiGroup } from "./sxi-fields"
import { palmStyle, palmStyleImage, palmStylePointer } from "./sxi-styles"
import { palmTileSlices } from "../palm/palm-style-edit.ts"
import { openPalmSkin } from "./sxi-documents"
import { showImage, showError, showStatus } from "./file-operations"
import { updateSourceHighlight } from "./source-panel"
import { styleAnimationLinks, styleAnimationPlayers, styleAnimationSummary } from "./legacy-animation-inspector"
import { previewStyleAnimation } from "./animation-resource"
import { configValueControl } from "./config-value-control"
import { colorValueControl } from "./color-control"
import { renderSoundLibrary } from "./sound-library"
import { soundStyleSample } from "./style-card-preview"
import { styleCard, styleMatches, styleTypeOptions, styleUsageOptions, textStyleSample } from "../style-card"

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


export async function renderStyleResourceDetail(): Promise<void> {
  const appearancePart = bdaAppearancePart(appState.selectedPath)
  const appearanceInfo = currentBdaAppearance()
  if (appState.archive?.format === "bda" && appearancePart?.kind === "styles" && appearanceInfo && appState.selectedStyleID) {
    const type = appearancePart.group === "imageStyles" ? "image" : appearancePart.group === "textStyles" ? "text" : "color"
    const ref: BdaStyleRef = { type, key: Number(appState.selectedStyleID) }
    resourceName.textContent = `STYLE ${appState.selectedStyleID}`
    resourceMeta.textContent = appearancePart.group
    imageResourceDetail.hidden = true
    styleResourceDetail.hidden = false
    styleDetailPreviews.hidden = true
    renderBdaStyleEditor(styleDetailFields, {
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
  const palm = appState.archive?.format === "sxi" ? palmStylePointer(appState.selectedStyleID) : undefined
  if (!appState.archive?.isText(path) && !palm || !appState.selectedStyleID) return
  const section = `STYLE${appState.selectedStyleID}`
  resourceName.textContent = section
  resourceMeta.textContent = palm ? `${SXI_SKIN_PATH} · ${palm.join(".")}` : path
  imageResourceDetail.hidden = true
  styleResourceDetail.hidden = false
  const animated = !palm && styleKind(appState.selectedStyleID) === "anim"
  styleDetailPreviews.hidden = animated
  const resolver = visualResolver()
  if (resolver && !animated) {
    drawVisualPreview(retinaThumbnail(styleDetailNormal, 128, 88), [await resolver.resolve(appState.selectedStyleID, false).catch(() => undefined)], false)
    drawVisualPreview(retinaThumbnail(styleDetailHighlighted, 128, 88), [await resolver.resolve(appState.selectedStyleID, true).catch(() => undefined)], false)
  }
  // A Palm style is shown as its skin.json model, the way the Palm inspector shows every part.
  if (palm) {
    const group = renderSxiGroup("样式", [{ targets: [palm] }], { code: palm.slice(1).join(".") })
    styleDetailFields.replaceChildren(...group ? [group] : [])
    return
  }
  const archive = appState.archive!
  const stylesDocument = IniDocument.parse(archive.getText(path))
  // 动画样式在原来的正常 / 按下预览处播放它的动画，也不列出它没有的颜色、字体等外观字段。
  styleDetailFields.replaceChildren(...animated ? styleAnimationPlayers(appState.selectedStyleID, stylesDocument) : [])
  const existing = stylesDocument.entries(section)
  const common = animated ? [] : ["NM_COLOR", "HL_COLOR", "FONT_NAME", "FONT_SIZE", "SHOW", "INFO"]
  const keys = [...common, ...existing.map((entry) => entry.key).filter((key) => !common.includes(key) && key !== "NM_IMG" && key !== "HL_IMG")]
  const groups = [
    ["colors", "状态颜色", (key: string) => key === "NM_COLOR" || key === "HL_COLOR"],
    ["typography", "字体", (key: string) => key.startsWith("FONT_")],
    ["content", "内容与说明", (key: string) => key === "SHOW" || key === "INFO"],
    ["animation", "动画", (key: string) => /ANIM|^EVENT\d+$/.test(key)],
    ["advanced", "边框与扩展", () => true],
  ] as const
  const groupFields = new Map(groups.map(([id]) => [id, document.createElement("div")]))
  for (const fields of groupFields.values()) fields.className = "style-detail-group-fields"
  for (const key of keys) {
    const label = document.createElement("label")
    label.className = "style-detail-field"
    const caption = document.createElement("span")
    caption.textContent = translatedConfigLabel(key)
    caption.title = key
    // 没有中文译名的键（FONT_CLEARTYPE 等）按技术名排版，避免看起来像缺了一半的标签。
    caption.classList.toggle("style-detail-key-raw", caption.textContent === key)
    const row = document.createElement("span")
    row.className = "style-detail-field-row"
    const updateField = (value: string) => {
      if (!appState.archive?.isText(path)) return
      const current = IniDocument.parse(appState.archive.getText(path))
      const before = current.toString()
      if (!current.set(section, key, value)) return
      commitText(path, before, current.toString())
      setSourceValue(current.toString())
      refreshPreview()
      void renderStyleResourceDetail()
      updateDirty()
    }
    if (key.endsWith("COLOR")) {
      const textInput = document.createElement("input")
      textInput.value = stylesDocument.get(section, key) ?? ""
      textInput.disabled = !isEditing()
      textInput.addEventListener("change", () => updateField(textInput.value))
      row.append(colorValueControl(textInput, translatedConfigLabel(key)))
    } else if (key.endsWith("SOUND_PATH")) {
      const filename = stylesDocument.get(section, key) ?? ""
      const soundPaths = currentSoundEntries()
      const soundPath = soundPathForFilename(archive.names(), theme.value, orientation.value, filename)
      const card = document.createElement("span")
      card.className = "style-detail-sound-card"
      const playButton = document.createElement("button")
      playButton.type = "button"
      playButton.className = "style-detail-sound-play"
      playButton.disabled = !soundPath
      playButton.title = soundPath ? `播放 ${filename}` : "当前声音文件不存在"
      playButton.setAttribute("aria-label", playButton.title)
      playButton.append(symbolSpan("play.fill"))
      playButton.addEventListener("click", () => {
        if (soundPath) playSoundPath(soundPath)
      })
      const select = document.createElement("select")
      select.disabled = !isEditing()
      select.setAttribute("aria-label", `选择 ${key} 声音文件`)
      if (filename && !soundPaths.some((entry) => entry.filename === filename)) {
        select.append(new Option(`${filename}（文件不存在）`, filename))
      }
      select.append(new Option("不使用声音", ""))
      for (const entry of soundPaths) select.append(new Option(entry.filename, entry.filename))
      select.value = filename
      select.addEventListener("change", () => updateField(select.value))
      card.append(playButton, select)
      row.append(card)
    } else {
      const input = document.createElement("input")
      input.value = stylesDocument.get(section, key) ?? ""
      input.disabled = !isEditing()
      input.addEventListener("change", () => updateField(input.value))
      input.setAttribute("aria-label", translatedConfigLabel(key))
      if (["FONT_SIZE", "BORDER_SIZE"].includes(key) && /^-?\d+(?:\.\d+)?$/.test(input.value.trim())) {
        input.type = "number"
        input.step = "any"
      }
      row.append(configValueControl(input, section, key, translatedConfigLabel(key)) ?? input)
      const links = styleAnimationLinks(key, input.value)
      if (links) row.append(links)
    }
    label.append(caption, row)
    const group = groups.find(([, , matches]) => matches(key))!
    groupFields.get(group[0])!.append(label)
  }
  for (const [id, title] of groups) {
    const fields = groupFields.get(id)!
    if (!fields.childElementCount) continue
    const fieldset = document.createElement("fieldset")
    fieldset.className = "style-detail-group"
    fieldset.dataset.styleDetailGroup = id
    const legend = document.createElement("legend")
    legend.textContent = title
    fieldset.append(legend, fields)
    styleDetailFields.append(fieldset)
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
  tileModeButtons.forEach((button) => button.classList.toggle("active", button.dataset.tileMode === appState.tileMode))
  showImage(path)
  loadTiles(path)
  syncAtlasWorkspace()
  updateResourceActionButtons()
  for (const item of resourceGallery.querySelectorAll<HTMLElement>(".resource-item")) {
    item.classList.toggle("selected", item.dataset.path === path)
  }
  resourceGallery.querySelector<HTMLElement>(`.resource-item[data-path="${CSS.escape(path)}"]`)?.scrollIntoView({ block: "nearest" })
}

function releaseResourceURLs(): void {
  for (const url of appState.resourceURLs) URL.revokeObjectURL(url)
  appState.resourceURLs = []
}

function renderStyleFilters(bdaGroup?: string): void {
  let bar = resourceListView.querySelector<HTMLElement>(".ui-style-filter-bar")
  if (!bar) {
    bar = document.createElement("span")
    bar.className = "ui-style-filter-bar"
    styleAddButton.after(bar)
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
  bar.hidden = false
  bar.replaceChildren(
    select("样式类型", bdaGroup ? styleTypeOptions.filter(([kind]) => ["image", "color", "text"].includes(kind)) : styleTypeOptions, bdaGroup ?? resourceCategory.value, value => {
      resourceCategory.value = bdaGroup ? value === "image" ? "imageStyles" : value === "text" ? "textStyles" : "colorStyles" : value
      if (bdaGroup) resourceCategory.dispatchEvent(new Event("change"))
      else renderResourceInspector()
    }),
    select("样式用途", styleUsageOptions, appState.styleUsageFilter, value => { appState.styleUsageFilter = value; renderResourceInspector() }),
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
  resourceListTitle.textContent = "样式配置"
  resourceSearch.placeholder = "搜索样式"
  resourceSearch.setAttribute("aria-label", "搜索样式")
  resourceSearchControl.setAttribute("aria-label", "搜索样式")
  resourceCategory.parentElement!.hidden = true
  resourceCount.textContent = `${styleIDs.length} 个样式`
  resourceUploadButton.hidden = true
  styleAddButton.hidden = false
  resourceDownloadButton.hidden = true
  resourceDeleteButton.hidden = true
  resourceListView.hidden = Boolean(appState.selectedStyleID) && !document.body.classList.contains("style-workspace")
  resourceDetail.hidden = !appState.selectedStyleID
  const resolver = visualResolver()
  if (!resolver) return
  for (const styleID of styleIDs) {
    const kind = styleKind(styleID, stylesDocument)
    const soundFilename = styleSoundFile(styleID, stylesDocument)
    const soundPath = soundFilename ? soundPathForFilename(appState.archive.names(), theme.value, orientation.value, soundFilename) : undefined
    const button = styleCard({
      id: styleID, label: `STYLE${styleID}`, kind, kindLabel: styleKinds[kind].label, kindIcon: styleKinds[kind].icon,
      canvas: galleryCanvas,
      draw: async (canvas, highlighted) => {
        if (kind === "text") await textStyleSample(canvas, resolver, styleID, highlighted)
        else drawVisualPreview(canvas, [await resolver.resolve(styleID, highlighted).catch(() => undefined)], false)
      },
      animation: () => stylesDocument ? styleAnimationPlayers(styleID, stylesDocument, true) : [],
      summary: stylesDocument ? styleAnimationSummary(styleID, stylesDocument) : undefined,
      sound: soundFilename ? () => soundStyleSample(soundFilename, soundPath) : undefined,
    })
    button.classList.add("resource-item", "style-resource-item")
    button.dataset.path = `STYLE${styleID}`
    button.title = `STYLE${styleID}`
    if (kind === "anim") button.addEventListener("mouseenter", () => previewStyleAnimation([styleID]))
    button.addEventListener("click", () => {
      selectGalleryItem(`STYLE${styleID}`, resourceGallery)
      if (document.body.classList.contains("style-workspace")) selectStyleResource(styleID)
    })
    button.addEventListener("dblclick", () => {
      selectGalleryItem(`STYLE${styleID}`, resourceGallery)
      selectStyleResource(styleID)
    })
    resourceGallery.append(button)
  }
  if (appState.selectedResourceGalleryPath) selectGalleryItem(appState.selectedResourceGalleryPath, resourceGallery)
  if (!appState.selectedStyleID && document.body.classList.contains("style-workspace") && styleIDs.length) selectStyleResource(styleIDs[0])
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
  resourceListTitle.textContent = "样式配置"
  resourceSearch.placeholder = "搜索样式"
  resourceSearch.setAttribute("aria-label", "搜索样式")
  resourceSearchControl.setAttribute("aria-label", "搜索样式")
  resourceCategory.parentElement!.hidden = true
  resourceCount.textContent = `${keys.length} 个样式`
  resourceUploadButton.hidden = true
  styleAddButton.hidden = true
  resourceDownloadButton.hidden = true
  resourceDeleteButton.hidden = true
  resourceListView.hidden = Boolean(appState.selectedStyleID) && !document.body.classList.contains("style-workspace")
  resourceDetail.hidden = !appState.selectedStyleID
  const resolver = visualResolver()
  for (const key of keys) {
    const ref: BdaStyleRef = { type: definition.type, key }
    const button = styleCard({
      id: bdaStyleID(ref), label: `STYLE ${key}`, kind: definition.type,
      kindLabel: styleKinds[definition.type].label, kindIcon: styleKinds[definition.type].icon,
      canvas: galleryCanvas,
      draw: async (canvas, highlighted) => {
        if (definition.type === "text" && resolver) await textStyleSample(canvas, resolver, bdaStyleID(ref), highlighted)
        else drawVisualPreview(canvas, [await resolver?.resolve(bdaStyleID(ref), highlighted).catch(() => undefined)], false)
      },
    })
    button.classList.add("resource-item", "style-resource-item")
    button.dataset.path = `STYLE${key}`
    button.title = `STYLE ${key}`
    button.addEventListener("click", () => {
      selectGalleryItem(`STYLE${key}`, resourceGallery)
      if (document.body.classList.contains("style-workspace")) selectStyleResource(String(key))
    })
    button.addEventListener("dblclick", () => selectStyleResource(String(key)))
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
  resourceListTitle.textContent = "按键音效"
  resourceSearch.placeholder = "搜索按键音效"
  resourceSearch.setAttribute("aria-label", "搜索按键音效")
  resourceSearchControl.setAttribute("aria-label", "搜索按键音效")
  resourceCategory.parentElement!.hidden = true
  resourceCount.textContent = `${entries.length} 个音效`
  resourceUploadInput.accept = SOUND_ACCEPT
  resourceUploadButton.hidden = true
  resourceUploadButton.title = appState.selectedSoundID ? "替换选中按键音效" : "添加按键音效"
  resourceUploadButton.setAttribute("aria-label", resourceUploadButton.title)
  styleAddButton.hidden = true
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
  if (appState.resourceInspectorMode === "style") {
    void renderStyleResourceGallery(galleryCanvas)
    return
  }
  if (appState.resourceInspectorMode === "sound") {
    renderSoundResourceGallery()
    return
  }
  resourceListTitle.textContent = "皮肤图片"
  resourceSearch.placeholder = "搜索图片"
  resourceSearch.setAttribute("aria-label", "搜索图片")
  resourceSearchControl.setAttribute("aria-label", "搜索图片")
  resourceCategory.parentElement!.hidden = true
  resourceUploadInput.accept = ".png,image/png"
  resourceUploadButton.hidden = false
  resourceUploadButton.title = "上传图片"
  resourceUploadButton.setAttribute("aria-label", resourceUploadButton.title)
  styleAddButton.hidden = true
  resourceDownloadButton.hidden = false
  resourceDownloadButton.title = "下载选中图片"
  resourceDownloadButton.setAttribute("aria-label", resourceDownloadButton.title)
  resourceDeleteButton.hidden = false
  const query = resourceSearch.value.trim().toLowerCase()
  const paths = pickableImagePaths()
    .filter((path) => !query || path.toLowerCase().includes(query))
  const bdaUsageCounts = appState.archive.format === "bda" ? bdaImageUsageCounts() : new Map<string, number>()
  resourceCount.textContent = `${paths.length} 张图片`
  resourceListView.hidden = Boolean(appState.selectedResourcePath) && !document.body.classList.contains("atlas-workspace")
  resourceDetail.hidden = !appState.selectedResourcePath
  for (const path of paths) {
    const bytes = appState.archive.getBytes(path)
    if (!bytes) continue
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    const url = URL.createObjectURL(new Blob([copy.buffer], { type: "image/png" }))
    appState.resourceURLs.push(url)
    const button = document.createElement("button")
    button.className = "resource-item"
    button.dataset.path = path
    button.title = path
    const image = document.createElement("img")
    image.src = url
    image.alt = ""
    const name = document.createElement("strong")
    name.textContent = path.split("/").pop() ?? path
    const meta = document.createElement("small")
    const hasTil = appState.archive.isText(path.replace(/\.png$/i, ".til"))
    const bdaUsageCount = bdaUsageCounts.get(bdaImageResourceID(path)) ?? 0
    // Sogou styles take whole images: only the size says anything about them. Palm slices are skin.json's tile maps.
    const palmSlices = appState.archive.format === "sxi" ? palmTileSlices(openPalmSkin(), path).length : 0
    meta.textContent = appState.archive.format === "bda"
      ? bdaUsageCount ? `${bdaUsageCount} 个样式引用` : "未被外观引用"
      : appState.archive.format === "ssf" ? ""
      : appState.archive.format === "sxi" ? palmSlices ? `${palmSlices} 个切片` : "无切片"
      : hasTil ? "TIL" : "无 TIL"
    image.addEventListener("load", () => {
      meta.textContent = [`${image.naturalWidth} × ${image.naturalHeight}`, meta.textContent].filter(Boolean).join(" · ")
    })
    button.append(image, name, meta)
    button.addEventListener("click", () => {
      selectGalleryItem(path, resourceGallery)
      selectResourceImage(path)
    })
    resourceGallery.append(button)
  }
  // Restore selection state after re-render
  if (appState.selectedResourceGalleryPath) {
    for (const item of resourceGallery.querySelectorAll<HTMLElement>(".resource-item")) {
      item.classList.toggle("selected", item.dataset.path === appState.selectedResourceGalleryPath)
    }
  }
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
  syncAtlasWorkspace()
}

function selectGalleryItem(path: string, container: HTMLElement): void {
  appState.selectedResourceGalleryPath = path
  for (const item of container.querySelectorAll<HTMLElement>(".resource-item")) {
    item.classList.toggle("selected", item.dataset.path === path)
    if (item.classList.contains("ui-style-card")) item.setAttribute("aria-pressed", String(item.dataset.path === path))
  }
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
