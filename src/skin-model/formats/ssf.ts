// 搜狗手机皮肤（SSF）转换器。
//
// 搜狗皮肤只描述"长什么样"，不含按键几何：几何来自搜狗官方的骨架布局。因此读取路径是
// 骨架（几何、内置标签、默认动作）叠加皮肤自己的样式与前景；写回只写皮肤自己的段，不动骨架。
import { IniDocument } from "@/ini.ts"
import { decodePng, encodePng } from "@/raster.ts"
import { ssfKeyBinding } from "@/ssf/ssf-keymap.ts"
import { SsfPackage, parseSsfImage, ssfColor, type SsfImageRef, type SsfTheme } from "@/ssf/ssf-package.ts"
import { ssfSkeleton } from "@/ssf/ssf-convert.ts"
import { documentNamed, identifySsf, parseSsf } from "@/skin-model/formats/ssf-pipeline.ts"
import type { SkinArchive } from "@/skin.ts"
import type { Capability, CapabilityLevel } from "@/skin-model/capability.ts"
import { bdsHintsOf, bdsSource, bdsToModel, layoutText, type BdsReadHints } from "@/skin-model/formats/bds.ts"
import { identifyBds } from "@/skin-model/formats/bds-identify.ts"
import { parseBds } from "@/skin-model/formats/bds-parse.ts"
import { buildBoard } from "@/skin-model/build.ts"
import { ssfAnimationOf } from "@/skin-model/formats/ssf-motion.ts"
import type { ImportOptions, SkinFormat } from "@/skin-model/format.ts"
import type { SkinModel } from "@/skin-model/model.ts"
import type { SkinImage } from "@/skin-model/image.ts"
import type { FileRole, SkinDocuments, SkinStructure } from "@/skin-model/pipeline.ts"
import { filesOf, packageOf } from "@/skin-model/pipeline.ts"
import type { NineSlice, SkinLayer, SkinStyle } from "@/skin-model/style.ts"
import type { Orientation } from "@/skin-model/types.ts"

export type SsfSource = {
  /** 皮肤包内的全部文件。 */
  files: Map<string, Uint8Array>
  /** 官方骨架：提供按键几何、内置标签与默认动作，只读。重建时可以缺省。 */
  skeleton?: SkinArchive
  theme: SsfTheme
  orientation: Orientation
}

export type SsfRebuilt = Omit<SsfSource, "files"> & { files: Map<string, Uint8Array> }

/** 皮肤自己的段（样式、前景）在 IR 样式表里的名字，与骨架样式区分。 */
const LOOK_PREFIX = "ssf:"

/** 搜狗的 stretch 是像素区间 `left,right,top,bottom`；换成九宫格的四个内边距。 */
function nineSliceOf(ref: SsfImageRef, width: number, height: number): NineSlice | undefined {
  const stretch = ref.stretch
  if (!stretch) return
  const [left, right, top, bottom] = stretch
  if (!(left < right && top < bottom) || right > width || bottom > height) return
  return { inner: { left, right: width - right, top, bottom: height - bottom } }
}

/** 一张搜狗图片引用 → IR 图片图层；像素同时切进图片资源表。 */
/** 按文件名在解析产物里找图片；主题目录优先，找不到再放宽。 */
function findImagePath(documents: SkinDocuments, theme: SsfTheme, file: string): string | undefined {
  const leaf = file.split("/").pop() ?? file
  const candidates = [...documents.binaries.keys()].filter((path) => (path.split("/").pop() ?? "") === leaf)
  return candidates.find((path) => path.startsWith(`${theme}/`)) ?? candidates[0]
}

function imageLayer(
  documents: SkinDocuments,
  images: Map<string, SkinImage>,
  theme: SsfTheme,
  ref: SsfImageRef | undefined,
): SkinLayer | undefined {
  if (!ref) return
  const path = findImagePath(documents, theme, ref.file)
  if (!path) return
  if (!images.has(path)) {
    const bytes = documents.binaries.get(path)
    if (!bytes) return
    try {
      images.set(path, decodePng(bytes))
    } catch {
      return
    }
  }
  const image = images.get(path)
  if (!image) return
  const nineSlice = nineSliceOf(ref, image.width, image.height)
  return { kind: "image", image: path, ...(nineSlice ? { fit: "nine-slice", nineSlice } : {}) }
}

