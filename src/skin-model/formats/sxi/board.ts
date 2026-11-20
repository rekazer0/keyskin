// 手心皮肤的板与按键。
//
// 一块键盘一个板：`keys[].rect` 是绝对像素，`absoluteBoard` 建成 taffy 树；板尺寸由键的并集
// 推出（手心不声明画布）。`hit_rect` 只在尺寸上与显示区不同，归到 `Key.hitArea`。
// `values` 是「按钮码, 值」多对：0~3 四向滑动、4 常规、5 显示、6 长按、7 长按符号串。
//
// `key_fix` 是覆盖层（替换最终值），不是按下态。IR 没有覆盖层类型，因此键保留自身声明的值，
// 覆盖表原样留在板里，写回时按原值写回，不把覆盖值混进按键。
import { ACTION_CODES } from "@/palm/palm-ini.ts"
import { asObject, type Json, type JsonObject } from "@/palm/sxi-ini.ts"
import type { Board } from "@/skin-model/board.ts"
import { actionOf as actionOfCode } from "@/skin-model/formats/bds/index.ts"
import type { Key } from "@/skin-model/key.ts"
import { absoluteBoard, computeLayout, type LayoutBox } from "@/skin-model/layout.ts"
import type { KeyAction, KeyEvent, Theme } from "@/skin-model/types.ts"
import { arrayOf, boxJson, boxOf, numberOf, numbersOf, objectOf, textOf } from "./json.ts"
import { slotOf, slotRef, type SxiSlot } from "./style.ts"

const ACTION_NAMES = new Map(Object.entries(ACTION_CODES).map(([code, name]) => [name, code]))

/** 按钮码 → 事件；5 显示、7 长按符号串，两者不是动作。 */
const EVENTS: Record<number, KeyEvent> = {
  0: "swipe-up",
  1: "swipe-down",
  2: "swipe-left",
  3: "swipe-right",
  4: "press",
  6: "long-press",
}

const SHOW = 5
const HOLDSYM = 7

/** 手心 `values` 的值直接写动作名（`backspace`）或字符；动作名按百度动作码转成语义动作。 */
function actionOf(value: Json): KeyAction | undefined {
  const text = textOf(value)
  if (text === undefined) return
  // 空格是合法的字符输出，不能被 trim 成空串丢掉。
  if (!text.trim()) return { kind: "text", value: text }
  // 实测写动作名（`backspace`）；F 码是百度的写法，一并认。
  if (/^F\d+$/i.test(text.trim())) return actionOfCode(text.trim().toUpperCase())
  const code = ACTION_NAMES.get(text.trim())
  return code ? actionOfCode(code) : { kind: "text", value: text }
}

const SWITCH_NAMES: Partial<Record<Board["kind"], string>> = {
  symbol: "symbolBoard",
  number: "numberBoard",
  candidate: "candidateBoard",
}

/** IR 动作 → 手心 `values` 里的值。 */
function actionValue(action: KeyAction | undefined): string | undefined {
  if (!action) return
  switch (action.kind) {
    case "text": return action.value
    case "delete": return action.forward ? "delete" : "backspace"
    case "enter": return "enter"
    case "case": return action.mode === "title" ? "shift" : "capslock"
    case "switch": return SWITCH_NAMES[action.board] ?? `${action.board}Board`
    case "candidate-page": return action.direction === "up" ? "candidatesPageUp" : "candidatesPageDown"
    case "system": return ACTION_CODES[action.code] ?? action.code
    case "open-app": return action.app
    case "trigger": return actionValue(action.target)
  }
}

/** `values` 扁平表 → 动作、显示文字、长按符号串。 */
function valuesOf(values: Json[]): { actions: Key["actions"]; label?: string; holdSymbol?: string } {
  const actions: Key["actions"] = {}
  let label: string | undefined
  let holdSymbol: string | undefined
  for (let index = 0; index + 1 < values.length; index += 2) {
    const code = values[index]
    if (typeof code !== "number") continue
    const value = values[index + 1]
    if (code === SHOW) {
      label = textOf(value) ?? label
      continue
    }
    if (code === HOLDSYM) {
      holdSymbol = textOf(value) ?? holdSymbol
      continue
    }
    const event = EVENTS[code]
    const action = actionOf(value)
    if (event && action && !actions[event]) actions[event] = action
  }
  return { actions, ...(label !== undefined ? { label } : {}), ...(holdSymbol !== undefined ? { holdSymbol } : {}) }
}

