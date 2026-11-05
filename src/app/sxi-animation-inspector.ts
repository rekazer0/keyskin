// Palm skin.json `ss_2` in the shared animation inspector (DESIGN.md §10「动画资源」): the list of
// animations in the current view, then the selected one's player, parameter sections, dedicated
// editors for combination tracks and liquid floaters, and where it is played. Every edit is written
// into skin.json as one undo step through the same helpers the rest of the Palm inspector uses.

import { element, iconButton } from "../dom-element.ts"
import {
  animationModeTitle, animationWarning, comboList, renderAnimationResource,
  type AnimationListItem,
} from "../animation-inspector.ts"
import { decodeFrames } from "../native-motion.ts"
import { palmPreviewClip } from "../palm/palm-preview-clip.ts"
import { PalmStyles } from "../palm/palm-styles.ts"
import { visualResolver } from "./bda-documents"
import {
  ANIMATION_FAMILIES,
  animationBase,
  animationFamilyInfo,
  animationGroups,
  animationModel,
  addableComboIds,
  animationReferences,
  animationStyles,
  animationTimeline,
  a1TypePatch,
  a1UnitPatch,
  a1Variant,
  baseNeedsFix,
  comboAnimations,
  comboMethod,
  floaterDefaults,
  floaterFields,
  newAnimation,
  type AnimationField,
  type AnimationPatch,
  type AnimationTimeline,
} from "../palm/sxi-animation.ts"
import { asObject, listText, numberText, numberValue, type Json, type JsonObject } from "../palm/sxi-ini.ts"
import { toPlaySpeedRates } from "../palm/palm-ini.ts"
import { compactPalmJSON } from "../palm/palm-json.ts"
import { SXI_SKIN_PATH } from "../palm/sxi-json.ts"
import { isEditing } from "./edit-history"
import { showError } from "./file-operations"
import { field as propertyField, section, type FieldSpec } from "./property-rows"
import { editSxi, sxiValue, writeSxiValue, type SxiPointer } from "./sxi-fields"
import { keyAnimationItems, keyPlaysStyle, keyboardPlayback, rememberAnimation, selectAnimation, selectedAnimation, selectAnimationStyle, selectedAnimationStyle, shownInAnimationView, styleAnimationItems } from "./animation-resource"
import type { PreviewItem } from "../preview-items.ts"
import { openPalmSkin, sxiPointer } from "./sxi-documents"
import { appState } from "./state"
import { animationStyleActions, animationStyleCard } from "./animation-style-inspector"

type AnimationEntry = { id: string; kind: string; model: JsonObject; wrap: JsonObject }

const A1_TYPES = ["透明度", "旋转", "位移", "缩放"]
const A1_ICONS = ["blend", "rotate-cw", "move", "scaling"]
const FAMILY_ICONS: Record<string, string> = {
  a3: "layers", af2: "list-video", a4: "sparkles", a10: "route", a11: "orbit", a12: "waves", a13: "party-popper", a14: "rabbit",
}

function animationPointer(): SxiPointer | undefined {
  const pointer = sxiPointer(appState.selectedPath)
  return pointer?.[2] === "ss_2" ? pointer : undefined
}

function animationEntries(table: JsonObject): AnimationEntry[] {
  return Object.entries(table)
    .flatMap(([id, wrap]) => {
      const object = asObject(wrap)
      const entry = object && animationModel(object)
      return entry ? [{ id, kind: entry.kind, model: entry.model, wrap: object }] : []
    })
    .sort((left, right) => Number(left.id) - Number(right.id) || left.id.localeCompare(right.id))
}

/* —— rows —— */
type Range = "duration" | "count" | "rate" | "alpha" | "angle"

/**
 * One property row (property-rows.ts field()). The shell compares this render's value with the first
 * render's for the change mark, and 重置 hands the first value back (same contract as sxi-fields' rows).
 */