/** 段里的字段：皮肤包的两份 INI 各写一半（phoneSkin.ini 管背景，keys.ini 管前景）。 */
function fieldOf(skin: IniDocument, keyDocument: IniDocument, section: string, name: string): string | undefined {
  return skin.get(section, name) ?? keyDocument.get(section, name)
}

/** `BG_IMAGES` / `FG_IMAGES` 指向另一个段（`SMA_Key26Bg_Q`），不是文件名。 */
function imageSectionName(value: string | undefined): string | undefined {
  const name = value?.trim()
  if (!name || /\.(png|webp|jpe?g)$/i.test(name)) return
  return name
}

function imageSectionOf(skin: IniDocument, keyDocument: IniDocument, section: string): string {
  return imageSectionName(fieldOf(skin, keyDocument, section, "BG_IMAGES"))
    ?? imageSectionName(fieldOf(skin, keyDocument, section, "FG_IMAGES"))
    ?? section
}

/** 一个视觉段的完整样式：背景图、按下背景、文字颜色与字号、图标、前景图。 */
function styleOf(
  documents: SkinDocuments,
  images: Map<string, SkinImage>,
  theme: SsfTheme,
  skin: IniDocument,
  keyDocument: IniDocument,
  section: string,
): SkinStyle | undefined {
  const read = (name: string) => fieldOf(skin, keyDocument, section, name)
  const imageSection = imageSectionOf(skin, keyDocument, section)
  const imageRead = (name: string) => fieldOf(skin, keyDocument, imageSection, name)
  const normal: SkinLayer[] = []
  const back = imageLayer(documents, images, theme, parseSsfImage(imageRead("NORMAL")))
  if (back) normal.push(back)
  const color = ssfColor(read("BG_COLOR"))
  if (!back && color) normal.push({ kind: "color", value: color })
  const textColor = ssfColor(read("TEXT_COLOR"))
  if (textColor) {
    const fontSize = Number(read("FONT_SIZE"))
    normal.push({ kind: "text", style: { color: textColor, ...(Number.isFinite(fontSize) && fontSize > 0 ? { fontSize } : {}) } })
  }
  const icon = imageLayer(documents, images, theme, parseSsfImage(read("ICON")))
  if (icon) normal.push(icon)
  const foregroundSection = imageSectionName(fieldOf(skin, keyDocument, section, "FG_IMAGES"))
  if (foregroundSection) {
    const foreground = imageLayer(documents, images, theme, parseSsfImage(fieldOf(skin, keyDocument, foregroundSection, "NORMAL")))
    if (foreground) normal.push(foreground)
  }
  if (!normal.length) return
  const pressedColor = ssfColor(read("TEXT_COLOR_PRESSED"))
  const pressedImage = imageLayer(documents, images, theme, parseSsfImage(imageRead("PRESSED")))
  const pressed: SkinLayer[] = [
    ...(pressedImage ? [pressedImage] : []),
    ...(pressedColor ? [{ kind: "text" as const, style: { color: pressedColor } }] : []),
  ]
  return { normal, ...(pressed.length ? { pressed } : {}) }
}

/** 键盘布局名，如 `py_26`；搜狗按键类由它和按键动作共同决定。 */
function boardName(layoutPath: string): string {
  return layoutPath.split("/").pop()?.replace(/\.ini$/i, "") ?? ""
}