/** `values` 的按钮码顺序，写回时沿用。 */
function valueOrder(value: Json): number[] {
  const values = arrayOf(value)
  const order: number[] = []
  for (let index = 0; index + 1 < values.length; index += 2) {
    const code = values[index]
    if (typeof code === "number" && !order.includes(code)) order.push(code)
  }
  return order
}

function valuesJson(key: Key, order: readonly number[], original: readonly Json[]): Json[] {
  /** 原包用 `space` 还是空格字符都是同一个动作；IR 没改过就保留原写法。 */
  const originalValue = (code: number): Json | undefined => {
    for (let index = 0; index + 1 < original.length; index += 2) if (original[index] === code) return original[index + 1]
    return
  }
  const sameAction = (a: KeyAction | undefined, b: KeyAction | undefined): boolean => JSON.stringify(a) === JSON.stringify(b)
  const flat: Json[] = []
  const written = new Set<number>()
  const write = (code: number, event: KeyEvent | undefined, value: string | undefined): void => {
    if (value === undefined || written.has(code)) return
    written.add(code)
    const before = originalValue(code)
    const action = event ? key.actions[event] : undefined
    if (before !== undefined && event && sameAction(actionOf(before), action)) {
      flat.push(code, before)
      return
    }
    flat.push(code, value)
  }
  for (const code of order) {
    if (code === SHOW) write(code, undefined, key.label)
    else if (code === HOLDSYM) write(code, undefined, key.holdSymbol)
    else write(code, EVENTS[code], actionValue(key.actions[EVENTS[code]]))
  }
  for (const [code, event] of Object.entries(EVENTS)) write(Number(code), event, actionValue(key.actions[event]))
  write(SHOW, undefined, key.label)
  write(HOLDSYM, undefined, key.holdSymbol)
  return flat
}

function insetOf(rect: LayoutBox, hit: LayoutBox): Key["hitArea"] {
  if (hit.size.width === 1 && hit.size.height === 1) return { kind: "none" }
  if (hit.position.x === rect.position.x && hit.position.y === rect.position.y
    && hit.size.width === rect.size.width && hit.size.height === rect.size.height) return { kind: "same" }
  return {
    kind: "inset",
    edges: {
      left: hit.position.x - rect.position.x,
      top: hit.position.y - rect.position.y,
      right: rect.position.x + rect.size.width - (hit.position.x + hit.size.width),
      bottom: rect.position.y + rect.size.height - (hit.position.y + hit.size.height),
    },
  }
}

/** `b` 里的编号是 `ss_1` 的键；槽类型决定它属于哪一类样式。 */
function styleRefOf(value: Json | undefined, theme: Theme, ss1: JsonObject, fallback: SxiSlot): string | undefined {
  const key = numberOf(value)
  if (key === undefined) return
  const record = objectOf(ss1[String(key)])
  const slot = record ? slotOf(record) : undefined
  return slotRef(theme, String(key), slot ?? fallback)
}

/** 九个 `b` 字段 → 按键容器、音效与位置类型。 */
function containerOf(base: JsonObject, theme: Theme, ss1: JsonObject): Pick<Key, "container" | "sound" | "labelPosition"> {
  const back = styleRefOf(base.base_b, theme, ss1, "s_2")
  const backAnim = styleRefOf(base.base_ba, theme, ss1, "s_5")
  const singleAnim = styleRefOf(base.base_a, theme, ss1, "s_5")
  const foreAnims = numbersOf(base.base_fa).map((key) => styleRefOf(key, theme, ss1, "s_5"))
  const fore = numbersOf(base.base_f).flatMap((key) => {
    const ref = styleRefOf(key, theme, ss1, "s_1")
    return ref ? [ref] : []
  })
  const sound = styleRefOf(base.base_s, theme, ss1, "s_4")
  const press = styleRefOf(base.asi, theme, ss1, "s_5")
  const positions = numbersOf(base.base_o)
  return {
    container: {
      ...(back || backAnim
        ? {
          back: {
            ...(back ? { style: back } : {}),
            ...(backAnim ? { anim: backAnim } : {}),
          },
        }
        : {}),
      fore: fore.map((style, index) => {
        const anim = foreAnims[index] ?? singleAnim
        return { style, ...(anim ? { anim } : {}) }
      }),
      ...(press ? { press } : {}),
    },
    ...(sound ? { sound } : {}),
    ...(positions.length ? { labelPosition: positions } : {}),
  }
}

