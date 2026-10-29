// What a Sogou theme shows for each Baidu key, as ready-to-write images and colours.
//
// Shared by the BDS/BDI writer (ssf-to-baidu.ts) and the BDA writer (ssf-to-bda.ts) so both read the
// Sogou skin the same way: a key's background comes from its class or the shared defaults, its
// foreground from keys.ini (FG_RECT baked in as transparent padding around the glyph) or from an
// icon centred on the background's canvas. BDS draws images at their own size in layout units, so its
// writer passes the panel width and the look shrinks Sogou pixels to match.

import type { IniDocument } from "../ini.ts"
import { ssfBoard, ssfKeyBinding, ssfQwerty, type SsfKeyBinding } from "./ssf-keymap.ts"
import { firstValue, ssfBackground, ssfForeground, ssfSoundSection, ssfTextSections } from "./ssf-parts.ts"
import { parseSsfImage, ssfColor, type SsfImageRef, type SsfPackage, type SsfStretch, type SsfTheme } from "./ssf-package.ts"
import { cached, fingerprint } from "./ssf-cache.ts"
import { MAX_PIXELS, compositeImage, cropImage, decodePng, encodePng, isPng, placeImage, pngSize, resizeImage, type RgbaImage } from "./ssf-png.ts"

/** `id` is stable for identical content, so writers can share one file per distinct image. */
export type LookImage = { id: string; bytes: Uint8Array; stretch?: SsfStretch }
export type LookPair = { normal: LookImage; pressed: LookImage }
export type LookColors = { normal: string; pressed: string }
/** Text size in target pixels, typeface file and weight, each only when the skin sets it. */
export type LookText = { fontSize?: number; font?: { name: string; bytes: Uint8Array }; bold?: boolean }
/** `texts` is the skin's own LABEL and MINOR_LABEL for keys Sogou draws as text. */
type KeyLook = { binding: SsfKeyBinding; back?: LookPair; fore?: LookPair; label?: LookColors; labelText?: LookText; texts: Array<string | undefined> }

type Foreground = { normal: string; pressed: string; rect?: number[] }

export class SsfLook {
  readonly theme: SsfTheme
  private readonly pkg: SsfPackage
  private readonly skin: IniDocument
  private readonly keys: IniDocument
  private readonly sounds: IniDocument
  private readonly warnings: string[]
  private readonly missing = new Set<string>()
  private readonly decoded = new Map<string, RgbaImage | undefined>()
  private keyboardCache?: { panel?: LookImage; cand?: LookImage; panelColor?: string }
  /** Screen width the Sogou images are drawn for (the resolution folder, 1080 by default). */
  private readonly sogouWidth: number
  /** Baidu layout units per Sogou pixel; unset keeps Sogou sizes. */
  private readonly scale?: number

  /** `baiduWidth` is the target panel width when the writer draws images at their own size (BDS/BDI). */
  constructor(pkg: SsfPackage, theme: SsfTheme, warnings: string[], baiduWidth?: number) {
    this.pkg = pkg
    this.theme = theme
    this.warnings = warnings
    this.sogouWidth = Number(pkg.resolution) || 1080
    this.scale = baiduWidth ? baiduWidth / this.sogouWidth : undefined
    this.skin = pkg.skin(theme)
    this.keys = pkg.keys(theme)
    this.sounds = pkg.ini("default/sound_android.ini")
  }

  private file(name: string): Uint8Array | undefined {
    const bytes = this.pkg.file(this.theme, name)
    if (!bytes || !isPng(bytes)) {
      if (!this.missing.has(name)) {
        this.missing.add(name)
        this.warnings.push(`${this.theme === "dark" ? "夜间" : "白天"}外观缺少图片或不是 PNG：${name}`)
      }
      return
    }
    return bytes
  }

  decode(id: string, bytes: Uint8Array | undefined): RgbaImage | undefined {
    if (!this.decoded.has(id)) {
      let image: RgbaImage | undefined
      try {
        image = bytes ? decodePng(bytes) : undefined
      } catch (error) {
        this.warnings.push(`${id} 无法解码（${error instanceof Error ? error.message : error}），已跳过`)
      }
      this.decoded.set(id, image)
    }
    return this.decoded.get(id)
  }

  private image(ref: SsfImageRef): LookImage | undefined {
    const bytes = this.file(ref.file)
    return bytes ? { id: `${ref.file}|${ref.stretch ?? ""}`, bytes, stretch: ref.stretch } : undefined
  }

