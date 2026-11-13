import { getCurrentWindow } from "@tauri-apps/api/window"
import { LogicalSize } from "@tauri-apps/api/dpi"
import { bindSlicePickerZoom, drawSlicePicker, MAX_SLICE_ZOOM, MIN_SLICE_ZOOM, pickableSlices } from "./slice-picker-canvas.ts"
import { tileSliceAt, type TilePoint, type TileSlice } from "./tiles.ts"
import { drawVisualPreview, retinaThumbnail, type Visual } from "./atlas.ts"
import { hydrateIcons } from "./icons.ts"
import { nativePickerWindow, pickerEmitter, pickerListener } from "./picker-channel.ts"
import { imageResourceCard, soundStyleSample, styleAddCard, styleCard, styleFilterButtons, styleMatches, styleTypeOptions, styleUsageOptions, textStyleSample } from "./style-card"
import { animationPlayer } from "./animation-player"
import { emptyClip, iniPreviewClip } from "./animation-preview-model"
import { SsfMotion } from "./ssf/ssf-motion"
import type { SceneLayer, SceneLayers } from "./native-scene"
import type { Rect } from "./preview-items"
import { IniDocument } from "./ini"
import type { TextVisual, VisualResolver } from "./atlas"
import { bindListActionKeys, bindListboxKeys, emptyState, hydrateShortcuts, listToolbar, searchField } from "./dom-element"

type ImagePayload = {
  path: string
  dataURL: string
  slices: TileSlice[]
  selectedIndex?: number
  editable: boolean
  styleName?: string
  styleLibrary?: boolean
}

type ResourcePayload = { path: string; dataURL: string }[]

// 位图不能跨窗口传，图片以 bitmaps 里的 data URL 传过来，由 imageKey 引用。
export type StyleLibraryVisual = Omit<Visual, "image"> & { imageKey?: string }
type LibrarySceneLayer = Exclude<SceneLayer, { kind: "image" }> | { kind: "image"; rect: Rect; visual: StyleLibraryVisual }
export type SsfLibraryAnimation = {
  text: string
  skin: string
  keys: string
  sogouWidth: number
  screenWidth: number
  board: { width: number; height: number }
  field?: string
  key?: { section: string; rect: Rect; layers: { back: LibrarySceneLayer[]; fore: LibrarySceneLayer[]; groups?: number[] }[] }
  images: Record<string, StyleLibraryVisual>
}
export type StyleLibraryPayload = {
  ssfAnimation?: SsfLibraryAnimation
  session?: string
  sliceBack: boolean
  editable: boolean
  canAdd: boolean
  imageSelection?: boolean
  soundOnly: boolean
  foreground: boolean
  bda: boolean
  kind: string
  currentID: string
  imagesCompatible: boolean
  applyToStyle?: boolean
  bitmaps: Record<string, string>
  animationText: string
  animationFiles: Record<string, number[]>
  particleVisuals: Record<string, StyleLibraryVisual | null>
  styles: {
    styleID: string
    label: string
    info?: string
    kind: string
    categories: string[]
    compatible: boolean
    imagePaths: string[]
    visuals: Array<StyleLibraryVisual | null>
    animationSections?: string[]
    summary?: string
    textVisuals?: Array<TextVisual | undefined>
    sound?: string
    soundPlayable?: boolean
    /** Places that reference it; a referenced style cannot be removed. */
    uses?: number
  }[]
  images: { path: string; categories: string[]; uses: number }[]
  sounds: { styleID: string; label?: string; filename: string; playable: boolean; uses?: number }[]
}

