// Palm `.sxi` document → Baidu `bdi`/`bds` package, on export only.
//
// `skin.json` is written out as the Baidu INI/CSS/TIL files it stands for (the inverse of
// `palm-export.ts`), the archive's resources are laid out under the Baidu theme folders, and the
// result is repackaged exactly like a document that was opened as BDS/BDI. A BDA target reuses
// the Sogou converters that already paint a Baidu INI skin onto the official BDA template.

import { strToU8, zipSync } from "fflate"
import { IniDocument } from "../ini.ts"
import { SkinArchive } from "../skin.ts"
import { convertBaiduToSsf } from "../ssf/baidu-to-ssf.ts"
import { SsfPackage } from "../ssf/ssf-package.ts"
import { convertSsfToBda } from "../ssf/ssf-to-bda.ts"
import { asObject, type Json, type JsonObject } from "./sxi-ini.ts"
import { parseSkinJson, same } from "./sxi-json.ts"
import { boardFileName, boardIni, bubbleIni, candidateIni } from "./sxi-layout.ts"
import { animationsIni, infoIni, stylesIni, tilesIni } from "./sxi-style.ts"

type Converted = { bytes: Uint8Array; warnings: string[] }

const THEMES = ["light", "dark"] as const
type Theme = typeof THEMES[number]

// `skin.json` carries the configuration itself; the other files are source metadata for the
// Palm app, not part of a Baidu package.
const PALM_ONLY = new Set(["skin.json", "info.json", "native.layout"])

function themesOf(skin: ReturnType<typeof parseSkinJson>): Theme[] {
  return THEMES.filter((theme) => theme === "light" ? skin.default !== undefined : skin.night !== undefined)
}

/** `light/skin/res/bg.png` etc. of a Palm archive, mapped to the Baidu theme layout. */
function baiduPath(canonical: string, themes: Theme[]): { directory: string; path: string } | undefined {
  for (const theme of themes) {
    const prefix = `${theme}/skin/`
    if (canonical.startsWith(prefix)) {
      const path = canonical.slice(prefix.length)
      return { directory: themes.length > 1 ? theme : "", path }
    }
  }
}

function count(document: IniDocument, pattern: RegExp): number {
  return document.sections().filter((section) => pattern.test(section)).length
}

/** The layouts carry what a Baidu renderer reads; a Baidu package also needs its section counters. */
function completeLayout(text: string, fileName: string): string {
  const document = IniDocument.parse(text)
  if (!document.sections().includes("PANEL")) return text
  if (fileName === "gen.ini") {
    const more = document.sections().includes("MORE")
    if (more && document.get("MORE", "SYM_LAYOUT") === undefined) document.set("MORE", "SYM_LAYOUT", "symbol")
  }
  const keys = count(document, /^KEY\d+$/)
  const tips = count(document, /^TIP\d+$/)
  const offsets = count(document, /^OFFSET\d+$/)
  if (keys) document.set("PANEL", "KEY_NUM", String(keys))
  if (tips) document.set("PANEL", "TIP_NUM", String(tips))
  if (offsets) document.set("PANEL", "OFFSET_NUM", String(offsets))
  return document.toString()
}

const THEMES_BY_KEY = [["default", "light"], ["night", "dark"]] as const
const ORIENTATIONS = ["port", "land"] as const

function hasEntries(value: Json): boolean {
  return Object.keys(asObject(value) ?? {}).length > 0
}

/** The Baidu files (path → text) `skin` stands for: layouts, bars, bubbles, styles, animations and tile maps. */
export function sxiBaiduFiles(skin: JsonObject): Map<string, string> {
  const files = new Map<string, string>()
  const add = (path: string, writer: { toString(): string }) => files.set(path, writer.toString())
  if (skin.info !== undefined) add("Info.txt", infoIni(skin))

  for (const [themeKey, theme] of THEMES_BY_KEY) {
    const struct = asObject(skin[themeKey])
    if (!struct) continue
    for (const orientation of ORIENTATIONS) {
      const layoutKey = `${orientation}_layout`
      const layout = asObject(struct[layoutKey])
      if (!layout) continue
      const directory = `${theme}/skin/${orientation}`
      for (const [type, board] of Object.entries(asObject(layout.b) ?? {})) {
        add(`${directory}/${boardFileName(type)}`, boardIni(board))
      }
      for (const [name, cand] of Object.entries(asObject(layout.c) ?? {})) {
        add(`${directory}/${name}.cnd`, candidateIni(cand))
      }
      for (const [name, hint] of Object.entries(asObject(layout.h) ?? {})) {
        add(`${directory}/${name}.pop`, bubbleIni(hint))
      }
    }

    // `s_port`/`s_land` merge the orientation `res` over the shared one; only what differs
    // from `s_info` lives in the orientation folder.
    const shared = asObject(struct.s_info)
    const styleSets: Array<[string, string]> = [["s_info", `${theme}/skin/res`], ["s_port", `${theme}/skin/port/res`], ["s_land", `${theme}/skin/land/res`]]
    for (const [styleKey, directory] of styleSets) {
      const style = asObject(struct[styleKey])
      if (!style) continue
      const own = styleKey === "s_info"
      if (hasEntries(style.ss_1) && (own || !same(style.ss_1, shared?.ss_1))) {
        add(`${directory}/default.css`, stylesIni(style.ss_1))
      }
      if (asObject(style.ss_2) && (own || !same(style.ss_2, shared?.ss_2))) {
        add(`${directory}/anim.ini`, animationsIni(style.ss_2))
      }
      const sharedTiles = asObject(shared?.info)
      for (const [name, tiles] of Object.entries(asObject(style.info) ?? {})) {
        if (!own && sharedTiles && name in sharedTiles && same(tiles, sharedTiles[name])) continue
        add(`${directory}/${name}.til`, tilesIni(tiles))
      }
    }

    // Palm keeps res/logo's plists and tile maps in `menu`/`a_m`/`a_i`; a Baidu package reads them
    // from res/logo (iOS plist first, Android atlas otherwise).
    const logo = `${theme}/skin/res/logo`
    const menus = Array.isArray(struct.menu) ? struct.menu.filter(Array.isArray) : []
    const menu = menus.find((items) => items.some((item) => asObject(item)?.Position === "toolbar")) ?? menus[0]
    if (menu) files.set(`${logo}/com.baidu.inputmethod.toolbarMenuItems.plist`, toolbarPlist(menu))
    if (Array.isArray(struct.a_m)) add(`${logo}/pop_menu_icons.til`, tilesIni(struct.a_m))
    if (Array.isArray(struct.a_i)) add(`${logo}/pop_input_icons.til`, tilesIni(struct.a_i))
  }
  return files
}

