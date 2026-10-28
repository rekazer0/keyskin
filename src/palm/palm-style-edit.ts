// Palm skin.json style and tile edits, pure so they can be tested: where a style id of a theme and
// orientation lives (`s_<orientation>.ss_1` before `s_info.ss_1`, as palm-styles.ts looks it up), what a
// style draws, new styles, and the tile maps (`info.<image>`, `a_m`, `a_i`) images are sliced by.

import type { TileRect, TileSlice } from "../tiles.ts"
import type { PalmOrientation, PalmTheme } from "./palm-board.ts"
import { asObject, rectParts, type Json, type JsonObject } from "./sxi-ini.ts"
import { sxiFragment } from "./sxi-json.ts"

export type PalmStyleKind = "image" | "color" | "anim" | "text" | "sound" | "empty"

const THEME_KEYS: Record<string, PalmTheme> = { light: "default", dark: "night" }

/** Where style `id` of a theme and orientation lives: the orientation's own table, else the shared one. */
export function palmStyleLocation(skin: JsonObject, theme: PalmTheme, orientation: PalmOrientation, id: string): string[] | undefined {
  const table = [`s_${orientation}`, "s_info"].find((name) => asObject(asObject(sxiFragment(skin, [theme, name, "ss_1"]))?.[id]))
  return table ? [theme, table, "ss_1", id] : undefined
}

export function palmStyleIDList(skin: JsonObject, theme: PalmTheme, orientation: PalmOrientation): string[] {
  const ids = new Set([`s_${orientation}`, "s_info"].flatMap((name) => Object.keys(asObject(sxiFragment(skin, [theme, name, "ss_1"])) ?? {})))
  return [...ids].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}

/**
 * What a style draws, sorted by the style library's rule for Baidu styles (style-picker.ts): an image,
 * an animation, a colour (`c_normal` / `c_hl`, Baidu's NM_COLOR / HL_COLOR), a sound, else text.
 */
export function palmStyleKindOf(style: JsonObject | undefined): PalmStyleKind {
  if (!style) return "empty"
  const image = asObject(style.s_2)
  const text = asObject(style.s_1)
  if (image?.normal !== undefined || image?.hl !== undefined) return "image"
  if (Object.keys(asObject(style.s_5) ?? {}).length) return "anim"
  if (text?.c_normal !== undefined || text?.c_hl !== undefined) return "color"
  if (typeof asObject(style.s_4)?.path_1 === "string") return "sound"
  return text || asObject(style.s_3) ? "text" : "empty"
}

/**
 * Adds a style to the theme's shared table and returns its id: `id`, or the first one no table of the
 * theme uses (so an orientation's own table never shadows it).
 */
export function addPalmStyle(skin: JsonObject, theme: PalmTheme, model: JsonObject = {}, id?: string): string {
  const struct = asObject(skin[theme])
  if (!struct) throw new Error(`skin.json 中缺少 ${theme}`)
  const used = new Set<string>()
  for (const table of ["s_info", "s_port", "s_land"]) {
    for (const [key, style] of Object.entries(asObject(asObject(struct[table])?.ss_1) ?? {})) used.add(String(asObject(style)?.id ?? `STYLE${key}`)).add(`STYLE${key}`)
  }
  let next = 1
  while (used.has(`STYLE${next}`)) next += 1
  const styleID = id ?? String(next)
  if (used.has(`STYLE${styleID}`)) throw new Error(`STYLE${styleID} 已存在`)
  const shared = asObject(struct.s_info) ?? (struct.s_info = {}) as JsonObject
  const styles = asObject(shared.ss_1) ?? (shared.ss_1 = {}) as JsonObject
  styles[styleID] = { f: 0, id: `STYLE${styleID}`, ...model }
  return styleID
}

/**
 * The tile map an image of the package is sliced by: `info.<name>` of the style table its folder
 * stands for (`res/` is `s_info`, `port/res/` is `s_port`), or the toolbar atlases `a_m` / `a_i`.
 */
export function palmTilePointer(imagePath: string): string[] | undefined {
  const image = /^(light|dark)\/skin\/(?:(port|land)\/)?res\/([^/]+)\.png$/i.exec(imagePath)
  if (image) return [THEME_KEYS[image[1]], image[2] ? `s_${image[2]}` : "s_info", "info", image[3]]
  const atlas = /^(light|dark)\/skin\/res\/logo\/(pop_menu_icons|pop_input_icons)\.png$/i.exec(imagePath)
  if (atlas) return [THEME_KEYS[atlas[1]], atlas[2] === "pop_menu_icons" ? "a_m" : "a_i"]
}

const tileIndex = (tile: JsonObject, position: number) => Number(/^IMG(\d+)$/.exec(String(tile.id ?? ""))?.[1] ?? position)
const rectValue = ([x, y, width, height]: TileRect): Json => [[x, y], [width, height]]

/** An image's slices: `IMG<n>` ids, `rect1` the source and `rect2` the stretchable centre. */
export function palmTileSlices(skin: JsonObject | undefined, imagePath: string): TileSlice[] {
  const pointer = palmTilePointer(imagePath)
  const tiles = pointer && skin ? sxiFragment(skin, pointer) : undefined
  return (Array.isArray(tiles) ? tiles : []).flatMap((tile, position) => {
    const model = asObject(tile)
    const source = model && rectParts(model.rect1)
    if (!model || !source) return []
    const inner = rectParts(model.rect2)
    return [{ index: tileIndex(model, position), source, ...inner && inner[2] > 0 && inner[3] > 0 ? { inner } : {} }]
  }).sort((a, b) => a.index - b.index)
}

function tileList(skin: JsonObject, imagePath: string): Json[] {
  const pointer = palmTilePointer(imagePath)
  if (!pointer) throw new Error(`手心皮肤没有保存 ${imagePath} 切片的位置`)
  let owner = skin
  for (const key of pointer.slice(0, -1)) owner = asObject(owner[key]) ?? (owner[key] = {}) as JsonObject
  const last = pointer[pointer.length - 1]
  if (!Array.isArray(owner[last])) owner[last] = []
  return owner[last] as Json[]
}

/** Writes `slice` into the image's tile map, adding the tile when it is new. */
export function setPalmTile(skin: JsonObject, imagePath: string, slice: TileSlice): void {
  const tiles = tileList(skin, imagePath)
  let tile = tiles.map(asObject).find((item, position) => item && tileIndex(item, position) === slice.index)
  if (!tile) tiles.push(tile = { id: `IMG${slice.index}` })
  tile.rect1 = rectValue(slice.source)
  if (slice.inner) tile.rect2 = rectValue(slice.inner)
  else {
    delete tile.rect2
    delete tile.scales
  }
}

/** Removes slice `index`; Palm styles find a slice by its IMG id, so the others keep their numbers. */
export function removePalmTile(skin: JsonObject, imagePath: string, index: number): void {
  const tiles = tileList(skin, imagePath)
  const position = tiles.findIndex((item, at) => asObject(item) && tileIndex(asObject(item)!, at) === index)
  if (position >= 0) tiles.splice(position, 1)
}

/** Replaces every slice of the image (auto slicing). */
export function setPalmTiles(skin: JsonObject, imagePath: string, slices: readonly TileSlice[]): void {
  tileList(skin, imagePath).splice(0)
  for (const slice of slices) setPalmTile(skin, imagePath, slice)
}
