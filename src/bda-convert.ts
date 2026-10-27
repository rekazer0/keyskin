import { strToU8, zipSync } from "fflate"
import { bdaAppearancePath, bdaConfigPath, bdaConfigPaths, bdaLayoutDocument, bdaStyleID, bdaPanelKeyName, type BdaAnimation, type BdaImageAtom } from "./bda.ts"
import { bdaColorHex } from "./bda-resolver.ts"
import { decodeBdaAnimation, decodeBdaAppearance, decodeBdaSoundConfig } from "./bda-decode.ts"
import { IniDocument } from "./ini.ts"
import { SkinArchive } from "./skin.ts"
import { soundPathForFilename } from "./sounds.ts"

/** Sound styles sit above the image/color/text ranges used by bdaStyleID. */
const SOUND_STYLE_BASE = 4_000_000

type BdaConversion = { archive: SkinArchive; warnings: string[] }

function pngSize(bytes: Uint8Array): [number, number] {
  if (
    bytes.length < 24 ||
    ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte) ||
    new TextDecoder().decode(bytes.slice(12, 16)) !== "IHDR"
  ) throw new Error("BDA 资源不是有效的 PNG")
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return [view.getUint32(16), view.getUint32(20)]
}

function staticResourceID(resourceID: string, animation: BdaAnimation): string {
  return animation.sequences.get(resourceID)?.frames.find((frame) => frame.resourceID)?.resourceID ?? resourceID
}

function sourceImage(
  source: SkinArchive,
  theme: string,
  orientation: string,
  resourceID: string,
): { id: string; bytes: Uint8Array } | undefined {
  const id = resourceID.replace(/\.png$/i, "")
  const paths = [
    `${theme}/skin/${orientation}/res/${id}.png`,
    `${theme}/skin/res/${id}.png`,
  ]
  const path = paths.find((candidate) => source.isImage(candidate))
  const bytes = path && source.getBytes(path)
  return bytes ? { id, bytes } : undefined
}

function tile(width: number, height: number, inner?: BdaImageAtom["innerRect"]): Uint8Array {
  return strToU8([
    "[GLOBAL]",
    "TILE_NUM=1",
    "",
    "[IMG1]",
    `SOURCE_RECT=0,0,${width},${height}`,
    ...(inner ? [`INNER_RECT=${inner.x},${inner.y},${inner.width},${inner.height}`] : []),
    "",
  ].join("\n"))
}

function applyKeySounds(document: IniDocument, sounds: Map<string, string>, fallback: string | undefined): void {
  if (fallback) document.set("PANEL", "SOUND_STYLE", fallback)
  for (const section of document.sections().filter((name) => /^KEY\d+$/.test(name))) {
    const style = [document.get(section, "CENTER"), document.get(section, "DOWN")]
      .filter((value): value is string => Boolean(value))
      .map((action) => sounds.get(bdaPanelKeyName(action)))
      .find(Boolean)
    if (style && style !== fallback) document.set(section, "SOUND_STYLE", style)
  }
}

