// Sogou phone skin → Baidu INI skin (BDS; BDI is the same tree packaged differently).
//
// Sogou skins carry no key geometry, so the official Baidu template provides every layout and the
// Sogou look (ssf-look.ts) is painted onto it as new single-image styles. Keys Sogou draws as text keep
// the template glyph, recoloured to the Sogou label colour. Day/night statuses become light/dark themes.

import { strFromU8, strToU8 } from "fflate"
import { adaptBdiPanels } from "../bdi-panel-export.ts"
import type { TileRect } from "../tiles.ts"
import { IniDocument } from "../ini.ts"
import { SkinArchive } from "../skin.ts"
import { SsfBaiduMotion } from "./ssf-anim-to-baidu.ts"
import { SsfBaiduImages } from "./ssf-baidu-images.ts"
import { cached, fingerprint } from "./ssf-cache.ts"
import { ssfQwerty } from "./ssf-keymap.ts"
import { SsfLook, type LookColors, type LookImage, type LookPair, type LookText } from "./ssf-look.ts"
import type { SsfPackage, SsfTheme } from "./ssf-package.ts"
import { copySsfSkeleton, ssfSkeletonScale } from "./ssf-skeleton.ts"
import { cropImage, decodePng, encodePng, isPng, pngSize, tintImage, whiteMask, type RgbaImage } from "./ssf-png.ts"

export type SsfConversion = { archive: SkinArchive; warnings: string[] }

function numbers(value: string | undefined): number[] {
  return value?.split(",").map((part) => Number(part.trim())) ?? []
}

/** One theme's `res/` folder and `default.css` being written. */
class ThemeResources {
  readonly styles: IniDocument
  private nextStyle: number
  readonly images: SsfBaiduImages
  private readonly styleIDs = new Map<string, string>()

  constructor(theme: SsfTheme, output: Map<string, Uint8Array>, css: string, scale = 1) {
    this.styles = IniDocument.parse(css)
    this.images = new SsfBaiduImages(output, `${theme}/skin/res/`)
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
    const signature = JSON.stringify([...entries].sort((a, b) => a.key.localeCompare(b.key)).map(({ key, value }) => [key, value]))
    const reused = this.styleIDs.get(signature)
    if (reused) return reused
    const id = String(this.nextStyle++)
    this.styleIDs.set(signature, id)
    this.styles.appendSection(`STYLE${id}`, entries)
    return id
  }

  imageStyle(pair: LookPair, back = false): string {
    return this.addStyle([
      { key: "NM_IMG", value: this.images.reference(pair.normal, back) },
      { key: "HL_IMG", value: this.images.reference(pair.pressed, back) },
    ])
  }

  colorStyle(normal: string, pressed = normal): string {
    return this.addStyle([{ key: "NM_COLOR", value: normal }, { key: "HL_COLOR", value: pressed }])
  }

  /** A style that plays anim.ini's `animation` on press, for a key's BACK_ANIM_STYLE / FORE_ANIM_STYLE. */
  animationStyle(animation: number): string {
    return this.addStyle([{ key: "PRESS_ANIM", value: String(animation) }])
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

  css(used?: ReadonlySet<string>): Uint8Array {
    const sections = this.styles.sections().filter((section) => /^STYLE\d+$/.test(section))
    if (used) this.styles.removeSections(sections.filter((section) => !used.has(section.slice(5))))
    const count = String(used ? sections.reduce((max, section) => used.has(section.slice(5)) ? Math.max(max, Number(section.slice(5))) : max, 0) : sections.length)
    if (this.styles.sections().includes("GLOBAL")) this.styles.set("GLOBAL", "STYLE_NUM", count)
    else this.styles.appendSection("GLOBAL", [{ key: "STYLE_NUM", value: count }])
    return strToU8(this.styles.toString())
  }
}

/** Converts one Sogou theme onto copies of the template's `light/skin` tree. */
class ThemeConverter {
  private readonly look: SsfLook
  private readonly skin: IniDocument
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
  private readonly packKeys: boolean
  /** Style of the Sogou keyboard background for the orientation being written, if the skin has one. */
  private panelStyle?: string

