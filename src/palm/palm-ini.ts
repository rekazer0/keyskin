import { PALM_INT_MAX } from "./palm-json.ts"

export type IniSection = { name: string; entries: Record<string, string> }

const BOM = "\uFEFF"

export function decodeSkinText(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(BOM, "")
  } catch {
    // Legacy Baidu skins store INI text as GBK.
  }
  try {
    return new TextDecoder("gbk").decode(bytes).replace(BOM, "")
  } catch {
    return undefined
  }
}

// Foundation's `replacingOccurrences(of: " ", with: "")` keeps a space when the next
// scalar extends the grapheme cluster (nonspacing/enclosing marks), so the reader has to
// reproduce that instead of deleting every U+0020.
const GRAPHEME_EXTEND = /\p{Grapheme_Extend}/u

export function stripSpaces(text: string): string {
  const scalars = Array.from(text)
  let result = ""
  for (let index = 0; index < scalars.length; index += 1) {
    if (scalars[index] !== " ") {
      result += scalars[index]
      continue
    }
    const next = scalars[index + 1]
    if (next !== undefined && GRAPHEME_EXTEND.test(next)) result += " "
  }
  return result
}

// Mirrors the converter's INIParser: trimmed lines, first bracket pair as the section
// name, and spaces stripped from values.
export function parseIniSections(text: string): IniSection[] {
  const sections: IniSection[] = []
  let current: IniSection | undefined
  for (const raw of text.split(/\r\n|\n|\r/)) {
    const line = raw.trim()
    const close = line.indexOf("]")
    if (line.startsWith("[") && close > 0) {
      if (current) sections.push(current)
      current = { name: line.slice(1, close), entries: {} }
      continue
    }
    const separator = line.indexOf("=")
    if (separator >= 0 && current) {
      const key = line.slice(0, separator).trim()
      current.entries[key] = stripSpaces(line.slice(separator + 1))
    }
  }
  if (current) sections.push(current)
  return sections
}

// Swift rejects "inf" in `Int(_:)`; only `toInt()` maps it to `Int.max`.
function parseIntStrict(text: string): number | undefined {
  return /^[+-]?\d+$/.test(text) ? Number(text) : undefined
}

export function toInt(text: string | undefined): number | undefined {
  if (text === undefined) return undefined
  if (text.toLowerCase() === "inf") return PALM_INT_MAX
  return parseIntStrict(text)
}

export function toLastInt(text: string | undefined): number | undefined {
  if (text === undefined) return undefined
  const parts = text.split(",")
  return parseIntStrict(parts[parts.length - 1])
}

export function toDouble(text: string | undefined): number | undefined {
  if (text === undefined) return undefined
  if (text.toLowerCase() === "inf") return Infinity
  if (text === "") return undefined
  const value = Number(text)
  return Number.isFinite(value) ? value : undefined
}

export function toBool(text: string | undefined): boolean | undefined {
  if (text === undefined) return undefined
  if (text === "1") return true
  if (text === "0") return false
  if (text.toLowerCase() === "true") return true
  if (text.toLowerCase() === "false") return false
  return undefined
}

export function toIntArray(text: string | undefined): number[] {
  if (text === undefined) return []
  return text.split(",").flatMap((part) => {
    const value = parseIntStrict(part)
    return value === undefined ? [] : [value]
  })
}

export function toDoubleArray(text: string | undefined): number[] {
  if (text === undefined) return []
  return text.split(",").flatMap((part) => {
    const value = toDouble(part.trim())
    return value === undefined ? [] : [value]
  })
}

export function toPoint(text: string | undefined): [number, number] | undefined {
  if (text === undefined) return undefined
  const parts = text.split(",")
  if (parts.length !== 2) return undefined
  const x = toDouble(parts[0])
  const y = toDouble(parts[1])
  return x === undefined || y === undefined ? undefined : [x, y]
}

export function toRect(
  text: string | undefined,
): [[number, number], [number, number]] | undefined {
  if (text === undefined) return undefined
  const parts = text.split(",")
  if (parts.length !== 4) return undefined
  const values = parts.map((part) => toDouble(part))
  if (values.some((value) => value === undefined)) return undefined
  const [x, y, width, height] = values as [number, number, number, number]
  return [[x, y], [width, height]]
}

export type PalmInsets = { top: number; left: number; bottom: number; right: number }

export function toInsets(text: string | undefined): PalmInsets | undefined {
  if (text === undefined) return undefined
  const parts = text.split(",")
  if (parts.length !== 4) return undefined
  const values = parts.map((part) => toDouble(part))
  if (values.some((value) => value === undefined)) return undefined
  const [left, top, right, bottom] = values as [number, number, number, number]
  return { top, left, bottom, right }
}

// Swift's `Array(String)` splits by extended grapheme cluster, not by code point.
const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter("en", { granularity: "grapheme" })
    : undefined

export function toCharacters(text: string | undefined): string[] {
  if (text === undefined) return []
  if (!segmenter) return [...text]
  return [...segmenter.segment(text)].map((entry) => entry.segment)
}

