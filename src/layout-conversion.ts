import { IniDocument } from "./ini.ts"
import type { SkinArchive } from "./skin.ts"
import { actionText, asObject, rectParts, tipsText, type JsonObject } from "./palm/sxi-ini.ts"
import { BUTTON_KEYS } from "./palm/sxi-layout.ts"
import { parseSkinJson, sxiAddressPointer, sxiFragment, sxiFragmentPath } from "./palm/sxi-json.ts"
import { convertIniLayout } from "./layout-conversion-ini.ts"
import { convertSxiLayout } from "./palm/sxi-layout-conversion.ts"
import { offsetFromSection } from "./preview-items.ts"
import { stateTipSection } from "./panel-tools.ts"
import { iniConversionText } from "./layout-conversion-text.ts"

type Pair = [number, number]
export type LayoutRect = [number, number, number, number]
export type ConversionKey = { section: string; actions: Record<string, string>; rect: LayoutRect; touch?: LayoutRect; letters?: string }
export type ConversionMatch = { layout: ConversionLayout; key: ConversionKey; letters?: ConversionMatch[]; glyph?: number; fallback?: ConversionKey }
type ConversionList = { pos: Pair; size: Pair; count: number; horizontal: boolean; rect: LayoutRect; titles: string[]; values: string[] }
export type ConversionLayout = {
  path: string; size: Pair; keys: ConversionKey[]; list?: ConversionList
  document?: IniDocument; defaults?: IniDocument; board?: JsonObject; global?: JsonObject
}

function numbers(value: unknown, count: number): number[] | undefined {
  const parts = typeof value === "string" ? value.split(",").map(token => token.trim() ? Number(token) : NaN) : value
  return Array.isArray(parts) && parts.length === count && parts.every(part => typeof part === "number" && Number.isFinite(part)) ? parts : undefined
}

function sizeOf(value: unknown): Pair {
  const size = numbers(value, 2)
  if (!size || size.some(part => part <= 0 || part > 32768)) throw new Error("布局尺寸无效")
  return size as Pair
}

function rectOf(value: unknown, name: string): LayoutRect {
  const rect = numbers(value, 4)
  if (!rect || rect[2] <= 0 || rect[3] <= 0 || rect.some(part => Math.abs(part) > 32768)) throw new Error(`${name} 的按键坐标无效`)
  return rect as LayoutRect
}

/** Only native keyboard layouts, excluding shared defaults and resource/configuration files. */
export function conversionLayoutPaths(archive: SkinArchive, targetPath = ""): string[] {
  const choices = new Map<string, string>()
  const landscape = (path: string) => /\/(?:land|land_layout)\//.test(path)
  const score = (path: string) => Number(landscape(path) === landscape(targetPath)) * 2 + Number(!/^(?:dark\/|skin\.json\/night\/)/.test(path))
  for (const path of layoutPaths(archive, archive.format === "sxi" ? parseSkinJson(archive.getText("skin.json")) : undefined)) {
    const type = path.split("/").pop()!
    const previous = choices.get(type)
    if (!previous || score(path) > score(previous)) choices.set(type, path)
  }
  return [...choices.values()]
}

function layoutPaths(archive: SkinArchive, skin?: JsonObject): string[] {
  if (archive.format === "sxi") {
    return ["default", "night"].flatMap(theme => ["port_layout", "land_layout"].flatMap(orientation =>
      Object.entries(asObject(sxiFragment(skin!, [theme, orientation, "b"])) ?? {})
        .filter(([type, board]) => type !== "defaultGlobal" && Array.isArray(asObject(board)?.keys) && (asObject(board)!.keys as unknown[]).length)
        .map(([type]) => sxiFragmentPath([theme, orientation, "b", type]))))
  }
  if (archive.format !== "bds" && archive.format !== "bdi") return []
  return archive.names().filter(path => /^(?:light|dark)\/skin\/(?:port|land)\/(?!gen\.ini$)[^/]+\.ini$/i.test(path) &&
    IniDocument.parse(archive.getText(path)).sections().some(section => /^KEY\d+$/.test(section)))
}

export function readConversionLayout(archive: SkinArchive, path: string): ConversionLayout {
  return readLayout(archive, path, archive.format === "sxi" ? parseSkinJson(archive.getText("skin.json")) : undefined)
}

