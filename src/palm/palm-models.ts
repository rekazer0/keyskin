// Palm `PalmSkin` model builders: each ports a Swift model's `init(entries:)`, turning one
// INI/CSS/`.til` section into the JSON `skin.json` stores for it.

import { boardTypeFromIniCode } from "./palm-board-types.ts"
import {
  actionCode,
  stripSpaces,
  toBool,
  toCharacters,
  toDouble,
  toDoubleArray,
  toInsets,
  toInt,
  toIntArray,
  toLastInt,
  toPoint,
  toRect,
  toTipsMap,
  type IniSection,
  type PalmInsets,
} from "./palm-ini.ts"
import type { PalmJSONValue } from "./palm-json.ts"

type Json = PalmJSONValue
type Ini = Record<string, string>

// CoreGraphics values encode as nested arrays: points as `[x, y]`, rects as
// `[[x, y], [w, h]]`.
function pointJson(value: [number, number] | undefined): Json {
  return value === undefined ? undefined : [value[0], value[1]]
}

function rectJson(value: [[number, number], [number, number]] | undefined): Json {
  return value === undefined ? undefined : [[value[0][0], value[0][1]], [value[1][0], value[1][1]]]
}

function insetsJson(value: PalmInsets | undefined): Json {
  return value === undefined
    ? undefined
    : { top: value.top, left: value.left, bottom: value.bottom, right: value.right }
}

// `SkinButtonType`, in declaration order. The order is what makes the "B<x>" shorthand
// deterministic: Swift iterates a dictionary there.
const BUTTON_TYPES: Array<[number, string]> = [
  [0, "UP"],
  [1, "DOWN"],
  [2, "LEFT"],
  [3, "RIGHT"],
  [4, "CENTER"],
  [5, "SHOW"],
  [6, "HOLD"],
  [7, "HOLDSYM"],
  [8, "BAR_SYM"],
  [9, "BAR_SYM_SEL"],
]

const SHOW_TYPE = 5

function buttonValues(entries: Ini): Array<[number, string]> {
  const resolved: Array<string | undefined> = new Array(BUTTON_TYPES.length).fill(undefined)
  for (const [type, iniKey] of BUTTON_TYPES) {
    const raw = entries[iniKey]
    if (raw === undefined) continue
    resolved[type] = actionCode(raw) ?? raw
  }
  for (const [type] of BUTTON_TYPES) {
    const value = resolved[type]
    if (value === undefined || value.length !== 2 || !value.startsWith("B")) continue
    resolved[type] = value.replace(/B/g, "")
    resolved[SHOW_TYPE] = resolved[type]
  }
  const result: Array<[number, string]> = []
  for (const [type] of BUTTON_TYPES) {
    const value = resolved[type]
    if (value !== undefined) result.push([type, value])
  }
  return result
}

// `SkinButtonType.valueMapFrom` never returns nil, and both encoders open a nested
// unkeyed container unconditionally, so an empty map still writes `[]`.
function valuesJson(pairs: Array<[number, string]>): Json {
  const flat: Array<number | string> = []
  for (const [type, value] of pairs) {
    flat.push(type, value)
  }
  return flat
}

export function indexKey(sectionName: string, prefix: string): number | undefined {
  return toInt(sectionName.split(prefix).join(""))
}

// `SkinBaseModel.init(entries:)`.
export function baseModel(entries: Ini): Json {
  const foreStyle = entries["FORE_STYLE"] === undefined ? undefined : toIntArray(entries["FORE_STYLE"])
  const offsets = entries["POS_TYPE"] === undefined ? undefined : toIntArray(entries["POS_TYPE"])
  return {
    base_b: toInt(entries["BACK_STYLE"]),
    base_f: foreStyle,
    base_s: toInt(entries["SOUND_STYLE"]),
    asi: toLastInt(entries["ANIM_STYLE"]),
    base_ba: toInt(entries["BACK_ANIM_STYLE"]),
    base_o: offsets === undefined ? undefined : offsets.slice(0, foreStyle?.length ?? 0),
    base_pa: toInt(entries["PANEL_ANIM_STYLE"]),
    base_fa: entries["FORE_ANIM_STYLE"] === undefined ? undefined : toIntArray(entries["FORE_ANIM_STYLE"]),
    base_a: toLastInt(entries["FORE_ANIM_STYLE"]),
  }
}

export function constModel(entries: Ini): Json {
  return { s_full: toBool(entries["SYMBOL_FULL_SCREEN"]) }
}

// `SkinComposeModel` ([INPUT]).
export function composeModel(entries: Ini): Json {
  return {
    b: baseModel(entries),
    type: toInt(entries["TYPE"]),
    pos: pointJson(toPoint(entries["POS"])),
    size: pointJson(toPoint(entries["SIZE"])),
    f_size: pointJson(toPoint(entries["FIX_SIZE"])),
    insets: insetsJson(toInsets(entries["PADDING"])),
  }
}

