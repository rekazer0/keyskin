// The styles (`ss_1`) and key sounds of the open Palm skin, read and written in skin.json for the style
// library, style cards and the canvas's key sounds, in the theme and orientation the canvas shows
// (palm-style-edit.ts has the lookups); and the keys of the open board as the canvas swaps them.

import { stateTipSection } from "../panel-tools.ts"
import { palmStyleIDList, palmStyleKindOf, palmStyleLocation } from "../palm/palm-style-edit.ts"
import { asObject, tipsText, type Json, type JsonObject } from "../palm/sxi-ini.ts"
import { sxiFragment } from "../palm/sxi-json.ts"
import { openPalmSkin, palmOrientation, palmTheme, PALM_SHARED_BOARD, sxiPointer } from "./sxi-documents"
import { appState } from "./state"
import type { StyleKind } from "./types"

/** Where style `id` of the current theme and orientation lives. */
export function palmStylePointer(id: string, skin = openPalmSkin()): string[] | undefined {
  return skin ? palmStyleLocation(skin, palmTheme(), palmOrientation(), id) : undefined
}

export function palmStyle(id: string, skin = openPalmSkin()): JsonObject | undefined {
  const pointer = palmStylePointer(id, skin)
  return pointer && skin ? asObject(sxiFragment(skin, pointer)) : undefined
}

export function palmStyleIDs(): string[] {
  const skin = openPalmSkin()
  return skin ? palmStyleIDList(skin, palmTheme(), palmOrientation()) : []
}

export function palmStyleKind(id: string): StyleKind {
  return palmStyleKindOf(palmStyle(id))
}

/** The press sound file a style plays (`s_4.path_1`). */
export function palmStyleSound(id: string): string | undefined {
  const sound = asObject(palmStyle(id)?.s_4)?.path_1
  return typeof sound === "string" && sound.trim() ? sound.trim() : undefined
}

/** "tile file,IMG index" a style draws in the normal or pressed state (`s_2.normal` / `s_2.hl`). */
export function palmStyleImage(id: string, pressed: boolean): string | undefined {
  const image = asObject(palmStyle(id)?.s_2)
  const value = (pressed ? image?.hl : undefined) ?? image?.normal
  return typeof value === "string" ? value : undefined
}

/** Sets the normal or pressed image of styles `ids` in `skin`. */
export function setPalmStyleImage(skin: JsonObject, ids: readonly string[], pressed: boolean, value: string): void {
  for (const id of ids) {
    const pointer = palmStylePointer(id, skin)
    const style = pointer && asObject(sxiFragment(skin, pointer))
    if (!style) throw new Error(`skin.json 中没有样式 ${id}`)
    style.s_2 = { ...asObject(style.s_2), [pressed ? "hl" : "normal"]: value }
  }
}

/** Which parts of the open board use style `id`, for the style library's filter. */
export function palmStyleCategories(id: string): Set<string> {
  const categories = new Set<string>()
  const skin = openPalmSkin()
  const pointer = sxiPointer(appState.layoutPath)
  const board = skin && pointer?.[2] === "b" ? asObject(sxiFragment(skin, pointer)) : undefined
  const uses = (owner: Json, fields: readonly string[]) => {
    const base = asObject(asObject(owner)?.b)
    return fields.some((field) => [base?.[field]].flat().map(String).includes(id))
  }
  for (const key of Array.isArray(board?.keys) ? board.keys : []) {
    if (uses(key, ["base_b"])) categories.add("key")
    if (uses(key, ["base_f"])) categories.add("foreground")
  }
  if (uses(board?.board, ["base_b", "base_f"])) categories.add("panel")
  if (["cand", "input", "top_cand"].some((part) => uses(board?.[part], ["base_b", "base_f"]))) categories.add("candidate")
  return categories
}

export type PalmPointer = Array<string | number>

export function palmValue(root: Json, pointer: Readonly<PalmPointer>): Json {
  let current = root
  for (const step of pointer) current = Array.isArray(current) && typeof step === "number" ? current[step] : asObject(current)?.[step]
  return current
}

/**
 * The skin.json model canvas key `section` of the open board draws from in keyboard state `state`: the
 * `key_fix` entry its `fix_a` maps the state to (Baidu's TIP), else the key itself.
 */
export function palmKeyPointer(skin: JsonObject, section: string, state?: number): PalmPointer | undefined {
  const board = sxiPointer(appState.layoutPath)
  const id = /^KEY(.+)$/.exec(section)?.[1]
  if (board?.[2] !== "b" || id === undefined) return
  const model = asObject(sxiFragment(skin, board))
  const keys = Array.isArray(model?.keys) ? model.keys : []
  const index = keys.findIndex((key) => String(asObject(key)?.id) === id)
  if (index < 0) return
  const tip = stateTipSection(tipsText(asObject(keys[index])?.fix_a ?? null), state)
  return tip !== undefined && asObject(asObject(model?.key_fix)?.[String(tip)]) ? [...board, "key_fix", String(tip)] : [...board, "keys", index]
}

/** The foreground styles (`base_f`) key `section` draws in `state`: its `key_fix` entry's, else its own. */
export function palmKeyForegrounds(skin: JsonObject, section: string, state?: number): Json[] {
  const pointer = palmKeyPointer(skin, section, state)
  const key = pointer?.at(-2) === "key_fix" ? palmKeyPointer(skin, section) : undefined
  const fores = (target: PalmPointer | undefined) => target && asObject(asObject(palmValue(skin, target))?.b)?.base_f
  const value = fores(pointer) ?? fores(key)
  return Array.isArray(value) ? value : value === undefined ? [] : [value]
}

/** The press sound of canvas key `section` of the open board: the key's `base_s`, else its board's, else `defaultGlobal`'s. */
export function palmKeySound(section: string): string | undefined {
  const skin = openPalmSkin()
  const pointer = sxiPointer(appState.layoutPath)
  if (!skin || pointer?.[2] !== "b") return
  const boards = asObject(sxiFragment(skin, pointer.slice(0, 3))) ?? {}
  const board = asObject(boards[pointer[3]]) ?? {}
  const key = (Array.isArray(board.keys) ? board.keys : []).map(asObject).find((item) => `KEY${item?.id ?? ""}` === section)
  const sound = (owner: Json) => asObject(asObject(owner)?.b)?.base_s
  const id = sound(key) ?? sound(board.board) ?? sound(asObject(boards[PALM_SHARED_BOARD])?.board)
  return id === undefined || id === null ? undefined : palmStyleSound(String(id))
}
