/** Package formats the editor opens, edits and saves in place. */
export type ExportFormat = "bdi" | "bds" | "bda" | "ssf" | "sxi"

export function canExport(source: ExportFormat, target: ExportFormat): boolean {
  if (source === "sxi" || source === "ssf") return true
  return target !== "bda" || source === "bda"
}

export function exportFormatFromPath(path: string): ExportFormat | undefined {
  const match = path.match(/\.([^.\\/]+)$/)
  const extension = match?.[1].toLowerCase()
  if (extension === "mssf") return "ssf"
  return extension === "bdi" || extension === "bds" || extension === "bda" || extension === "ssf" || extension === "sxi"
    ? extension
    : undefined
}

function exportPath(path: string, format: ExportFormat): string {
  return /\.[^.\\/]+$/.test(path) ? path.replace(/\.[^.\\/]+$/, `.${format}`) : `${path}.${format}`
}

export function exportName(name: string, format: ExportFormat): string {
  return exportPath(name || "未命名皮肤", format).split(/[\\/]/).pop()!
}

/** A skin's declared name as a file name: characters file systems reject become "_". */
export function skinFileName(name: string | undefined, format: ExportFormat): string {
  const safe = (name ?? "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim()
  return `${safe || "未命名皮肤"}.${format}`
}

/** Where a per-item warning occurred: a layout section (`light/skin/port/py_9.ini [KEY5]`) or a numbered animation or style. */
const WARNING_SUBJECT = /^((?:\S+\/\S+\.\w+ )?\[\w+\]|(?:ANIM|STYLE)\d+)( ?)(.+)$/
/** From this many occurrences on, a warning is listed once with its count. */
const WARNING_GROUP = 4

/**
 * The downgrade list a person confirms before a conversion: duplicates removed, and a warning repeated
 * for many keys or animations (a skin can raise thousands) listed once with the first place and the count.
 */
export function summarizeWarnings(warnings: readonly string[]): string[] {
  const unique = [...new Set(warnings)]
  const groups = new Map<string, string[]>()
  const groupOf = (warning: string) => {
    const match = WARNING_SUBJECT.exec(warning)
    return match && `${/^(?:ANIM|STYLE)/.test(match[1]) ? match[1].replace(/\d+$/, "") : "["}\0${match[2]}${match[3]}`
  }
  for (const warning of unique) {
    const group = groupOf(warning)
    if (group) groups.set(group, [...(groups.get(group) ?? []), warning])
  }
  const listed = new Set<string>()
  return unique.flatMap((warning) => {
    const group = groupOf(warning)
    const members = group ? groups.get(group)! : []
    if (!group || members.length < WARNING_GROUP) return [warning]
    if (listed.has(group)) return []
    listed.add(group)
    const [, subject, gap, rest] = WARNING_SUBJECT.exec(warning)!
    return [`${subject} 等 ${members.length} 处${rest.startsWith("的") ? "" : gap}${rest}`]
  })
}