export type StyleLibraryPreview = {
  session: string
  styleID: string
  visuals: Array<StyleLibraryVisual | null>
  animationText?: string
  animationFiles?: Record<string, number[]>
  animationSections?: string[]
  particleVisuals: Record<string, StyleLibraryVisual | null>
}

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!
hydrateIcons()
hydrateShortcuts()
// 取色器窗口跟随系统深浅色，与主窗口一样通过 data-app-theme 切换 token。
const systemDark = matchMedia("(prefers-color-scheme: dark)")
const syncTheme = () => { document.documentElement.dataset.appTheme = systemDark.matches ? "dark" : "light" }
syncTheme()
systemDark.addEventListener("change", syncTheme)
const title = $("#picker-title")
const styleName = $("#picker-style")
const count = $("#picker-count")
const back = $("#picker-back") as HTMLButtonElement
const search = $("#resource-search") as HTMLInputElement
const searchBox = searchField({ label: "搜索", input: search, onInput: () => { if (view === "styles" || view === "resources") renderLibrary() } })
const imageView = $("#image-picker-view")
const canvas = $("#picker-canvas") as HTMLCanvasElement
const libraryView = $("#style-library-view")
const libraryGrid = $("#style-library-grid")
const libraryEmpty = $("#style-library-empty")
const libraryKinds = $("#style-library-kinds")
const libraryFilters = $("#style-library-filters")
const libraryModes = $("#style-library-modes")
const libraryPreview = $("#style-library-preview")
const libraryPreviewImage = $("#style-library-preview-image")
const libraryApply = $("#style-library-apply") as HTMLButtonElement
const libraryApplyToStyle = $("#style-library-apply-to-style") as HTMLButtonElement
const librarySlice = $("#style-library-slice") as HTMLButtonElement
// 新建在网格末尾的虚线卡，删除在卡片上；工具条只放复制（⌘D 同）。
const libraryToolbar = listToolbar({ duplicate: { label: "复制样式", run: () => { if (librarySelected?.styleID) emitLibrary("style-library-duplicate", librarySelected) } } })
const libraryDuplicate = libraryToolbar.querySelector("button")!
$(".style-library-bar").append(libraryToolbar)
bindListActionKeys(libraryGrid, libraryToolbar)
const emitMain = pickerEmitter("main", () => parent)
const onMain = pickerListener(() => parent)

let imagePayload: ImagePayload | undefined
let image: HTMLImageElement | undefined
let scale = 1
let fit = 1
let zoom = 1
let offset: TilePoint = { x: 0, y: 0 }
let resources: ResourcePayload = []
let resourcesLoaded = false
let view: "empty" | "image" | "resources" | "styles" = "empty"
let library: StyleLibraryPayload | undefined
let libraryMode: "styles" | "images" = "styles"
let libraryKind = "all"
let libraryFilter = "all"
let librarySelected: { styleID?: string; imagePath?: string } | undefined
const libraryBitmaps = new Map<string, Promise<ImageBitmap | undefined>>()
let libraryAnimations: IniDocument | undefined
const previewRequests = new Map<string, { promise: Promise<void>; done(): void }>()
const imageRequests = new Map<string, { promise: Promise<string | undefined>; done(src?: string): void }>()

async function loadLibraryStyle(style: StyleLibraryPayload["styles"][number]): Promise<void> {
  if (!library?.session) return
  let request = previewRequests.get(style.styleID)
  if (!request) {
    let done!: () => void
    const promise = new Promise<void>(resolve => { done = resolve })
    request = { promise, done }
    previewRequests.set(style.styleID, request)
    void emitMain("style-library-preview-request", { session: library.session, styleID: style.styleID })
  }
  await request.promise
}

function libraryImageURL(key: string): Promise<string | undefined> {
  if (library?.bitmaps[key]) return Promise.resolve(library.bitmaps[key])
  if (!library?.session) return Promise.resolve(undefined)
  let request = imageRequests.get(key)
  if (!request) {
    let done!: (src?: string) => void
    const promise = new Promise<string | undefined>(resolve => { done = resolve })
    request = { promise, done }
    imageRequests.set(key, request)
    void emitMain("style-library-image-request", { session: library.session, key })
  }
  return request.promise
}

/** 换视图时清空搜索（同步清除按钮）。 */
function clearSearch(): void {
  if (!search.value) return
  search.value = ""
  search.dispatchEvent(new Event("input"))
}

function setWindowTitle(text: string): void {
  if (nativePickerWindow) void getCurrentWindow().setTitle(text)
}

