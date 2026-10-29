// `.sxi` (Palm skin) export.
//
// Ports `PalmSkinConverter.convertSkin` from the Swift reference: the archive payload is
// mirrored into the converter's temporary input folder, the INI/CSS/plist resources are
// parsed into Palm's `PalmSkin` model tree, and the result is repacked as `skin.json`,
// `info.json`, the bundled `native.layout` and the surviving resource files.
//
// Deliberate differences from the Swift tool:
// - `i` (the Info.txt URL) uses the archive's canonical relative path instead of the
//   exporter's absolute temporary path, so the output is machine independent.
// - `dir`/`root` stay empty, `platform` is always "ia", `tool_version` is 3 and
//   `layoutSupport` is true (KeySkin ships no converter config).
// - "B<x>" button shorthands resolve in `SkinButtonType` order; the Swift build depends on
//   dictionary ordering there and is not reproducible.
// - Zip entries are written in sorted converter-relative order and emptied directories keep
//   an explicit entry, matching the layout the Palm app expects.

import { zipSync } from "fflate"
import type { SkinArchive } from "../skin.ts"
import { buildAnimationWrap } from "./palm-animation.ts"
import { boardTypeFromIniFileName } from "./palm-board-types.ts"
import { NATIVE_LAYOUT_JSON } from "./palm-native-layout.ts"
import { decodeSkinText, parseIniSections, toBool, toInt, type IniSection } from "./palm-ini.ts"
import { encodePalmJSON, type PalmJSONValue } from "./palm-json.ts"
import {
  additionModel,
  baseModel,
  boardDrawModel,
  bubbleIconModel,
  bubbleModel,
  buttonFixModel,
  buttonModel,
  candidateIconModel,
  candidateModel,
  candidateSwitchModel,
  composeModel,
  constModel,
  emoticonModel,
  helpCandModel,
  indexKey,
  infoModel,
  motiveModel,
  posFixModel,
  tableModel,
  tileModels,
} from "./palm-models.ts"
import { parseXmlPlist, type PalmPlistValue } from "./palm-plist.ts"
import { fixTouchRects } from "./palm-touch-rect.ts"
import {
  PalmVirtualRoot,
  comparePalmDirectoryPaths,
  normalizePalmPath,
  palmBaseName,
  palmJoinPath,
} from "./palm-vfs.ts"

type Json = PalmJSONValue
type Ini = Record<string, string>

// `deleteFiles(matchExt:)` from both `PalmSkin.convert` and `PalmSkinConverter`.
const DELETED_EXTENSIONS = new Set(["ini", "pop", "cnd", "css", "txt", "bdi", "til", "plist"])

// `renamePreviewImage` only rewrites `demo.png` directly inside these folders.
const PREVIEW_DIRECTORIES = new Set(["", "dark/", "light/", "dark/skin/", "light/skin/"])

const PREVIEW_PREFIX = "file:///"

type ConverterEntry = {
  path: string
  directory: boolean
  bytes?: Uint8Array
}

type SkinStruct = {
  dir: string
  themeSkinDir: string
  info: string
  land?: string[]
  port?: string[]
  res?: string[]
  portRes?: string[]
  landRes?: string[]
  logo: string[]
}

type ExportContext = {
  root: PalmVirtualRoot
  warnings: string[]
  sections: Map<string, IniSection[] | undefined>
}

/* ------------------------------------------------------------------ helpers */

function fileExtension(path: string): string {
  const name = palmBaseName(path)
  const separator = name.lastIndexOf(".")
  return separator <= 0 ? "" : name.slice(separator + 1).toLowerCase()
}

function stripExtension(path: string): string {
  const name = palmBaseName(path)
  const separator = name.lastIndexOf(".")
  return separator <= 0 ? name : name.slice(0, separator)
}

/* --------------------------------------------------------------- ini access */

function sectionsOf(context: ExportContext, path: string): IniSection[] | undefined {
  if (context.sections.has(path)) return context.sections.get(path)
  const bytes = context.root.bytes(path)
  let sections: IniSection[] | undefined
  if (bytes !== undefined) {
    const text = decodeSkinText(bytes)
    if (text === undefined) {
      context.warnings.push(`无法解析文本文件：${path}`)
    } else {
      sections = parseIniSections(text)
    }
  }
  context.sections.set(path, sections)
  return sections
}

function findResource(res: string[] | undefined, name: string): string | undefined {
  return res?.find((path) => palmBaseName(path) === name)
}