type KeyRaw = { record: JsonObject; box?: LayoutBox; hit?: LayoutBox }

function keyRawOf(entry: Json): KeyRaw | undefined {
  const record = asObject(entry)
  if (!record) return
  const box = boxOf(record.rect)
  const hit = boxOf(record.hit_rect)
  const rect: LayoutBox | undefined = box
    ? { position: { x: box.x, y: box.y }, size: { width: box.width, height: box.height } }
    : undefined
  const hitBox: LayoutBox | undefined = hit
    ? { position: { x: hit.x, y: hit.y }, size: { width: hit.width, height: hit.height } }
    : undefined
  return { record, ...(rect ? { box: rect } : {}), ...(hitBox && rect ? { hit: hitBox } : {}) }
}

/** 键盘名 → 板种类；与手心自己的命名习惯一致（`full26Pinyin`、`t9Number`、`symbol`）。 */
function boardKindOfName(type: string): Board["kind"] {
  const name = type.toLowerCase()
  if (/symbol|^zy|^bq|emoji/.test(name)) return "symbol"
  if (/^cand/.test(name)) return "candidate"
  if (/number|(?:^|_)(?:9|num|bh)(?:_|$)/.test(name)) return "number"
  if (/pinyin|english|default|stroke|^t9|^full|^big|^py|^en|^def|^hw|handwriting/.test(name)) return "main"
  return "other"
}

function boardIdOf(themeKey: string, orientation: "port" | "land", name: string): string {
  return `sxi:${themeKey}:${orientation}:${name}`
}

export function parseBoardId(id: string): { themeKey: "default" | "night"; orientation: "port" | "land"; name: string } | undefined {
  const match = /^sxi:(default|night):(port|land):(.+)$/.exec(id)
  if (!match) return
  return { themeKey: match[1] as "default" | "night", orientation: match[2] as "port" | "land", name: match[3] }
}

/** 键盘 → 板；没有 `keys` 的纯面板键盘同样是一块板，只是没有按键。 */
function boardOf(
  name: string,
  keyboard: JsonObject,
  id: string,
  theme: Theme,
  orientation: "port" | "land",
  ss1: JsonObject,
  removedKeys: string[] | undefined,
): Board {
  const raws = arrayOf(keyboard.keys).flatMap((entry) => {
    const raw = keyRawOf(entry)
    return raw ? [raw] : []
  })
  const placed = raws.filter((raw): raw is KeyRaw & { box: LayoutBox } => raw.box !== undefined)
  const width = placed.reduce((max, raw) => Math.max(max, raw.box.position.x + raw.box.size.width), 0)
  const height = placed.reduce((max, raw) => Math.max(max, raw.box.position.y + raw.box.size.height), 0)
  const ids = raws.flatMap((raw) => {
    const value = raw.record.id
    return typeof value === "number" || typeof value === "string" ? [String(value)] : []
  })
  const keys = raws.flatMap((raw): Key[] => {
    if (!raw.box) return []
    const record = raw.record
    const base = objectOf(record.b) ?? {}
    const id = String(record.id)
    const values = valuesOf(arrayOf(record.values))
    return [{
      id,
      layoutId: id,
      ...(raw.hit ? { hitArea: insetOf(raw.box, raw.hit) } : {}),
      actions: values.actions,
      ...containerOf(base, theme, ss1),
      ...(values.label !== undefined ? { label: values.label } : {}),
      ...(values.holdSymbol !== undefined ? { holdSymbol: values.holdSymbol } : {}),
    }]
  })
  const layout = absoluteBoard(placed.map((raw) => ({ id: String(raw.record.id), ...raw.box })))
  const keyboardRest: JsonObject = { ...keyboard }
  delete keyboardRest.keys
  delete keyboardRest.type
  delete keyboardRest.key_fix
  const extra = new Map<string, unknown>()
  // 键盘级未建模字段与每个键的原始对象原样保留，写回时按 IR 覆盖已知字段。
  extra.set("sxi:keyboard", keyboardRest)
  // `keys` 缺失（纯面板键盘）与 `keys: []` 是两种状态，写回时按原样保留。
  extra.set("sxi:hasKeys", keyboard.keys !== undefined)
  // `key_fix` 是覆盖层（替换最终值），不是按下态；IR 没有覆盖层类型，原样存放在这里，
  // 键自身只保留它声明的值，导出时覆盖表按原值写回。
  if (keyboard.key_fix !== undefined) extra.set("sxi:keyFix", keyboard.key_fix)
  extra.set("sxi:keyType", textOf(keyboard.type) ?? name)
  extra.set("sxi:keys", new Map(raws.map((raw) => [String(raw.record.id), raw.record])))
  extra.set("sxi:keyOrder", ids)
  extra.set("sxi:valueOrder", new Map(raws.map((raw) => [String(raw.record.id), valueOrder(raw.record.values)])))
  return {
    id,
    kind: boardKindOfName(name),
    theme,
    orientation,
    geometry: { kind: "document" },
    container: { width, height },
    layout,
    keys,
    ...(removedKeys?.length ? { removedKeys } : {}),
    extra,
  }
}

