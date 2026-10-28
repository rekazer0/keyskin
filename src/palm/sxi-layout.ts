// `.sxi` keyboard, candidate-bar and bubble models written as Baidu INI text, the inverse of the layout
// half of `palm-export.ts`, for exporting a Palm skin as BDI/BDS (sxi-to-baidu.ts). Also the names Palm
// gives its board types' layouts (`boardFileName`) and its gesture buttons.

import { iniCodeFromBoardType } from "./palm-board-types.ts"
import {
  IniWriter,
  actionText,
  asObject,
  numberText,
  put,
  putBase,
  putFields,
  rectParts,
  rectText,
  tipsText,
  type Json,
  type JsonObject,
} from "./sxi-ini.ts"

/** Palm `values` button indexes, in order. */
export const BUTTON_KEYS = ["UP", "DOWN", "LEFT", "RIGHT", "CENTER", "SHOW", "HOLD", "HOLDSYM", "BAR_SYM", "BAR_SYM_SEL"]

// Gestures live in a flat `[button, action, ...]` list.
function putValues(entries: Map<string, string>, owner: JsonObject, field: string): void {
  const values = Array.isArray(owner[field]) ? owner[field] as Json[] : []
  for (let index = 0; index + 1 < values.length; index += 2) {
    const key = typeof values[index] === "number" ? BUTTON_KEYS[values[index] as number] : undefined
    if (key) put(entries, key, actionText(values[index + 1]))
  }
}

function sameRect(left: Json, right: Json): boolean {
  const a = rectParts(left)
  const b = rectParts(right)
  return Boolean(a && b && a.every((value, index) => value === b[index]))
}

function putKey(writer: IniWriter, key: JsonObject): void {
  const entries = writer.section(`KEY${key.id ?? ""}`)
  putBase(entries, key)
  put(entries, "VIEW_RECT", rectText(key.rect))
  // A touch area equal to the key is Baidu's default, so it is left out.
  if (key.hit_rect !== undefined && !sameRect(key.hit_rect, key.rect)) put(entries, "TOUCH_RECT", rectText(key.hit_rect))
  putValues(entries, key, "values")
  put(entries, "STAT_STYLE", tipsText(key.fix_a))
}

function putTip(writer: IniWriter, name: string, tip: JsonObject): void {
  const entries = writer.section(name)
  putBase(entries, tip)
  put(entries, "KEY", actionText(tip.k))
  putValues(entries, tip, "v")
}

function putCandidate(entries: Map<string, string>, model: JsonObject): void {
  putBase(entries, model)
  putFields(entries, model, [
    ["f_size", "FIX_SIZE", "point"],
    ["rect", "VIEW_RECT", "rect"],
    ["insets", "PADDING", "insets"],
    ["gap", "CELL_W", "number"],
    ["f_gap", "FIRST_GAP", "number"],
    ["more_width", "MORE_W", "number"],
    ["i_cell", "CELL_STYLE", "number"],
    ["i_mask", "MASK_STYLE", "number"],
    ["i_f_b", "FIRST_BACK", "number"],
    ["i_f_f", "FIRST_FORE", "number"],
    ["file", "LAYOUT_NAME", "string"],
    ["i_cand", "FORE_STYLE", "number"],
  ])
}

function putTable(entries: Map<string, string>, model: JsonObject): void {
  putBase(entries, model)
  putFields(entries, model, [
    ["order", "LIST_ORDER", "bool"],
    ["side", "SCROLL_SIDE", "bool"],
    ["t", "TYPE", "number"],
    ["count", "LIST_NUM", "number"],
    ["i_cell", "CELL_STYLE", "number"],
    ["i_scroll", "SCROLL_STYLE", "number"],
    ["pos", "POS", "point"],
    // `tableModel` reads SIZE ?? CELL_SIZE; the renderer reads CELL_SIZE for list cells.
    ["size", "SIZE", "point"],
    ["size", "CELL_SIZE", "point"],
    ["rect", "VIEW_RECT", "rect"],
    ["insets", "PADDING", "insets"],
  ])
  // `tableModel` strips spaces and splits by character; the renderer splits on spaces.
  if (Array.isArray(model.titles)) put(entries, "NAMES", model.titles.join(" "))
  if (Array.isArray(model.values)) put(entries, "VALUES", model.values.join(" "))
}

// Types without an INI code (for example "en_9_h") keep their file name.
export function boardFileName(type: string): string {
  return `${iniCodeFromBoardType(type) ?? type}.ini`
}

