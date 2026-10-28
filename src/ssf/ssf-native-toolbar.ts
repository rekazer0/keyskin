// Baidu draws the candidate bar's function icons in a native F14 container, not in arbitrary CND ICON slots.
// iOS (BDI) reads their images from res/logo plists; Android (BDS) from the res/logo/pop_menu_icons atlas.
import { IniDocument } from "../ini.ts"
import { logoImageConfig, logoLayout, plist, solidColorStyle } from "../ios-toolbar.ts"
import type { SkinArchive } from "../skin.ts"
import { cropImage, decodePng, encodePng, placeImage, type RgbaImage } from "./ssf-png.ts"
import type { SsfPackage, SsfTheme } from "./ssf-package.ts"

/** Sogou toolbar slot (cand1.cnd KEY) → iOS plist Name and title. */
const IOS_ITEMS = [
  ["F7", "19", "表情"],
  ["F13", "17", "键盘类型"],
  ["F72", "23", "语音输入"],
  ["F82", "26", "搜索"],
  ["F68", "45", "AI侃侃"],
] as const

/** Sogou menu artwork → iOS plist Name, title and position. */
const IOS_MENU_FILES = [
  ["18", "光标", "ime_function_textedit", "toolbar"],
  ["35", "剪贴板", "ime_function_clipboard", "menu"],
] as const

/**
 * Android 13.3.18.31: MenuFunction's bitmap index is the IMG<n> of pop_menu_icons (LogoIconSource.c),
 * e.g. CLICK_INDEX_EMOJI 26, CLICK_INDEX_INPUT_MANAGER 27, CLICK_INDEX_VOICE 29, CLICK_INDEX_SEARCH 31,
 * CLICK_INDEX_EDITOR 25, CLICK_INDEX_CLIPBOARD 50, CLICK_INDEX_HIDE_SOFTVIEW 67.
 */
const ANDROID_ICONS: Array<[source: string, index: number]> = [
  ["F7", 26], ["F13", 27], ["F72", 29], ["F82", 31], ["F8", 67],
  ["ime_function_textedit", 25], ["ime_function_clipboard", 50],
]

const images = (normal: string, pressed: string) => {
  const states = `<dict><key>Normal</key><string>${normal}</string><key>Highlight</key><string>${pressed}</string><key>Selected</key><string>${normal}</string></dict>`
  return `<key>Images</key><dict><key>Normal</key>${states}<key>Theme</key>${states}</dict>`
}

