// Correspondence between Baidu layout keys and Sogou key classes.
//
// Baidu skins place keys explicitly (`[KEYn] CENTER=q VIEW_RECT=…`); Sogou skins only style key
// *classes* (`[Key_Q]`, `[Key_Backspace_Qwerty]`) and let the app place them. A Baidu key is identified
// by its board (from the layout file name) and its action (`CENTER`), which picks an ordered list of
// Sogou sections: the most specific one first, then the shared defaults (`KeyBg_Default_Latin`, …) a
// Sogou app falls back to. Both conversion directions use this one table.

type SsfBoard = "py26" | "en26" | "num26" | "py9" | "en9" | "bh" | "num9" | "other"
type SsfKeyClass = "char" | "space" | "function"
export type SsfKeyBinding = {
  /** Sogou key sections, most specific first (landscape variants lead in landscape). */
  sections: string[]
  /** Shared background classes used when no key section names a background. */
  defaults: string[]
  keyClass: SsfKeyClass
}

const NINE_KEY_GROUPS = ["ABC", "DEF", "GHI", "JKL", "MNO", "PQRS", "TUV", "WXYZ"]
const STROKES = ["One", "Two", "Three", "Four", "Five"]
/** Only these letters have separate pinyin / English classes (`Key_H_PY`, `Key_H_EN`); the rest share `Key_Q`. */
const MODE_LETTERS = "HJLS"

export function ssfBoard(layout: string): SsfBoard {
  // BDA landscape adds split / one-handed variants of the same boards (`py_9_split_left`, `bh_union`).
  const name = layout.replace(/\.ini$/i, "").split("/").pop()!.toLowerCase().replace(/_(?:split|union)(?:_left)?$/, "")
  // Sogou's variants (double pinyin, big enter, Cantonese, 14-key) style their keys like the base board.
  if (/^(?:py_26|def_26|py_14|cantonese_26)/.test(name)) return "py26"
  if (/^en_26/.test(name)) return "en26"
  if (/^num_26/.test(name)) return "num26"
  if (/^(?:py_9|def_9|big_9|cantonese_9)/.test(name)) return "py9"
  if (name === "en_9" || name === "en_9s" || name === "en_9_multi") return "en9"
  if (/^bh/.test(name)) return "bh"
  if (name === "num_9") return "num9"
  return "other"
}

const isQwerty = (board: SsfBoard) => board === "py26" || board === "en26" || board === "num26"

/** 26-key boards (and Sogou's variants styled like them, such as py_14) read the `_Qwerty` / `_Latin` classes. */
export function ssfQwerty(layout: string): boolean {
  return isQwerty(ssfBoard(layout))
}

