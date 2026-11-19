// 搜狗皮肤的识别与解析阶段。
//
// 搜狗包按分辨率分目录，每个目录里有 phoneSkin.ini（外观）、keys.ini（前景）、
// 若干键盘布局与图片；根目录的 phoneTheme.ini 是皮肤信息。
import { IniDocument } from "@/ini.ts"
import type { FileRole, SkinDocuments, SkinPackage, SkinStructure } from "@/skin-model/pipeline.ts"
import type { Appearance, Orientation } from "@/skin-model/types.ts"

const THEME: Appearance = "light"
const ORIENTATION: Orientation = "port"

function roleOf(path: string): FileRole {
  const lower = path.toLowerCase()
  const leaf = lower.split("/").pop() ?? lower

  if (leaf === "phonetheme.ini") return { kind: "info" }
  if (lower.endsWith(".png") || lower.endsWith(".webp") || lower.endsWith(".gif") || lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return { kind: "image" }
  }
  if (/\.(?:mp3|ogg|wav|m4a)$/.test(lower)) return { kind: "audio" }
  if (/\.(?:ttf|otf|ttc)$/.test(lower)) return { kind: "font" }
  if (lower.endsWith(".ini")) {
    // phoneSkin 与 keys 是外观表，其余 ini 是键盘布局。
    if (leaf === "phoneskin.ini" || leaf === "keys.ini") return { kind: "style", theme: THEME }
    if (leaf === "anim.ini") return { kind: "motion" }
    return { kind: "layout", board: "main", theme: THEME, orientation: ORIENTATION }
  }
  return { kind: "unknown", reason: `搜狗包里没有这种文件的位置：${leaf}` }
}

export function identifySsf(pkg: SkinPackage): SkinStructure {
  const roles = new Map<string, FileRole>()
  for (const path of pkg.files.keys()) roles.set(path, roleOf(path))
  return { roles, themes: [THEME], orientations: [ORIENTATION] }
}

/**
 * 解析搜狗包。
 * INI 类解析成文档，图片与音效留成字节；判不出角色的文件保留字节。
 */
export function parseSsf(pkg: SkinPackage, structure: SkinStructure): SkinDocuments {
  const texts = new Map<string, IniDocument>()
  const binaries = new Map<string, Uint8Array>()
  const decoder = new TextDecoder()
  for (const [path, role] of structure.roles) {
    const data = pkg.files.get(path)
    if (!data) throw new Error(`识别出角色但包里没有文件：${path}`)
    if (role.kind === "info" || role.kind === "style" || role.kind === "layout" || role.kind === "motion") {
      texts.set(path, IniDocument.parse(decoder.decode(data)))
    } else {
      binaries.set(path, data)
    }
  }
  return { roles: structure.roles, texts, structs: new Map(), binaries }
}

/** 按文件名找解析后的文档；转成模型时用。 */
export function documentNamed(documents: SkinDocuments, leaf: string): IniDocument | undefined {
  const wanted = leaf.toLowerCase()
  for (const [path, document] of documents.texts) {
    if ((path.split("/").pop() ?? "").toLowerCase() === wanted) return document
  }
  return
}
