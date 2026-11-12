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

import { SkinArchive } from "../skin.ts"
import { zipArchiveAsync } from "../skin-zip.ts"
import { buildAnimationWrap } from "./palm-animation.ts"
import { fitCandidateIcons, fitEnglishEnter, removeMissingAnimationKeys } from "./palm-export-layout.ts"
import { separateOrientationResources } from "./palm-export-resources.ts"
import { bakeBackgrounds, bakeBackgroundsSteps } from "./palm-export-backgrounds.ts"
import { assembleSxiFiles, collectConverterEntries, packSxiFiles, type ConverterEntry } from "./palm-export-package.ts"
import { fitToolbarArtwork, prepareToolbarIcons } from "./palm-export-toolbar.ts"
import { boardTypeFromIniFileName } from "./palm-board-types.ts"
import { decodeSkinText, parseIniSections, toBool, toInt, type IniSection } from "./palm-ini.ts"
import { type PalmJSONValue } from "./palm-json.ts"
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
import { asObject, type JsonObject } from "./sxi-ini.ts"
import { parseXmlPlist, type PalmPlistValue } from "./palm-plist.ts"
import { fixTouchRects } from "./palm-touch-rect.ts"
import { animationsIni } from "./sxi-style.ts"
import {
  PalmVirtualRoot,
  comparePalmDirectoryPaths,
  palmBaseName,
  palmJoinPath,
} from "./palm-vfs.ts"

type Json = PalmJSONValue
type Ini = Record<string, string>

const PREVIEW_PREFIX = "file:///"

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
  entries: ConverterEntry[]
}

/* ------------------------------------------------------------------ helpers */

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

// The order Palm's own skins list the candidate bar's icons in; anything else keeps its `.cnd` order after them.
const CANDIDATE_ICON_ORDER = ["logoMenu", "switchContainer", "hideBoard", "moreCandidates"]

function candidateIconRank(value: Json): number {
  const at = CANDIDATE_ICON_ORDER.indexOf(String(asObject(value)?.k ?? ""))
  return at < 0 ? CANDIDATE_ICON_ORDER.length : at
}
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
  // Palm's own skins always list the bar's icons in this order; a `.cnd` numbers them freely (this skin's
  // ICON4 is the switch container), and keeping that order draws the toolbar container last.
  model.icon_list = icons.sort((left, right) => candidateIconRank(left) - candidateIconRank(right))
  // Palm uses these vertical insets to move the word row; Baidu's candidate words stay centred.
  const insets = asObject(model.insets)
  if (insets) model.insets = { ...insets, top: 0, bottom: 0 }
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
  fitEnglishEnter(maps)
  const customJump = Object.values(maps).some((value) => {
    const board = asObject(value)
    const actions = [
      ...(Array.isArray(board?.keys) ? board.keys.map((key) => asObject(key)?.values) : []),
      ...Object.values(asObject(board?.key_fix) ?? {}).map((tip) => asObject(tip)?.v),
    ]
    return actions.some((values) => Array.isArray(values)
      && values.some((action, at) => at % 2 === 1 && typeof action === "string" && action.startsWith("Z+")))
  })
  const warning = "手心 Android 不支持 Z+ 自定义面板跳转（包括自定义计算器），相关手势仅保留配置，无法在 Android 调起"
  if (customJump && !context.warnings.includes(warning)) context.warnings.push(warning)
  fixTouchRects(maps)
  fitCandidateIcons(maps, cands, context.warnings)
  mergeGlobalBoardModels(maps)
  return { b: maps, c: cands, h: hints }
}

/** Baidu keeps the shared bars and list-cell style in `gen.ini`; Palm expects them on every board. */
function mergeGlobalBoardModels(maps: Record<string, Json>): void {
  const global = asBoard(maps.defaultGlobal)
  if (!global) return
  const boards = Object.entries(maps)
    .filter(([name]) => name !== "defaultGlobal")
    .map(([, board]) => asBoard(board))
    .filter((board): board is Record<string, Json> => board !== undefined)
  // Palm only loads a skin when the global board has the list-cell model Baidu never writes there.
  if (global.list === undefined) global.list = boards.find((board) => board.list !== undefined)?.list
  for (const board of boards) {
    for (const key of ["cand", "input", "more", "hint", "top_cand", "list"]) {
      if (board[key] === undefined && global[key] !== undefined) board[key] = global[key]
    }
  }
}