/** Default actions carried by Baidu layouts but supplied by Sogou at runtime. */
export function ssfKeyActions(layout: string, action: string, sourceSection?: string): Record<string, string> {
  const board = ssfBoard(layout)
  const name = layout.replace(/\.ini$/i, "").split("/").pop()!.toLowerCase()
  const handwritingFull = name === "hw_full" || name === "handwriting_full"
  const handwritingGrid = name === "hw_grid" || name === "handwriting_grid"
  const letter = action.toLowerCase()
  const section = sourceSection?.toLowerCase() ?? ""
  if (name === "en_26s" && letter === "i") return { UP: "8" }
  const qwertyIndex = "qwertyuiop".indexOf(letter)
  if ((board === "py26" || board === "en26") && qwertyIndex >= 0) {
    const digit = "1234567890"[qwertyIndex]
    return { UP: digit, LEFT: digit, RIGHT: digit }
  }
  if (board === "py26") {
    if (action === "，") return { UP: "!" }
    if (action === "。") return { UP: "?" }
  }
  if (board === "en26" && action === ".") return { UP: "," }
  if (board === "py26" || board === "en26") {
    const symbolIndex = "asdfghjklzxcvbnm".indexOf(letter)
    if (symbolIndex >= 0) {
      const symbol = "!@#$%&*()~/-_:;?"[symbolIndex]
      return { UP: symbol, LEFT: symbol, RIGHT: symbol }
    }
  }
  if (board === "en9" && section.match(/^key_(abc|def|ghi|jkl|mno|pqrs|tuv|wxyz)_multi$/)) {
    const group = section.match(/^key_(abc|def|ghi|jkl|mno|pqrs|tuv|wxyz)_multi$/)![1]
    const index = NINE_KEY_GROUPS.findIndex((value) => value.toLowerCase() === group)
    return { UP: String(index + 2), LEFT: group[0], RIGHT: group[2], ...group[3] ? { DOWN: group[3] } : {}, SHOW: String(index + 2) }
  }
  if (board === "en9" && section === "key_punct_multi") return { UP: "1", LEFT: "@", RIGHT: "/", HOLD: "1", SHOW: "1" }
  if (board === "py9" || board === "en9") {
    const index = NINE_KEY_GROUPS.findIndex((group) => group[1].toLowerCase() === letter)
    if (index >= 0) {
      const group = NINE_KEY_GROUPS[index].toLowerCase()
      return { UP: String(index + 2), LEFT: group[0], RIGHT: group[2], ...group[3] ? { DOWN: group[3] } : {}, SHOW: String(index + 2) }
    }
    if (action === "'" || action === "…" || action === "*") {
      return { UP: "1", ...board === "en9" ? { LEFT: "@", RIGHT: "/" } : {}, HOLD: "1", SHOW: "1" }
    }
    if (action === "F38") return { UP: "0" }
  }
  if (board === "bh") {
    const stroke = action.match(/^B([1-6])$/)?.[1]
    if (stroke) return { UP: stroke }
    if (action === "'") return { UP: "7" }
    if (action === "：") return { UP: "8" }
    if (action === "；") return { UP: "9" }
    if (action === "F38") return { UP: "0" }
  }
  if (action === "F36") return { LEFT: handwritingFull ? "40" : "F40" }
  if ((board === "py26" || board === "py9" || board === "bh" || handwritingFull) && action === "F16") return { UP: "F16" }
  if ((board === "en26" || board === "en9") && action === "F15") return { UP: "F15" }
  if ((board === "py26" || board === "en26" || handwritingFull) && action === "F1") return { UP: "F7", HOLD: "F7" }
  if (handwritingGrid && action === "，") return { UP: "。" }
  return {}
}

/** Function keys whose Sogou class only differs by the `_Qwerty` suffix on 26-key boards. */
const FUNCTION_KEYS: Record<string, [qwerty: string[], nine: string[]]> = {
  F36: [["Key_Backspace_Qwerty"], ["Key_Backspace"]],
  F39: [["Key_Enter_Qwerty"], ["Key_Enter"]],
  F38: [["Key_Space"], ["Key_Space"]],
  F6: [["Key_Symbols_Qwerty"], ["Key_Digits"]],
  "Z+num_26_1": [["Key_Symbols_Qwerty"], ["Key_Digits"]],
  F1: [["Key_SymbolTable_Qwerty"], ["Key_SymbolTable"]],
  F16: [["Key_SwitchToEN_Qwerty"], ["Key_SwitchToEN"]],
  F15: [["Key_EnSwitchToCH_Qwerty"], ["Key_EnSwitchToCH"]],
  F10: [["Key_Shift_Qwerty", "Key_Shift"], ["Key_Shift"]],
  F11: [["Key_Shift_Qwerty", "Key_Shift"], ["Key_Shift"]],
  F4: [["Key_Return"], ["Key_Return"]],
  F40: [["Key_Clear_Input"], ["Key_Clear_Input"]],
  F25: [["Key_Prediction"], ["Key_Prediction_En9"]],
}