function readLayout(archive: SkinArchive, path: string, skin?: JsonObject): ConversionLayout {
  if (archive.format === "sxi") {
    const pointer = sxiAddressPointer(path)
    if (!pointer || pointer.length !== 4 || pointer[2] !== "b" || pointer[3] === "defaultGlobal") throw new Error("请选择一个键盘布局")
    const board = asObject(sxiFragment(skin!, pointer))
    const global = asObject(sxiFragment(skin!, [...pointer.slice(0, 3), "defaultGlobal"])) ?? {}
    if (!board || !Array.isArray(board.keys) || !board.keys.length) throw new Error("请选择包含按键的键盘布局")
    if (board.keys.length > 2048) throw new Error("布局按键超过 2048 个")
    const keys = board.keys.flatMap((value, index): ConversionKey[] => {
      const key = asObject(value)
      if (!key) throw new Error("模板包含无效按键")
      const actions: Record<string, string> = {}
      const values = Array.isArray(key.values) ? key.values : []
      for (let i = 0; i + 1 < values.length; i += 2) {
        const button = BUTTON_KEYS[Number(values[i])]
        const action = actionText(values[i + 1])
        if (button && action !== undefined) actions[button] = action
      }
      // Palm packages can contain empty placeholder keys between the actual buttons.
      if (key.rect === undefined && !Object.keys(actions).length) return []
      return [{ section: String(index), actions, rect: rectOf(rectParts(key.rect), `KEY${key.id ?? index}`),
        touch: key.hit_rect === undefined ? undefined : rectOf(rectParts(key.hit_rect), `KEY${key.id ?? index}`) }]
    })
    if (!keys.length) throw new Error("布局没有可用按键")
    const list = asObject(board.list) ?? asObject(global.list)
    const listValue = (key: string) => list?.[key] ?? asObject(global.list)?.[key]
    return { path, board, global, keys, size: sizeOf(asObject(board.board)?.size ?? asObject(global.board)?.size), list: listOf(listValue("pos"), listValue("size"), listValue("count"), listValue("order") === true, listValue("rect") === undefined ? undefined : rectParts(listValue("rect")), listValue("titles"), listValue("values")) }
  }
  if (archive.format !== "bds" && archive.format !== "bdi" || !/^(light|dark)\/skin\/(port|land)\/[^/]+\.ini$/.test(path)) throw new Error("此格式不支持布局转换")
  const document = IniDocument.parse(archive.getText(path))
  const genPath = path.replace(/[^/]+$/, "gen.ini")
  const defaults = IniDocument.parse(archive.isText(genPath) ? archive.getText(genPath) : "")
  const keys = document.sections().filter(section => /^KEY\d+$/.test(section)).map(section => ({
    section, actions: Object.fromEntries(document.entries(section).filter(({ key }) => BUTTON_KEYS.includes(key)).map(({ key, value }) => [key, value])),
    rect: rectOf(document.get(section, "VIEW_RECT"), section),
    touch: document.get(section, "TOUCH_RECT") === undefined ? undefined : rectOf(document.get(section, "TOUCH_RECT"), section),
    letters: document.get(section, "CONVERSION_LETTERS"),
  }))
  if (keys.some(key => key.letters && (!/^[a-z]{2}$/i.test(key.letters) || !key.letters.includes(key.actions.CENTER)))) throw new Error("模板的合键字母无效")
  if (!keys.length) throw new Error("请选择包含按键的键盘布局")
  if (keys.length > 2048) throw new Error("布局按键超过 2048 个")
  const value = (key: string) => document.get("LIST", key) ?? defaults.get("LIST", key)
  return { path, document, defaults, keys, size: sizeOf(document.get("PANEL", "SIZE") ?? defaults.get("PANEL", "SIZE")),
    list: listOf(value("POS"), value("CELL_SIZE"), Number(value("LIST_NUM")), value("LIST_ORDER") === "1", value("VIEW_RECT"), value("NAMES"), value("VALUES")) }
}