function row(field: AnimationField, saved: Json, target: SxiPointer, path: string[], spec: FieldSpec, write: (value: never) => void,
  options: { suffix?: string; label?: string; reset?: (baseline: Json) => void } = {}): HTMLElement {
  return propertyField({
    key: field.key, label: options.label ?? field.label, spec, commit: (value) => write(value as never),
    rowKey: [target, path, options.suffix ?? ""],
    baseline: saved ?? null,
    reset: (baseline) => {
      if (target.at(-1) === "a1" && /^(from|to)(?:_p|_px)?$/.test(path[0])) {
        const model = asObject(sxiValue(openPalmSkin(), target))
        if (model && !animationGroups("a1", model).some((group) => group.fields.some((entry) => entry.key === path[0]))) return
      }
      if (options.reset) options.reset(baseline as Json)
      else commit(target, path, (baseline ?? undefined) as Json)
    },
  })
}

function commit(target: SxiPointer, path: string[], value: Json, action = "修改动画"): void {
  try {
    writeSxiValue([target], path, value)
  } catch (error) {
    showError(error, action)
  }
}

/** A typed number; `inf` (Int.max) stays text, an empty box removes the field. */
function writeNumber(target: SxiPointer, path: string[], label: string, text: string): void {
  if (!text) return commit(target, path, undefined)
  try {
    commit(target, path, numberValue(text))
  } catch (error) {
    showError(error, label)
  }
}

/** Values with a natural range get a slider beside the number (DESIGN.md §10). */
function sliderRange(target: SxiPointer, field: AnimationField): Range | undefined {
  const kind = target.at(-1)
  if (kind === "a4" && field.key === "count") return "count"
  if (kind === "a1" && (field.key === "from" || field.key === "to")) {
    const type = Number(animationBase(asObject(sxiValue(openPalmSkin(), target)) ?? {}).t ?? 0)
    return type === 0 ? "alpha" : type === 1 ? "angle" : undefined
  }
  if (field.scope === "base") return undefined
  return ["duration", "delay", "d"].includes(field.key) ? "duration" : field.key === "rate" ? "rate" : undefined
}

function numberRow(target: SxiPointer, path: string[], field: AnimationField, value: Json): HTMLElement {
  const text = numberText(value) ?? ""
  return row(field, value, target, path, { kind: "number", value: text, unit: field.unit, expression: text === "inf", range: sliderRange(target, field) },
    (next: string) => writeNumber(target, path, field.label, next))
}

function pointValues(value: Json): [Json, Json] {
  return Array.isArray(value) && value.length === 2 ? [value[0], value[1]] : [undefined, undefined]
}

function readNumber(text: string, fallback: Json = 0): number {
  try {
    return text ? numberValue(text) as number : Number(fallback ?? 0)
  } catch {
    return Number(fallback ?? 0)
  }
}

function pairRow(target: SxiPointer, path: string[], field: AnimationField, value: Json, axes: string[]): HTMLElement {
  return row(field, value, target, path, { kind: "parts", affixes: axes, values: pointValues(value).map((part) => numberText(part) ?? ""), unit: field.unit },
    (next: string[]) => commit(target, path, next.every((text) => !text) ? undefined : next.map((text) => readNumber(text))))
}

function rectRows(target: SxiPointer, path: string[], field: AnimationField, value: Json): HTMLElement[] {
  const rect = Array.isArray(value) && value.length === 2 ? value : undefined
  const origin = pointValues(rect?.[0])
  const size = pointValues(rect?.[1])
  const labels = ["位置", "尺寸"]
  // Both rows write and reset the whole rect, so a reset never leaves one half behind.
  return [0, 1].map((half) => row(field, value, target, path, {
    kind: "parts", affixes: half ? ["W", "H"] : ["X", "Y"], values: (half ? size : origin).map((part) => numberText(part) ?? ""),
  }, (next: string[]) => commit(target, path, half
    ? [[Number(origin[0] ?? 0), Number(origin[1] ?? 0)], [readNumber(next[0], size[0]), readNumber(next[1], size[1])]]
    : [[readNumber(next[0], origin[0]), readNumber(next[1], origin[1])], [Number(size[0] ?? 0), Number(size[1] ?? 0)]]),
  { suffix: `${field.key}.${half}`, label: `${field.label}${labels[half]}` }))
}

