// 百度皮肤的解析阶段：把有角色的文件变成文档。
//
// 这里只做「字节 → 文档」，不判断用途、不构造模型。
// 角色由识别阶段给出，所以同一份文件不会被两处逻辑各自解释一次。
import { IniDocument } from "@/ini.ts"
import type { FileRole, SkinDocuments, SkinPackage, SkinStructure } from "@/skin-model/pipeline.ts"

/** 文本类是 INI 的格式，解析成文档对象。 */
const INI_ROLES = new Set<FileRole["kind"]>(["layout", "panel-config", "info", "atlas", "handwriting"])

/** 有角色但没有结构化解析规则、需要原样保留的格式。 */
const RAW_ROLES = new Set<FileRole["kind"]>(["image", "audio", "font", "candidate-window", "hint-window"])

/**
 * 按角色解析整个包。
 * 每个文件都必须落到某个桶里：落不进去说明角色表有遗漏，这里直接抛错，不静默跳过。
 */
export function parseBds(pkg: SkinPackage, structure: SkinStructure): SkinDocuments {
  const texts = new Map<string, IniDocument>()
  const structs = new Map<string, unknown>()
  const binaries = new Map<string, Uint8Array>()
  const decoder = new TextDecoder()

  for (const [path, role] of structure.roles) {
    const data = pkg.files.get(path)
    if (!data) throw new Error(`识别出角色但包里没有文件：${path}`)
    if (INI_ROLES.has(role.kind)) {
      texts.set(path, IniDocument.parse(decoder.decode(data)))
    } else if (role.kind === "style") {
      // 样式表是 CSS，不是 INI；保留原文本，由转换阶段决定怎么读。
      structs.set(path, decoder.decode(data))
    } else if (role.kind === "motion") {
      texts.set(path, IniDocument.parse(decoder.decode(data)))
    } else if (RAW_ROLES.has(role.kind)) {
      binaries.set(path, data)
    } else if (role.kind === "unknown") {
      // 识别不出来的文件不参与解析：它的内容还不知道怎么读，硬塞一个桶只会掩盖问题。
      binaries.set(path, data)
    } else {
      throw new Error(`解析阶段没有处理这种角色：${role.kind}`)
    }
  }

  return { roles: structure.roles, texts, structs, binaries }
}