// 窗口高度不固定：测量页面内容高度后调整窗口高度，跟随图片大小变动（宽度保持不变）
async function fitWindowHeight(): Promise<void> {
  if (!nativePickerWindow) return
  const appWindow = getCurrentWindow()
  const [inner, outer] = await Promise.all([appWindow.innerSize(), appWindow.outerSize()])
  const scaleFactor = inner.height / window.innerHeight
  const chrome = (outer.height - inner.height) / scaleFactor
  // documentElement.scrollHeight 不小于视口高度，窗口只会变大不会缩小，所以量 body
  // 画布区域铺满窗口并内部滚动，按画布本身（加内边距）算内容高度
  const content = $(".picker-toolbar").offsetHeight + Math.max(300, canvas.offsetHeight + 32)
  void appWindow.setSize(new LogicalSize(outer.width / scaleFactor, Math.ceil(content + chrome)))
}

function drawImage(): void {
  if (!image?.naturalWidth || !imagePayload) return
  // 切片框颜色读 token（强调色 / 危险色），随主题变化。
  const tokens = getComputedStyle(document.documentElement)
  const colors = { normal: tokens.getPropertyValue("--accent").trim(), selected: tokens.getPropertyValue("--state-danger").trim() }
  scale = drawSlicePicker(canvas, image, pickableSlices(imagePayload.slices, image), imagePayload.selectedIndex, fit * zoom, colors)
  offset = { x: 0, y: 0 }
}

function showEmptyView(): void {
  view = "empty"
  imageView.hidden = true
  libraryView.hidden = true
  searchBox.hidden = true
  back.hidden = true
  styleName.hidden = true
  count.hidden = true
}

function showSliceView(): void {
  view = "image"
  imageView.hidden = false
  libraryView.hidden = true
  searchBox.hidden = true
  back.hidden = !imagePayload
  back.title = imagePayload?.styleLibrary ? "返回全部样式" : "返回全部图片"
  if (imagePayload) title.textContent = imagePayload.path.split("/").pop() ?? imagePayload.path
  styleName.hidden = !styleName.textContent
  count.hidden = true
  setWindowTitle("图片切片")
}

/** 为样式或切片选一张图片：和「全部图片」同一个网格，单击即选中，选完由主窗口决定切图还是关窗。 */
function showResourceList(): void {
  view = "resources"
  imageView.hidden = true
  libraryView.hidden = false
  searchBox.hidden = false
  back.hidden = !imagePayload
  back.title = "返回图片切片"
  styleName.hidden = true
  clearSearch()
  renderLibrary()
  // 资源列表按需拉取，避免每次打开切片窗口都编码全部图片。
  if (!resources.length) void emitMain("image-picker-resources-request")
}

function releaseLibraryBitmaps(): void {
  for (const bitmap of libraryBitmaps.values()) void bitmap.then((image) => image?.close())
  libraryBitmaps.clear()
}

function libraryBitmap(key: string | undefined): Promise<ImageBitmap | undefined> {
  if (!key) return Promise.resolve(undefined)
  let bitmap = libraryBitmaps.get(key)
  if (!bitmap) {
    bitmap = libraryImageURL(key).then(async dataURL => {
      if (!dataURL) return
      const image = new Image()
      image.src = dataURL
      await image.decode()
      return createImageBitmap(image)
    }).catch(() => undefined)
    libraryBitmaps.set(key, bitmap)
  }
  return bitmap
}

async function drawLibraryVisual(canvas: HTMLCanvasElement, visual: StyleLibraryVisual | null, foreground: boolean): Promise<void> {
  if (!visual) return
  const { imageKey, ...rest } = visual
  const payload = library
  const image = await libraryBitmap(imageKey)
  if (canvas.isConnected && library === payload) drawVisualPreview(canvas, [{ ...rest, image }], foreground)
}

function libraryButtons(selector: string): HTMLButtonElement[] {
  return Array.from(libraryView.querySelectorAll<HTMLButtonElement>(selector))
}

function emitLibrary(event: string, payload: unknown = {}): void {
  void emitMain(event, payload)
}

type LibraryTarget = { styleID?: string; imagePath?: string }