function listRow(target: SxiPointer, path: string[], field: AnimationField, value: Json): HTMLElement {
  const rates = (text: string) => text.split(",").length === 3 ? toPlaySpeedRates(text) : undefined
  return row(field, value, target, path, {
    kind: "text", value: listText(value) ?? "", placeholder: field.key === "psr" ? "三个正数，如 1,1,1" : "用逗号分隔",
    validate: field.key === "psr" ? (text) => rates(text) ? undefined : "播放速率必须是逗号分隔的三个正数" : undefined,
  }, (text: string) => {
    if (!text) return commit(target, path, undefined)
    if (field.key === "psr") return commit(target, path, rates(text)!)
    commit(target, path, text.split(",").map((part) => part.trim()).filter(Boolean).map((part) => /^-?\d+(?:\.\d+)?$/.test(part) ? Number(part) : part))
  })
}

function selectRow(target: SxiPointer, path: string[], field: AnimationField, value: Json): HTMLElement {
  const options = field.options ?? []
  const numeric = typeof value === "number" || options.every(([option]) => /^-?\d+$/.test(option))
  return row(field, value, target, path, {
    kind: "choice", value: value === undefined ? field.defaultValue ?? "" : String(value), options, unset: value === undefined && field.defaultValue === undefined,
  }, (next: string) => commit(target, path, next === "" ? undefined : numeric ? Number(next) : next))
}

function fieldRows(target: SxiPointer, field: AnimationField, value: Json): HTMLElement[] {
  const path = [field.key]
  const write = (next: Json) => commit(target, path, next)
  if (field.key === "i_p") return [row(field, value, target, path, { kind: "style", value: listText(value) ?? "", reference: "PARTICLE_IMAGE" }, (text: string) => {
    const ids = text.split(",").map((part) => part.trim()).filter(Boolean)
    write(ids.length ? ids.map((id) => /^\d+$/.test(id) ? Number(id) : id) : undefined)
  })]
  if (field.key === "file" && ["af2", "a11"].includes(String(target.at(-1)))) {
    // An image sequence file (af2, a11) as a picture card.
    const file = typeof value === "string" ? value : ""
    const resolver = visualResolver()
    return [row(field, value, target, path, {
      kind: "image", value: file,
      load: () => {
        const bytes = file && resolver instanceof PalmStyles ? resolver.bytes(file) : undefined
        return bytes && decodeFrames(bytes, /\.gif$/i.test(file) ? "image/gif" : /\.png$/i.test(file) ? "image/png" : "image/webp").then((frames) => frames[0]?.visual)
      },
    }, (next: string) => write(next || undefined))]
  }
  switch (field.kind) {
    case "number": return [numberRow(target, path, field, value)]
    case "bool": return [row(field, value, target, path, { kind: "switch", checked: value === undefined ? field.defaultValue === "true" : value === true }, (next: boolean) => write(next))]
    case "select": return [selectRow(target, path, field, value)]
    case "color": return [row(field, value, target, path, { kind: "color", value: typeof value === "string" ? value : "", codec: "#rgb" }, (next: string) => write(next || undefined))]
    case "point": return [pairRow(target, path, field, value, field.axes ?? ["X", "Y"])]
    case "rect": return rectRows(target, path, field, value)
    case "list": return [listRow(target, path, field, value)]
    default: return [row(field, value, target, path, { kind: "text", value: typeof value === "string" ? value : "" }, (next: string) => write(next || undefined))]
  }
}

/* —— segmented rows: a1 type and unit, combination method —— */
function choiceRow(key: string, label: string, options: Array<[value: string, text: string]>, current: string, identity: string, onSelect: (value: string) => void, reset?: (baseline: Json) => void): HTMLElement {
  return propertyField({
    key, label, spec: { kind: "choice", value: current, options }, commit: (value: string) => onSelect(value),
    rowKey: ["segmented", identity],
    reset: (baseline) => { if (reset) reset(baseline as Json); else if (String(baseline) !== current) onSelect(String(baseline)) },
  })
}