function listOf(pos: unknown, size: unknown, count: unknown, horizontal: boolean, rect: unknown, titles: unknown, values: unknown): ConversionList | undefined {
  if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) return
  if (!Number.isInteger(count) || count > 1024) throw new Error("符号栏数量无效")
  const position = numbers(pos, 2)
  if (!position) throw new Error("符号栏坐标无效")
  const cell = sizeOf(size)
  const texts = (value: unknown) => typeof value === "string" ? value.trim().split(/\s+/).filter(Boolean) : Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
  return { pos: position as Pair, size: cell, count, horizontal, titles: texts(titles), values: texts(values),
    rect: rectOf(rect === undefined ? [...position, cell[0] * (horizontal ? count : 1), cell[1] * (horizontal ? 1 : count)] : rect, "符号栏") }
}

/** Match meaning, never KEY order: foreground images and state swaps belong to their original key. */
function matchConversionKey(key: ConversionKey, layouts: ConversionLayout[], templatePath = ""): ConversionMatch {
  const center = key.actions.CENTER?.trim() ?? ""
  const show = key.actions.SHOW?.trim() ?? ""
  const candidates: ConversionMatch[] = layouts.flatMap(layout => layout.keys.flatMap(candidate => {
    if (keyLetterGroup(candidate, layout.path) !== keyLetterGroup(key, templatePath)) return []
    const pair = candidate.actions.SHOW?.toLowerCase() ?? ""
    const glyph = /^[a-z]{2}$/.test(pair) && /^[a-z]$/.test(center) && pair.includes(center) ? pair.indexOf(center) : undefined
    if (!(center || show) || glyph === undefined && (candidate.actions.CENTER?.trim() ?? "") !== center || !center && show && candidate.actions.SHOW?.trim() !== show) return []
    return [{ layout, key: candidate, glyph }]
  }))
  candidates.sort((a, b) => {
    const score = (candidate: ConversionMatch) => BUTTON_KEYS.filter(button => key.actions[button] !== undefined &&
      (button === "CENTER" && candidate.glyph !== undefined || candidate.key.actions[button] === key.actions[button])).length
    return score(b) - score(a)
  })
  if (!candidates.length) {
    const fallback = layouts.flatMap(layout => layout.keys.filter(candidate => candidate.actions.CENTER).map(candidate => ({ layout, key: candidate })))
    const score = (match: ConversionMatch) => Number(/^F\d+$/.test(match.key.actions.CENTER) === /^F\d+$/.test(center)) * 2 + Number(match.layout === layouts[0])
    fallback.sort((a, b) => score(b) - score(a))
    return { ...(fallback[0] ?? { layout: layouts[0], key: layouts[0].keys[0] }), fallback: key }
  }
  return candidates[0]
}

function keyLetterGroup(key: ConversionKey, path: string): string | undefined {
  if (key.letters || /^[a-z]{2}$/i.test(key.actions.SHOW ?? "") || !/^[a-z]$/i.test(key.actions.CENTER ?? "")) return
  if (!/^[1-9]$/.test(key.actions.SHOW ?? "") && !/\/(?:t9[^/]*|full(?:14|18)[^/]*|(?:py|en|def)_(?:9|14|18)s?\.ini)$/.test(path)) return
  const letters = [key.actions.LEFT, key.actions.CENTER, key.actions.RIGHT, key.actions.DOWN].filter(value => /^[a-z]$/i.test(value ?? ""))
  return letters.length > 1 ? [...new Set(letters)].join("").toUpperCase() : undefined
}

export function conversionKeyText(key: ConversionKey, path: string): string {
  return keyLetterGroup(key, path) ?? key.actions.SHOW ?? key.actions.CENTER ?? ""
}

