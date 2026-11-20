// BDS 样式表：`default.css` 的 `[STYLEn]` 段，以及 `Info.txt` 的元信息表。
//
// 图片引用写成「图集文件名,切片号」，切片编号与 `.til` 的 `[IMG<n>]` 是同一个编号；
// 换算成 `图集#切片` 的图片 id 由这里的 `imageLayer` 完成，写回时由调用方的 `imageRef` 反算。
import type { DocumentAccess } from "@/skin-model/formats/public/access.ts"
import type { SkinImage } from "@/skin-model/image.ts"
import type { SkinLayer, SkinStyle, SkinStyles, Stretch } from "@/skin-model/style.ts"
import type { SkinModel } from "@/skin-model/model.ts"
import type { Theme, Orientation } from "@/skin-model/types.ts"
import type { IniDocument } from "@/ini.ts"
import type { RgbaImage } from "@/raster.ts"
import { decodePng } from "@/raster.ts"
import { cutTiles } from "@/skin-model/image.ts"
import { tileSlices } from "@/tiles.ts"

function imageRef(value: string | undefined): { file: string; slice?: number } | undefined {
  const parts = value?.split(",").map((part) => part.trim())
  const file = parts?.[0]
  if (!file) return
  const slice = parts[1] === undefined ? undefined : Number(parts[1])
  return slice !== undefined && Number.isFinite(slice) ? { file, slice } : { file }
}

function tilePath(access: DocumentAccess, theme: Theme, orientation: Orientation, file: string): string | undefined {
  return [
    `${theme}/skin/${orientation}/res/${file}.til`,
    `${theme}/skin/res/${file}.til`,
    `${theme}/res/${file}.til`,
  ].find((candidate) => access.text(candidate) !== undefined)
}

/** 图集文件与它的 PNG；切图需要像素，所以两者都要在。 */
function atlasBytes(access: DocumentAccess, path: string): Uint8Array | undefined {
  return access.bytes(path.replace(/\.til$/i, ".png"))
}

/** 把一张图集切进图片资源表，返回 `<图集>#<序号>` 键。 */
function cutAtlas(images: Map<string, SkinImage>, access: DocumentAccess, path: string): void {
  if ([...images.keys()].some((key) => key.startsWith(`${path}#`))) return
  const bytes = atlasBytes(access, path)
  if (!bytes) return
  let atlas: RgbaImage
  try {
    atlas = decodePng(bytes)
  } catch {
    return
  }
  const document = access.text(path)
  if (!document) return
  const slices = tileSlices(document)
  for (const [id, image] of cutTiles(atlas, slices.map((slice) => ({ index: slice.index, source: slice.source })), path)) {
    images.set(id, image)
  }
}

/**
 * 切片的 `INNER_RECT` → 拉伸区域。内区就是允许拉伸的那块，与 `nine-slice` 的四边方向相反；
 * 内区等于整片时没有拉伸可表达，返回 undefined。
 */
function stretchOf(tile: { source: readonly [number, number, number, number]; inner?: readonly [number, number, number, number] }): Stretch | undefined {
  if (!tile.inner) return
  const [sourceX, sourceY, width, height] = tile.source
  const [innerX, innerY, innerWidth, innerHeight] = tile.inner
  const inner = { x: innerX - sourceX, y: innerY - sourceY, width: innerWidth, height: innerHeight }
  const fits = inner.x <= 0 && inner.y <= 0 && inner.width >= width && inner.height >= height
  return fits ? undefined : { kind: "region", inner }
}

function imageLayer(
  access: DocumentAccess,
  images: Map<string, SkinImage>,
  theme: Theme,
  orientation: Orientation,
  document: IniDocument,
  section: string,
  field: string,
): SkinLayer | undefined {
  const ref = imageRef(document.get(section, field))
  if (!ref) return
  const path = tilePath(access, theme, orientation, ref.file)
  if (!path) return
  cutAtlas(images, access, path)
  const tileDocument = access.text(path)
  if (!tileDocument) return
  const slices = tileSlices(tileDocument)
  const tile = ref.slice === undefined ? slices[0] : slices.find((candidate) => candidate.index === ref.slice)
  if (!tile) return
  const stretch = stretchOf(tile)
  return {
    kind: "image",
    image: `${path}#${tile.index}`,
    ...(stretch ? { stretch } : {}),
  }
}