function a1TypeRow(target: SxiPointer, entry: AnimationEntry): HTMLElement {
  const type = Number(animationBase(entry.model).t ?? 0)
  const modelPointer = target.slice(0, -1)
  const ends = ["from", "to", "from_p", "to_p", "from_px", "to_px"]
  const snapshot: JsonObject = { type: animationBase(entry.model).t }
  for (const key of ends) if (entry.model[key] !== undefined) snapshot[key] = entry.model[key]
  const node = choiceRow("t", "变化属性", A1_TYPES.map((label, index) => [String(index), label]), String(type), `${modelPointer.join(".")}|变化属性`, (next) => {
    editSxi((skin) => {
      const model = asObject(sxiValue(skin, modelPointer))
      if (!model) throw new Error("skin.json 中缺少动画")
      applyPatch(model, a1TypePatch(model, Number(next)))
    })
  }, (baseline) => {
    // The type decides how from/to are spelled, so a reset puts both back together.
    const saved = asObject(baseline)
    if (!saved) return
    editSxi((skin) => {
      const model = asObject(sxiValue(skin, modelPointer))
      if (!model) throw new Error("skin.json 中缺少动画")
      const base = asObject(model.b) ?? {}
      model.b = base
      if (saved.type === undefined) delete base.t
      else base.t = saved.type
      for (const key of ends) {
        if (saved[key] === undefined) delete model[key]
        else model[key] = saved[key]
      }
    })
  })
  node.dataset.inspectorValue = JSON.stringify([snapshot])
  return node
}

function a1UnitRow(target: SxiPointer, entry: AnimationEntry): HTMLElement {
  const variant = a1Variant(entry.model)
  return choiceRow("from_px to_px", "位移单位", [["percent", "比例"], ["pixels", "像素"]], variant === "pixels" ? "pixels" : "percent", `${target.join(".")}|位移单位`, (value) => {
    editSxi((skin) => {
      const model = asObject(sxiValue(skin, target))
      if (!model) throw new Error(`skin.json 中缺少 ${target.join(".")}`)
      const patch = a1UnitPatch(model, value === "pixels" ? "pixels" : "percent")
      if (patch) applyPatch(model, patch)
    })
  })
}

function applyPatch(model: JsonObject, patch: AnimationPatch): void {
  for (const key of patch.remove) delete model[key]
  for (const [segments, value] of patch.set) {
    let cursor: JsonObject = model
    for (const step of segments.slice(0, -1)) {
      cursor[step] = asObject(cursor[step]) ?? {}
      cursor = cursor[step] as JsonObject
    }
    cursor[segments[segments.length - 1]] = value
  }
}


/**
 * Structural editors (the combination list, the floater list) are not single value rows, so a hidden
 * row carries their value: the shell can mark the section and 重置 can put the list back.
 */
function trackedControl(identity: unknown[], value: Json, restore: (baseline: Json) => void): HTMLElement {
  const row = element("div", "ui-field animation-tracker")
  row.hidden = true
  row.dataset.inspectorRowKey = JSON.stringify(["list", identity])
  // Key order changes when skin.json is re-encoded, so compare the canonical Palm JSON instead.
  row.dataset.inspectorValue = JSON.stringify([value === undefined ? null : compactPalmJSON(value)])
  row.addEventListener("inspector-reset", (event) => {
    event.preventDefault()
    const baseline = (JSON.parse((event as CustomEvent<string>).detail) as Array<string | null>)[0]
    restore(baseline === null ? undefined : JSON.parse(baseline))
  })
  return row
}


function editButton(icon: string, label: string, onClick: () => void): HTMLButtonElement {
  const button = iconButton(icon, label, onClick)
  button.dataset.size = "sm"
  button.disabled = !isEditing()
  return button
}

/* —— a3: combination tracks —— */
function comboSection(pointer: SxiPointer, entry: AnimationEntry, table: JsonObject): HTMLElement {
  const target = [...pointer, entry.id, "a3"]
  const children = comboAnimations(entry.model)
  const node = section("组合", [], { count: String(children.length) })
  const write = (mutate: (list: number[]) => number[]) => editSxi((skin) => {
    const model = asObject(sxiValue(skin, target))
    if (!model) throw new Error("skin.json 中缺少组合动画")
    model.animations = mutate(comboAnimations(model))
  })
  node.append(choiceRow("a_method", "组合方式", [["simultaneous", "同时"], ["sequential", "顺序"], ["random", "随机"]], comboMethod(entry.model), `${target.join(".")}|组合方式`, (value) => {
    editSxi((skin) => {
      const model = asObject(sxiValue(skin, target))
      if (!model) throw new Error("skin.json 中缺少组合动画")
      model.a_method = value
      model.method = { [value === "simultaneous" ? "simultaneous" : "sequential"]: {} }
    })
  }))
  node.append(comboList({
    editable: isEditing(),
    empty: "没有子动画",
    children: children.map((id) => {
      const child = asObject(table[String(id)])
      const info = child && animationModel(child)
      return info
        ? { title: `动画 ${id}`, detail: `${kindLabel(info.kind, info.model)} · ${timelineText(animationTimeline(info.kind, info.model, table))}` }
        : { title: `动画 ${id}`, detail: "子动画不存在，请移除这个引用", missing: true }
    }),
    move: (index, offset) => write((items) => swap(items, index, index + offset)),
    remove: (index) => write((items) => items.filter((_, position) => position !== index)),
    add: {
      options: addableComboIds(table, entry.id).filter((id) => !children.some((child) => String(child) === id)).map((id) => [id, `动画 ${id}`]),
      run: (id) => write((items) => [...items, Number(id)]),
    },
  }))
  node.append(trackedControl(target.concat("animations"), children, (baseline) => {
    write(() => Array.isArray(baseline) ? baseline.filter((item): item is number => typeof item === "number") : [])
  }))
  return node
}