/** 用皮肤自己的样式与前景覆盖骨架给出的按键样式。 */
function applyLook(
  model: SkinModel,
  documents: SkinDocuments,
  images: Map<string, SkinImage>,
  skin: IniDocument,
  keyDocument: IniDocument,
  sections: Map<string, string>,
  landscape: boolean,
  theme: SsfTheme,
): void {
  const styles = new Map(model.styles)
  const lookOf = (section: string): string | undefined => {
    if (!skin.sections().includes(section) && !keyDocument.sections().includes(section)) return
    const name = `${LOOK_PREFIX}${section}`
    if (!styles.has(name)) {
      const style = styleOf(documents, images, theme, skin, keyDocument, section)
      if (!style) return
      styles.set(name, style)
    }
    return name
  }
  for (const board of model.boards) {
    const layout = boardName(board.id)
    for (const key of board.keys) {
      const action = Object.values(key.actions)
        .map((value) => value && value.kind === "text" ? value.value : "")
        .find(Boolean) ?? ""
      const binding = ssfKeyBinding(layout, action, landscape, sections.get(key.id))
      // 皮肤常把背景写成引用段（`BG_IMAGES=SMA_Key26Bg_Q`），引用段本身才带 NORMAL/PRESSED。
      const candidates = binding.sections.flatMap((section) => {
        const referenced = imageSectionOf(skin, keyDocument, section)
        return referenced === section ? [section] : [section, referenced]
      })
      const back = candidates.map(lookOf).find(Boolean)
      if (back) {
        key.container = { ...key.container, back: { ...key.container.back, style: back } }
      }
      const fore = binding.sections.flatMap((section) => {
        const referenced = imageSectionName(fieldOf(skin, keyDocument, section, "FG_IMAGES"))
        if (!referenced) return []
        const name = `${LOOK_PREFIX}${referenced}`
        if (!styles.has(name)) {
          const layer = imageLayer(documents, images, theme, parseSsfImage(fieldOf(skin, keyDocument, referenced, "NORMAL")))
          if (!layer) return []
          styles.set(name, { normal: [layer] })
        }
        return [name]
      })
      if (fore.length) {
        key.container = { ...key.container, fore: fore.map((style) => ({ style })) }
      }
    }
  }
  model.styles = styles
}

function capabilities(): ReadonlyMap<Capability, CapabilityLevel> {
  return new Map<Capability, CapabilityLevel>([
    ["board.geometry", "none"],
    ["board.keys", "full"],
    ["board.add-remove", "none"],
    ["key.actions", "full"],
    ["key.states", "partial"],
    ["key.touch", "none"],
    ["style.image", "full"],
    ["style.nine-slice", "full"],
    ["style.color", "full"],
    ["style.text", "full"],
    ["style.icon", "full"],
    ["panel.backdrop", "full"],
    ["panel.candidate", "partial"],
    ["panel.hint", "none"],
    ["panel.list", "none"],
    ["panel.toolbar", "partial"],
    // 动效经百度风格的动画段转成搜狗的 anim.ini；按动作匹配的绑定能写出来，
    // 粒子与路径这类没有对应概念的仍然表达不了。
    ["motion.track", "partial"],
    ["motion.sequence", "partial"],
    ["motion.binding", "partial"],
    ["sound", "full"],
    ["font", "partial"],
  ])
}

/** 皮肤自己的段名与键的对应关系来自骨架（`SSF_SECTION`），读一次骨架布局即可。 */
function skeletonSections(skeleton: SkinArchive, layout: string): Map<string, string> {
  const document = IniDocument.parse(skeleton.getText(layout))
  const sections = new Map<string, string>()
  for (const section of document.sections()) {
    if (!/^KEY\d+$/i.test(section)) continue
    const value = document.get(section, "SSF_SECTION")
    if (value) sections.set(section, value)
  }
  return sections
}

export function ssfSource(
  files: Map<string, Uint8Array>,
  skeleton: SkinArchive,
  options: Partial<Pick<SsfSource, "theme" | "orientation">> = {},
): SsfSource | undefined {
  try {
    SsfPackage.fromFiles(files)
  } catch {
    return
  }
  return { files, skeleton, theme: options.theme ?? "light", orientation: options.orientation ?? "port" }
}

/** 读取搜狗皮肤时的外部输入；骨架已经拆包解析成文档，不是包。 */
export type SsfReadHints = {
  theme: SsfTheme
  orientation: Orientation
  landscape: boolean
  /** 骨架：布局文档 + 百度侧的读取提示。 */
  base: { documents: SkinDocuments; hints: BdsReadHints }
  /** 骨架布局里的段名，用于按键对齐。 */
  sections: Map<string, string>
}

