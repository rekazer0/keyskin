// A Sogou skin drawn the way the Sogou keyboard draws it, read from phoneSkin.ini / keys.ini.
//
// Sogou skins style key classes and leave the layout to the app, so key geometry, the built-in labels
// and glyphs come from the official skeleton (extracted from the Sogou APK); everything the skin sets is
// read here directly:
// - one background (RootView) behind the candidate bar and the keys, the bar's own image over its strip;
// - a key's background from its class (BG_IMAGES), an Android nine-patch over the key;
// - its foreground from keys.ini (FG_IMAGES, fitted into FG_RECT keeping its ratio) or an ICON centred
//   at its own size; keys without one keep the built-in label or glyph, in the skin's label colour;
// - labels in the TextStyle the key's FG_STYLE names, placed in FG_STYLE's LABEL_POSITION and, when
//   MINOR_LABEL_VISIBLE is on, the nine-key digit in MINOR_LABEL_POSITION.

import { AtlasResolver, canvasFontFamily, loadEmbeddedFont, pngBitmap, type Visual } from "../atlas.ts"
import type { IniDocument } from "../ini.ts"
import { argbColor, imageAt, sceneKey, tintedVisual, type NativeScene, type SceneKey, type SceneLayer, type SceneText } from "../native-scene.ts"
import { offsetFromSection, parseOffset, parseRect, type Rect } from "../preview-items.ts"
import type { SkinArchive } from "../skin.ts"
import { ssfBoard, ssfKeyBinding, ssfQwerty, type SsfKeyBinding } from "./ssf-keymap.ts"
import { parseSsfImage, ssfColor, type SsfPackage, type SsfTheme } from "./ssf-package.ts"
import { firstValue, ssfBackground, ssfForeground, ssfLabelStyle, ssfTextSections } from "./ssf-parts.ts"

/** The nine-key letter groups' digits, the minor label Sogou shows when the skin turns it on. */
export const NINE_KEY_DIGITS: Record<string, string> = {
  Key_ABC: "2", Key_DEF: "3", Key_GHI: "4", Key_JKL: "5", Key_MNO: "6", Key_PQRS: "7", Key_TUV: "8", Key_WXYZ: "9",
}

type Label = Omit<SceneText, "text" | "x" | "y">

/** What one Sogou theme draws with, at `scale` layout units per Sogou pixel. */
export class SsfStyles {
  readonly pkg: SsfPackage
  readonly theme: SsfTheme
  readonly skin: IniDocument
  readonly keys: IniDocument
  private readonly archive: SkinArchive
  private readonly fonts: Promise<void>[] = []

  constructor(archive: SkinArchive, pkg: SsfPackage, theme: SsfTheme) {
    this.archive = archive
    this.pkg = pkg
    this.theme = theme
    this.skin = pkg.skin(theme)
    this.keys = pkg.keys(theme)
  }

  get sogouWidth(): number {
    return Number(this.pkg.resolution) || 1080
  }

  /** Waits for the typefaces the scene uses. */
  ready(): Promise<void> {
    return Promise.all(this.fonts).then(() => {})
  }

  async file(name: string | undefined, stretch?: [number, number, number, number]): Promise<Visual | undefined> {
    const bytes = name ? this.pkg.file(this.theme, name) : undefined
    const bitmap = bytes && await pngBitmap(bytes)
    if (!bitmap) return
    // Sogou's four numbers are the stretchable band: left..right across, top..bottom down.
    const inner = stretch && stretch[1] <= bitmap.width && stretch[3] <= bitmap.height
      ? [stretch[0], stretch[2], stretch[1] - stretch[0], stretch[3] - stretch[2]] as [number, number, number, number]
      : undefined
    return { image: bitmap, source: [0, 0, bitmap.width, bitmap.height], ...inner ? { inner } : {} }
  }

  async image(value: string | undefined): Promise<Visual | undefined> {
    const ref = parseSsfImage(value)
    return ref && this.file(ref.file, ref.stretch)
  }

