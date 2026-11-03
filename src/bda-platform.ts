import { strFromU8, strToU8, zipSync } from "fflate"
import { convertBdaAppearancePlatform, convertBdaSoundPlatform, IOS_BDA_PANELS } from "./bda-encode.ts"
import { decodeBdaAppearance, decodeBdaSoundConfig } from "./bda-decode.ts"
import { SkinArchive } from "./skin.ts"

export type BdaPlatform = "ios" | "android" | "unknown"

const infoValue = (archive: SkinArchive, key: string) => {
  const bytes = archive.getBytes("Info.txt")
  return bytes ? strFromU8(bytes).match(new RegExp(`^${key}=(.*)$`, "mi"))?.[1].trim() : undefined
}

export function bdaPlatform(archive: SkinArchive): BdaPlatform {
  if (archive.format !== "bda") return "unknown"
  let ios = 0
  let android = 0
  for (const path of archive.names()) {
    const bytes = archive.getBytes(path)
    if (!bytes) continue
    if (/\/appearanceConfig$/i.test(path)) {
      const appearance = decodeBdaAppearance(bytes)
      if (appearance.designWidth === 1242 && [...appearance.panels.keys()].every((name) => IOS_BDA_PANELS.has(name))) ios += 3
      if (appearance.designWidth === 1080 || appearance.designWidth === 1920) android += 2
      if ([...appearance.panels.keys()].some((name) => !IOS_BDA_PANELS.has(name))) android += 2
    } else if (/\/soundConfig$/i.test(path)) {
      const sound = decodeBdaSoundConfig(bytes)
      if (sound.iosKeySounds.size) ios++
      if (sound.keySounds.size) android++
    } else if (/\/switchConfig$/i.test(path)) android++
  }
  if (ios > android) return "ios"
  if (android > ios) return "android"
  return infoValue(archive, "SupportPlatform") === "I" ? "ios"
    : infoValue(archive, "SupportPlatform") === "A" ? "android" : "unknown"
}

function setInfoPlatform(text: string, platform: BdaPlatform): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n"
  const value = platform === "ios" ? "I" : "A"
  return /^SupportPlatform=.*$/mi.test(text)
    ? text.replace(/^SupportPlatform=.*$/mi, `SupportPlatform=${value}`)
    : `${text}${text && !text.endsWith("\n") && !text.endsWith("\r") ? eol : ""}SupportPlatform=${value}${eol}`
}

function setInfoAtomSkinNames(text: string, names: [string, string]): string {
  const value = names.join(",")
  return /^AtomSkinName=.*$/mi.test(text)
    ? text.replace(/^AtomSkinName=.*$/mi, `AtomSkinName=${value}`)
    : `${text}${text && !text.endsWith("\n") && !text.endsWith("\r") ? "\n" : ""}AtomSkinName=${value}\n`
}

export function convertBdaPlatform(source: SkinArchive, platform: Exclude<BdaPlatform, "unknown">): SkinArchive {
  if (source.format !== "bda") throw new Error("只能转换 BDA 皮肤")
  const converted = new Map<string, Uint8Array>()
  const deleted = new Set<string>()
  const names = source.names()
  for (const canonicalPath of names) {
    const rawPath = source.sourcePath(canonicalPath)
    const bytes = source.getSourceBytes(rawPath)
    if (!bytes) continue
    if (/(^|\/)Info\.txt$/i.test(canonicalPath)) converted.set(rawPath, strToU8(setInfoPlatform(strFromU8(bytes), platform)))
    else if (/\/appearanceConfig$/i.test(canonicalPath)) converted.set(rawPath, convertBdaAppearancePlatform(bytes, platform))
    else if (/\/soundConfig$/i.test(canonicalPath)) converted.set(rawPath, convertBdaSoundPlatform(bytes, platform))
    else if (platform === "ios" && /\/switchConfig$/i.test(canonicalPath)) deleted.add(rawPath)
  }

  const output: Record<string, Uint8Array> = {}
  // sourcePaths excludes explicit directory entries; retain those too, without normalizing raw names.
  const paths = [...source.sourcePaths(), ...names.filter((path) => path.endsWith("/")).map((path) => source.sourcePath(path))]
  for (const rawPath of paths) {
    if (deleted.has(rawPath)) continue
    let path = rawPath
    if (platform === "ios") {
      // Android exports may carry a legacy BDI token under `skin/`; native iOS BDA packages have
      // no `skin/` wrapper, so keep the existing filter before renaming theme roots.
      if (/^skin(?:\/|$)/i.test(path)) continue
      path = path.replace(/^light\//, "skin_light/").replace(/^dark\//, "skin_dark/")
    } else {
      path = path.replace(/^skin_light\//, "light/").replace(/^skin_dark\//, "dark/")
    }
    const bytes = converted.get(rawPath) ?? source.getSourceBytes(rawPath)!
    output[path] = /(?:^|\/)Info\.txt$/i.test(path)
      ? strToU8(setInfoAtomSkinNames(strFromU8(bytes), platform === "ios" ? ["skin_light", "skin_dark"] : ["light", "dark"]))
      : bytes
  }
  const archive = SkinArchive.open(zipSync(output, { level: 6 }), "bda")
  if (bdaPlatform(archive) !== platform) throw new Error(`无法转换为${platform === "ios" ? " iOS" : " Android"} BDA`)
  return archive
}

export function bdaCompatibilityWarnings(archive: SkinArchive): string[] {
  if (archive.format !== "bda") return []
  const platform = bdaPlatform(archive)
  const declared = infoValue(archive, "SupportPlatform")
  const warnings: string[] = []
  // SupportPlatform 可组合（工具书 V6 p165：SWIA / IA），包含目标平台字母即可。
  if (platform !== "unknown" && declared && !declared.toUpperCase().includes(platform === "ios" ? "I" : "A")) {
    warnings.push(`Info.txt 声明为 ${declared}，但配置属于 ${platform === "ios" ? "iOS" : "Android"} BDA`)
  }
  const encrypted = archive.zipEncryptedPaths().filter((path) => !path.endsWith("/"))
  if (encrypted.length) warnings.push(`ZIP 有 ${encrypted.length} 个条目被标记为加密，目标输入法可能静默拒绝`)
  return warnings
}

/** The keyboard that draws the skin: BDI is iOS; a BDS declared for iOS only, or an iOS BDA, too. */
export function skinPlatform(archive: SkinArchive): Exclude<BdaPlatform, "unknown"> {
  if (archive.format === "bdi") return "ios"
  if (archive.format === "bda") return bdaPlatform(archive) === "ios" ? "ios" : "android"
  const declared = infoValue(archive, "SupportPlatform")?.toUpperCase() ?? ""
  return declared.includes("I") && !declared.includes("A") ? "ios" : "android"
}
