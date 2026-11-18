// 皮肤内嵌字体的纯路径 / 命名逻辑：真机按 CSS 所在 res 目录解析 FONT_PATH（工具书 V6 p163），
// 这里统一算出归档内路径与相对的 FONT_PATH，供编辑器与预览共用（不依赖 DOM，可单独测试）。
import { IniDocument } from "./ini.ts"

const FONT_FILE_EXTENSIONS = ["ttf", "otf", "ttc"] as const

const FONT_FILE_PATTERN = /\.(?:ttf|otf|ttc)$/i

export function isFontFile(path: string): boolean {
  return FONT_FILE_PATTERN.test(path)
}

/** 归档里所有字体文件（按路径排序）。 */
export function skinFontFiles(names: readonly string[]): string[] {
  return names.filter(isFontFile).sort((a, b) => a.localeCompare(b))
}

/** 皮肤里所有可写 GLOBAL FONT_PATH 的样式表：每个主题的 port/land 或单布局一份。 */
export function skinStylePaths(names: readonly string[]): string[] {
  const themeOrder = (path: string) => ["light", "dark"].indexOf(path.split("/")[0])
  return names
    .filter((path) => /^(?:light|dark)\/skin\/(?:(?:port|land)\/)?res\/default\.css$/i.test(path))
    .sort((a, b) => themeOrder(a) - themeOrder(b) || a.localeCompare(b))
}

/** 路径所属主题（light / dark）；其他路径返回第一段。 */
export function themeOfPath(path: string): string {
  return path.split("/")[0] ?? ""
}

/** 引用相对 baseDirectory 的路径解析成归档路径；允许 `..`，但不许越出归档根目录。 */
export function normalizeArchivePath(baseDirectory: string, reference: string): string | undefined {
  const clean = reference
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replaceAll("\\", "/")
  if (!clean || clean.startsWith("/") || /^[A-Za-z]:/.test(clean) || clean.includes("\0")) return
  const parts = baseDirectory.split("/").filter(Boolean)
  for (const segment of clean.split("/")) {
    if (!segment || segment === ".") continue
    if (segment === "..") {
      if (!parts.length) return
      parts.pop()
      continue
    }
    parts.push(segment)
  }
  return parts.length ? parts.join("/") : undefined
}

