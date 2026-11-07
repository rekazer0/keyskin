// iOS Baidu draws the candidate bar's logo, F14 functions and hide key natively instead of the CND icons Android
// skins style them with. It tints them from logo.ini (V6 p160); with no [LOGO] the icons fall back to a faint default.
import { strFromU8, strToU8 } from "fflate"
import { IniDocument } from "./ini.ts"
import { parseXmlPlist, type PalmPlistValue } from "./palm/palm-plist.ts"
import { cropImage, decodePng, encodePng, placeImage, type RgbaImage } from "./ssf/ssf-png.ts"
import { addZipEntry } from "./skin-zip.ts"
import type { SkinArchive } from "./skin.ts"

type Slice = { bytes: Uint8Array; rect: number[] }
type SliceReader = (resource: string, tile: string) => Slice | undefined

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
  return appendStyle(css, [{ key: "NM_COLOR", value: color }, { key: "HL_COLOR", value: color }])
}

/** Adds a style numbered past every existing one: STYLE_NUM is often stale in hand-made skins. */
export function appendStyle(css: IniDocument, entries: Array<{ key: string; value: string }>): string {
  const id = String(Math.max(Number(css.get("GLOBAL", "STYLE_NUM")) || 0, ...css.sections().map((name) => Number(name.match(/^STYLE(\d+)$/)?.[1] ?? 0))) + 1)
  css.appendSection(`STYLE${id}`, entries)
  css.set("GLOBAL", "STYLE_NUM", id)
  return id
}

/** Android bitmap index (LogoIconSource) → the iOS plist function ID that names the same function. */
const TOOLBAR_FUNCTIONS = [
  [26, "F7", "19", "表情"], [27, "F13", "17", "键盘类型"],
  [29, "F72", "23", "语音输入"], [31, "F82", "26", "搜索"],
  [25, "", "18", "光标"], [50, "", "35", "剪贴板"], [62, "F68", "45", "AI侃侃"],
] as const

/**
 * Gives an iOS-authored package the Android function bar: Baidu Android draws the candidate bar's F14 icons from
 * res/logo/pop_menu_icons, which an iOS skin does not ship (its artwork is the plists plus the 1.0 pictures).
 * Which functions the phone shows, and in what order, stays the client's setting.
 */
export function adaptAndroidToolbar(files: Map<string, Uint8Array>, warnings?: string[]): void {
  let icons = 0
  for (const path of [...files.keys()]) {
    const match = path.match(/^(.*?)res\/logo\/com\.baidu\.inputmethod\.toolbarMenuItems\.plist$/)
    if (!match) continue
    const root = match[1]
    // A hand-made Android atlas wins over anything re-cut from the iOS artwork.
    if (files.has(`${root}res/logo/pop_menu_icons.png`)) continue
    const entries = parseXmlPlist(files.get(path)!)
    if (!Array.isArray(entries)) continue
    const tiles: Array<{ index: number; image: RgbaImage }> = []
    for (const value of entries) {
      const item = typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, PalmPlistValue> : undefined
      if (item?.Position !== "toolbar") continue
      const index = TOOLBAR_FUNCTIONS.find(([, , id]) => id === String(item.Name ?? ""))?.[0]
      const name = toolbarImageName(item.Images)
      const image = index === undefined || !name ? undefined : logoImage(files, `${root}res/logo/`, name)
      if (index === undefined || !image) continue
      tiles.push({ index, image })
    }
    if (!tiles.length) continue
    writeAndroidMenuAtlas(files, `${root}res/logo`, tiles)
    icons += tiles.length
  }
  if (icons) warnings?.push(`Android 百度的工具栏图标按功能位图索引写入 res/logo/pop_menu_icons（${icons} 个）；显示哪些功能、数量和顺序由百度客户端设置决定`)
}

/** The plist's Images dict: the Normal state's picture is the icon; Highlight only shows while pressed. */
function toolbarImageName(images: PalmPlistValue | undefined): string | undefined {
  if (typeof images !== "object" || images === null || Array.isArray(images)) return
  const states = (images as Record<string, PalmPlistValue>)["Normal"]
  if (typeof states !== "object" || states === null || Array.isArray(states)) return
  const normal = (states as Record<string, PalmPlistValue>)["Normal"]
  return typeof normal === "string" ? normal : undefined
}

/** The client appends "_iphone@3x.png" to a plist image name; files written by this editor inline the suffix. */
function logoImage(files: Map<string, Uint8Array>, dir: string, name: string): RgbaImage | undefined {
  const candidates = name.endsWith(".png")
    ? [`${dir}${name}`, `${dir}${name.slice(0, -4)}_iphone@3x.png`]
    : [`${dir}${name}_iphone@3x.png`, `${dir}${name}@3x.png`, `${dir}${name}.png`]
  const bytes = candidates.map((path) => files.get(path)).find((value) => value !== undefined)
  return bytes ? decodePng(bytes) : undefined
}

