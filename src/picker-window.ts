import { getCurrentWindow } from "@tauri-apps/api/window"
import { LogicalSize } from "@tauri-apps/api/dpi"
import { bindSlicePickerZoom, drawSlicePicker, MAX_SLICE_ZOOM, MIN_SLICE_ZOOM, pickableSlices } from "./slice-picker-canvas.ts"
import { tileSliceAt, type TilePoint, type TileSlice } from "./tiles.ts"
import { drawVisualPreview, retinaThumbnail, type Visual } from "./atlas.ts"
import { createIcon, hydrateIcons } from "./icons.ts"
import { nativePickerWindow, pickerEmitter, pickerListener } from "./picker-channel.ts"
import { styleCard, styleFilterButtons, styleMatches, styleTypeOptions, styleUsageOptions, textStyleSample } from "./style-card"
import { animationPlayer } from "./animation-player"
import { iniPreviewClip } from "./animation-preview-model"
import { IniDocument } from "./ini"
import type { TextVisual, VisualResolver } from "./atlas"
import { element, iconButton } from "./dom-element"

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
export type StyleLibraryPayload = {
  sliceBack: boolean
  editable: boolean
  canAdd: boolean
  soundOnly: boolean
  foreground: boolean
  bda: boolean
  kind: string
  currentID: string
  currentLabel: string
  source: string
  imagesCompatible: boolean
  bitmaps: Record<string, string>
  animationText: string
  animationFiles: Record<string, number[]>
  particleVisuals: Record<string, StyleLibraryVisual | null>
  styles: {
    styleID: string
    label: string
    info?: string
    kind: string
    kindLabel: string
    kindIcon: string
    categories: string[]
    compatible: boolean
    imagePaths: string[]
    visuals: Array<StyleLibraryVisual | null>
    animationSections?: string[]
    summary?: string
    textVisuals?: Array<TextVisual | undefined>
    sound?: string
    soundPlayable?: boolean
  }[]
  images: { path: string; categories: string[]; referenced: boolean }[]
  sounds: { styleID: string; filename: string; playable: boolean }[]
}

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!
hydrateIcons()
// 取色器窗口跟随系统深浅色，与主窗口一样通过 data-app-theme 切换 token。
const systemDark = matchMedia("(prefers-color-scheme: dark)")
const syncTheme = () => { document.documentElement.dataset.appTheme = systemDark.matches ? "dark" : "light" }
syncTheme()
systemDark.addEventListener("change", syncTheme)
const title = $("#picker-title")
const styleName = $("#picker-style")
const subtitle = $("#picker-subtitle")
const back = $("#picker-back") as HTMLButtonElement
const backLabel = $("#picker-back-label")
const search = $("#resource-search") as HTMLInputElement
const imageView = $("#image-picker-view")
const resourceView = $("#resource-picker-view")
const canvas = $("#picker-canvas") as HTMLCanvasElement
const grid = $("#resource-picker-grid")
const empty = $("#resource-empty")
const libraryView = $("#style-library-view")
const libraryGrid = $("#style-library-grid")
const libraryEmpty = $("#style-library-empty")
const libraryKinds = $("#style-library-kinds")
const libraryFilters = $("#style-library-filters")
const libraryAdd = $("#style-library-add") as HTMLButtonElement
const libraryPreview = $("#style-library-preview")
const libraryPreviewImage = $("#style-library-preview-image")
const libraryApply = $("#style-library-apply") as HTMLButtonElement
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
  scale = drawSlicePicker(canvas, image, pickableSlices(imagePayload.slices, image), imagePayload.selectedIndex, fit * zoom, { normal: "#0a84ff", selected: "#ff453a" })
  offset = { x: 0, y: 0 }
}

function filterResources(): void {
  const query = search.value.trim().toLocaleLowerCase()
  let visible = 0
  for (const button of Array.from(grid.querySelectorAll<HTMLButtonElement>("button"))) {
    button.hidden = Boolean(query) && !button.dataset.path?.toLocaleLowerCase().includes(query)
    if (!button.hidden) visible++
  }
  empty.hidden = !resourcesLoaded || visible > 0
}

function renderResources(): void {
  grid.replaceChildren()
  for (const resource of resources) {
    const button = document.createElement("button")
    button.type = "button"
    button.dataset.path = resource.path
    button.title = resource.path
    button.classList.toggle("active", resource.path === imagePayload?.path)
    const preview = document.createElement("img")
    preview.src = resource.dataURL
    preview.alt = ""
    const name = document.createElement("span")
    name.textContent = resource.path.split("/").pop() ?? resource.path
    button.append(preview, name)
    // 同一个窗口既显示切片也显示全部图片列表，由主窗口决定选完之后是切图还是关窗。
    button.addEventListener("click", () => void emitMain("resource-picker-select", { path: resource.path }))
    grid.append(button)
  }
  subtitle.textContent = resources.length ? `${resources.length} 张图片` : "正在读取图片资源"
  filterResources()
}