/** 单击选中并在底部预览；选中只用 aria-selected 表示。 */
function previewLibraryItem(card: HTMLElement, selected: LibraryTarget): void {
  if (!library) return
  librarySelected = selected
  libraryGrid.querySelector<HTMLElement>('[aria-selected="true"]')?.setAttribute("aria-selected", "false")
  card.setAttribute("aria-selected", "true")
  libraryPreviewImage.replaceChildren()
  const style = library.styles.find((item) => item.styleID === selected.styleID)
  const sound = library.sounds.find((item) => item.styleID === selected.styleID)
  if (selected.imagePath) {
    const image = new Image()
    image.alt = selected.imagePath.split("/").pop() ?? selected.imagePath
    void libraryImageURL(selected.imagePath).then(src => { if (src && image.isConnected) image.src = src })
    libraryPreviewImage.append(image)
  } else if (sound) {
    libraryPreviewImage.append(librarySound(sound.filename, sound.playable))
  } else if (style?.kind === "sound") {
    libraryPreviewImage.append(librarySound(style.sound!, Boolean(style.soundPlayable)))
  } else if (style?.kind === "anim") {
    const selection = librarySelected
    void libraryAnimationPlayers(style).then(players => {
      if (librarySelected === selection) libraryPreviewImage.append(...players)
    })
  } else {
    for (const index of [0, 1]) {
      const canvas = retinaThumbnail(document.createElement("canvas"), 180, 120)
      if (style) void loadLibraryStyle(style).then(() => drawLibraryVisual(canvas, style.visuals[index], false))
      libraryPreviewImage.append(canvas)
    }
  }
  $("#style-library-preview-title").textContent = selected.imagePath?.split("/").pop() ?? (sound?.label ?? `样式 ${style?.label ?? selected.styleID}`)
  $("#style-library-preview-meta").textContent = selected.imagePath ?? (style?.kind === "anim" ? style.summary ?? "" : sound?.filename ?? "")
  const compatible = selected.imagePath ? library.imagesCompatible : library.imageSelection ? style?.kind === "image" : Boolean(style?.compatible ?? sound)
  libraryApply.disabled = !compatible || !library.editable
  libraryApplyToStyle.hidden = !selected.imagePath || !library.applyToStyle || Boolean(library.imageSelection)
  libraryApplyToStyle.disabled = !library.editable
  // 不兼容时只禁用并说明原因，不改按钮文字。
  libraryApply.title = compatible ? "" : "样式类型不兼容"
  // 引用卡单击打开这里并定位当前样式；改它的图片切片从这里进。
  librarySlice.hidden = style?.kind !== "image" || library.bda
  librarySlice.disabled = !library.editable
  libraryDuplicate.disabled = !selected.styleID || !library.canAdd || !library.editable
  libraryPreview.hidden = false
}

function libraryTextResolver(style: StyleLibraryPayload["styles"][number]): VisualResolver {
  return {
    resolve: async () => undefined,
    resolveToolbarImages: async () => [],
    resolveText: (_id, highlighted) => style.textVisuals?.[Number(highlighted)],
    resolveStyleText: (_id, highlighted) => {
      const visual = style.textVisuals?.[Number(highlighted)]
      return visual ? { ...visual, text: "text" in visual ? String(visual.text) : "键设 Aa" } : undefined
    },
  }
}

async function libraryAnimationPlayers(style: StyleLibraryPayload["styles"][number]): Promise<HTMLElement[]> {
  const payload = library
  await loadLibraryStyle(style)
  if (library !== payload) return []
  if (payload?.ssfAnimation) {
    const data = payload.ssfAnimation
    if (!data.key) return []
    const visual = async ({ imageKey, ...rest }: StyleLibraryVisual): Promise<Visual> => ({ ...rest, image: await libraryBitmap(imageKey) })
    const layers = await Promise.all(data.key.layers.map(async (layers): Promise<SceneLayers> => {
      const hydrate = (items: LibrarySceneLayer[]) => Promise.all(items.map(async layer => layer.kind === "image" ? { ...layer, visual: await visual(layer.visual) } : layer))
      return { ...layers, back: await hydrate(layers.back), fore: await hydrate(layers.fore) }
    }))
    const key = { ...data.key, layers: (pressed: boolean) => layers[Number(pressed)] }
    const motion = await SsfMotion.fromDocument({
      sogouWidth: data.sogouWidth, skin: IniDocument.parse(data.skin), keys: IniDocument.parse(data.keys),
      file: async name => name && data.images[name] ? visual(data.images[name]) : undefined,
    }, data.board, IniDocument.parse(data.text), data.screenWidth)
    const effects = motion.effects([{ section: key.section, rect: key.rect, binding: { sections: [], defaults: [], keyClass: "char" } }], { section: style.styleID, field: data.field })
    return effects ? [animationPlayer({ thumbnail: true, key: style.styleID, clip: emptyClip(), native: async () => ({ key, effects }) })] : []
  }
  if (!payload?.animationText) return []
  const document = libraryAnimations ??= IniDocument.parse(payload.animationText)
  const resolver: VisualResolver = {
    resolve: async id => {
      const visual = payload.particleVisuals[id]
      if (!visual) return
      const { imageKey, ...rest } = visual
      return { ...rest, image: await libraryBitmap(imageKey) }
    },
    resolveText: () => undefined,
    resolveToolbarImages: async () => [],
  }
  return (style.animationSections ?? []).map(section => animationPlayer({
    thumbnail: true, key: section, clip: iniPreviewClip(document, section, { fillBefore: true }), resolver,
    readFile: path => payload.animationFiles[path] ? new Uint8Array(payload.animationFiles[path]) : undefined,
  }))
}

