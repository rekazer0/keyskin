import { IniDocument } from "./ini.ts"
import { SkinArchive } from "./skin.ts"
import { fontSearchDirectories, resolveFontReference } from "./font-files.ts"
import { bdiMenuIcons, bdiToolbarIcons } from "./ios-toolbar-menu.ts"
import { ANDROID_TOOLBAR_ICONS } from "./android-toolbar.ts"

export type Visual = {
  image?: ImageBitmap
  imagePath?: string
  color?: string
  text?: StyleTextVisual
  source?: [number, number, number, number]
  inner?: [number, number, number, number]
  /** Device pixels per layout unit; nine-patch borders keep their bitmap pixel size. */
  nineSlicePixelScale?: number
  scale?: [number, number, number, number, number]
  borderColor?: string
  filterColor?: string
}

export type TextVisual = {
  fontSize?: number
  fontName?: string
  color?: string
  clearType?: number
  /** CSS 字重（100–900）：样式的 FONT_WEIGHT，或搜狗 / 手心皮肤的粗细。 */
  weight?: number
  /** 文字样式下的 BORDER_COLOR 是向下阴影颜色。 */
  shadowColor?: string
  /** 文字样式下的 BORDER_SIZE 是向下阴影大小（像素）。 */
  shadowSize?: number
}

export type StyleTextVisual = TextVisual & { text: string }

export type ToolbarVisual = Visual & {
  label?: string
  defaultIcon?: string
  menu?: { path: string; id: string; image: string; position: string }
  atlas?: { path: string; index: number }
  /** 裁切后的预览仍需保留原图坐标，供检查器只替换对应切片。 */
  imageSource?: [number, number, number, number]
}

