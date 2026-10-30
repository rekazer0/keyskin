import { IniDocument } from "./ini.ts"
import { SkinArchive } from "./skin.ts"
import { fontSearchDirectories, resolveFontReference } from "./font-files.ts"

export type Visual = {
  image?: ImageBitmap
  imagePath?: string
  color?: string
  text?: StyleTextVisual
  source?: [number, number, number, number]
  inner?: [number, number, number, number]
  scale?: [number, number, number, number, number]
  borderColor?: string
  filterColor?: string
}

export type TextVisual = {
  fontSize?: number
  fontName?: string
  color?: string
  clearType?: number
  /** Only Sogou styles have a weight (the preview's `SSF_BOLD`). */
  bold?: boolean
}

export type StyleTextVisual = TextVisual & { text: string }

export type VisualResolver = {
  ready?(): Promise<void>
  resolve(styleID: string, highlighted: boolean): Promise<Visual | undefined>
  sourceSize?(styleID: string, highlighted: boolean): { width: number; height: number } | undefined
  resolveResource?(resourceID: string): Promise<Visual | undefined>
  resolveText(foreground: string, highlighted: boolean): TextVisual | undefined
  resolveStyleText?(styleID: string, highlighted: boolean): StyleTextVisual | undefined
  resolveToolbarImages(limit?: number): Promise<Visual[]>
}

type VisualSpec = {
  imageName?: string
  tile?: number
  color?: string
  borderColor?: string
}

function numbers(value: string | undefined): [number, number, number, number] | undefined {
  const parsed = value?.split(",").map(Number)
  if (!parsed || parsed.length !== 4 || parsed.some((item) => !Number.isFinite(item))) return
  return parsed as [number, number, number, number]
}

function scaleNumbers(value: string | undefined): [number, number, number, number, number] | undefined {
  const parsed = value?.split(",").map(Number)
  if (!parsed || parsed.length !== 5 || parsed.some((item) => !Number.isFinite(item))) return
  return parsed as [number, number, number, number, number]
}

function parseColor(value: string | undefined): string | undefined {
  if (!value) return
  const hex = value.trim().replace(/^#/, "")
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(hex)) return
  if (hex.length === 6) return `#${hex}`
  const alpha = Number.parseInt(hex.slice(0, 2), 16) / 255
  const red = Number.parseInt(hex.slice(2, 4), 16)
  const green = Number.parseInt(hex.slice(4, 6), 16)
  const blue = Number.parseInt(hex.slice(6, 8), 16)
  const opacity = Number(alpha.toFixed(3))
  return `rgba(${red}, ${green}, ${blue}, ${opacity})`
}

export function isTransparentColor(color: string | undefined): boolean {
  if (!color) return false
  const match = color.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/)
  return Boolean(match && Number(match[1]) === 0)
}

export function canvasFontFamily(fontName: string | undefined): string {
  const name = fontName?.trim()
  if (!name || /^\.SF(?:UI|NS)/i.test(name)) return "system-ui"
  return `"${name.replaceAll('"', '\\"')}", system-ui`
}

export function canvasFont(size: number, visual: TextVisual | undefined): string {
  return `${visual?.bold ? "bold " : ""}${size}px ${canvasFontFamily(visual?.fontName)}`
}

export function drawVisualText(
  context: CanvasRenderingContext2D,
  visual: Pick<Visual, "text">,
  destination: { x: number; y: number; width: number; height: number },
): void {
  if (!visual.text) return
  context.save()
  context.fillStyle = visual.text.color ?? "#202124"
  context.font = `${destination.height * 0.55}px ${canvasFontFamily(visual.text.fontName)}`
  context.textAlign = "center"
  context.textBaseline = "middle"
  context.fillText(visual.text.text, destination.x + destination.width / 2, destination.y + destination.height / 2, destination.width * 0.9)
  context.restore()
}

function drawVisualSource(
  context: Pick<CanvasRenderingContext2D, "drawImage">,
  visual: Pick<Visual, "image" | "source">,
  destination: { x: number; y: number; width: number; height: number },
): void {
  if (!visual.image || !visual.source) return
  const [sourceX, sourceY, sourceWidth, sourceHeight] = visual.source
  context.drawImage(
    visual.image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    destination.x,
    destination.y,
    destination.width,
    destination.height,
  )
}

