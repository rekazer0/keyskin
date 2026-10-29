// Sogou phone skin → Baidu INI skin (BDS; BDI is the same tree packaged differently).
//
// Sogou skins carry no key geometry, so the official Baidu template provides every layout and the
// Sogou look (ssf-look.ts) is painted onto it as new single-image styles. Keys Sogou draws as text keep
// the template glyph, recoloured to the Sogou label colour. Day/night statuses become light/dark themes.

import { strToU8, zipSync } from "fflate"
import { IniDocument } from "../ini.ts"
import { SkinArchive } from "../skin.ts"
import { SsfBaiduMotion } from "./ssf-anim-to-baidu.ts"
import { cached, fingerprint } from "./ssf-cache.ts"
import { SsfLook, type LookColors, type LookImage, type LookPair, type LookText } from "./ssf-look.ts"
import type { SsfPackage, SsfTheme } from "./ssf-package.ts"
import { copySsfSkeleton, ssfSkeletonScale } from "./ssf-skeleton.ts"
import { cropImage, decodePng, encodePng, isPng, pngSize, tintImage, whiteMask, type RgbaImage } from "./ssf-png.ts"

export type SsfConversion = { archive: SkinArchive; warnings: string[] }

function tile(width: number, height: number, stretch?: LookImage["stretch"]): Uint8Array {
  const inner = stretch && stretch[1] <= width && stretch[3] <= height
    ? [`INNER_RECT=${stretch[0]},${stretch[2]},${stretch[1] - stretch[0]},${stretch[3] - stretch[2]}`]
    : []
  return strToU8(["[GLOBAL]", "TILE_NUM=1", "", "[IMG1]", `SOURCE_RECT=0,0,${width},${height}`, ...inner, ""].join("\n"))
}

function numbers(value: string | undefined): number[] {
  return value?.split(",").map((part) => Number(part.trim())) ?? []
}

/** One theme's `res/` folder and `default.css` being written. */
class ThemeResources {
  readonly styles: IniDocument
  private readonly theme: SsfTheme
  private readonly output: Map<string, Uint8Array>
  private nextStyle: number
  private nextImage = 1
  private readonly images = new Map<string, string>()
  private readonly animations = new Map<number, string>()

  constructor(theme: SsfTheme, output: Map<string, Uint8Array>, css: string, scale = 1) {
    this.theme = theme
    this.output = output
    this.styles = IniDocument.parse(css)
    if (scale !== 1) for (const { section, key, value } of this.styles.entries()) {
      if (key === "FONT_SIZE") this.styles.set(section, key, String(Math.round(Number(value) * scale)))
    }
    const used = this.styles.sections().flatMap((section) => {
      const id = section.match(/^STYLE(\d+)$/)?.[1]
      return id ? [Number(id)] : []
    })
    this.nextStyle = Math.max(1000, ...used) + 1
  }

  private addStyle(entries: Array<{ key: string; value: string }>): string {
    const id = String(this.nextStyle++)
    this.styles.appendSection(`STYLE${id}`, entries)
    return id
  }

  /** Writes a standalone png + til pair once per distinct image and returns its resource name. */
  resource(image: LookImage): string {
    let name = this.images.get(image.id)
    if (!name) {
      const size = pngSize(image.bytes)
      if (!size) throw new Error(`${image.id} 不是有效的 PNG`)
      name = `ssf${this.nextImage++}`
      this.output.set(`${this.theme}/skin/res/${name}.png`, image.bytes)
      this.output.set(`${this.theme}/skin/res/${name}.til`, tile(size[0], size[1], image.stretch))
      this.images.set(image.id, name)
    }
    return name
  }

  imageStyle(pair: LookPair): string {
    return this.addStyle([
      { key: "NM_IMG", value: `${this.resource(pair.normal)},1` },
      { key: "HL_IMG", value: `${this.resource(pair.pressed)},1` },
    ])
  }