// `SkinCandidateModel.setupWithEntries` ([CAND], shared with `*.cnd`).
export function candidateModel(entries: Ini): Record<string, Json> {
  return {
    b: baseModel(entries),
    f_size: pointJson(toPoint(entries["FIX_SIZE"])),
    rect: rectJson(toRect(entries["VIEW_RECT"])),
    insets: insetsJson(toInsets(entries["PADDING"])),
    gap: toDouble(entries["CELL_W"]),
    f_gap: toDouble(entries["FIRST_GAP"]),
    more_width: toDouble(entries["MORE_W"]),
    i_cell: toInt(entries["CELL_STYLE"]),
    i_mask: toInt(entries["MASK_STYLE"]),
    i_f_b: toInt(entries["FIRST_BACK"]),
    i_f_f: toInt(entries["FIRST_FORE"]),
    switch: undefined,
    icon_list: undefined,
    fix: undefined,
    file: entries["LAYOUT_NAME"],
    i_cand: toIntArray(entries["FORE_STYLE"])[0],
  }
}

export function candidateSwitchModel(entries: Ini): Json {
  return {
    b: baseModel(entries),
    i_normal: toInt(entries["NML_BACK_STYLE"]),
    i_select: toInt(entries["SEL_BACK_STYLE"]),
    i_font: toInt(entries["NML_FONT_STYLE"]),
    i_font_select: toInt(entries["SEL_FONT_STYLE"]),
    insets: toDouble(entries["PADDING"]),
  }
}

export function candidateIconModel(entries: Ini): Json {
  const anchor = toInt(entries["ANCHOR_TYPE"]) ?? 4
  return {
    t: toTipsMap(entries["STAT_STYLE"]),
    b: baseModel(entries),
    p: pointJson(toPoint(entries["POS"])),
    s: pointJson(toPoint(entries["SIZE"])),
    k: actionCode(entries["KEY"] ?? ""),
    keep: toInt(entries["PERSIST"]),
    anchor: anchor >= 1 && anchor <= 9 ? anchor : undefined,
    offset: pointJson(toPoint(entries["OFFSET"])),
    f_size: pointJson(toPoint(entries["FIX_SIZE"])),
    hot_fix: toBool(entries["CAN_PATCHED"]),
  }
}

export function bubbleIconModel(entries: Ini): Json {
  const anchor = toInt(entries["ANCHOR_TYPE"]) ?? 4
  return {
    b: baseModel(entries),
    anchor: anchor >= 1 && anchor <= 9 ? anchor : undefined,
    i_cell: toInt(entries["CELL_STYLE"]),
    pos: pointJson(toPoint(entries["POS"])),
    size: pointJson(toPoint(entries["SIZE"])),
    c_size: pointJson(toPoint(entries["CELL_SIZE"])),
    insets: insetsJson(toInsets(entries["PADDING"])),
  }
}

// `SkinBubbleModel(entries:)` ([HINT]).
export function bubbleModel(entries: Ini): Json {
  return {
    b: baseModel(entries),
    anchor: toInt(entries["ANCHOR_TYPE"]),
    hint: toInt(entries["TYPE"]),
    file: entries["LAYOUT_NAME"],
    bar_a: toInt(entries["FORE_ANIM_STYLE"]),
    info: undefined,
    icon_info: undefined,
    i_cell: undefined,
  }
}

// `SkinEmoticonModel` + its two `SkinEmojiIconModel`s ([EMOJI]).
export function emoticonModel(entries: Ini): Json {
  const icon: Json = { b: baseModel(entries), i_text: toInt(entries["TEXT_STYLE_INDEX"]) }
  return {
    b: baseModel(entries),
    i_text: toInt(entries["PANEL_BACK_STYLE_INDEX"]),
    index_t: toInt(entries["TAB_BACK_STYLE_INDEX"]),
    t_icon: icon,
    p_icon: icon,
    file: entries["LAYOUT_NAME"],
    b_line: toInt(entries["BOTTOM_LINE"]),
  }
}

// `SkinAdditionModel` ([MORE]).
export function additionModel(entries: Ini): Json {
  const grid = toPoint(entries["GRID"])
  const layoutName = entries["LAYOUT_NAME"]
  const mapped = layoutName === undefined ? undefined : boardTypeFromIniCode(layoutName)
  // Baidu writes `GRID=columns,rows`; Palm stores `row` and `col` the other way round.
  const col = grid === undefined ? undefined : Math.trunc(grid[0])
  const row = grid === undefined ? undefined : Math.trunc(grid[1])
  return {
    b: baseModel(entries),
    row,
    col,
    i_h: toInt(entries["H_LINE_STYLE_INDEX"]),
    i_v: toInt(entries["V_LINE_STYLE_INDEX"]),
    i_c: toInt(entries["CELL_STYLE_INDEX"]),
    i_l: toInt(entries["LOCK_STYLE_INDEX"]),
    i_b: toInt(entries["BORDER_STYLE_INDEX"]),
    file_info: {},
    file: mapped ?? layoutName,
    sym_layout: entries["SYM_LAYOUT"],
    l_color: entries["LINE_COLOR"],
  }
}

