// Baidu INI skin (BDS/BDI) → Sogou phone skin.
//
// The reverse of ssf-to-baidu.ts with the same key table: every Baidu key names one Sogou key class,
// the first key reaching a class decides its look. Atlas slices are cut into standalone PNGs (Sogou
// references whole files), INNER_RECT becomes the Sogou stretch band, and a key's foreground layers
// are flattened into one image whose place on the key becomes FG_RECT. The Sogou background spans
// the candidate bar and keys; its top strip stays transparent beneath the separate candidate image.
// Light/dark themes become day/night statuses.

import { strToU8, zipSync } from "fflate"
import { IniDocument } from "../ini.ts"
import { resolveCandidateRect } from "../candidate-style.ts"
import { parseXmlPlist } from "../palm/palm-plist.ts"
import { offsetFromSection, previewItems } from "../preview-items.ts"
import { SkinArchive } from "../skin.ts"
import { withDirectoryEntries } from "../skin-zip.ts"
import { soundAsWav, soundPathForFilename } from "../sounds.ts"
import { ssfBoard, ssfKeyBinding, ssfQwerty, type SsfKeyBinding } from "./ssf-keymap.ts"
import { ssfClassTextStyles } from "./ssf-parts.ts"
import { BaiduSsfMotion } from "./baidu-anim-to-ssf.ts"
import { compositeImage, cropImage, decodePng, encodePng, placeImage, resizeImage, type RgbaImage } from "./ssf-png.ts"

type Theme = "light" | "dark"
type SliceImage = { image: RgbaImage; stretch?: [number, number, number, number] }
type StylePair = { normal?: SliceImage; pressed?: SliceImage; color?: string; pressedColor?: string }
type Foreground = { normal: RgbaImage; pressed: RgbaImage; rect: string }
type KeySample = { binding: SsfKeyBinding; back: StylePair; fore?: Foreground; labelColor?: string; labelPressedColor?: string }

const SOGOU_WIDTH = 1080
const SOGOU_BAR_HEIGHT = 126
const SOGOU_KEYBOARD_HEIGHT = 720
const STATUS: Record<Theme, string> = { light: "status1", dark: "status2" }

function numbers(value: string | undefined): number[] {
  return value?.split(",").map((part) => Number(part.trim())) ?? []
}