  colorStyle(normal: string, pressed = normal): string {
    return this.addStyle([{ key: "NM_COLOR", value: normal }, { key: "HL_COLOR", value: pressed }])
  }

  /** A style that plays anim.ini's `animation` on press, for a key's BACK_ANIM_STYLE / FORE_ANIM_STYLE. */
  animationStyle(animation: number): string {
    let style = this.animations.get(animation)
    if (!style) {
      style = this.addStyle([{ key: "PRESS_ANIM", value: String(animation) }])
      this.animations.set(animation, style)
    }
    return style
  }

  soundStyle(filename: string): string {
    return this.addStyle([{ key: "PRESS_SOUND_PATH", value: filename }])
  }

  /** Copies a template style with some fields replaced, so fonts and sizes survive recolouring. */
  derivedStyle(templateID: string, overrides: Record<string, string>): string {
    const entries = this.styles.entries(`STYLE${templateID}`)
      .filter((entry) => !(entry.key in overrides))
      .map(({ key, value }) => ({ key, value }))
    return this.addStyle([...entries, ...Object.entries(overrides).map(([key, value]) => ({ key, value }))])
  }

  css(): Uint8Array {
    const count = String(this.styles.sections().filter((section) => /^STYLE\d+$/.test(section)).length)
    if (this.styles.sections().includes("GLOBAL")) this.styles.set("GLOBAL", "STYLE_NUM", count)
    else this.styles.appendSection("GLOBAL", [{ key: "STYLE_NUM", value: count }])
    return strToU8(this.styles.toString())
  }
}

/** Converts one Sogou theme onto copies of the template's `light/skin` tree. */
class ThemeConverter {
  private readonly look: SsfLook
  private readonly base: SkinArchive
  private readonly theme: SsfTheme
  private readonly output: Map<string, Uint8Array>
  private readonly resources: ThemeResources
  private readonly motion?: SsfBaiduMotion
  private readonly warnings: string[]
  private readonly panelWidth?: number
  private readonly soundStyles = new Map<string, string>()
  private readonly glyphs = new Map<string, RgbaImage>()
  private keyboardStyles?: { panel?: string; cand?: string; input?: string }
  /** BDI: iOS types into a row inside the keyboard, which takes Sogou's pinyin bar. */
  private readonly inlineInput: boolean
  /** Style of the Sogou keyboard background for the orientation being written, if the skin has one. */
  private panelStyle?: string

  constructor(pkg: SsfPackage, base: SkinArchive, theme: SsfTheme, output: Map<string, Uint8Array>, warnings: string[], panelWidth?: number, inlineInput = false) {
    this.panelWidth = panelWidth
    this.inlineInput = inlineInput
    const panel = base.isText("light/skin/port/gen.ini") ? IniDocument.parse(base.getText("light/skin/port/gen.ini")).get("PANEL", "SIZE") : undefined
    const width = panelWidth || numbers(panel)[0] || 480
    this.look = new SsfLook(pkg, theme, warnings, width)
    this.base = base
    this.theme = theme
    this.output = output
    this.warnings = warnings
    this.resources = new ThemeResources(theme, output, base.getText("light/skin/res/default.css"), ssfSkeletonScale(base, panelWidth).text)
    this.motion = SsfBaiduMotion.of(pkg, theme, this.look, width / (Number(pkg.resolution) || 1080), (image) => this.resources.imageStyle({ normal: image, pressed: image }))
  }