// 样式缩略图：主窗口检查器、样式库与原生样式库窗口共用。
function previewDestination(
  canvas: HTMLCanvasElement,
  visual: Visual,
  foreground: boolean,
  layer: number,
): { x: number; y: number; width: number; height: number } {
  if (!visual.source) {
    return { x: 0, y: 0, width: canvas.width, height: canvas.height }
  }
  const [, , sourceWidth, sourceHeight] = visual.source
  if (!foreground) {
    const scale = Math.min(canvas.width / sourceWidth, canvas.height / sourceHeight)
    const width = sourceWidth * scale
    const height = sourceHeight * scale
    return { x: (canvas.width - width) / 2, y: (canvas.height - height) / 2, width, height }
  }
  const scale = Math.min(
    (canvas.width * (layer === 0 ? 0.78 : 0.48)) / sourceWidth,
    (canvas.height * (layer === 0 ? 0.78 : 0.55)) / sourceHeight,
  )
  const width = sourceWidth * scale
  const height = sourceHeight * scale
  return layer === 0
    ? {
        x: (canvas.width - width) / 2,
        y: (canvas.height - height) / 2,
        width,
        height,
      }
    : { x: canvas.width - width - 2, y: 2, width, height }
}

export function retinaThumbnail(canvas: HTMLCanvasElement, cssWidth: number, cssHeight: number): HTMLCanvasElement {
  const ratio = window.devicePixelRatio || 1
  const width = Math.max(1, Math.round(cssWidth * ratio))
  const height = Math.max(1, Math.round(cssHeight * ratio))
  // 尺寸不变时只清空：重设尺寸会让 WebKit 重新分配 GPU 缓冲。
  if (canvas.width === width && canvas.height === height) canvas.getContext("2d")?.clearRect(0, 0, width, height)
  else {
    canvas.width = width
    canvas.height = height
  }
  return canvas
}

/** 重建列表前先收走容器里的旧画布，按顺序复用；必须在清空容器之前调用。 */
export function thumbnailRecycler(container: Element): (cssWidth: number, cssHeight: number) => HTMLCanvasElement {
  const spare = Array.from(container.querySelectorAll("canvas")).reverse()
  return (cssWidth, cssHeight) => retinaThumbnail(spare.pop() ?? document.createElement("canvas"), cssWidth, cssHeight)
}

export function drawVisualPreview(canvas: HTMLCanvasElement, visuals: Array<Visual | undefined>, foreground: boolean): void {
  const context = canvas.getContext("2d")
  if (!context) return
  context.clearRect(0, 0, canvas.width, canvas.height)
  visuals.forEach((visual, layer) => {
    if (!visual) return
    const destination = previewDestination(canvas, visual, foreground, layer)
    if (visual.color && !isTransparentColor(visual.color)) {
      context.fillStyle = visual.color
      context.fillRect(destination.x, destination.y, destination.width, destination.height)
    }
    drawVisualSource(context, visual, destination)
    drawVisualText(context, visual, destination)
  })
}

function resolveTextVisual(
  styles: IniDocument,
  foreground: string,
  highlighted: boolean,
  defaultFontName?: string,
): TextVisual | undefined {
  const sections = styles.sections()
  const result: TextVisual = {}
  const visited = new Set<string>()
  for (const token of foreground.split(",").map((value) => value.trim()).filter(Boolean)) {
    const value = Number(token)
    const candidates = [`STYLE${token}`]
    if (Number.isFinite(value)) candidates.push(`STYLE${Math.floor(value / 100)}`)
    for (const section of candidates) {
      if (!sections.includes(section) || visited.has(section)) continue
      visited.add(section)
      const fontSize = Number(styles.get(section, "FONT_SIZE"))
      const fontName = styles.get(section, "FONT_NAME")?.trim()
      const clearType = Number(styles.get(section, "FONT_CLEARTYPE"))
      const color = parseColor(
        (highlighted ? styles.get(section, "HL_COLOR") : undefined) ??
          styles.get(section, "NM_COLOR"),
      )
      if (result.fontSize === undefined && Number.isFinite(fontSize)) result.fontSize = fontSize
      if (result.fontName === undefined && fontName) result.fontName = fontName
      if (result.clearType === undefined && Number.isFinite(clearType)) result.clearType = clearType
      if (result.color === undefined && color) result.color = color
      const bold = styles.get(section, "SSF_BOLD")
      if (result.bold === undefined && bold) result.bold = bold === "1"
    }
  }
  if (result.fontName === undefined && defaultFontName) result.fontName = defaultFontName
  return Object.keys(result).length ? result : undefined
}

function resolveStyleTextVisual(
  styles: IniDocument,
  styleID: string,
  highlighted: boolean,
  defaultFontName?: string,
): StyleTextVisual | undefined {
  const text = styles.get(`STYLE${styleID.trim()}`, "SHOW")
  if (!text) return
  return { text, ...resolveTextVisual(styles, styleID, highlighted, defaultFontName) }
}

