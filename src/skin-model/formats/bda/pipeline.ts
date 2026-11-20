// BDA 皮肤的识别与解析阶段。
//
// 归档把两种原始目录（`light/port/` 与 `port/`）统一成 `<主题>/skin/<方向>/`，图片在 `<主题>/skin/res/`。
// 配置类型靠文件名识别，与目录无关；布局配置是 protobuf，不能按 INI 解析，按角色区分开。
import { IniDocument } from "@/ini.ts"
import type { FileRole, SkinDocuments, SkinPackage, SkinStructure } from "@/skin-model/pipeline.ts"
import type { Theme, Orientation } from "@/skin-model/types.ts"

const CONFIG_LEAF = /^(?:\d*)(appearanceConfig|animationConfig|soundConfig|switchConfig|layoutConfig)$/i

/** 路径里能读出的主题与方向；`res/` 目录只有主题，`port/` 目录只有方向。 */
function placeOf(path: string): { theme?: Theme; orientation?: Orientation } | undefined {
  const themed = /^(light|dark)\/skin\/(?:(port|land)\/|res\/)/i.exec(path)
  if (themed) {
    return {
      theme: themed[1].toLowerCase() as Theme,
      ...(themed[2] ? { orientation: themed[2].toLowerCase() as Orientation } : {}),
    }
  }
  return
}

function roleOf(path: string): FileRole {
  const lower = path.toLowerCase()
  const leaf = lower.split("/").pop() ?? lower
  const place = placeOf(path)
  const orientation = place?.orientation ?? "port"
  const theme = place?.theme ?? "light"

  if (lower.endsWith(".png") || lower.endsWith(".webp")) return { kind: "image" }
  if (/\.(?:mp3|ogg|wav|m4a)$/.test(lower)) return { kind: "audio" }
  if (/\.(?:ttf|otf|ttc)$/.test(lower)) return { kind: "font" }
  if (leaf === "info.txt") return { kind: "info" }
  if (lower.endsWith(".til")) return { kind: "atlas", theme, orientation }

  if (place) {
    const config = CONFIG_LEAF.exec(leaf)
    if (config) {
      const kind = config[1].toLowerCase()
      if (kind === "appearanceconfig") return { kind: "appearance" }
      if (kind === "animationconfig") return { kind: "motion" }
      if (kind === "soundconfig") return { kind: "sound-config" }
      if (kind === "layoutconfig") return { kind: "layout", board: "main", theme, orientation }
      return { kind: "unknown", reason: `BDA 的 ${leaf} 没有建模，原样保留` }
    }
    if (lower.endsWith(".ini")) return { kind: "layout", board: "main", theme, orientation }
    if (lower.endsWith(".txt") || lower.endsWith(".json")) return { kind: "panel-config" }
  }
  return { kind: "unknown", reason: place ? `BDA 包里没有这种文件的位置：${leaf}` : "不在皮肤目录下，无法判断用途" }
}

export function identifyBda(pkg: SkinPackage): SkinStructure {
  const roles = new Map<string, FileRole>()
  const themes = new Set<Theme>()
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
 * 文本配置（信息、图集、面板）解析成文档，二进制配置与图片原样保留字节。
 */
export function parseBda(pkg: SkinPackage, structure: SkinStructure): SkinDocuments {
  const texts = new Map<string, IniDocument>()
  const structs = new Map<string, unknown>()
  const binaries = new Map<string, Uint8Array>()
  const decoder = new TextDecoder()
  for (const [path, role] of structure.roles) {
    const data = pkg.files.get(path)
    if (!data) throw new Error(`识别出角色但包里没有文件：${path}`)
    // 布局配置是 protobuf；其余带 layout 角色的（BDA 里没有）才是 INI。
    const textRole = role.kind === "info" || role.kind === "atlas" || (role.kind === "layout" && !/layoutConfig$/i.test(path))
    if (textRole) {
      texts.set(path, IniDocument.parse(decoder.decode(data)))
    } else if (role.kind === "panel-config") {
      structs.set(path, decoder.decode(data))
    } else {
      binaries.set(path, data)
    }
  }
  return { roles: structure.roles, texts, structs, binaries }
}

/** 配置类文件按路径取字节；转换阶段用它读当前这套外观的配置。 */
export function configBytes(
  documents: SkinDocuments,
  kind: "appearance" | "animation" | "sound" | "layout",
  prefix = "",
): Uint8Array | undefined {
  const wanted: FileRole["kind"] = kind === "layout" ? "layout" : kind === "sound" ? "sound-config" : kind === "animation" ? "motion" : "appearance"
  for (const [path, role] of documents.roles) {
    if (role.kind !== wanted) continue
    if (prefix && !path.toLowerCase().startsWith(prefix.toLowerCase())) continue
    const data = documents.binaries.get(path)
    if (data) return data
  }
  return
}

/** 按角色列出路径；转换阶段找图片与资源用。 */
export function pathsOfRole(documents: SkinDocuments, kind: FileRole["kind"]): string[] {
  return [...documents.roles].filter(([, role]) => role.kind === kind).map(([path]) => path)
}
