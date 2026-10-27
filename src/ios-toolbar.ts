// iOS Baidu draws the candidate bar's logo, F14 functions and hide key natively instead of the CND icons Android
// skins style them with. It tints them from logo.ini (V6 p160); with no [LOGO] the icons fall back to a faint default.
import { strFromU8, strToU8 } from "fflate"
import { IniDocument } from "./ini.ts"
import { cropImage, decodePng, encodePng } from "./ssf/ssf-png.ts"
import { addZipEntry } from "./skin-zip.ts"

type Slice = { bytes: Uint8Array; rect: number[] }
export type SliceReader = (resource: string, tile: string) => Slice | undefined

export const plist = (items: string[]) => `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><array>${items.join("\n")}</array></plist>\n`

/** A solid-colour style for the LOGO menu: the style itself when it is a colour, else one sampled from its image. */
export function solidColorStyle(css: IniDocument, style: string, slice: SliceReader): string {
  if (css.get(`STYLE${style}`, "NM_COLOR")) return style
  const [resource, tile] = css.get(`STYLE${style}`, "NM_IMG")?.split(",") ?? []
  const found = resource ? slice(resource, tile) : undefined
  if (!found) return style
  const image = decodePng(found.bytes)
  const [x, y, width, height] = found.rect
  const offset = ((y + Math.floor(height / 2)) * image.width + x + Math.floor(width / 2)) * 4
  const color = [...image.data.subarray(offset, offset + 3)].map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase()
  // STYLE_NUM is often stale in hand-made skins; go past every style that exists.
  const id = String(Math.max(Number(css.get("GLOBAL", "STYLE_NUM")) || 0, ...css.sections().map((name) => Number(name.match(/^STYLE(\d+)$/)?.[1] ?? 0))) + 1)
  css.appendSection(`STYLE${id}`, [{ key: "NM_COLOR", value: color }, { key: "HL_COLOR", value: color }])
  css.set("GLOBAL", "STYLE_NUM", id)
  return id
}

export function logoLayout(back: string, text: string): string {
  // ICON_NUM=1 needs the [ICON1] it counts; Android reads [GLOBAL] VERSION (native skins write both).
  return `[GLOBAL]\nICON_NUM=1\nVERSION=1\n\n[PANEL]\nBACK_STYLE=${back}\nICON_INDEX=1\n\n[ICON1]\nFORE_STYLE=${text}\nTEXT_STYLE=${text}\n`
}

/** customImageConfig.plist entry 0 is the logo; the client appends "_iphone@3x.png" to each image name. */
export function logoImageConfig(normal: string, highlight: string): string {
  const states = `<dict><key>Normal</key><string>${normal}</string><key>Highlight</key><string>${highlight}</string><key>Selected</key><string>${normal}</string></dict>`
  return plist([`<dict><key>Name</key><string>0</string><key>Images</key><dict><key>Normal</key>${states}<key>Theme</key>${states}</dict></dict>`])
}

/**
 * Gives an Android-authored package the iOS toolbar entry points: [LOGO] with logo.ini coloured like the CND logo key,
 * and the logo artwork when that key is an image. Packages that already declare [LOGO] keep their own configuration.
 */
export function adaptIosToolbar(files: Map<string, Uint8Array>, warnings?: string[]): void {
  const text = (path: string) => {
    const bytes = files.get(path)
    return bytes && strFromU8(bytes)
  }
  let textKeys = false
  // port and land share res/default.css: sample a background colour into it once.
  const backs = new Map<string, string>()
  for (const path of [...files.keys()]) {
    const match = path.match(/^(skin\/(?:(?:light|dark)\/skin\/)?)(port|land)\/gen\.ini$/)
    if (!match) continue
    const [, root, orientation] = match
    const gen = IniDocument.parse(text(path)!)
    const candPath = `${root}${orientation}/${gen.get("CAND", "LAYOUT_NAME")?.trim()}.cnd`
    const cssPath = `${root}res/default.css`
    const candText = text(candPath)
    const cssText = text(cssPath)
    if (gen.sections().includes("LOGO") || !candText || !cssText) continue
    const cand = IniDocument.parse(candText)
    const css = IniDocument.parse(cssText)
    const slice: SliceReader = (resource, tile) => {
      const bytes = files.get(`${root}res/${resource}.png`)
      const til = text(`${root}res/${resource}.til`)
      const rect = til ? IniDocument.parse(til).get(`IMG${tile}`, "SOURCE_RECT")?.split(",").map(Number) : undefined
      return bytes && rect?.length === 4 && rect.every(Number.isFinite) ? { bytes, rect } : undefined
    }
    const icon = (action: string) => cand.sections().find((name) => /^ICON\d+$/.test(name) && cand.get(name, "KEY")?.trim() === action)
    const fore = (action: string) => {
      const section = icon(action)
      return section ? cand.get(section, "FORE_STYLE")?.split(",")[0].trim() : undefined
    }
    const isText = (style?: string) => !!style && !!css.get(`STYLE${style}`, "NM_COLOR") && !css.get(`STYLE${style}`, "NM_IMG")
    const logo = fore("F31")
    textKeys ||= [logo, fore("F8")].some((style) => isText(style) && css.get(`STYLE${style}`, "SHOW"))
    // The CND logo key's text colour is what Android shows on the bar; otherwise use the candidate words' colour.
    const textStyle = isText(logo) ? logo! : cand.get("CAND", "FORE_STYLE")?.trim() ?? ""
    const candBack = cand.get("CAND", "BACK_STYLE")?.trim() ?? ""
    const back = backs.get(`${root}${candBack}`) ?? solidColorStyle(css, candBack, slice)
    backs.set(`${root}${candBack}`, back)
    files.set(cssPath, strToU8(css.toString()))
    gen.appendSection("LOGO", [{ key: "LAYOUT_NAME", value: "logo" }])
    files.set(path, strToU8(gen.toString()))
    addZipEntry(files, `${root}${orientation}/logo.ini`, strToU8(logoLayout(back, textStyle)))

    const configPath = `${root}res/logo/customImageConfig.plist`
    if (!logo || files.has(configPath)) continue
    const image = (state: "NM_IMG" | "HL_IMG") => {
      const [resource, tile] = css.get(`STYLE${logo}`, state)?.split(",") ?? []
      const found = resource ? slice(resource, tile) : undefined
      if (!found) return
      const name = `toolbar-logo_${state === "NM_IMG" ? "Normal" : "Highlight"}`
      addZipEntry(files, `${root}res/logo/${name}_iphone@3x.png`, encodePng(cropImage(decodePng(found.bytes), ...found.rect as [number, number, number, number])))
      return name
    }
    const normal = image("NM_IMG")
    if (normal) addZipEntry(files, configPath, strToU8(logoImageConfig(normal, image("HL_IMG") ?? normal)))
  }
  if (textKeys) warnings?.push("iOS 百度输入法用原生图标绘制工具栏 Logo 和收起键，文字按钮（如“百度”“收回”）不会显示")
}