export const ACTION_CODES: Record<string, string> = {
  F1: "symbolBoard",
  F3: "toggleThumbKeyboard",
  F4: "back",
  F5: "softKeyboard",
  F6: "numberBoard",
  F7: "emojiBoard",
  F8: "hideBoard",
  F9: "moreCandidates",
  F10: "shift",
  F11: "capslock",
  F12: "webBoard",
  F13: "changeSkin",
  F14: "switchContainer",
  F15: "switchToChinese",
  F16: "switchToEnglish",
  F17: "dialerBoard",
  F21: "menu",
  F22: "candidatesPageUp",
  F23: "candidatesPageDown",
  F24: "inputMethodMenu",
  F25: "toggleLettersSuggestions",
  F26: "candidatesToggle",
  F27: "lockSymbolBoard",
  F28: "sortEnglish",
  F29: "candidatesBarPageUp",
  F30: "candidatesBarPageDown",
  F31: "logoMenu",
  F32: "showPreparedList",
  F36: "backspace",
  F37: "delete",
  F38: "space",
  F39: "enter",
  F40: "clearInput",
  F41: "tab",
  F42: "home",
  F43: "end",
  F44: "cut",
  F45: "copy",
  F46: "paste",
  F47: "selectAll",
  F48: "clearAll",
  F49: "cursorUp",
  F50: "cursorDown",
  F51: "cursorLeft",
  F52: "cursorRight",
  F53: "handwritingArea",
  F54: "endSuggestion",
  F55: "candidateInArea",
  F56: "maskKey",
  F61: "startSelectionMode",
  F62: "switchInputMethod",
  F63: "inputMethodSelectionMenu",
  F64: "clickCloseOrOk",
  F65: "win",
  F66: "restore",
  F67: "undo",
  F68: "app1",
  F69: "app2",
  F70: "app3",
  F71: "enableEmoji",
  F72: "startVoice",
  F73: "startMedia",
  F74: "startEmoticonBoard",
  F75: "newLine",
  F76: "startClipboardBoard",
  F77: "lazyPhrase",
  F78: "handwritingModeArea",
  F79: "voiceControlButton",
  F80: "voiceDrawingArea",
  F81: "cangjieToggle",
  F82: "searchCard",
  F83: "quickEdit",
  F84: "inputMethodOverlay",
  F85: "simplePanelLanguageSwitch",
  F86: "gameKeyboardNormal",
  F87: "gameKeyboardHarmony",
  F88: "gameKeyboardContent",
  F89: "quickSymbolInput",
  F90: "togglePanelSymbolBoard",
  F91: "toggleSymbolBoardScreens",
  F92: "closeSuggestion",
  F93: "longPressSymbol",
  F94: "intlInputSpaceLeftSwipe",
  F95: "intlInputSpaceRightSwipe",
  F96: "floatingKeyboard",
  F97: "notificationCenter",
  F99: "quickEditAgain",
  F200: "handWritingAppSetting",
}

export function actionCode(text: string | undefined): string | undefined {
  if (text === undefined) return undefined
  return ACTION_CODES[text]
}

export function toRectFromCorners(
  text: string | undefined,
): [[number, number], [number, number]] | undefined {
  if (text === undefined) return undefined
  const parts = text.split(",")
  if (parts.length !== 4) return undefined
  const values = parts.map((part) => toDouble(part.trim()))
  if (values.some((value) => value === undefined)) return undefined
  const [x1, y1, x2, y2] = values as [number, number, number, number]
  return [[x1, y1], [x2 - x1, y2 - y1]]
}

// PLAY_SPEED_RATE only applies when it holds exactly three strictly positive rates.
export function toPlaySpeedRates(text: string | undefined): number[] | undefined {
  if (text === undefined) return undefined
  const rates = text
    .split(",")
    .flatMap((part) => {
      const value = toDouble(part.trim())
      return value === undefined ? [] : [value]
    })
  return rates.length === 3 && rates.every((rate) => rate > 0) ? rates : undefined
}

// `SkinState` only accepts these raw values; `state<S>n` also drops the "S" prefix.
const SKIN_STATES = new Set<number>([
  ...Array.from({ length: 48 }, (_, index) => index),
  ...Array.from({ length: 7 }, (_, index) => 50 + index),
  ...Array.from({ length: 17 }, (_, index) => 200 + index),
])

function skinStateFrom(text: string): number | undefined {
  const raw = toInt(text.replace(/S/g, ""))
  return raw !== undefined && SKIN_STATES.has(raw) ? raw : undefined
}

// `STAT_STYLE` is a `state<tips>` list joined by "|"; the map is emitted as a flat
// `[state, tips, ...]` array because `SkinState` keys are not JSON object keys.
export function toTipsMap(text: string | undefined): Array<number | string> | undefined {
  if (text === undefined) return undefined
  const entries: Array<[number, number]> = []
  for (const item of text.split("|")) {
    const parts = item.split("_")
    if (parts.length !== 2) continue
    const state = skinStateFrom(parts[0])
    const tips = toInt(parts[1])
    if (state === undefined || tips === undefined) continue
    entries.push([state, tips])
  }
  entries.sort((a, b) => a[0] - b[0])
  return entries.flatMap(([state, tips]) => [state, tips])
}