function librarySound(filename: string, playable: boolean): HTMLElement {
  return soundStyleSample(filename, playable ? () => emitLibrary("style-library-play", { filename }) : undefined)
}

/** 卡片的单击 / 双击 / ⌘ 单击：选中预览、应用、编辑；选图片时单击就是选定。 */
function bindLibraryCard(card: HTMLElement, target: LibraryTarget, chooser: boolean): void {
  card.addEventListener("click", (event) => {
    if (chooser) emitLibrary("resource-picker-select", { path: target.imagePath })
    else if (event.metaKey || event.ctrlKey) emitLibrary("style-library-edit", target)
    else previewLibraryItem(card, target)
  })
  if (!chooser) card.addEventListener("dblclick", () => { if (!libraryApply.disabled) emitLibrary("style-library-apply", target) })
}

function libraryCards(payload: StyleLibraryPayload | undefined, chooser: boolean, images: boolean, query: string): HTMLElement[] {
  if (chooser) return resources.filter(({ path }) => path.toLowerCase().includes(query)).map(({ path, dataURL }) => {
    const card = imageResourceCard({ path, src: dataURL })
    card.setAttribute("aria-selected", String(path === imagePayload?.path))
    bindLibraryCard(card, { imagePath: path }, true)
    return card
  })
  if (!payload) return []
  if (payload.soundOnly) {
    return payload.sounds.filter(({ styleID, filename }) => !query || styleID.toLowerCase().includes(query) || filename.toLowerCase().includes(query)).map(({ styleID, label, filename, playable, uses }) => {
      const card = styleCard({ id: styleID, label: label ?? `STYLE${styleID}`, kind: "sound", sound: () => librarySound(filename, playable), uses })
      bindLibraryCard(card, { styleID }, false)
      return card
    })
  }
  if (images) {
    return payload.images.filter(({ path, categories }) => path.toLowerCase().includes(query) && (libraryFilter === "all" || categories.includes(libraryFilter))).map(({ path, uses }) => {
      const card = imageResourceCard({ path, load: () => libraryImageURL(path), uses })
      bindLibraryCard(card, { imagePath: path }, false)
      return card
    })
  }
  return payload.styles.filter(style => styleMatches({ ...style, sound: Boolean(style.sound), search: [style.styleID, style.label, ...style.imagePaths].join(" ") }, libraryKind, libraryFilter, query)).map((style) => {
    const card = styleCard({
      id: style.styleID, label: payload.ssfAnimation ? style.label : `STYLE${style.label}`, info: style.info, kind: style.kind,
      draw: (canvas, highlighted) => style.kind === "text"
        ? textStyleSample(canvas, libraryTextResolver(style), style.styleID, highlighted)
        : loadLibraryStyle(style).then(() => drawLibraryVisual(canvas, style.visuals[Number(highlighted)], Boolean(payload.foreground))),
      animation: () => libraryAnimationPlayers(style), summary: style.summary,
      sound: style.sound ? () => librarySound(style.sound!, Boolean(style.soundPlayable)) : undefined,
      uses: style.uses,
    })
    bindLibraryCard(card, { styleID: style.styleID }, false)
    return card
  })
}

