// 手心 `skin.json` 的主题组装与拆解。
//
// `skin.json` 是外观主体：顶层 `default`/`night` 两套主题，每套带两个方向的布局、样式表、
// 图集、菜单与资源清单。IR 把布局拆成板、样式拆成 `styles`、图集拆成 `atlases`、动效拆成
// `motions`；主题里还没建模的字段（`r_info`、`r_logo`、`dir`、`i`、`s_land`、`a_m` 等）
// 原样留在模型的 `opaque` 里，写回时按原值铺底。
import type { Json, JsonObject } from "@/palm/sxi-ini.ts"
import type { Atlas } from "@/skin-model/atlas.ts"
import type { Board } from "@/skin-model/board.ts"
import { absoluteBoard } from "@/skin-model/layout.ts"
import type { SkinModel } from "@/skin-model/model.ts"
import type { ToolbarItem } from "@/skin-model/panel.ts"
import type { Theme } from "@/skin-model/types.ts"
import { atlasesJson } from "./atlas.ts"
import { keyboardJson, keyboardNameOf, parseBoardId } from "./board.ts"
import { arrayOf, objectOf, textOf } from "./json.ts"
import { motionsJson } from "./motion.ts"
import { imageStemOf, stylesJson } from "./style.ts"
import { SXI_THEME_KEYS, type SxiThemeKey } from "./pipeline.ts"

/** 模型 `opaque` 里手心自己的键；路径与主题都拼在键里，导出时按同一规则取回。 */
export const SXI_OPAQUE = {
  info: "sxi:info.json",
  skinInfo: "sxi:skin.info",
  skinRoot: "sxi:skin.root",
  theme: (key: SxiThemeKey): string => `sxi:theme.${key}`,
  sInfo: (key: SxiThemeKey): string => `sxi:s_info.${key}`,
  layoutExtras: (key: SxiThemeKey): string => `sxi:layoutExtras.${key}`,
  layout: (path: string): string => `sxi:layout.${path}`,
  json: (path: string): string => `sxi:json.${path}`,
  file: (path: string): string => `sxi:file.${path}`,
}

const LAYOUT_PREFIX = "sxi:layout."
const JSON_PREFIX = "sxi:json."
const FILE_PREFIX = "sxi:file."

/** 板属于哪个主题：SXI 自己的板 id 带主题；别的格式回退到板自身的 `theme` 字段。 */
function themeKeyOfBoard(board: Board): SxiThemeKey {
  const parsed = parseBoardId(board.id)
  if (parsed) return parsed.themeKey
  return board.theme === "dark" ? "night" : "default"
}

/** 写进布局表的板：键盘板。工具栏（SXI 自己的 menu）与面板板不是键盘。 */
function isKeyboardBoard(board: Board): boolean {
  return board.kind !== "toolbar"
}

/** 主题在图集名里的前缀（`sxi:default:anjian`），写回时去掉。 */
export function atlasRefOf(themeKey: SxiThemeKey, name: string): string {
  return `sxi:${themeKey}:${name}`
}

function atlasNameOf(atlas: Atlas): { themeKey: SxiThemeKey; name: string } | undefined {
  const match = /^sxi:(default|night):(.+)$/.exec(atlas.name)
  if (!match) return
  return { themeKey: match[1] as SxiThemeKey, name: match[2] }
}

/** `opaque` 里所有 `.layout` 文件；导出时原样写回。 */
export function layoutsOf(opaque: ReadonlyMap<string, unknown>): Map<string, unknown> {
  const layouts = new Map<string, unknown>()
  for (const [key, value] of opaque) if (key.startsWith(LAYOUT_PREFIX)) layouts.set(key.slice(LAYOUT_PREFIX.length), value)
  return layouts
}

/** `opaque` 里其它 JSON 文件（`switchConfig.json` 之类）。 */
export function jsonFilesOf(opaque: ReadonlyMap<string, unknown>): Map<string, unknown> {
  const files = new Map<string, unknown>()
  for (const [key, value] of opaque) if (key.startsWith(JSON_PREFIX)) files.set(key.slice(JSON_PREFIX.length), value)
  return files
}

/** `opaque` 里没有角色、原样保留字节的文件。 */
export function binaryFilesOf(opaque: ReadonlyMap<string, unknown>): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>()
  for (const [key, value] of opaque) {
    if (!key.startsWith(FILE_PREFIX)) continue
    if (value instanceof Uint8Array) files.set(key.slice(FILE_PREFIX.length), value)
  }
  return files
}

