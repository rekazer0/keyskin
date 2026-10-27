// `.sxi` packages are edited natively: `skin.json` is the only source of truth and is saved
// back verbatim. The editor's renderer reads INI layouts, so this module derives read-only
// INI/CSS/TIL views from `skin.json`, each tagged with the JSON pointer it came from.

import { compactPalmJSON, encodePalmJSON, PALM_INT_MAX } from "./palm-json.ts"
import { IniWriter, asObject, type Json, type JsonObject } from "./sxi-ini.ts"
import { boardFileName, boardIni, bubbleIni, candidateIni } from "./sxi-layout.ts"
import { animationsIni, infoIni, stylesIni, tilesIni } from "./sxi-style.ts"

export const SXI_SKIN_PATH = "skin.json"
export const SXI_INFO_PATH = "info.json"

/** A read-only view of skin.json; `writer` knows where each of its values came from. */
/** `writer` maps an INI view's keys back to skin.json; a non-INI view (the toolbar plist) has none. */
export type SxiDerivedFile = { text: string; pointer: string[]; writer?: IniWriter }

const THEMES = [["default", "light"], ["night", "dark"]] as const
const ORIENTATIONS = ["port", "land"] as const

// Swift writes `Int.max` as 9223372036854775807, which a double rounds to 2^63.
export function parseSkinJsonValue(text: string): Json {
  return JSON.parse(text, (_key, item) => item === 9223372036854775807 ? PALM_INT_MAX : item) as Json
}

export function parseSkinJson(text: string): JsonObject {
  const skin = asObject(parseSkinJsonValue(text))
  if (!skin) throw new Error("skin.json 顶层必须是对象")
  return skin
}

// Re-encoding an unmodified skin.json reproduces it byte for byte (sorted keys, Foundation
// number formatting), so a fragment edit only changes that fragment.
export function encodeSkinJson(value: Json): string {
  return encodePalmJSON(value)
}

export function sxiFragment(skin: JsonObject, pointer: string[]): Json {
  let current: Json = skin
  for (const key of pointer) current = asObject(current)?.[key]
  return current
}

export function setSxiFragment(skin: JsonObject, pointer: string[], value: Json): void {
  let current = skin
  for (const key of pointer.slice(0, -1)) {
    const next = asObject(current[key])
    if (!next) throw new Error(`skin.json 中缺少 ${pointer.join(".")}`)
    current = next
  }
  current[pointer[pointer.length - 1]] = value
}

function hasEntries(value: Json): boolean {
  return Object.keys(asObject(value) ?? {}).length > 0
}

export function same(left: Json, right: Json): boolean {
  return compactPalmJSON(left) === compactPalmJSON(right)
}

// AI and other fragment editors address a skin.json part as "skin.json/<key>/<key>/…".
export function sxiFragmentPath(pointer: readonly string[]): string {
  return `${SXI_SKIN_PATH}/${pointer.join("/")}`
}

export function applySxiFragments(skinText: string, fragments: ReadonlyArray<{ path: string; text: string }>): string {
  const skin = parseSkinJson(skinText)
  for (const { path, text } of fragments) setSxiFragment(skin, path.split("/").slice(1), parseSkinJsonValue(text))
  return encodeSkinJson(skin)
}

export function sxiDerivedFiles(skin: JsonObject): Map<string, SxiDerivedFile> {
  const files = new Map<string, SxiDerivedFile>()
  const add = (path: string, pointer: string[], writer: IniWriter) => files.set(path, { text: writer.toString(), pointer, writer })
  if (skin.info !== undefined) add("Info.txt", ["info"], infoIni(skin))

  for (const [themeKey, theme] of THEMES) {
    const struct = asObject(skin[themeKey])
    if (!struct) continue
    for (const orientation of ORIENTATIONS) {
      const layoutKey = `${orientation}_layout`
      const layout = asObject(struct[layoutKey])
      if (!layout) continue
      const directory = `${theme}/skin/${orientation}`
      for (const [type, board] of Object.entries(asObject(layout.b) ?? {})) {
        add(`${directory}/${boardFileName(type)}`, [themeKey, layoutKey, "b", type], boardIni(board))
      }
      for (const [name, cand] of Object.entries(asObject(layout.c) ?? {})) {
        add(`${directory}/${name}.cnd`, [themeKey, layoutKey, "c", name], candidateIni(cand))
      }
      for (const [name, hint] of Object.entries(asObject(layout.h) ?? {})) {
        add(`${directory}/${name}.pop`, [themeKey, layoutKey, "h", name], bubbleIni(hint))
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
        add(`${directory}/default.css`, [themeKey, styleKey, "ss_1"], stylesIni(style.ss_1))
      }
      if (asObject(style.ss_2) && (own || !same(style.ss_2, shared?.ss_2))) {
        add(`${directory}/anim.ini`, [themeKey, styleKey, "ss_2"], animationsIni(style.ss_2))
      }
      const sharedTiles = asObject(shared?.info)
      for (const [name, tiles] of Object.entries(asObject(style.info) ?? {})) {
        if (!own && sharedTiles && name in sharedTiles && same(tiles, sharedTiles[name])) continue
        add(`${directory}/${name}.til`, [themeKey, styleKey, "info", name], tilesIni(tiles))
      }
    }

    // The export drops res/logo's plists and tile maps into `menu`/`a_m`/`a_i`; the toolbar
    // renderer still reads them from res/logo (iOS plist first, Android atlas otherwise).
    const logo = `${theme}/skin/res/logo`
    const menus = Array.isArray(struct.menu) ? struct.menu.filter(Array.isArray) : []
    const menu = menus.find((items) => items.some((item) => asObject(item)?.Position === "toolbar")) ?? menus[0]
    if (menu) files.set(`${logo}/com.baidu.inputmethod.toolbarMenuItems.plist`, { text: toolbarPlist(menu), pointer: [themeKey, "menu"] })
    if (Array.isArray(struct.a_m)) add(`${logo}/pop_menu_icons.til`, [themeKey, "a_m"], tilesIni(struct.a_m))
    if (Array.isArray(struct.a_i)) add(`${logo}/pop_input_icons.til`, [themeKey, "a_i"], tilesIni(struct.a_i))
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