function baiduColor(value: string | undefined): string | undefined {
  const hex = value?.trim().replace(/^(?:0x|#)/i, "")
  if (!hex || !/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) return
  return `0x${(hex.length === 6 ? `FF${hex}` : hex).toUpperCase()}`
}

function solid(color: string, size = 8): RgbaImage {
  const value = Number.parseInt(color.replace(/^0x/i, ""), 16) >>> 0
  const data = new Uint8Array(size * size * 4)
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = (value >>> 16) & 0xff
    data[offset + 1] = (value >>> 8) & 0xff
    data[offset + 2] = value & 0xff
    data[offset + 3] = value >>> 24
  }
  return { width: size, height: size, data }
}

/** FNV-1a over the pixels: identical slices cut for different keys share one file. */
function contentHash(data: Uint8Array): string {
  let hash = 0x811c9dc5
  for (const byte of data) hash = Math.imul(hash ^ byte, 0x01000193)
  return (hash >>> 0).toString(16)
}

/** Resolves Baidu `STYLEn` ids of one theme into cropped slice images and colours. */
class BaiduStyles {
  readonly styles: IniDocument
  private atlases = new Map<string, RgbaImage | undefined>()
  private tiles = new Map<string, IniDocument | undefined>()
  private slices = new Map<string, SliceImage | undefined>()
  private readonly archive: SkinArchive
  private readonly roots: string[]
  private readonly warnings: string[]
  /** Sogou pixels per Baidu layout unit, from the portrait panel width. */
  readonly scale: number

  /** Styles and atlases live in `<orientation>/res/` when present, otherwise in the theme's `res/`. */
  constructor(archive: SkinArchive, theme: Theme, orientation: "port" | "land", warnings: string[]) {
    this.archive = archive
    this.warnings = warnings
    this.roots = [`${theme}/skin/${orientation}/res`, `${theme}/skin/res`]
    const gen = `${theme}/skin/port/gen.ini`
    const width = numbers(archive.isText(gen) ? IniDocument.parse(archive.getText(gen)).get("PANEL", "SIZE") : undefined)[0]
    this.scale = width > 0 ? SOGOU_WIDTH / width : 1
    const css = this.roots.map((root) => `${root}/default.css`).find((path) => archive.isText(path))
    this.styles = IniDocument.parse(css ? archive.getText(css) : "")
  }

  private slice(value: string | undefined): SliceImage | undefined {
    const [name, tileValue] = value?.split(",").map((part) => part.trim()) ?? []
    if (!name) return
    const key = `${name},${tileValue}`
    if (!this.slices.has(key)) this.slices.set(key, this.cut(name, tileValue))
    return this.slices.get(key)
  }

  private cut(name: string, tileValue: string | undefined): SliceImage | undefined {
    const base = this.roots.map((root) => `${root}/${name}`).find((path) => this.archive.getBytes(`${path}.png`)) ?? `${this.roots[1]}/${name}`
    if (!this.atlases.has(name)) {
      let atlas: RgbaImage | undefined
      const bytes = this.archive.getBytes(`${base}.png`)
      try {
        atlas = bytes ? decodePng(bytes) : undefined
      } catch (error) {
        this.warnings.push(`${name}.png 无法解码（${error instanceof Error ? error.message : error}），已跳过`)
      }
      this.atlases.set(name, atlas)
      this.tiles.set(name, this.archive.isText(`${base}.til`) ? IniDocument.parse(this.archive.getText(`${base}.til`)) : undefined)
    }
    const atlas = this.atlases.get(name)
    if (!atlas) return
    const tiles = this.tiles.get(name)
    const source = numbers(tiles?.get(`IMG${tileValue || 1}`, "SOURCE_RECT"))
    const [left, top, right, bottom] = source.length === 4 && source.every(Number.isFinite)
      ? [source[0], source[1], source[0] + source[2], source[1] + source[3]]
      : [0, 0, atlas.width, atlas.height]
    // A slice never reaches outside its atlas, whatever the .til claims.
    const x = Math.max(0, Math.round(left))
    const y = Math.max(0, Math.round(top))
    const width = Math.min(atlas.width, Math.round(right)) - x
    const height = Math.min(atlas.height, Math.round(bottom)) - y
    if (width <= 0 || height <= 0) return
    const inner = numbers(tiles?.get(`IMG${tileValue || 1}`, "INNER_RECT"))
    const stretch = inner.length === 4 && inner[2] > 0 && inner[3] > 0
      ? [inner[0] - x, inner[0] - x + inner[2], inner[1] - y, inner[1] - y + inner[3]] as [number, number, number, number]
      : undefined
    const image = cropImage(atlas, x, y, width, height)
    // Both draw nine-slice borders at their own size: Baidu in layout units, Sogou in 1080-wide pixels.
    if (!stretch || this.scale === 1) return { image, stretch }
    const scaledWidth = Math.max(1, Math.round(width * this.scale))
    const scaledHeight = Math.max(1, Math.round(height * this.scale))
    return {
      image: resizeImage(image, scaledWidth, scaledHeight),
      stretch: stretch.map((value, index) => Math.round(value * (index < 2 ? scaledWidth / width : scaledHeight / height))) as [number, number, number, number],
    }
  }

  resolve(styleID: string | undefined): StylePair | undefined {
    const section = `STYLE${styleID?.split(",")[0].trim()}`
    if (!styleID || !this.styles.sections().includes(section)) return
    const normalImage = this.styles.get(section, "NM_IMG")
    const normal = this.slice(normalImage)
    const pressed = this.slice(this.styles.get(section, "HL_IMG") ?? normalImage) ?? normal
    const color = baiduColor(this.styles.get(section, "NM_COLOR"))
    const pressedColor = baiduColor(this.styles.get(section, "HL_COLOR")) ?? color
    if (!normal && !color) return
    return { normal, pressed, color, pressedColor }
  }
}

/** Writes one Sogou status folder: phoneSkin.ini, keys.ini and the images they name. */
class StatusWriter {
  readonly skin = IniDocument.parse("")
  readonly keys = IniDocument.parse("")
  private images = new Map<string, Array<{ data: Uint8Array; filename: string }>>()
  private nextImage = 1
  private readonly folder: string
  private readonly output: Map<string, Uint8Array>

  constructor(folder: string, output: Map<string, Uint8Array>) {
    this.folder = folder
    this.output = output
    this.skin.appendSection("General", [
      { key: "SMA_Key9AZUserDefine", value: "1" },
      { key: "SMA_Key9FunUserDefine", value: "1" },
      { key: "SMA_Key26AZUserDefine", value: "1" },
      { key: "SMA_Key26FunUserDefine", value: "1" },
    ])
  }

  file(image: RgbaImage, name?: string): string {
    const key = `${image.width}x${image.height}:${contentHash(image.data)}`
    const candidates = this.images.get(key) ?? []
    const same = name ? undefined : candidates.find((entry) => entry.data.length === image.data.length && entry.data.every((byte, index) => byte === image.data[index]))
    if (same) return same.filename
    const filename = name ?? `bd${this.nextImage++}.png`
    this.output.set(`${this.folder}${filename}`, encodePng(image))
    this.images.set(key, [...candidates, { data: image.data, filename }])
    return filename
  }

  imageValue(slice: SliceImage, name?: string): string {
    const filename = this.file(slice.image, name)
    return slice.stretch ? `${filename},${slice.stretch.join(",")}` : filename
  }

  /** NORMAL/PRESSED plus the toggled (`_ON`) and disabled states Sogou also reads. */
  stateSection(section: string, pair: StylePair): boolean {
    const normal = pair.normal ?? (pair.color ? { image: solid(pair.color), stretch: [1, 7, 1, 7] as [number, number, number, number] } : undefined)
    if (!normal) return false
    const pressed = pair.pressed ?? (pair.pressedColor ? { image: solid(pair.pressedColor), stretch: [1, 7, 1, 7] as [number, number, number, number] } : normal)
    const normalValue = this.imageValue(normal)
    const pressedValue = this.imageValue(pressed)
    this.skin.appendSection(section, [
      { key: "NORMAL", value: normalValue },
      { key: "PRESSED", value: pressedValue },
      { key: "DISABLED", value: normalValue },
      { key: "NORMAL_ON", value: normalValue },
      { key: "PRESSED_ON", value: pressedValue },
    ])
    return true
  }

  write(): void {
    this.output.set(`${this.folder}phoneSkin.ini`, strToU8(this.skin.toString()))
    this.output.set(`${this.folder}keys.ini`, strToU8(this.keys.toString()))
  }
}

function bgSectionName(section: string, layout: string): string {
  const prefix = /^(py26|en26|num26)$/.test(ssfBoard(layout)) ? "SMA_Key26Bg_" : "SMA_Key9Bg_"
  return `${prefix}${section.replace(/^Key_/, "")}`
}

const MAIN_LAYOUTS = ["py_26", "py_9", "en_26", "en_9", "num_26", "num_9", "bh"]

function layoutRank(path: string): number {
  const main = MAIN_LAYOUTS.indexOf(path.split("/").pop()!.replace(/\.ini$/i, ""))
  if (main >= 0) return main
  return ssfBoard(path) === "other" ? MAIN_LAYOUTS.length + 1 : MAIN_LAYOUTS.length
}

function offsetValue(value: string | undefined): [number, number] | undefined {
  const offset = numbers(value)
  return offset.length === 2 && offset.every(Number.isFinite) ? [offset[0], offset[1]] : undefined
}

/**
 * Every image layer of a key drawn the way Baidu does (centred at its own size, then offset) and cut
 * to the area they cover, with that area as a Sogou FG_RECT (fractions of the key).
 */
function foreground(layers: Array<{ pair?: StylePair; offset: [number, number] }>, width: number, height: number, scale: number): Foreground | undefined {
  const images = layers.filter((layer) => layer.pair?.normal)
  if (!images.length) return
  const draw = (pick: (pair: StylePair) => SliceImage | undefined) => images.reduce((canvas, { pair, offset }) => {
    const image = (pick(pair!) ?? pair!.normal!).image
    return compositeImage(canvas, placeImage(image, width, height, Math.round((width - image.width) / 2 + offset[0]), Math.round((height - image.height) / 2 + offset[1])))
  }, { width, height, data: new Uint8Array(width * height * 4) } as RgbaImage)
  const normal = draw((pair) => pair.normal)
  const pressed = draw((pair) => pair.pressed)
  let [left, top, right, bottom] = [width, height, 0, 0]
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4 + 3
      if (!normal.data[offset] && !pressed.data[offset]) continue
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x + 1)
      bottom = Math.max(bottom, y + 1)
    }
  }
  // Layers that draw nothing still hide the glyph a template would put there.
  if (right <= left || bottom <= top) [left, top, right, bottom] = [0, 0, 1, 1]
  const fraction = (value: number) => Number(value.toFixed(3))
  // Sogou images are in its own pixels, so a 480-wide Baidu skin's glyphs grow to match.
  const cut = (image: RgbaImage) => resizeImage(cropImage(image, left, top, right - left, bottom - top), Math.max(1, Math.round((right - left) * scale)), Math.max(1, Math.round((bottom - top) * scale)))
  return {
    normal: cut(normal),
    pressed: cut(pressed),
    rect: [left / width, top / height, right / width, bottom / height].map(fraction).join(","),
  }
}