// `keyboardModel`.
export function boardIni(value: Json): IniWriter {
  const model = asObject(value) ?? {}
  const writer = new IniWriter()
  const sectionOf = (name: string, field: string): [Map<string, string>, JsonObject] | undefined => {
    const part = asObject(model[field])
    return part ? [writer.section(name), part] : undefined
  }

  const comm = sectionOf("GLOBAL", "comm")
  if (comm) putFields(comm[0], comm[1], [["s_full", "SYMBOL_FULL_SCREEN", "bool"]])

  const board = sectionOf("PANEL", "board")
  if (board) {
    const [entries, part] = board
    putBase(entries, part)
    putFields(entries, part, [
      ["exact", "NO_BLUR", "bool"],
      ["right", "NO_F3_FIX", "bool"],
      ["c_rect", "CUSTOM_RECT", "bool"],
      ["size", "SIZE", "point"],
      ["f_size", "FIX_SIZE", "point"],
      ["extend", "ANIM_EXTEND", "number"],
      ["level", "ANIM_LEVEL", "number"],
      ["a_insets", "PANEL_ANIM_INSET", "insets"],
    ])
    const border = asObject(asObject(part.bd)?.b)
    if (border) {
      put(entries, "BORDER_ANIM_STYLE", numberText(border.a))
      if (Array.isArray(border.r)) {
        put(entries, "BORDER_RANGE", border.r.map((range) => Array.isArray(range) ? range.join(",") : "").join(";"))
      }
    }
  }

  const input = sectionOf("INPUT", "input")
  if (input) {
    putBase(input[0], input[1])
    putFields(input[0], input[1], [
      ["type", "TYPE", "number"],
      ["pos", "POS", "point"],
      ["size", "SIZE", "point"],
      ["f_size", "FIX_SIZE", "point"],
      ["insets", "PADDING", "insets"],
    ])
  }

  const cand = sectionOf("CAND", "cand")
  if (cand) putCandidate(cand[0], cand[1])

  const hint = sectionOf("HINT", "hint")
  if (hint) {
    putBase(hint[0], hint[1])
    putFields(hint[0], hint[1], [
      ["anchor", "ANCHOR_TYPE", "number"],
      ["hint", "TYPE", "number"],
      ["file", "LAYOUT_NAME", "string"],
      ["bar_a", "FORE_ANIM_STYLE", "number"],
      ["rect", "VIEW_RECT", "rect"],
    ])
  }

  // shortcut: `logoModel` inlines the PANEL/ICON of a separate logo layout; that file name
  // is not in skin.json, so only the LOGO base is written.
  const logo = sectionOf("LOGO", "logo")
  if (logo) putBase(logo[0], logo[1])

  const emoji = sectionOf("EMOJI", "emoji")
  if (emoji) {
    putBase(emoji[0], emoji[1])
    putFields(emoji[0], emoji[1], [
      ["i_text", "PANEL_BACK_STYLE_INDEX", "number"],
      ["index_t", "TAB_BACK_STYLE_INDEX", "number"],
      ["file", "LAYOUT_NAME", "string"],
      ["b_line", "BOTTOM_LINE", "number"],
    ])
    put(emoji[0], "TEXT_STYLE_INDEX", numberText(asObject(emoji[1].t_icon)?.i_text))
  }

  const more = sectionOf("MORE", "more")
  if (more) {
    const [entries, part] = more
    putBase(entries, part)
    if (typeof part.row === "number" && typeof part.col === "number") put(entries, "GRID", `${part.col},${part.row}`)
    putFields(entries, part, [
      ["i_h", "H_LINE_STYLE_INDEX", "number"],
      ["i_v", "V_LINE_STYLE_INDEX", "number"],
      ["i_c", "CELL_STYLE_INDEX", "number"],
      ["i_l", "LOCK_STYLE_INDEX", "number"],
      ["i_b", "BORDER_STYLE_INDEX", "number"],
      ["l_color", "LINE_COLOR", "string"],
    ])
    if (typeof part.file === "string") put(entries, "LAYOUT_NAME", boardFileName(part.file).replace(/\.ini$/, ""))
  }

  const list = sectionOf("LIST", "list")
  if (list) putTable(list[0], list[1])
  const segment = sectionOf("SEGMENT", "seg")
  if (segment) putTable(segment[0], segment[1])

  const topCand = sectionOf("SCAND", "top_cand")
  if (topCand) {
    putBase(topCand[0], topCand[1])
    putFields(topCand[0], topCand[1], [
      ["i_i", "INPUT_STYLE", "number"],
      ["s_i", "SCAND_STYLE", "number"],
      ["insets", "PADDING", "insets"],
      ["rect", "VIEW_RECT", "rect"],
    ])
  }

  for (const key of Array.isArray(model.keys) ? model.keys : []) {
    const record = asObject(key)
    if (record) putKey(writer, record)
  }
  for (const [index, tip] of Object.entries(asObject(model.key_fix) ?? {})) {
    const record = asObject(tip)
    if (record) putTip(writer, `TIP${index}`, record)
  }
  for (const [index, offset] of Object.entries(asObject(model.offset) ?? {})) {
    putFields(writer.section(`OFFSET${index}`), asObject(offset) ?? {}, [["p", "POS", "point"]])
  }
  for (const [index, force] of (Array.isArray(model.force) ? model.force : []).entries()) {
    putFields(writer.section(`FORCE${index}`), asObject(force) ?? {}, [
      ["start", "BEGIN", "number"],
      ["finish", "END", "number"],
      ["value", "VALUE", "number"],
    ])
  }
  return writer
}

