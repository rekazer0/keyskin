// Property rows for a Palm skin. Every row shows one value of a skin.json model the way skin.json keeps
// it (rects, points, insets, style indexes, ARGB colours, gesture lists) and writes it straight back into
// skin.json as one undo step; the canvas and the source view are then rebuilt from the edited skin.

import { actionDescription } from "../actions.ts"
import { element } from "../dom-element.ts"
import { createIcon } from "../icons"
import { ACTION_CODES } from "../palm/palm-ini.ts"
import { palmFieldLabel, palmStyleReference } from "../palm/palm-labels.ts"
import { actionText, actionValue, asObject, numberText, numberValue, type Json, type JsonObject } from "../palm/sxi-ini.ts"
import { SXI_SKIN_PATH, encodeSkinJson, parseSkinJson } from "../palm/sxi-json.ts"
import { commitText, isEditing } from "./edit-history"
import { showError } from "./file-operations"
import { fieldCaption, numberParts } from "./property-rows"
import { appState } from "./state"
import { decorateStyleReferenceInput } from "./style-references"
import { openPalmSkin, refreshSxiDocument } from "./sxi-documents"

/** Where a model lives in skin.json: object keys and array indexes from the root. */
export type SxiPointer = Array<string | number>

/** Rows of one skin.json model; with several targets (multi-selection) the rows show what they share. */
export type SxiBlock = {
  targets: SxiPointer[]
  /** Subheading; a group with one untitled block shows none. */
  title?: string
  /** The model's place in skin.json, shown next to the subheading. */
  code?: string
  /** Field paths ("rect", "b.base_f") the block is limited to, in this order. */
  only?: string[]
  omit?: string[]
  /** Field paths offered even when the model does not have them yet; the first write adds them. */
  expect?: string[]
  note?: string
  /** Foreground cards of the selected canvas keys, which may add a new image style to them. */
  keyForeground?: boolean
}

const SIZE_KEYS = new Set(["size", "f_size", "c_size", "s"])
// Flat lists that happen to hold two numbers (`fix_a` = [state, tips], `base_o` = position types) are not points.
const LIST_KEYS = new Set(["fix_a", "base_o", "base_fa", "info", "t", "values", "v", "titles", "scales"])
// Fields offered before the model has them need to know what they will hold.
const NUMBER_KEYS = new Set(["f_s", "f_w"])
const isColorKey = (key: string) => /color|^c_/.test(key)
const PALM_COLOR = /^(?:[0-9a-f]{6}|[0-9a-f]{8})$/i
// `SkinButtonType`: what a key does on each gesture (palm-models.ts BUTTON_TYPES).
const CROSS: Array<[number, string, string, string]> = [
  [4, "CENTER", "点击", "pointer"],
  [6, "HOLD", "长按", "timer"],
  [0, "UP", "上滑", "arrow-up"],
  [1, "DOWN", "下滑", "arrow-down"],
  [2, "LEFT", "左滑", "arrow-left"],
  [3, "RIGHT", "右滑", "arrow-right"],
]
const OTHER_BUTTONS: Array<[number, string]> = [[5, "显示"], [7, "长按符号"], [8, "符号栏"], [9, "符号栏选中"]]

export function sxiValue(root: Json, path: readonly (string | number)[]): Json {
  let current = root
  for (const step of path) {
    current = Array.isArray(current) && typeof step === "number" ? current[step] : asObject(current)?.[step]
    if (current === undefined) return
  }
  return current
}

/** Applies `change` to skin.json as one undo step (`coalesce` joins a drag's steps) and rebuilds everything shown from it. */
export function editSxi(change: (skin: JsonObject) => void, coalesce = false): void {
  const archive = appState.archive
  if (archive?.format !== "sxi" || !isEditing()) return
  const before = archive.getText(SXI_SKIN_PATH)
  try {
    const skin = parseSkinJson(before)
    change(skin)
    commitText(SXI_SKIN_PATH, before, encodeSkinJson(skin), coalesce)
  } catch (error) {
    showError(error, "修改 skin.json")
  }
  refreshSxiDocument()
}

/**
 * Sets `path` under every target model as one undo step; `undefined` removes the field. Missing
 * objects on the way are added. Shared with the animation inspector, whose rows target one model.
 */