export function ssfHintsOf(source: SsfSource): SsfReadHints {
  if (!source.skeleton) throw new Error("读取搜狗皮肤需要官方骨架")
  const pkg = SsfPackage.fromFiles(source.files)
  const skeleton = ssfSkeleton(pkg, source.skeleton)
  const base = bdsSource(skeleton, { theme: source.theme, orientation: source.orientation })
  if (!base) throw new Error("搜狗骨架里没有主键盘布局")
  const basePackage = packageOf(skeleton, "bds")
  return {
    theme: source.theme,
    orientation: source.orientation,
    landscape: source.orientation === "land",
    base: {
      documents: parseBds(basePackage, identifyBds(basePackage)),
      hints: bdsHintsOf(base),
    },
    sections: skeletonSections(skeleton, base.layout),
  }
}

/**
 * 解析产物 → 模型。
 * 布局来自骨架，样式来自皮肤自己的两份 INI；签名里没有 SkinPackage。
 */
export async function ssfToModel(
  documents: SkinDocuments,
  hints: SsfReadHints,
  options?: ImportOptions,
): Promise<SkinModel> {
  const model = await bdsToModel(hints.base.documents, hints.base.hints, options)
  const infoDocument = documentNamed(documents, "phoneTheme.ini")
  const info = infoDocument ? { name: infoDocument.get("General", "skin_name"), author: infoDocument.get("General", "skin_author"), version: infoDocument.get("General", "skin_version") } : {}
  model.meta.name = info.name || model.meta.name
  model.meta.author = info.author || model.meta.author
  model.meta.version = info.version || model.meta.version
  model.provenance = { format: "ssf", nodes: new Map() }
  const images = new Map(model.images)
  applyLook(
    model,
    documents,
    images,
    documentNamed(documents, "phoneSkin.ini") ?? IniDocument.parse(""),
    documentNamed(documents, "keys.ini") ?? IniDocument.parse(""),
    hints.sections,
    hints.landscape,
    hints.theme,
  )
  model.images = images
  // 音效与字体是包里的文件，字节要进模型，导出才能脱离源包。
  const resources = new Map(model.resources)
  for (const [path, data] of documents.binaries) {
    if (/\.(?:mp3|ogg|wav|m4a)$/i.test(path)) resources.set(path, { kind: "audio", path, data })
    else if (/\.(?:ttf|otf|ttc)$/i.test(path)) resources.set(path, { kind: "font", path, data })
  }
  model.resources = resources
  return model
}

