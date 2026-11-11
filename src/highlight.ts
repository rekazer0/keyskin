export function findTextMatches(source: string, query: string): number[] {
  if (!query) return []
  const text = source.toLocaleLowerCase()
  const needle = query.toLocaleLowerCase()
  const matches: number[] = []
  for (let index = text.indexOf(needle); index >= 0; index = text.indexOf(needle, index + needle.length)) {
    matches.push(index)
  }
  return matches
}

export function replaceTextMatches(source: string, query: string, replacement: string, matchIndex?: number): string {
  const matches = findTextMatches(source, query)
  const targets = matchIndex === undefined ? matches : matches.slice(matchIndex, matchIndex + 1)
  return targets.reduceRight(
    (text, index) => text.slice(0, index) + replacement + text.slice(index + query.length),
    source,
  )
}

export function insertedTextRange(before: string, after: string): readonly [number, number] | undefined {
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1
  let beforeEnd = before.length
  let afterEnd = after.length
  while (beforeEnd > start && afterEnd > start && before[beforeEnd - 1] === after[afterEnd - 1]) {
    beforeEnd -= 1
    afterEnd -= 1
  }
  return afterEnd > start ? [start, afterEnd] : undefined
}

export function jsonPropertyRanges(source: string, properties: readonly string[]): Array<readonly [number, number]> {
  if (!properties.length) return []
  const selected = new Set(properties)
  const ranges: Array<readonly [number, number]> = []
  const property = /^(\s*)("(?:\\.|[^"\\])*")\s*:\s*([\[{])/gm
  for (const match of source.matchAll(property)) {
    if (!selected.has(JSON.parse(match[2]))) continue
    const start = match.index ?? 0
    const bodyStart = start + match[0].length - 1
    const open = match[3]
    const close = open === "{" ? "}" : "]"
    let depth = 0
    let quoted = false
    let escaped = false
    for (let index = bodyStart; index < source.length; index += 1) {
      const character = source[index]
      if (quoted) {
        if (escaped) escaped = false
        else if (character === "\\") escaped = true
        else if (character === '"') quoted = false
        continue
      }
      if (character === '"') quoted = true
      else if (character === open) depth += 1
      else if (character === close && --depth === 0) {
        ranges.push([start, index + 1])
        break
      }
    }
  }
  return ranges
}

export function iniSectionRanges(source: string, sections: readonly string[]): Array<readonly [number, number]> {
  if (!sections.length) return []
  const selected = new Set(sections)
  const headers = [...source.matchAll(/^\s*\[([^\]]+)][^\n]*$/gm)]
  return headers.flatMap((header, index) => selected.has(header[1])
    ? [[header.index ?? 0, headers[index + 1]?.index ?? source.length] as const]
    : [])
}

/**
 * Inverse of {@link iniSectionRanges}: the section whose block contains
 * `offset`. Keyed selection and range highlighting both need this direction so
 * clicking in the source can drive the canvas.
 */
export function iniSectionAtOffset(source: string, offset: number): string | undefined {
  if (!source.length) return undefined
  const position = Math.max(0, Math.min(source.length - 1, Math.trunc(offset)))
  const headers = [...source.matchAll(/^\s*\[([^\]]+)][^\n]*$/gm)]
  let found: string | undefined
  for (const [index, header] of headers.entries()) {
    if ((header.index ?? 0) > position) break
    found = (headers[index + 1]?.index ?? source.length) > position ? header[1] : undefined
  }
  return found
}

/** Top-level JSON property name whose value block contains `offset`. */
export function jsonPropertyAtOffset(source: string, offset: number): string | undefined {
  if (!source.length) return undefined
  const position = Math.max(0, Math.min(source.length - 1, Math.trunc(offset)))
  const property = /^(\s*)("(?:\\.|[^"\\])*")\s*:\s*([\[{])/gm
  const entries = [...source.matchAll(property)]
  let found: string | undefined
  for (const [index, match] of entries.entries()) {
    const start = match.index ?? 0
    if (start > position) break
    const end = entries[index + 1]?.index ?? source.length
    if (end > position) found = JSON.parse(match[2]) as string
  }
  return found
}

