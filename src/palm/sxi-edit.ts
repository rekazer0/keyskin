// Where parts of a Palm skin.json are written in its text, so the source editor can mark and reveal
// the selection: a part by its pointer, a board's keys, state keys and list by their canvas sections.

import { jsonPropertyRanges } from "../highlight.ts"

/** Where the part at `pointer` (object keys from the root) is written in skin.json's text. */
export function sxiFragmentRange(text: string, pointer: readonly string[]): readonly [number, number] | undefined {
  let range: readonly [number, number] = [0, text.length]
  for (const part of pointer) {
    const inner = jsonPropertyRanges(text.slice(range[0], range[1]), [part])[0]
    if (!inner) return
    range = [range[0] + inner[0], range[0] + inner[1]]
  }
  return range
}

// Locate whole key objects, respecting nested braces and escaped strings in JSON.
export function sxiSectionRanges(text: string, sections: readonly string[], pointer: readonly string[] = []): Array<readonly [number, number]> {
  if (pointer.length) {
    const range = sxiFragmentRange(text, pointer)
    if (!range) return []
    return sxiSectionRanges(text.slice(range[0], range[1]), sections).map(([start, end]) => [start + range[0], end + range[0]] as const)
  }
  const keys = jsonPropertyRanges(text, ["keys"])[0]
  const ranges: Array<readonly [number, number]> = []
  if (keys) {
    let depth = 0, start = 0, quoted = false, escaped = false
    for (let index = text.indexOf("[", keys[0]); index < keys[1]; index += 1) {
      const char = text[index]
      if (quoted) {
        if (escaped) escaped = false
        else if (char === "\\") escaped = true
        else if (char === '"') quoted = false
      } else if (char === '"') quoted = true
      else if (char === "{") { if (depth++ === 0) start = index }
      else if (char === "}" && --depth === 0) {
        try {
          const key = JSON.parse(text.slice(start, index + 1))
          if (sections.includes(`KEY${key.id}`)) ranges.push([start, index + 1])
        } catch { /* Source may be incomplete while typing. */ }
      }
    }
  }
  const names = { PANEL: "board", LIST: "list" } as Record<string, string>
  for (const section of sections) {
    if (names[section]) ranges.push(...jsonPropertyRanges(text, [names[section]]))
    const tip = /^TIP(.+)$/.exec(section)
    const fixes = tip && jsonPropertyRanges(text, ["key_fix"])[0]
    if (tip && fixes) ranges.push(...jsonPropertyRanges(text.slice(fixes[0], fixes[1]), [tip[1]]).map(([a, b]) => [a + fixes[0], b + fixes[0]] as const))
  }
  return ranges
}