export function convertBdaArchive(source: SkinArchive, base: SkinArchive, format: "bdi" | "bds" = "bds"): BdaConversion {
  if (source.format !== "bda") throw new Error("只能转换 BDA 皮肤")
  const output = new Map<string, Uint8Array>()
  const warnings: string[] = []
  for (const path of ["Info.txt", "demo.png"]) {
    const bytes = source.getBytes(path)
    if (bytes) output.set(path, bytes)
  }

  for (const theme of ["light", "dark"] as const) {
    const soundStyles = new Map<string, string>()
    // Both orientations share the theme's default.css; BDA style keys are global, so they merge.
    const themeStyles = new Map<string, string[]>()
    let conflicts = 0
    for (const name of ["Info.txt", "demo.png"] as const) {
      const bytes = source.getBytes(`${theme}/skin/${name}`) ?? source.getBytes(name)
      if (bytes) output.set(`${theme}/skin/${name}`, bytes)
    }
    for (const orientation of ["port", "land"] as const) {
      const appearancePath = bdaAppearancePath(source, theme, orientation)
      const appearanceBytes = appearancePath && source.getBytes(appearancePath)
      if (!appearanceBytes) continue
      const appearance = decodeBdaAppearance(appearanceBytes)
      const animationPath = bdaConfigPath(source, theme, orientation, "animation")
      const animationBytes = animationPath && source.getBytes(animationPath)
      const animation = animationBytes
        ? decodeBdaAnimation(animationBytes)
        : { targets: [], sequences: new Map(), bindings: new Map(), targetBindings: new Map(), effects: new Map() }

      // Key name -> sound style ID; the target platform's own sound map wins, the other is a fallback.
      const keySounds = new Map<string, string>()
      const soundConfigPath = bdaConfigPath(source, theme, orientation, "sound")
        ?? bdaConfigPath(source, theme, orientation === "port" ? "land" : "port", "sound")
      const soundBytes = soundConfigPath && source.getBytes(soundConfigPath)
      if (soundBytes) {
        const config = decodeBdaSoundConfig(soundBytes)
        const sounds = (format === "bdi" ? [config.iosKeySounds, config.keySounds] : [config.keySounds, config.iosKeySounds])
          .find((map) => map.size) ?? new Map()
        for (const [key, resource] of sounds) {
          const path = resource.resourceID
            ? soundPathForFilename(source.names(), theme, orientation, resource.resourceID)
            : undefined
          const bytes = path && source.getBytes(path)
          if (!path || !bytes) {
            warnings.push(`${theme}/${orientation} 的按键音 ${resource.resourceID || key} 缺少音频文件，已跳过`)
            continue
          }
          const filename = path.split("/").pop()!
          let styleID = soundStyles.get(filename)
          if (!styleID) {
            styleID = String(SOUND_STYLE_BASE + soundStyles.size)
            soundStyles.set(filename, styleID)
          }
          output.set(`${theme}/skin/res/${filename}`, bytes)
          keySounds.set(key, styleID)
        }
      }
      const defaultSound = keySounds.get("default") ?? keySounds.values().next().value

      const basePrefix = `light/skin/${orientation}/`
      const targetPrefix = `${theme}/skin/${orientation}/`
      for (const path of base.names()) {
        if (!path.startsWith(basePrefix) || path.slice(basePrefix.length).includes("/")) continue
        const name = path.slice(basePrefix.length)
        if (name !== "gen.ini" && /\.ini$/i.test(name)) continue
        const bytes = base.getBytes(path)
        if (bytes) output.set(`${targetPrefix}${name}`, bytes)
      }
      for (const layout of appearance.panels.keys()) {
        const path = `${basePrefix}${layout}.ini`
        if (!base.isText(path)) {
          warnings.push(`${theme}/${orientation} 的 ${layout} 面板没有 BDS/BDI 基础布局，已跳过`)
          continue
        }
        const document = bdaLayoutDocument(IniDocument.parse(base.getText(path)), appearance, layout)
        if (keySounds.size) applyKeySounds(document, keySounds, defaultSound)
        output.set(`${targetPrefix}${layout}.ini`, strToU8(document.toString()))
      }

      const addStyle = (header: string, lines: string[]) => {
        const existing = themeStyles.get(header)
        if (!existing) themeStyles.set(header, lines)
        else if (existing.join("\n") !== lines.join("\n")) conflicts++
      }
      const copied = new Set<string>()
      const imageSpec = (atom: BdaImageAtom | undefined): string | undefined => {
        const original = atom?.resource?.resourceID
        if (!original) return
        const resourceID = staticResourceID(original, animation)
        const image = sourceImage(source, theme, orientation, resourceID)
        if (!image) return
        if (!copied.has(image.id)) {
          const [width, height] = pngSize(image.bytes)
          output.set(`${theme}/skin/res/${image.id}.png`, image.bytes)
          output.set(`${theme}/skin/res/${image.id}.til`, tile(width, height, atom?.innerRect))
          copied.add(image.id)
        }
        return `${image.id},1`
      }
      for (const [key, style] of appearance.imageStyles) {
        const normal = imageSpec(style.normalImage)
        const highlighted = imageSpec(style.highlightImage) ?? normal
        addStyle(`[STYLE${bdaStyleID({ type: "image", key })}]`, [
          ...(normal ? [`NM_IMG=${normal}`] : []),
          ...(highlighted ? [`HL_IMG=${highlighted}`] : []),
        ])
      }
      for (const [key, style] of appearance.colorStyles) {
        addStyle(`[STYLE${bdaStyleID({ type: "color", key })}]`, [
          `NM_COLOR=${bdaColorHex(style.normalColor ?? 0)}`,
          `HL_COLOR=${bdaColorHex(style.highlightColor ?? style.normalColor ?? 0)}`,
        ])
      }
      for (const [key, style] of appearance.textStyles) {
        addStyle(`[STYLE${bdaStyleID({ type: "text", key })}]`, [
          ...(style.fontName ? [`FONT_NAME=${style.fontName}`] : []),
          ...(style.fontSize ? [`FONT_SIZE=${style.fontSize}`] : []),
          `NM_COLOR=${bdaColorHex(style.normalColor ?? 0)}`,
          `HL_COLOR=${bdaColorHex(style.highlightColor ?? style.normalColor ?? 0)}`,
        ])
      }
      // Legacy INI cannot carry BDA's protobuf effects. Warn for every config, including
      // numbered/light variants and transform-only skins, before the caller confirms export.
      const animationPaths = [...bdaConfigPaths(source, theme, orientation, "animation"), ...bdaConfigPaths(source, theme, orientation, "lightAnimation")]
      for (const path of animationPaths) {
        const bytes = source.getBytes(path)!
        const config = decodeBdaAnimation(bytes)
        if (!bytes.length) continue
        const kinds = [...new Set([...config.effects.values()].map((effect) => effect.kind))]
        warnings.push(`${theme}/${orientation}/${path.split("/").pop()} 的动效（${kinds.join("、") || "未识别配置"}）无法保留到 ${format.toUpperCase()}，将导出静态外观；保留动效请使用 BDA`)
      }
    }
    if (!themeStyles.size && !soundStyles.size) continue
    for (const [filename, styleID] of soundStyles) themeStyles.set(`[STYLE${styleID}]`, [`PRESS_SOUND_PATH=${filename}`])
    const sections = [...themeStyles].flatMap(([header, lines]) => [header, ...lines, ""])
    output.set(`${theme}/skin/res/default.css`, strToU8(`[GLOBAL]\nSTYLE_NUM=${themeStyles.size}\n\n${sections.join("\n")}`))
    if (conflicts) warnings.push(`${theme} 的横竖屏有 ${conflicts} 个同号样式内容不同，横屏沿用竖屏样式`)
  }

  if (!output.size) throw new Error("BDA 中没有可转换的外观配置")
  return { archive: SkinArchive.open(zipSync(Object.fromEntries(output), { level: 6 })), warnings }
}