/** 一个主题方向的板。 */
export function boardsOfTheme(
  struct: JsonObject,
  themeKey: "default" | "night",
  theme: Theme,
  ss1: JsonObject,
  removed: ReadonlyMap<string, string[]>,
): Board[] {
  const boards: Board[] = []
  for (const orientation of ["port", "land"] as const) {
    const layout = objectOf(struct[`${orientation}_layout`])
    const group = layout ? objectOf(layout.b) : undefined
    if (!group) continue
    for (const [name, value] of Object.entries(group)) {
      const keyboard = objectOf(value)
      if (!keyboard) continue
      boards.push(boardOf(name, keyboard, boardIdOf(themeKey, orientation, name), theme, orientation, ss1, removed.get(name)))
    }
  }
  return boards
}

/* —— 写回 —— */

function styleKey(ref: string | undefined): number | undefined {
  if (!ref) return
  const match = /^sxi:(?:light|dark):(\d+):s_[1-5]$/.exec(ref)
  return match ? Number(match[1]) : undefined
}

/** IR 没表达的值（`undefined`）保留原字段：原包的空数组与缺省是两种状态，不能混。 */
function setField(record: JsonObject, field: string, value: Json | undefined): void {
  if (value !== undefined) record[field] = value
}

/** 按键容器 → 九个 `b` 字段；原对象里没建模的字段（`base_pa`）保留。 */
function baseJsonOf(key: Key, before: JsonObject): JsonObject {
  const next: JsonObject = { ...before }
  const fore = key.container.fore.flatMap((layer) => {
    const value = styleKey(layer.style)
    return value === undefined ? [] : [value]
  })
  const foreAnims = key.container.fore.map((layer) => styleKey(layer.anim))
  const animated = foreAnims.filter((value): value is number => value !== undefined)
  const allSame = animated.length > 0 && animated.length === foreAnims.length && animated.every((value) => value === animated[0])
  setField(next, "base_b", styleKey(key.container.back?.style))
  setField(next, "base_ba", styleKey(key.container.back?.anim))
  setField(next, "base_f", fore.length ? fore : undefined)
  // `base_a` 与 `base_fa` 同时存在时，`base_a` 是独立字段（单值形态），不能从前景列表反推；
  // 只有原包用哪种形态，写回就按哪种形态写。
  if (before.base_fa !== undefined && animated.length) {
    // `base_fa` 的项可能多于前景层（实测 3 项对 2 层）；超出前景层数的项按原值保留。
    const beforeFa = arrayOf(before.base_fa)
    setField(next, "base_fa", beforeFa.map((old, index) => foreAnims[index] ?? old))
  } else if (before.base_a !== undefined && before.base_fa === undefined && allSame) {
    setField(next, "base_a", animated[0])
  } else if (before.base_a === undefined && before.base_fa === undefined && animated.length) {
    setField(next, "base_fa", foreAnims.map((value) => value ?? 0))
  } else if (!animated.length && before.base_fa === undefined && before.base_a !== undefined) {
    setField(next, "base_a", undefined)
  }
  setField(next, "base_s", styleKey(key.sound))
  setField(next, "asi", styleKey(key.container.press))
  setField(next, "base_o", key.labelPosition?.length ? [...key.labelPosition] : undefined)
  return next
}