function resolveVisualSpec(
  styles: IniDocument,
  styleID: string,
  highlighted: boolean,
): VisualSpec | undefined {
  const id = styleID.trim()
  if (!/^\d+$/.test(id)) return
  const section = `STYLE${id}`
  if (!styles.sections().includes(section)) return
  const imageValue =
    (highlighted ? styles.get(section, "HL_IMG") : undefined) ?? styles.get(section, "NM_IMG")
  const [imageName, tileValue] = imageValue?.split(",").map((part) => part.trim()) ?? []
  const colorValue =
    (highlighted ? styles.get(section, "HL_COLOR") : undefined) ??
    styles.get(section, "NM_COLOR")
  const color = parseColor(colorValue)
  const borderColor = parseColor(styles.get(section, "BORDER_COLOR"))
  return {
    imageName: imageName || undefined,
    tile: tileValue ? Number(tileValue) : undefined,
    color,
    ...(borderColor ? { borderColor } : {}),
  }
}

// 编辑任一文件都会新建解析器；按字节对象共享位图，未改动的 PNG 不重复解码，
// 否则旧位图只能等 GC，而 WebKit 不把位图显存计入 GC 压力，长时间编辑后显存涨到数百 MB。
const pngBitmaps = new WeakMap<Uint8Array, Promise<ImageBitmap | undefined>>()

export function pngBitmap(bytes: Uint8Array): Promise<ImageBitmap | undefined> {
  let image = pngBitmaps.get(bytes)
  if (!image) {
    // 损坏的 PNG 按缺图处理（回退到样式颜色），不抛出未处理的解码错误。
    image = createImageBitmap(new Blob([new Uint8Array(bytes)], { type: "image/png" })).catch(() => undefined)
    pngBitmaps.set(bytes, image)
  }
  return image
}

function topLevelDicts(plist: string): string[] {
  const dictionaries: string[] = []
  let depth = 0
  let start = -1
  for (const match of plist.matchAll(/<\/?dict>/g)) {
    if (match[0] === "<dict>") {
      if (depth === 0) start = match.index
      depth++
      continue
    }
    depth--
    if (depth === 0 && start >= 0) dictionaries.push(plist.slice(start, match.index + match[0].length))
  }
  return dictionaries
}

function dictAfterKey(source: string, key: string): string | undefined {
  const marker = `<key>${key}</key>`
  const index = source.indexOf(marker)
  return index < 0 ? undefined : topLevelDicts(source.slice(index + marker.length))[0]
}

function stringAfterKey(source: string | undefined, key: string): string | undefined {
  if (!source) return
  const marker = `<key>${key}</key>`
  const index = source.indexOf(marker)
  return index < 0
    ? undefined
    : source.slice(index + marker.length).match(/^\s*<string>\s*([^<]+?)\s*<\/string>/)?.[1]
}

function normalizedToolbarImagePath(path: string | undefined): string | undefined {
  return path?.trim().replace(/^\/+/, "").replace(/\.png$/i, "") || undefined
}

// iOS 的 F14 容器只放前 4 个 toolbar 功能、均分容器宽度（真机实测，plist 列了 5 个也只显示 4 个）。
function toolbarImagePaths(plist: string, limit = 4): string[] {
  const paths = topLevelDicts(plist)
    .filter((entry) => /<key>Position<\/key>\s*<string>toolbar<\/string>/.test(entry))
    .flatMap((entry) => {
      const images = dictAfterKey(entry, "Images")
      const normalImages = dictAfterKey(images ?? "", "Normal")
      const path = normalizedToolbarImagePath(stringAfterKey(normalImages, "Normal"))
      return path ? [path] : []
    })
  return paths.slice(0, Math.max(0, limit))
}

type EmbeddedFont = { family: string; ready: Promise<void> }

let embeddedFontID = 0
// 字体缓存按归档里的字节对象复用：同一份字体只加载一次；重新导入同名文件后字节对象变了，
// 这里会加载新的 FontFace，预览不会继续用旧字形。
const embeddedFonts = new WeakMap<SkinArchive, Map<string, { bytes: Uint8Array; font: EmbeddedFont }>>()

function embeddedFontPath(
  names: readonly string[],
  stylePath: string,
  reference: string | undefined,
  extensions = false,
): string | undefined {
  const clean = reference?.split(",")[0]?.trim()
  if (!clean) return
  return resolveFontReference(names, clean, fontSearchDirectories(stylePath), { extensions })
}