function showEmptyView(): void {
  view = "empty"
  imageView.hidden = true
  resourceView.hidden = true
  libraryView.hidden = true
  search.hidden = true
  back.hidden = true
  styleName.hidden = true
  subtitle.hidden = true
}

function showSliceView(): void {
  view = "image"
  imageView.hidden = false
  resourceView.hidden = true
  libraryView.hidden = true
  search.hidden = true
  back.hidden = !imagePayload
  backLabel.textContent = imagePayload?.styleLibrary ? "全部样式" : "全部图片"
  back.setAttribute("aria-label", `返回${backLabel.textContent}`)
  if (imagePayload) title.textContent = imagePayload.path.split("/").pop() ?? imagePayload.path
  styleName.hidden = !styleName.textContent
  subtitle.hidden = true
  setWindowTitle("图片切片")
}

function showResourceList(): void {
  view = "resources"
  imageView.hidden = true
  resourceView.hidden = false
  libraryView.hidden = true
  search.hidden = false
  search.placeholder = "搜索图片资源"
  back.hidden = !imagePayload
  backLabel.textContent = "图片切片"
  back.setAttribute("aria-label", "返回图片切片")
  styleName.hidden = true
  subtitle.hidden = false
  title.textContent = "全部图片"
  search.value = ""
  renderResources()
  setWindowTitle("全部图片")
  // 资源列表按需拉取，避免每次打开切片窗口都编码全部图片。
  if (!resources.length) void emitMain("image-picker-resources-request")
}

function releaseLibraryBitmaps(): void {
  for (const bitmap of libraryBitmaps.values()) void bitmap.then((image) => image?.close())
  libraryBitmaps.clear()
}

function libraryBitmap(key: string | undefined): Promise<ImageBitmap | undefined> {
  const dataURL = key ? library?.bitmaps[key] : undefined
  if (!key || !dataURL) return Promise.resolve(undefined)
  let bitmap = libraryBitmaps.get(key)
  if (!bitmap) {
    const image = new Image()
    image.src = dataURL
    bitmap = image.decode().then(() => createImageBitmap(image)).catch(() => undefined)
    libraryBitmaps.set(key, bitmap)
  }
  return bitmap
}

async function drawLibraryVisual(canvas: HTMLCanvasElement, visual: StyleLibraryVisual | null, foreground: boolean): Promise<void> {
  if (!visual) return
  const { imageKey, ...rest } = visual
  drawVisualPreview(canvas, [{ ...rest, image: await libraryBitmap(imageKey) }], foreground)
}

function libraryButtons(selector: string): HTMLButtonElement[] {
  return Array.from(libraryView.querySelectorAll<HTMLButtonElement>(selector))
}

function emitLibrary(event: string, payload: unknown = {}): void {
  void emitMain(event, payload)
}