function asBoard(value: Json): Record<string, Json> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, Json> : undefined
}

/* -------------------------------------------------------------------- style */

// `SkinStyle` (s_info / s_land / s_port).
function styleJson(context: ExportContext, res: string[] | undefined): Json {
  const skinStyles: Record<string, Json> = {}
  const animStyles: Record<string, Json> = {}
  const animationPaths: Record<string, Json> = {}
  let skinTileMap: Record<string, Json> | undefined

  for (const section of readResource(context, res, "default.css") ?? []) {
    if (!section.name.startsWith("STYLE")) continue
    const index = indexKey(section.name, "STYLE")
    if (index === undefined) continue
    skinStyles[String(index)] = infoModel(section.entries, section.name)
  }

  for (const section of readResource(context, res, "anim.ini") ?? []) {
    if (section.name === "GLOBAL") {
      const unmapped = Object.keys(section.entries).filter((key) => key !== "ANIM_NUM")
      if (unmapped.length) context.warnings.push(`[GLOBAL] 的 ${unmapped.join("、")} 无法完整转换为手心皮肤`)
      continue
    }
    if (/^PATH\d+$/.test(section.name)) {
      animationPaths[section.name] = section.entries
      continue
    }
    if (!/^ANIM\d+$/.test(section.name)) {
      context.warnings.push(`动画附加段 ${section.name} 在手心皮肤中无法保留`)
      continue
    }
    const wrap = buildAnimationWrap(section)
    if (wrap === undefined) {
      context.warnings.push(`${section.name} 动画结构无法解析，转手心时已忽略`)
      continue
    }
    const generated = parseIniSections(animationsIni({ [section.name]: wrap }).toString())
      .find((item) => item.name === section.name)?.entries ?? {}
    const frame = Number(section.entries["CATEGORY"]) === 2 || section.entries["ANIM_PATH"] !== undefined
    const unmapped = Object.entries(section.entries).filter(([key, value]) => {
      const target = key === "SOURCE_FILE" && frame ? "ANIM_PATH" : key
      return generated[target] === undefined || !(sameIniValue(value, generated[target])
        || generated.CATEGORY === "3" && sameIniValue(`${value},${value}`, generated[target]))
    }).map(([key]) => key)
    if (unmapped.length) context.warnings.push(`${section.name} 的 ${unmapped.join("、")} 无法完整转换为手心皮肤`)
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
      if (!(stripExtension(path) in map)) map[stripExtension(path)] = tileModels(sections)
    }
    skinTileMap = map
  }

  return {
    ss_1: skinStyles,
    ss_2: animStyles,
    ...(Object.keys(animationPaths).length ? { ss_2_paths: animationPaths } : {}),
    ss_3: [], ss_4: [], ss_5: [], info: skinTileMap,
  }
}