function menuBoardId(themeKey: SxiThemeKey): string {
  return `sxi:${themeKey}:menu`
}

/** `menu` 第一层 → 工具栏板；两级状态结构未建模，原值留在 `extra`。 */
export function menuBoardOf(menu: Json, themeKey: SxiThemeKey, theme: Theme): Board | undefined {
  const layers = arrayOf(menu)
  if (!layers.length) return
  const items = arrayOf(layers[0]).flatMap((entry): ToolbarItem[] => {
    const record = objectOf(entry)
    if (!record) return []
    const icon = textOf(objectOf(objectOf(record.Images)?.Normal)?.Normal)
    const label = textOf(objectOf(objectOf(record.Titles)?.Normal)?.Normal)
    return [{
      id: String(record.Name ?? ""),
      ...(icon ? { icon } : {}),
      ...(label ? { label } : {}),
    }]
  })
  const extra = new Map<string, unknown>()
  extra.set("sxi:menu", menu)
  return {
    id: menuBoardId(themeKey),
    kind: "toolbar",
    theme,
    orientation: "port",
    geometry: { kind: "document" },
    // 菜单没有画布尺寸：条目的位置由客户端排布，不拿 0 冒充一个容器。
    container: { kind: "unknown" },
    layout: absoluteBoard([]),
    keys: [],
    panels: { toolbar: { items } },
    extra,
  }
}

/** 板 → 键盘表；`b` 是键盘名，`c`/`h` 是方向级组件，按原值写回。 */
async function layoutsJson(
  model: SkinModel,
  themeKey: SxiThemeKey,
  orientation: "port" | "land",
  extras: JsonObject,
): Promise<JsonObject> {
  const b: JsonObject = {}
  for (const board of model.boards) {
    if (!isKeyboardBoard(board) || themeKeyOfBoard(board) !== themeKey || board.orientation !== orientation) continue
    b[keyboardNameOf(board)] = await keyboardJson(board)
  }
  return Object.keys(b).length ? { ...extras, b } : extras
}

/** `r_info`/`r_land` 里的旧扩展名跟着图片改成 `.png`。 */
function renamePaths(value: Json, renamed: ReadonlyMap<string, string>): Json {
  if (typeof value === "string") return renamed.get(value) ?? value
  if (Array.isArray(value)) return value.map((item) => renamePaths(item, renamed))
  const object = objectOf(value)
  if (!object) return value
  const next: JsonObject = {}
  for (const [field, item] of Object.entries(object)) next[field] = renamePaths(item, renamed)
  return next
}

/**
 * 别的格式的图片不是 SXI 的图集切片；导出时按「整图一片」补一张图集，
 * `s_2` 才有东西可引用。属于本主题的图才补，SXI 自己的切片跳过（原 info 表已有）。
 */
function singleTileInfo(model: SkinModel, themeKey: SxiThemeKey, theme: Theme, existing: JsonObject): JsonObject {
  const info: JsonObject = { ...existing }
  const referenced = new Set<string>()
  for (const style of model.styles.values()) {
    for (const layer of [...style.normal, ...(style.pressed ?? []), ...(style.disabled ?? [])]) {
      if (layer.kind === "image") referenced.add(layer.image)
    }
  }
  for (const id of referenced) {
    if (id.includes("#")) continue
    const image = model.images.get(id)
    if (!image) continue
    const stem = imageStemOf(id)
    if (info[stem] !== undefined) continue
    const owner: SxiThemeKey = /^dark\//.test(id) ? "night" : /^light\//.test(id) ? "default" : (theme === "dark" ? "night" : "default")
    if (owner !== themeKey) continue
    info[stem] = [{ id: "IMG1", rect1: [[0, 0], [image.width, image.height]], alpha: 1, scales: [] }]
  }
  // 图集：别的格式（BDS 的 `.til`）的切片表原样写成 SXI 的 `info`，切片编号沿用原序号。
  for (const atlas of model.atlases) {
    if (atlasNameOf(atlas)) continue
    const name = imageStemOf(atlas.name)
    if (info[name] !== undefined) continue
    const owner: SxiThemeKey = /^dark\//.test(atlas.source) ? "night" : /^light\//.test(atlas.source) ? "default" : (theme === "dark" ? "night" : "default")
    if (owner !== themeKey) continue
    info[name] = atlas.slices.map((slice, position) => {
      const recorded = slice.extra?.get("tilIndex")
      const index = typeof recorded === "number" && Number.isInteger(recorded) ? recorded : position + 1
      return {
        id: `IMG${index}`,
        rect1: [[slice.rect.x, slice.rect.y], [slice.rect.width, slice.rect.height]],
        alpha: 1,
        scales: [],
      }
    })
  }
  return info
}