/** Adapts only SSF exports; existing BDI/BDS documents keep their authored toolbar configuration. */
export function adaptSsfNativeToolbar(archive: SkinArchive, source: SsfPackage, format: "bdi" | "bds", warnings: string[]): void {
  for (const theme of ["light", "dark"] as SsfTheme[]) {
    const prefix = `${theme}/skin/`
    const cssPath = `${prefix}res/default.css`
    if (!archive.isText(cssPath)) continue
    const css = IniDocument.parse(archive.getText(cssPath))
    const port = IniDocument.parse(archive.getText(`${prefix}port/cand1.cnd`))
    const icon = (document: IniDocument, action: string) => {
      const section = document.sections().find((name) => /^ICON\d+$/.test(name) && document.get(name, "KEY") === action)
      if (!section) throw new Error(`工具栏缺少 ${action} 图标`)
      return section
    }
    const slice = (action: string, state: "NM_IMG" | "HL_IMG"): { bytes: Uint8Array; image: RgbaImage; whole: boolean } => {
      const style = port.get(icon(port, action), "FORE_STYLE")
      const [resource, tile] = css.get(`STYLE${style}`, state)?.split(",") ?? []
      const bytes = resource && archive.getBytes(`${prefix}res/${resource}.png`)
      if (!bytes) throw new Error(`工具栏 ${action} 缺少 ${state} 图片`)
      const rect = IniDocument.parse(archive.getText(`${prefix}res/${resource}.til`)).get(`IMG${tile}`, "SOURCE_RECT")?.split(",").map(Number)
      if (!rect || rect.length !== 4 || rect.some((value) => !Number.isFinite(value))) throw new Error(`工具栏 ${action} 切片无效`)
      const image = decodePng(bytes)
      const [x, y, width, height] = rect
      const whole = x === 0 && y === 0 && width === image.width && height === image.height
      return { bytes, image: whole ? image : cropImage(image, x, y, width, height), whole }
    }
    if (format === "bdi") writeIosLogo(archive, prefix, source, theme, slice)
    else writeAndroidMenuIcons(archive, prefix, source, theme, slice)
    const logoMenu = logoMenuStyles(archive, prefix, css, port)

    for (const orientation of ["port", "land"]) {
      const path = `${prefix}${orientation}/cand1.cnd`
      if (!archive.isText(path)) continue
      const document = IniDocument.parse(archive.getText(path))
      const genPath = `${prefix}${orientation}/gen.ini`
      const gen = IniDocument.parse(archive.getText(genPath))
      if (!gen.sections().includes("LOGO")) gen.appendSection("LOGO", [])
      gen.set("LOGO", "LAYOUT_NAME", "logo")
      archive.setText(genPath, gen.toString())
      // V6 p160: logo.ini declares the LOGO menu's colours.
      // Android reads [GLOBAL] VERSION (LogoLoader) and loads the skin's pop_menu_icons only when it is 1.
      archive.setText(`${prefix}${orientation}/logo.ini`, logoLayout(logoMenu.back, logoMenu.text))
      const [,, width, height] = gen.get("CAND", "VIEW_RECT")!.split(",").map(Number)
      const side = Math.round(width / 7)
      const logoEntries = document.entries(icon(document, "F31"))
      const hideEntries = document.entries(icon(document, "F8"))
      document.removeSections(document.sections().filter((name) => /^ICON\d+$/.test(name)))
      const add = (name: string, entries: Array<{ key: string; value: string }>, x: number, w: number, action: string, persist: string, anchor = 1) => {
        document.appendSection(name, entries.filter(({ key }) => !["VIEW_RECT", "SIZE", "POS", "ANCHOR_TYPE", "KEY", "PERSIST"].includes(key)))
        const position = anchor === 5 ? `${-w / 2},${-height / 2}` : `${anchor === 3 ? x - width : x},0`
        for (const [key, value] of Object.entries({ SIZE: `${w},${height}`, POS: position, ANCHOR_TYPE: String(anchor), KEY: action, PERSIST: persist })) document.set(name, key, value)
      }
      add("ICON1", logoEntries, 0, side, "F31", "1")
      add("ICON2", [], side, width - side * 2, "F14", "1", 5)
      add("ICON3", hideEntries, width - side, side, "F8", "1", 3)
      add("ICON4", hideEntries, width - side, side, "F9", "2", 3)
      // V6 p158: FIX_SIZE is iOS only, in whole points (one third of the @3x artwork), not the touch rectangle.
      if (format === "bdi") for (const [section, action] of [["ICON1", "F31"], ["ICON3", "F8"], ["ICON4", "F8"]]) {
        const { image } = slice(action, "NM_IMG")
        document.set(section, "FIX_SIZE", `${Math.round(image.width / 3)},${Math.round(image.height / 3)}`)
      }
      document.set("CAND", "ICON_NUM", "4")
      document.set("CAND", "PADDING", `12,0,${side},0`)
      archive.setText(path, document.toString())
    }
  }
  warnings.push(format === "bdi"
    ? "iOS 工具栏按百度原生功能适配：搜狗灵犀映射为 AI侃侃；显示哪些功能、数量及顺序由百度客户端设置决定，不能保证搜狗七图标排列"
    : "Android 工具栏按百度原生功能适配：搜狗图标写入 logo 菜单图集，灵犀没有对应功能；显示哪些功能、数量及顺序由百度客户端设置决定，不能保证搜狗七图标排列")
}

type Slice = (action: string, state: "NM_IMG" | "HL_IMG") => { bytes: Uint8Array; image: RgbaImage; whole: boolean }