function readResource(context: ExportContext, resource: string[] | undefined, name: string): IniSection[] | undefined {
  const path = findResource(resource, name)
  return path === undefined ? undefined : sectionsOf(context, path)
}

/* ------------------------------------------------------------------- models */

// `SkinCandidateModel(fileURL:)` for `*.cnd`.
function candidateModelFromFile(context: ExportContext, path: string): Json {
  const sections = sectionsOf(context, path) ?? []
  const model: Record<string, Json> = { b: undefined, fix: undefined, switch: undefined, icon_list: [] }
  const icons: Json[] = []
  const tips: Record<string, Json> = {}
  for (const section of sections) {
    if (section.name === "CAND") {
      // Keep earlier sections: `setupWithEntries` only owns the keys it writes.
      for (const [key, value] of Object.entries(candidateModel(section.entries))) {
        if (value !== undefined) model[key] = value
      }
    } else if (section.name === "SWITCH") {
      model.switch = candidateSwitchModel(section.entries)
    } else if (section.name.startsWith("ICON")) {
      icons.push(candidateIconModel(section.entries))
    } else if (section.name.startsWith("TIP")) {
      const index = indexKey(section.name, "TIP")
      if (index !== undefined) tips[String(index)] = buttonFixModel(section.entries)
    }
  }
  // Icon placement comes from POS/SIZE; `f_size` only fixes it. Dropping every icon because
  // one lacks a fixed size loses the candidate bar's artwork for most real Baidu skins.
  model.icon_list = icons
  // `SkinCandidateModel(fileURL:)` assigns `tips` unconditionally, empty included.
  model.fix = tips
  return model
}

const BUBBLE_TYPES: Array<[number, string]> = [
  [0, "hint"],
  [1, "bar"],
  [2, "up"],
  [3, "down"],
  [4, "left"],
  [5, "right"],
]

// `SkinBubbleModel(fileURL:)` for `*.pop`: the index map is stored as a flat array.
function bubbleModelFromFile(context: ExportContext, path: string): Json {
  const sections = sectionsOf(context, path) ?? []
  const model: Record<string, Json> = {}
  const indexes = new Map<number, number>()
  const icons: Record<string, Json> = {}
  for (const section of sections) {
    const entries = section.entries
    if (section.name === "HINT") {
      const index = toInt(entries["BACK_ICON"])
      if (index !== undefined) indexes.set(0, index)
    } else if (section.name === "DRAW") {
      const up = toInt(entries["ICON_UP"])
      const down = toInt(entries["ICON_DN"])
      const left = toInt(entries["ICON_LT"])
      const right = toInt(entries["ICON_RT"])
      if (up !== undefined) indexes.set(2, up)
      if (down !== undefined) indexes.set(3, down)
      if (left !== undefined) indexes.set(4, left)
      if (right !== undefined) indexes.set(5, right)
    } else if (section.name === "BAR") {
      const index = toInt(entries["BACK_ICON"])
      if (index !== undefined) indexes.set(1, index)
      const cell = toInt(entries["CELL_STYLE"])
      if (cell !== undefined) model.i_cell = cell
    } else if (section.name.startsWith("ICON")) {
      const index = indexKey(section.name, "ICON")
      if (index !== undefined) icons[String(index)] = bubbleIconModel(entries)
    }
  }
  const flat: number[] = []
  for (const [type] of BUBBLE_TYPES) {
    const index = indexes.get(type)
    if (index === undefined) continue
    flat.push(type, index)
  }
  // `SkinBubbleModel.encode` always writes both maps once `parse(url:)` ran.
  model.info = flat
  model.icon_info = icons
  return model
}

// `SkinLogoInfoModel` ([LOGO]) — `layoutName` is not part of the encoded model.
function logoModel(context: ExportContext, entries: Ini, filePath: string): Json {
  const base = baseModel(entries)
  const layoutName = entries["LAYOUT_NAME"]
  if (layoutName === undefined) return { b: base }
  const directory = filePath.slice(0, Math.max(0, filePath.lastIndexOf("/")))
  const logoPath = palmJoinPath(directory, `${layoutName}.ini`)
  const sections = sectionsOf(context, logoPath)
  if (sections === undefined) {
    context.warnings.push(`找不到 logo 布局：${logoPath} (from ${filePath})`)
    return { b: base }
  }
  let iconIndex: number | undefined
  let panelBase = base
  for (const section of sections) {
    if (section.name !== "PANEL") continue
    panelBase = baseModel(section.entries)
    iconIndex = toInt(section.entries["ICON_INDEX"])
  }
  const model: Record<string, Json> = { b: panelBase }
  if (iconIndex === undefined) return model
  for (const section of sections) {
    if (section.name !== `ICON${iconIndex}`) continue
    model.b_b = toInt(section.entries["BACK_STYLE"])
    model.b_f = toInt(section.entries["FORE_STYLE"])
    model.b_t = toInt(section.entries["TEXT_STYLE"])
  }
  return model
}