  /**
   * Template glyph slices recoloured to the Sogou label colour, for keys Sogou draws as text; a text
   * style also takes the skin's `show` text, size, typeface and weight.
   */
  private tintedTemplateStyle(styleID: string, colors: LookColors | undefined, white = false, show?: string, text?: LookText): string | undefined {
    const value = this.resources.styles.get(`STYLE${styleID}`, "NM_IMG")
    const [imageName, tileValue] = value?.split(",").map((part) => part.trim()) ?? []
    if (!imageName || !tileValue) {
      const overrides = {
        ...colors ? { NM_COLOR: colors.normal, HL_COLOR: colors.pressed } : {},
        ...show ? { SHOW: show } : {},
        ...this.textFields(text),
      }
      return this.resources.styles.sections().includes(`STYLE${styleID}`) && Object.keys(overrides).length
        ? this.resources.derivedStyle(styleID, overrides)
        : undefined
    }
    if (!colors) return
    const atlasBytes = this.base.getBytes(`light/skin/res/${imageName}.png`)
    const tilePath = `light/skin/res/${imageName}.til`
    const source = numbers(this.base.isText(tilePath) ? IniDocument.parse(this.base.getText(tilePath)).get(`IMG${tileValue}`, "SOURCE_RECT") : undefined)
    if (!atlasBytes || !isPng(atlasBytes) || source.length !== 4) return
    const atlas = () => {
      if (!this.glyphs.has(imageName)) this.glyphs.set(imageName, decodePng(atlasBytes))
      return this.glyphs.get(imageName)!
    }
    const tinted = (color: string): LookImage | undefined => {
      const id = `tint:${source.join(",")}:${color}:${white}|${fingerprint(atlasBytes)}`
      return cached(id, () => {
        const glyph = cropImage(atlas(), source[0], source[1], source[2], source[3])
        return { id, bytes: encodePng(tintImage(white ? whiteMask(glyph) : glyph, color)) }
      })
    }
    const normal = tinted(colors.normal)
    const pressed = tinted(colors.pressed)
    return normal && pressed ? this.resources.imageStyle({ normal, pressed }) : undefined
  }

  /** Baidu style fields for a Sogou text look; the typeface file is copied next to the styles. */
  private textFields(text: LookText | undefined): Record<string, string> {
    if (!text) return {}
    if (text.font) this.output.set(`${this.theme}/skin/res/${text.font.name}`, text.font.bytes)
    return {
      ...text.fontSize ? { FONT_SIZE: String(text.fontSize) } : {},
      ...text.font ? { FONT_NAME: text.font.name } : {},
      // Baidu styles have no weight; the preview reads this and the export strips it with the other SSF_ fields.
      ...text.bold ? { SSF_BOLD: "1" } : {},
    }
  }

  private soundStyle(sound: { filename: string; bytes: Uint8Array } | undefined): string | undefined {
    if (!sound) return
    let style = this.soundStyles.get(sound.filename)
    if (!style) {
      this.output.set(`${this.theme}/skin/res/${sound.filename}`, sound.bytes)
      style = this.resources.soundStyle(sound.filename)
      this.soundStyles.set(sound.filename, style)
    }
    return style
  }

  /** `panel` is gen.ini's keyboard size, for boards that do not set their own. */
  private convertKeys(layout: IniDocument, layoutName: string, landscape: boolean, panel: number[]): void {
    const own = numbers(layout.get("PANEL", "SIZE"))
    const [boardWidth, boardHeight] = own.length === 2 ? own : panel
    const board = { width: boardWidth, height: boardHeight }
    for (const section of layout.sections().filter((name) => /^KEY\d+$/.test(name))) {
      const action = layout.get(section, "CENTER")?.trim()
      if (!action) continue
      const [, , width, height] = numbers(layout.get(section, "VIEW_RECT"))
      const look = this.look.key(layoutName, action, landscape, width > 0 && height > 0 ? [width, height] : undefined, layout.get(section, "SSF_SECTION"), layout.get(section, "SSF_BG"))
      if (look.back) layout.set(section, "BACK_STYLE", this.resources.imageStyle(look.back))
      if (look.fore) {
        layout.set(section, "FORE_STYLE", this.resources.imageStyle(look.fore))
        layout.remove(section, "FORE_OFFSET")
        layout.remove(section, "POS_TYPE")
      } else if (look.label || look.labelText) {
        const templateFore = layout.get(section, "FORE_STYLE")?.split(",").map((value) => value.trim()).filter(Boolean)
        // The size is the main label's; a second layer (中/英's 英) keeps its own smaller size.
        const text = (index: number) => look.labelText && (index ? { ...look.labelText, fontSize: undefined } : look.labelText)
        if (templateFore?.length) layout.set(section, "FORE_STYLE", templateFore.map((id, index) => this.tintedTemplateStyle(id, look.label, false, look.texts[index], text(index)) ?? id).join(","))
      }
      const sound = this.soundStyle(this.look.sound(look.binding))
      if (sound) layout.set(section, "SOUND_STYLE", sound)
      const press = this.motion && width > 0 && height > 0 && boardWidth > 0 && boardHeight > 0 ? this.motion.press(look.binding, { width, height }, board) : {}
      if (press.back) layout.set(section, "BACK_ANIM_STYLE", this.resources.animationStyle(press.back))
      if (press.fore) layout.set(section, "FORE_ANIM_STYLE", this.resources.animationStyle(press.fore))
    }
  }

