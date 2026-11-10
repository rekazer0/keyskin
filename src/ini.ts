type IniEntry = {
  section: string
  key: string
  value: string
}

type Line = {
  raw: string
  ending: string
  section?: string
  key?: string
  prefix?: string
  value?: string
}

function splitLines(source: string): string[] {
  return source.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g)?.filter(Boolean) ?? []
}

// 同一文本在一次交互中会被反复解析；缓存解析结果，返回时深拷贝行对象，保证各文档互不影响。
const parseCache = new Map<string, Line[]>()
const PARSE_CACHE_LIMIT = 64
const cloneLines = (lines: Line[]): Line[] => lines.map((line) => ({ ...line }))
const entryId = (section: string, key: string): string => `${section}\0${key}`

export class IniDocument {
  private lines: Line[]
  // get/set 每次交互调用数千次，按 段+键 建索引代替线性查找；结构变化时置空重建。
  private index?: Map<string, Line>
  // 样式库对每个段调用 entries(section)，几千个段时逐行扫描会变成平方级，按段分组索引行。
  private sectionLines?: Map<string, Line[]>
  private sectionList?: string[]
  // 检查器每次重建都要判断几百次“这个段在不在”（style-properties.ts）；按段建一次集合，
  // 不要每次都从 sections() 复制几千个段名再建 Set。
  private sectionSetCache?: Set<string>

  private constructor(lines: Line[]) {
    this.lines = lines
  }

  private invalidate(): void {
    this.index = undefined
    this.sectionLines = undefined
    this.sectionList = undefined
    this.sectionSetCache = undefined
  }

  private lookup(section: string, key: string): Line | undefined {
    if (!this.index) {
      this.index = new Map()
      for (const line of this.lines) {
        if (line.key === undefined || line.section === undefined) continue
        const id = entryId(line.section, line.key)
        if (!this.index.has(id)) this.index.set(id, line)
      }
    }
    return this.index.get(entryId(section, key))
  }

  static parse(source: string): IniDocument {
    const cached = parseCache.get(source)
    if (cached) return new IniDocument(cloneLines(cached))
    let section = ""
    const lines = splitLines(source).map((raw): Line => {
      const ending = raw.match(/(\r\n|\n|\r)$/)?.[1] ?? ""
      const content = ending ? raw.slice(0, -ending.length) : raw
      const sectionMatch = content.match(/^\s*\[([^\]]+)]\s*$/)
      if (sectionMatch) {
        section = sectionMatch[1]
        return { raw, ending, section }
      }

      if (!/^\s*[;#]/.test(content)) {
        const entry = content.match(/^(\s*([^=]+?)\s*=\s*)(.*)$/)
        if (entry) {
          return {
            raw,
            ending,
            section,
            key: entry[2].trim(),
            prefix: entry[1],
            value: entry[3],
          }
        }
      }
      return { raw, ending }
    })
    if (parseCache.size >= PARSE_CACHE_LIMIT) parseCache.delete(parseCache.keys().next().value!)
    parseCache.set(source, cloneLines(lines))
    return new IniDocument(lines)
  }

  get(section: string, key: string): string | undefined {
    return this.lookup(section, key)?.value
  }

  set(section: string, key: string, value: string): boolean {
    const line = this.lookup(section, key)
    if (line) {
      if (line.value === value) return false
      line.value = value
      line.raw = `${line.prefix}${value}${line.ending}`
      return true
    }

    const sectionIndex =
      section === ""
        ? -1
        : this.lines.findIndex(
            (candidate) => candidate.section === section && candidate.key === undefined,
          )
    if (section !== "" && sectionIndex < 0) return false
    const nextSectionOffset = this.lines
      .slice(sectionIndex + 1)
      .findIndex((candidate) => candidate.section !== undefined && candidate.key === undefined)
    let insertAt =
      nextSectionOffset < 0 ? this.lines.length : sectionIndex + 1 + nextSectionOffset
    // The blank lines that separate this section from the next one stay below the new entry.
    while (insertAt - 1 > sectionIndex && this.lines[insertAt - 1].raw.trim() === "") insertAt--
    const ending = this.lines.find((candidate) => candidate.ending)?.ending ?? "\n"
    const previous = this.lines[insertAt - 1]
    if (previous && previous.ending === "") {
      previous.ending = ending
      previous.raw += ending
    }
    const prefix = `${key}=`
    this.invalidate()
    this.lines.splice(insertAt, 0, {
      raw: `${prefix}${value}${ending}`,
      ending,
      section,
      key,
      prefix,
      value,
    })
    return true
  }

  remove(section: string, key: string): boolean {
    const index = this.lines.findIndex((line) => line.section === section && line.key === key)
    if (index < 0) return false
    this.invalidate()
    this.lines.splice(index, 1)
    return true
  }