/** `skin.json`：主题字段先按原值铺底，再放从 IR 重建的布局、样式、动效、图集与菜单。 */
export async function skinJsonOf(model: SkinModel, renamed: ReadonlyMap<string, string> = new Map()): Promise<JsonObject> {
  const skin: JsonObject = {}
  for (const themeKey of SXI_THEME_KEYS) {
    const theme = themeKey === "night" ? "dark" : "light"
    const rawTheme = objectOf(model.opaque.get(SXI_OPAQUE.theme(themeKey)) as Json | undefined) ?? {}
    const beforeTheme = renamePaths(rawTheme, renamed) as JsonObject
    const boards = model.boards.filter((board) => isKeyboardBoard(board) && themeKeyOfBoard(board) === themeKey)
    if (!Object.keys(beforeTheme).length && !boards.length) continue
    const beforeInfo = objectOf(model.opaque.get(SXI_OPAQUE.sInfo(themeKey)) as Json | undefined) ?? {}
    const extras = objectOf(model.opaque.get(SXI_OPAQUE.layoutExtras(themeKey)) as Json | undefined) ?? {}
    const atlases = model.atlases.flatMap((atlas): Atlas[] => {
      const parsed = atlasNameOf(atlas)
      return parsed?.themeKey === themeKey ? [{ ...atlas, name: parsed.name }] : []
    })
    const tables = atlasesJson(atlases)
    const sInfo: JsonObject = {
      ...beforeInfo,
      ss_1: stylesJson(theme, model.styles, objectOf(beforeInfo.ss_1) ?? {}),
      ss_2: motionsJson(theme, model.motions, objectOf(beforeInfo.ss_2) ?? {}),
      info: singleTileInfo(model, themeKey, theme, tables.info),
    }
    const themeJson: JsonObject = {
      ...beforeTheme,
      s_info: sInfo,
      ...(tables.a_i.length ? { a_i: tables.a_i } : {}),
    }
    // 原包有的方向才写：没有 `land_layout` 的主题不能凭空补一个空对象。
    for (const orientation of ["port", "land"] as const) {
      const field = `${orientation}_layout`
      if (extras[orientation] === undefined && !boards.some((board) => board.orientation === orientation)) continue
      themeJson[field] = await layoutsJson(model, themeKey, orientation, objectOf(extras[orientation]) ?? {})
    }
    const menu = model.boards.find((board) => board.id === menuBoardId(themeKey))
    const menuRaw = menu?.extra?.get("sxi:menu") as Json | undefined
    if (menuRaw !== undefined) themeJson.menu = menuRaw
    skin[themeKey] = themeJson
  }
  // 两份元信息各自保留原字段：`skin.json` 的 `info` 与 `info.json` 不是同一份结构。
  const infoJson = objectOf(model.opaque.get(SXI_OPAQUE.info) as Json | undefined) ?? {}
  skin.info = {
    ...(objectOf(model.opaque.get(SXI_OPAQUE.skinInfo) as Json | undefined) ?? {}),
    name: model.meta.name ?? "",
    author: model.meta.author ?? "",
    ...(model.meta.description !== undefined ? { description: model.meta.description } : {}),
    ...(model.meta.platform !== undefined ? { platform: model.meta.platform } : {}),
    ...(infoJson.splitImage !== undefined ? { splitImage: infoJson.splitImage } : {}),
  }
  const root = model.opaque.get(SXI_OPAQUE.skinRoot)
  skin.root = typeof root === "string" ? root : ""
  return skin
}

/** `info.json` 的写回：原字段铺底，元信息覆盖。 */
export function infoJsonOf(model: SkinModel): JsonObject {
  const info = objectOf(model.opaque.get(SXI_OPAQUE.info) as Json | undefined) ?? {}
  return {
    ...info,
    name: model.meta.name ?? "",
    author: model.meta.author ?? "",
    ...(model.meta.description !== undefined ? { description: model.meta.description } : {}),
    ...(model.meta.platform !== undefined ? { platform: model.meta.platform } : {}),
  }
}
