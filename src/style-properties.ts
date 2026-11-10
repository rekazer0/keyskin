import { IniDocument } from "./ini.ts"

type StylePropertySource = {
  section: string
  value: string
}

function stylePropertySource(
  document: IniDocument,
  foreground: string,
  property: string,
): StylePropertySource | undefined {
  const visited = new Set<string>()
  const tokens = foreground.split(",").map((token) => token.trim()).filter(Boolean)
  for (const token of tokens) {
    const value = Number(token)
    const candidates = [`STYLE${token}`]
    if (Number.isFinite(value)) candidates.push(`STYLE${Math.floor(value / 100)}`)
    for (const section of candidates) {
      if (!document.hasSection(section) || visited.has(section)) continue
      visited.add(section)
      const propertyValue = document.get(section, property)
      if (propertyValue !== undefined) return { section, value: propertyValue }
    }
  }
}

export function resolveStylePropertyLayers(
  document: IniDocument,
  foreground: string,
  property: string,
): StylePropertySource[] {
  return foreground.split(",").map((token) => token.trim()).filter(Boolean).flatMap((token) =>
    stylePropertySource(document, token, property) ?? []
  )
}

/**
 * The text styles a FORE_STYLE draws: each layer's `STYLE<n>`, else `STYLE<⌊n/100⌋>`, skipping image
 * layers (NM_IMG / HL_IMG). New text properties are written here when no layer has them yet.
 */
export function textStyleSections(document: IniDocument, foreground: string): string[] {
  const found = new Set<string>()
  for (const token of foreground.split(",").map((part) => part.trim()).filter(Boolean)) {
    const value = Number(token)
    const section = [`STYLE${token}`, ...Number.isFinite(value) ? [`STYLE${Math.floor(value / 100)}`] : []]
      .find((name) => document.hasSection(name))
    if (section && document.get(section, "NM_IMG") === undefined && document.get(section, "HL_IMG") === undefined) found.add(section)
  }
  return [...found]
}

/** A text a style property is edited for: its FORE_STYLE, and where to point a new text style if it has none. */
export type TextStyleRef = {
  foreground: string
  /** The INI value naming this text's style; a new style id is written (or appended) there. */
  owner?: { path: string; section: string; key: string; append?: boolean }
  /** A foreground whose text properties a new style starts from (FIRST_FORE inherits FORE_STYLE). */
  copyFrom?: string
}

/** What this text shows for `property`, read the way the preview does (STYLE<n>, then STYLE<n/100>). */
export function textStyleValue(document: IniDocument, ref: TextStyleRef, property: string): string {
  return stylePropertySource(document, ref.foreground, property)?.value.trim() ?? ""
}

/** The smallest unused id whose STYLE<id/100> fallback is also unused, so a new style inherits nothing. */
export function freeStyleId(document: IniDocument): number {
  const sections = new Set(document.sections())
  const ids = document.sections().flatMap((section) => /^STYLE(\d+)$/.exec(section) ? [Number(section.slice(5))] : [])
  for (let id = Math.max(0, ...ids) + 1; ; id += 1) {
    if (!sections.has(`STYLE${id}`) && !sections.has(`STYLE${Math.floor(id / 100)}`)) return id
  }
}

/**
 * Sets `property` for every ref in `styles`: in the layer that already has it, else the first text
 * layer, else one new style shared by every ref without text. Returns the owner values that must now
 * name that new style (written by the caller, since they live in layout / .cnd / gen.ini files).
 */
export function writeTextStyleProperty(
  styles: IniDocument,
  refs: readonly TextStyleRef[],
  property: string,
  value: string,
): Array<{ path: string; section: string; key: string; value: string }> {
  // One new style per starting point: bare texts share it, a FIRST_FORE copies FORE_STYLE first.
  const created = new Map<string, string>()
  const owners: Array<{ path: string; section: string; key: string; value: string }> = []
  for (const ref of refs) {
    let section = stylePropertySource(styles, ref.foreground, property)?.section ?? textStyleSections(styles, ref.foreground)[0]
    if (!section) {
      if (!ref.owner || !value) continue
      const from = ref.copyFrom ?? ""
      if (!created.has(from)) {
        const id = String(freeStyleId(styles))
        created.set(from, id)
        styles.appendSection(`STYLE${id}`, ["FONT_SIZE", "NM_COLOR", "HL_COLOR", "FONT_NAME"].flatMap((key) => {
          const inherited = from ? stylePropertySource(styles, from, key)?.value : undefined
          return inherited === undefined ? [] : [{ key, value: inherited.trim() }]
        }))
      }
      const id = created.get(from)!
      section = `STYLE${id}`
      const tokens = ref.owner.append ? ref.foreground.split(",").map((token) => token.trim()).filter(Boolean) : []
      const { path, section: ownerSection, key } = ref.owner
      owners.push({ path, section: ownerSection, key, value: [...tokens, id].join(",") })
    }
    if (value) styles.set(section, property, value)
    else styles.remove(section, property)
  }
  return owners
}