export function writeSxiValue(targets: SxiPointer[], path: string[], next: Json | ((current: Json, index: number) => Json)): void {
  editSxi((skin) => {
    for (const [index, target] of targets.entries()) {
      let model = asObject(sxiValue(skin, target))
      if (!model) throw new Error(`skin.json 中缺少 ${target.join(".")}`)
      for (const step of path.slice(0, -1)) {
        model[step] = asObject(model[step]) ?? {}
        model = model[step] as JsonObject
      }
      const key = path[path.length - 1]
      const value = typeof next === "function" ? next(model[key], index) : next
      if (value === undefined) delete model[key]
      else model[key] = value
    }
  })
}

function sameJson(left: Json, right: Json): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
}

function sharedValue(values: Json[]): { value: Json; mixed: boolean } {
  return values.every((value) => sameJson(value, values[0])) ? { value: values[0], mixed: false } : { value: undefined, mixed: true }
}

const isPoint = (value: Json): value is [number, number] => Array.isArray(value) && value.length === 2 && value.every((part) => typeof part === "number")
const isRect = (value: Json): value is [[number, number], [number, number]] => Array.isArray(value) && value.length === 2 && value.every(isPoint)
const INSET_SIDES = ["top", "right", "bottom", "left"] as const
const isInsets = (value: Json): boolean => {
  const object = asObject(value)
  return Boolean(object && Object.keys(object).length === 4 && INSET_SIDES.every((side) => typeof object[side] === "number"))
}
const isPrimitiveList = (value: Json): value is Array<string | number> => Array.isArray(value) && value.every((item) => typeof item === "string" || typeof item === "number")

/**
 * Rows are rebuilt after every write, so each one carries what it showed when the selection was made
 * (`saved`, per target) under a stable key: the shell compares against it for the 已改 marker, and its
 * reset hands it back to `restore` (default: the saved value itself; `null` removes the field).
 */
function trackRow(row: HTMLElement, block: SxiBlock, path: string[], rowKey: unknown, saved: Json[], restore: (current: Json, saved: Json) => Json = (_current, value) => value ?? undefined): void {
  row.dataset.inspectorRowKey = JSON.stringify([block.targets[0], path, rowKey])
  row.dataset.inspectorValue = JSON.stringify(saved.map((value) => value ?? null))
  row.addEventListener("inspector-reset", (event) => {
    event.preventDefault()
    const baseline = JSON.parse((event as CustomEvent<string>).detail) as Json[]
    writeSxiValue(block.targets, path, (current, index) => restore(current, baseline[index]))
  })
}

type Tracking = { key: unknown; saved: Json[]; restore?: (current: Json, saved: Json) => Json }

function palmRow(tag: "div" | "label", block: SxiBlock, path: string[], label: string, values: Json[], tracking: Tracking = { key: "", saved: values }): HTMLElement {
  const row = element(tag, "ui-field document-property-field")
  fieldCaption(row, path.join("."), label)
  trackRow(row, block, path, tracking.key, tracking.saved, tracking.restore)
  return row
}

function palmInput(type: "number" | "text", text: string, mixed: boolean, label: string): HTMLInputElement {
  const input = element("input", "document-property-input")
  input.type = type
  if (type === "number") input.step = "any"
  input.value = text
  input.placeholder = mixed ? "混合" : "未设置"
  input.disabled = !isEditing()
  input.setAttribute("aria-label", label)
  return input
}

function numberRow(block: SxiBlock, path: string[], label: string, values: Json[]): HTMLElement {
  const row = palmRow("label", block, path, label, values)
  const { value, mixed } = sharedValue(values)
  const text = numberText(value) ?? ""
  // Int.max reads as "inf", which a number box cannot show.
  const input = palmInput(text === "inf" ? "text" : "number", text, mixed, label)
  input.addEventListener("change", () => {
    const entered = input.value.trim()
    if (!entered) return writeSxiValue(block.targets, path, undefined)
    try {
      writeSxiValue(block.targets, path, numberValue(entered))
    } catch (error) {
      showError(error, label)
    }
  })
  row.append(input)
  return row
}

function textRow(block: SxiBlock, path: string[], label: string, values: Json[]): HTMLElement {
  const row = palmRow("label", block, path, label, values)
  const { value, mixed } = sharedValue(values)
  const input = palmInput("text", typeof value === "string" ? value : "", mixed, label)
  input.addEventListener("change", () => writeSxiValue(block.targets, path, input.value === "" ? undefined : input.value))
  row.append(input)
  return row
}

