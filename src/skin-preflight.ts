import { decodeBdaAppearance, fields } from "./bda-decode.ts"
import { IniDocument } from "./ini.ts"
import { parseSkinJson, SXI_SKIN_PATH } from "./palm/sxi-json.ts"
import type { SkinArchive } from "./skin.ts"
import { decodeSsfText } from "./ssf/ssf-package.ts"
import { pngSize } from "./ssf/ssf-png.ts"
import { tileSlices } from "./tiles.ts"

type Issue = { location: string; message: string; fixable: boolean }
type Report = { issues: Issue[]; changes: Array<{ path: string; before: string; after: string }> }

const utf8 = new TextDecoder("utf-8", { fatal: true })
const sectionLine = /^\s*\[([^\[\]]+)]\s*(?:(?:[;#]|\/\/).*)?$/
const entryLine = /^\s*([^=]+?)\s*=/

function checkIni(text: string, legacy: boolean, path: string, canWrite: boolean, add: (message: string, fixable?: boolean, line?: number) => void): string {
  const lines = text.split(/(\r\n|\n|\r)/)
  const delimiters: number[] = []
  const seen = new Set<string>()
  let section = ""
  let ambiguous = false
  let unknown = false
  for (let i = 0; i < lines.length; i += 2) {
    const raw = lines[i]
    if (!raw.trim() || /^\s*(?:[;#]|\/\/)/.test(raw)) continue
    const line = raw.replace(/^(\s*)［([\w. -]+)］(\s*(?:(?:[;#]|\/\/).*)?)$/, "$1[$2]$3")
      .replace(/^(\s*[\w.-]+\s*)＝/, "$1=")
    if (line !== raw) delimiters.push(i)
    const header = sectionLine.exec(line)?.[1]
    const key = entryLine.exec(line)?.[1].trim()
    let id: string
    if (header?.trim()) {
      section = header
      id = section
    } else if (key && !line.trimStart().startsWith("[")) {
      id = `${section}\0${key}`
    } else {
      add("INI 语法：应为 [段名] 或 键=值", false, i / 2 + 1)
      unknown = true
      continue
    }
    if (seen.has(id)) ambiguous = true
    seen.add(id)
    if (line !== raw) lines[i] = line
  }
  for (const index of delimiters) add("INI 语法：使用了全角段括号或等号", canWrite && !ambiguous, index / 2 + 1)
  const normalized = canWrite && !ambiguous ? lines.join("") : text
  if (!legacy || unknown || (delimiters.length && normalized === text)) return normalized

  const document = IniDocument.parse(normalized)
  const tile = /\.til$/i.test(path)
  const [group, key, prefix] = tile ? ["GLOBAL", "TILE_NUM", "IMG"] : ["PANEL", "KEY_NUM", "KEY"]
  const numbered = tile ? /^IMG\d+$/ : /^KEY\d+$/
  const sections = document.sections().filter(name => numbered.test(name))
  if (tile) {
    const valid = new Set(tileSlices(document).filter(({ source }) => source[2] > 0 && source[3] > 0).map(slice => slice.index))
    for (const name of sections) if (!valid.has(Number(name.slice(3)))) add(`配置：${name} 的 SOURCE_RECT 无效`)
  }
  const declared = document.get(group, key)
  const count = declared?.trim()
  if (!sections.length || sections.includes(`${prefix}0`) || (!tile && count === undefined)) return normalized
  const contiguous = sections.every((_, i) => document.hasSection(`${prefix}${i + 1}`))
  if (!contiguous) {
    if (count !== undefined && sections.some(name => Number(name.slice(3)) > Number(count))) add(`配置：${key} 未覆盖现有编号，需手动核对`)
    return normalized
  }
  if (count && /^\d+$/.test(count) && Number(count) === sections.length) return normalized
  const fixable = canWrite && !ambiguous && document.hasSection(group) && (!count || /^\d+$/.test(count))
  add(`配置：[${group}] ${key} 应为 ${sections.length}`, fixable)
  if (!fixable) return normalized
  document.set(group, key, `${sections.length}${declared?.match(/\s*$/)?.[0] ?? ""}`)
  return document.toString()
}

/** 检查当前项目，不修改文件，也不把转换后的文件视为已验证。 */
export function inspectSkin(archive: SkinArchive): Report {
  const issues: Issue[] = []
  const changes: Report["changes"] = []
  const names = archive.names()
  const format = archive.format
  const legacy = format === "bdi" || format === "bds"
  const requireFile = (path: string, exists: boolean) => {
    if (!exists) issues.push({ location: path, message: "源文件：缺少必要文件", fixable: false })
  }
  if (legacy) requireFile("Info.txt", names.some(path => /(^|\/)Info\.txt$/.test(path)))
  if (format === "sxi") requireFile(SXI_SKIN_PATH, names.includes(SXI_SKIN_PATH))
  if (format === "ssf") {
    requireFile("phoneTheme.ini", names.includes("phoneTheme.ini"))
    requireFile("phoneSkin.ini", names.some(path => /^\d+\/(?:[^/]+\/)?phoneSkin\.ini$/.test(path)))
  }
  if (format === "bda") requireFile("appearanceConfig", names.some(path => archive.isBdaConfig(path) && /\/\d*appearanceConfig$/.test(path)))

  for (const path of names) {
    const bytes = archive.getBytes(path)!
    const add = (message: string, fixable = false, line?: number) => {
      issues.push({ location: line === undefined ? path : `${path}:${line}`, message, fixable })
    }
    if (/\.png$/i.test(path)) {
      const size = pngSize(bytes)
      if (bytes.length < 33 || !size?.every(Boolean) || String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") add("源文件：PNG 文件头或尺寸无效")
    } else if (archive.isBdaConfig(path)) {
      try {
        if (/appearanceConfig$/.test(path)) decodeBdaAppearance(bytes)
        else fields(bytes)
      } catch {
        add("配置：BDA 二进制配置无法解析")
      }
    } else if (format === "sxi" && /\.json$/i.test(path)) {
      try {
        const text = utf8.decode(bytes)
        if (path === SXI_SKIN_PATH) parseSkinJson(text)
        else JSON.parse(text)
      } catch {
        add("JSON 语法、编码或顶层结构无效")
      }
    } else if ((legacy || format === "ssf") && /\.(ini|til|cnd|pop|css)$|(?:^|\/)Info\.txt$/i.test(path)) {
      let before: string
      let canWrite = true
      try { before = utf8.decode(bytes) }
      catch {
        // Preserve legacy encodings rather than silently rewriting the file as UTF-8.
        before = decodeSsfText(bytes)
        canWrite = false
      }
      if (before.includes("\0") || (!canWrite && before.includes("\uFFFD"))) {
        add("源文件：文本编码无效")
        continue
      }
      const after = checkIni(before, legacy, path, canWrite, add)
      if (before !== after) changes.push({ path, before, after })
    }
  }
  return { issues, changes }
}
