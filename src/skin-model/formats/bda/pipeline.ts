// BDA 皮肤的识别与解析阶段。
//
// BDA 包里的核心是几份二进制配置（外观、动画、音效）与图片；
// 键盘布局不在包里，来自外部的布局骨架，所以这里不产生布局角色。
import { IniDocument } from "@/ini.ts"
import type { FileRole, SkinDocuments, SkinPackage, SkinStructure } from "@/skin-model/pipeline.ts"
import type { Appearance, Orientation } from "@/skin-model/types.ts"

/** 从路径里取主题与方向；BDA 的目录就是 `<主题>/skin/<方向>/`。 */
function placeOf(path: string): { theme: Appearance; orientation: Orientation } | undefined {
  const match = /^(light|dark)\/skin\/(port|land)\//i.exec(path)
  if (!match) return
  return {
    theme: match[1].toLowerCase() as Appearance,
    orientation: match[2].toLowerCase() as Orientation,
  }
}

/** 配置文件名去掉可能的前导编号后是什么。 */
function configKind(leaf: string): FileRole["kind"] | undefined {
  const bare = leaf.replace(/^\d+/, "")
  if (/^appearanceConfig$/i.test(bare)) return "appearance"
  if (/^animationConfig$/i.test(bare)) return "motion"
  if (/^soundConfig$/i.test(bare)) return "sound-config"
  return
}

function roleOf(path: string): FileRole {
  const lower = path.toLowerCase()
  const leaf = lower.split("/").pop() ?? lower
  const place = placeOf(path)

  if (lower.endsWith(".png")) return { kind: "image" }
  if (/\.(?:mp3|ogg|wav|m4a)$/.test(lower)) return { kind: "audio" }
  if (/\.(?:ttf|otf|ttc)$/.test(lower)) return { kind: "font" }
  if (leaf === "info.txt") return { kind: "info" }

  if (place) {
    const kind = configKind(leaf)
    if (kind) return { kind } as FileRole
    if (lower.endsWith(".ini")) return { kind: "layout", board: "main", theme: place.theme, orientation: place.orientation }
    // 配置目录下还有菜单、面板一类的文本文件，按面板配置对待。
    if (lower.endsWith(".txt") || lower.endsWith(".json")) return { kind: "panel-config" }
  }
  return { kind: "unknown", reason: place ? `BDA 包里没有这种文件的位置：${leaf}` : "不在主题方向目录下，无法判断用途" }
}

export function identifyBda(pkg: SkinPackage): SkinStructure {
  const roles = new Map<string, FileRole>()
  const themes = new Set<Appearance>()
  const orientations = new Set<Orientation>()
  for (const path of pkg.files.keys()) {
    const role = roleOf(path)
    roles.set(path, role)
    if ("theme" in role) themes.add(role.theme)
    if ("orientation" in role) orientations.add(role.orientation)
  }
  return { roles, themes: [...themes].sort(), orientations: [...orientations].sort() }
}

/**
 * 解析 BDA 包。
 * 二进制配置与图片原样保留，布局类解析成 INI 文档；判不出角色的文件也保留字节。
 */
export function parseBda(pkg: SkinPackage, structure: SkinStructure): SkinDocuments {
  const texts = new Map()
  const structs = new Map<string, unknown>()
  const binaries = new Map<string, Uint8Array>()
  const decoder = new TextDecoder()
  for (const [path, role] of structure.roles) {
    const data = pkg.files.get(path)
    if (!data) throw new Error(`识别出角色但包里没有文件：${path}`)
    if (role.kind === "layout") {
      texts.set(path, IniDocument.parse(decoder.decode(data)))
    } else if (role.kind === "panel-config") {
      structs.set(path, decoder.decode(data))
    } else {
      binaries.set(path, data)
    }
  }
  return { roles: structure.roles, texts, structs, binaries }
}

/** 配置类文件按路径取字节；转换阶段用它读外观与动画。 */
export function configBytes(documents: SkinDocuments, kind: "appearance" | "animation" | "sound"): Uint8Array | undefined {
  for (const [path, role] of documents.roles) {
    if (role.kind === "appearance" && kind === "appearance") return documents.binaries.get(path)
    if (role.kind === "motion" && kind === "animation") return documents.binaries.get(path)
    if (role.kind === "sound-config" && kind === "sound") return documents.binaries.get(path)
  }
  return
}

/** 按角色列出路径；转换阶段找图片与资源用。 */
export function pathsOfRole(documents: SkinDocuments, kind: FileRole["kind"]): string[] {
  return [...documents.roles].filter(([, role]) => role.kind === kind).map(([path]) => path)
}