  /**
   * Images derived from Sogou files (padded, cropped, composited), keyed by how they are made and the
   * bytes they are made from; `build` decodes only when the result is not cached yet.
   */
  private derive(kind: string, sources: Uint8Array[], build: () => RgbaImage | undefined): LookImage | undefined {
    const id = `${kind}|${sources.map(fingerprint).join("|")}`
    return cached(id, () => {
      const image = build()
      // A derived image is often resized next; keeping its pixels saves decoding the PNG just encoded.
      if (image) this.decoded.set(id, image)
      return image && { id, bytes: encodePng(image) }
    })
  }

  private resized(image: LookImage, width: number, height: number): LookImage {
    const size = pngSize(image.bytes)
    if (!size || (size[0] === width && size[1] === height)) return image
    const stretch = image.stretch?.map((value, index) => Math.round(value * (index < 2 ? width / size[0] : height / size[1]))) as SsfStretch | undefined
    if (stretch && (stretch[1] <= stretch[0] || stretch[3] <= stretch[2])) return image
    const resized = this.derive(`size:${width}x${height}:${stretch ?? ""}`, [image.bytes], () => {
      const source = this.decode(image.id, image.bytes)
      return source && resizeImage(source, width, height)
    })
    return resized ? { ...resized, stretch } : image
  }

  /** A stretchable image at Baidu size, so its fixed nine-slice borders keep their Sogou proportion. */
  private scaledPair(pair: LookPair | undefined): LookPair | undefined {
    const scale = this.scale
    if (!pair || !scale || scale >= 1) return pair
    const scaled = (image: LookImage) => {
      const size = image.stretch && pngSize(image.bytes)
      return size ? this.resized(image, Math.max(1, Math.round(size[0] * scale)), Math.max(1, Math.round(size[1] * scale))) : image
    }
    return { normal: scaled(pair.normal), pressed: scaled(pair.pressed) }
  }

  /** Baidu draws a foreground at its own size: Sogou pixels become layout units, never larger than the key. */
  private fitted(image: LookImage, key: [number, number] | undefined): LookImage {
    const size = pngSize(image.bytes)
    if (!size || !this.scale) return image
    const ratio = Math.min(this.scale, ...(key ? [key[0] / size[0], key[1] / size[1]] : []))
    return this.resized(image, Math.max(1, Math.round(size[0] * ratio)), Math.max(1, Math.round(size[1] * ratio)))
  }

  private statePair(section: string): LookPair | undefined {
    const normalRef = parseSsfImage(this.skin.get(section, "NORMAL"))
    const normal = normalRef && this.image(normalRef)
    if (!normal) return
    const pressedRef = parseSsfImage(this.skin.get(section, "PRESSED"))
    return { normal, pressed: (pressedRef && this.image(pressedRef)) ?? normal }
  }

  private background(binding: SsfKeyBinding): LookPair | undefined {
    const found = ssfBackground(this.skin, binding, (ref) => !!this.file(ref.file))
    return found && this.statePair(found.images)
  }

  /** `on` reads the `_ON` states, which Sogou's pinyin boards show on letter keys (capitals). */
  private foregroundSource(binding: SsfKeyBinding, on: boolean): Foreground | undefined {
    const found = ssfForeground(this.skin, this.keys, binding)
    if (found?.kind === "keys") {
      const state = (name: string) => firstValue(this.keys.get(found.images, on ? `${name}_ON` : name)) ?? firstValue(this.keys.get(found.images, name))
      const normal = state("NORMAL")!
      return { normal, pressed: state("PRESSED") ?? normal, rect: found.rect }
    }
    if (found?.kind === "icon") {
      const icon = firstValue(this.skin.get(found.owner, "ICON"))!
      return { normal: icon, pressed: firstValue(this.skin.get(found.owner, "ICON_PRESSED")) ?? icon }
    }
    if (binding.sections.some((section) => /^transparent\.png$/i.test(firstValue(this.skin.get(section, "ICON")) ?? ""))) {
      return { normal: "transparent.png", pressed: "transparent.png" }
    }
  }