function styleLayers(
  access: DocumentAccess,
  images: Map<string, SkinImage>,
  theme: Theme,
  orientation: Orientation,
  document: IniDocument,
  section: string,
  pressed: boolean,
): SkinLayer[] {
  const layers: SkinLayer[] = []
  const suffix = pressed ? "HL" : "NM"
  const image = imageLayer(access, images, theme, orientation, document, section, `${suffix}_IMG`)
  if (image) layers.push(image)
  const color = document.get(section, `${suffix}_COLOR`)
  if (color) {
    const text = document.get(section, "SHOW")
    const fontSize = Number(document.get(section, "FONT_SIZE"))
    if (!pressed && (text || Number.isFinite(fontSize))) {
      layers.push({ kind: "text", ...(text ? { text } : {}), style: { ...(Number.isFinite(fontSize) ? { fontSize } : {}), color } })
    } else layers.push({ kind: "color", value: color })
  }
  if (!pressed) {
    const sound = document.get(section, "PRESS_SOUND_PATH")
    if (sound) layers.push({ kind: "sound", binding: { subject: section, sound } })
  }
  return layers
}

/** `[STYLEn]` 里按结构化字段读出的字段名；其余字段原样保留。 */
const STYLE_MODELED = new Set([
  "NM_IMG", "HL_IMG", "NM_COLOR", "HL_COLOR", "SHOW", "FONT_SIZE", "PRESS_SOUND_PATH", "FONT_FILE", "FONT_NAME",
])

export function stylesOf(
  access: DocumentAccess,
  theme: Theme,
  orientation: Orientation,
  document: IniDocument,
): { styles: SkinStyles; images: Map<string, SkinImage>; fields: Map<string, readonly string[]>; global: ReadonlyMap<string, string> } {
  const styles = new Map<string, SkinStyle>()
  const images = new Map<string, SkinImage>()
  const fields = new Map<string, readonly string[]>()
  const global = new Map<string, string>()
  for (const entry of document.entries("GLOBAL")) global.set(entry.key, entry.value)
  for (const section of document.sections()) {
    const match = /^STYLE(\d+)$/i.exec(section)
    if (!match) continue
    const normal = styleLayers(access, images, theme, orientation, document, section, false)
    const pressed = styleLayers(access, images, theme, orientation, document, section, true)
    // 空样式段也是文件里的事实：段头存在、只是没有可识别的字段。
    styles.set(match[1], { normal, ...(pressed.length ? { pressed } : {}) })
    // 未建模字段、以及同一段里重复出现的同名字段，都保留原始行。
    const seen = new Set<string>()
    const extra: string[] = []
    for (const entry of document.entries(section)) {
      const name = entry.key.toUpperCase()
      const duplicated = seen.has(name)
      seen.add(name)
      if (!duplicated && STYLE_MODELED.has(name)) continue
      extra.push(`${entry.key}=${entry.value}`)
    }
    if (extra.length) fields.set(match[1], extra)
  }
  return { styles, images, fields, global }
}

/**
 * 百度皮肤的段名映射。
 * 百度样式段只用数字编号（`[STYLE12]`），其它格式转来的样式名（如 `bda:image:10039`）不能直接当段名，
 * 否则写出的段读不回来。这里给每个样式分配一个合法段名，按键引用与样式表用同一张表。
 */
export function styleNames(styles: SkinStyles): Map<string, string> {
  const names = new Map<string, string>()
  const used = new Set<string>()
  let next = 1
  for (const id of styles.keys()) {
    // 已经是纯数字的沿用原编号，避免改变原生皮肤的样式名。
    if (/^\d+$/.test(id) && !used.has(id)) {
      names.set(id, id)
      used.add(id)
      continue
    }
    while (used.has(String(next))) next += 1
    names.set(id, String(next))
    used.add(String(next))
    next += 1
  }
  return names
}