function sameIniValue(left: string, right: string): boolean {
  if (left === right) return true
  const boolean = (value: string) => /^(?:1|true)$/i.test(value) ? true : /^(?:0|false)$/i.test(value) ? false : undefined
  const leftBoolean = boolean(left)
  const rightBoolean = boolean(right)
  if (leftBoolean !== undefined && rightBoolean !== undefined) return leftBoolean === rightBoolean
  const numbers = (value: string) => value.split(",").map((part) => part.trim())
  const leftParts = numbers(left)
  const rightParts = numbers(right)
  return leftParts.length === rightParts.length && leftParts.every((part, index) =>
    part !== "" && rightParts[index] !== "" && Number.isFinite(Number(part)) && Number(part) === Number(rightParts[index]))
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

/** The theme's shared `res` folder: baked backgrounds are written here once per theme. */
function themeResFolder(struct: SkinStruct): string {
  return palmJoinPath(struct.themeSkinDir, "res")
}

// `skinFileJson`'s structural part: layouts, styles, menu and resource separation. Its two callers
// differ only in whether the background bake is drained synchronously or driven by the async export.
function* skinBaseSteps(context: ExportContext, struct: SkinStruct, base: number, end: number): Generator<number, JsonObject, void> {
  const span = end - base
  yield base
  const res = removeUselessPath(struct.res)
  const portRes = removeUselessPath(struct.portRes)
  const landRes = removeUselessPath(struct.landRes)
  const logo = struct.logo.filter((path) => !path.endsWith(".plist"))
  const styles = styleSets(context, struct)
  yield base + span * 0.35
  const menu = toolbarMenu(context, struct.logo)
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
    menu,
    a_m: menuIcon(context, struct.logo, "pop_menu_icons.til"),
    a_i: menuIcon(context, struct.logo, "pop_input_icons.til"),
  }
  if (styles.port !== undefined) model.s_port = styles.port
  if (styles.land !== undefined) model.s_land = styles.land
  yield base + span * 0.9
  separateOrientationResources(model, context.entries)
  removeMissingAnimationKeys(model, context.warnings)
  yield end
  return model
}

function skinFileJson(context: ExportContext, struct: SkinStruct): JsonObject {
  const model = drain(skinBaseSteps(context, struct, 0, 1))
  bakeBackgrounds(model, context.entries, themeResFolder(struct))
  fitToolbarArtwork(model, context.entries)
  return model
}

