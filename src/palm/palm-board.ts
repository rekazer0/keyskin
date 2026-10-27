// One board of a Palm `skin.json` (theme, orientation, keyboard type) as the Palm keyboard lays it
// out, read from the JSON: its size, keys, symbol list and candidate bar, each keyboard state's
// `key_fix` swaps, and the key list the canvas selects and touches.
//
// A board's `board` / `list` / `offset` / `cand` fall back to `defaultGlobal` (field by field for
// `board`, like a layout's [PANEL] over gen.ini's). Keys are `KEY<id>`, list cells `LIST:<n>`, the
// candidate bar's icons `ICON<n>`, the section names the inspector edits.

import { DEFAULT_CANDIDATE_HEIGHT, DEFAULT_PANEL_WIDTH } from "../keyboard.ts"
import { stateTipSection } from "../panel-tools.ts"
import { isFullPanelPreviewItem, persistVisible, type PreviewItem, type Rect } from "../preview-items.ts"
import { actionText, asObject, rectParts, tipsText, type Json, type JsonObject } from "./sxi-ini.ts"
import { BUTTON_KEYS } from "./sxi-layout.ts"

export type PalmTheme = "default" | "night"
export type PalmOrientation = "port" | "land"
/** A key's back style, foreground styles and their offset ids. */
export type PalmBase = { back?: Json; fores: Json[]; offsets: Json[] }

export const THEME_DIRECTORY: Record<PalmTheme, string> = { default: "light", night: "dark" }

export function numbers(value: Json): number[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "number") ? value as number[] : undefined
}

export function rectOf(value: Json): Rect | undefined {
  const parts = rectParts(value)
  if (!parts || parts[2] <= 0 || parts[3] <= 0) return
  return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] }
}

export function list(value: Json): Json[] {
  return Array.isArray(value) ? value : value === undefined ? [] : [value]
}

function text(value: Json): string {
  return value === undefined || value === null ? "" : String(value)
}

export function baseOf(owner: JsonObject | undefined): PalmBase {
  const base = asObject(owner?.b ?? null) ?? {}
  return { back: base.base_b, fores: list(base.base_f), offsets: list(base.base_o) }
}

/** The `key_fix` entry a key's `fix_a` (`[state, entry, …]`) selects in `state`, if any. */
function stateFix(fixA: Json, fixes: JsonObject, state: number | undefined): JsonObject | undefined {
  const tip = stateTipSection(tipsText(fixA ?? null), state)
  return tip === undefined ? undefined : asObject(fixes[String(tip)])
}

/** Baidu's TIP replacement: each field the active `key_fix` entry sets replaces the key's own. */
function stateBase(own: PalmBase, fix: JsonObject | undefined): PalmBase {
  const replaced = asObject(fix?.b ?? null)
  if (!replaced) return own
  return {
    back: "base_b" in replaced ? replaced.base_b : own.back,
    fores: "base_f" in replaced ? list(replaced.base_f) : own.fores,
    offsets: "base_o" in replaced ? list(replaced.base_o) : own.offsets,
  }
}

/** `values` (`[button, action, …]`) by button name, in INI action codes (`F36` for `backspace`). */
function actions(values: Json): Record<string, string> {
  const pairs = list(values)
  const result: Record<string, string> = {}
  for (let index = 0; index + 1 < pairs.length; index += 2) {
    const button = typeof pairs[index] === "number" ? BUTTON_KEYS[pairs[index] as number] : undefined
    const action = actionText(pairs[index + 1])
    if (button && action !== undefined) result[button] = action
  }
  return result
}

function item(section: string, rect: Rect, base: PalmBase, owner: JsonObject, act: Record<string, string>, extra: Partial<PreviewItem> = {}): PreviewItem {
  const b = asObject(owner.b ?? null) ?? {}
  const foreAnimStyles = list(b.base_fa ?? b.base_a).map(text)
  const center = act.CENTER ?? ""
  return {
    section,
    sections: [section],
    rect,
    editable: true,
    show: act.SHOW ?? "",
    center,
    up: act.UP ?? "",
    down: act.DOWN || center,
    left: act.LEFT ?? "",
    right: act.RIGHT ?? "",
    hold: act.HOLD ?? "",
    holdSymbols: act.HOLDSYM ?? "",
    backStyle: text(base.back),
    foreStyle: text(base.fores[0]),
    foreStyles: base.fores.map(text),
    foreOffsets: [],
    positionTypes: base.offsets.map(text),
    statStyle: tipsText(owner.fix_a ?? owner.t ?? null) ?? "",
    animStyle: text(b.asi),
    backAnimStyle: text(b.base_ba),
    foreAnimStyle: foreAnimStyles[0] ?? "",
    foreAnimStyles,
    ...extra,
  }
}