// Menu items hold only strings and dicts.
function plistValue(value: Json): string {
  if (typeof value === "string") return `<string>${value.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</string>`
  if (Array.isArray(value)) return `<array>${value.map(plistValue).join("")}</array>`
  return `<dict>${Object.entries(asObject(value) ?? {}).map(([key, item]) => `<key>${key}</key>${plistValue(item)}`).join("")}</dict>`
}

function toolbarPlist(items: Json[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">${plistValue(items)}</plist>\n`
}

/**
 * The Baidu BDS archive an `.sxi` document stands for. Layouts, styles and tile maps are written
 * from `skin.json`; images, sounds and fonts are the Palm archive's own resources.
 */
export function sxiToBaiduArchive(archive: SkinArchive): SkinArchive {
  if (archive.format !== "sxi") throw new Error("只有手心皮肤（.sxi）需要转换")
  const skin = parseSkinJson(archive.getText("skin.json"))
  const themes = themesOf(skin)
  if (!themes.length) throw new Error("skin.json 中没有可转换的外观")
  const derived = sxiBaiduFiles(skin)
  const files: Record<string, Uint8Array> = {}
  const add = (directory: string, path: string, bytes: Uint8Array) => {
    files[directory ? `${directory}/${path}` : path] = bytes
  }

  for (const [canonical, text] of derived) {
    if (canonical === "Info.txt") continue
    const mapped = baiduPath(canonical, themes)
    if (mapped) add(mapped.directory, mapped.path, strToU8(completeLayout(text, mapped.path.split("/").pop()!)))
  }
  // The archive's own resources keep their paths; a layout written from skin.json wins over one
  // that the package already stored for the same path.
  for (const canonical of archive.names()) {
    if (PALM_ONLY.has(canonical) || derived.has(canonical) || canonical.endsWith("/")) continue
    const mapped = baiduPath(canonical, themes)
    if (!mapped || /^(?:preview|demo)\.png$/i.test(mapped.path)) continue
    const bytes = archive.getBytes(canonical)
    if (bytes) add(mapped.directory, mapped.path, bytes)
  }

  const info = derived.get("Info.txt")
  if (!info) throw new Error("skin.json 中缺少皮肤信息")
  files["Info.txt"] = strToU8(info)
  const preview = archive.getBytes("preview.png") ?? archive.getBytes("light/skin/preview.png")
  if (preview) files["demo.png"] = preview

  return SkinArchive.open(zipSync(files, { level: 6 }))
}

/** Repackages an `.sxi` document as an Android `.bds` or iOS `.bdi` skin, key sounds included. */
export async function convertSxiToBaidu(archive: SkinArchive, format: "bdi" | "bds"): Promise<Converted> {
  const converted = sxiToBaiduArchive(archive)
  const warnings: string[] = []
  const bytes = await converted.platformBytesAsync(format, warnings)
  return { bytes, warnings }
}

/**
 * Repackages an `.sxi` document as BDA on the official BDA template. BDA's appearance configs are
 * a different format, so the skin first takes the Baidu INI shape and is then painted through the
 * Sogou converters, the same two steps a real conversion would take.
 */
export async function convertSxiToBda(archive: SkinArchive, template: SkinArchive): Promise<Converted> {
  if (template.format !== "bda") throw new Error("BDA 转换需要 BDA 模板")
  const converted = sxiToBaiduArchive(archive)
  const ssf = await convertBaiduToSsf(converted)
  const pkg = await SsfPackage.open(ssf.bytes)
  const bda = convertSsfToBda(pkg, template)
  return { bytes: bda.archive.toBytes(), warnings: [...ssf.warnings, ...bda.warnings] }
}