/* -------------------------------------------------------------- skin layout */

function keyboardModel(context: ExportContext, path: string, type: string): Json {
  const sections = sectionsOf(context, path) ?? []
  const model: Record<string, Json> = {}
  const keys: Json[] = []
  const tips: Record<string, Json> = {}
  const offsets: Record<string, Json> = {}
  const forces: Json[] = []
  for (const section of sections) {
    const name = section.name
    if (name === "GLOBAL") model.comm = constModel(section.entries)
    else if (name === "INPUT") model.input = composeModel(section.entries)
    else if (name === "CAND") model.cand = candidateModel(section.entries)
    else if (name === "PANEL") model.board = boardDrawModel(section.entries)
    else if (name === "HINT") model.hint = bubbleModel(section.entries)
    else if (name === "LOGO") model.logo = logoModel(context, section.entries, path)
    else if (name === "EMOJI") model.emoji = emoticonModel(section.entries)
    else if (name === "MORE") model.more = additionModel(section.entries)
    else if (name === "LIST") model.list = tableModel(section.entries)
    else if (name === "SEGMENT") model.seg = tableModel(section.entries)
    else if (name === "SCAND") model.top_cand = helpCandModel(section.entries)
    else if (name.startsWith("KEY")) keys.push(buttonModel(section.entries, name))
    else if (name.startsWith("TIP")) {
      const index = indexKey(name, "TIP")
      if (index !== undefined) tips[String(index)] = buttonFixModel(section.entries)
    } else if (name.startsWith("OFFSET")) {
      const index = indexKey(name, "OFFSET")
      if (index !== undefined) offsets[String(index)] = posFixModel(section.entries)
    } else if (name.startsWith("FORCE")) {
      forces.push(motiveModel(section.entries))
    }
  }
  model.keys = keys
  model.key_fix = tips
  model.offset = offsets
  model.force = forces
  model.type = type
  return model
}

function layoutJson(context: ExportContext, paths: string[] | undefined): Json {
  if (paths === undefined) return undefined
  const maps: Record<string, Json> = {}
  const cands: Record<string, Json> = {}
  const hints: Record<string, Json> = {}
  for (const path of paths) {
    if (path.endsWith(".ini")) {
      const name = palmBaseName(path)
      const type = boardTypeFromIniFileName(name) ?? name.replace(/\.ini/g, "")
      maps[type] = keyboardModel(context, path, type)
    } else if (path.endsWith(".cnd")) {
      cands[stripExtension(path)] = candidateModelFromFile(context, path)
    } else if (path.endsWith(".pop")) {
      hints[stripExtension(path)] = bubbleModelFromFile(context, path)
    }
  }
  fixTouchRects(maps)
  return { b: maps, c: cands, h: hints }
}

/* -------------------------------------------------------------------- style */

// `SkinStyle` (s_info / s_land / s_port).
function styleJson(context: ExportContext, res: string[] | undefined): Json {
  const skinStyles: Record<string, Json> = {}
  const animStyles: Record<string, Json> = {}
  let skinTileMap: Record<string, Json> | undefined

  for (const section of readResource(context, res, "default.css") ?? []) {
    if (!section.name.startsWith("STYLE")) continue
    const index = indexKey(section.name, "STYLE")
    if (index === undefined) continue
    skinStyles[String(index)] = infoModel(section.entries, section.name)
  }

  for (const section of readResource(context, res, "anim.ini") ?? []) {
    if (!section.name.startsWith("ANIM") && !section.name.startsWith("BUILD_NUM")) continue
    const wrap = buildAnimationWrap(section)
    if (wrap === undefined) continue
    const index = indexKey(section.name, "ANIM")
    if (index === undefined) continue
    animStyles[String(index)] = wrap
  }

  if (res !== undefined) {
    const map: Record<string, Json> = {}
    for (const path of res) {
      if (!palmBaseName(path).toLowerCase().endsWith(".til")) continue
      const sections = sectionsOf(context, path)
      if (sections === undefined) continue
      map[stripExtension(path)] = tileModels(sections)
    }
    skinTileMap = map
  }

  return { ss_1: skinStyles, ss_2: animStyles, ss_3: [], ss_4: [], ss_5: [], info: skinTileMap }
}