/** `panelAnimation` is the style of the panel animation the key's press plays (`base_pa`). */
export type PalmKey = { section: string; rect: Rect; base: PalmBase; panelAnimation?: Json }
export type PalmCell = { section: string; rect: Rect; title: string }
export type PalmIcon = { section: string; rect: Rect; base: PalmBase; switch: boolean; fixed?: [number, number] }

export class PalmBoard {
  readonly theme: PalmTheme
  readonly orientation: PalmOrientation
  readonly width: number
  readonly height: number
  private readonly layout: JsonObject
  private readonly board: JsonObject
  private readonly global: JsonObject

  constructor(skin: JsonObject, theme: PalmTheme, orientation: PalmOrientation, type: string) {
    this.theme = theme
    this.orientation = orientation
    this.layout = asObject(asObject(skin[theme])?.[`${orientation}_layout`]) ?? {}
    const boards = asObject(this.layout.b) ?? {}
    this.board = asObject(boards[type]) ?? {}
    this.global = asObject(boards.defaultGlobal) ?? {}
    ;[this.width, this.height] = numbers(this.panel("size") ?? null) ?? [0, 0]
  }

  private panel(field: string): Json {
    return asObject(this.board.board)?.[field] ?? asObject(this.global.board)?.[field]
  }

  /** The board's own part, else `defaultGlobal`'s. */
  private part(field: string): JsonObject | undefined {
    return asObject(this.board[field]) ?? asObject(this.global[field])
  }

  /** The panel's show animation style (`asi`, Baidu's [PANEL] ANIM_STYLE). */
  get panelAnimation(): string {
    return text(asObject(asObject(this.board.board)?.b ?? null)?.asi)
  }

  /** The panel animation style (`base_pa`: shows with the board, plays on presses) and the region it fills (`a_insets`). */
  get panelClip(): { style: Json; region: Rect } {
    const board = asObject(this.board.board) ?? {}
    const insets = asObject(board.a_insets ?? null) ?? {}
    const inset = (side: string) => typeof insets[side] === "number" ? insets[side] as number : 0
    return {
      style: asObject(board.b ?? null)?.base_pa,
      region: { x: inset("left"), y: inset("top"), width: this.width - inset("left") - inset("right"), height: this.height - inset("top") - inset("bottom") },
    }
  }

  get panelBack(): Json {
    return asObject(asObject(this.board.board)?.b ?? null)?.base_b ?? asObject(asObject(this.global.board)?.b ?? null)?.base_b
  }

  offset(id: Json): [number, number] | undefined {
    const table = { ...asObject(this.global.offset), ...asObject(this.board.offset) }
    const point = numbers(asObject(table[String(id)])?.p ?? null)
    return point?.length === 2 ? point as [number, number] : undefined
  }

  /** Keys with a rect, a key covering the whole panel (a backdrop) first, as Baidu draws it. */
  keys(state: number | undefined): Array<PalmKey & { item: PreviewItem }> {
    const fixes = asObject(this.board.key_fix) ?? {}
    const keys = list(this.board.keys).map(asObject).flatMap((key) => {
      const rect = key && rectOf(key.rect ?? null)
      if (!key || !rect) return []
      const fix = stateFix(key.fix_a, fixes, state)
      const base = stateBase(baseOf(key), fix)
      const section = `KEY${key.id ?? ""}`
      const hit = rectParts(key.hit_rect ?? null)
      const touchRect = hit ? hit[2] > 0 && hit[3] > 0 ? { x: hit[0], y: hit[1], width: hit[2], height: hit[3] } : null : undefined
      const act = { ...actions(key.values), ...fix ? actions(fix.v) : {} }
      return [{ section, rect, base, panelAnimation: asObject(key.b ?? null)?.base_pa, item: item(section, rect, base, key, act, { touchRect }) }]
    })
    return keys.sort((left, right) => Number(!isFullPanelPreviewItem(left, this.width, this.height)) - Number(!isFullPanelPreviewItem(right, this.width, this.height)))
  }