  private convertLists(layout: IniDocument): void {
    for (const section of layout.sections().filter((name) => /^LIST\d*$/.test(name))) {
      const list = this.look.list(layout.get(section, "SSF_TEXT_STYLE"))
      const back = list.back && this.resources.imageStyle(list.back)
      const cell = list.cell && this.resources.imageStyle(list.cell)
      if (back && layout.get(section, "BACK_STYLE")) layout.set(section, "BACK_STYLE", back)
      if (cell && layout.get(section, "CELL_STYLE")) layout.set(section, "CELL_STYLE", cell)
      const fore = layout.get(section, "FORE_STYLE")?.trim()
      if (fore) layout.set(section, "FORE_STYLE", this.resources.derivedStyle(fore, {
        ...(list.text ? { NM_COLOR: list.text, HL_COLOR: list.text } : {}),
        ...this.textFields(list),
      }))
    }
  }

  private keyboard(): { panel?: string; cand?: string; input?: string } {
    if (!this.keyboardStyles) {
      const { panel, cand, panelColor } = this.look.keyboard()
      const input = this.inlineInput ? this.look.inputBar() : undefined
      const bar = input && cand ? this.look.stackedCandidate(input, cand) ?? cand : cand
      this.keyboardStyles = {
        panel: panel ? this.resources.imageStyle({ normal: panel, pressed: panel }) : panelColor ? this.resources.colorStyle(panelColor) : undefined,
        cand: bar ? this.resources.imageStyle({ normal: bar, pressed: bar }) : undefined,
        input: input ? this.resources.imageStyle({ normal: input, pressed: input }) : undefined,
      }
    }
    return this.keyboardStyles
  }

