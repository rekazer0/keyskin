// 搜狗手机皮肤（SSF）转换器。
//
// 搜狗皮肤只描述"长什么样"，不含按键几何：几何来自搜狗官方的骨架布局。因此读取路径是
// 骨架（几何、内置标签、默认动作）叠加皮肤自己的样式与前景；写回只写皮肤自己的段，不动骨架。
import { IniDocument } from "@/ini.ts"
import { pngSize } from "@/ssf/ssf-png.ts"
import { ssfKeyBinding } from "@/ssf/ssf-keymap.ts"
import { SsfPackage, parseSsfImage, ssfColor, type SsfImageRef, type SsfTheme } from "@/ssf/ssf-package.ts"
import { ssfSkeleton } from "@/ssf/ssf-convert.ts"
import type { SkinArchive } from "@/skin.ts"
import type { Capability, CapabilityLevel } from "@/skin-model/capability.ts"
import { bdsFormat, bdsSource } from "@/skin-model/formats/bds.ts"
import type { ImportOptions, SkinFormat } from "@/skin-model/format.ts"
import type { SkinModel } from "@/skin-model/model.ts"
import type { LayoutBox } from "@/skin-model/layout.ts"
import type { NineSlice, SkinLayer, SkinStyle } from "@/skin-model/style.ts"
import type { Orientation } from "@/skin-model/types.ts"

export type SsfSource = {
  /** 皮肤包内的全部文件。 */
  files: Map<string, Uint8Array>
  /** 官方骨架：提供按键几何、内置标签与默认动作，只读。 */
  skeleton: SkinArchive
  theme: SsfTheme
  orientation: Orientation
}

/** 皮肤自己的段（样式、前景）在 IR 样式表里的名字，与骨架样式区分。 */
const LOOK_PREFIX = "ssf:"

/** 搜狗的 stretch 是像素区间 `left,right,top,bottom`；换成九宫格的四个内边距。 */
function nineSliceOf(ref: SsfImageRef, width: number, height: number): NineSlice | undefined {
  const stretch = ref.stretch
  if (!stretch) return
  const [left, right, top, bottom] = stretch
  if (!(left < right && top < bottom) || right > width || bottom > height) return
  return {
    source: { position: { x: 0, y: 0 }, size: { width, height } },
    inner: { left, right: width - right, top, bottom: height - bottom },
  }
}

