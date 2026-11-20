// 搜狗皮肤的识别与解析阶段。
//
// 搜狗包按分辨率分目录，每个时段目录里有 phoneSkin.ini（外观）、keys.ini（按键前景）与 anim.ini（动画）；
// 根目录是 phoneTheme.ini（元信息）、time.ini（时段）、op.ini（开屏/视频）与 smafilelist.ini（清单）。
// 这里只标角色与解析文本，不解释字段。
import { IniDocument } from "@/ini.ts"
import type { FileRole, SkinDocuments, SkinPackage, SkinStructure } from "@/skin-model/pipeline.ts"

function roleOf(path: string): FileRole {
  const lower = path.toLowerCase()
  const leaf = lower.split("/").pop() ?? lower

  if (leaf === "phonetheme.ini") return { kind: "info" }
  if (leaf === "time.ini") return { kind: "appearance" }
  if (leaf === "op.ini") return { kind: "panel-config" }
  if (leaf === "smafilelist.ini") return { kind: "manifest" }
  if (leaf === "sound_android.ini") return { kind: "sound-config" }
  if (leaf === "anim.ini") return { kind: "motion" }
  if (leaf === "phoneskin.ini" || leaf === "keys.ini") return { kind: "style", theme: "light" }
  if (/\.(?:png|webp|gif|jpe?g)$/.test(lower)) return { kind: "image" }
  if (/\.(?:mp3|ogg|wav|m4a|aiff|caf)$/.test(lower)) return { kind: "audio" }
  if (/\.(?:ttf|otf|ttc)$/.test(lower)) return { kind: "font" }
  return { kind: "unknown", reason: `搜狗皮肤里没有这个文件的位置：${leaf}` }
}

/** 搜狗包没有方向维度；时段是外观生效条件，不是主题。 */
export function identifySsf(pkg: SkinPackage): SkinStructure {
  const roles = new Map<string, FileRole>()
  for (const path of pkg.files.keys()) roles.set(path, roleOf(path))
  return { roles, themes: [], orientations: [] }
}

/** 文本类角色：解析成文档；图片与音效留字节。 */
const TEXT_ROLES = new Set<FileRole["kind"]>(["info", "appearance", "panel-config", "manifest", "sound-config", "motion", "style"])

export function parseSsf(pkg: SkinPackage, structure: SkinStructure): SkinDocuments {
  const texts = new Map<string, IniDocument>()
  const binaries = new Map<string, Uint8Array>()
  const decoder = new TextDecoder()
  for (const [path, role] of structure.roles) {
    const data = pkg.files.get(path)
    if (!data) throw new Error(`识别出角色但包里没有文件：${path}`)
    if (TEXT_ROLES.has(role.kind)) texts.set(path, IniDocument.parse(decoder.decode(data)))
    else binaries.set(path, data)
  }
  return { roles: structure.roles, texts, structs: new Map(), binaries }
}