function renderLibrary(): void {
  const payload = library
  const chooser = view === "resources"
  libraryPreview.hidden = true
  librarySelected = undefined
  libraryDuplicate.disabled = true
  libraryToolbar.hidden = chooser || !payload?.canAdd || !payload.editable
  const sound = Boolean(payload?.soundOnly)
  const images = chooser || libraryMode === "images" && !sound
  title.textContent = images ? "全部图片" : "全部样式"
  setWindowTitle(title.textContent)
  for (const button of libraryButtons("[data-library-mode]")) {
    button.setAttribute("aria-pressed", String(button.dataset.libraryMode === libraryMode))
    button.disabled = (sound || Boolean(payload?.ssfAnimation)) && button.dataset.libraryMode === "images"
  }
  libraryModes.hidden = chooser
  libraryKinds.replaceChildren(styleFilterButtons(styleTypeOptions, "libraryKind", libraryKind, value => { libraryKind = value; renderLibrary() }))
  libraryFilters.replaceChildren(styleFilterButtons(styleUsageOptions, "libraryFilter", libraryFilter, value => { libraryFilter = value; renderLibrary() }))
  libraryKinds.hidden = images || sound
  libraryFilters.hidden = sound
  const query = search.value.trim().toLowerCase().replace(/^#/, "")
  const cards = libraryCards(payload, chooser, images, query)
  libraryGrid.replaceChildren(...cards)
  if (payload && !chooser && !images && payload.canAdd && payload.editable) libraryGrid.append(styleAddCard(() => emitLibrary("style-library-add")))
  // 数量只在标题旁出现一次。
  count.textContent = String(cards.length)
  count.hidden = !(chooser ? resourcesLoaded : payload)
  libraryEmpty.replaceChildren(emptyState(query ? "search-x" : images ? "image-off" : "layers"))
  libraryEmpty.hidden = cards.length > 0 || !(chooser ? resourcesLoaded : payload)
  libraryGrid.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" })
  // 打开时定位当前样式（检查器的引用卡单击进来），预览栏里可以应用或改切片。
  const current = payload?.currentID && !chooser && !images ? cards.find(card => card.dataset.styleId === payload.currentID) : undefined
  if (current) {
    current.click()
    current.scrollIntoView({ block: "nearest" })
  }
}

function showStyleLibrary(payload?: StyleLibraryPayload): void {
  const reset = view !== "styles" || Boolean(payload)
  view = "styles"
  imageView.hidden = true
  libraryView.hidden = false
  searchBox.hidden = false
  styleName.hidden = true
  back.title = "返回图片切片"
  if (payload) {
    for (const request of previewRequests.values()) request.done()
    for (const request of imageRequests.values()) request.done()
    previewRequests.clear()
    imageRequests.clear()
    library = payload
    libraryAnimations = undefined
    releaseLibraryBitmaps()
    libraryMode = payload.imageSelection ? "images" : "styles"
    libraryKind = payload.kind
    libraryFilter = "all"
  } else if (reset) library = undefined
  if (reset) clearSearch()
  // 切片窗口会按图片高度收窄，样式库需要足够的可视面积。
  if (nativePickerWindow && (window.innerWidth < 960 || window.innerHeight < 680)) {
    void getCurrentWindow().setSize(new LogicalSize(Math.max(window.innerWidth, 1100), Math.max(window.innerHeight, 760)))
  }
  renderLibrary()
}

function showImage(payload: ImagePayload): void {
  imagePayload = payload
  styleName.textContent = payload.styleName ?? ""
  showSliceView()
  canvas.style.cursor = payload.editable ? "crosshair" : "default"
  image = new Image()
  image.onload = () => {
    if (!image) return
    // 默认缩放到图片区域的 80%（桌面端高按窗口初始 760 算，窗口高度会跟随画布变化）
    // 网页端弹窗高度固定，按实际视口算。
    const area = { width: window.innerWidth, height: (nativePickerWindow ? 760 : window.innerHeight) - $(".picker-toolbar").offsetHeight }
    fit = Math.min(area.width * 0.8 / image.naturalWidth, area.height * 0.8 / image.naturalHeight)
    zoom = 1
    drawImage()
    void fitWindowHeight()
  }
  image.src = payload.dataURL
}

document.title = "图片切片"
showEmptyView()
back.addEventListener("click", () => {
  if (view === "image" && imagePayload?.styleLibrary) {
    showStyleLibrary()
    void emitMain("image-picker-back-styles")
  } else if (view === "image") showResourceList()
  else if (imagePayload) showSliceView()
})
for (const button of libraryButtons("[data-library-mode]")) {
  button.addEventListener("click", () => {
    libraryMode = button.dataset.libraryMode as "styles" | "images"
    libraryFilter = "all"
    clearSearch()
    renderLibrary()
  })
}
libraryApply.addEventListener("click", () => { if (librarySelected) emitLibrary("style-library-apply", librarySelected) })
libraryApplyToStyle.addEventListener("click", () => { if (librarySelected) emitLibrary("style-library-apply", { ...librarySelected, toStyle: true }) })
librarySlice.addEventListener("click", () => { if (librarySelected?.styleID) emitLibrary("style-library-slice", librarySelected) })
$("#style-library-edit").addEventListener("click", () => { if (librarySelected) emitLibrary("style-library-edit", librarySelected) })
function closeLibraryPreview(): void {
  libraryPreview.hidden = true
  libraryGrid.querySelector<HTMLElement>('[aria-selected="true"]')?.setAttribute("aria-selected", "false")
}
$("#style-library-preview-close").addEventListener("click", closeLibraryPreview)
bindListboxKeys(libraryGrid, (card) => {
  card.click()
  card.focus()
})
// ⌘D 复制选中的样式（与侧栏样式列表一致）。
libraryGrid.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() !== "d" || !(event.metaKey || event.ctrlKey) || libraryDuplicate.disabled) return
  event.preventDefault()
  libraryDuplicate.click()
})
// 网页端没有原生标题栏，关闭按钮和 Esc 都交给主页面收起弹窗。
const closeButton = $("#picker-close") as HTMLButtonElement
closeButton.hidden = nativePickerWindow
closeButton.addEventListener("click", () => void emitMain("picker-close"))
// Esc 分层：搜索框先清除（searchField 自己拦下）→ 关预览 → 关窗口。
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || event.isComposing) return
  if (!libraryView.hidden && !libraryPreview.hidden) return closeLibraryPreview()
  if (nativePickerWindow) void getCurrentWindow().close()
  else void emitMain("picker-close")
})
bindSlicePickerZoom($(".picker-canvas-stage"), canvas, (factor) => {
  zoom = Math.min(MAX_SLICE_ZOOM, Math.max(MIN_SLICE_ZOOM, zoom * factor))
  drawImage()
})
canvas.addEventListener("click", (event) => {
  if (!imagePayload?.editable || !image) return
  const bounds = canvas.getBoundingClientRect()
  const point = {
    x: ((event.clientX - bounds.left) / bounds.width * canvas.width - offset.x) / scale,
    y: ((event.clientY - bounds.top) / bounds.height * canvas.height - offset.y) / scale,
  }
  const selected = tileSliceAt(pickableSlices(imagePayload.slices, image), point)
  if (!selected) return
  imagePayload.selectedIndex = selected.index
  drawImage()
  void emitMain("image-picker-select", { index: selected.index })
})

await onMain<ImagePayload>("image-picker-data", (payload) => showImage(payload))
await onMain("image-picker-show-list", () => showResourceList())
await onMain<StyleLibraryPayload>("style-library-data", (payload) => showStyleLibrary(payload))
await onMain<StyleLibraryPreview>("style-library-preview-data", payload => {
  if (library?.session !== payload.session) return
  const style = library.styles.find(style => style.styleID === payload.styleID)
  if (style) {
    style.visuals = payload.visuals
    style.animationSections = payload.animationSections
  }
  if (payload.animationText) library.animationText = payload.animationText
  Object.assign(library.animationFiles, payload.animationFiles)
  Object.assign(library.particleVisuals, payload.particleVisuals)
  previewRequests.get(payload.styleID)?.done()
})
await onMain<{ session: string; key: string; dataURL?: string }>("style-library-image-data", payload => {
  if (library?.session === payload.session) imageRequests.get(payload.key)?.done(payload.dataURL)
})
await onMain<ResourcePayload>("image-picker-resources-data", (payload) => {
  resources = payload
  resourcesLoaded = true
  if (view === "resources") renderLibrary()
})
void emitMain("picker-window-ready")