function* skinFileSteps(context: ExportContext, struct: SkinStruct, base: number, end: number): Generator<number, JsonObject, void> {
  const split = base + (end - base) * 0.25
  const model = yield* skinBaseSteps(context, struct, base, split)
  const bakeSpan = (end - base) * 0.7
  for (const fraction of bakeBackgroundsSteps(model, context.entries, themeResFolder(struct))) {
    yield split + bakeSpan * fraction
  }
  fitToolbarArtwork(model, context.entries)
  yield end
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

/** Everything `buildSxiZip` and `buildSxiZipAsync` share: the converter entries and their parsed view. */
type PreparedExport = {
  context: ExportContext
  entries: ConverterEntry[]
  infoPath: string
  defaultStruct: SkinStruct
  darkStruct?: SkinStruct
}

function prepareExport(archive: SkinArchive): PreparedExport {
  if (archive.format === "bdi") archive = SkinArchive.open(archive.toBytes("bds"), "bds")
  if (archive.format === "bda") {
    // BDA packages carry protobuf panels instead of an INI layout tree, so a caller that
    // reaches this point must convert the archive first (see `convertBdaToBaseLayout`).
    throw new Error("BDA 皮肤需要先转换为 BDI/BDS 布局再导出手心皮肤（.sxi）")
  }

  const entries = collectConverterEntries(archive)
  if (archive.format === "bdi" || archive.format === "bds") prepareToolbarIcons(entries)
  const context: ExportContext = {
    root: new PalmVirtualRoot(entries.map((entry) => ({ path: entry.path, bytes: entry.bytes }))),
    warnings: [],
    entries,
    sections: new Map(),
  }
  const skinDir = context.root.isDirectory("skin") ? "skin" : ""
  const hasLight = context.root.isDirectory(palmJoinPath(skinDir, "light"))
  const dark = context.root.isDirectory(palmJoinPath(skinDir, "dark")) ? palmJoinPath(skinDir, "dark") : undefined
  return {
    context,
    entries,
    infoPath: palmJoinPath(skinDir, "Info.txt"),
    defaultStruct: structModel(context, hasLight ? palmJoinPath(skinDir, "light") : skinDir),
    darkStruct: dark === undefined ? undefined : structModel(context, dark),
  }
}

// 建模阶段占导出进度的前 55%；背景烘焙是其中最慢的一段。
const MODEL_BASE = 0.02
const MODEL_END = 0.55

function* buildSkinSteps(prepared: PreparedExport): Generator<number, Record<string, Json>, void> {
  const { context } = prepared
  const themes = prepared.darkStruct === undefined ? 1 : 2
  const span = (MODEL_END - MODEL_BASE) / themes
  const skin: Record<string, Json> = { root: "", default: undefined, night: undefined, info: undefined, demo: undefined }
  skin.default = yield* skinFileSteps(context, prepared.defaultStruct, MODEL_BASE, MODEL_BASE + span)
  if (prepared.darkStruct !== undefined) {
    skin.night = yield* skinFileSteps(context, prepared.darkStruct, MODEL_BASE + span, MODEL_END)
  }
  skin.info = skinInfoJson(context, prepared.infoPath)
  yield MODEL_END
  return skin
}

function buildSkin(prepared: PreparedExport): Record<string, Json> {
  const { context } = prepared
  return {
    root: "",
    default: skinFileJson(context, prepared.defaultStruct),
    night: prepared.darkStruct === undefined ? undefined : skinFileJson(context, prepared.darkStruct),
    info: skinInfoJson(context, prepared.infoPath),
    demo: undefined,
  }
}

function drain<T>(steps: Generator<number, T, void>): T {
  for (;;) {
    const step = steps.next()
    if (step.done) return step.value
  }
}

/** 导出进度：0–1，`detail` 是进度窗里的一句说明。 */
export type SxiExportReport = (fraction: number, detail: string) => Promise<void>

// 打包阶段从建模结束处起步，留出整理文件的一小段。
const ZIP_START = 0.58

export function buildSxiZip(archive: SkinArchive): { bytes: Uint8Array; warnings: string[] } {
  const prepared = prepareExport(archive)
  const skin = buildSkin(prepared)
  return { bytes: packSxiFiles(assembleSxiFiles(prepared.entries, skin)), warnings: prepared.context.warnings }
}

/**
 * `buildSxiZip` 的异步版本：同样的工作，但每约 12ms 让出一次主线程并报告进度，
 * 大皮肤导出时进度窗不会卡住。
 */
export async function buildSxiZipAsync(
  archive: SkinArchive,
  report?: SxiExportReport,
): Promise<{ bytes: Uint8Array; warnings: string[] }> {
  let reported = -1
  let reportedAt = 0
  // 进度窗每更新一次要等两帧，而大皮肤烘焙有上千步；汇报按时间节流，否则汇报本身就把导出拖慢。
  const REPORT_INTERVAL = 100
  const emit = async (fraction: number, detail: string, force = false): Promise<void> => {
    if (report === undefined || fraction <= reported) return
    const now = performance.now()
    if (!force && fraction < 1 && now - reportedAt < REPORT_INTERVAL) return
    reported = fraction
    reportedAt = now
    await report(fraction, detail)
  }
  const breathe = async (fraction: number, detail: string, force = false): Promise<void> => {
    await emit(fraction, detail, force)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  await breathe(0, "正在读取皮肤…", true)
  const prepared = prepareExport(archive)
  const driveModel = async (): Promise<Record<string, Json>> => {
    const steps = buildSkinSteps(prepared)
    let last = performance.now()
    for (;;) {
      const step = steps.next()
      if (step.done) return step.value
      if (performance.now() - last >= 12) {
        last = performance.now()
        await breathe(step.value, "正在整理手心皮肤…")
      }
    }
  }
  const skin = await driveModel()
  await breathe(MODEL_END + 0.01, "正在整理导出文件…", true)
  const files = assembleSxiFiles(prepared.entries, skin)
  const bytes = await zipArchiveAsync(files, (fraction) => emit(
    ZIP_START + (1 - ZIP_START) * fraction,
    fraction >= 1 ? "手心皮肤已生成" : "正在打包手心皮肤…",
    fraction === 0 || fraction >= 1,
  ))
  return { bytes, warnings: prepared.context.warnings }
}
