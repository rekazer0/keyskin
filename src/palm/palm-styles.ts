// The styles, tiles and images one theme and orientation of a Palm `skin.json` draws with, read from
// the JSON: `ss_1` styles are text (`s_1`), image (`s_2`, "tile file,IMG index") or border (`s_3`);
// tiles (`info`) give an image's source rect and its stretchable `rect2`. An orientation's `s_port` /
// `s_land` override `s_info`, and its own `res` folder wins over the shared one.
//
// Also the canvas's resolver for Palm documents, so hint bubbles, particles and the inspector's style
// previews read the same data the scene does.

import { pngBitmap, type StyleTextVisual, type TextVisual, type Visual, type VisualResolver, type ToolbarVisual } from "../atlas.ts"
import { TOOLBAR_FUNCTIONS, toolbarFunctionLabel } from "../ios-toolbar.ts"
import { argbColor, imageAt, type SceneLayer, type SceneText } from "../native-scene.ts"
import type { Rect } from "../preview-items.ts"
import type { SkinArchive } from "../skin.ts"
import { THEME_DIRECTORY, list, type PalmOrientation, type PalmTheme } from "./palm-board.ts"
import { asObject, rectParts, type Json, type JsonObject } from "./sxi-ini.ts"

type Text = Omit<SceneText, "x" | "y" | "text"> & { text?: string }
type Paint = { visual?: Visual; fill?: string; border?: { color: string; width: number }; text?: Text }

// Android's toolbar draws these functions with IMG<n> of `a_m` (pop_menu_icons): 表情 26, 输入方式 27,
// 语音 29, 搜索 31, 编辑 25, 剪贴板 50 (Baidu LogoIconSource); the real list lives on the phone.
const ANDROID_TOOLBAR_TILES = [26, 27, 29, 31, 25, 50]
// The toolbar entries of the `menu` Palm's own skins ship with the `logo/1.0` icon pack.
const DEFAULT_TOOLBAR = [["KBSwitch", "keyboard"], ["MoveCursor", "arrow-left-right"], ["Search", "search"], ["Emoji", "smile"], ["NewWords", "message-square"]]

async function fileImage(archive: SkinArchive, path: string | undefined): Promise<Visual | undefined> {
  const bytes = path && archive.getBytes(path)
  const bitmap = bytes && await pngBitmap(bytes)
  return bitmap ? { image: bitmap, imagePath: path, source: [0, 0, bitmap.width, bitmap.height] } : undefined
}

export class PalmStyles implements VisualResolver {
  private readonly archive: SkinArchive
  private readonly skin: JsonObject
  private readonly theme: PalmTheme
  private readonly roots: string[]
  private readonly styles: JsonObject
  private readonly tiles: JsonObject
  private readonly paints = new Map<string, Promise<Paint | undefined>>()

  /** `tiles` replaces the theme's tile maps, for the toolbar atlas (`a_m`, res/logo/pop_menu_icons.png). */
  constructor(archive: SkinArchive, skin: JsonObject, theme: PalmTheme, orientation: PalmOrientation, tiles?: JsonObject) {
    this.archive = archive
    this.skin = skin
    this.theme = theme
    const struct = asObject(skin[theme]) ?? {}
    const shared = asObject(struct.s_info) ?? {}
    const own = asObject(struct[orientation === "port" ? "s_port" : "s_land"]) ?? {}
    this.styles = { ...asObject(shared.ss_1), ...asObject(own.ss_1) }
    const directory = THEME_DIRECTORY[theme]
    this.tiles = tiles ?? { ...asObject(shared.info), ...asObject(own.info) }
    this.roots = tiles ? [`${directory}/skin/res/logo`] : [`${directory}/skin/${orientation}/res`, `${directory}/skin/res`]
  }

  private style(id: Json): JsonObject | undefined {
    return typeof id === "number" || typeof id === "string" ? asObject(this.styles[String(id).trim()]) : undefined
  }

  private tile(reference: Json): { name: string; source?: [number, number, number, number]; inner?: [number, number, number, number] } | undefined {
    if (typeof reference !== "string") return
    const [name, index] = reference.split(",").map((part) => part.trim())
    const tile = list(this.tiles[name]).map(asObject).find((item) => item?.id === `IMG${index}`)
    return { name, source: rectParts(tile?.rect1 ?? null), inner: rectParts(tile?.rect2 ?? null) }
  }