/** Collects, per Sogou key class, the first Baidu key that reaches it. */
function sampleKeys(archive: SkinArchive, theme: Theme, warnings: string[]): Map<string, KeySample & { layout: string }> {
  const samples = new Map<string, KeySample & { layout: string }>()
  for (const orientation of ["port", "land"] as const) {
    const styles = new BaiduStyles(archive, theme, orientation, warnings)
    const prefix = `${theme}/skin/${orientation}/`
    const gen = archive.isText(`${prefix}gen.ini`) ? IniDocument.parse(archive.getText(`${prefix}gen.ini`)) : undefined
    const layouts = archive.names().filter((path) => path.startsWith(prefix) && /^[^/]+\.ini$/.test(path.slice(prefix.length)) && !path.endsWith("/gen.ini"))
    // Several boards share a Sogou class (`Key_Q`, `Key_Space`): the main pinyin boards decide it,
    // then the other boards Sogou styles per class, and symbol pages last.
    layouts.sort((a, b) => layoutRank(a) - layoutRank(b) || a.localeCompare(b))
    for (const path of layouts) {
      const layout = path.slice(prefix.length, -4)
      const document = IniDocument.parse(archive.getText(path))
      for (const section of document.sections().filter((name) => /^KEY\d+$/.test(name))) {
        const action = document.get(section, "CENTER")?.trim()
        if (!action) continue
        const binding = ssfKeyBinding(layout, action, orientation === "land")
        const name = binding.sections[0] ?? `${binding.defaults[0]}`
        if (samples.has(name)) continue
        const back = styles.resolve(document.get(section, "BACK_STYLE"))
        if (!back) continue
        const foreIDs = document.get(section, "FORE_STYLE")?.split(",").map((value) => value.trim()).filter(Boolean) ?? []
        const offsets = document.get(section, "FORE_OFFSET")?.split(";") ?? []
        const positions = document.get(section, "POS_TYPE")?.split(",") ?? []
        const [, , width, height] = numbers(document.get(section, "VIEW_RECT"))
        const layers = foreIDs.map((id, index) => ({
          pair: styles.resolve(id),
          offset: offsetValue(offsets[index]) ?? offsetFromSection(gen, `OFFSET${positions[index]?.trim()}`, { width, height }) ?? [0, 0],
        }))
        const text = layers.find(({ pair }) => pair?.color && !pair.normal)?.pair
        const fore = width > 0 && height > 0 ? foreground(layers, Math.round(width), Math.round(height), styles.scale) : undefined
        samples.set(name, { layout, binding, back, fore, labelColor: text?.color, labelPressedColor: text?.pressedColor })
      }
    }
  }
  return samples
}