export type VisualResolver = {
  ready?(): Promise<void>
  resolve(styleID: string, highlighted: boolean): Promise<Visual | undefined>
  imagePath?(styleID: string, highlighted: boolean): string | undefined
  sourceSize?(styleID: string, highlighted: boolean): { width: number; height: number } | undefined
  resolveResource?(resourceID: string): Promise<Visual | undefined>
  resolveText(foreground: string, highlighted: boolean): TextVisual | undefined
  resolveListText?(foreground: string, highlighted: boolean): TextVisual | undefined
  resolveStyleText?(styleID: string, highlighted: boolean): StyleTextVisual | undefined
  resolveToolbarImages(limit?: number): Promise<ToolbarVisual[]>
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

export function parseColor(value: string | undefined): string | undefined {
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

/** FONT_WEIGHT 的值：100–900，或 bold / normal；其他写法当作未设置。 */
export function fontWeight(value: string | undefined): number | undefined {
  const text = value?.trim().toLowerCase()
  const weight = text === "bold" ? 700 : text === "normal" ? 400 : Number(text)
  return text && Number.isInteger(weight) && weight >= 100 && weight <= 900 ? weight : undefined
}

export function canvasFont(size: number, visual: TextVisual | undefined): string {
  return `${visual?.weight ? `${visual.weight} ` : ""}${size}px ${canvasFontFamily(visual?.fontName)}`
}

/**
 * 文字样式的向下阴影（BORDER_COLOR / BORDER_SIZE）：参数取自百度安卓 StyleParam
 * setShadowLayer(size / 5, 0, size, color)。客户端只在 Android 7.1 以下绘制，导出时由
 * font-bake-export 按同一参数切进图片，所以预览按切片后的样子显示。
 */
export function withTextShadow<T>(
  context: CanvasRenderingContext2D,
  visual: Pick<TextVisual, "shadowColor" | "shadowSize"> | undefined,
  draw: () => T,
): T {
  if (!visual) return draw()
  const { shadowColor } = visual
  const shadowSize = visual.shadowSize ?? 0
  if (!shadowColor || shadowSize <= 0 || isTransparentColor(shadowColor)) return draw()
  context.save()
  context.shadowColor = shadowColor
  context.shadowBlur = shadowSize / 5
  context.shadowOffsetX = 0
  context.shadowOffsetY = shadowSize
  const result = draw()
  context.restore()
  return result
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
  withTextShadow(context, visual.text, () =>
    context.fillText(visual.text!.text, destination.x + destination.width / 2, destination.y + destination.height / 2, destination.width * 0.9),
  )
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
      const shadowSize = Number(styles.get(section, "BORDER_SIZE"))
      const shadowColor = parseColor(styles.get(section, "BORDER_COLOR"))
      if (result.shadowSize === undefined && Number.isFinite(shadowSize) && shadowSize > 0) result.shadowSize = shadowSize
      if (result.shadowColor === undefined && shadowColor && !isTransparentColor(shadowColor)) result.shadowColor = shadowColor
      if (result.color === undefined && color) result.color = color
      const weight = fontWeight(styles.get(section, "FONT_WEIGHT"))
      if (result.weight === undefined && weight) result.weight = weight
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

type EmbeddedFont = { family: string; ready: Promise<void> }

let embeddedFontID = 0
// 字体缓存按归档里的字节对象复用：同一份字体只加载一次；重新导入同名文件后字节对象变了，
// 这里会加载新的 FontFace，预览不会继续用旧字形。
const embeddedFonts = new WeakMap<SkinArchive, Map<string, { bytes: Uint8Array; font: EmbeddedFont }>>()

export function embeddedFontPath(
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
    ].find((candidate) => archive.getBytes(candidate) !== undefined)
    if (path) this.styles = IniDocument.parse(archive.getText(path))
    const fontPath = path && this.styles
      ? embeddedFontPath(archive.names(), path, this.styles.get("GLOBAL", "FONT_PATH"))
      : undefined
    const embeddedFont = fontPath ? loadEmbeddedFont(archive, fontPath) : undefined
    this.embeddedFontFamily = embeddedFont?.family
    const fonts = [embeddedFont?.ready]
    // Android 的旧 CSS 引擎只解析 [GLOBAL] FONT_PATH（CssLoader.t()），[STYLE*] 的 FONT_NAME 和
    // 样式级 FONT_PATH 都没有分支（StyleParam.v()），GLOBAL 字体也不作用于按键文字。导出 BDS 时按
    // 下面同样的规则把按键文字切成图片（font-bake-export.ts），所以 BDS 预览的就是导出后的样子：
    // 指向皮肤字体文件的 FONT_PATH / FONT_NAME 生效，系统字体名无法切片，不生效。
    if (path && this.styles) {
      // [STYLE*] FONT_PATH：皮肤里已经写了才支持，内嵌字体优先于 FONT_NAME。
      for (const { section, key, value } of this.styles.entries()) {
        if (key !== "FONT_PATH" || section === "GLOBAL") continue
        const source = embeddedFontPath(archive.names(), path, value)
        const font = source && loadEmbeddedFont(archive, source)
        if (!font) continue
        this.styles.set(section, "FONT_NAME", font.family)
        fonts.push(font.ready)
      }
      // FONT_NAME 可以写 benxu、DROIDSANSFALLBACK.ttf 或系统字体名；只有落到归档文件才内嵌，
      // BDI 的系统字体名保持原样，由 canvasFontFamily 走系统字体回退。
      for (const { section, key, value } of this.styles.entries()) {
        if (key !== "FONT_NAME" || section === "GLOBAL" || value.startsWith("BdiEmbeddedFont")) continue
        const source = embeddedFontPath(archive.names(), path, value, true)
        const font = source && loadEmbeddedFont(archive, source)
        if (!font) {
          if (archive.format === "bds") this.styles.remove(section, key)
          continue
        }
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

  private tileSection(tiles: IniDocument, index: number): string | undefined {
    // iOS 按文件顺序取切片，Android 按 IMG 编号取切片。
    return this.archive.format === "bdi"
      ? tiles.sections().filter((section) => /^IMG\d+$/i.test(section))[index - 1]
      : `IMG${index}`
  }

  sourceSize(styleID: string, highlighted: boolean): { width: number; height: number } | undefined {
    if (!this.styles) return
    const spec = resolveVisualSpec(this.styles, styleID, highlighted)
    if (!spec?.imageName || !Number.isInteger(spec.tile)) return
    const tilePath = this.resourceRoots
      .map((root) => `${root}/${spec.imageName}.til`)
      .find((candidate) => this.archive.getBytes(candidate) !== undefined)
    if (!tilePath) return
    let tiles = this.tiles.get(tilePath)
    if (!tiles) {
      tiles = IniDocument.parse(this.archive.getText(tilePath))
      this.tiles.set(tilePath, tiles)
    }
    const section = this.tileSection(tiles, spec.tile!)
    const source = numbers(section === undefined ? undefined : tiles.get(section, "SOURCE_RECT"))
    return source ? { width: source[2], height: source[3] } : undefined
  }

  imagePath(styleID: string, highlighted: boolean): string | undefined {
    const spec = this.styles && resolveVisualSpec(this.styles, styleID, highlighted)
    if (!spec?.imageName || !Number.isInteger(spec.tile)) return
    return this.resourceRoots.map(root => `${root}/${spec.imageName}.png`)
      .find(path => this.archive.getBytes(path) && this.archive.getBytes(path.replace(/\.png$/i, ".til")))
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
        this.archive.getBytes(`${candidate}.png`) !== undefined &&
        this.archive.getBytes(`${candidate}.til`) !== undefined,
      )
    if (!base) return { color: spec.color, borderColor: spec.borderColor }
    const imagePath = `${base}.png`
    const tilePath = `${base}.til`
    const image = this.bitmap(imagePath)
    if (!image || this.archive.getBytes(tilePath) === undefined) {
      return { color: spec.color, borderColor: spec.borderColor }
    }

    let tiles = this.tiles.get(tilePath)
    if (!tiles) {
      tiles = IniDocument.parse(this.archive.getText(tilePath))
      this.tiles.set(tilePath, tiles)
    }
    const section = this.tileSection(tiles, spec.tile!)
    if (section === undefined) return { color: spec.color, borderColor: spec.borderColor }
    const source = numbers(tiles.get(section, "SOURCE_RECT"))
    if (!source) return { color: spec.color, borderColor: spec.borderColor }
    const absoluteInner = numbers(tiles.get(section, "INNER_RECT"))
    // 工具书 V6 p162：无 INNER_RECT 或宽高为 0 时不拉伸。
    const inner = absoluteInner && absoluteInner[2] > 0 && absoluteInner[3] > 0
      ? ([
          absoluteInner[0] - source[0],
          absoluteInner[1] - source[1],
          absoluteInner[2],
          absoluteInner[3],
        ] as [number, number, number, number])
      : undefined
    const scale = scaleNumbers(tiles.get(section, "SCALE"))
    const bitmap = await image
    if (!bitmap) return { color: spec.color, borderColor: spec.borderColor }
    return { image: bitmap, imagePath, source, inner, scale, color: spec.color, borderColor: spec.borderColor }
  }

  async resolveToolbarImages(limit?: number): Promise<ToolbarVisual[]> {
    const plistPath = `${this.theme}/skin/res/logo/com.baidu.inputmethod.toolbarMenuItems.plist`
    if (this.archive.format === "bdi") {
      const items = limit === Number.POSITIVE_INFINITY ? bdiMenuIcons(this.archive.getBytes(plistPath))
        : bdiToolbarIcons(this.archive.getBytes(plistPath)).slice(0, Math.max(0, limit ?? 4))
      return Promise.all(items.map(async (item) => {
        const prefix = `${this.theme}/skin/res/logo/${item.path}`
        const candidates = /@3x$/i.test(item.path) ? [`${prefix}.png`] : [`${prefix}_iphone@3x.png`, `${prefix}@3x.png`, `${prefix}.png`]
        const path = candidates.find((name) => this.archive.getBytes(name)) ?? candidates[0]
        const image = await this.bitmap(path)
        return {
          label: item.label, defaultIcon: item.icon, imagePath: path,
          menu: { path: plistPath, id: item.id, image: item.path, position: item.position },
          ...image ? { image, source: [0, 0, image.width, image.height] as [number, number, number, number] } : {},
        }
      }))
    }
    // Android reads res/logo/pop_menu_icons, never the plist; a BDS this editor exports keeps the iOS plist as well,
    // so the archive format decides — otherwise the preview would promise icons the phone does not draw.
    return this.resolveAndroidToolbarImages(limit)
  }

  /**
   * Android fills the F14 container from the user's function list, drawing each function with IMG<bitmap index>
   * of res/logo/pop_menu_icons (Baidu 13.3.18.31 LogoIconSource). The preview shows the toolbar functions the atlas
   * covers — 表情 26, 输入方式 27, 语音 29, 搜索 31, 编辑 25, 剪贴板 50 — since the real list lives on the phone.
   */
  private async resolveAndroidToolbarImages(limit?: number): Promise<ToolbarVisual[]> {
    const path = `${this.theme}/skin/res/logo/pop_menu_icons`
    const all = limit === Number.POSITIVE_INFINITY
    const tiles = IniDocument.parse(this.archive.isText(`${path}.til`) ? this.archive.getText(`${path}.til`) : "")
    const image = await this.bitmap(`${path}.png`)
    // 缺图保留默认功能位，画布和检查器使用默认图标，查看时不创建资源。
    const functions = all ? ANDROID_TOOLBAR_ICONS : ANDROID_TOOLBAR_ICONS.slice(0, 6)
    const sources = functions.map(([index, label, defaultIcon]) => {
      const source = numbers(tiles.get(`IMG${index}`, "SOURCE_RECT"))
      const valid = image && source && source.every(Number.isInteger) && source[0] >= 0 && source[1] >= 0 && source[2] > 0 && source[3] > 0 && source[0] + source[2] <= image.width && source[1] + source[3] <= image.height
      return { source: valid ? source : undefined, label, defaultIcon, index }
    }).slice(0, Math.max(0, limit ?? Number.POSITIVE_INFINITY))
    // ImginiLoader crops each icon before scaling; sampling the atlas directly bleeds adjacent tiles.
    return Promise.all(sources.map(async ({ source, label, defaultIcon, index }) => ({
      imagePath: `${path}.png`,
      atlas: { path: `${path}.til`, index }, label, defaultIcon,
      ...image && source ? {
        image: await createImageBitmap(image, ...source), imageSource: source,
        source: [0, 0, source[2], source[3]] as [number, number, number, number],
      } : {},
    })))
  }

  resolveText(foreground: string, highlighted: boolean): TextVisual | undefined {
    if (!this.styles) return
    return resolveTextVisual(this.styles, foreground, highlighted, this.embeddedFontFamily)
  }

  resolveListText(foreground: string, highlighted: boolean): TextVisual | undefined {
    const visual = this.resolveText(foreground, highlighted)
    if (!visual || this.archive.format !== "bds") return visual
    // SubList.n()/u(): LIST has its own user-font paint; fixed NAMES use 1.2× text size.
    // shortcut: runtime skin-font injection depends on the phone's font settings; preview the default paint.
    return { ...visual, fontName: undefined, weight: undefined, fontSize: visual.fontSize === undefined ? undefined : visual.fontSize * 1.2 }
  }

  resolveStyleText(styleID: string, highlighted: boolean): StyleTextVisual | undefined {
    if (!this.styles) return
    return resolveStyleTextVisual(this.styles, styleID, highlighted, this.embeddedFontFamily)
  }
}