  /** NORMAL and PRESSED of an image section; pressed falls back to normal. */
  async pair(section: string | undefined): Promise<[Visual | undefined, Visual | undefined]> {
    if (!section) return [undefined, undefined]
    const normal = await this.image(this.skin.get(section, "NORMAL"))
    return [normal, await this.image(this.skin.get(section, "PRESSED")) ?? normal]
  }

  color(section: string, field = "TEXT_COLOR"): string | undefined {
    return argbColor(ssfColor(this.skin.get(section, field)))
  }

  /** Size (TEXT_SIZE up to 1 is a share of the screen width), typeface and weight of a style chain. */
  text(sections: readonly string[], scale: number, defaultFont?: string): Partial<Label> {
    const value = (key: string) => sections.map((section) => this.skin.get(section, key)?.trim()).find(Boolean)
    const size = Number(value("TEXT_SIZE"))
    const name = value("TYPEFACE") ?? defaultFont
    const path = name && this.pkg.path(this.theme, name)
    const font = path ? loadEmbeddedFont(this.archive, path) : undefined
    if (font) this.fonts.push(font.ready)
    return {
      ...size > 0 ? { size: (size <= 1 ? size * this.sogouWidth : size) * scale } : {},
      ...font ? { font: font.family } : {},
      // Sogou's parser takes only the exact "true"; a style without BOLD keeps Sogou's bold labels.
      ...value("BOLD") !== undefined ? { weight: value("BOLD") === "true" ? 700 : 400 } : {},
    }
  }

  labelColor(binding: SsfKeyBinding, qwerty: boolean, pressed: boolean): string | undefined {
    for (const section of ssfTextSections(binding, qwerty, this.skin)) {
      const color = (pressed ? this.color(section, "TEXT_COLOR_PRESSED") : undefined) ?? this.color(section)
      if (color) return color
    }
    if (binding.keyClass === "function") return this.color("General", pressed ? "HIGH_LIGHT_ICON_COLOR" : "ICON_COLOR")
  }

  /** keys.ini FG_IMAGES (the `_ON` state on letter keys, which pinyin boards start in) or an ICON. */
  async foreground(binding: SsfKeyBinding, on: boolean, pressed: boolean): Promise<{ visual: Visual; rect?: number[] } | "none" | undefined> {
    const found = ssfForeground(this.skin, this.keys, binding)
    if (found?.kind === "keys") {
      const state = (name: string) => firstValue(this.keys.get(found.images, on ? `${name}_ON` : name)) ?? firstValue(this.keys.get(found.images, name))
      const visual = await this.file((pressed ? state("PRESSED") : undefined) ?? state("NORMAL"))
      return visual && { visual, rect: found.rect }
    }
    if (found?.kind === "icon") {
      const icon = (pressed ? firstValue(this.skin.get(found.owner, "ICON_PRESSED")) : undefined) ?? firstValue(this.skin.get(found.owner, "ICON"))
      const visual = await this.file(icon)
      return visual && { visual }
    }
    if (binding.sections.some((section) => /^transparent\.png$/i.test(firstValue(this.skin.get(section, "ICON")) ?? ""))) return "none"
  }
}

export function box(rect: Rect, fractions: number[] | undefined): Rect | undefined {
  if (fractions?.length !== 4 || !fractions.every(Number.isFinite)) return
  // Android RectF: left, top, right, bottom as shares of the key.
  const [left, top, right, bottom] = fractions
  if (!(right > left && bottom > top)) return
  return { x: rect.x + left * rect.width, y: rect.y + top * rect.height, width: (right - left) * rect.width, height: (bottom - top) * rect.height }
}

let measure: OffscreenCanvasRenderingContext2D | null | undefined

/** The largest size at which `text` fits `area` (Sogou sizes a label without TEXT_SIZE to its box). */
export function fitText(text: string, area: Rect, font: string | undefined, weight: number): number {
  measure ??= typeof OffscreenCanvas === "undefined" ? null : new OffscreenCanvas(1, 1).getContext("2d")
  if (!measure) return area.height
  measure.font = `${weight} ${area.height}px ${canvasFontFamily(font)}`
  const width = measure.measureText(text).width
  return width > area.width ? area.height * area.width / width : area.height
}