/**
 * Where a theme keeps its keyboard and candidate bar styles: INI skins in gen.ini and its `.cnd`,
 * skins converted from BDA in each layout's own [PANEL] / [CAND].
 */
function styleSources(archive: SkinArchive, theme: Theme): { panel: IniDocument[]; cand: IniDocument[] } {
  const parse = (path: string) => archive.isText(path) ? [IniDocument.parse(archive.getText(path))] : []
  const root = `${theme}/skin/port/`
  const gen = parse(`${root}gen.ini`)
  const candName = gen[0]?.get("CAND", "LAYOUT_NAME")?.trim()
  const layouts = [...parse(`${root}py_26.ini`), ...parse(`${root}py_9.ini`)]
  return { panel: [...gen, ...layouts], cand: [...(candName ? parse(`${root}${candName}.cnd`) : []), ...layouts] }
}

/** The first style among `documents` that actually resolves (a copied base gen.ini may name a missing one). */
function firstStyle(styles: BaiduStyles, documents: IniDocument[], section: string, key: string): StylePair | undefined {
  for (const document of documents) {
    const style = styles.resolve(document.get(section, key)?.trim())
    if (style) return style
  }
}

/** Stacks the candidate bar strip above the keyboard panel the way Sogou's single background does. */
function keyboardBackground(styles: BaiduStyles, archive: SkinArchive, theme: Theme, warnings: string[]): { background?: RgbaImage; bar?: RgbaImage } {
  const sources = styleSources(archive, theme)
  const fill = (pair: StylePair | undefined, height: number) => {
    if (pair?.normal) return resizeImage(pair.normal.image, SOGOU_WIDTH, height)
    return pair?.color ? resizeImage(solid(pair.color), SOGOU_WIDTH, height) : undefined
  }
  const native = sources.panel[0]?.get("LOGO", "LAYOUT_NAME") || archive.getBytes(`${theme}/skin/res/logo/com.baidu.inputmethod.toolbarMenuItems.plist`)
  // Native toolbar artwork follows the 1080-wide Sogou skeleton, not the older 126/720 image canvas.
  const barHeight = native ? 120 : SOGOU_BAR_HEIGHT
  const panelHeight = native ? 642 : SOGOU_KEYBOARD_HEIGHT
  const panel = fill(firstStyle(styles, sources.panel, "PANEL", "BACK_STYLE"), panelHeight)
  const height = native ? Math.max(1, Math.min(barHeight,
    Math.round(resolveCandidateRect(sources.cand[0], sources.panel[0]).height * styles.scale))) : SOGOU_BAR_HEIGHT
  let bar = fill(firstStyle(styles, sources.cand, "CAND", "BACK_STYLE"), height)
  if (bar && height !== barHeight) {
    const input = firstStyle(styles, sources.panel, "SCAND", "BACK_STYLE")
    const under = fill(input ?? firstStyle(styles, sources.panel, "PANEL", "BACK_STYLE"), barHeight)
    const y = input ? barHeight - height : Math.floor((barHeight - height) / 2)
    const placed = placeImage(bar, SOGOU_WIDTH, barHeight, 0, y)
    bar = under ? compositeImage(under, placed) : placed
    warnings.push("搜狗工具栏高度由客户端原生布局决定；已按百度的可见高度保留背景图案比例，剩余区域填充输入区或键盘背景")
  }
  if (!panel) return { bar }
  // CandidateView draws bar.png over RootView; its strip stays transparent to avoid doubling alpha.
  return { background: placeImage(panel, SOGOU_WIDTH, barHeight + panelHeight, 0, barHeight), bar }
}