/** 一张搜狗图片引用 → IR 图片图层；找不到文件时返回 undefined。 */
function imageLayer(pkg: SsfPackage, theme: SsfTheme, ref: SsfImageRef | undefined): SkinLayer | undefined {
  if (!ref) return
  const path = pkg.path(theme, ref.file)
  if (!path) return
  const bytes = ref.stretch ? pkg.file(theme, ref.file) : undefined
  const size = bytes ? pngSize(bytes) : undefined
  const nineSlice = size ? nineSliceOf(ref, size[0], size[1]) : undefined
  return { kind: "image", file: path, ...(nineSlice ? { fit: "nine-slice", nineSlice } : {}) }
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
function styleOf(pkg: SsfPackage, theme: SsfTheme, skin: IniDocument, keyDocument: IniDocument, section: string): SkinStyle | undefined {
  const read = (name: string) => fieldOf(skin, keyDocument, section, name)
  const imageSection = imageSectionOf(skin, keyDocument, section)
  const imageRead = (name: string) => fieldOf(skin, keyDocument, imageSection, name)
  const normal: SkinLayer[] = []
  const back = imageLayer(pkg, theme, parseSsfImage(imageRead("NORMAL")))
  if (back) normal.push(back)
  const color = ssfColor(read("BG_COLOR"))
  if (!back && color) normal.push({ kind: "color", value: color })
  const textColor = ssfColor(read("TEXT_COLOR"))
  if (textColor) {
    const fontSize = Number(read("FONT_SIZE"))
    normal.push({ kind: "text", style: { color: textColor, ...(Number.isFinite(fontSize) && fontSize > 0 ? { fontSize } : {}) } })
  }
  const icon = imageLayer(pkg, theme, parseSsfImage(read("ICON")))
  if (icon) normal.push(icon)
  const foregroundSection = imageSectionName(fieldOf(skin, keyDocument, section, "FG_IMAGES"))
  if (foregroundSection) {
    const foreground = imageLayer(pkg, theme, parseSsfImage(fieldOf(skin, keyDocument, foregroundSection, "NORMAL")))
    if (foreground) normal.push(foreground)
  }
  if (!normal.length) return
  const pressedColor = ssfColor(read("TEXT_COLOR_PRESSED"))
  const pressedImage = imageLayer(pkg, theme, parseSsfImage(imageRead("PRESSED")))
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

function keyBoxes(model: SkinModel): Map<string, LayoutBox> {
  const boxes = new Map<string, LayoutBox>()
  for (const board of model.boards) for (const key of board.keys) boxes.set(key.id, key.rect)
  return boxes
}

/** 用皮肤自己的样式与前景覆盖骨架给出的按键样式。 */
function applyLook(
  model: SkinModel,
  pkg: SsfPackage,
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
      const style = styleOf(pkg, theme, skin, keyDocument, section)
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
      if (back) key.style.back = back
      const fore = binding.sections.flatMap((section) => {
        const referenced = imageSectionName(fieldOf(skin, keyDocument, section, "FG_IMAGES"))
        if (!referenced) return []
        const name = `${LOOK_PREFIX}${referenced}`
        if (!styles.has(name)) {
          const layer = imageLayer(pkg, theme, parseSsfImage(fieldOf(skin, keyDocument, referenced, "NORMAL")))
          if (!layer) return []
          styles.set(name, { normal: [layer] })
        }
        return [name]
      })
      if (fore.length) key.style.fore = fore
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

export const ssfFormat: SkinFormat<SsfSource> = {
  name: "ssf",
  capabilities: capabilities(),
  derive: { tolerance: 1 },
  async read(source, options?: ImportOptions) {
    const pkg = SsfPackage.fromFiles(source.files)
    const skeleton = ssfSkeleton(pkg, source.skeleton)
    const base = bdsSource(skeleton, { theme: source.theme, orientation: source.orientation })
    if (!base) throw new Error("搜狗骨架里没有主键盘布局")
    const model = await bdsFormat.read(base, options)
    model.meta.name = pkg.info.name || model.meta.name
    model.meta.author = pkg.info.author || model.meta.author
    model.meta.version = pkg.info.version || model.meta.version
    model.provenance = { format: "ssf", nodes: new Map() }
    applyLook(
      model,
      pkg,
      pkg.skin(source.theme),
      pkg.keys(source.theme),
      skeletonSections(skeleton, base.layout),
      source.orientation === "land",
      source.theme,
    )
    return model
  },
  write(model, source) {
    if (!source) throw new Error("搜狗写回需要原始包")
    const pkg = SsfPackage.fromFiles(source.files)
    const skin = pkg.skin(source.theme)
    const keyDocument = pkg.keys(source.theme)
    const boxes = keyBoxes(model)
    for (const [name, style] of model.styles) {
      if (!name.startsWith("ssf:")) continue
      const section = name.slice(4)
      if (!skin.sections().includes(section) && !keyDocument.sections().includes(section)) continue
      const image = style.normal.find((layer): layer is Extract<SkinLayer, { kind: "image" }> => layer.kind === "image")
      const color = style.normal.find((layer): layer is Extract<SkinLayer, { kind: "color" }> => layer.kind === "color")
      const text = style.normal.find((layer): layer is Extract<SkinLayer, { kind: "text" }> => layer.kind === "text")
      const target = skin.sections().includes(section) ? skin : keyDocument
      const field = target === keyDocument ? "FG_IMAGES" : "NORMAL"
      if (image) target.set(section, field, image.file.split("/").pop() ?? image.file)
      if (color) target.set(section, "BG_COLOR", color.value)
      if (text?.style.color) target.set(section, "TEXT_COLOR", text.style.color)
    }
    void boxes
    const files = new Map(source.files)
    files.set(`${pkg.folder(source.theme)}phoneSkin.ini`, new TextEncoder().encode(skin.toString()))
    files.set(`${pkg.folder(source.theme)}keys.ini`, new TextEncoder().encode(keyDocument.toString()))
    return { ...source, files }
  },
}