export function loadEmbeddedFont(archive: SkinArchive, path: string): EmbeddedFont | undefined {
  const bytes = archive.getBytes(path)
  if (!bytes) return
  let cache = embeddedFonts.get(archive)
  if (!cache) {
    cache = new Map()
    embeddedFonts.set(archive, cache)
  }
  const cached = cache.get(path)
  if (cached?.bytes === bytes) return cached.font

  const family = `BdiEmbeddedFont${++embeddedFontID}`
  const data = new Uint8Array(bytes.byteLength)
  data.set(bytes)
  const ready = (async () => {
    if (typeof FontFace === "undefined" || typeof document === "undefined") return
    const face = await new FontFace(family, data.buffer).load()
    document.fonts.add(face)
  })().catch(() => {})
  const result = { family, ready }
  cache.set(path, { bytes, font: result })
  return result
}

export class AtlasResolver {
  private readonly archive: SkinArchive
  private readonly theme: string
  private readonly resourceRoots: string[]
  private readonly styles?: IniDocument
  private readonly tiles = new Map<string, IniDocument>()
  private readonly embeddedFontFamily?: string
  private readonly embeddedFontReady: Promise<void>

  constructor(archive: SkinArchive, theme: string, orientation: string) {
    this.archive = archive
    this.theme = theme
    this.resourceRoots = [
      `${theme}/skin/${orientation}/res`,
      `${theme}/skin/res`,
    ]
    const path = [
      ...this.resourceRoots.map((root) => `${root}/default.css`),
    ].find((candidate) => archive.names().includes(candidate))
    if (path) this.styles = IniDocument.parse(archive.getText(path))
    const fontPath = path && this.styles
      ? embeddedFontPath(archive.names(), path, this.styles.get("GLOBAL", "FONT_PATH"))
      : undefined
    const embeddedFont = fontPath ? loadEmbeddedFont(archive, fontPath) : undefined
    this.embeddedFontFamily = embeddedFont?.family
    const fonts = [embeddedFont?.ready]
    if (path && this.styles) {
      // iOS 专有的 [STYLE*] FONT_PATH：皮肤里已经写了才支持，内嵌字体优先于 FONT_NAME。
      for (const { section, key, value } of this.styles.entries()) {
        if (key !== "FONT_PATH" || section === "GLOBAL") continue
        const source = embeddedFontPath(archive.names(), path, value)
        const font = source && loadEmbeddedFont(archive, source)
        if (!font) continue
        this.styles.set(section, "FONT_NAME", font.family)
        fonts.push(font.ready)
      }
      // FONT_NAME 可以写 benxu、DROIDSANSFALLBACK.ttf 或系统字体名；只有落到归档文件才内嵌，
      // 系统字体名保持原样，由 canvasFontFamily 走系统字体回退。
      for (const { section, key, value } of this.styles.entries()) {
        if (key !== "FONT_NAME" || section === "GLOBAL") continue
        const source = embeddedFontPath(archive.names(), path, value, true)
        const font = source && loadEmbeddedFont(archive, source)
        if (!font) continue
        if (this.styles.get(section, key) === font.family) continue
        this.styles.set(section, key, font.family)
        fonts.push(font.ready)
      }
    }
    this.embeddedFontReady = Promise.all(fonts).then(() => {})
  }

  ready(): Promise<void> {
    return this.embeddedFontReady
  }

  private bitmap(path: string): Promise<ImageBitmap | undefined> | undefined {
    const bytes = this.archive.getBytes(path)
    return bytes && pngBitmap(bytes)
  }

  sourceSize(styleID: string, highlighted: boolean): { width: number; height: number } | undefined {
    if (!this.styles) return
    const spec = resolveVisualSpec(this.styles, styleID, highlighted)
    if (!spec?.imageName || !Number.isInteger(spec.tile)) return
    const tilePath = this.resourceRoots
      .map((root) => `${root}/${spec.imageName}.til`)
      .find((candidate) => this.archive.names().includes(candidate))
    if (!tilePath) return
    let tiles = this.tiles.get(tilePath)
    if (!tiles) {
      tiles = IniDocument.parse(this.archive.getText(tilePath))
      this.tiles.set(tilePath, tiles)
    }
    const source = numbers(tiles.get(`IMG${spec.tile}`, "SOURCE_RECT"))
    return source ? { width: source[2], height: source[3] } : undefined
  }