  /**
   * FG_RECT (fractions of the key) becomes transparent padding; an icon is centred on a canvas the
   * size of the key's own background image, which Sogou draws at the key's real size.
   */
  private foregroundImage(name: string, rect: number[] | undefined, canvas: [number, number] | undefined, target?: [number, number]): LookImage | undefined {
    const bytes = this.file(name)
    const size = bytes && pngSize(bytes)
    if (!bytes || !size) return
    const [sourceWidth, sourceHeight] = size
    if (rect) {
      // Sogou parses FG_RECT as Android RectF: left, top, right, bottom.
      const [x, y, right, bottom] = rect
      const width = right - x
      const height = bottom - y
      if (!(width > 0 && height > 0 && width <= 1 && height <= 1)) return this.fitted({ id: name, bytes }, target)
      if (target) return this.derive(`rect:${rect.join(",")}:target:${target.join(",")}`, [bytes], () => {
        const source = this.decode(name, bytes)
        const boxWidth = target[0] * width
        const boxHeight = target[1] * height
        const scale = Math.min(boxWidth / sourceWidth, boxHeight / sourceHeight)
        const glyph = source && resizeImage(source, Math.max(1, Math.round(sourceWidth * scale)), Math.max(1, Math.round(sourceHeight * scale)))
        return glyph && placeImage(glyph, target[0], target[1], Math.round(x * target[0] + (boxWidth - glyph.width) / 2), Math.round(y * target[1] + (boxHeight - glyph.height) / 2))
      })
      if (!x && !y && width === 1 && height === 1) return { id: name, bytes }
      const canvasWidth = Math.round(sourceWidth / width)
      const canvasHeight = Math.round(sourceHeight / height)
      // A tiny FG_RECT would ask for a canvas many times the glyph; such a key keeps the bare glyph.
      if (canvasWidth * canvasHeight > MAX_PIXELS) return { id: name, bytes }
      return this.derive(`rect:${rect.join(",")}`, [bytes], () => {
        const source = this.decode(name, bytes)
        return source && placeImage(source, canvasWidth, canvasHeight, Math.round(x * canvasWidth), Math.round(y * canvasHeight))
      })
    }
    if (!canvas || canvas[0] * canvas[1] > MAX_PIXELS || (sourceWidth >= canvas[0] && sourceHeight >= canvas[1])) return { id: name, bytes }
    const width = Math.max(canvas[0], sourceWidth)
    const height = Math.max(canvas[1], sourceHeight)
    return this.derive(`canvas:${width}x${height}`, [bytes], () => {
      const source = this.decode(name, bytes)
      return source && placeImage(source, width, height, Math.round((width - source.width) / 2), Math.round((height - source.height) / 2))
    })
  }

  private labelColor(binding: SsfKeyBinding, qwerty: boolean, pressed: boolean): string | undefined {
    const field = pressed ? "TEXT_COLOR_PRESSED" : "TEXT_COLOR"
    for (const section of ssfTextSections(binding, qwerty, this.skin)) {
      const color = ssfColor(this.skin.get(section, field)) ?? (pressed ? ssfColor(this.skin.get(section, "TEXT_COLOR")) : undefined)
      if (color) return color
    }
    if (binding.keyClass === "function") return ssfColor(this.skin.get("General", pressed ? "HIGH_LIGHT_ICON_COLOR" : "ICON_COLOR"))
  }

  /** Size, typeface and weight a chain of text styles sets, each from the first style that has it. */
  private textLook(sections: readonly string[], defaultFont?: string): LookText {
    const value = (key: string) => sections.map((section) => this.skin.get(section, key)?.trim()).find(Boolean)
    const size = Number(value("TEXT_SIZE"))
    // TEXT_SIZE up to 1 is a fraction of the screen width; above 1 it is Sogou pixels.
    const pixels = size > 0 ? (size <= 1 ? size * this.sogouWidth : size) * (this.scale ?? 1) : undefined
    const name = value("TYPEFACE") ?? defaultFont
    const bytes = name && this.pkg.file(this.theme, name)
    const bold = value("BOLD")
    return {
      ...pixels ? { fontSize: Math.max(1, Math.round(pixels)) } : {},
      ...name && bytes ? { font: { name, bytes } } : {},
      // Sogou's parser takes only the exact "true".
      ...bold !== undefined ? { bold: bold === "true" } : {},
    }
  }

  textStyle(section: string): LookText {
    return this.textLook([section])
  }