function hitRectJson(key: Key, rect: LayoutBox): Json | undefined {
  const area = key.hitArea
  if (!area) return
  if (area.kind === "none") return [[rect.position.x, rect.position.y], [1, 1]]
  if (area.kind === "same") {
    return boxJson({ x: rect.position.x, y: rect.position.y, width: rect.size.width, height: rect.size.height })
  }
  return boxJson({
    x: rect.position.x + area.edges.left,
    y: rect.position.y + area.edges.top,
    width: rect.size.width - area.edges.left - area.edges.right,
    height: rect.size.height - area.edges.top - area.edges.bottom,
  })
}

/** 键盘名：SXI 自己的板 id 带名字；别的格式取板 id 的叶子并去掉文件扩展名。 */
export function keyboardNameOf(board: Board): string {
  const parsed = parseBoardId(board.id)
  if (parsed) return parsed.name
  const leaf = board.id.split("/").pop() ?? board.id
  return leaf.replace(/\.(?:ini|json)$/i, "")
}

/** 一块板 → 键盘对象。几何从布局树算，未建模字段按原值铺底。 */
export async function keyboardJson(board: Board): Promise<JsonObject> {
  const rects = await computeLayout(board.layout, board.container)
  const raw = objectOf(board.extra?.get("sxi:keyboard") as Json | undefined) ?? {}
  const keyFix = board.extra?.get("sxi:keyFix") as Json | undefined
  const rawKeys = board.extra?.get("sxi:keys") as ReadonlyMap<string, JsonObject> | undefined
  const order = board.extra?.get("sxi:keyOrder") as readonly string[] | undefined
  const valueOrders = board.extra?.get("sxi:valueOrder") as ReadonlyMap<string, readonly number[]> | undefined
  const hasKeys = board.extra?.get("sxi:hasKeys") === true
  const byId = new Map(board.keys.map((key) => [key.id, key]))
  const keys: Json[] = []
  for (const id of order ?? board.keys.map((key) => key.id)) {
    const key = byId.get(id)
    const rect = key ? rects.get(key.id) : undefined
    const before = rawKeys?.get(id)
    if (!key || !rect) {
      if (before) keys.push(before)
      continue
    }
    const out: JsonObject = {
      ...before,
      // `id` 的原类型（字符串或数字）按原值保留；新键才用板内的字符串 id。
      id: before?.id ?? id,
      rect: boxJson({ x: rect.position.x, y: rect.position.y, width: rect.size.width, height: rect.size.height }),
    }
    // 原键没有 `b`、IR 也没有样式可写时不能补一个空对象：缺失与空对象是两种状态。
    const beforeBase = objectOf(before?.b)
    const rebuiltBase = baseJsonOf(key, beforeBase ?? {})
    if (beforeBase !== undefined || Object.keys(rebuiltBase).length) out.b = rebuiltBase
    else delete out.b
    const hit = hitRectJson(key, rect)
    if (hit !== undefined) out.hit_rect = hit
    else delete out.hit_rect
    const values = valuesJson(key, valueOrders?.get(id) ?? [], arrayOf(before?.values))
    if (values.length) out.values = values
    else delete out.values
    keys.push(out)
  }
  return {
    ...raw,
    ...(keyFix !== undefined ? { key_fix: keyFix } : {}),
    type: textOf(board.extra?.get("sxi:keyType") as Json | undefined) ?? keyboardNameOf(board),
    ...(hasKeys || keys.length ? { keys } : {}),
  }
}
