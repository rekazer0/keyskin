import { strFromU8, strToU8, unzipSync, zipSync } from "fflate"
import { IniDocument } from "./ini.ts"
import { parseZip, patchZip, withDirectoryEntries } from "./skin-zip.ts"
import { loadBuiltInProjectTemplate } from "./operations.ts"

/** 搜狗、手心需要显式目录；补目录和元数据时不解压或重压图片、字体和音效。 */
function patchShareZip(bytes: Uint8Array, files: Map<string, Uint8Array>): Uint8Array {
  const source = parseZip(bytes)
  const names = new Set(source.entries.map((entry) => entry.name))
  const empty = new Uint8Array()
  const ordered = withDirectoryEntries([...names].map((name) => [name, empty]))
  const missing = [...ordered].filter(([name]) => !names.has(name))
  if (missing.length) {
    const directories = parseZip(zipSync(Object.fromEntries(missing), { level: 0 })).entries
    const entries = new Map([...source.entries, ...directories].map((entry) => [entry.name, entry]))
    source.entries = [...ordered.keys()].map((name) => entries.get(name)!)
  }
  return patchZip(source, files)
}

export function prepareSogouShare(bytes: Uint8Array): { bytes: Uint8Array; name: string } {
  const theme = unzipSync(bytes, { filter: ({ name }) => name === "phoneTheme.ini" })["phoneTheme.ini"]
  if (!theme) throw new Error("搜狗皮肤缺少 phoneTheme.ini，无法分享到手机")
  const id = `keyskin-${Date.now().toString(36)}`
  const metadata = IniDocument.parse(strFromU8(theme))
  metadata.set("General", "skin_id", id)
  metadata.set("General", "local_skin_id", id)
  metadata.set("General", "local_ugc", "true")
  // 运营皮肤标记会让搜狗把本地皮肤当成云端皮肤，详情页打不开也就无法启用。
  metadata.remove("General", "operational_skin")
  const skinType = Number(metadata.get("General", "skin_type"))
  if (Number.isInteger(skinType) && (skinType & 2048) !== 0) metadata.set("General", "skin_type", String(skinType & ~2048))
  return { bytes: patchShareZip(bytes, new Map([["phoneTheme.ini", strToU8(metadata.toString())]])), name: `${id}.ssf` }
}

/** 手心 Android 的 .piska 入口要求旧版校验文件，渲染仍读取 SXI 的 skin.json 和主题资源。 */
export async function prepareShouXinShare(bytes: Uint8Array): Promise<{ bytes: Uint8Array; name: string }> {
  const previews = ["preview.png", "light/preview.png", "dark/preview.png"]
  const source = unzipSync(bytes, { filter: ({ name }) => name === "skin.json" || previews.includes(name) })
  const template = unzipSync(await loadBuiltInProjectTemplate("palm-harmony"), {
    filter: ({ name }) => name === "light/res/skin.proto" || name === "preview.png",
  })
  const proto = template["light/res/skin.proto"]
  const preview = previews.map((path) => source[path]).find(Boolean) ?? template["preview.png"]
  if (!source["skin.json"] || !proto || !preview) throw new Error("手心皮肤缺少 skin.json 或模板资源，无法分享到手机")
  const id = `keyskin-${Date.now().toString(36)}`
  // 手心按 GBK 读取 skin.ini；列表名称保持英文，避免乱码。
  const metadata = strToU8([
    "[skin]", `name = KeySkin ${id.slice("keyskin-".length)}`, "author = KeySkin", "email =",
    "major_version = 1", "minor_version = 1", `build = ${id}`, "",
  ].join("\n"))
  return { bytes: patchShareZip(bytes, new Map([
    ["skin.ini", metadata], ["skin.proto", proto], ["preview.png", preview], ["preview_small.png", preview],
  ])), name: `${id}.piska` }
}
