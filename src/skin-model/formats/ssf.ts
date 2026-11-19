// 搜狗手机皮肤（SSF）转换器。
//
// 搜狗皮肤只描述"长什么样"，不含按键几何：几何来自搜狗官方的骨架布局。因此读取路径是
// 骨架（几何、内置标签、默认动作）叠加皮肤自己的样式与前景；写回只写皮肤自己的段，不动骨架。
import { IniDocument } from "@/ini.ts"
import { decodePng, encodePng } from "@/raster.ts"
import { ssfKeyBinding } from "@/ssf/ssf-keymap.ts"
import { SsfPackage, parseSsfImage, ssfColor, type SsfImageRef, type SsfTheme } from "@/ssf/ssf-package.ts"
import { ssfSkeleton } from "@/ssf/ssf-convert.ts"
import type { SkinArchive } from "@/skin.ts"
import type { Capability, CapabilityLevel } from "@/skin-model/capability.ts"
import { bdsFormat, bdsSource, layoutText } from "@/skin-model/formats/bds.ts"
import { buildBoard } from "@/skin-model/build.ts"
import { ssfAnimationOf } from "@/skin-model/formats/ssf-motion.ts"
import type { ImportOptions, SkinFormat } from "@/skin-model/format.ts"
import type { SkinModel } from "@/skin-model/model.ts"
import type { SkinImage } from "@/skin-model/image.ts"
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
function imageLayer(
  pkg: SsfPackage,
  images: Map<string, SkinImage>,
  theme: SsfTheme,
  ref: SsfImageRef | undefined,
): SkinLayer | undefined {
  if (!ref) return
  const path = pkg.path(theme, ref.file)
  if (!path) return
  if (!images.has(path)) {
    const bytes = pkg.file(theme, ref.file)
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
  pkg: SsfPackage,
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
  const back = imageLayer(pkg, images, theme, parseSsfImage(imageRead("NORMAL")))
  if (back) normal.push(back)
  const color = ssfColor(read("BG_COLOR"))
  if (!back && color) normal.push({ kind: "color", value: color })
  const textColor = ssfColor(read("TEXT_COLOR"))
  if (textColor) {
    const fontSize = Number(read("FONT_SIZE"))
    normal.push({ kind: "text", style: { color: textColor, ...(Number.isFinite(fontSize) && fontSize > 0 ? { fontSize } : {}) } })
  }
  const icon = imageLayer(pkg, images, theme, parseSsfImage(read("ICON")))
  if (icon) normal.push(icon)
  const foregroundSection = imageSectionName(fieldOf(skin, keyDocument, section, "FG_IMAGES"))
  if (foregroundSection) {
    const foreground = imageLayer(pkg, images, theme, parseSsfImage(fieldOf(skin, keyDocument, foregroundSection, "NORMAL")))
    if (foreground) normal.push(foreground)
  }
  if (!normal.length) return
  const pressedColor = ssfColor(read("TEXT_COLOR_PRESSED"))
  const pressedImage = imageLayer(pkg, images, theme, parseSsfImage(imageRead("PRESSED")))
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
  pkg: SsfPackage,
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
      const style = styleOf(pkg, images, theme, skin, keyDocument, section)
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
          const layer = imageLayer(pkg, images, theme, parseSsfImage(fieldOf(skin, keyDocument, referenced, "NORMAL")))
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

export const ssfFormat: SkinFormat<SsfSource> = {
  name: "ssf",
  capabilities: capabilities(),
  derive: { tolerance: 1 },
  async read(source, options?: ImportOptions) {
    if (!source.skeleton) throw new Error("读取搜狗皮肤需要官方骨架")
    const pkg = SsfPackage.fromFiles(source.files)
    const skeleton = ssfSkeleton(pkg, source.skeleton)
    const base = bdsSource(skeleton, { theme: source.theme, orientation: source.orientation })
    if (!base) throw new Error("搜狗骨架里没有主键盘布局")
    const model = await bdsFormat.read(base, options)
    model.meta.name = pkg.info.name || model.meta.name
    model.meta.author = pkg.info.author || model.meta.author
    model.meta.version = pkg.info.version || model.meta.version
    model.provenance = { format: "ssf", nodes: new Map() }
    const images = new Map(model.images)
    applyLook(
      model,
      pkg,
      images,
      pkg.skin(source.theme),
      pkg.keys(source.theme),
      skeletonSections(skeleton, base.layout),
      source.orientation === "land",
      source.theme,
    )
    model.images = images
    // 音效与字体是包里的文件，字节要进模型，导出才能脱离源包。
    const resources = new Map(model.resources)
    for (const [path, data] of source.files) {
      if (/\.(?:mp3|ogg|wav|m4a)$/i.test(path)) resources.set(path, { kind: "audio", path, data })
      else if (/\.(?:ttf|otf|ttc)$/i.test(path)) resources.set(path, { kind: "font", path, data })
    }
    model.resources = resources
    return model
  },
  async write(model) {
    const resolution = String(model.meta.resolution?.width || 1080)
    const text = (value: string) => new TextEncoder().encode(value)
    // 只写模型里有的东西：图片按资源表重写，布局与动效按板与动效重建。
    const files = new Map<string, Uint8Array>()
    // 音效与字体从模型写回；没有字节的说明源包里就没有。
    for (const resource of model.resources.values()) {
      if (resource.data) files.set(resource.path, resource.data)
    }
    const name = (image: string) => image.split("/").pop() ?? image
    const themeLines = ["[General]", "skin_type=1", `skin_name=${model.meta.name ?? "皮肤"}`, `skin_author=${model.meta.author ?? ""}`, `skin_version=${model.meta.version ?? ""}`, ""]
    files.set("phoneTheme.ini", text(themeLines.join("\n")))
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
    files.set(`${resolution}/phoneSkin.ini`, text(skinLines.join("\n")))
    files.set(`${resolution}/keys.ini`, text(keyLines.join("\n")))
    for (const [id, image] of model.images) files.set(`${resolution}/${name(id)}`, encodePng(image))
    // 搜狗包必须自带键盘布局：输入法按布局画键，缺了就是一片空白。
    for (const board of model.boards) {
      const renders = await buildBoard(model, board)
      files.set(`${resolution}/${boardName(board.id)}.ini`, text(layoutText(board, renders)))
      // 动效经百度风格的动画段转成搜狗的 anim.ini；转换不了的会进 warnings。
      const animated = ssfAnimationOf(model, board, model.images)
      if (animated.animation) files.set(`${resolution}/anim.ini`, text(animated.animation.toString()))
    }
    // 搜狗包里的旧散图不再保留：要么已被上面重写，要么属于骨架而不属于这套皮肤。
    const kept = [...files].map(([path, data]) => ({ path, data }))
    return {
      files: new Map(kept.map((file) => [file.path, file.data])),
      theme: model.meta.appearance === "dark" ? "dark" : "light",
      orientation: model.boards[0]?.orientation ?? model.meta.orientation ?? "port",
    }
  },
}