/* ------------------------------------------------------------------ toolbar */

function toolbarItem(value: PalmPlistValue): Json | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, PalmPlistValue>
  const position = record["Position"]
  const name = record["Name"]
  const titles = record["Titles"]
  const images = record["Images"]
  if (typeof position !== "string" || typeof name !== "string") return undefined
  if (typeof titles !== "object" || titles === null || Array.isArray(titles)) return undefined
  const normalTitle = (titles as Record<string, PalmPlistValue>)["Normal"]
  if (typeof normalTitle !== "object" || normalTitle === null || Array.isArray(normalTitle)) return undefined
  const titleDetail = normalTitle as Record<string, PalmPlistValue>
  if (typeof titleDetail["Normal"] !== "string" || typeof titleDetail["Selected"] !== "string") return undefined
  if (typeof images !== "object" || images === null || Array.isArray(images)) return undefined
  const imageRecord = images as Record<string, PalmPlistValue>
  const normal = imageDetail(imageRecord["Normal"])
  const theme = imageDetail(imageRecord["Theme"])
  if (normal === undefined || theme === undefined) return undefined
  return {
    Position: position,
    Name: name,
    Titles: { Normal: { Normal: titleDetail["Normal"], Selected: titleDetail["Selected"] } },
    Images: { Normal: normal, Theme: theme },
  }
}

function imageDetail(value: PalmPlistValue | undefined): Json | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, PalmPlistValue>
  const normal = record["Normal"]
  if (typeof normal !== "string") return undefined
  const highlight = record["Highlight"]
  const selected = record["Selected"]
  return {
    Normal: normal,
    Highlight: typeof highlight === "string" ? highlight : undefined,
    Selected: typeof selected === "string" ? selected : undefined,
  }
}

function toolbarMenu(context: ExportContext, logo: string[]): Json {
  // `menu` is positional rather than a set, so it has to replay the converter's own
  // directory order instead of the sorted order `childPaths()` hands out elsewhere.
  const paths = logo
    .filter((path) => path.includes("toolbarMenuItems"))
    .sort(comparePalmDirectoryPaths)
  if (paths.length === 0) return undefined
  const result: Json[] = []
  for (const path of paths) {
    const bytes = context.root.bytes(path.slice(1))
    const plist = bytes === undefined ? undefined : parseXmlPlist(bytes)
    if (!Array.isArray(plist)) return undefined
    const items: Json[] = []
    for (const value of plist) {
      const item = toolbarItem(value)
      if (item === undefined) return undefined
      items.push(item)
    }
    result.push(items)
  }
  return result.length === 0 ? undefined : result
}

function menuIcon(context: ExportContext, logo: string[], name: string): Json {
  const path = logo.find((entry) => entry.includes(name))
  if (path === undefined) return undefined
  const sections = sectionsOf(context, path.slice(1))
  return sections === undefined ? undefined : tileModels(sections)
}

/* ------------------------------------------------------------------- struct */

function structModel(context: ExportContext, dir: string): SkinStruct {
  const skinDir = context.root.isDirectory(palmJoinPath(dir, "skin")) ? palmJoinPath(dir, "skin") : dir
  const res = filesPathInDirectory(context.root, palmJoinPath(skinDir, "res"))
  let portRes = filesPathInDirectory(context.root, palmJoinPath(skinDir, "port/res"))
  let landRes = filesPathInDirectory(context.root, palmJoinPath(skinDir, "land/res"))
  if (res !== undefined && res.length > 0) {
    if (portRes !== undefined) portRes = [...portRes, ...res]
    if (landRes !== undefined) landRes = [...landRes, ...res]
  }
  return {
    dir,
    themeSkinDir: skinDir,
    info: palmJoinPath(dir, "Info.txt"),
    land: context.root.filesInDirectory(palmJoinPath(skinDir, "land")),
    port: context.root.filesInDirectory(palmJoinPath(skinDir, "port")),
    res,
    portRes,
    landRes,
    logo: context.root.allFiles(palmJoinPath(skinDir, "res/logo")).map((path) => `/${path}`),
  }
}