function candidateColors(archive: SkinArchive, theme: Theme, styles: BaiduStyles): StylePair | undefined {
  return firstStyle(styles, styleSources(archive, theme).cand, "CAND", "FORE_STYLE")
}

/** Match toolbar actions, not slot numbers: Baidu skins can reorder their icons. */
function toolbarImages(archive: SkinArchive, theme: Theme, styles: BaiduStyles, writer: StatusWriter): void {
  const names: Record<string, string> = {
    F31: "logo.png", F7: "ime_function_expression.png", F13: "ime_function_switch.png",
    F72: "ime_function_voice.png", F82: "ime_function_sousou.png", F68: "ime_function_fanlingxi.png", F8: "close.png",
  }
  for (const document of styleSources(archive, theme).cand) {
    for (const section of document.sections().filter((name) => /^ICON\d+$/.test(name))) {
      const name = names[document.get(section, "KEY")?.trim() ?? ""]
      const pair = styles.resolve(document.get(section, "FORE_STYLE"))
      if (!name || !pair?.normal) continue
      for (const [slice, filename] of [[pair.normal, name], [pair.pressed ?? pair.normal, name.replace(/\.png$/, "_p.png")]] as const) {
        // Non-stretch slices still use Baidu layout pixels; Sogou icons use 1080-wide pixels.
        const scale = slice.stretch ? 1 : styles.scale
        writer.file(resizeImage(slice.image, Math.max(1, Math.round(slice.image.width * scale)), Math.max(1, Math.round(slice.image.height * scale))), filename)
      }
    }
  }
  const root = `${theme}/skin/res/logo/`
  const plist = archive.getBytes(`${root}com.baidu.inputmethod.toolbarMenuItems.plist`)
  const menu = plist && parseXmlPlist(plist)
  if (!Array.isArray(menu)) return
  const nativeNames: Record<string, string> = {
    '19': names.F7, '17': names.F13, '23': names.F72, '26': names.F82,
    '18': "ime_function_textedit.png", '35': "ime_function_clipboard.png", '45': names.F68,
  }
  const sources = styleSources(archive, theme)
  const containers = sources.cand.flatMap((document) => {
    const { width, height } = resolveCandidateRect(document, sources.panel[0])
    return previewItems(document, width, height).filter(({ center, rect }) => center === "F14"
      && rect.x < width && rect.x + rect.width > 0 && rect.y < height && rect.y + rect.height > 0)
      .map(({ rect }) => rect.height)
  })
  for (const value of menu) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue
    const filename = nativeNames[String(value.Name)]
    const states = (value.Images as { Normal?: { Normal?: string; Highlight?: string } } | undefined)?.Normal
    if (!filename || !states?.Normal) continue
    for (const [name, output] of [[states.Normal, filename], [states.Highlight ?? states.Normal, filename.replace(/\.png$/, "_p.png")]]) {
      const bytes = [name, `${name}_iphone@3x.png`, `${name}.png`].map((name) => archive.getBytes(`${root}${name}`)).find(Boolean)
      if (!bytes) continue
      const image = decodePng(bytes)
      const scale = Math.min(1, Math.min(...containers) / image.height) * styles.scale
      writer.file(resizeImage(image, Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale))), output)
    }
  }
}

function convertAnimations(archive: SkinArchive, theme: Theme, writer: StatusWriter, folder: string, output: Map<string, Uint8Array>, warnings: string[]): void {
  const animations = IniDocument.parse("")
  const chosen = new Set<string>()
  for (const orientation of ["port", "land"] as const) {
    const prefix = `${theme}/skin/${orientation}/`
    const animationPaths = [`${theme}/skin/res/anim.ini`, `${prefix}res/anim.ini`].filter(path => archive.isText(path))
    if (!animationPaths.length) continue
    const sourceAnimations = IniDocument.parse("")
    for (const path of animationPaths) {
      const document = IniDocument.parse(archive.getText(path))
      for (const section of document.sections()) {
        if (!sourceAnimations.sections().includes(section)) sourceAnimations.appendSection(section, [])
        for (const { key, value } of document.entries(section)) sourceAnimations.set(section, key, value)
      }
    }
    const styles = new BaiduStyles(archive, theme, orientation, warnings)
    const motion = new BaiduSsfMotion(sourceAnimations, styles.styles, warnings, styles.scale, id => {
      const slice = styles.resolve(id)?.normal
      if (!slice) return
      const image = slice.image
      const scale = slice.stretch ? 1 : styles.scale
      const scaled = resizeImage(image, Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)))
      return { file: writer.file(scaled), width: scaled.width, height: scaled.height }
    }, animations)
    const gen = archive.isText(`${prefix}gen.ini`) ? IniDocument.parse(archive.getText(`${prefix}gen.ini`)) : undefined
    const fallbackSize = numbers(gen?.get("PANEL", "SIZE"))
    const layouts = archive.names().filter(path => path.startsWith(prefix) && /^[^/]+\.ini$/.test(path.slice(prefix.length)) && !path.endsWith("/gen.ini"))
      .sort((a, b) => layoutRank(a) - layoutRank(b) || a.localeCompare(b))
    for (const path of layouts) {
      const layout = IniDocument.parse(archive.getText(path))
      const panelSize = numbers(layout.get("PANEL", "SIZE"))
      const [boardWidth, boardHeight] = panelSize.length === 2 ? panelSize : fallbackSize
      for (const section of layout.sections().filter(name => /^KEY\d+$/.test(name))) {
        const action = layout.get(section, "CENTER")?.trim()
        if (!action) continue
        const keyClass = ssfKeyBinding(path.slice(prefix.length, -4), action, orientation === "land").sections[0]
        if (!keyClass || chosen.has(keyClass)) continue
        const [, , width, height] = numbers(layout.get(section, "VIEW_RECT"))
        if (!(width > 0 && height > 0 && boardWidth > 0 && boardHeight > 0)) continue
        chosen.add(keyClass)
        const style = motion.press(layout, section, { width, height }, { width: boardWidth, height: boardHeight })
        if (style) {
          if (!writer.keys.sections().includes(keyClass)) writer.keys.appendSection(keyClass, [])
          writer.keys.set(keyClass, "ANIM_STYLE", style)
        }
      }
    }
  }
  if (animations.sections().length) output.set(`${folder}anim.ini`, strToU8(animations.toString()))
}

