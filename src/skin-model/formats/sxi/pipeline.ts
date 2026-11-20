// 手心皮肤的识别与解析阶段。
//
// 手心包是一组文件：`skin.json`（外观主体，含 `default`/`night` 两套主题）、`info.json`、
// 根目录的 `.layout` 规则文件、`switchConfig.json`，以及各主题目录下的图片与音效。
// 识别回答每个文件是什么；解析把 JSON 与 `.layout` 变成结构、其余字节原样保留。
import type { JsonObject } from "@/palm/sxi-ini.ts"
import { parseSkinJson, SXI_INFO_PATH, SXI_SKIN_PATH } from "@/palm/sxi-json.ts"
import type { FileRole, SkinDocuments, SkinPackage, SkinStructure } from "@/skin-model/pipeline.ts"
import type { Orientation, Theme } from "@/skin-model/types.ts"

/** `skin.json` 的主题键；主题身份与目录名不同（手心用 default/night）。 */
export type SxiThemeKey = "default" | "night"

export const SXI_THEME_KEYS: readonly SxiThemeKey[] = ["default", "night"]

export function themeOfKey(key: SxiThemeKey): Theme {
  return key === "night" ? "dark" : "light"
}

function roleOf(path: string): FileRole {
  const lower = path.toLowerCase()
  if (lower === "skin.json" || lower.endsWith("/skin.json")) return { kind: "panel-config" }
  if (lower === "info.json" || lower.endsWith("/info.json")) return { kind: "info" }
  // `.layout` 是规则层，不是几何；方向与板型都由规则自身决定，这里只标出它是布局文件。
  if (lower.endsWith(".layout")) return { kind: "layout", board: "other", theme: "light", orientation: "port" }
  if (lower.endsWith("switchconfig.json")) return { kind: "panel-config" }
  if (/\.(?:png|webp|jpe?g)$/.test(lower)) return { kind: "image" }
  if (/\.(?:mp3|ogg|wav|m4a|aiff)$/.test(lower)) return { kind: "audio" }
  if (/\.(?:ttf|otf|ttc)$/.test(lower)) return { kind: "font" }
  // `.ini.bak` 是制作遗留，手心自己的导出不会生成它，不进解析路径。
  if (lower.endsWith(".bak")) return { kind: "unknown", reason: `制作遗留文件：${path}` }
  return { kind: "unknown", reason: `手心包里没有这种文件的位置：${path}` }
}

/** 主题从 `skin.json` 的顶层键判断；只读顶层，不猜目录。 */
function themesOf(pkg: SkinPackage): Theme[] {
  const bytes = pkg.files.get(SXI_SKIN_PATH)
  if (!bytes) return ["light"]
  try {
    const skin = parseSkinJson(new TextDecoder().decode(bytes))
    const themes = SXI_THEME_KEYS.filter((key) => skin[key] !== undefined).map(themeOfKey)
    return themes.length ? themes : ["light"]
  } catch {
    return ["light"]
  }
}

export function identifySxi(pkg: SkinPackage): SkinStructure {
  const roles = new Map<string, FileRole>()
  // zip 的目录条目不是文件；它们没有角色，也不该进解析产物。
  for (const path of pkg.files.keys()) if (!path.endsWith("/")) roles.set(path, roleOf(path))
  const orientations: Orientation[] = ["port", "land"]
  return { roles, themes: themesOf(pkg), orientations }
}

function isJsonPath(path: string): boolean {
  const lower = path.toLowerCase()
  return lower.endsWith(".json") || lower.endsWith(".layout")
}

/** 解析：JSON 与 `.layout` 走结构化解析，图片、音效与字体保留字节。 */
export function parseSxi(pkg: SkinPackage, structure: SkinStructure): SkinDocuments {
  const structs = new Map<string, unknown>()
  const binaries = new Map<string, Uint8Array>()
  const decoder = new TextDecoder()
  for (const path of structure.roles.keys()) {
    const data = pkg.files.get(path)
    if (!data) throw new Error(`识别出角色但包里没有文件：${path}`)
    if (isJsonPath(path)) structs.set(path, parseSkinJson(decoder.decode(data)))
    else binaries.set(path, data)
  }
  return { roles: structure.roles, texts: new Map(), structs, binaries }
}

/** 按角色取 JSON；转换阶段用它，不直接碰原始字节。 */
export function jsonOf(documents: SkinDocuments, path: string): JsonObject | undefined {
  const value = documents.structs.get(path)
  // 存进去的就是 parseSkinJson 的产物，这里只是把 unknown 收窄回对象。
  return value === undefined ? undefined : value as JsonObject
}

export { SXI_INFO_PATH, SXI_SKIN_PATH }