/** 模型 → 文档。搜狗的三份 INI 与布局、动效都在这里成形。 */
async function ssfFromModel(model: SkinModel): Promise<SkinDocuments> {
  const resolution = String(model.meta.resolution?.width || 1080)
  const texts = new Map<string, IniDocument>()
  const binaries = new Map<string, Uint8Array>()
  const roles = new Map<string, FileRole>()
  const putText = (path: string, text: string, role: FileRole): void => {
    texts.set(path, IniDocument.parse(text))
    roles.set(path, role)
  }
  const putBytes = (path: string, data: Uint8Array, role: FileRole): void => {
    binaries.set(path, data)
    roles.set(path, role)
  }
  // 音效与字体从模型写回；没有字节的说明源包里就没有。
  for (const resource of model.resources.values()) {
    if (!resource.data) continue
    putBytes(resource.path, resource.data, { kind: resource.kind === "font" ? "font" : "audio" })
  }
  const name = (image: string) => image.split("/").pop() ?? image
  const themeLines = ["[General]", "skin_type=1", `skin_name=${model.meta.name ?? "皮肤"}`, `skin_author=${model.meta.author ?? ""}`, `skin_version=${model.meta.version ?? ""}`, ""]
  putText("phoneTheme.ini", themeLines.join("\n"), { kind: "info" })
  const skinLines: string[] = []
  const keyLines: string[] = []
  for (const [styleName, style] of model.styles) {
    if (!styleName.startsWith(LOOK_PREFIX)) continue
    const section = styleName.slice(LOOK_PREFIX.length)
    const image = style.normal.find((layer): layer is Extract<SkinLayer, { kind: "image" }> => layer.kind === "image")
    const pressed = (style.pressed ?? []).find((layer): layer is Extract<SkinLayer, { kind: "image" }> => layer.kind === "image")
    const color = style.normal.find((layer): layer is Extract<SkinLayer, { kind: "color" }> => layer.kind === "color")
    const label = style.normal.find((layer): layer is Extract<SkinLayer, { kind: "text" }> => layer.kind === "text")
    // 搜狗把前景段放在 keys.ini，段名沿用官方拼写 `Foground…`。
    const isForeground = /^(foground|foreground|fg)/i.test(section)
    const lines = [`[${section}]`]
    if (image) lines.push(`NORMAL=${name(image.image)}`)
    if (pressed) lines.push(`PRESSED=${name(pressed.image)}`)
    if (color) lines.push(`BG_COLOR=${color.value}`)
    if (label?.style.color) lines.push(`TEXT_COLOR=${label.style.color}`)
    if (label?.style.fontSize) lines.push(`FONT_SIZE=${label.style.fontSize}`)
    lines.push("")
    if (isForeground) keyLines.push(...lines)
    else skinLines.push(...lines)
  }
  putText(`${resolution}/phoneSkin.ini`, skinLines.join("\n"), { kind: "style", theme: "light" })
  putText(`${resolution}/keys.ini`, keyLines.join("\n"), { kind: "style", theme: "light" })
  for (const [id, image] of model.images) putBytes(`${resolution}/${name(id)}`, encodePng(image), { kind: "image" })
  // 搜狗包必须自带键盘布局：输入法按布局画键，缺了就是一片空白。
  for (const board of model.boards) {
    const renders = await buildBoard(model, board)
    putText(`${resolution}/${boardName(board.id)}.ini`, layoutText(board, renders), { kind: "layout", board: board.kind, theme: "light", orientation: board.orientation })
    // 动效经百度风格的动画段转成搜狗的 anim.ini；转换不了的会进 warnings。
    const animated = await ssfAnimationOf(model, board, model.images)
    if (animated.animation) putText(`${resolution}/anim.ini`, animated.animation.toString(), { kind: "motion" })
  }
  return { roles, texts, structs: new Map(), binaries }
}

/** 搜狗的目录就是分辨率；主题与方向来自文件本身。 */
function ssfStructureOf(documents: SkinDocuments): SkinStructure {
  const themes = new Set<SsfTheme>()
  const orientations = new Set<Orientation>()
  for (const path of documents.roles.keys()) {
    const match = /^(light|dark)\//i.exec(path)
    if (match) themes.add(match[1].toLowerCase() as SsfTheme)
  }
  for (const role of documents.roles.values()) {
    if (role.kind === "layout") orientations.add(role.orientation)
  }
  return { roles: documents.roles, themes: [...themes], orientations: [...orientations] }
}

/** 文档 → 包。 */
function ssfPack(documents: SkinDocuments, structure: SkinStructure): SsfSource {
  const encoder = new TextEncoder()
  const files = new Map<string, Uint8Array>()
  for (const [path, document] of documents.texts) files.set(path, encoder.encode(document.toString()))
  for (const [path, data] of documents.binaries) files.set(path, data)
  return {
    files,
    theme: structure.themes[0] ?? "light",
    orientation: structure.orientations[0] ?? "port",
  }
}

export const ssfFormat: SkinFormat<SsfSource> = {
  name: "ssf",
  capabilities: capabilities(),
  derive: { tolerance: 1 },
  open(archive, context) {
    return context.skeleton ? ssfSource(filesOf(archive), context.skeleton) : undefined
  },
  importer(source, options) {
    const hints = ssfHintsOf(source)
    return {
      identify: identifySsf,
      parse: parseSsf,
      toModel: (documents) => ssfToModel(documents, hints, options),
    }
  },
  exporter: {
    fromModel: ssfFromModel,
    structure: ssfStructureOf,
    pack: ssfPack,
  },
}
