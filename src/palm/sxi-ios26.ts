// iOS 26 transparent background for a Palm `skin.json`, the same result the Baidu tool gives a BDI
// skin: the candidate bar becomes fully transparent and every keyboard and the symbol panel almost
// transparent (alpha 01, so the panel still takes touches). Emoji, logo and selection pages keep theirs.

import { IOS26_RGB, isIos26KeyboardLayout } from "../ios26.ts"
import { boardFileName } from "./sxi-layout.ts"
import { asObject, type JsonObject } from "./sxi-ini.ts"
import { encodeSkinJson, parseSkinJson } from "./sxi-json.ts"

const THEMES = ["default", "night"]
const LAYOUTS = ["port_layout", "land_layout"]
const STYLE_TABLES = ["s_info", "s_port", "s_land"]

/** A fill style (`for_back`) of `color`, reused when the theme already has one. */
function fillStyle(struct: JsonObject, color: string): number {
  const shared = asObject(struct.s_info ?? null) ?? (struct.s_info = {})
  const styles = asObject(shared.ss_1 ?? null) ?? (shared.ss_1 = {})
  const existing = Object.entries(styles).find(([, value]) => {
    const text = asObject(asObject(value)?.s_1 ?? null)
    return text?.for_back === true && text.c_normal === color && text.c_hl === color
  })
  if (existing) return Number(existing[0])
  // The orientation tables override the shared one by id, so the new id is free in all three.
  const taken = STYLE_TABLES.flatMap((table) => Object.keys(asObject(asObject(struct[table] ?? null)?.ss_1 ?? null) ?? {})).map(Number)
  const id = Math.max(0, ...taken.filter(Number.isFinite)) + 1
  styles[String(id)] = { f: 0, id: `STYLE${id}`, s_1: { c_hl: color, c_normal: color, for_back: true } }
  return id
}

function setBack(owner: JsonObject, style: number): void {
  owner.b = { ...asObject(owner.b ?? null), base_b: style }
}

/** `skin.json` with the iOS 26 transparent backgrounds; throws when it has no keyboard to adapt. */
export function adaptSxiForIos26(text: string): string {
  const skin = parseSkinJson(text)
  let adapted = 0
  for (const themeKey of THEMES) {
    const struct = asObject(skin[themeKey] ?? null)
    if (!struct) continue
    const layouts = LAYOUTS.map((key) => asObject(struct[key] ?? null)).filter((layout): layout is JsonObject => Boolean(layout))
    if (!layouts.some((layout) => asObject(layout.b ?? null))) continue
    adapted += 1
    const candidate = fillStyle(struct, `00${IOS26_RGB.toUpperCase()}`)
    const panel = fillStyle(struct, `01${IOS26_RGB.toUpperCase()}`)
    for (const layout of layouts) {
      const boards = asObject(layout.b ?? null) ?? {}
      const global = asObject(boards.defaultGlobal ?? null)
      let candidateFiles = 0
      for (const model of Object.values(asObject(layout.c ?? null) ?? {})) {
        const cand = asObject(model)
        if (cand && asObject(cand.b ?? null)) {
          setBack(cand, candidate)
          candidateFiles += 1
        }
      }
      for (const [type, value] of Object.entries(boards)) {
        const board = asObject(value)
        if (!board) continue
        // A board without its own `board` falls back to defaultGlobal's field by field; giving it one
        // keeps the size and the rest of `b` while only the background changes.
        if (isIos26KeyboardLayout(boardFileName(type))) {
          const own = asObject(board.board ?? null) ?? {}
          own.b = { ...asObject(asObject(global?.board ?? null)?.b ?? null), ...asObject(own.b ?? null) }
          setBack(own, panel)
          board.board = own
        }
        for (const part of ["cand", "top_cand"]) {
          const owner = asObject(board[part] ?? null)
          if (owner && asObject(owner.b ?? null)) setBack(owner, candidate)
        }
      }
      // The bar's back is read from the `.cnd`, then the board's `cand`; one of them has to carry it.
      const globalCand = asObject(global?.cand ?? null)
      if (!candidateFiles && globalCand && !asObject(globalCand.b ?? null)) setBack(globalCand, candidate)
    }
  }
  if (!adapted) throw new Error("没有找到可适配的手心键盘布局。")
  return encodeSkinJson(skin)
}