// `SkinTableModel` ([LIST] / [SEGMENT]).
export function tableModel(entries: Ini): Json {
  return {
    b: baseModel(entries),
    order: toBool(entries["LIST_ORDER"]),
    side: toBool(entries["SCROLL_SIDE"]),
    t: toInt(entries["TYPE"]),
    count: toInt(entries["LIST_NUM"]),
    i_cell: toInt(entries["CELL_STYLE"]),
    i_last: undefined,
    i_scroll: toInt(entries["SCROLL_STYLE"]),
    pos: pointJson(toPoint(entries["POS"])),
    size: pointJson(toPoint(entries["SIZE"] ?? entries["CELL_SIZE"])),
    rect: rectJson(toRect(entries["VIEW_RECT"])),
    insets: insetsJson(toInsets(entries["PADDING"])),
    titles: entries["NAMES"] === undefined ? undefined : toCharacters(stripSpaces(entries["NAMES"])),
    values: entries["VALUES"] === undefined ? undefined : toCharacters(stripSpaces(entries["VALUES"])),
  }
}

// `SkinHelpCandModel` ([SCAND]).
export function helpCandModel(entries: Ini): Json {
  return {
    b: baseModel(entries),
    i_i: toInt(entries["INPUT_STYLE"]),
    s_i: toInt(entries["SCAND_STYLE"]),
    insets: insetsJson(toInsets(entries["PADDING"])),
    rect: rectJson(toRect(entries["VIEW_RECT"])),
  }
}

// `SkinBoardDrawModel` ([PANEL]).
export function boardDrawModel(entries: Ini): Json {
  const base = baseModel(entries)
  const borderStyle = toInt(entries["BORDER_ANIM_STYLE"]) ?? toInt(entries["PANEL_ANIM_STYLE"])
  const ranges = entries["BORDER_RANGE"]
  const border = borderStyle !== undefined && ranges !== undefined
    ? { a: borderStyle, r: borderRangesJson(ranges) }
    : undefined
  const model: Record<string, Json> = {
    b: base,
    exact: toBool(entries["NO_BLUR"]),
    right: toBool(entries["NO_F3_FIX"]),
    c_rect: toBool(entries["CUSTOM_RECT"]),
    top_o: undefined,
    size: pointJson(toPoint(entries["SIZE"])),
    f_size: pointJson(toPoint(entries["FIX_SIZE"])),
    i_b: undefined,
    i_f: undefined,
    extend: toInt(entries["ANIM_EXTEND"]),
    level: toInt(entries["ANIM_LEVEL"]),
    a_insets: insetsJson(toInsets(entries["PANEL_ANIM_INSET"])),
    bd: border === undefined ? undefined : { b: border },
  }
  const baseRecord = base as Record<string, Json>
  // Palm plays panel particles through base_pa, including Baidu's panel ANIM_STYLE.
  baseRecord.base_pa ??= toInt(entries["ANIM_STYLE"])
  if (baseRecord.base_ba === undefined || baseRecord.base_ba === null) {
    baseRecord.base_ba = toInt(entries["ANIM_STYLE"])
  }
  return model
}

function borderRangesJson(text: string): Json {
  const ranges = text.split(";").flatMap((item) => {
    const parts = item.split(",")
    if (parts.length !== 2) return []
    const x = toDouble(parts[0])
    const y = toDouble(parts[1])
    if (x === undefined || y === undefined) return []
    return [[Math.min(Math.max(x, 0), 1), Math.min(Math.max(y, -1), 2)]]
  })
  return ranges.length === 0 ? undefined : ranges
}

// `SkinButtonModel` ([KEY*]).
export function buttonModel(entries: Ini, sectionName: string): Json {
  const viewRect = toRect(entries["VIEW_RECT"])
  const touchRect = toRect(entries["TOUCH_RECT"]) ?? viewRect
  return {
    b: baseModel(entries),
    hasU: undefined,
    f: undefined,
    h_style: undefined,
    rect: rectJson(viewRect),
    hit_rect: rectJson(touchRect),
    offset: undefined,
    fix_b: undefined,
    id: sectionName.replace(/KEY/g, ""),
    values: valuesJson(buttonValues(entries)),
    fix_a: toTipsMap(entries["STAT_STYLE"]),
  }
}