function swap<T>(items: T[], left: number, right: number): T[] {
  if (left < 0 || right < 0 || left >= items.length || right >= items.length) return items
  const next = [...items]
  ;[next[left], next[right]] = [next[right], next[left]]
  return next
}

function timelineText(timeline: AnimationTimeline): string {
  if (timeline.continuous) return timeline.repeatText
  if (timeline.unknown) return "时长待定"
  return `${timeline.totalDuration ?? timeline.duration ?? 0} ms`
}

/* —— a12: floaters —— */
function floatersSection(pointer: SxiPointer, entry: AnimationEntry): HTMLElement {
  const floaters = Array.isArray(entry.model.floaters) ? entry.model.floaters : []
  const target = [...pointer, entry.id, "a12"]
  const edit = (change: (model: JsonObject) => void) => editSxi((skin) => {
    const model = asObject(sxiValue(skin, target))
    if (!model) throw new Error("skin.json 中缺少液体动画")
    change(model)
  })
  const node = section("浮动物体", [], { count: String(floaters.length), actions: [editButton("plus", "添加浮动物体", () => edit((model) => {
    model.floaters = [...Array.isArray(model.floaters) ? model.floaters : [], floaterDefaults()]
  }))] })
  node.append(trackedControl([...target, "floaters"], entry.model.floaters, (baseline) => edit((model) => {
    if (baseline === undefined) delete model.floaters
    else model.floaters = baseline
  })))
  if (!floaters.length) {
    const empty = element("p", "inspector-group-subtitle")
    empty.textContent = "没有浮动物体"
    node.append(empty)
    return node
  }
  const fields = floaterFields()
  for (const [index, value] of floaters.entries()) {
    const floater = asObject(value)
    if (!floater) continue
    const block = element("div", "ui-subsection animation-floater")
    const heading = element("h4")
    heading.textContent = `物体 ${index + 1}`
    heading.append(editButton("trash-2", `删除物体 ${index + 1}`, () => edit((model) => {
      model.floaters = (Array.isArray(model.floaters) ? model.floaters : []).filter((_, position) => position !== index)
    })))
    block.append(heading)
    for (const field of fields) block.append(...fieldRows([...target, "floaters", index], field, floater[field.key]))
    node.append(block)
  }
  return node
}

/* —— list, sections and uses —— */
function kindLabel(kind: string, model: JsonObject): string {
  return kind === "a1" ? A1_TYPES[Number(animationBase(model).t ?? 0)] ?? "属性变化" : animationFamilyInfo(kind)?.label ?? kind
}