  /** A file of the theme's `res` folders, the orientation's own first. */
  bytes(name: string): Uint8Array | undefined {
    for (const root of this.roots) {
      const bytes = this.archive.getBytes(`${root}/${name}`)
      if (bytes) return bytes
    }
  }

  /** "tile file,IMG index" as a drawable slice; `IMG<n>` is matched by id, Android atlases start at IMG0. */
  async image(reference: Json): Promise<Visual | undefined> {
    const tile = this.tile(reference)
    const path = tile && this.roots.map((root) => `${root}/${tile.name}.png`).find((candidate) => this.archive.getBytes(candidate))
    const bitmap = path && tile.source && await pngBitmap(this.archive.getBytes(path)!)
    if (!bitmap || !tile?.source) return
    const [x, y] = tile.source
    const inner = tile.inner
    return {
      image: bitmap,
      imagePath: path,
      source: tile.source,
      // A zero-sized rect2 does not stretch.
      ...inner && inner[2] > 0 && inner[3] > 0 ? { inner: [inner[0] - x, inner[1] - y, inner[2], inner[3]] as [number, number, number, number] } : {},
    }
  }

  /** A text style's look; `for_back` styles are fills, not text. */
  private text(id: Json, pressed: boolean): Text | undefined {
    const textStyle = asObject(this.style(id)?.s_1 ?? null)
    const color = argbColor((pressed ? textStyle?.c_hl : undefined) ?? textStyle?.c_normal)
    if (!textStyle || textStyle.for_back === true || !color || typeof textStyle.f_s !== "number") return
    return {
      ...typeof textStyle.text === "string" ? { text: textStyle.text } : {},
      size: textStyle.f_s,
      color,
      ...typeof textStyle.f_w === "number" ? { weight: textStyle.f_w } : {},
      ...typeof textStyle.f_n === "string" ? { font: textStyle.f_n } : {},
    }
  }

  paint(id: Json, pressed: boolean): Promise<Paint | undefined> {
    const key = `${id}|${pressed}`
    let paint = this.paints.get(key)
    if (!paint) this.paints.set(key, paint = this.resolvePaint(id, pressed))
    return paint
  }

  private async resolvePaint(id: Json, pressed: boolean): Promise<Paint | undefined> {
    const style = this.style(id)
    if (!style) return
    const textStyle = asObject(style.s_1)
    const image = asObject(style.s_2)
    const border = asObject(style.s_3)
    const paint: Paint = {}
    if (image) paint.visual = await this.image((pressed ? image.hl : undefined) ?? image.normal)
    if (textStyle?.for_back === true) paint.fill = argbColor((pressed ? textStyle.c_hl : undefined) ?? textStyle.c_normal)
    paint.text = this.text(id, pressed)
    const borderColor = argbColor(border?.color)
    if (typeof border?.size === "number" && border.size > 0 && borderColor) paint.border = { color: borderColor, width: border.size }
    return paint
  }

  /** A back style filling `rect`. */
  async back(id: Json, pressed: boolean, rect: Rect): Promise<SceneLayer[]> {
    const paint = await this.paint(id, pressed)
    if (!paint) return []
    return [
      ...paint.fill ? [{ kind: "fill", rect, color: paint.fill } as const] : [],
      ...paint.visual ? [{ kind: "image", rect, visual: paint.visual } as const] : [],
      ...paint.border ? [{ kind: "border", rect, ...paint.border } as const] : [],
    ]
  }

  /** A foreground layer at its own size, centred on the key and moved by its offset. */
  async fore(id: Json, pressed: boolean, rect: Rect, offset: [number, number] | undefined, label?: string): Promise<SceneLayer | undefined> {
    const paint = await this.paint(id, pressed)
    const x = rect.x + rect.width / 2 + (offset?.[0] ?? 0)
    const y = rect.y + rect.height / 2 + (offset?.[1] ?? 0)
    if (paint?.visual) return imageAt(paint.visual, x, y)
    const text = paint?.text?.text ?? label
    if (paint?.text && text) return { kind: "text", text: { ...paint.text, text, x, y } }
  }