// `SkinButtonFixModel` ([TIP*]) — the key is resolved through the action code table.
export function buttonFixModel(entries: Ini): Json {
  const key = entries["KEY"]
  return {
    b: baseModel(entries),
    k: key === undefined ? undefined : actionCode(key) ?? key,
    v: valuesJson(buttonValues(entries)),
  }
}

// `SkinPosFixModel` ([OFFSET*]) — integers only, without trimming.
export function posFixModel(entries: Ini): Json {
  const text = entries["POS"]
  if (text === undefined) return {}
  const parts = text.split(",")
  if (parts.length !== 2) return {}
  const x = toInt(parts[0])
  const y = toInt(parts[1])
  return x === undefined || y === undefined ? {} : { p: [x, y] }
}

// `SkinMotiveModel` ([FORCE*]).
export function motiveModel(entries: Ini): Json {
  return {
    start: toDouble(entries["BEGIN"]),
    finish: toDouble(entries["END"]),
    value: toDouble(entries["VALUE"]),
  }
}

// `SkinTileInfoModel` (`.til` tile maps).
function tileModel(entries: Ini, sectionName: string, alpha: number | undefined): Json {
  return {
    info: toBool(entries["SCALABLE"]),
    alpha: alpha !== undefined ? alpha : toInt(entries["USE_ALPHA"]),
    mode: toInt(entries["TILE_MODE"]),
    t_s: toInt(entries["THEME_SCALE_STYLE"]),
    rect1: rectJson(toRect(entries["SOURCE_RECT"])),
    rect2: rectJson(toRect(entries["INNER_RECT"])),
    insets: insetsJson(toInsets(entries["PADDING"])),
    scale: undefined,
    scales: toDoubleArray(entries["SCALE"]),
    id: sectionName,
  }
}

export function tileModels(sections: IniSection[]): Json[] {
  const models: Json[] = []
  let useAlpha: number | undefined
  for (const section of sections) {
    if (section.name === "GLOBAL") {
      const model = tileModel(section.entries, section.name, useAlpha)
      useAlpha = (model as Record<string, Json>).alpha as number | undefined
    } else if (section.name.startsWith("IMG")) {
      models.push(tileModel(section.entries, section.name, useAlpha))
    }
  }
  return models
}

// `SkinInfoModel` ([STYLE*]).
export function infoModel(entries: Ini, sectionName: string): Json {
  return {
    f: 0,
    id: sectionName,
    s_1: textStyleModel(entries),
    s_2: imageStyleModel(entries),
    s_3: borderStyleModel(entries),
    s_4: soundStyleModel(entries),
    s_5: animationStyleModel(entries),
  }
}

function textStyleModel(entries: Ini): Json {
  const keys = ["SHOW", "FONT_CLEARTYPE", "FONT_SIZE", "FONT_NAME", "NM_COLOR", "HL_COLOR", "FONT_PATH"]
  if (keys.every((key) => entries[key] === undefined)) return undefined
  const backKeys = ["SHOW", "FONT_CLEARTYPE", "FONT_SIZE", "FONT_NAME", "FONT_PATH"]
  return {
    text: entries["SHOW"],
    c_type: toInt(entries["FONT_CLEARTYPE"]),
    f_s: toDouble(entries["FONT_SIZE"]),
    f_n: entries["FONT_NAME"],
    c_normal: entries["NM_COLOR"],
    c_hl: entries["HL_COLOR"],
    file: entries["FONT_PATH"],
    for_back: backKeys.every((key) => entries[key] === undefined),
  }
}

function imageStyleModel(entries: Ini): Json {
  if (entries["NM_IMG"] === undefined && entries["HL_IMG"] === undefined) return undefined
  return { normal: entries["NM_IMG"], hl: entries["HL_IMG"] }
}

function borderStyleModel(entries: Ini): Json {
  const size = toDouble(entries["BORDER_SIZE"])
  if (size === undefined) return undefined
  return { size, color: entries["BORDER_COLOR"] }
}

function soundStyleModel(entries: Ini): Json {
  const path1 = entries["PRESS_SOUND_PATH"]
  const path2 = entries["PANEL_SHOW_SOUND_PATH"]
  const path3 = entries["PANEL_HIDE_SOUND_PATH"]
  if (path1 === undefined && path2 === undefined && path3 === undefined) return undefined
  return { path_1: path1, path_2: path2, path_3: path3 }
}

function animationStyleModel(entries: Ini): Json {
  const press = toInt(entries["PRESS_ANIM"])
  const release = toInt(entries["RELEASE_ANIM"])
  const show = toInt(entries["SHOW_ANIM"])
  const hide = toInt(entries["HIDE_ANIM"])
  const hold = toInt(entries["HOLD_ANIM"])
  if (press === undefined && release === undefined && show === undefined && hold === undefined && hide === undefined) {
    return undefined
  }
  return { "1": press, "2": release, "3": show, "4": hide, "5": hold }
}