function fitted(visual: Visual, area: Rect): SceneLayer {
  const [, , width, height] = visual.source!
  const scale = Math.min(area.width / width, area.height / height)
  return { kind: "image", visual, rect: { x: area.x + (area.width - width * scale) / 2, y: area.y + (area.height - height * scale) / 2, width: width * scale, height: height * scale } }
}

export function centre(rect: Rect): [number, number] {
  return [rect.x + rect.width / 2, rect.y + rect.height / 2]
}

function scaled(visual: Visual, scale: number, x: number, y: number): SceneLayer | undefined {
  const layer = imageAt(visual, x, y)
  if (scale === 1 || layer?.kind !== "image") return layer
  const width = layer.rect.width * scale
  const height = layer.rect.height * scale
  return { ...layer, rect: { x: x - width / 2, y: y - height / 2, width, height } }
}

/**
 * `layout` is the board at the skin's resolution (key sections and geometry, as the canvas lists them);
 * `template` is the same board in the official skeleton, whose styles hold the built-in labels and
 * glyphs, `scale` the skeleton's size against the skin's.
 */
type SsfSkeleton = { layout: IniDocument; template: IniDocument; resolver: AtlasResolver; offsets?: IniDocument; scale: number }

/**
 * The FG_STYLE Sogou's own key definitions give a key, with its label and minor label TextStyles, for
 * the keys skins restyle through those sections (the APK's py_9 / qwerty layouts). Others keep the
 * skeleton's placement.
 */
function defaultForeground(binding: SsfKeyBinding, layoutName: string): { fgStyle: string; label?: string; minor?: string } | undefined {
  const board = ssfBoard(layoutName)
  if (binding.keyClass === "char") return { fgStyle: ssfQwerty(layoutName) ? "FGStyle_Qwerty" : "FGStyle_Phone" }
  if (board !== "py9" && board !== "en9") return
  const nine = board === "py9" ? "Py9" : "En9"
  if (binding.sections.includes("Key_SymbolTable")) return { fgStyle: `FGStyle_SymbolTable_${nine}` }
  if (binding.sections.includes("Key_SwitchToEN")) return { fgStyle: "FGStyle_Switch_Py9", label: "TextStyle_Switch", minor: "TextStyle_MinorLabel_Switch" }
  if (binding.sections.includes("Key_EnSwitchToCH")) return { fgStyle: "FGStyle_SwitchToCh_En9", label: "TextStyle_Switch", minor: "TextStyle_MinorLabel_Switch" }
}

/**
 * The skeleton key's built-in layers: glyphs tinted to the skin's label colour, the label and minor
 * label in their TextStyles. A label the skin places with FG_STYLE sits centred in that box, as large
 * as fits unless the TextStyle sets TEXT_SIZE, and bold unless it sets BOLD (as Sogou's own skin
 * previews draw them).
 */