  constructor(pkg: SsfPackage, base: SkinArchive, theme: SsfTheme, output: Map<string, Uint8Array>, warnings: string[], panelWidth?: number, inlineInput = false, packKeys = false) {
    this.panelWidth = panelWidth
    this.inlineInput = inlineInput
    this.packKeys = packKeys
    const panel = base.isText("light/skin/port/gen.ini") ? IniDocument.parse(base.getText("light/skin/port/gen.ini")).get("PANEL", "SIZE") : undefined
    const width = panelWidth || numbers(panel)[0] || 480
    this.look = new SsfLook(pkg, theme, warnings, width)
    this.skin = pkg.skin(theme)
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
  private tintedTemplateStyle(styleID: string, colors: LookColors | undefined, white = false, show?: string, text?: LookText, icons = colors, iconRect?: number[], size?: [number, number]): string | undefined {
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
    if (!icons && !iconRect) return
    const atlasBytes = this.base.getBytes(`light/skin/res/${imageName}.png`)
    const tilePath = `light/skin/res/${imageName}.til`
    const source = numbers(this.base.isText(tilePath) ? IniDocument.parse(this.base.getText(tilePath)).get(`IMG${tileValue}`, "SOURCE_RECT") : undefined)
    if (!atlasBytes || !isPng(atlasBytes) || source.length !== 4) return
    const atlas = () => {
      if (!this.glyphs.has(imageName)) this.glyphs.set(imageName, decodePng(atlasBytes))
      return this.glyphs.get(imageName)!
    }
    const tinted = (color: string | undefined): LookImage | undefined => {
      const id = `tint:${source.join(",")}:${color}:${white}|${fingerprint(atlasBytes)}`
      return cached(id, () => {
        const glyph = cropImage(atlas(), source[0], source[1], source[2], source[3])
        return { id, bytes: encodePng(color ? tintImage(white ? whiteMask(glyph) : glyph, color) : glyph) }
      })
    }
    const normal = tinted(icons?.normal)
    const pressed = tinted(icons?.pressed)
    return normal && pressed ? this.resources.imageStyle(this.look.placeIcon({ normal, pressed }, iconRect, size)) : undefined
  }

  /** Baidu style fields for a Sogou text look; the typeface file is copied next to the styles. */
  private textFields(text: LookText | undefined): Record<string, string> {
    if (!text) return {}
    if (text.font) this.output.set(`${this.theme}/skin/res/${text.font.name}`, text.font.bytes)
    return {
      ...text.fontSize ? { FONT_SIZE: String(text.fontSize) } : {},
      ...text.font ? { FONT_NAME: text.font.name } : {},
      // 百度安卓不认字重，导出 BDS 时按它把按键文字切成图片（font-bake-export.ts）。
      ...text.bold ? { FONT_WEIGHT: "700" } : {},
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
    const keys = layout.sections().filter((section) => /^KEY\d+$/.test(section)).flatMap((section) => {
      const action = layout.get(section, "CENTER")?.trim()
      if (!action) return []
      const rect = numbers(layout.get(section, "VIEW_RECT")) as TileRect
      const [, , width, height] = rect
      const look = this.look.key(layoutName, action, landscape, width > 0 && height > 0 ? [width, height] : undefined, layout.get(section, "SSF_SECTION"), layout.get(section, "SSF_BG"), layout.get(section, "SSF_FG"))
      return [{ section, action, rect, look }]
    })
    if (this.packKeys) this.resources.images.plan(`${landscape ? "land" : "port"}_${layoutName}`, [boardWidth, boardHeight],
      keys.map(({ rect, look }) => ({ rect, back: look.back, fore: look.fore })))
    for (const { section, action, rect: [, , width, height], look } of keys) {
      if (look.back) layout.set(section, "BACK_STYLE", this.resources.imageStyle(look.back, this.packKeys))
      if (look.fore) {
        layout.set(section, "FORE_STYLE", this.resources.imageStyle(look.fore))
        layout.remove(section, "FORE_OFFSET")
        layout.remove(section, "POS_TYPE")
      } else if (look.label || look.labelText || look.icon || look.iconRect || look.visible.includes(false)) {
        const templateFore = layout.get(section, "FORE_STYLE")?.split(",").map((value) => value.trim()).filter(Boolean)
        // The size is the main label's; a second layer (中/英's 英) keeps its own smaller size.
        const text = (index: number) => look.labelText && (index ? { ...look.labelText, fontSize: undefined } : look.labelText)
        let labelIndex = 0
        const colors = (index: number) => look.visible[index] === false ? { normal: "00000000", pressed: "00000000" } : look.label
        if (templateFore?.length) {
          const offsets = (layout.get(section, "FORE_OFFSET") ?? "").split(";")
          layout.set(section, "FORE_STYLE", templateFore.map((id, index) => {
            const image = this.resources.styles.get(`STYLE${id}`, "NM_IMG")
            const label = image ? undefined : labelIndex++
            if (image && look.iconRect) offsets[index] = "0,0"
            return this.tintedTemplateStyle(id, label === undefined ? look.label : colors(label), false,
              label === undefined ? undefined : look.texts[label], label === undefined ? undefined : text(label),
              look.icon ?? look.label, look.iconRect, [width, height]) ?? id
          }).join(","))
          if (look.iconRect) layout.set(section, "FORE_OFFSET", offsets.join(";"))
        }
        else if ([...action].length === 1) {
          // Sogou runtime symbol keys have an action but no static foreground in the skeleton.
          layout.set(section, "FORE_STYLE", this.resources.derivedStyle("", {
            SHOW: look.texts[0] ?? action,
            FONT_SIZE: String(Math.max(1, Math.round(boardWidth * 0.055))),
            ...colors(0) ? { NM_COLOR: colors(0)!.normal, HL_COLOR: colors(0)!.pressed } : {},
            ...this.textFields(look.labelText),
          }))
        }
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

  private convertHint(orientation: string, qwerty: boolean): string {
    const name = qwerty ? "ssf_qwerty" : "ssf_phone"
    const path = `${this.theme}/skin/${orientation}/${name}.pop`
    if (this.output.has(path)) return name
    const look = this.look.popup(qwerty)
    const back = look.back ? this.resources.imageStyle(look.back) : this.resources.colorStyle(look.color)
    const width = this.panelWidth || numbers(IniDocument.parse(this.base.getText("light/skin/port/gen.ini")).get("PANEL", "SIZE"))[0] || 480
    const text = (colors: LookColors, label: LookText, fontSize: number) => this.resources.derivedStyle("", {
      NM_COLOR: colors.normal, HL_COLOR: colors.pressed, FONT_SIZE: String(Math.max(1, Math.round(fontSize))), ...this.textFields(label),
    })
    const [w, h] = look.size
    const [left, top, right, bottom] = look.labelBox
    // 长按栏只拉伸文字框内的横带，避免把气泡两侧的透明留白一起拉宽到文字下面。
    const barImage = (image: LookImage): LookImage => {
      const [width, height] = pngSize(image.bytes)!
      const start = Math.min(width - 1, Math.round(left * width))
      const end = Math.max(start + 1, Math.round(right * width))
      return { ...image, id: `${image.id}|popup-bar:${start},${end}`, stretch: [start, end, image.stretch?.[2] ?? 0, image.stretch?.[3] ?? height] }
    }
    const barBack = look.back ? this.resources.imageStyle({ normal: barImage(look.back.normal), pressed: barImage(look.back.pressed) }) : back
    const padding = [...look.padding]
    padding[0] = Math.max(padding[0], Math.round(left * w))
    padding[2] = Math.max(padding[2], Math.round((1 - right) * w))
    const hint = IniDocument.parse("[GLOBAL]\nICON_NUM=2\n[HINT]\nBACK_ICON=1\n[BAR]\nBACK_ICON=2\n[ICON1]\n[ICON2]\n")
    hint.set("ICON1", "BACK_STYLE", back)
    hint.set("ICON1", "FORE_STYLE", text(look.text, look.label, Math.min(width * 0.09, h * (bottom - top))))
    hint.set("ICON1", "SIZE", look.size.join(","))
    hint.set("ICON1", "POS", `0,${look.offset}`)
    hint.set("ICON1", "PADDING", [left * w, top * h, (1 - right) * w, (1 - bottom) * h].map(Math.round).join(","))
    hint.set("ICON2", "BACK_STYLE", barBack)
    hint.set("ICON2", "FORE_STYLE", text(look.hold, look.holdLabel, width * 0.05))
    hint.set("ICON2", "SIZE", look.size.join(","))
    hint.set("ICON2", "POS", `0,${look.offset}`)
    hint.set("ICON2", "PADDING", padding.join(","))
    hint.set("BAR", "CELL_SIZE", `${Math.max(1, Math.round(width / 14))},${Math.max(1, h - padding[1] - padding[3])}`)
    this.output.set(path, strToU8(hint.toString()))
    return name
  }

  private bindHint(layout: IniDocument, name: string): void {
    if (!layout.hasSection("HINT")) layout.appendSection("HINT", [])
    layout.set("HINT", "LAYOUT_NAME", name)
    layout.set("HINT", "TYPE", "0")
  }

  private keyboard(): { panel?: string; cand?: string; input?: string } {
    if (!this.keyboardStyles) {
      const gen = IniDocument.parse(this.base.getText("light/skin/port/gen.ini"))
      const height = numbers(gen.get("PANEL", "SIZE"))[1]
      const barHeight = numbers(gen.get("CAND", "VIEW_RECT"))[3]
      const { panel, cand, panelColor } = this.look.keyboard(this.panelWidth && height > 0 && barHeight > 0
        ? barHeight / (height + barHeight) : undefined)
      const input = this.inlineInput || !this.look.color("ComposingView", "BG_COLOR") ? this.look.inputBar() : undefined
      const bar = this.inlineInput && input && cand ? this.look.stackedCandidate(input, cand) ?? cand : cand
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
    if (this.inlineInput && input) {
      if (!gen.hasSection("SCAND")) gen.appendSection("SCAND", [])
      gen.set("SCAND", "BACK_STYLE", input)
    }
    const defaultSound = this.soundStyle(this.look.sound(undefined))
    if (defaultSound) gen.set("PANEL", "SOUND_STYLE", defaultSound)

    const composing = this.look.color("ComposingView", "BG_COLOR")
    const vpaColor = this.look.color("VPA_Bar", "BG_COLOR")
    const inputBack = composing ? this.resources.colorStyle(composing) : input ?? (vpaColor ? this.resources.colorStyle(vpaColor) : undefined)
    if (inputBack) {
      if (!gen.hasSection("INPUT")) gen.appendSection("INPUT", [])
      gen.set("INPUT", "BACK_STYLE", inputBack)
    }
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
    copySsfSkeleton(this.base, this.theme, this.output, this.panelWidth, this.skin)
    for (const orientation of ["port", "land"] as const) {
      const genPath = `${this.theme}/skin/${orientation}/gen.ini`
      const genBytes = this.output.get(genPath)
      if (!genBytes) continue
      const gen = IniDocument.parse(new TextDecoder().decode(genBytes))
      this.convertGeneral(gen, orientation)
      this.bindHint(gen, this.convertHint(orientation, false))
      this.output.set(genPath, strToU8(gen.toString()))
      const priority = (path: string) => /\/py_26\.ini$/.test(path) ? 0 : /\/py_9\.ini$/.test(path) ? 1 : 2
      const paths = [...this.output.keys()]
      if (this.packKeys) paths.sort((a, b) => priority(a) - priority(b))
      for (const path of paths) {
        const match = path.match(new RegExp(`^${this.theme}/skin/${orientation}/([^/]+)\\.ini$`))
        if (!match || match[1] === "gen") continue
        const layout = IniDocument.parse(new TextDecoder().decode(this.output.get(path)!))
        this.convertKeys(layout, match[1], orientation === "land", numbers(gen.get("PANEL", "SIZE")))
        this.convertLists(layout)
        this.bindHint(layout, this.convertHint(orientation, ssfQwerty(match[1])))
        // Sogou paints one background behind every board, while the Baidu skeleton gives each board its own.
        if (this.panelStyle && layout.sections().includes("PANEL")) layout.set("PANEL", "BACK_STYLE", this.panelStyle)
        this.output.set(path, strToU8(layout.toString()))
      }
    }
    const animations = this.motion?.ini()
    if (animations) this.output.set(`${this.theme}/skin/res/anim.ini`, strToU8(animations))
    if (this.motion?.throwsDecorations) this.warnings.push("按键动画中飞出的装饰图已转为百度粒子动效，随机位置与抛物轨迹为近似效果")
    // Only write styles actually reached from the converted layouts (including inherited and animation styles).
    const used = new Set<string>()
    if (this.packKeys) for (const [path, bytes] of this.output) {
      if (!path.startsWith(`${this.theme}/skin/`) || !/\.(?:ini|cnd|pop)$/i.test(path)) continue
      for (const { key, value } of IniDocument.parse(strFromU8(bytes)).entries()) {
        if (key === "STAT_STYLE" || !/(?:^|_)STYLE(?:_INDEX)?$|^FIRST_(?:BACK|FORE)$|^PARTICLE_IMAGE$/.test(key)) continue
        for (const token of value.split(/[,;]/)) {
          const id = token.trim()
          if (!/^\d+$/.test(id)) continue
          used.add(id)
          if (!this.resources.styles.hasSection(`STYLE${id}`)) used.add(String(Math.floor(Number(id) / 100)))
        }
      }
    }
    this.output.set(`${this.theme}/skin/res/default.css`, this.resources.css(this.packKeys ? used : undefined))
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
export function ssfToBaiduFiles(pkg: SsfPackage, base: SkinArchive, panelWidth?: number, format: "bdi" | "bds" = "bds", packKeys = false): { files: Map<string, Uint8Array>; warnings: string[] } {
  if (base.format === "bda") throw new Error("搜狗皮肤只能套用 BDS/BDI 模板")
  if (!base.isText("light/skin/res/default.css")) throw new Error("模板缺少 res/default.css")
  const warnings = [...pkg.warnings]
  const files = new Map<string, Uint8Array>()
  for (const theme of pkg.themes.keys()) new ThemeConverter(pkg, base, theme, files, warnings, panelWidth, format === "bdi", packKeys).convert()
  files.set("Info.txt", infoText(base, pkg))
  const preview = ssfPreview(pkg)
  if (preview) files.set("demo.png", preview)
  warnings.push(...ssfUnsupportedWarnings(pkg))
  return { files, warnings: [...new Set(warnings)] }
}

/** Converts a Sogou skin to a Baidu BDS archive laid out on `base` (the Sogou BDS skeleton); `bdi` lays it out for iOS. */
export function convertSsfToBaidu(pkg: SsfPackage, base: SkinArchive, panelWidth?: number, format: "bdi" | "bds" = "bds", packKeys = false): SsfConversion {
  const { files, warnings } = ssfToBaiduFiles(pkg, base, panelWidth, format, packKeys)
  if (format === "bds") adaptBdiPanels(files, warnings)
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
  return { archive: SkinArchive.fromFiles(new Map(Object.entries(raw)), "bds"), warnings }
}