function convertTheme(archive: SkinArchive, theme: Theme, folder: string, output: Map<string, Uint8Array>, warnings: string[], animations: boolean): void {
  const styles = new BaiduStyles(archive, theme, "port", warnings)
  const writer = new StatusWriter(folder, output)
  const samples = sampleKeys(archive, theme, warnings)
  const defaults = new Set<string>()
  // Sogou has no per-key text colour: a key's label takes its class's TextStyle (through the FG_STYLE
  // the app gives the key), so each class gets the colour most of its keys use.
  const labelColors = new Map<string, Map<string, number>>()
  for (const [section, sample] of samples) {
    const isDefault = !sample.binding.sections.length
    const bgName = isDefault ? section : bgSectionName(section, sample.layout)
    if (!writer.stateSection(bgName, sample.back)) continue
    for (const fallback of sample.binding.defaults) {
      if (defaults.has(fallback) || samples.has(fallback)) continue
      defaults.add(fallback)
      writer.stateSection(fallback, sample.back)
    }
    if (isDefault) continue
    writer.skin.appendSection(section, [{ key: "BG_IMAGES", value: bgName }])
    if (sample.labelColor) {
      const style = ssfClassTextStyles(sample.binding, ssfQwerty(sample.layout))[0]
      const colors = labelColors.get(style) ?? new Map<string, number>()
      const pair = `${sample.labelColor},${sample.labelPressedColor ?? sample.labelColor}`
      labelColors.set(style, colors.set(pair, (colors.get(pair) ?? 0) + 1))
    }
    if (sample.fore) {
      const foreName = `Foground_${section}`
      writer.keys.appendSection(section, [
        { key: "FG_IMAGES", value: foreName },
        { key: "FG_RECT", value: sample.fore.rect },
      ])
      const normal = writer.file(sample.fore.normal)
      const pressed = writer.file(sample.fore.pressed)
      writer.keys.appendSection(foreName, [
        { key: "NORMAL", value: normal },
        { key: "PRESSED", value: pressed },
        { key: "DISABLED", value: normal },
        { key: "NORMAL_ON", value: normal },
        { key: "PRESSED_ON", value: pressed },
      ])
    }
  }

  for (const [style, colors] of labelColors) {
    const [normal, pressed] = [...colors].sort((a, b) => b[1] - a[1])[0][0].split(",")
    writer.skin.appendSection(style, [{ key: "TEXT_COLOR", value: normal }, { key: "TEXT_COLOR_PRESSED", value: pressed }])
  }

  const { background, bar } = keyboardBackground(styles, archive, theme, warnings)
  if (background) writer.skin.appendSection("RootView", [{ key: "BG_STYLE", value: "1" }, { key: "BG_IMAGE", value: writer.file(background, "bg.png") }])
  else warnings.push(`${theme === "dark" ? "深色" : "浅色"}外观没有可转换的键盘背景`)
  if (bar) {
    writer.skin.appendSection("BgCandidate1", [{ key: "NORMAL", value: writer.file(bar, "bar.png") }])
    for (const view of ["CandidateView", "CandidateViewLand"]) {
      writer.skin.appendSection(view, [{ key: "BG_STYLE", value: "1" }, { key: "BG_IMAGE", value: "BgCandidate1" }])
    }
  }
  const candidate = candidateColors(archive, theme, styles)
  if (candidate?.color) {
    writer.skin.appendSection("TextStyle_Candidate", [{ key: "TEXT_COLOR", value: candidate.color }])
    writer.skin.appendSection("TextStyle_Candidate_Highlight", [{ key: "TEXT_COLOR", value: candidate.pressedColor ?? candidate.color }])
  }
  toolbarImages(archive, theme, styles, writer)
  // The 9-key symbol column is Sogou's candidate code view.
  const nine = `${theme}/skin/port/py_9.ini`
  const list = archive.isText(nine) ? IniDocument.parse(archive.getText(nine)) : undefined
  // A board's [LIST] usually only places the column; its styles are inherited from gen.ini.
  const listStyle = (key: string) => firstStyle(styles, [...(list ? [list] : []), ...styleSources(archive, theme).panel], "LIST", key)
  const listBack = listStyle("BACK_STYLE")
  const listCell = listStyle("CELL_STYLE")
  const codeView = [
    ...(listBack && writer.stateSection("BgCodeView", listBack) ? [{ key: "BG_IMAGE", value: "BgCodeView" }] : []),
    ...(listCell && writer.stateSection("BgCodeViewCell", listCell) ? [{ key: "BG_IMAGES", value: "BgCodeViewCell" }] : []),
  ]
  if (codeView.length) writer.skin.appendSection("CandidateCodeView", codeView)
  const listText = listStyle("FORE_STYLE")?.color
  if (listText) writer.skin.appendSection("TextStyle_Text", [{ key: "TEXT_COLOR", value: listText }])
  if (animations) convertAnimations(archive, theme, writer, folder, output, warnings)
  writer.write()
}