export function stylesText(
  styles: SkinStyles,
  imageRef: (id: string) => string | undefined,
  names: ReadonlyMap<string, string>,
  extraOf: (id: string) => readonly string[] | undefined,
  global: ReadonlyMap<string, string> | undefined,
): string {
  const lines: string[] = []
  // 样式表的 `[GLOBAL]` 段是原文件声明的计数等字段，原样写回；没有它就不写。
  if (global?.size) {
    lines.push("[GLOBAL]", ...[...global].map(([key, value]) => `${key}=${value}`), "")
  }
  for (const [id, style] of styles) {
    const name = names.get(id)
    if (!name) continue
    const image = style.normal.find((layer): layer is Extract<SkinLayer, { kind: "image" }> => layer.kind === "image")
    const pressedImage = (style.pressed ?? []).find((layer): layer is Extract<SkinLayer, { kind: "image" }> => layer.kind === "image")
    const text = style.normal.find((layer): layer is Extract<SkinLayer, { kind: "text" }> => layer.kind === "text")
    const color = style.normal.find((layer): layer is Extract<SkinLayer, { kind: "color" }> => layer.kind === "color")
    const pressedColor = (style.pressed ?? []).find((layer): layer is Extract<SkinLayer, { kind: "color" }> => layer.kind === "color")
    const sound = style.normal.find((layer): layer is Extract<SkinLayer, { kind: "sound" }> => layer.kind === "sound")
    const normalRef = image && imageRef(image.image)
    const pressedRef = pressedImage && imageRef(pressedImage.image)
    const textColor = text?.style.color ?? color?.value
    const highlightColor = pressedColor?.value
    // 只有文字没有颜色的样式也要写，否则按键引用会指向不存在的段。
    const hasText = text?.text !== undefined || text?.style.fontSize !== undefined
    const extra = extraOf(id)
    if (!normalRef && !pressedRef && !textColor && !highlightColor && !sound && !hasText && !extra) {
      // 空样式段也是原文件的一部分：段头保留，字段本来就是空的。
      lines.push(`[STYLE${name}]`, "")
      continue
    }
    lines.push(`[STYLE${name}]`)
    if (normalRef) lines.push(`NM_IMG=${normalRef}`)
    if (pressedRef) lines.push(`HL_IMG=${pressedRef}`)
    if (textColor) lines.push(`NM_COLOR=${textColor}`)
    if (highlightColor) lines.push(`HL_COLOR=${highlightColor}`)
    if (text?.text !== undefined) lines.push(`SHOW=${text.text}`)
    if (text?.style.fontSize !== undefined) lines.push(`FONT_SIZE=${text.style.fontSize}`)
    if (sound) lines.push(`PRESS_SOUND_PATH=${sound.binding.sound}`)
    // 未建模字段原样写回；语义还不知道，但它们是原文件的一部分。
    for (const line of extra ?? []) lines.push(line)
    lines.push("")
  }
  return `${lines.join("\n")}\n`
}

/** 字符串字段表：`Info.txt` 的整张表、样式表 `[GLOBAL]` 的字段都走这一种形状。 */
export function textFieldsOf(value: unknown): Map<string, string> {
  const fields = new Map<string, string>()
  if (!(value instanceof Map)) return fields
  for (const [key, item] of value) {
    if (typeof key === "string" && typeof item === "string") fields.set(key, item)
  }
  return fields
}

/** `opaque` 里样式段保留的原始行；值不是字符串数组时当作没有。 */
export function styleFieldsOf(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return
  const lines: string[] = []
  for (const item of value) {
    if (typeof item !== "string") return
    lines.push(item)
  }
  return lines
}

export function infoOf(access: DocumentAccess): { name?: string; author?: string; version?: string; fields: Map<string, string>; exists: boolean } {
  const document = access.text("Info.txt")
  const fields = new Map<string, string>()
  if (!document) return { fields, exists: false }
  for (const entry of document.entries()) fields.set(entry.key, entry.value)
  const value = (key: string): string | undefined => {
    const hit = [...fields].find(([name]) => name.toLowerCase() === key.toLowerCase())
    return hit?.[1].trim() || undefined
  }
  return {
    ...(value("Name") ? { name: value("Name") } : {}),
    ...(value("Author") ? { author: value("Author") } : {}),
    ...(value("Version") ? { version: value("Version") } : {}),
    fields,
    exists: true,
  }
}

/**
 * `Info.txt` 文本。这个文件里除名字/作者/版本之外还有平台、能力声明等字段，IR 不解释它们，
 * 但它们是原包的事实：读时整表留在 `opaque`，写时原样带回；元信息有值时覆盖同名行。
 */
export function infoText(model: SkinModel): string {
  const fields = textFieldsOf(model.opaque.get("info"))
  if (model.meta.name) fields.set("Name", model.meta.name)
  if (model.meta.author) fields.set("Author", model.meta.author)
  if (model.meta.version) fields.set("Version", model.meta.version)
  return `${[...fields].map(([key, value]) => `${key}=${value}`).join("\n")}\n`
}