/** Tiles stack vertically; TILE_NUM must exceed the highest index or LogoIconSource stops reading at it. */
function writeAndroidMenuAtlas(files: Map<string, Uint8Array>, dir: string, tiles: Array<{ index: number; image: RgbaImage }>): void {
  const ordered = [...tiles].sort((a, b) => a.index - b.index)
  const width = Math.max(...ordered.map(({ image }) => image.width))
  const height = ordered.reduce((total, { image }) => total + image.height, 0)
  const data = new Uint8Array(width * height * 4)
  const lines = ["[GLOBAL]", "USE_ALPHA=1", `TILE_NUM=${ordered.at(-1)!.index + 1}`, ""]
  let y = 0
  for (const { index, image } of ordered) {
    data.set(placeImage(image, width, image.height, 0, 0).data, y * width * 4)
    lines.push(`[IMG${index}]`, `SOURCE_RECT=0,${y},${image.width},${image.height}`, "")
    y += image.height
  }
  addZipEntry(files, `${dir}/pop_menu_icons.png`, encodePng({ width, height, data }))
  addZipEntry(files, `${dir}/pop_menu_icons.til`, strToU8(lines.join("\n")))
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

/** Native iOS function entry, shared by BDS and SSF exports. */
export function toolbarMenuItem(id: string, title: string, position: string, normal: string, highlight: string): string {
  const states = `<dict><key>Normal</key><string>${normal}</string><key>Highlight</key><string>${highlight}</string><key>Selected</key><string>${normal}</string></dict>`
  return `<dict><key>Position</key><string>${position}</string><key>Name</key><string>${id}</string><key>Titles</key><dict><key>Normal</key><dict><key>Normal</key><string>${title}</string><key>Selected</key><string>${title}</string></dict></dict><key>Images</key><dict><key>Normal</key>${states}<key>Theme</key>${states}</dict></dict>`
}

/**
 * Gives an Android-authored package the iOS toolbar entry points: [LOGO] with logo.ini coloured like the CND logo key,
 * and native function artwork from the Android menu atlas. Existing iOS values and plists are preserved.
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
    if (!candText || !cssText) continue
    const cand = IniDocument.parse(candText)
    const css = IniDocument.parse(cssText)
    const slice = sliceReader(root, (path) => files.get(path))
    const fore = (action: string) => foreStyle(cand, action)
    const isText = (style?: string) => !!style && !!css.get(`STYLE${style}`, "NM_COLOR") && !css.get(`STYLE${style}`, "NM_IMG")
    const logo = fore("F31")
    textKeys ||= [logo, fore("F8")].some((style) => isText(style) && css.get(`STYLE${style}`, "SHOW"))
    // The CND logo key's text colour is what Android shows on the bar; otherwise use the candidate words' colour.
    const textStyle = isText(logo) ? logo! : cand.get("CAND", "FORE_STYLE")?.trim() ?? ""
    const candBack = cand.get("CAND", "BACK_STYLE")?.trim() ?? ""
    const back = backs.get(`${root}${candBack}`) ?? solidColorStyle(css, candBack, slice)
    backs.set(`${root}${candBack}`, back)
    files.set(cssPath, strToU8(css.toString()))
    const layout = gen.get("LOGO", "LAYOUT_NAME")?.trim() || "logo"
    const logoPath = `${root}${orientation}/${layout}.ini`
    const menu = IniDocument.parse(text(logoPath) ?? "")
    const defaults = IniDocument.parse(logoLayout(back, textStyle))
    for (const section of defaults.sections()) {
      if (!menu.sections().includes(section)) menu.appendSection(section, [])
      for (const { key, value } of defaults.entries(section)) if (!menu.get(section, key)) menu.set(section, key, value)
    }
    if (!gen.sections().includes("LOGO")) gen.appendSection("LOGO", [])
    gen.set("LOGO", "LAYOUT_NAME", layout)
    files.set(path, strToU8(gen.toString()))
    addZipEntry(files, logoPath, strToU8(menu.toString()))
    writeMenuFiles(files, root, cand, css, slice)

    const configPath = `${root}res/logo/customImageConfig.plist`
    if (!logo || files.has(configPath)) continue
    for (const [path, bytes] of logoFiles(root, css, logo, slice)) addZipEntry(files, path, bytes)
  }
  if (textKeys) warnings?.push("iOS 百度输入法用原生图标绘制工具栏 Logo 和收起键，文字按钮（如“百度”“收回”）不会显示")
}

/**
 * iOS draws the logo from res/logo, not the CND logo key's FORE_STYLE the editor shows and edits. Saving a BDI re-cuts
 * the artwork adaptIosToolbar wrote so a restyled logo key reaches the phone; hand-made res/logo files are left alone.
 */
export function refreshIosLogo(archive: SkinArchive): void {
  for (const configPath of archive.names().filter((path) => path.endsWith("res/logo/customImageConfig.plist"))) {
    if (!archive.getText(configPath).includes(`${LOGO_IMAGE}_Normal`)) continue
    const root = configPath.slice(0, -"res/logo/customImageConfig.plist".length)
    const read = (path: string) => archive.getBytes(path)
    const text = (path: string) => archive.isText(path) ? archive.getText(path) : undefined
    const gen = text(`${root}port/gen.ini`)
    const cand = gen && text(`${root}port/${IniDocument.parse(gen).get("CAND", "LAYOUT_NAME")?.trim()}.cnd`)
    const css = text(`${root}res/default.css`)
    const logo = cand && foreStyle(IniDocument.parse(cand), "F31")
    if (!css || !logo) continue
    for (const [path, bytes] of logoFiles(root, IniDocument.parse(css), logo, sliceReader(root, read))) archive.setBytes(path, bytes)
  }
}

const LOGO_IMAGE = "toolbar-logo"

function foreStyle(cand: IniDocument, action: string): string | undefined {
  const section = cand.sections().find((name) => /^ICON\d+$/.test(name) && cand.get(name, "KEY")?.trim() === action)
  return section ? cand.get(section, "FORE_STYLE")?.split(",")[0].trim() : undefined
}

function sliceReader(root: string, read: (path: string) => Uint8Array | undefined): SliceReader {
  return (resource, tile) => {
    const bytes = read(`${root}res/${resource}.png`)
    const til = read(`${root}res/${resource}.til`)
    const rect = til ? IniDocument.parse(strFromU8(til)).get(`IMG${tile}`, "SOURCE_RECT")?.split(",").map(Number) : undefined
    return bytes && rect?.length === 4 && rect.every(Number.isFinite) ? { bytes, rect } : undefined
  }
}

/** The logo key's image style cut into res/logo artwork plus the customImageConfig.plist naming it; none for a text logo. */
function logoFiles(root: string, css: IniDocument, logo: string, slice: SliceReader): Array<[string, Uint8Array]> {
  const files: Array<[string, Uint8Array]> = []
  const image = (state: "NM_IMG" | "HL_IMG") => {
    const [resource, tile] = css.get(`STYLE${logo}`, state)?.split(",") ?? []
    const found = resource ? slice(resource, tile) : undefined
    if (!found) return
    const name = `${LOGO_IMAGE}_${state === "NM_IMG" ? "Normal" : "Highlight"}`
    files.push([`${root}res/logo/${name}_iphone@3x.png`, encodePng(cropImage(decodePng(found.bytes), ...found.rect as [number, number, number, number]))])
    return name
  }
  const normal = image("NM_IMG")
  if (!normal) return []
  files.push([`${root}res/logo/customImageConfig.plist`, strToU8(logoImageConfig(normal, image("HL_IMG") ?? normal))])
  return files
}

/** Android bitmap indexes (LogoIconSource) → iOS function IDs; order matches the editor's toolbar preview. */
function writeMenuFiles(files: Map<string, Uint8Array>, root: string, cand: IniDocument, css: IniDocument, slice: SliceReader): void {
  const paths = ["com.baidu.inputmethod.toolbarMenuItems.plist", "com.baidu.inputmethod.toolbarMenuItems.nijigen.plist"].map((name) => `${root}res/logo/${name}`)
  if (paths.every((path) => files.has(path))) return
  const entries: string[] = []
  for (const [index, action, id, title] of TOOLBAR_FUNCTIONS) {
    const style = action && foreStyle(cand, action)
    const image = (state: "NM_IMG" | "HL_IMG") => {
      const [resource, tile] = (style && css.get(`STYLE${style}`, state)?.split(",").map((part) => part.trim())) || []
      return (resource ? slice(resource, tile) : undefined) ?? slice("logo/pop_menu_icons", String(index))
    }
    const normal = image("NM_IMG")
    if (!normal) continue
    const write = (found: Slice, state: string) => {
      const name = `toolbar-menu-${id}-${state}`
      addZipEntry(files, `${root}res/logo/${name}_iphone@3x.png`, encodePng(cropImage(decodePng(found.bytes), ...found.rect as [number, number, number, number])))
      return name
    }
    const name = write(normal, "normal")
    const pressed = style && css.get(`STYLE${style}`, "HL_IMG") ? write(image("HL_IMG") ?? normal, "highlight") : name
    entries.push(toolbarMenuItem(id, title, "toolbar", name, pressed))
  }
  if (entries.length) for (const path of paths) if (!files.has(path)) addZipEntry(files, path, strToU8(plist(entries)))
}
