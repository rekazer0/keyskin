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
import { withPanels } from "@/skin-model/panel.ts"
import type { Theme } from "@/skin-model/types.ts"
import { atlasesJson } from "./atlas.ts"
import { keyboardJson, parseBoardId } from "./board.ts"
import { arrayOf, objectOf, textOf } from "./json.ts"
import { motionsJson } from "./motion.ts"
import { stylesJson } from "./style.ts"
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

/** `.layout` 的 `deleteKey`：一个规则作用于多个键盘时，删除的键名归到每个键盘的板上。 */
export function removedKeysOf(layouts: Map<string, unknown>): Map<string, string[]> {
  const removed = new Map<string, string[]>()
  for (const value of layouts.values()) {
    const layout = objectOf(value as Json)
    const rules = layout ? objectOf(layout.rules) : undefined
    if (!rules) continue
    for (const [group, ruleValue] of Object.entries(rules)) {
      const groupRules = objectOf(ruleValue)
      if (!groupRules) continue
      const names = group.split("|").map((name) => name.trim()).filter(Boolean)
      const targets = arrayOf(groupRules.rule).flatMap((entry) => {
        const rule = objectOf(entry)
        if (rule?.operation !== "deleteKey") return []
        const target = textOf(rule.target)
        return target ? target.split("|").map((name) => name.trim()).filter(Boolean) : []
      })
      if (!targets.length) continue
      for (const name of names) removed.set(name, [...new Set([...(removed.get(name) ?? []), ...targets])])
    }
  }
  return removed
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
    container: { width: 0, height: 0 },
    layout: absoluteBoard([]),
    keys: [],
    extra: withPanels(extra, { toolbar: { items } }),
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
    const parsed = parseBoardId(board.id)
    if (!parsed || parsed.themeKey !== themeKey || parsed.orientation !== orientation) continue
    b[parsed.name] = await keyboardJson(board)
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

/** `skin.json`：主题字段先按原值铺底，再放从 IR 重建的布局、样式、动效、图集与菜单。 */
export async function skinJsonOf(model: SkinModel, renamed: ReadonlyMap<string, string> = new Map()): Promise<JsonObject> {
  const skin: JsonObject = {}
  for (const themeKey of SXI_THEME_KEYS) {
    const theme = themeKey === "night" ? "dark" : "light"
    const rawTheme = objectOf(model.opaque.get(SXI_OPAQUE.theme(themeKey)) as Json | undefined) ?? {}
    const beforeTheme = renamePaths(rawTheme, renamed) as JsonObject
    const boards = model.boards.filter((board) => parseBoardId(board.id)?.themeKey === themeKey)
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
      info: tables.info,
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