  private convertGeneral(gen: IniDocument, orientation: string): void {
    const { panel, cand, input } = this.keyboard()
    this.panelStyle = panel
    if (panel) gen.set("PANEL", "BACK_STYLE", panel)
    if (input && gen.sections().includes("SCAND")) gen.set("SCAND", "BACK_STYLE", input)
    else if (input) gen.appendSection("SCAND", [{ key: "BACK_STYLE", value: input }])
    const defaultSound = this.soundStyle(this.look.sound(undefined))
    if (defaultSound) gen.set("PANEL", "SOUND_STYLE", defaultSound)

    const composing = this.look.color("ComposingView", "BG_COLOR")
    if (composing && gen.get("INPUT", "BACK_STYLE")) gen.set("INPUT", "BACK_STYLE", this.resources.colorStyle(composing))
    // Sogou colours the code it shows in the pinyin bar with the bar's own colour.
    const composingText = (this.inlineInput ? this.look.color("VPA_Bar", "COMPOSING_TEXT_COLOR") : undefined) ?? this.look.color("TextStyle_Composing")
    const inputFore = gen.get("INPUT", "FORE_STYLE")?.trim()
    const inputFields = {
      ...composingText ? { NM_COLOR: composingText, HL_COLOR: composingText } : {},
      ...this.textFields(this.look.textStyle("TextStyle_Composing")),
    }
    if (inputFore && Object.keys(inputFields).length) gen.set("INPUT", "FORE_STYLE", this.resources.derivedStyle(inputFore, inputFields))

    const candName = gen.get("CAND", "LAYOUT_NAME")?.trim()
    const candPath = candName && `${this.theme}/skin/${orientation}/${candName}.cnd`
    const candBytes = candPath && this.output.get(candPath)
    if (!candPath || !candBytes) return
    const candidates = IniDocument.parse(new TextDecoder().decode(candBytes))
    const text = this.look.color("TextStyle_Candidate")
    const highlight = this.look.color("TextStyle_Candidate_Highlight") ?? text
    const candidateFields = {
      ...text && highlight ? { NM_COLOR: text, HL_COLOR: highlight } : {},
      ...this.textFields(this.look.textStyle("TextStyle_Candidate")),
    }
    for (const section of ["CAND", "TAB"]) {
      if (cand && candidates.get(section, "BACK_STYLE")) candidates.set(section, "BACK_STYLE", cand)
      const fore = candidates.get(section, "FORE_STYLE")?.trim()
      if (fore && Object.keys(candidateFields).length) candidates.set(section, "FORE_STYLE", this.resources.derivedStyle(fore, candidateFields))
    }
    for (const field of ["NML_FONT_STYLE", "SEL_FONT_STYLE"]) {
      const fore = candidates.get("SWITCH", field)?.trim()
      if (text && highlight && fore) candidates.set("SWITCH", field, this.resources.derivedStyle(fore, { NM_COLOR: text, HL_COLOR: highlight }))
    }
    // Sogou recolours the built-in toolbar icons a skin does not replace with its function icon colour.
    const iconColor = this.look.color("CandidateIMEFunctionView", "ICON_COLOR") ?? this.look.color("General", "ICON_COLOR")
    for (const section of candidates.sections().filter((name) => /^ICON\d+$/.test(name))) {
      const name = candidates.get(section, "SSF_IMAGE")?.trim() ?? ""
      const icon = this.look.toolbarIcon(name)
      const fore = candidates.get(section, "FORE_STYLE")?.trim()
      if (icon) candidates.set(section, "FORE_STYLE", this.resources.imageStyle(icon))
      else if (iconColor && fore) candidates.set(section, "FORE_STYLE", this.tintedTemplateStyle(fore, { normal: iconColor, pressed: iconColor }, name === "logo.png") ?? fore)
    }
    this.output.set(candPath, strToU8(candidates.toString()))
  }

  convert(): void {
    copySsfSkeleton(this.base, this.theme, this.output, this.panelWidth)
    for (const orientation of ["port", "land"] as const) {
      const genPath = `${this.theme}/skin/${orientation}/gen.ini`
      const genBytes = this.output.get(genPath)
      if (!genBytes) continue
      const gen = IniDocument.parse(new TextDecoder().decode(genBytes))
      this.convertGeneral(gen, orientation)
      this.output.set(genPath, strToU8(gen.toString()))
      for (const path of [...this.output.keys()]) {
        const match = path.match(new RegExp(`^${this.theme}/skin/${orientation}/([^/]+)\\.ini$`))
        if (!match || match[1] === "gen") continue
        const layout = IniDocument.parse(new TextDecoder().decode(this.output.get(path)!))
        this.convertKeys(layout, match[1], orientation === "land", numbers(gen.get("PANEL", "SIZE")))
        this.convertLists(layout)
        // Sogou paints one background behind every board, while the Baidu skeleton gives each board its own.
        if (this.panelStyle && layout.sections().includes("PANEL")) layout.set("PANEL", "BACK_STYLE", this.panelStyle)
        this.output.set(path, strToU8(layout.toString()))
      }
    }
    const animations = this.motion?.ini()
    if (animations) this.output.set(`${this.theme}/skin/res/anim.ini`, strToU8(animations))
    if (this.motion?.throwsDecorations) this.warnings.push("按键动画中飞出的装饰图已转为百度粒子动效，随机位置与抛物轨迹为近似效果")
    this.output.set(`${this.theme}/skin/res/default.css`, this.resources.css())
  }
}