  /** The toolbar functions' icons: iOS menu items placed on the toolbar, else the Android atlas tiles. */
  async toolbarImages(all = false, includeMissing = all): Promise<ToolbarVisual[]> {
    const struct = asObject(this.skin[this.theme]) ?? {}
    const logo = `${THEME_DIRECTORY[this.theme]}/skin/res/logo`
    const menus = list(struct.menu).filter(Array.isArray) as Json[][]
    // Without a `menu`, a skin carrying Palm's icon pack shows the pack's default toolbar.
    const menu = menus.find((items) => items.some((item) => asObject(item)?.Position === "toolbar")) ?? menus[0]
      ?? (struct.a_m === undefined ? DEFAULT_TOOLBAR.map(([name]) => ({ Position: "toolbar", Images: { Normal: { Normal: `1.0/toolbarMenuItem_${name}_Normal` } } })) : undefined)
    const visuals: Array<ToolbarVisual | undefined> = menu
      ? await Promise.all(menu.map(asObject).filter((item) => (item?.Position === "toolbar" || all && item?.Position === "menu")).map(async (item) => {
          const imageName = asObject(asObject(item?.Images ?? null)?.Normal ?? null)?.Normal
          const name = typeof imageName === "string" ? imageName.trim().replace(/^\/+/, "").replace(/\.png$/i, "") : undefined
          const path = typeof name === "string"
            ? [`${logo}/${name}_iphone@3x.png`, `${logo}/${name}@3x.png`, `${logo}/${name}.png`].find((candidate) => this.archive.getBytes(candidate))
            : undefined
          const functionLabel = toolbarFunctionLabel(String(item?.Name ?? ""), String(name ?? ""))
          const label = asObject(asObject(item?.Titles)?.Normal)?.Normal
          return {
            ...await fileImage(this.archive, path),
            imagePath: path ?? (typeof name === "string" ? `${logo}/${name}_iphone@3x.png` : undefined),
            defaultIcon: DEFAULT_TOOLBAR.find(([key]) => name?.endsWith(`toolbarMenuItem_${key}_Normal`))?.[1],
            label: typeof label === "string" && (functionLabel.startsWith("功能 ") || functionLabel === "未知功能") ? label : functionLabel,
          }
        }))
      : Array.isArray(struct.a_m)
        ? await Promise.all((all ? TOOLBAR_FUNCTIONS.map(([tile]) => tile) : ANDROID_TOOLBAR_TILES).map(async (tile) => {
            const visual = await new PalmStyles(this.archive, this.skin, this.theme, "port", { pop_menu_icons: struct.a_m }).image(`pop_menu_icons,${tile}`)
            return visual && { ...visual, label: TOOLBAR_FUNCTIONS.find(([index]) => index === tile)?.[3] }
          }))
        : []
    return visuals.filter((visual): visual is ToolbarVisual => Boolean(visual && (includeMissing || visual.image)))
  }

  // VisualResolver: the canvas's hint bubbles, particles and the inspector's previews.

  async ready(): Promise<void> {}

  async resolve(styleID: string, highlighted: boolean): Promise<Visual | undefined> {
    const paint = await this.paint(styleID, highlighted)
    if (!paint || !paint.visual && !paint.fill && !paint.border) return
    return { ...paint.visual, ...paint.fill ? { color: paint.fill } : {}, ...paint.border ? { borderColor: paint.border.color } : {} }
  }

  sourceSize(styleID: string, highlighted: boolean): { width: number; height: number } | undefined {
    const image = asObject(this.style(styleID)?.s_2 ?? null)
    const source = this.tile((highlighted ? image?.hl : undefined) ?? image?.normal)?.source
    return source && { width: source[2], height: source[3] }
  }

  /** The first text style of a foreground list. */
  resolveText(foreground: string, highlighted: boolean): TextVisual | undefined {
    for (const id of foreground.split(",")) {
      const text = this.text(id, highlighted)
      if (text) return { fontSize: text.size, color: text.color, ...text.font ? { fontName: text.font } : {}, ...text.weight ? { weight: text.weight } : {} }
    }
  }

  resolveStyleText(styleID: string, highlighted: boolean): StyleTextVisual | undefined {
    const text = this.text(styleID, highlighted)
    const visual = this.resolveText(styleID, highlighted)
    return text?.text && visual ? { ...visual, text: text.text } : undefined
  }

  async resolveToolbarImages(limit?: number): Promise<ToolbarVisual[]> {
    return (await this.toolbarImages(limit === Number.POSITIVE_INFINITY)).slice(0, Math.max(0, limit ?? Number.POSITIVE_INFINITY))
  }
}