  key(layout: string, action: string, landscape: boolean, size?: [number, number], sourceSection?: string, sourceBackground?: string): KeyLook {
    const binding = ssfKeyBinding(layout, action, landscape, sourceSection, sourceBackground)
    const sogouBack = this.background(binding)
    // Sogou's pinyin layouts mark letter keys S_FLAG=1 (English ones add KEY_FLAG_VALUE): they start upper case.
    const on = /^[a-z]$/.test(action) && ["py9", "py26"].includes(ssfBoard(layout))
    const source = this.foregroundSource(binding, on)
    const canvas = sogouBack ? pngSize(sogouBack.normal.bytes) : undefined
    const foreground = (name: string) => {
      if (source?.rect && size) return this.foregroundImage(name, source.rect, canvas, size)
      const image = this.foregroundImage(name, source?.rect, canvas)
      return image && (sourceSection && size ? this.resized(image, Math.round(size[0]), Math.round(size[1])) : this.fitted(image, size))
    }
    const normal = source && foreground(source.normal)
    const fore = source && normal ? { normal, pressed: foreground(source.pressed) ?? normal } : undefined
    const back = this.scaledPair(sogouBack)
    const qwerty = ssfQwerty(layout)
    const labelNormal = this.labelColor(binding, qwerty, false)
    const label = labelNormal ? { normal: labelNormal, pressed: this.labelColor(binding, qwerty, true) ?? labelNormal } : undefined
    // Sogou lays a skin's style over its built-in one of the same name, so a size, typeface or weight
    // the key's own style leaves out is the built-in one, not the next style's.
    const labelText = this.textLook(ssfTextSections(binding, qwerty, this.skin).slice(0, 1))
    const text = (field: string) => binding.sections.map((section) => firstValue(this.skin.get(section, field))).find(Boolean)
    return { binding, back, fore, label, labelText: Object.keys(labelText).length ? labelText : undefined, texts: [text("LABEL"), text("MINOR_LABEL")] }
  }

  /**
   * Sogou paints one background behind both the candidate bar and the keys; Baidu styles them apart,
   * so the background is cut at the bar's height and the (usually translucent) bar is laid over the top.
   */
  keyboard(): { panel?: LookImage; cand?: LookImage; panelColor?: string } {
    if (this.keyboardCache) return this.keyboardCache
    const solidBackground = this.skin.get("RootView", "BG_STYLE")?.trim() === "2"
    const backgroundName = solidBackground ? undefined : [
      this.skin.get("RootView", "BG_IMAGE"),
      this.skin.get("WALLPAPER", "BG_IMAGE"),
      this.skin.get("General", "PLATFORM_BG_IMAGE"),
    ].map(firstValue).find((value) => value && /\.png$/i.test(value))
    const barSection = this.skin.get("CandidateView", "BG_IMAGE")?.trim()
    const barRef = barSection ? parseSsfImage(this.skin.get(barSection, "NORMAL")) : undefined
    const backgroundBytes = backgroundName ? this.file(backgroundName) : undefined
    const backgroundSize = backgroundBytes && pngSize(backgroundBytes)
    const barBytes = barRef && this.file(barRef.file)
    const barSize = barBytes && pngSize(barBytes)
    const result: { panel?: LookImage; cand?: LookImage; panelColor?: string } = {}
    if (backgroundName && backgroundBytes && backgroundSize) {
      const [width, height] = backgroundSize
      const top = Math.min(height - 1, Math.max(0, barSize ? Math.round(barSize[1] * width / this.sogouWidth) : 0))
      const background = () => this.decode(backgroundName, backgroundBytes)
      result.panel = this.derive(`panel:${top}`, [backgroundBytes], () => {
        const image = background()
        return image && cropImage(image, 0, top, image.width, image.height - top)
      })
      if (top > 0 && barRef && barBytes) {
        result.cand = this.derive(`cand:${top}`, [backgroundBytes, barBytes], () => {
          const image = background()
          const bar = this.decode(barRef.file, barBytes)
          return image && bar && compositeImage(cropImage(image, 0, 0, image.width, top), resizeImage(bar, image.width, top))
        })
      }
    } else if (barRef && barBytes) {
      result.cand = { id: barRef.file, bytes: barBytes, stretch: barRef.stretch }
    }
    result.panelColor = (solidBackground ? ssfColor(this.skin.get("RootView", "BG_COLOR")) : undefined)
      ?? ssfColor(this.skin.get("WALLPAPER", "COLOR")) ?? ssfColor(this.skin.get("RootView", "BG_FUNCTION_COLOR"))
    if (!result.panel && !result.panelColor) this.warnings.push(`${this.theme === "dark" ? "夜间" : "白天"}外观没有键盘背景，保留模板背景`)
    this.keyboardCache = result
    return result
  }