/** FONT_NAME 可能是 `benxu`、`DROIDSANSFALLBACK.ttf` 或系统字体名；前两种都要能落到文件上。 */
export function fontNameCandidates(reference: string): string[] {
  const clean = reference.trim().replace(/^['"]|['"]$/g, "").replaceAll("\\", "/")
  if (!clean) return []
  return FONT_FILE_PATTERN.test(clean) ? [clean] : [clean, ...FONT_FILE_EXTENSIONS.map((extension) => `${clean}.${extension}`)]
}

/** 字体引用的搜索目录：CSS 所在目录 → 皮肤 res → 皮肤根 → 主题 res。 */
export function fontSearchDirectories(stylePath: string): string[] {
  const directory = stylePath.slice(0, stylePath.lastIndexOf("/"))
  const skinRoot = stylePath.match(/^(.*\/skin)\//)?.[1]
  return [...new Set([
    directory,
    skinRoot && `${skinRoot}/res`,
    skinRoot,
    `${themeOfPath(stylePath)}/skin/res`,
  ].filter((value): value is string => Boolean(value)))]
}

/** 把引用解析成归档里真实存在的字体路径（大小写不敏感，可补 .ttf/.otf/.ttc）。 */
export function resolveFontReference(
  names: readonly string[],
  reference: string,
  baseDirectories: readonly string[],
  options: { extensions?: boolean } = {},
): string | undefined {
  if (!reference.trim()) return
  const candidates = options.extensions ? fontNameCandidates(reference) : [reference.trim().replace(/^['"]|['"]$/g, "")]
  const byLowercase = new Map(names.map((name) => [name.toLowerCase(), name]))
  for (const candidate of candidates) {
    for (const directory of baseDirectories) {
      const path = normalizeArchivePath(directory, candidate)
      const found = path && byLowercase.get(path.toLowerCase())
      if (found) return found
    }
  }
}

/** 从 fromFile 所在目录指向 toFile 的相对路径（可用 `..`）。 */
export function relativeArchivePath(fromFile: string, toFile: string): string {
  const from = fromFile.split("/").slice(0, -1)
  const to = toFile.split("/")
  let shared = 0
  while (shared < from.length && shared < to.length - 1 && from[shared] === to[shared]) shared++
  return [...from.slice(shared).map(() => ".."), ...to.slice(shared)].join("/")
}

/** 文件名清洗：去掉目录与非法字符，保留字母数字、点、下划线和连字符；扩展名必须是 ttf/otf/ttc。 */
export function sanitizeFontFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop()?.trim().replace(/^['"]|['"]$/g, "") ?? ""
  const match = base.match(/\.(ttf|otf|ttc)$/i)
  if (!match) throw new Error("只支持 .ttf / .otf / .ttc 字体文件")
  let stem = base.slice(0, base.length - match[1].length - 1)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 60)
  if (!stem) stem = "font"
  // 纯数字或纯符号的文件名在设备上不好辨认，加个前缀。
  else if (!/[A-Za-z]/.test(stem)) stem = `font-${stem}`
  return `${stem}.${match[1].toLowerCase()}`
}

/** 在已有归档文件名中找一个不重名的字体文件名。 */
export function uniqueFontFileName(fileName: string, names: readonly string[]): string {
  const taken = new Set(names.map((name) => (name.split("/").pop() ?? "").toLowerCase()))
  if (!taken.has(fileName.toLowerCase())) return fileName
  const dot = fileName.lastIndexOf(".")
  const stem = fileName.slice(0, dot)
  const extension = fileName.slice(dot)
  for (let index = 2; index < 1000; index++) {
    const candidate = `${stem}-${index}${extension}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
  throw new Error("没有可用的字体文件名")
}

/**
 * 写入 / 清除 [GLOBAL] FONT_PATH；没有 [GLOBAL] 节时在文件头补一节。
 * 返回 undefined 表示文本无需改动。
 */
export function withGlobalFontPath(text: string, value: string): string | undefined {
  const document = IniDocument.parse(text)
  if (!value) return document.remove("GLOBAL", "FONT_PATH") ? document.toString() : undefined
  if (document.set("GLOBAL", "FONT_PATH", value)) return document.toString()
  if (document.sections().includes("GLOBAL")) return undefined
  const eol = text.includes("\r\n") ? "\r\n" : "\n"
  return `[GLOBAL]${eol}FONT_PATH=${value}${eol}${text}`
}

/** 清掉一份 CSS 里指向被删字体的 GLOBAL FONT_PATH、[STYLE*] FONT_PATH 与 FONT_NAME。 */
export function withFontReferencesCleared(
  text: string,
  stylePath: string,
  names: readonly string[],
  removed: ReadonlySet<string>,
  stem: string,
): string | undefined {
  const directories = fontSearchDirectories(stylePath)
  const matches = (reference: string): boolean => {
    const path = resolveFontReference(names, reference, directories, { extensions: true })
    if (path) return removed.has(path)
    // 文件已经不在了：按文件名（不含扩展名）继续清引用，否则设备会一直指向缺失字体。
    const base = reference.trim().split("/").pop()?.replace(/\.(?:ttf|otf|ttc)$/i, "").toLowerCase()
    return Boolean(base) && base === stem
  }
  const document = IniDocument.parse(text)
  let changed = false
  const globalPath = document.get("GLOBAL", "FONT_PATH")
  if (globalPath && matches(globalPath)) changed = document.remove("GLOBAL", "FONT_PATH") || changed
  for (const { section, key, value } of document.entries()) {
    if (!/^STYLE/i.test(section) || key !== "FONT_NAME" && key !== "FONT_PATH") continue
    if (value.trim() && matches(value)) changed = document.remove(section, key) || changed
  }
  return changed ? document.toString() : undefined
}
