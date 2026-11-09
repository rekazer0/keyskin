import { actionDescription } from "./actions.ts"
import type { SourceEditorValueRange } from "./source-editor.ts"

const SOURCE_VALUE_HINT_LIMIT = 5000

type SourceValueLanguage = "ini" | "json"

export function replacedSourceColor(value: string, rgb: string): string | undefined {
  const clean = value.trim().replace(/^#/, "")
  const nextRgb = rgb.trim().replace(/^#/, "")
  if (!/^[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(clean) || !/^[0-9a-f]{6}$/i.test(nextRgb)) return
  return `${value.trim().startsWith("#") ? "#" : ""}${clean.length === 8 ? clean.slice(0, 2).toUpperCase() : ""}${nextRgb.toUpperCase()}`
}

export function replacedSourceStyle(value: string, styleID: string): string | undefined {
  return /^(?:STYLE)?\d+$/i.test(value) && /^\d+$/.test(styleID)
    ? value.replace(/\d+$/, styleID)
    : undefined
}

function sourceColor(value: string): string | undefined {
  const clean = value.replace(/^#/, "")
  if (!/^[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(clean)) return
  if (clean.length === 6) return `#${clean}`
  const alpha = Number.parseInt(clean.slice(0, 2), 16) / 255
  const red = Number.parseInt(clean.slice(2, 4), 16)
  const green = Number.parseInt(clean.slice(4, 6), 16)
  const blue = Number.parseInt(clean.slice(6, 8), 16)
  return `rgba(${red}, ${green}, ${blue}, ${Number(alpha.toFixed(3))})`
}

// Simplified normalizedKey using stdlib operations
function normalizedKey(key: string): string {
  return key.trim().replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[.-]/g, "_").toUpperCase()
}

function isStyleKey(key: string): boolean {
  const normalized = normalizedKey(key)
  if (normalized === "STAT_STYLE") return false
  return normalized === "STYLE" || normalized === "STYLE_ID" || normalized === "FIRST_BACK" || normalized === "FIRST_FORE" || /(?:^|_)STYLE(?:S|_ID|_INDEX)?$/.test(normalized)
}

function isColorKey(key: string): boolean {
  return /(?:^|_)COLOR$/.test(normalizedKey(key))
}

// Simplified uncommentIniValue
function uncommentIniValue(raw: string): string {
  let end = raw.indexOf(";")
  if (end < 0) end = raw.length
  const hash = raw.indexOf("#")
  if (hash >= 0 && hash < end) {
    const color = raw.slice(hash).match(/^#[0-9a-f]{6}(?:[0-9a-f]{2})?(?=\s|$)/i)
    if (!color) end = hash
  }
  return raw.slice(0, end)
}

export function sourceValueRanges(
  text: string,
  language: SourceValueLanguage,
): SourceEditorValueRange[] {
  const ranges: SourceEditorValueRange[] = []

  const add = (
    value: string,
    from: number,
    to: number,
    forcedKind?: SourceEditorValueRange["kind"],
    key?: string,
  ): void => {
    if (ranges.length >= SOURCE_VALUE_HINT_LIMIT) return
    const normalized = value.trim()
    if (!normalized) return
    const leading = value.length - value.trimStart().length
    const trailing = value.length - value.trimEnd().length
    from += leading
    to -= trailing

    const action = normalized.match(/^(F\d+|S\d+(?:_\d+)?)$/i)
    const color = sourceColor(normalized)
    const legacyStyle = /^(?:STYLE\d+|[123]\d{6})$/i.test(normalized)
    const kind = forcedKind ?? (action ? "action" : color ? "color" : legacyStyle ? "style" : undefined)
    if (!kind) return
    if (kind === "action" && !action) return
    if (kind === "color" && !color) return
    if (kind === "style" && !/^(?:STYLE)?\d+$/i.test(normalized)) return

    ranges.push({
      from,
      to,
      value: normalized,
      kind,
      label: kind === "action"
        ? actionDescription(action![1].toUpperCase())
        : kind === "color" ? `颜色 ${normalized}` : `样式 ${normalized.replace(/^STYLE/i, "")}`,
      color: kind === "color" ? color : undefined,
      key,
    })
  }

  const addStyleTokens = (raw: string, offset: number, key: string): void => {
    for (const match of raw.matchAll(/(?:STYLE)?\d+/gi)) {
      const before = raw.slice(0, match.index).trimEnd()
      const after = raw.slice(match.index! + match[0].length).trimStart()
      if (before && !before.endsWith(",") || after && !after.startsWith(",")) continue
      add(match[0], offset + match.index!, offset + match.index! + match[0].length, "style", key)
    }
  }

  if (language === "ini") {
    for (const match of text.matchAll(/^[ \t]*([^=\r\n]+?)\s*=\s*([^\r\n]*)/gm)) {
      if (ranges.length >= SOURCE_VALUE_HINT_LIMIT) break
      const key = match[1].trim()
      const raw = match[2]
      const offset = match.index! + match[0].length - raw.length
      const value = uncommentIniValue(raw)
      if (isStyleKey(key)) addStyleTokens(value, offset, key)
      else if (isColorKey(key)) add(value, offset, offset + value.length, "color", key)
      else add(value, offset, offset + value.length)
    }
  } else {
    for (const match of text.matchAll(/"([^"\\]+)"\s*:\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)"|(-?\d+(?:\.\d+)?))/g)) {
      if (ranges.length >= SOURCE_VALUE_HINT_LIMIT) break
      const key = match[1]
      const value = match[2] ?? match[3] ?? ""
      const start = match.index! + match[0].lastIndexOf(value)
      if (isStyleKey(key)) add(value, start, start + value.length, "style", key)
      else if (isColorKey(key)) add(value, start, start + value.length, "color", key)
      else add(value, start, start + value.length)
    }
  }
  return ranges
}