async function builtInLayers(styles: SsfStyles, skeleton: SsfSkeleton, section: string, binding: SsfKeyBinding, layoutName: string, landscape: boolean, rect: Rect, pressed: boolean): Promise<SceneLayer[]> {
  const { template, resolver, offsets, scale } = skeleton
  const qwerty = ssfQwerty(layoutName)
  const own = ssfLabelStyle(styles.skin, binding)
  const defaults = own ? undefined : defaultForeground(binding, layoutName)
  const fgStyle = own?.fgStyle ?? (defaults && `${defaults.fgStyle}${landscape ? "_Land" : ""}`)
  const fg = (key: string) => fgStyle ? styles.skin.get(fgStyle, key)?.split(",").map(Number) : undefined
  const labelSections = [...defaults?.label ? [defaults.label] : [], ...ssfTextSections(binding, qwerty, styles.skin)]
  const minorStyle = (fgStyle && firstValue(styles.skin.get(fgStyle, "MINOR_LABEL_STYLE"))) ?? defaults?.minor
  const minorSections = minorStyle ? [minorStyle] : [`TextStyle_Phone_MinorLabel${landscape ? "_Land" : ""}`, "TextStyle_Phone_MinorLabel"]
  const textColor = (sections: string[]) => sections.map((name) => (pressed ? styles.color(name, "TEXT_COLOR_PRESSED") : undefined) ?? styles.color(name)).find(Boolean)
  const labelColor = textColor(labelSections.slice(0, defaults?.label ? 1 : 0)) ?? styles.labelColor(binding, qwerty, pressed)
  const minorColor = textColor(minorSections) ?? labelColor
  const label = styles.text(labelSections.slice(0, 1), scale)
  const minorText = styles.text(minorSections, scale)
  const labelBox = box(rect, fg("LABEL_POSITION"))
  const minorBox = fg("MINOR_LABEL_VISIBLE")?.[0] === 1 ? box(rect, fg("MINOR_LABEL_POSITION")) : undefined
  // Pinyin boards start in Sogou's upper-case state (S_FLAG=1).
  const caps = ["py9", "py26"].includes(ssfBoard(layoutName))
  const foreStyles = (template.get(section, "FORE_STYLE") ?? "").split(",").map((id) => id.trim()).filter(Boolean)
  const foreOffsets = (template.get(section, "FORE_OFFSET") ?? "").split(";").map(parseOffset)
  const positions = (template.get(section, "POS_TYPE") ?? "").split(",").map((id) => id.trim())
  const layers: SceneLayer[] = []
  const write = (text: string, look: Partial<Label>, color: string, place: Rect | undefined, fallback: [number, number], size: number) => {
    const [x, y] = place ? centre(place) : fallback
    const weight = look.weight ?? 700
    layers.push({ kind: "text", text: { text, x, y, size: look.size ?? (place ? fitText(text, place, look.font, weight) : size), color, weight, ...look.font ? { font: look.font } : {} } })
  }
  // The skin's own LABEL / MINOR_LABEL replace the built-in texts.
  const skinText = (field: string) => binding.sections.map((name) => firstValue(styles.skin.get(name, field))).find(Boolean)
  const texts = [skinText("LABEL"), skinText("MINOR_LABEL")]
  let count = 0
  for (const [index, id] of foreStyles.entries()) {
    const offset = foreOffsets[index] ?? offsetFromSection(offsets, `OFFSET${positions[index] ?? ""}`, { width: rect.width / scale, height: rect.height / scale }) ?? [0, 0]
    const [x, y] = centre(rect)
    const at: [number, number] = [x + offset[0] * scale, y + offset[1] * scale]
    const text = resolver.resolveStyleText(id, pressed)
    if (text) {
      const minor = count > 0
      const shown = texts[count++] ?? text.text
      const fallbackColor = text.color ?? "#373737"
      write(caps ? shown.toUpperCase() : shown, minor ? minorText : label, (minor ? minorColor : labelColor) ?? fallbackColor, minor ? minorBox : labelBox, at, (text.fontSize ?? 24) * scale)
      continue
    }
    const glyph = await resolver.resolve(id, pressed)
    if (!glyph?.image) continue
    const layer = scaled(labelColor ? await tintedVisual(glyph, labelColor) : glyph, scale, ...at)
    if (layer) layers.push(layer)
  }
  const digit = binding.sections.map((name) => NINE_KEY_DIGITS[name]).find(Boolean)
  if (digit && count === 1 && minorBox) write(texts[1] ?? digit, minorText, minorColor ?? "#373737", minorBox, centre(minorBox), minorBox.height)
  return layers
}