function infoText(base: SkinArchive, pkg: SsfPackage): Uint8Array {
  const template = base.isText("Info.txt") ? base.getText("Info.txt") : ""
  const lines = template.split(/\r?\n/)
    .map((line) => line.replace(/^﻿/, ""))
    .filter((line) => line && !/^(Name|Author|SupportDarkMode|VersionCode)=/i.test(line))
  lines.unshift(`Name=${pkg.info.name}`)
  if (pkg.info.author) lines.push(`Author=${pkg.info.author}`)
  if (pkg.themes.has("dark")) lines.push("SupportDarkMode=1")
  return strToU8(`${lines.join("\n")}\n`)
}

/** Warnings for Sogou features no Baidu format has; shared with the BDA writer. */
export function ssfUnsupportedWarnings(pkg: SsfPackage): string[] {
  return [...pkg.files.keys()].some((name) => /\.webp$/i.test(name)) ? ["开屏动画和动态背景（webp）在百度皮肤中没有对应，已忽略"] : []
}

export function ssfPreview(pkg: SsfPackage): Uint8Array | undefined {
  const preview = pkg.files.get("square_preview.png") ?? pkg.files.get("candidate_preview.png")
  return preview && isPng(preview) ? preview : undefined
}

/**
 * A Sogou skin laid out on `base` (the Sogou BDS skeleton), as canonical package paths
 * (`light/skin/…`, `Info.txt`) before packaging; the editor previews an SSF document from these.
 */
export function ssfToBaiduFiles(pkg: SsfPackage, base: SkinArchive, panelWidth?: number, format: "bdi" | "bds" = "bds"): { files: Map<string, Uint8Array>; warnings: string[] } {
  if (base.format === "bda") throw new Error("搜狗皮肤只能套用 BDS/BDI 模板")
  if (!base.isText("light/skin/res/default.css")) throw new Error("模板缺少 res/default.css")
  const warnings = [...pkg.warnings]
  const files = new Map<string, Uint8Array>()
  for (const theme of pkg.themes.keys()) new ThemeConverter(pkg, base, theme, files, warnings, panelWidth, format === "bdi").convert()
  files.set("Info.txt", infoText(base, pkg))
  const preview = ssfPreview(pkg)
  if (preview) files.set("demo.png", preview)
  warnings.push(...ssfUnsupportedWarnings(pkg))
  return { files, warnings: [...new Set(warnings)] }
}

/** Converts a Sogou skin to a Baidu BDS archive laid out on `base` (the Sogou BDS skeleton); `bdi` lays it out for iOS. */
export function convertSsfToBaidu(pkg: SsfPackage, base: SkinArchive, panelWidth?: number, format: "bdi" | "bds" = "bds"): SsfConversion {
  const { files, warnings } = ssfToBaiduFiles(pkg, base, panelWidth, format)
  const dual = pkg.themes.size > 1
  const raw = Object.fromEntries([...files].map(([path, bytes]) => {
    if (path === "Info.txt" || path === "demo.png") return [path, bytes]
    if (/\.(?:ini|cnd|css)$/i.test(path)) {
      const document = IniDocument.parse(new TextDecoder().decode(bytes))
      const metadata = document.entries().filter(({ key }) => key.startsWith("SSF_"))
      for (const { section, key } of metadata) document.remove(section, key)
      if (metadata.length) bytes = strToU8(document.toString())
    }
    const themed = path.match(/^(light|dark)\/skin\/(.*)$/)!
    return [dual ? `${themed[1]}/${themed[2]}` : themed[2], bytes]
  }))
  return { archive: SkinArchive.open(zipSync(raw, { level: 6 }), "bds"), warnings }
}