// `FileManager.filesPathInDirectory(atURL:rootDir:)`: immediate children relative to root.
function filesPathInDirectory(root: PalmVirtualRoot, folder: string): string[] | undefined {
  if (!root.isDirectory(folder)) return undefined
  return root.childPaths(folder)
}

// `SkinFile.removeUselessPath()`.
function removeUselessPath(res: string[] | undefined): string[] | undefined {
  return res?.filter((path) => !path.endsWith(".til"))
}

// Styles a style set holds; the app reads a few global objects (the candidate/list cell
// backgrounds) from the shared `s_info` table, so it cannot be left empty.
function styleCount(style: Json | undefined): number {
  const set = style && typeof style === "object" && !Array.isArray(style) ? (style as Record<string, Json>).ss_1 : undefined
  return set && typeof set === "object" && !Array.isArray(set) ? Object.keys(set).length : 0
}

/** `s_info` plus the orientation overrides the source skin actually ships. */
function styleSets(context: ExportContext, struct: SkinStruct): { info: Json; port?: Json; land?: Json } {
  const info = styleJson(context, struct.res)
  const port = struct.portRes === undefined ? undefined : styleJson(context, struct.portRes)
  const land = struct.landRes === undefined ? undefined : styleJson(context, struct.landRes)
  if (styleCount(info) > 0) return { info, port, land }
  // BDS skins often keep the whole style table in each orientation's `res/` folder. Publish one
  // of them as the shared table as well; `s_port`/`s_land` still carry their own copies.
  const fallback = styleCount(port) > 0 ? port : styleCount(land) > 0 ? land : undefined
  return fallback === undefined ? { info, port, land } : { info: fallback, port, land }
}

function skinFileJson(context: ExportContext, struct: SkinStruct): Json {
  const res = removeUselessPath(struct.res)
  const portRes = removeUselessPath(struct.portRes)
  const landRes = removeUselessPath(struct.landRes)
  const logo = struct.logo.filter((path) => !path.endsWith(".plist"))
  const styles = styleSets(context, struct)
  const model: Record<string, Json> = {
    land_layout: layoutJson(context, struct.land),
    port_layout: layoutJson(context, struct.port),
    r_info: res,
    r_logo: logo,
    r_land: landRes,
    r_port: portRes,
    // The converter mirrors its temporary input folder, so `i` stays converter relative.
    i: PREVIEW_PREFIX + struct.info,
    s_info: styles.info,
    dir: "",
    // `menu`/`a_m`/`a_i` are built during `parseINIFiles`, before `removeUselessPath()`
    // drops the `.plist` entries from `r_logo`, so they see the unfiltered list.
    menu: toolbarMenu(context, struct.logo),
    a_m: menuIcon(context, struct.logo, "pop_menu_icons.til"),
    a_i: menuIcon(context, struct.logo, "pop_input_icons.til"),
  }
  if (styles.port !== undefined) model.s_port = styles.port
  if (styles.land !== undefined) model.s_land = styles.land
  return model
}

/* --------------------------------------------------------------- info.json */

function skinInfoJson(context: ExportContext, infoPath: string): Json {
  const bytes = context.root.bytes(infoPath)
  const text = bytes === undefined ? undefined : decodeSkinText(bytes)
  if (text === undefined) {
    return {
      name: "default",
      description: "",
      author: "",
      platform: "ia",
      tool_version: 3,
      core_ability: 0,
      dark_mode: true,
      layoutSupport: true,
      splitImage: false,
    }
  }
  let name = ""
  let description = ""
  let author = ""
  let darkMode: boolean | undefined
  let ability: number | undefined
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const parts = line.split("=")
    if (parts.length !== 2) continue
    const key = parts[0].trim()
    const value = parts[1].trim()
    if (key === "Name") name = value
    else if (key === "Description") description = value
    else if (key === "Author") author = value
    else if (key === "SupportDarkMode") darkMode = toBool(value) ?? false
    else if (key === "MinImeCode") ability = toInt(value) ?? 0
  }
  return {
    name,
    description,
    author,
    platform: "ia",
    tool_version: 3,
    core_ability: ability ?? 0,
    dark_mode: darkMode ?? false,
    layoutSupport: true,
    splitImage: false,
  }
}

/* ------------------------------------------------------------------- output */