  /**
   * The pinyin bar Sogou shows above the candidate bar (`VPA_Bar`), at the panel's width. Baidu iOS
   * types into a row of its own above the candidates and paints it with `[SCAND] BACK_STYLE`, whose
   * full-width image sets the row's height.
   */
  inputBar(): LookImage | undefined {
    const name = firstValue(this.skin.get("VPA_Bar", "BG_IMAGE"))
    const ref = parseSsfImage(name && this.skin.sections().includes(name) ? this.skin.get(name, "NORMAL") : name)
    const bytes = ref && this.file(ref.file)
    const size = bytes && pngSize(bytes)
    if (!ref || !bytes || !size) return
    const width = Math.round(this.sogouWidth * (this.scale ?? 1))
    return this.resized({ id: `${ref.file}|`, bytes }, width, Math.max(1, Math.round(size[1] * width / size[0])))
  }

  /** The size of one of the skin's images in Sogou pixels. */
  imageSize(file: string): [number, number] | undefined {
    const bytes = this.file(file)
    return bytes && pngSize(bytes)
  }

  /** One of the skin's images at `width`×`height` target units. */
  sized(file: string, width: number, height: number): LookImage | undefined {
    const bytes = this.file(file)
    return bytes && this.resized({ id: `${file}|`, bytes }, Math.max(1, Math.round(width)), Math.max(1, Math.round(height)))
  }

  /** `cand` with `input` stacked above it: iOS stretches the candidate background over both rows. */
  stackedCandidate(input: LookImage, cand: LookImage): LookImage | undefined {
    return this.derive("stacked-cand", [input.bytes, cand.bytes], () => {
      const bar = this.decode(cand.id, cand.bytes)
      const top = this.decode(input.id, input.bytes)
      if (!bar || !top) return
      const height = Math.max(1, Math.round(top.height * bar.width / top.width))
      const total = height + bar.height
      return compositeImage(placeImage(resizeImage(top, bar.width, height), bar.width, total, 0, 0), placeImage(bar, bar.width, total, 0, height))
    })
  }

  /** The skin's replacement for one of Sogou's built-in toolbar icons, if it ships that file. */
  toolbarIcon(name: string): LookPair | undefined {
    // Legacy skins draw the S logo with the multimedia slot (the APK's IME_Function_Multimedia).
    const file = name === "logo.png" && !this.pkg.file(this.theme, name) ? "ime_function_multimedia.png" : name
    const bytes = this.pkg.file(this.theme, file)
    if (!bytes || !isPng(bytes)) return
    const normal = this.fitted({ id: `icon:${file}|${fingerprint(bytes)}`, bytes }, undefined)
    const pressedBytes = this.pkg.file(this.theme, file.replace(/\.png$/i, "_p.png"))
    const pressed = pressedBytes && isPng(pressedBytes) ? this.fitted({ id: `icon:${file}:pressed|${fingerprint(pressedBytes)}`, bytes: pressedBytes }, undefined) : normal
    return { normal, pressed }
  }

  /** The 9-key symbol column, which Sogou styles as the candidate code view. */
  list(textStyle = "TextStyle_Text"): { back?: LookPair; cell?: LookPair; text?: string } & LookText {
    textStyle = firstValue(this.skin.get("CandidateCodeView", "TEXT_STYLE")) ?? textStyle
    const back = firstValue(this.skin.get("CandidateCodeView", "BG_IMAGE"))
    const cell = firstValue(this.skin.get("CandidateCodeView", "BG_IMAGES"))
    return {
      back: this.scaledPair(back ? this.statePair(back) : undefined),
      cell: this.scaledPair(cell ? this.statePair(cell) : undefined),
      text: [textStyle, "TextStyle"].map((section) => ssfColor(this.skin.get(section, "TEXT_COLOR"))).find(Boolean),
      ...this.textLook([textStyle], "DROIDSANSFALLBACK.ttf"),
    }
  }

  color(section: string, field = "TEXT_COLOR"): string | undefined {
    return ssfColor(this.skin.get(section, field))
  }

  /** Key sound for a binding (or the default `[Key]` sound), as the file to copy. */
  sound(binding: SsfKeyBinding | undefined): { filename: string; bytes: Uint8Array } | undefined {
    const section = ssfSoundSection(this.sounds, binding)
    const sound = section && this.sounds.get(section, "sound")?.trim()
    if (!sound) return
    const filename = [`${sound}.wav`, `${sound}.ogg`, `${sound}.mp3`, sound].find((name) => this.pkg.file(this.theme, name))
    const bytes = filename && this.pkg.file(this.theme, filename)
    // Writers put the sound in their own res/ folder, so only the file name is kept.
    return filename && bytes ? { filename: filename.split(/[\\/]/).pop()!, bytes } : undefined
  }
}