  async resolve(styleID: string, highlighted: boolean): Promise<Visual | undefined> {
    if (!this.styles) return
    const spec = resolveVisualSpec(this.styles, styleID, highlighted)
    if (!spec) return
    if (!spec.imageName || !Number.isInteger(spec.tile)) {
      return { color: spec.color, borderColor: spec.borderColor }
    }

    const base = this.resourceRoots
      .map((root) => `${root}/${spec.imageName}`)
      .find((candidate) =>
        this.archive.names().includes(`${candidate}.png`) &&
        this.archive.names().includes(`${candidate}.til`),
      )
    if (!base) return { color: spec.color, borderColor: spec.borderColor }
    const imagePath = `${base}.png`
    const tilePath = `${base}.til`
    const image = this.bitmap(imagePath)
    if (!image || !this.archive.names().includes(tilePath)) {
      return { color: spec.color, borderColor: spec.borderColor }
    }

    let tiles = this.tiles.get(tilePath)
    if (!tiles) {
      tiles = IniDocument.parse(this.archive.getText(tilePath))
      this.tiles.set(tilePath, tiles)
    }
    const source = numbers(tiles.get(`IMG${spec.tile}`, "SOURCE_RECT"))
    if (!source) return { color: spec.color, borderColor: spec.borderColor }
    const absoluteInner = numbers(tiles.get(`IMG${spec.tile}`, "INNER_RECT"))
    // 工具书 V6 p162：无 INNER_RECT 或宽高为 0 时不拉伸。
    const inner = absoluteInner && absoluteInner[2] > 0 && absoluteInner[3] > 0
      ? ([
          absoluteInner[0] - source[0],
          absoluteInner[1] - source[1],
          absoluteInner[2],
          absoluteInner[3],
        ] as [number, number, number, number])
      : undefined
    const scale = scaleNumbers(tiles.get(`IMG${spec.tile}`, "SCALE"))
    const bitmap = await image
    if (!bitmap) return { color: spec.color, borderColor: spec.borderColor }
    return { image: bitmap, imagePath, source, inner, scale, color: spec.color, borderColor: spec.borderColor }
  }

  async resolveToolbarImages(limit?: number): Promise<Visual[]> {
    const plistPath = `${this.theme}/skin/res/logo/com.baidu.inputmethod.toolbarMenuItems.plist`
    if (!this.archive.isText(plistPath)) return this.resolveAndroidToolbarImages(limit)
    const names = this.archive.names()
    const paths = toolbarImagePaths(this.archive.getText(plistPath), limit).flatMap((base) => {
      const prefix = `${this.theme}/skin/res/logo/${base}`
      const candidates = [
        `${prefix}_iphone@3x.png`,
        `${prefix}@3x.png`,
        `${prefix}.png`,
      ]
      const path = candidates.find((candidate) => names.includes(candidate))
      return path ? [path] : []
    })
    const visuals: Array<Visual | undefined> = await Promise.all(paths.map(async (path) => {
      const image = await this.bitmap(path)
      return image ? { image, imagePath: path, source: [0, 0, image.width, image.height] as [number, number, number, number] } : undefined
    }))
    return visuals.filter((visual): visual is Visual => Boolean(visual))
  }

  /**
   * Android fills the F14 container from the user's function list, drawing each function with IMG<bitmap index>
   * of res/logo/pop_menu_icons (Baidu 13.3.18.31 LogoIconSource). The preview shows the toolbar functions the atlas
   * covers — 表情 26, 输入方式 27, 语音 29, 搜索 31, 编辑 25, 剪贴板 50 — since the real list lives on the phone.
   */
  private async resolveAndroidToolbarImages(limit = Number.POSITIVE_INFINITY): Promise<Visual[]> {
    const path = `${this.theme}/skin/res/logo/pop_menu_icons`
    if (!this.archive.isText(`${path}.til`)) return []
    const tiles = IniDocument.parse(this.archive.getText(`${path}.til`))
    const image = await this.bitmap(`${path}.png`)
    if (!image) return []
    return [26, 27, 29, 31, 25, 50].flatMap((index) => {
      const source = numbers(tiles.get(`IMG${index}`, "SOURCE_RECT"))
      return source ? [{ image, imagePath: `${path}.png`, source }] : []
    }).slice(0, Math.max(0, limit))
  }

  resolveText(foreground: string, highlighted: boolean): TextVisual | undefined {
    if (!this.styles) return
    return resolveTextVisual(this.styles, foreground, highlighted, this.embeddedFontFamily)
  }

  resolveStyleText(styleID: string, highlighted: boolean): StyleTextVisual | undefined {
    if (!this.styles) return
    return resolveStyleTextVisual(this.styles, styleID, highlighted, this.embeddedFontFamily)
  }
}