  /** The symbol column: its bar, cells, styles; `t` 2 is a runtime scrolling list. */
  list(): { bar: Rect; cells: PalmCell[]; base: PalmBase; cell: Json } | undefined {
    const own = asObject(this.board.list)
    if (!own) return
    const global = asObject(this.global.list)
    const value = (field: string) => own[field] ?? global?.[field]
    const cell = numbers(value("size") ?? null)
    const position = numbers(value("pos") ?? null)
    const count = value("count")
    if (value("t") === 2 || cell?.length !== 2 || position?.length !== 2 || typeof count !== "number" || count <= 0) return
    const horizontal = value("order") === true
    const titles = list(value("titles") ?? null).filter((title): title is string => typeof title === "string").slice(0, count)
    return {
      bar: rectOf(value("rect") ?? null) ?? {
        x: position[0],
        y: position[1],
        width: cell[0] * (horizontal ? count : 1),
        height: cell[1] * (horizontal ? 1 : count),
      },
      cells: titles.map((title, index) => ({
        section: `LIST:${index + 1}`,
        title,
        rect: {
          x: position[0] + (horizontal ? index * cell[0] : 0),
          y: position[1] + (horizontal ? 0 : index * cell[1]),
          width: cell[0],
          height: cell[1],
        },
      })),
      // `b` falls back field by field: a board list may set only its bar (base_b) and keep defaultGlobal's text style.
      base: baseOf({ b: { ...asObject(global?.b ?? null), ...asObject(own.b ?? null) } }),
      cell: value("i_cell"),
    }
  }

  /** Everything the canvas lists: keys, then the symbol list's bar and its (unselectable) cells. */
  items(state: number | undefined): PreviewItem[] {
    const keys = this.keys(state).map(({ item }) => item)
    const symbols = this.list()
    if (!symbols) return keys
    const bar = item("LIST", symbols.bar, { ...symbols.base, fores: [] }, {}, {})
    const cells = symbols.cells.map((cell) => item(cell.section, cell.rect, { back: symbols.cell, fores: symbols.base.fores, offsets: [] }, {}, {}, { editable: false, show: cell.title }))
    return [...keys, bar, ...cells]
  }

  /** The candidate bar's `.cnd` model (`c.<file>`), with the board's own `cand` over `defaultGlobal`'s. */
  private candidateModel(): { own: JsonObject; global: JsonObject; cand?: JsonObject } {
    const own = asObject(this.board.cand) ?? {}
    const global = asObject(this.global.cand) ?? {}
    const file = own.file ?? global.file
    return { own, global, cand: typeof file === "string" ? asObject(asObject(this.layout.c)?.[file]) : undefined }
  }

  /** The candidate rect includes the input-code inset; the preview renders that row separately. */
  get candidateSize(): { width: number; height: number } | undefined {
    const { own, global, cand } = this.candidateModel()
    if (!cand) return
    const rect = rectOf(cand.rect ?? null) ?? rectOf(own.rect ?? global.rect ?? null)
    if (!rect) return { width: this.width || DEFAULT_PANEL_WIDTH, height: DEFAULT_CANDIDATE_HEIGHT }
    const top = asObject(own.insets ?? global.insets ?? null)?.top
    const inputHeight = typeof top === "number" && Number.isFinite(top) ? Math.max(0, top) : 0
    return { width: rect.width, height: Math.max(1, rect.height - inputHeight) }
  }

  get candidateBack(): Json {
    const { own, global, cand } = this.candidateModel()
    return baseOf(cand).back ?? baseOf(own).back ?? baseOf(global).back
  }

  /** Candidate word spacing, as the `.cnd` gives it: left padding, first gap, cell and more widths. */
  get candidateSpacing(): { padding?: number; firstGap?: number; cellWidth?: number; moreWidth?: number } {
    const cand = this.candidateModel().cand ?? {}
    const number = (value: Json) => typeof value === "number" ? value : undefined
    return { padding: number(asObject(cand.insets ?? null)?.left), firstGap: number(cand.f_gap), cellWidth: number(cand.gap), moreWidth: number(cand.more_width) }
  }

