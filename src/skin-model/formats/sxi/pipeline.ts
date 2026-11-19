// 手心皮肤的识别与解析阶段。
//
// 手心的包只是一组文件：skin.json、info.json、图片、音效、字体。
// 识别回答每个文件是什么，解析把 JSON 变成结构、把图片音效留成字节。
import type { JsonObject } from "@/palm/sxi-ini.ts"
import { parseSkinJson, SXI_INFO_PATH, SXI_SKIN_PATH } from "@/palm/sxi-json.ts"
import type { FileRole, SkinDocuments, SkinPackage, SkinStructure } from "@/skin-model/pipeline.ts"
import type { Theme, Orientation } from "@/skin-model/types.ts"

/** 手心包的主题与方向是固定的：包内路径不带这两维。 */
const THEME: Theme = "light"
const ORIENTATION: Orientation = "port"

function roleOf(path: string): FileRole {
  const lower = path.toLowerCase()
  if (lower.endsWith("/skin.json") || lower === "skin.json") return { kind: "panel-config" }
  if (lower.endsWith("/info.json") || lower === "info.json") return { kind: "info" }
  if (lower.endsWith(".png")) return { kind: "image" }
  if (/\.(?:mp3|ogg|wav|m4a)$/.test(lower)) return { kind: "audio" }
  if (/\.(?:ttf|otf|ttc)$/.test(lower)) return { kind: "font" }
  if (lower.endsWith(".ini")) return { kind: "layout", board: "main", theme: THEME, orientation: ORIENTATION }
  return { kind: "unknown", reason: `手心包里没有这种文件的位置：${path}` }
}

export function identifySxi(pkg: SkinPackage): SkinStructure {
  const roles = new Map<string, FileRole>()
  for (const path of pkg.files.keys()) roles.set(path, roleOf(path))
  return { roles, themes: [THEME], orientations: [ORIENTATION] }
}

/**
 * 解析手心包。
 * JSON 走结构化解析；图片与音效字节原样保留；判不出角色的文件也保留字节，
 * 由导出方决定怎么处理，不在这里丢弃。
 */
export function parseSxi(pkg: SkinPackage, structure: SkinStructure): SkinDocuments {
  const structs = new Map<string, unknown>()
  const binaries = new Map<string, Uint8Array>()
  const decoder = new TextDecoder()
  for (const path of structure.roles.keys()) {
    const data = pkg.files.get(path)
    if (!data) throw new Error(`识别出角色但包里没有文件：${path}`)
    const lower = path.toLowerCase()
    if (lower.endsWith("skin.json")) {
      structs.set(path, parseSkinJson(decoder.decode(data)))
    } else if (lower.endsWith("info.json")) {
      const parsed = parseSkinJson(decoder.decode(data))
      structs.set(path, parsed)
    } else {
      binaries.set(path, data)
    }
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