function switchRow(block: SxiBlock, path: string[], label: string, values: Json[]): HTMLElement {
  const row = palmRow("label", block, path, label, values)
  const input = element("input", "ui-switch")
  input.type = "checkbox"
  input.setAttribute("role", "switch")
  input.setAttribute("aria-label", label)
  input.checked = values[0] === true
  input.disabled = !isEditing()
  input.addEventListener("change", () => writeSxiValue(block.targets, path, input.checked))
  row.append(input)
  return row
}

/** Palm colours are ARGB hex without a prefix ("99373737"). */
function palmColorRow(block: SxiBlock, path: string[], label: string, values: Json[]): HTMLElement {
  const row = palmRow("div", block, path, label, values)
  const { value, mixed } = sharedValue(values)
  const current = typeof value === "string" ? value : ""
  const argb = (text: string) => (text.length === 6 ? `FF${text}` : text).toUpperCase()
  const control = element("span", "color-control ui-input ui-color")
  if (mixed) control.dataset.mixed = ""
  const picker = element("input")
  picker.type = "color"
  picker.value = `#${PALM_COLOR.test(current) ? argb(current).slice(2) : "000000"}`
  picker.setAttribute("aria-label", label)
  const text = palmInput("text", current, mixed, `${label}值`)
  const alpha = element("input")
  alpha.type = "number"
  alpha.min = "0"
  alpha.max = "1"
  alpha.step = "0.01"
  alpha.value = PALM_COLOR.test(current) ? String(Math.round(Number.parseInt(argb(current).slice(0, 2), 16) / 255 * 100) / 100) : "1"
  alpha.setAttribute("aria-label", `${label}透明度`)
  for (const input of [picker, alpha]) input.disabled = !isEditing()
  // Each target keeps the part of its own colour that was not edited.
  const own = (color: Json) => typeof color === "string" && PALM_COLOR.test(color) ? argb(color) : "FF000000"
  picker.addEventListener("change", () => writeSxiValue(block.targets, path, (color) => `${own(color).slice(0, 2)}${picker.value.slice(1).toUpperCase()}`))
  alpha.addEventListener("change", () => {
    if (alpha.value === "" || !alpha.checkValidity()) return
    const hex = Math.round(Number(alpha.value) * 255).toString(16).padStart(2, "0").toUpperCase()
    writeSxiValue(block.targets, path, (color) => `${hex}${own(color).slice(2)}`)
  })
  text.addEventListener("change", () => {
    const entered = text.value.trim().replace(/^(?:0x|#)/i, "")
    if (!entered) writeSxiValue(block.targets, path, undefined)
    else if (PALM_COLOR.test(entered)) writeSxiValue(block.targets, path, argb(entered))
    else text.value = current
  })
  control.append(picker, text, alpha)
  row.append(control)
  return row
}

/** Strings are spaced ("， 。 ？"), numbers comma-separated ("201,1"). */
function listRow(block: SxiBlock, path: string[], label: string, values: Json[]): HTMLElement {
  const row = palmRow("label", block, path, label, values)
  const { value, mixed } = sharedValue(values)
  const list = isPrimitiveList(value) ? value : []
  const spaced = list.some((item) => typeof item === "string")
  const input = palmInput("text", list.join(spaced ? " " : ","), mixed, label)
  input.addEventListener("change", () => {
    const parts = input.value.split(spaced ? /\s+/ : ",").map((part) => part.trim()).filter(Boolean)
    writeSxiValue(block.targets, path, parts.map((part) => !spaced && Number.isFinite(Number(part)) ? Number(part) : part))
  })
  row.append(input)
  return row
}

/** Prefixed number boxes for one value; only the edited box is written, so every model keeps its others. */
function partsRow(block: SxiBlock, path: string[], label: string, affixes: string[], values: Json[], parts: Array<number | undefined>, mixedParts: boolean[], update: (index: number, value: number, current: Json, model: number) => Json, tracking?: Tracking): HTMLElement {
  const row = palmRow("div", block, path, label, values, tracking)
  if (affixes.length === 4) row.dataset.stack = ""
  let edited = -1
  numberParts(row, label, affixes, parts.map((part, index) => mixedParts[index] || part === undefined ? "" : String(part)), (values) => {
    const index = edited
    edited = -1
    if (index >= 0 && values[index] !== "") writeSxiValue(block.targets, path, (current, model) => update(index, Number(values[index]), current, model))
  }, affixes.length === 4 ? 4 : undefined)
  Array.from(row.querySelectorAll("input")).forEach((input, index) => {
    if (mixedParts[index]) input.placeholder = "混合"
    input.addEventListener("input", () => { edited = index })
  })
  return row
}

function palmParts(values: Json[], read: (value: Json) => number[] | undefined, count: number): { parts: Array<number | undefined>; mixed: boolean[] } {
  const lists = values.map(read)
  const parts = Array.from({ length: count }, (_, index) => lists[0]?.[index])
  return { parts, mixed: parts.map((part, index) => lists.some((list) => list?.[index] !== part)) }
}

function pointRow(block: SxiBlock, path: string[], label: string, values: Json[]): HTMLElement {
  const { parts, mixed } = palmParts(values, (value) => isPoint(value) ? value : undefined, 2)
  const affixes = SIZE_KEYS.has(path[path.length - 1]) ? ["W", "H"] : ["X", "Y"]
  return partsRow(block, path, label, affixes, values, parts, mixed, (index, value, current) => {
    const point = isPoint(current) ? [...current] : [0, 0]
    point[index] = value
    return point
  })
}

/** A rect is `[[x, y], [w, h]]`: one row for the position, one for the size; `fallback` fills a missing one. */
function rectRows(block: SxiBlock, path: string[], labels: [string, string], values: Json[], fallback?: Json[]): HTMLElement[] {
  const read = (value: Json) => isRect(value) ? [...value[0], ...value[1]] : undefined
  const { parts, mixed } = palmParts(values.map((value, index) => isRect(value) ? value : fallback?.[index]), read, 4)
  return [0, 1].map((half) => {
    // Each half tracks and resets only its own pair; a rect the model did not have is removed again.
    const tracking: Tracking = {
      key: half,
      saved: values.map((value) => isRect(value) ? value[half] : null),
      restore: (current, saved) => {
        if (saved === null || !isRect(current)) return saved === null ? undefined : current
        const next: Json[] = [...current]
        next[half] = saved
        return next
      },
    }
    const row = partsRow(block, path, labels[half], half ? ["W", "H"] : ["X", "Y"], values, parts.slice(half * 2, half * 2 + 2), mixed.slice(half * 2, half * 2 + 2), (index, value, current, target) => {
      const model = read(isRect(current) ? current : fallback?.[target]) ?? [0, 0, 0, 0]
      model[half * 2 + index] = value
      return [[model[0], model[1]], [model[2], model[3]]]
    }, tracking)
    row.dataset.documentKey = `${path.join(".")}.${half ? "size" : "origin"}`
    if (!values.some((value) => isRect(value)) && fallback) {
      for (const input of Array.from(row.querySelectorAll("input"))) { input.value = ""; input.placeholder = "同按键" }
    }
    return row
  })
}

function insetsRow(block: SxiBlock, path: string[], label: string, values: Json[]): HTMLElement {
  const read = (value: Json) => {
    const object = asObject(value)
    return object && isInsets(object) ? INSET_SIDES.map((side) => object[side] as number) : undefined
  }
  const { parts, mixed } = palmParts(values, read, 4)
  return partsRow(block, path, label, ["↑", "→", "↓", "←"], values, parts, mixed, (index, value, current) => {
    const sides = read(current) ?? [0, 0, 0, 0]
    sides[index] = value
    return { top: sides[0], left: sides[3], bottom: sides[2], right: sides[1] }
  })
}

/** A style of `ss_1` (or a list of them) drawn as the shared style card. */
function styleRow(block: SxiBlock, path: string[], label: string, reference: string, values: Json[]): HTMLElement {
  const row = palmRow("label", block, path, label, values)
  const ids = (value: Json) => Array.isArray(value) ? value.map(String) : typeof value === "number" ? [String(value)] : []
  const { value, mixed } = sharedValue(values)
  const input = element("input")
  input.value = ids(value).join(",")
  input.placeholder = mixed ? "混合" : ""
  input.disabled = !isEditing()
  input.setAttribute("aria-label", label)
  if (block.keyForeground && reference === "FORE_STYLE") input.dataset.keyField = "FORE_STYLE"
  const listed = path[path.length - 1] === "base_f" || Array.isArray(values.find((item) => item !== undefined))
  input.addEventListener("change", () => {
    const list = input.value.split(",").map((part) => part.trim()).filter(Boolean).map(Number)
    if (list.some((id) => !Number.isSafeInteger(id) || id < 0)) {
      showError(new Error("样式编号必须是非负整数"), label)
      return refreshSxiDocument()
    }
    writeSxiValue(block.targets, path, list.length ? listed ? list : list[0] : undefined)
  })
  row.append(input)
  decorateStyleReferenceInput(input, reference)
  return row
}

function gestureMeaning(action: Json): string {
  const code = typeof action === "string" ? actionText(action) ?? "" : ""
  return /^F\d+$/.test(code) && code !== action ? actionDescription(code) : ""
}

/** A key's gesture list `[button, action, …]` with one button set, replaced or (empty) removed. */
function setGesture(current: Json, button: number, text: string): Json {
  const list = Array.isArray(current) ? [...current] : []
  const at = list.findIndex((item, index) => index % 2 === 0 && item === button)
  if (text) {
    if (at >= 0) list[at + 1] = actionValue(text)
    else list.push(button, actionValue(text))
  } else if (at >= 0) list.splice(at, 2)
  return list
}

function gestureAction(list: Json, button: number): Json {
  const items = Array.isArray(list) ? list : []
  for (let index = 0; index + 1 < items.length; index += 2) if (items[index] === button) return items[index + 1]
  return undefined
}

/** The gesture cross (DESIGN.md §10): tap in the middle, swipes around it, long-press below. */
export function gestureRows(block: SxiBlock, path: string[], values: Json[]): HTMLElement[] {
  const grid = element("div", "direction-editor inspector-gestures")
  grid.setAttribute("aria-label", "点击、滑动与长按动作")
  const options = element("datalist")
  options.id = "palm-action-names"
  options.append(...Object.entries(ACTION_CODES).map(([code, name]) => Object.assign(element("option"), { value: name, label: actionDescription(code) })))
  grid.append(options)
  const cell = (button: number, tag: "label", name: string, label: string, icon?: string) => {
    const node = element(tag, icon ? "inspector-gesture" : "ui-field document-property-field")
    const { value, mixed } = sharedValue(values.map((list) => gestureAction(list, button)))
    const caption = element("span")
    if (icon) {
      node.dataset.gesture = name
      caption.append(createIcon(icon, 14), label)
      node.append(caption)
    } else fieldCaption(node, `${path.join(".")}.${button}`, label)
    const actions = values.map((list) => gestureAction(list, button))
    trackRow(node, block, path, button, actions, (current, saved) => setGesture(current, button, saved === null || saved === undefined ? "" : String(saved)))
    const input = palmInput("text", value === undefined ? "" : String(value), mixed, `${label}动作`)
    if (icon && !mixed) input.placeholder = name === "HOLD" ? "未设置" : "+"
    input.setAttribute("list", options.id)
    input.addEventListener("change", () => writeSxiValue(block.targets, path, (current) => setGesture(current, button, input.value.trim())))
    node.append(input)
    if (icon) {
      const meaning = element("small")
      meaning.textContent = gestureMeaning(value)
      node.append(meaning)
    }
    return node
  }
  grid.append(...CROSS.map(([button, name, label, icon]) => cell(button, "label", name, label, icon)))
  // Buttons besides the cross only show when a key sets them.
  const others = OTHER_BUTTONS.filter(([button]) => values.some((list) => gestureAction(list, button) !== undefined))
  if (!others.length) return [grid]
  const rows = element("div", "document-property-grid")
  rows.append(...others.map(([button, label]) => cell(button, "label", "", label)))
  return [grid, rows]
}

/** Fields a block shows, as paths: the base model `b` is opened up into its own fields. */
function blockPaths(block: SxiBlock, models: JsonObject[]): string[][] {
  const first = models[0] ?? {}
  const paths = Object.keys(first).flatMap((key) => key === "b" && asObject(first.b) ? Object.keys(asObject(first.b)!).map((base) => ["b", base]) : [[key]])
    .filter((path) => models.every((model) => sxiValue(model, path) !== undefined))
  for (const expected of block.expect ?? []) {
    if (!paths.some((path) => path.join(".") === expected)) paths.push(expected.split("."))
  }
  const named = (path: string[]) => path.join(".")
  const kept = paths.filter((path) => !block.omit?.includes(named(path)) && !block.omit?.includes(path[0]))
  return block.only ? block.only.flatMap((name) => kept.filter((path) => named(path) === name)) : kept
}

/** Rows for one block, plus blocks for the nested models it holds. */
function blockRows(block: SxiBlock, skin: JsonObject): { rows: HTMLElement[]; nested: SxiBlock[] } {
  const models = block.targets.map((target) => asObject(sxiValue(skin, target)) ?? {})
  const rows: HTMLElement[] = []
  const nested: SxiBlock[] = []
  for (const path of blockPaths(block, models)) {
    const key = path[path.length - 1]
    const label = palmFieldLabel(key)
    const values = models.map((model) => sxiValue(model, path))
    const sample = values.find((value) => value !== undefined)
    const reference = palmStyleReference(key)
    if (reference && (sample === undefined || typeof sample === "number" || isPrimitiveList(sample))) rows.push(styleRow(block, path, label, reference, values))
    else if (isRect(sample) || key === "rect" || key === "hit_rect") {
      const fallback = key === "hit_rect" ? models.map((model) => model.rect) : undefined
      const labels: [string, string] = key === "rect" ? ["位置", "尺寸"] : key === "hit_rect" ? ["触摸位置", "触摸尺寸"] : [`${label}位置`, `${label}尺寸`]
      rows.push(...rectRows(block, path, labels, values, fallback))
    } else if (isPoint(sample) && !LIST_KEYS.has(key)) rows.push(pointRow(block, path, label, values))
    else if (isInsets(sample ?? null)) rows.push(insetsRow(block, path, label, values))
    else if (typeof sample === "boolean") rows.push(switchRow(block, path, label, values))
    else if (typeof sample === "number" || sample === undefined && NUMBER_KEYS.has(key)) rows.push(numberRow(block, path, label, values))
    else if (isColorKey(key) && (sample === undefined || typeof sample === "string" && PALM_COLOR.test(sample))) rows.push(palmColorRow(block, path, label, values))
    else if (typeof sample === "string" || sample === undefined) rows.push(textRow(block, path, label, values))
    else if (isPrimitiveList(sample)) rows.push(listRow(block, path, label, values))
    else if (Array.isArray(sample)) {
      const length = Math.min(...values.map((value) => Array.isArray(value) ? value.length : 0))
      for (let index = 0; index < length; index += 1) {
        nested.push({ targets: block.targets.map((target) => [...target, ...path, index]), title: `${label} ${index + 1}`, code: `${path.join(".")}[${index}]` })
      }
    } else if (asObject(sample)) {
      nested.push({ targets: block.targets.map((target) => [...target, ...path]), title: label, code: path.join(".") })
    }
  }
  return { rows, nested }
}

function palmBlockHeading(title: string, code?: string): HTMLElement {
  const heading = element("h4", "inspector-block-heading")
  const name = element("span")
  name.textContent = title
  heading.append(name)
  if (code) {
    const codeNode = element("code")
    codeNode.textContent = code
    heading.append(codeNode)
  }
  return heading
}

/** One inspector group (a rail entry): blocks under one title, nested models as further subsections. */
export function renderSxiGroup(label: string, blocks: SxiBlock[], options: { code?: string; extra?: HTMLElement[] } = {}): HTMLElement | undefined {
  // Reading only: the parse is shared with the canvas (edits go through editSxi on their own copy).
  const skin = openPalmSkin()
  if (!skin) return
  const section = element("section", "ui-section document-property-section")
  section.dataset.inspectorGroupLabel = label
  const heading = element("h3", "document-section-heading")
  const title = element("span", "document-section-title")
  title.textContent = label
  heading.append(title)
  if (options.code) {
    const code = element("span", "document-section-code")
    code.textContent = options.code
    heading.append(code)
  }
  section.append(heading, ...options.extra ?? [])
  const queue = [...blocks]
  const many = blocks.length > 1
  let shown = Boolean(options.extra?.length)
  for (let block = queue.shift(); block; block = queue.shift()) {
    const { rows, nested } = blockRows(block, skin)
    queue.push(...nested)
    if (!rows.length && !block.note) continue
    const subsection = element("div", "ui-subsection")
    if (block.title && (many || nested.length || !blocks.includes(block) || block.title !== label)) subsection.append(palmBlockHeading(block.title, block.code))
    if (block.note) {
      const note = element("p", "inspector-group-subtitle")
      note.textContent = block.note
      subsection.append(note)
    }
    if (rows.length) {
      const grid = element("div", "document-property-grid")
      grid.append(...rows)
      subsection.append(grid)
    }
    section.append(subsection)
    shown = true
  }
  return shown ? section : undefined
}