/** The 9-key symbol column, which Sogou styles as the candidate code view. */
async function listKeys(styles: SsfStyles, layout: IniDocument, scale: number): Promise<SceneKey[]> {
  const cell = layout.get("LIST", "CELL_SIZE")?.split(",").map(Number)
  const position = layout.get("LIST", "POS")?.split(",").map(Number)
  const count = Number(layout.get("LIST", "LIST_NUM"))
  const names = layout.get("LIST", "NAMES")?.trim().split(/\s+/) ?? []
  if (cell?.length !== 2 || position?.length !== 2 || !(count > 0)) return []
  const textStyle = firstValue(styles.skin.get("CandidateCodeView", "TEXT_STYLE")) ?? layout.get("LIST", "SSF_TEXT_STYLE") ?? "TextStyle_Text"
  const [back, backPressed] = await styles.pair(firstValue(styles.skin.get("CandidateCodeView", "BG_IMAGE")))
  const [cellBack, cellPressed] = await styles.pair(firstValue(styles.skin.get("CandidateCodeView", "BG_IMAGES")))
  const look = styles.text([textStyle], scale, "DROIDSANSFALLBACK.ttf")
  const color = [textStyle, "TextStyle"].map((section) => styles.color(section)).find(Boolean) ?? "#373737"
  const bar = { x: position[0], y: position[1], width: cell[0], height: cell[1] * count }
  const keys = [await sceneKey("LIST", bar, async (pressed) => {
    const visual = pressed ? backPressed : back
    return { back: visual ? [{ kind: "image", rect: bar, visual }] : [], fore: [] }
  })]
  for (const [index, name] of names.slice(0, count).entries()) {
    const rect = { x: position[0], y: position[1] + index * cell[1], width: cell[0], height: cell[1] }
    keys.push(await sceneKey(`LIST:${index + 1}`, rect, async (pressed) => {
      const visual = pressed ? cellPressed : cellBack
      const [x, y] = centre(rect)
      return {
        back: visual ? [{ kind: "image", rect, visual }] : [],
        fore: [{ kind: "text", text: { text: name, x, y, size: look.size ?? 0.039 * styles.sogouWidth * scale, color, weight: look.weight ?? 700, ...look.font ? { font: look.font } : {} } }],
      }
    }))
  }
  return keys
}

/**
 * The keyboard background Sogou paints behind the candidate bar and the keys together, as layers for
 * a canvas whose top edge sits `top` below the bar's: a solid colour (BG_STYLE=2) or the stretched image.
 */
async function ssfBackdrop(styles: SsfStyles, width: number, top: number, height: number): Promise<SceneLayer[]> {
  const skin = styles.skin
  const rect = { x: 0, y: -top, width, height }
  if (skin.get("RootView", "BG_STYLE")?.trim() === "2") {
    const color = styles.color("RootView", "BG_COLOR")
    return color ? [{ kind: "fill", rect, color }] : []
  }
  // Older skins name the keyboard background [Keyboard].
  const name = [skin.get("RootView", "BG_IMAGE"), skin.get("Keyboard", "BG_IMAGE"), skin.get("WALLPAPER", "BG_IMAGE"), skin.get("General", "PLATFORM_BG_IMAGE")]
    .map(firstValue).find((value) => value && /\.png$/i.test(value))
  const visual = await styles.file(name)
  if (visual) return [{ kind: "image", rect, visual }]
  const color = styles.color("WALLPAPER", "COLOR") ?? styles.color("RootView", "BG_FUNCTION_COLOR")
  return color ? [{ kind: "fill", rect, color }] : []
}

/** One board of the open skin; `barHeight` is the candidate bar above it, which shares its background. */
export async function ssfBoardScene(
  styles: SsfStyles,
  skeleton: SsfSkeleton,
  layoutName: string,
  landscape: boolean,
  size: { width: number; height: number; barHeight: number },
): Promise<NativeScene> {
  const { layout, scale } = skeleton
  const keys = await Promise.all(layout.sections().filter((section) => /^KEY\d+$/.test(section)).flatMap((section) => {
    const action = layout.get(section, "CENTER")?.trim()
    const rect = parseRect(layout.get(section, "VIEW_RECT"))
    if (!action || !rect) return []
    const binding = ssfKeyBinding(layoutName, action, landscape, layout.get(section, "SSF_SECTION"), layout.get(section, "SSF_BG"))
    const on = /^[a-z]$/.test(action) && ["py9", "py26"].includes(ssfBoard(layoutName))
    const background = ssfBackground(styles.skin, binding, (ref) => Boolean(styles.pkg.file(styles.theme, ref.file)))
    return [sceneKey(section, rect, async (pressed) => {
      const [normal, down] = await styles.pair(background?.images)
      const visual = pressed ? down : normal
      const back: SceneLayer[] = visual ? [{ kind: "image", rect, visual }] : []
      const fore = await styles.foreground(binding, on, pressed)
      if (fore === "none") return { back, fore: [] }
      if (fore) {
        const area = box(rect, fore.rect)
        const layer = area ? fitted(fore.visual, area) : scaled(fore.visual, scale, ...centre(rect))
        return { back, fore: layer ? [layer] : [] }
      }
      return { back, fore: await builtInLayers(styles, skeleton, section, binding, layoutName, landscape, rect, pressed) }
    })]
  }))
  const list = layout.sections().includes("LIST") ? await listKeys(styles, layout, scale) : []
  const background = await ssfBackdrop(styles, size.width, size.barHeight, size.barHeight + size.height)
  await styles.ready()
  return { background, keys: [...keys, ...list] }
}