function previewLibraryItem(card: HTMLElement, selected: { styleID?: string; imagePath?: string }): void {
  if (!library) return
  librarySelected = selected
  libraryGrid.querySelector<HTMLElement>('[data-previewing="true"]')?.removeAttribute("data-previewing")
  card.dataset.previewing = "true"
  libraryPreviewImage.replaceChildren()
  const style = library.styles.find((item) => item.styleID === selected.styleID)
  if (selected.imagePath) {
    const image = new Image()
    image.alt = selected.imagePath.split("/").pop() ?? selected.imagePath
    image.src = library.bitmaps[selected.imagePath] ?? ""
    libraryPreviewImage.append(image)
  } else if (style?.kind === "anim") {
    libraryPreviewImage.append(...libraryAnimationPlayers(style))
  } else {
    for (const visual of style?.visuals ?? []) {
      const canvas = retinaThumbnail(document.createElement("canvas"), 180, 120)
      void drawLibraryVisual(canvas, visual, false)
      libraryPreviewImage.append(canvas)
    }
  }
  $("#style-library-preview-title").textContent = selected.imagePath?.split("/").pop() ?? `样式 ${style?.label ?? selected.styleID}`
  $("#style-library-preview-meta").textContent = selected.imagePath ?? (style?.kind === "anim" ? style.summary ?? "动画引用缺失或未配置" : "正常 / 按下 · 确认后应用到当前项")
  const compatible = selected.imagePath ? library.imagesCompatible : Boolean(style?.compatible)
  libraryApply.disabled = !compatible || !library.editable
  libraryApply.textContent = !compatible ? "样式类型不兼容" : selected.imagePath && !library.bda ? "选择切片并应用" : "应用到当前项"
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

function libraryAnimationPlayers(style: StyleLibraryPayload["styles"][number]): HTMLElement[] {
  const payload = library
  if (!payload?.animationText) return []
  const document = IniDocument.parse(payload.animationText)
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

function librarySoundSample(filename: string, playable: boolean): HTMLElement {
  const root = element("span", "ui-style-sound")
  root.title = filename
  const play = iconButton("play", `试听音效 ${filename}`)
  play.disabled = !playable
  play.addEventListener("click", event => { event.stopPropagation(); emitLibrary("style-library-play", { filename }) })
  const info = element("span", "ui-style-sound-info")
  const name = element("strong")
  name.textContent = filename
  const meta = element("small")
  meta.textContent = playable ? "" : "声音文件不存在"
  info.append(name, meta)
  root.append(play, info)
  return root
}

function renderLibrarySounds(payload: StyleLibraryPayload, query: string): number {
  const sounds = payload.sounds.filter(({ styleID, filename }) => !query || styleID.includes(query) || filename.toLowerCase().includes(query))
  for (const { styleID, filename, playable } of sounds) {
    const card = document.createElement("div")
    card.className = "style-library-item style-library-sound"
    card.classList.toggle("selected", payload.currentID === styleID)
    const select = document.createElement("button")
    select.type = "button"
    select.title = `点击使用声音样式 ${styleID}；Command/Ctrl 点击编辑`
    const label = document.createElement("strong")
    label.textContent = `STYLE${styleID}`
    const name = document.createElement("small")
    name.textContent = filename
    select.append(createIcon("music", 16), label, name)
    select.addEventListener("click", (event) => emitLibrary(event.metaKey || event.ctrlKey ? "style-library-edit" : "style-library-apply", { styleID }))
    const play = document.createElement("button")
    play.type = "button"
    play.disabled = !playable
    play.title = playable ? `播放 ${filename}` : "声音文件不存在"
    play.setAttribute("aria-label", play.title)
    play.append(createIcon("play", 14))
    play.addEventListener("click", () => emitLibrary("style-library-play", { filename }))
    card.append(select, play)
    libraryGrid.append(card)
  }
  $("#style-library-status").textContent = `显示 ${sounds.length} 个声音样式`
  return sounds.length
}

function renderLibrary(): void {
  const payload = library
  libraryGrid.replaceChildren()
  libraryPreview.hidden = true
  librarySelected = undefined
  if (!payload) {
    libraryEmpty.textContent = "正在加载样式…"
    libraryEmpty.hidden = false
    return
  }
  const sound = payload.soundOnly
  const images = libraryMode === "images" && !sound
  title.textContent = images ? "全部图片" : "全部样式"
  setWindowTitle(title.textContent)
  subtitle.textContent = sound ? `${payload.sounds.length} 个声音样式` : `${payload.styles.length} 个样式 · ${payload.images.length} 张图片`
  search.placeholder = images ? "搜索图片名称" : "搜索样式名称或编号"
  for (const button of libraryButtons("[data-library-mode]")) {
    button.setAttribute("aria-pressed", String(button.dataset.libraryMode === libraryMode))
    button.disabled = sound && button.dataset.libraryMode === "images"
  }
  libraryKinds.replaceChildren(styleFilterButtons(styleTypeOptions, "libraryKind", libraryKind, value => { libraryKind = value; renderLibrary() }))
  libraryFilters.replaceChildren(styleFilterButtons(styleUsageOptions, "libraryFilter", libraryFilter, value => { libraryFilter = value; renderLibrary() }))
  libraryKinds.hidden = images || sound
  libraryFilters.hidden = sound
  libraryAdd.hidden = !payload.canAdd
  libraryAdd.disabled = !payload.editable
  const hint = sound ? "单击应用声音样式 · Command/Ctrl 单击编辑" : "单击预览 · 双击应用 · Command/Ctrl 单击编辑"
  $("#style-library-source").textContent = `${hint} · 来源 ${payload.source}`
  const query = search.value.trim().toLowerCase().replace(/^#/, "")
  let count: number
  if (sound) count = renderLibrarySounds(payload, query)
  else {
    const currentImages = payload.styles.find((item) => item.styleID === payload.currentID)?.imagePaths ?? []
    const items = images
      ? payload.images.filter(({ path, categories }) => path.toLowerCase().includes(query) && (libraryFilter === "all" || categories.includes(libraryFilter)))
        .map((image) => ({ imagePath: image.path, image, style: undefined }))
      : payload.styles.filter(style => styleMatches({ ...style, sound: Boolean(style.sound), search: [style.styleID, style.label, ...style.imagePaths].join(" ") }, libraryKind, libraryFilter, query))
        .map((style) => ({ imagePath: "", image: undefined, style }))
    for (const { imagePath, image, style } of items) {
      const selected = imagePath ? currentImages.includes(imagePath) : payload.currentID === style?.styleID
      const card = style ? styleCard({
        id: style.styleID, label: `STYLE${style.label}`, info: style.info, kind: style.kind, kindLabel: style.kindLabel, kindIcon: style.kindIcon,
        draw: (canvas, highlighted) => style.kind === "text"
          ? textStyleSample(canvas, libraryTextResolver(style), style.styleID, highlighted)
          : drawLibraryVisual(canvas, style.visuals[Number(highlighted)], Boolean(library?.foreground)),
        animation: () => libraryAnimationPlayers(style), summary: style.summary,
        sound: style.sound ? () => librarySoundSample(style.sound!, Boolean(style.soundPlayable)) : undefined,
      }) : element("button", "style-library-item")
      if (image) {
        const previews = element("span", "style-library-previews")
        const preview = new Image()
        preview.alt = ""
        preview.loading = "lazy"
        preview.src = payload.bitmaps[image.path] ?? ""
        previews.append(preview)
        const label = element("strong")
        label.textContent = imagePath.split("/").pop()!
        const note = element("small")
        note.textContent = image.referenced ? "已引用" : "图片资源"
        card.append(previews, label, note)
      }
      card.setAttribute("aria-pressed", String(selected))
      card.title = imagePath || [`样式 ${style!.label}`, style!.info, "单击预览，双击应用，Command/Ctrl 单击编辑"].filter(Boolean).join(" · ")
      const target = imagePath ? { imagePath } : { styleID: style!.styleID }
      card.addEventListener("click", (event) => {
        if (event.metaKey || event.ctrlKey) emitLibrary("style-library-edit", target)
        else previewLibraryItem(card, target)
      })
      card.addEventListener("dblclick", () => { if (!libraryApply.disabled) emitLibrary("style-library-apply", target) })
      libraryGrid.append(card)
    }
    count = items.length
    $("#style-library-status").textContent = `显示 ${count} 项${payload.currentID ? ` · 当前 ${payload.currentLabel}` : ""}`
  }
  libraryEmpty.textContent = images ? "没有匹配的图片" : "没有匹配的样式"
  libraryEmpty.hidden = count > 0
}

function showStyleLibrary(payload?: StyleLibraryPayload): void {
  const reset = view !== "styles" || Boolean(payload)
  view = "styles"
  imageView.hidden = true
  resourceView.hidden = true
  libraryView.hidden = false
  search.hidden = false
  styleName.hidden = true
  subtitle.hidden = false
  backLabel.textContent = "图片切片"
  back.setAttribute("aria-label", "返回图片切片")
  if (payload) {
    library = payload
    releaseLibraryBitmaps()
    libraryMode = "styles"
    libraryKind = payload.kind
    libraryFilter = "all"
  } else if (reset) library = undefined
  if (reset) search.value = ""
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
search.addEventListener("input", () => {
  if (view === "styles") renderLibrary()
  else filterResources()
})
for (const button of libraryButtons("[data-library-mode]")) {
  button.addEventListener("click", () => {
    libraryMode = button.dataset.libraryMode as "styles" | "images"
    libraryFilter = "all"
    search.value = ""
    renderLibrary()
  })
}
libraryAdd.addEventListener("click", () => emitLibrary("style-library-add"))
libraryApply.addEventListener("click", () => { if (librarySelected) emitLibrary("style-library-apply", librarySelected) })
$("#style-library-edit").addEventListener("click", () => { if (librarySelected) emitLibrary("style-library-edit", librarySelected) })
$("#style-library-preview-close").addEventListener("click", () => {
  libraryPreview.hidden = true
  libraryGrid.querySelector<HTMLElement>('[data-previewing="true"]')?.removeAttribute("data-previewing")
})
// 网页端没有原生标题栏，关闭按钮和 Esc 都交给主页面收起弹窗。
const closeButton = $("#picker-close") as HTMLButtonElement
closeButton.hidden = nativePickerWindow
closeButton.addEventListener("click", () => void emitMain("picker-close"))
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || event.isComposing) return
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
await onMain<ResourcePayload>("image-picker-resources-data", (payload) => {
  resources = payload
  resourcesLoaded = true
  renderResources()
})
void emitMain("picker-window-ready")