function primarySections(board: SsfBoard, action: string): string[] {
  const letter = /^[a-z]$/i.test(action) ? action.toUpperCase() : undefined
  const digit = /^\d$/.test(action) ? action : undefined
  const fn = FUNCTION_KEYS[action]
  if (fn) return isQwerty(board) ? fn[0] : fn[1]
  switch (board) {
    case "py26":
      if (letter) return MODE_LETTERS.includes(letter) ? [`Key_${letter}_PY`, `Key_${letter}`] : [`Key_${letter}`]
      if (action === "'") return ["Key_Separator"]
      if (action === "，") return ["Key_UDSymbol1_Qwerty"]
      if (action === "。") return ["Key_UDSymbol2_Qwerty"]
      return []
    case "en26":
      if (letter) return MODE_LETTERS.includes(letter) ? [`Key_${letter}_EN`, `Key_${letter}`] : [`Key_${letter}`]
      if (action === ".") return ["Key_PeriodEn_T"]
      if (action === ",") return ["Key_CommaEn_T"]
      return []
    case "num26":
      return digit ? [`Key_${digit}_Qwerty`] : []
    case "num9":
      return digit ? [`Key_${digit}`] : []
    case "py9":
    case "en9": {
      if (letter) {
        const group = NINE_KEY_GROUPS.find((value) => value.includes(letter))
        return group ? [`Key_${group}`] : []
      }
      if (action === "'") return ["Key_PunctPY"]
      // The 9-key 0 is Sogou's edit key; skins style it there, rarely on its digit class.
      if (action === "0") return [board === "py9" ? "Key_Edits" : "Key_Edits_en9", "Key_0_py9"]
      return action === "…" || action === "*" ? ["Key_Punct"] : []
    }
    case "bh": {
      const stroke = action.match(/^B([1-6])$/)?.[1]
      if (stroke) return [stroke === "6" ? "Key_Wildcard" : `Key_${STROKES[Number(stroke) - 1]}`]
      if (action === "'") return ["Key_Separator_bh_S"]
      if (action === "：") return ["Key_Eight_S"]
      return action === "；" ? ["Key_Nine_S"] : []
    }
    default:
      return []
  }
}

/** Sogou names landscape classes either `Key_D_Land` or `Key_H_Land_PY`. */
function landscapeVariants(section: string): string[] {
  const suffixed = section.match(/^(.*)_(PY|EN)$/)
  return suffixed ? [`${suffixed[1]}_Land_${suffixed[2]}`, `${section}_Land`] : [`${section}_Land`]
}

function ssfKeyClass(action: string): SsfKeyClass {
  if (action === "F38") return "space"
  return /^(F\d+|Z\+)/.test(action) ? "function" : "char"
}

/** `sourceBackground` is the background class the Sogou app itself names for the key (`SSF_BG`). */
export function ssfKeyBinding(layout: string, action: string, landscape: boolean, sourceSection?: string, sourceBackground?: string): SsfKeyBinding {
  const board = ssfBoard(layout)
  const primary = primarySections(board, action)
  const fallback = landscape ? [...primary.flatMap(landscapeVariants), ...primary] : primary
  // The skeleton can name the portrait class even on a landscape board.
  const source = sourceSection ? [...landscape && !/_Land(?:_|$)/.test(sourceSection) ? landscapeVariants(sourceSection) : [], sourceSection] : []
  const sections = source.length ? [...new Set([...source, ...fallback])] : fallback
  const keyClass = sections.includes("Key_0_py9") ? "function" : ssfKeyClass(action)
  const qwerty = isQwerty(board)
  const defaults = keyClass === "space"
    ? qwerty ? ["KeyBg_Space_Qwerty", "KeyBg_Space"] : ["KeyBg_Space"]
    : keyClass === "function"
      ? qwerty ? ["KeyBg_Function_Qwerty", "KeyBg_Function"] : ["KeyBg_Function"]
      : qwerty ? ["KeyBg_Default_Latin", "KeyBg_Default"] : ["KeyBg_Default"]
  return { sections, defaults: sourceBackground ? [...new Set([sourceBackground, ...defaults])] : defaults, keyClass }
}
