// 替换键盘样式 for `.sxi`: the slices of the chosen picture become a tile map in the theme's shared
// `info` (the picture itself is `<theme>/skin/res/<name>.png`), and new styles in `ss_1` show them on
// the board, its keys or the candidate bar. The old styles are cloned, never changed, so other boards
// sharing them keep their look. Planning the slices is shared with Baidu skins (layout-image.ts).

import type { LayoutImagePlan } from "../layout-image.ts"
import type { TileRect } from "../tiles.ts"
import { asObject, rectParts, type Json, type JsonObject } from "./sxi-ini.ts"
import { encodeSkinJson, parseSkinJson } from "./sxi-json.ts"

const STYLE_TABLES = ["s_info", "s_port", "s_land"]

type SxiLayoutImage = {
  /** Tile map and picture name (`<name>.png`). */
  name: string
  /** The picture's package path for the theme's resource list (`r_info`), as the package spells paths. */
  resource?: string
  /** 布局跟随图片: each key's new rect and the board's new size. */
  follow?: { rects: Map<string, TileRect>; size: [number, number] }
}

function object(owner: JsonObject, key: string): JsonObject {
  return asObject(owner[key] ?? null) ?? (owner[key] = {}) as JsonObject
}

const rect = ([x, y, width, height]: TileRect): Json => [[x, y], [width, height]]

/** The board's own `board`, starting from defaultGlobal's `b` so only what is set here changes. */
function ownBoard(board: JsonObject, global: JsonObject | undefined): JsonObject {
  const own = object(board, "board")
  own.b = { ...asObject(asObject(global?.board ?? null)?.b ?? null), ...asObject(own.b ?? null) }
  return own
}

/** The `cand` / `.cnd` model the bar's background is read from (palm-board.ts candidateBack). */
function candidateOwner(layout: JsonObject, board: JsonObject, global: JsonObject | undefined): JsonObject | undefined {
  const own = asObject(board.cand ?? null)
  const shared = asObject(global?.cand ?? null)
  const file = own?.file ?? shared?.file
  const cand = typeof file === "string" ? asObject(asObject(layout.c ?? null)?.[file] ?? null) : undefined
  const hasBack = (model: JsonObject | undefined) => asObject(model?.b ?? null)?.base_b !== undefined
  return [cand, own, shared].find(hasBack) ?? shared ?? own
}

/** `skin.json` with `plan` applied to the board `pointer` (`[theme, port_layout, "b", type]`) names. */
export function applySxiLayoutImage(text: string, pointer: readonly string[], plan: LayoutImagePlan, image: SxiLayoutImage): string {
  const skin = parseSkinJson(text)
  const [themeKey, layoutKey, , type] = pointer
  const struct = asObject(skin[themeKey] ?? null)
  const layout = asObject(struct?.[layoutKey] ?? null)
  const boards = asObject(layout?.b ?? null)
  const board = asObject(boards?.[type] ?? null)
  if (!struct || !layout || !boards || !board) throw new Error("找不到手心键盘布局")
  const global = asObject(boards.defaultGlobal ?? null)
  const shared = object(struct, "s_info")
  object(shared, "info")[image.name] = plan.slices.map(({ index, source }) => ({ alpha: 1, id: `IMG${index}`, rect1: rect(source), scales: [] }))
  if (image.resource && Array.isArray(struct.r_info) && !struct.r_info.includes(image.resource)) struct.r_info.push(image.resource)

  // The orientation's own table overrides the shared one by id: read through both, write new ids free in all.
  const own = asObject(asObject(struct[`s_${layoutKey.replace(/_layout$/, "")}`] ?? null)?.ss_1 ?? null)
  const styles = object(shared, "ss_1")
  let next = Math.max(0, ...STYLE_TABLES.flatMap((table) => Object.keys(asObject(asObject(struct[table] ?? null)?.ss_1 ?? null) ?? {})).map(Number).filter(Number.isFinite)) + 1
  const style = (from: Json | undefined, images: JsonObject): number => {
    const source = from === undefined ? undefined : asObject(own?.[String(from)] ?? styles[String(from)] ?? null)
    const model: JsonObject = source ? structuredClone(source) : { f: 0 }
    const id = next++
    model.id = `STYLE${id}`
    model.s_2 = { ...asObject(model.s_2 ?? null), ...images }
    styles[String(id)] = model
    return id
  }
  const slice = (index: number | undefined) => `${image.name},${index}`

  if (plan.target === "panel" || plan.target === "candidate") {
    const owner = plan.target === "panel" ? ownBoard(board, global) : candidateOwner(layout, board, global)
    if (!owner) throw new Error("这个手心键盘布局没有候选栏")
    const base = object(owner, "b")
    base.base_b = style(base.base_b, { normal: slice(plan.panelIndex), hl: slice(plan.panelIndex) })
  } else {
    const keys = new Map((Array.isArray(board.keys) ? board.keys : []).flatMap((item) => {
      const key = asObject(item)
      return key ? [[`KEY${key.id ?? ""}` as string, key] as const] : []
    }))
    for (const { section } of plan.keys) {
      const key = keys.get(section)
      const index = plan.indices.get(section)
      if (!key || index === undefined) continue
      const base = object(key, "b")
      if (plan.target === "key-normal" || plan.target === "key-highlight") {
        base.base_b = style(base.base_b, { [plan.target === "key-normal" ? "normal" : "hl"]: slice(index) })
      } else {
        const fores = Array.isArray(base.base_f) ? base.base_f : []
        base.base_f = [...fores, style(undefined, { [plan.target === "fore-normal" ? "normal" : "hl"]: slice(index) })]
      }
    }
    for (const [section, cell] of image.follow?.rects ?? []) {
      const key = keys.get(section)
      if (!key) continue
      // A touch area equal to the key moves with it, as editing VIEW_RECT does.
      const old = rectParts(key.rect ?? null)
      const hit = rectParts(key.hit_rect ?? null)
      key.rect = rect(cell)
      if (old && hit && old.every((value, at) => value === hit[at])) key.hit_rect = rect(cell)
    }
    if (image.follow) ownBoard(board, global).size = [...image.follow.size]
  }
  return encodeSkinJson(skin)
}