  /**
   * Style ids of the candidate words, the first candidate and the input code, looked up like the
   * Baidu engine: the `.cnd`, then the board's `cand`, then `top_cand` (SCAND) and `input`.
   */
  get candidateTextStyles(): { words?: Json; first?: Json; input?: Json; inputSize?: Json; inputBack?: Json; inlineBack?: Json } {
    const { own, global, cand } = this.candidateModel()
    const top = this.part("top_cand")
    const input = this.part("input")
    const inputFore = list(asObject(input?.b ?? null)?.base_f)[0]
    return {
      words: cand?.i_cand ?? own.i_cand ?? global.i_cand ?? top?.s_i,
      first: cand?.i_f_f ?? own.i_f_f ?? global.i_f_f,
      input: top?.i_i ?? inputFore ?? list(asObject(top?.b ?? null)?.base_f)[0],
      inputSize: inputFore,
      inputBack: asObject(input?.b ?? null)?.base_b,
      inlineBack: asObject(top?.b ?? null)?.base_b,
    }
  }

  /**
   * The bar's icons (`ICON<n>`), placed by anchor (1–9, a 3×3 grid over the bar) and offset; `keep` is
   * Baidu's PERSIST (1 without a composition, 2 while composing, 3 always). iOS gives `f_size` in
   * points, the bar's units are @3x pixels.
   */
  /** `composing` undefined lists every icon, whatever its `keep`. */
  icons(state: number | undefined, composing?: boolean): Array<PalmIcon & { item: PreviewItem }> {
    const size = this.candidateSize
    const cand = this.candidateModel().cand
    if (!size || !cand) return []
    const fixes = asObject(cand.fix ?? null) ?? {}
    return list(cand.icon_list ?? null).map(asObject).flatMap((icon, index) => {
      const iconSize = numbers(icon?.s ?? null)
      if (!icon || iconSize?.length !== 2 || composing !== undefined && !persistVisible(text(icon.keep ?? 1), composing)) return []
      const [x, y] = numbers(icon.p ?? null) ?? [0, 0]
      const anchor = typeof icon.anchor === "number" ? icon.anchor : 1
      const rect = { x: (anchor - 1) % 3 * size.width / 2 + x, y: (Math.ceil(anchor / 3) - 1) * size.height / 2 + y, width: iconSize[0], height: iconSize[1] }
      const fixedSize = numbers(icon.f_size ?? null)
      const fixed = fixedSize?.length === 2 ? [fixedSize[0] * 3, fixedSize[1] * 3] as [number, number] : undefined
      const fix = stateFix(icon.t, fixes, state)
      const base = stateBase(baseOf(icon), fix)
      const section = `ICON${index + 1}`
      const foreRect = fixed && { x: rect.x + (rect.width - fixed[0]) / 2, y: rect.y + (rect.height - fixed[1]) / 2, width: fixed[0], height: fixed[1] }
      const act = { CENTER: actionText(fix?.k ?? icon.k) ?? "", ...fix ? actions(fix.v) : actions(icon.v) }
      return [{ section, rect, base, switch: icon.k === "switchContainer", fixed, item: item(section, rect, base, icon, act, foreRect ? { foreRect } : {}) }]
    })
  }

  /** The bar's list: the whole bar (unselectable), then its icons. */
  candidateItems(state: number | undefined, composing: boolean): PreviewItem[] {
    const size = this.candidateSize
    if (!size) return []
    const bar = item("CAND", { x: 0, y: 0, ...size }, { fores: [], offsets: [] }, {}, {}, { editable: false })
    const icons = this.icons(state, composing).map(({ item }) => item)
    if (!composing && !this.icons(state).length) {
      icons.push(item("BUILTIN_TOOLBAR", bar.rect, { fores: [], offsets: [] }, {}, {}, { editable: false }))
    }
    return [bar, ...icons]
  }

  /** The bubble layout (`h.<file>`) the board's keys pop. */
  get hint(): JsonObject | undefined {
    const file = this.part("hint")?.file
    return typeof file === "string" ? asObject(asObject(this.layout.h)?.[file]) : undefined
  }

  /** Keyboard states some key of this theme and orientation swaps for (`fix_a`). */
  states(): number[] {
    const states = new Set<number>()
    for (const board of Object.values(asObject(this.layout.b) ?? {})) {
      for (const key of list(asObject(board)?.keys)) {
        const fixA = list(asObject(key)?.fix_a)
        for (let index = 0; index + 1 < fixA.length; index += 2) if (typeof fixA[index] === "number") states.add(fixA[index] as number)
      }
    }
    return [...states].sort((a, b) => a - b)
  }
}