/** The candidate bar: the shared background's top strip, the bar image over it, and the toolbar icons. */
export async function ssfCandidateScene(
  styles: SsfStyles,
  candidates: IniDocument,
  template: IniDocument,
  resolver: AtlasResolver,
  size: { width: number; height: number; panelHeight: number },
): Promise<{ bar: SceneLayer[]; icons: NativeScene }> {
  const barSection = firstValue(styles.skin.get("CandidateView", "BG_IMAGE"))
  const barImage = barSection ? await styles.image(styles.skin.get(barSection, "NORMAL")) : undefined
  const bar = [
    ...await ssfBackdrop(styles, size.width, 0, size.height + size.panelHeight),
    ...barImage ? [{ kind: "image", rect: { x: 0, y: 0, width: size.width, height: size.height }, visual: barImage } as const] : [],
  ]
  const iconARGB = ssfColor(styles.skin.get("CandidateIMEFunctionView", "ICON_COLOR")) ?? ssfColor(styles.skin.get("General", "ICON_COLOR"))
  const iconColor = argbColor(iconARGB)
  const icons = await Promise.all(candidates.sections().filter((section) => /^ICON\d+$/.test(section)).flatMap((section) => {
    const rect = parseRect(candidates.get(section, "VIEW_RECT"))
    if (!rect) return []
    const name = candidates.get(section, "SSF_IMAGE")?.trim() ?? ""
    // Legacy skins draw the S logo with the multimedia slot (the APK's IME_Function_Multimedia).
    const file = name === "logo.png" && !styles.pkg.file(styles.theme, name) ? "ime_function_multimedia.png" : name
    return [sceneKey(section, rect, async (pressed) => {
      const own = (pressed ? await styles.file(file.replace(/\.png$/i, "_p.png")) : undefined) ?? await styles.file(file)
      const id = template.get(section, "FORE_STYLE")?.trim()
      const builtIn = !own && id ? await resolver.resolve(id, pressed) : undefined
      const visual = own ?? (builtIn?.image ? iconColor ? await tintedVisual(builtIn, iconColor) : builtIn : undefined)
      if (!visual) return { back: [], fore: [] }
      // Icons are drawn at their own size, only ever shrunk into the slot.
      const [, , width, height] = visual.source!
      const scale = Math.min(1, rect.width / width, rect.height / height)
      const layer = scaled(visual, scale, ...centre(rect))
      return { back: [], fore: layer ? [layer] : [] }
    })]
  }))
  // Sogou rules the hide button off with a 2 px line in the icon colour at 40 %, 55 % of the bar's
  // height (measured on the skin tool's previews).
  const hide = candidates.sections().find((section) => candidates.get(section, "KEY")?.trim() === "F8")
  const hideRect = hide ? parseRect(candidates.get(hide, "VIEW_RECT")) : undefined
  const px = size.width / styles.sogouWidth
  const line: SceneLayer[] = hideRect && iconARGB
    ? [{ kind: "fill", rect: { x: hideRect.x - px, y: size.height * 0.225, width: 2 * px, height: size.height * 0.55 }, color: argbColor(`66${iconARGB.slice(2)}`)! }]
    : []
  await styles.ready()
  return { bar, icons: { background: line, keys: icons } }
}