function listItem(skin: JsonObject, pointer: SxiPointer, entry: AnimationEntry, table: JsonObject): AnimationListItem {
  const timeline = animationTimeline(entry.kind, entry.model, table)
  const references = animationReferences(skin, pointer, entry.id)
  const detail = entry.kind === "a3"
    ? [{ simultaneous: "同时", sequential: "顺序", random: "随机" }[comboMethod(entry.model)], `${comboAnimations(entry.model).length} 个子动画`, timelineText(timeline)]
    : entry.kind === "a4"
      ? [`${Number(entry.model.count ?? 0)} 个粒子`, timelineText(timeline)]
      : [timelineText(timeline), timeline.reverse ? "往返" : "", !timeline.continuous && timeline.repeatText !== "播放一次" ? timeline.repeatText : ""]
  const missing = entry.kind === "a3" && comboAnimations(entry.model).some((id) => !asObject(table[String(id)]))
  const info = [entry.model.INFO, entry.model.info, entry.wrap.INFO, entry.wrap.info]
    .find((value): value is string => typeof value === "string" && Boolean(value.trim()))
  return {
    id: entry.id,
    title: `动画 ${entry.id}`,
    info: info?.trim(),
    kind: kindLabel(entry.kind, entry.model),
    icon: entry.kind === "a1" ? A1_ICONS[Number(animationBase(entry.model).t ?? 0)] ?? "blend" : FAMILY_ICONS[entry.kind] ?? "clapperboard",
    detail: detail.filter(Boolean).join(" · "),
    uses: references.styles.length + references.combos.length,
    problem: baseNeedsFix(entry.kind, entry.model) ? "分类值与动画类型不一致" : missing ? "组合里有不存在的子动画" : undefined,
  }
}

function parameterSections(pointer: SxiPointer, entry: AnimationEntry, table: JsonObject): HTMLElement[] {
  if (entry.kind === "a3") return [comboSection(pointer, entry, table)]
  const target: SxiPointer = [...pointer, entry.id, entry.kind]
  const sections = animationGroups(entry.kind, entry.model).map((group) => {
    const node = section(group.title, group.fields.flatMap((field) => {
      if (entry.kind === "a1" && field.key === "t") return [a1TypeRow([...target, "b"], entry)]
      const scoped = field.scope === "base" ? [...target, "b"] : target
      return fieldRows(scoped, field, field.scope === "base" ? sxiValue(entry.model, ["b", field.key]) : entry.model[field.key])
    }))
    // Only 位移 has a percent / pixel spelling; 旋转 and 缩放 always use percent.
    if (entry.kind === "a1" && group.title === "变化" && Number(animationBase(entry.model).t) === 2) {
      node.append(a1UnitRow(target, entry))
      const note = element("p", "ui-field-note")
      note.textContent = "切换单位只保留数值，不按画布尺寸换算"
      node.append(note)
    }
    return node
  })
  if (entry.kind === "a12") sections.push(floatersSection(pointer, entry))
  return sections
}

/** Styles that play `id` on press, directly or through a combination: the keyboard canvas plays these. */
function pressStyles(skin: JsonObject, pointer: SxiPointer, id: string, cache = new Map<string, Set<string>>()): Set<string> {
  const cached = cache.get(id)
  if (cached) return cached
  const direct = animationReferences(skin, pointer, id)
  const result = new Set([direct, ...direct.combos.map((combo) => animationReferences(skin, pointer, String(combo)))]
    .flatMap((references) => references.styles.filter((style) => style.events.includes("按下")))
    .flatMap((style) => style.name.match(/(\d+)$/)?.[1] ?? []))
  cache.set(id, result)
  return result
}

// IDs are shared by inherited animations as well as orientation-specific overrides.
function appendAnimation(skin: JsonObject, pointer: SxiPointer, create: (id: string) => JsonObject): void {
  const theme = asObject(skin[String(pointer[0])]) ?? {}
  const ids = new Set(["s_info", "s_port", "s_land"].flatMap((key) => Object.keys(asObject(asObject(theme[key])?.ss_2) ?? {})))
  let id = 1
  while (ids.has(String(id))) id += 1
  const table = asObject(sxiValue(skin, pointer))
  if (!table) throw new Error("skin.json 中缺少动画表")
  table[String(id)] = create(String(id))
  rememberAnimation(String(id))
}