/** Prefer the centered foreground; swipe hints sit at an offset and must not become the main letter. */
export function conversionLetterForeground({ layout, key, glyph, fallback }: ConversionMatch): { style: string; animation: string } | undefined {
  if (fallback) return
  const tip = stateTipSection(layout.document?.get(key.section, "STAT_STYLE"), 0)
  const value = (field: string) => (tip === undefined ? undefined : layout.document?.get(`TIP${tip}`, field))?.split(",") ?? layout.document?.get(key.section, field)?.split(",") ?? []
  const native = asObject((layout.board?.keys as JsonObject[] | undefined)?.[Number(key.section)])
  const nativeTip = stateTipSection(tipsText(native?.fix_a), 0)
  const fixed = nativeTip === undefined ? undefined : asObject(asObject(layout.board?.key_fix)?.[String(nativeTip)])
  const base = native ? { ...asObject(native.b), ...asObject(fixed?.b) } : undefined
  const styles = base ? (Array.isArray(base.base_f) ? base.base_f : [base.base_f]).filter(style => style !== undefined).map(String) : value("FORE_STYLE")
  const positions = base ? (Array.isArray(base.base_o) ? base.base_o : [base.base_o]) : value("POS_TYPE")
  const animations = base ? (Array.isArray(base.base_fa) ? base.base_fa : [base.base_a]).map(style => String(style ?? "")) : value("FORE_ANIM_STYLE")
  const paired = key.actions.SHOW?.toLowerCase()
  const distance = (index: number) => {
    const offsets = { ...asObject(layout.global?.offset), ...asObject(layout.board?.offset) }
    const point = base ? asObject(offsets[String(positions[index])])?.p : undefined
    const doc = layout.document?.hasSection(`OFFSET${positions[index]}`) ? layout.document : layout.defaults
    const explicit = layout.document?.get(key.section, "FORE_OFFSET")?.split(";")[index]?.split(",").map(Number)
    const offset = Array.isArray(point) ? point.map(Number) : explicit ?? offsetFromSection(doc, `OFFSET${positions[index]}`, { width: key.rect[2], height: key.rect[3] }) ?? [0, 0]
    return Math.hypot(offset[0], offset[1])
  }
  const index = glyph ?? (paired && /^[a-z]{2}$/.test(paired) && paired.includes(key.actions.CENTER)
    ? paired.indexOf(key.actions.CENTER)
    : styles.length === 2 && distance(0) > 0 && distance(0) === distance(1) && /^[a-z]$/.test(key.actions.LEFT ?? "")
      ? 1 : styles.map((_, index) => index).sort((a, b) => distance(a) - distance(b))[0])
  if (index === undefined || !styles[index] || styles[index] === "0") return
  return { style: styles[index], animation: animations[index] ?? "" }
}

export function scaledConversionRect(rect: LayoutRect, current: ConversionLayout, template: ConversionLayout, integer = false): LayoutRect {
  const result = rect.map((part, index) => {
    const axis = index % 2
    const value = part * current.size[axis] / template.size[axis]
    return integer ? Math.round(value) : Math.round(value * 100) / 100
  }) as LayoutRect
  return rectOf(result, "缩放后的布局")
}

/** Returns one native source edit. Neither archive is changed until the caller commits it. */
export function convertLayout(archive: SkinArchive, path: string, templateArchive: SkinArchive, templatePath: string): { path: string; before: string; after: string; styles?: { path: string; before?: string; after: string } } {
  const skin = archive.format === "sxi" ? parseSkinJson(archive.getText("skin.json")) : undefined
  const current = readLayout(archive, path, skin)
  const template = readConversionLayout(templateArchive, templatePath)
  const prefix = archive.format === "sxi" ? path.split("/").slice(0, 3).join("/") + "/" : path.replace(/[^/]+$/, "")
  const candidates = [current, ...layoutPaths(archive, skin).filter(candidate => candidate !== path && candidate.startsWith(prefix)).flatMap(candidate => {
    try { return [readLayout(archive, candidate, skin)] } catch { return [] }
  })]
  const matches = template.keys.map(key => {
    const matched = matchConversionKey(key, candidates, template.path)
    if (key.letters) matched.letters = [...key.letters].map(letter => matchConversionKey({ ...key, actions: { CENTER: letter } }, candidates))
    return matched
  })
  const listSource = template.list ? candidates.find(candidate => candidate.list && candidate.path.split("/").pop() === template.path.split("/").pop()) ?? candidates.find(candidate => candidate.list) : undefined
  const sourcePath = archive.format === "sxi" ? "skin.json" : path
  const before = archive.getText(sourcePath)
  if (archive.format === "sxi") return { path: sourcePath, before, after: convertSxiLayout(before, current, template, matches, listSource) }
  const text = iniConversionText(archive, current)
  const after = convertIniLayout(current, template, matches, text.foreground, listSource)
  return { path: sourcePath, before, after, styles: text.change() }
}
