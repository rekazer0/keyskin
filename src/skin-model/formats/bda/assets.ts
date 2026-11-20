// BDA 的文本资源：`Info.txt` 与 `.til` 图集。
//
// 两者都是 `[段]` + `Key=Value`，但 `.til` 允许段名与键值写在同一行（`[IMG1] SOURCE_RECT=0,0,88,88`），
// 通用 INI 解析会把整行当段名，因此这里单独按行拆。
import type { Atlas, AtlasSlice } from "@/skin-model/atlas.ts"
import type { SkinDocuments } from "@/skin-model/pipeline.ts"
import { pathsOfRole } from "@/skin-model/formats/bda/pipeline.ts"
import type { Box } from "@/skin-model/types.ts"

/** `Info.txt` 的键值；顺序保留，写回时按原顺序输出。 */
type BdaInfo = { path?: string; values: Map<string, string> }

/** 读 `Info.txt`：包根的那份是皮肤名，主题目录下的是子皮肤名，取根优先。 */
export function infoOf(documents: SkinDocuments): BdaInfo {
  const paths = pathsOfRole(documents, "info")
  const path = paths.find((item) => !item.includes("/")) ?? paths[0]
  const document = path ? documents.texts.get(path) : undefined
  const values = new Map<string, string>()
  for (const entry of document?.entries("") ?? []) values.set(entry.key, entry.value)
  return { ...(path ? { path } : {}), values }
}

/** 键值 → `Info.txt`；BDA 的这份文件用 CRLF。 */
export function infoText(values: ReadonlyMap<string, string>): string {
  return [...values].map(([key, value]) => `${key}=${value}`).join("\r\n") + "\r\n"
}

/** `.til` 的一行段头；返回段名与同一行剩下的键值。 */
function sectionLine(line: string): { name: string; rest: string } | undefined {
  const match = /^\s*\[([^\]]+)]\s*(.*)$/.exec(line)
  return match ? { name: match[1], rest: match[2] } : undefined
}

/** `.til` 文本 → 段名到键值的表。 */
function tilSections(text: string): Map<string, Map<string, string>> {
  const sections = new Map<string, Map<string, string>>()
  let current: Map<string, string> | undefined
  for (const raw of text.split(/\r?\n/)) {
    const head = sectionLine(raw)
    if (head) {
      current = new Map()
      sections.set(head.name, current)
      if (!head.rest) continue
      addEntry(current, head.rest)
      continue
    }
    if (current) addEntry(current, raw)
  }
  return sections
}

function addEntry(section: Map<string, string>, line: string): void {
  if (/^\s*[;#]/.test(line)) return
  const match = /^\s*([^=]+?)\s*=\s*(.*)$/.exec(line)
  if (match) section.set(match[1].trim(), match[2].trim())
}

/** `SOURCE_RECT` 的四个数 → 像素矩形。 */
function rectOf(value: string | undefined): Box | undefined {
  const numbers = value?.split(",").map((token) => Number(token.trim())) ?? []
  return numbers.length >= 4 && numbers.every((each) => Number.isFinite(each))
    ? { x: numbers[0], y: numbers[1], width: numbers[2], height: numbers[3] }
    : undefined
}

/** 图集源图：与 `.til` 同名的图片；包里找不到就不编造路径。 */
function sourceOf(paths: readonly string[], tilPath: string): string | undefined {
  const stem = (tilPath.split("/").pop() ?? "").replace(/\.til$/i, "")
  return paths.find((path) => (path.split("/").pop() ?? "").replace(/\.[^.]+$/, "") === stem)
}

type BdaAtlases = {
  atlases: Atlas[]
  /** `.til` 里除切片外的全局键，写回时保留。 */
  globals: Map<string, Map<string, string>>
  /** 图集名 → `.til` 的源路径。 */
  paths: Map<string, string>
}

/** 当前主题 `res/` 下的 `.til` → IR 图集；切片坐标来自 `SOURCE_RECT`，别的主题的图集不进模型。 */
export function atlasesOf(documents: SkinDocuments, resPrefix: string): BdaAtlases {
  const atlases: Atlas[] = []
  const globals = new Map<string, Map<string, string>>()
  const paths = new Map<string, string>()
  const images = pathsOfRole(documents, "image")
  for (const [path, document] of documents.texts) {
    if (!/\.til$/i.test(path) || !path.startsWith(resPrefix)) continue
    const sections = tilSections(document.toString())
    const slices: AtlasSlice[] = [...sections].flatMap(([name, entries]) => {
      if (name.toUpperCase() === "GLOBAL") return []
      const rect = rectOf(entries.get("SOURCE_RECT"))
      return rect ? [{ id: name, rect }] : []
    })
    const name = (path.split("/").pop() ?? path).replace(/\.til$/i, "")
    atlases.push({ name, source: sourceOf(images, path) ?? `${name}.png`, slices })
    globals.set(name, sections.get("GLOBAL") ?? new Map())
    paths.set(name, path)
  }
  return { atlases, globals, paths }
}

/** IR 图集 → `.til` 文本；全局键按原顺序写回，`TILE_NUM` 保留原值（它不总等于切片数）。 */
export function tilText(atlas: Atlas, global: ReadonlyMap<string, string> | undefined): string {
  const entries = [...(global ?? [])]
  const lines: string[] = ["[GLOBAL]"]
  if (!entries.some(([key]) => key.toUpperCase() === "TILE_NUM")) lines.push(`TILE_NUM=${atlas.slices.length}`)
  for (const [key, value] of entries) lines.push(`${key}=${value}`)
  for (const slice of atlas.slices) {
    lines.push("", `[${slice.id}]`, `SOURCE_RECT=${slice.rect.x},${slice.rect.y},${slice.rect.width},${slice.rect.height}`)
  }
  return `${lines.join("\r\n")}\r\n`
}

/** 图片文件按资源名对齐；优先当前主题的 `res/`。 */
export function imagePathOf(paths: readonly string[], resourceID: string, resPrefix: string): string | undefined {
  const leaf = resourceID.replace(/\.(png|webp)$/i, "")
  const candidates = new Set([leaf, leaf.replace(/_\d+$/, "")])
  const matches = paths.filter((path) => candidates.has((path.split("/").pop() ?? "").replace(/\.(png|webp)$/i, "")))
  return matches.find((path) => path.startsWith(resPrefix)) ?? matches[0]
}