/* —— entry points —— */
export function populateSxiAnimationInspector(container: HTMLElement): boolean {
  const pointer = animationPointer()
  const skin = pointer && openPalmSkin()
  const table = skin && pointer ? asObject(sxiValue(skin, pointer)) : undefined
  if (!pointer || !skin || !table) return false
  const entries = animationEntries(table).filter((entry) => shownInAnimationView(entry.kind === "a4"))
  const pressStyleCache = new Map<string, Set<string>>()
  const plays = (id: string, key: PreviewItem) => keyPlaysStyle(key, pressStyles(skin, pointer, id, pressStyleCache))
  const { items: keyItems, keyFilter } = keyAnimationItems(entries.map((entry) => listItem(skin, pointer, entry, table)), plays)
  // 样式列表只列引用了当前入口动效的样式；点一个就把列表筛成它播放的动画。
  const styles = animationStyles(skin, pointer)
  const shown = new Set(entries.map((entry) => entry.id))
  const styleItems = styles.flatMap((style) => {
    const included = style.animations.filter((id) => shown.has(id))
    return included.length ? [{ id: style.id, title: `样式 ${style.id}`, detail: style.events.join(" · "), count: included.length }] : []
  })
  const styleAnimations = new Map(styles.map((style) => [style.id, new Set(style.animations)]))
  const { items, styleFilter } = styleAnimationItems(keyItems, styleItems, (id, style) => Boolean(styleAnimations.get(style)?.has(id)))
  const selected = selectedAnimation(items)
  const entry = entries.find((candidate) => candidate.id === selected)
  const resolver = visualResolver()
  const references = entry && animationReferences(skin, pointer, entry.id)
  const family = entry && animationFamilyInfo(entry.kind)
  renderAnimationResource(container, {
    listSource: appState.archive,
    mode: appState.animationDesignMode,
    sectionClass: "document-property-section",
    items,
    selected,
    keyFilter,
    styles: { noun: "样式", icon: "paintbrush", items: styleItems, selected: selectedAnimationStyle(), onSelect: selectAnimationStyle, card: animationStyleCard, ...animationStyleActions(entry && /^\d+$/.test(entry.id) ? Number(entry.id) : undefined) },
    thumbnail: id => ({ clip: palmPreviewClip(table, id), key: `${appState.selectedPath}|${id}`, resolver,
      readFile: resolver instanceof PalmStyles ? file => resolver.bytes(file) : undefined }),
    styleFilter,
    editable: isEditing(),
    onSelect: selectAnimation,
    create: {
      options: ANIMATION_FAMILIES.filter((candidate) => shownInAnimationView(candidate.id === "a4"))
        .map((candidate) => [candidate.id, candidate.id === "a4" ? "粒子" : candidate.label]),
      run: (kind) => editSxi((current) => appendAnimation(current, pointer, (id) => newAnimation(kind, id))),
    },
    duplicate: () => entry && editSxi((current) => appendAnimation(current, pointer, (next) => {
      const wrap = structuredClone(asObject(sxiValue(current, [...pointer, entry.id])) ?? {})
      wrap.id = `ANIM${next}`
      return wrap
    })),
    remove: {
      blocked: references && (references.styles.length || references.combos.length) ? "请先解除样式和组合引用" : undefined,
      run: () => entry && editSxi((current) => {
        const latest = animationReferences(current, pointer, entry.id)
        if (latest.styles.length || latest.combos.length) return
        delete asObject(sxiValue(current, pointer))?.[entry.id]
        const index = items.findIndex((item) => item.id === entry.id)
        const neighbour = items[index + 1] ?? items[index - 1]
        if (neighbour) rememberAnimation(neighbour.id)
      }),
    },
    player: entry && {
      clip: palmPreviewClip(table, entry.id),
      key: `${SXI_SKIN_PATH}|${pointer.join(".")}|${entry.id}`,
      resolver,
      readFile: resolver instanceof PalmStyles ? (file) => resolver.bytes(file) : undefined,
      keyboard: keyboardPlayback((key) => keyPlaysStyle(key, pressStyleCache.get(entry.id) ?? pressStyles(skin, pointer, entry.id, pressStyleCache))),
    },
    warnings: entry && baseNeedsFix(entry.kind, entry.model)
      ? [animationWarning(`分类值 ${String(animationBase(entry.model).c)} 与${family?.label ?? "动画"}不一致，导出后可能无法识别。`, {
          label: "修正", disabled: !isEditing(),
          run: () => commit([...pointer, entry.id, entry.kind, "b"], ["c"], family?.category ?? 0, "修正动画分类"),
        })]
      : [],
    sections: entry ? parameterSections(pointer, entry, table) : [],
  })
  container.dataset.path = appState.selectedPath
  return true
}

export function sxiAnimationInspectorTitle(): { name: string; context: string } | undefined {
  const pointer = animationPointer()
  if (!pointer) return
  return { name: animationModeTitle(appState.animationDesignMode), context: `${SXI_SKIN_PATH} · ${pointer.slice(1).join(".")}` }
}