// `candidateModelFromFile` (`*.cnd`).
export function candidateIni(value: Json): IniWriter {
  const model = asObject(value) ?? {}
  const writer = new IniWriter()
  if (model.b !== undefined) putCandidate(writer.section("CAND"), model)
  const switchModel = asObject(model.switch)
  if (switchModel) {
    const entries = writer.section("SWITCH")
    putBase(entries, switchModel)
    putFields(entries, switchModel, [
      ["i_normal", "NML_BACK_STYLE", "number"],
      ["i_select", "SEL_BACK_STYLE", "number"],
      ["i_font", "NML_FONT_STYLE", "number"],
      ["i_font_select", "SEL_FONT_STYLE", "number"],
      ["insets", "PADDING", "number"],
    ])
  }
  for (const [index, icon] of (Array.isArray(model.icon_list) ? model.icon_list : []).entries()) {
    const record = asObject(icon) ?? {}
    // Baidu candidate/cell icons are numbered from 1, the way real `.cnd` files spell them.
    const entries = writer.section(`ICON${index + 1}`)
    put(entries, "STAT_STYLE", tipsText(record.t))
    putBase(entries, record)
    put(entries, "KEY", actionText(record.k))
    putFields(entries, record, [
      ["p", "POS", "point"],
      ["s", "SIZE", "point"],
      ["keep", "PERSIST", "number"],
      ["anchor", "ANCHOR_TYPE", "number"],
      ["offset", "OFFSET", "point"],
      ["f_size", "FIX_SIZE", "point"],
      ["hot_fix", "CAN_PATCHED", "bool"],
    ])
  }
  for (const [index, tip] of Object.entries(asObject(model.fix) ?? {})) {
    const record = asObject(tip)
    if (record) putTip(writer, `TIP${index}`, record)
  }
  return writer
}

// `bubbleModelFromFile` (`*.pop`): `info` is a flat `[type, icon index, ...]` array.
export function bubbleIni(value: Json): IniWriter {
  const model = asObject(value) ?? {}
  const indexes = new Map<number, string>()
  const info = Array.isArray(model.info) ? model.info : []
  for (let index = 0; index + 1 < info.length; index += 2) {
    const text = numberText(info[index + 1])
    if (typeof info[index] === "number" && text !== undefined) indexes.set(info[index] as number, text)
  }
  const writer = new IniWriter()
  if (indexes.has(0)) put(writer.section("HINT"), "BACK_ICON", indexes.get(0))
  if ([2, 3, 4, 5].some((type) => indexes.has(type))) {
    const draw = writer.section("DRAW")
    put(draw, "ICON_UP", indexes.get(2))
    put(draw, "ICON_DN", indexes.get(3))
    put(draw, "ICON_LT", indexes.get(4))
    put(draw, "ICON_RT", indexes.get(5))
  }
  if (indexes.has(1) || model.i_cell !== undefined) {
    const bar = writer.section("BAR")
    put(bar, "BACK_ICON", indexes.get(1))
    put(bar, "CELL_STYLE", numberText(model.i_cell))
  }
  for (const [index, icon] of Object.entries(asObject(model.icon_info) ?? {})) {
    const record = asObject(icon) ?? {}
    // `icon_info` keeps the section numbering the `.pop` file had.
    const entries = writer.section(`ICON${index}`)
    putBase(entries, record)
    putFields(entries, record, [
      ["anchor", "ANCHOR_TYPE", "number"],
      ["i_cell", "CELL_STYLE", "number"],
      ["pos", "POS", "point"],
      ["size", "SIZE", "point"],
      ["c_size", "CELL_SIZE", "point"],
      ["insets", "PADDING", "insets"],
    ])
  }
  return writer
}