function writeIosLogo(archive: SkinArchive, prefix: string, source: SsfPackage, theme: SsfTheme, slice: Slice): void {
  // The client appends only "_iphone@3x.png" to a plist image name (native skins: "lg/jianpan" → lg/jianpan_iphone@3x.png).
  const write = (action: string, state: "NM_IMG" | "HL_IMG", name: string): string => {
    const { bytes, image, whole } = slice(action, state)
    archive.setBytes(`${prefix}res/logo/${name}_iphone@3x.png`, whole ? bytes : encodePng(image))
    return name
  }
  const entries = IOS_ITEMS.map(([action, id, title], index) => {
    const normal = write(action, "NM_IMG", `ssf-toolbar-${index}-normal`)
    const pressed = write(action, "HL_IMG", `ssf-toolbar-${index}-pressed`)
    return `<dict><key>Position</key><string>toolbar</string><key>Name</key><string>${id}</string><key>Titles</key><dict><key>Normal</key><dict><key>Normal</key><string>${title}</string><key>Selected</key><string>${title}</string></dict></dict>${images(normal, pressed)}</dict>`
  })
  for (const [id, title, file, position] of IOS_MENU_FILES) {
    const normal = source.file(theme, `${file}.png`)
    if (!normal) continue
    const name = `ssf-menu-${id}`
    archive.setBytes(`${prefix}res/logo/${name}_iphone@3x.png`, normal)
    archive.setBytes(`${prefix}res/logo/${name}-pressed_iphone@3x.png`, source.file(theme, `${file}_p.png`) ?? normal)
    entries.push(`<dict><key>Position</key><string>${position}</string><key>Name</key><string>${id}</string><key>Titles</key><dict><key>Normal</key><dict><key>Normal</key><string>${title}</string></dict></dict>${images(name, `${name}-pressed`)}</dict>`)
  }
  for (const name of ["com.baidu.inputmethod.toolbarMenuItems.plist", "com.baidu.inputmethod.toolbarMenuItems.nijigen.plist"]) {
    archive.setText(`${prefix}res/logo/${name}`, plist(entries))
  }
  const logo = "ssf-toolbar-logo"
  archive.setText(`${prefix}res/logo/customImageConfig.plist`, logoImageConfig(write("F31", "NM_IMG", `${logo}_Normal`), write("F31", "HL_IMG", `${logo}_Highlight`)))
}

/**
 * Installation copies res/logo into port/res and land/res (ThemeInstallRunner). TILE_NUM must exceed the highest
 * index: LogoIconSource.c only reads IMG<n> for n < TILE_NUM, and missing slices fall back to Baidu's default icon.
 */
function writeAndroidMenuIcons(archive: SkinArchive, prefix: string, source: SsfPackage, theme: SsfTheme, slice: Slice): void {
  const icons = ANDROID_ICONS.flatMap(([from, index]) => {
    if (/^F\d+$/.test(from)) return [{ index, image: slice(from, "NM_IMG").image }]
    const bytes = source.file(theme, `${from}.png`)
    return bytes ? [{ index, image: decodePng(bytes) }] : []
  })
  const width = Math.max(...icons.map(({ image }) => image.width))
  const height = icons.reduce((total, { image }) => total + image.height, 0)
  const atlas = placeImage({ width: 0, height: 0, data: new Uint8Array() }, width, height, 0, 0)
  const tiles = ["[GLOBAL]", "USE_ALPHA=1", `TILE_NUM=${Math.max(...icons.map(({ index }) => index)) + 1}`, ""]
  let y = 0
  for (const { index, image } of icons) {
    const placed = placeImage(image, width, image.height, 0, 0)
    atlas.data.set(placed.data, y * width * 4)
    tiles.push(`[IMG${index}]`, `SOURCE_RECT=0,${y},${image.width},${image.height}`, "")
    y += image.height
  }
  archive.setBytes(`${prefix}res/logo/pop_menu_icons.png`, encodePng(atlas))
  archive.setText(`${prefix}res/logo/pop_menu_icons.til`, tiles.join("\n"))
}

/** The LOGO menu takes the candidate bar's text colour and a solid colour sampled from its background. */
function logoMenuStyles(archive: SkinArchive, prefix: string, css: IniDocument, candidates: IniDocument): { back: string; text: string } {
  const text = candidates.get("CAND", "FORE_STYLE")?.trim() ?? ""
  const back = solidColorStyle(css, candidates.get("CAND", "BACK_STYLE")?.trim() ?? "", (resource, tile) => {
    const bytes = archive.getBytes(`${prefix}res/${resource}.png`)
    const rect = archive.isText(`${prefix}res/${resource}.til`)
      ? IniDocument.parse(archive.getText(`${prefix}res/${resource}.til`)).get(`IMG${tile}`, "SOURCE_RECT")?.split(",").map(Number)
      : undefined
    return bytes && rect?.length === 4 ? { bytes, rect } : undefined
  })
  archive.setText(`${prefix}res/default.css`, css.toString())
  return { back, text }
}