function collectConverterEntries(archive: SkinArchive): ConverterEntry[] {
  const raws = archive.names().map((canonical) => {
    const raw = archive.sourcePath(canonical)
    return { canonical, raw, normalized: normalizePalmPath(raw), directory: raw.endsWith("/") }
  })
  const usesSkinRoot = raws.some(({ normalized }) => normalized === "skin" || normalized.startsWith("skin/"))
  const entries: ConverterEntry[] = []
  for (const item of raws) {
    let path = item.normalized
    if (usesSkinRoot) {
      if (!path.startsWith("skin/")) continue
      path = path.slice("skin/".length)
    }
    if (!path) continue
    entries.push({
      path,
      directory: item.directory,
      bytes: item.directory ? undefined : archive.getBytes(item.canonical),
    })
  }
  return entries
}

// Folders that survive the deletion passes with no file left inside them still need an
// explicit zip entry: the real `.sxi` keeps, for example, `light/skin/land/`.
function emptyDirectories(entries: ConverterEntry[], written: Iterable<string>): string[] {
  const directories = new Set<string>()
  for (const entry of entries) {
    const parts = entry.path.split("/")
    const parentParts = entry.directory ? parts : parts.slice(0, -1)
    let parent = ""
    for (const part of parentParts) {
      parent = parent ? `${parent}/${part}` : part
      directories.add(parent)
    }
  }
  const populated = new Set<string>()
  for (const path of written) {
    const parts = path.split("/")
    let current = ""
    for (const part of parts.slice(0, -1)) {
      current = current ? `${current}/${part}` : part
      populated.add(current)
    }
  }
  return [...directories].filter((directory) => !populated.has(directory)).sort()
}

export function buildSxiZip(archive: SkinArchive): { bytes: Uint8Array; warnings: string[] } {
  if (archive.format === "bda") {
    // BDA packages carry protobuf panels instead of an INI layout tree, so a caller that
    // reaches this point must convert the archive first (see `convertBdaToBaseLayout`).
    throw new Error("BDA 皮肤需要先转换为 BDI/BDS 布局再导出手心皮肤（.sxi）")
  }

  const entries = collectConverterEntries(archive)
  const warnings: string[] = []
  const context: ExportContext = {
    root: new PalmVirtualRoot(entries.map((entry) => ({ path: entry.path, bytes: entry.bytes }))),
    warnings,
    sections: new Map(),
  }

  const skinDir = context.root.isDirectory("skin") ? "skin" : ""
  const infoPath = palmJoinPath(skinDir, "Info.txt")
  const lightStruct = structModel(context, palmJoinPath(skinDir, "light"))
  const darkStruct = structModel(context, palmJoinPath(skinDir, "dark"))
  const hasLight = context.root.isDirectory(palmJoinPath(skinDir, "light"))
  const hasDark = context.root.isDirectory(palmJoinPath(skinDir, "dark"))

  const skin: Record<string, Json> = {
    root: "",
    default: skinFileJson(context, hasLight ? lightStruct : structModel(context, skinDir)),
    night: hasDark ? skinFileJson(context, darkStruct) : undefined,
    info: skinInfoJson(context, infoPath),
    demo: undefined,
  }

  const files: Record<string, Uint8Array> = {
    "skin.json": new TextEncoder().encode(encodePalmJSON(skin)),
    "info.json": new TextEncoder().encode(encodePalmJSON(skinJsonInfo(skin))),
  }
  const written = new Set<string>()
  for (const entry of entries) {
    if (entry.directory) continue
    if (DELETED_EXTENSIONS.has(fileExtension(entry.path))) continue
    const preview = previewPath(entry.path)
    const name = preview !== undefined && files[preview] === undefined ? preview : entry.path
    files[name] = entry.bytes ?? new Uint8Array()
    written.add(name)
  }
  for (const directory of emptyDirectories(entries, written)) {
    files[`${directory}/`] = new Uint8Array()
  }

  // `copyLayoutIfNeed` copies the bundled `native_325.json` into the output folder so a
  // standalone skin can resolve its `native` specify-layout. The Swift call is `try?`, so a
  // source file already named `native.layout` survives untouched.
  if (files["native.layout"] === undefined) {
    files["native.layout"] = new TextEncoder().encode(NATIVE_LAYOUT_JSON)
  }

  return { bytes: zipSync(files, { level: 6 }), warnings }
}

function skinJsonInfo(skin: Record<string, Json>): Json {
  return skin.info
}

function previewPath(path: string): string | undefined {
  const separator = path.lastIndexOf("/")
  const parent = separator < 0 ? "" : path.slice(0, separator + 1)
  if (path.slice(parent.length) !== "demo.png") return undefined
  return PREVIEW_DIRECTORIES.has(parent) ? `${parent}preview.png` : undefined
}