function infoValue(archive: SkinArchive, key: string): string | undefined {
  const bytes = archive.getBytes("Info.txt")
  return bytes ? new TextDecoder().decode(bytes).match(new RegExp(`^\\uFEFF?${key}=(.*)$`, "mi"))?.[1].trim() : undefined
}

/** Panel-level sounds; Sogou only has the per-key-class `sound`, so converting drops these. */
const PANEL_SOUND_FIELDS = ["PANEL_SHOW_SOUND_PATH", "PANEL_HIDE_SOUND_PATH"]

/** Sogou has one default sound plus per-key-class overrides; map Baidu layout keys to that table. */
async function soundFiles(archive: SkinArchive, themes: Theme[], output: Map<string, Uint8Array>, warnings: string[]): Promise<void> {
  const names = archive.names()
  const copied = new Map<string, { name: string; bytes: Uint8Array }>()
  const byName = new Map<string, Uint8Array>()
  const copySound = async (theme: Theme, orientation: "port" | "land", filename: string) => {
    const source = soundPathForFilename(names, theme, orientation, filename)
    if (!source) {
      warnings.push(`${theme}/skin/${orientation}/res/${filename} 不存在，无法转换按键音`)
      return
    }
    const previous = copied.get(source)
    if (previous) return previous
    try {
      const wav = await soundAsWav(archive.getBytes(source)!)
      const stem = (source.split("/").pop() ?? filename).replace(/\.[^.]+$/, "")
      let name = stem
      let suffix = 0
      while (byName.has(name) && (byName.get(name)!.length !== wav.length || !byName.get(name)!.every((byte, index) => byte === wav[index]))) {
        suffix++
        name = `${stem}_${theme}_${orientation}${suffix > 1 ? `_${suffix}` : ""}`
      }
      byName.set(name, wav)
      output.set(`default/${name}.wav`, wav)
      const result = { name, bytes: wav }
      copied.set(source, result)
      return result
    } catch (error) {
      warnings.push(`${source} 无法转换为 WAV（${error instanceof Error ? error.message : error}），已省略`)
    }
  }
  const defaults = new Map<Theme, { name: string; bytes: Uint8Array }>()
  const keySounds = new Map<string, { name: string; bytes: Uint8Array; theme: Theme; priority: number }>()
  for (const theme of themes) {
    for (const orientation of ["port", "land"] as const) {
      const prefix = `${theme}/skin/${orientation}/`
      const genPath = `${prefix}gen.ini`
      const gen = archive.isText(genPath) ? IniDocument.parse(archive.getText(genPath)) : undefined
      const styles = new BaiduStyles(archive, theme, orientation, warnings).styles
      // Sogou plays one sound per key class; a Baidu palette's panel show/hide sounds have nowhere to go.
      if (PANEL_SOUND_FIELDS.some((field) => styles.sections().some((section) => /^STYLE\d+$/.test(section) && styles.get(section, field)?.trim()))) {
        warnings.push("面板显示/隐藏音效在搜狗皮肤中没有对应，已忽略")
      }
      const soundForStyle = async (id: string | undefined) => {
        const filename = id && styles.get(`STYLE${id.split(",")[0].trim()}`, "PRESS_SOUND_PATH")?.trim()
        return filename ? copySound(theme, orientation, filename.split(/[\\/]/).pop()!) : undefined
      }
      const generalID = gen?.get("PANEL", "SOUND_STYLE")?.trim()
      const fallback = await soundForStyle(generalID)
      if (fallback && !defaults.has(theme)) defaults.set(theme, fallback)
      const layouts = names.filter((path) => path.startsWith(prefix) && /^[^/]+\.ini$/i.test(path.slice(prefix.length)) && !/^gen\.ini$/i.test(path.slice(prefix.length)))
        .sort((a, b) => layoutRank(a) - layoutRank(b) || a.localeCompare(b))
      for (const path of layouts) {
        const layoutName = path.slice(prefix.length, -4)
        const layout = IniDocument.parse(archive.getText(path))
        const panelID = layout.get("PANEL", "SOUND_STYLE")?.trim()
        const panelSound = panelID && panelID !== generalID ? await soundForStyle(panelID) : undefined
        for (const section of layout.sections().filter((name) => /^KEY\d+$/.test(name))) {
          const action = layout.get(section, "CENTER")?.trim()
          if (!action) continue
          const binding = ssfKeyBinding(layoutName, action, orientation === "land")
          const explicit = layout.get(section, "SOUND_STYLE")?.trim()
          const priority = explicit ? 2 : panelSound ? 1 : 0
          const key = binding.sections[0]
          // A key Sogou has no section for would only leave the copied file unreferenced in the package.
          if (!key || !priority) continue
          const sound = explicit ? await soundForStyle(explicit) : panelSound
          if (!sound) continue
          const previous = keySounds.get(key)
          if (!previous || priority > previous.priority) keySounds.set(key, { ...sound, theme, priority })
          else if (priority === previous.priority && (previous.bytes.length !== sound.bytes.length || !previous.bytes.every((byte, index) => byte === sound.bytes[index]))) {
            warnings.push(`${key} 在百度布局中配置了不同按键音，搜狗只能保留优先布局的音效`)
          }
        }
      }
    }
  }

  const fallback = themes.map((theme) => defaults.get(theme)).find(Boolean)
  const defaultConflict = themes.map((theme) => defaults.get(theme)).filter((sound): sound is { name: string; bytes: Uint8Array } => Boolean(sound))
    .some((sound) => sound.bytes.length !== fallback?.bytes.length || !sound.bytes.every((byte, index) => byte === fallback?.bytes[index]))
  if (defaultConflict) warnings.push("百度白天和夜间的默认按键音不同，搜狗格式只有一份默认音效，已优先使用白天音效")
  const sounds = IniDocument.parse("")
  sounds.appendSection("General", [{ key: "SUPPORT_SCREEN", value: String(SOGOU_WIDTH) }, { key: "VERSION", value: "1" }])
  if (fallback) sounds.appendSection("Key", [{ key: "sound", value: fallback.name }])
  for (const [section, sound] of keySounds) {
    if (fallback && sound.bytes.length === fallback.bytes.length && sound.bytes.every((byte, index) => byte === fallback.bytes[index])) continue
    sounds.appendSection(section, [{ key: "sound", value: sound.name }])
  }
  if (fallback || keySounds.size) output.set("default/sound_android.ini", strToU8(sounds.toString()))
}
/** Converts a Baidu BDS/BDI skin to Sogou `.ssf` bytes. */
export async function convertBaiduToSsf(archive: SkinArchive, options: { animations?: boolean } = {}): Promise<{ bytes: Uint8Array; warnings: string[] }> {
  if (archive.format === "bda") throw new Error("BDA 需要先转换为 BDS 再导出搜狗皮肤")
  if (archive.format === "bdi") archive = SkinArchive.open(archive.toBytes("bds"), "bds")
  const warnings: string[] = []
  const output = new Map<string, Uint8Array>()
  const themes = (["light", "dark"] as const).filter((theme) =>
    ["res", "port/res", "land/res"].some((root) => archive.isText(`${theme}/skin/${root}/default.css`)))
  if (!themes.length) throw new Error("皮肤缺少 res/default.css，无法转换")
  const dual = themes.length > 1
  for (const theme of themes) convertTheme(archive, theme, dual ? `${SOGOU_WIDTH}/${STATUS[theme]}/` : `${SOGOU_WIDTH}/`, output, warnings, options.animations !== false)

  const name = infoValue(archive, "Name") || "百度皮肤"
  const author = infoValue(archive, "Author") ?? ""
  const preview = archive.getBytes("demo.png")
  if (preview) output.set("square_preview.png", preview)
  output.set("phoneTheme.ini", strToU8([
    "[General]",
    "skin_type=1",
    `skin_name=${name}`,
    `skin_author=${author}`,
    "skin_version=10000",
    `supports-screens=${SOGOU_WIDTH}`,
    ...(preview ? ["preview_square=square_preview.png"] : []),
    "",
  ].join("\n")))
  if (dual) {
    output.set("time.ini", strToU8([
      "[General]", `SUPPORT_SCREEN=${SOGOU_WIDTH}`, "VERSION=1",
      `[${SOGOU_WIDTH}]`, "LOOP_TYPE=1", "STATUS_LIST=status1,status2",
      "[status1]", "START=7", "END=18",
      "[status2]", "START=0,19", "END=6,23", "",
    ].join("\n")))
  }
  await soundFiles(archive, themes, output, warnings)
  return { bytes: zipSync(Object.fromEntries(withDirectoryEntries(output)), { level: 6 }), warnings: [...new Set(warnings)] }
}