  entries(section?: string): IniEntry[] {
    const lines = section === undefined ? this.lines : this.linesOf(section)
    return lines.flatMap((line) => {
      if (!line.key || line.section === undefined || line.value === undefined) return []
      return [{ section: line.section, key: line.key, value: line.value }]
    })
  }

  private linesOf(section: string): Line[] {
    if (!this.sectionLines) {
      this.sectionLines = new Map()
      for (const line of this.lines) {
        if (line.key === undefined || line.section === undefined) continue
        const lines = this.sectionLines.get(line.section)
        if (lines) lines.push(line)
        else this.sectionLines.set(line.section, [line])
      }
    }
    return this.sectionLines.get(section) ?? []
  }

  sections(): string[] {
    this.sectionList ??= [
      ...new Set(
        this.lines
          .filter((line) => line.key === undefined && line.section !== undefined)
          .map((line) => line.section as string),
      ),
    ]
    return [...this.sectionList]
  }

  /** `sections()` 的集合形式：要判断多个段在不在时用它，别每次复制段名数组再建 Set。 */
  sectionSet(): ReadonlySet<string> {
    this.sectionSetCache ??= new Set(this.sections())
    return this.sectionSetCache
  }

  hasSection(section: string): boolean {
    return this.sectionSet().has(section)
  }

  appendSection(section: string, entries: readonly { key: string; value: string }[]): void {
    const ending = this.lines.find((line) => line.ending)?.ending ?? "\n"
    if (this.lines.length && this.lines.at(-1)?.ending === "") {
      const previous = this.lines.at(-1)!
      previous.ending = ending
      previous.raw += ending
    }
    this.lines.push({ raw: `[${section}]${ending}`, ending, section })
    // Writers append thousands of sections between reads, so the index is extended instead of rebuilt.
    if (this.sectionList && !this.sectionList.includes(section)) this.sectionList.push(section)
    this.sectionSetCache?.add(section)
    for (const entry of entries) {
      const line: Line = {
        raw: `${entry.key}=${entry.value}${ending}`,
        ending,
        section,
        key: entry.key,
        prefix: `${entry.key}=`,
        value: entry.value,
      }
      this.lines.push(line)
      // Appended lines come last: they only fill keys no earlier line defines (the first one wins).
      const id = entryId(section, entry.key)
      if (this.index && !this.index.has(id)) this.index.set(id, line)
      if (this.sectionLines) {
        const lines = this.sectionLines.get(section)
        if (lines) lines.push(line)
        else this.sectionLines.set(section, [line])
      }
    }
  }

  removeSections(sections: readonly string[]): boolean {
    const selected = new Set(sections)
    const before = this.lines.length
    this.invalidate()
    let section = ""
    this.lines = this.lines.filter((line) => {
      if (line.section !== undefined && line.key === undefined) section = line.section
      return !selected.has(section)
    })
    return this.lines.length !== before
  }

  /**
   * 把 [PREFIX数字] 段按原序号顺序重排为连续序号（工具书 V6：KEY/IMG 等序号段禁止跳号），
   * 起始序号保持 0 或 1。返回 旧段名→新段名 的映射（仅含改名的段）。
   */
  renumberSections(prefix: string): Map<string, string> {
    const pattern = new RegExp(`^${prefix}(\\d+)$`)
    const numbered = this.sections().flatMap((section) => {
      const match = section.match(pattern)
      return match ? [{ section, index: Number(match[1]) }] : []
    }).sort((a, b) => a.index - b.index)
    const start = Math.min(1, numbered[0]?.index ?? 1)
    const renamed = new Map<string, string>()
    numbered.forEach(({ section }, offset) => {
      const next = `${prefix}${start + offset}`
      if (next !== section) renamed.set(section, next)
    })
    if (!renamed.size) return renamed
    this.invalidate()
    for (const line of this.lines) {
      const next = line.section !== undefined ? renamed.get(line.section) : undefined
      if (!next) continue
      if (line.key === undefined) line.raw = line.raw.replace(`[${line.section}]`, `[${next}]`)
      line.section = next
    }
    return renamed
  }

  toString(): string {
    return this.lines.map((line) => line.raw).join("")
  }
}

// 工具书 V6「皮肤制作规范」：KEY 段按序号连续排列，并回到 [PANEL] 修正 KEY_NUM。
export function normalizeKeySections(document: IniDocument): Map<string, string> {
  const renamed = document.renumberSections("KEY")
  if (document.get("PANEL", "KEY_NUM") !== undefined) {
    document.set("PANEL", "KEY_NUM", String(document.sections().filter((section) => /^KEY\d+$/.test(section)).length))
  }
  return renamed
}
