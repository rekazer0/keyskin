// Palm skin.json `ss_2` in the shared animation inspector (DESIGN.md §10「动画资源」): the list of
// animations in the current view, then the selected one's player, parameter sections, dedicated
// editors for combination tracks and liquid floaters, and where it is played. Every edit is written
// into skin.json as one undo step through the same helpers the rest of the Palm inspector uses.

import { element, iconButton } from "../dom-element.ts"
import {
  animationModeTitle, animationSection, animationWarning, comboList, renderAnimationResource,
  type AnimationListItem, type AnimationUse,
} from "../animation-inspector.ts"
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
import { fieldCaption } from "./property-rows"
import { editSxi, sxiValue, writeSxiValue, type SxiPointer } from "./sxi-fields"
import { rememberAnimation, selectAnimation, selectedAnimation, shownInAnimationView } from "./animation-resource"
import { openPalmSkin, sxiPointer } from "./sxi-documents"
import { appState } from "./state"

type AnimationEntry = { id: string; kind: string; model: JsonObject; wrap: JsonObject }

const SECTION = "document-property-section"
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
function fieldRow(field: AnimationField, saved: Json, target: SxiPointer, path: string[], suffix: string, onReset?: (baseline: Json) => void, label = field.label): HTMLLabelElement {
  const row = element("label", "ui-field document-property-field")
  fieldCaption(row, field.key, label)
  row.dataset.inspectorRowKey = JSON.stringify([target, path, suffix])
  // The shell compares this render's value with the first render's for the change mark, and hands
  // the first value back on reset (same contract as sxi-fields' rows).
  row.dataset.inspectorValue = JSON.stringify([saved ?? null])
  row.addEventListener("inspector-reset", (event) => {
    if (target.at(-1) === "a1" && /^(from|to)(?:_p|_px)?$/.test(path[0])) {
      const model = asObject(sxiValue(openPalmSkin(), target))
      if (model && !animationGroups("a1", model).some((group) => group.fields.some((entry) => entry.key === path[0]))) return
    }
    event.preventDefault()
    const baseline = (JSON.parse((event as CustomEvent<string>).detail) as Json[])[0]
    if (onReset) onReset(baseline)
    else commit(target, path, baseline ?? undefined)
  })
  return row
}

function commit(target: SxiPointer, path: string[], value: Json, action = "修改动画"): void {
  try {
    writeSxiValue([target], path, value)
  } catch (error) {
    showError(error, action)
  }
}

function numberInput(value: Json, label: string, disabled: boolean): HTMLInputElement {
  const text = numberText(value)
  const input = element("input")
  input.type = text === "inf" ? "text" : "number"
  input.step = "any"
  input.value = text ?? ""
  input.placeholder = "未设置"
  input.disabled = disabled
  input.setAttribute("aria-label", label)
  return input
}

function numberRow(target: SxiPointer, path: string[], field: AnimationField, value: Json, rowKey = ""): HTMLElement {
  const row = fieldRow(field, value, target, path, rowKey)
  const control = element("span", "ui-input")
  const input = numberInput(value, field.label, !isEditing())
  input.addEventListener("change", () => {
    const text = input.value.trim()
    if (!text) return commit(target, path, undefined)
    try {
      commit(target, path, numberValue(text))
    } catch (error) {
      showError(error, field.label)
    }
  })
  control.append(input)
  if (field.unit) {
    const suffix = element("span", "ui-input-affix")
    suffix.textContent = field.unit
    control.append(suffix)
  }
  row.append(control)
  return row
}

function textRow(target: SxiPointer, path: string[], field: AnimationField, value: Json): HTMLElement {
  const row = fieldRow(field, value, target, path, "")
  const control = element("span", "ui-input")
  const input = element("input")
  input.type = "text"
  input.value = typeof value === "string" ? value : ""
  input.placeholder = "未设置"
  input.disabled = !isEditing()
  input.setAttribute("aria-label", field.label)
  input.addEventListener("change", () => commit(target, path, input.value || undefined))
  control.append(input)
  row.append(control)
  return row
}

function selectRow(target: SxiPointer, path: string[], field: AnimationField, value: Json, write?: (value: Json) => void, onReset?: (baseline: Json) => void): HTMLElement {
  const row = fieldRow(field, value, target, path, "", onReset)
  const control = element("span", "ui-input ui-select")
  const select = element("select")
  select.setAttribute("aria-label", field.label)
  select.disabled = !isEditing()
  const options = [...field.options ?? []]
  if (value === undefined && field.defaultValue === undefined) options.unshift(["", "未设置"])
  if (value !== undefined && !options.some(([option]) => option === String(value))) options.push([String(value), `${String(value)}（当前）`])
  for (const [option, label] of options) select.append(new Option(label, option))
  select.value = value === undefined ? field.defaultValue ?? "" : String(value)
  const numeric = typeof value === "number" || options.filter(([option]) => option !== "").every(([option]) => /^-?\d+$/.test(option))
  select.addEventListener("change", () => {
    const next: Json = select.value === "" ? undefined : numeric ? Number(select.value) : select.value
    if (write && next !== undefined) write(next)
    else commit(target, path, next)
  })
  control.append(select)
  row.append(control)
  return row
}

function switchRow(target: SxiPointer, path: string[], field: AnimationField, value: Json): HTMLElement {
  const row = fieldRow(field, value, target, path, "")
  const input = element("input", "ui-switch")
  input.type = "checkbox"
  input.setAttribute("role", "switch")
  input.setAttribute("aria-label", field.label)
  input.checked = value === undefined ? field.defaultValue === "true" : value === true
  input.disabled = !isEditing()
  input.addEventListener("change", () => commit(target, path, input.checked))
  row.append(input)
  return row
}

function colorRow(target: SxiPointer, path: string[], field: AnimationField, value: Json): HTMLElement {
  const row = fieldRow(field, value, target, path, "")
  const current = typeof value === "string" ? value : ""
  const hex = /^#?([0-9a-f]{6})$/i.exec(current)?.[1] ?? "000000"
  const control = element("span", "color-control ui-input ui-color")
  const picker = element("input")
  picker.type = "color"
  picker.value = `#${hex}`
  picker.disabled = !isEditing()
  picker.setAttribute("aria-label", `${field.label}颜色选择器`)
  const text = element("input")
  text.type = "text"
  text.value = current
  text.placeholder = "#RRGGBB"
  text.disabled = !isEditing()
  text.setAttribute("aria-label", `${field.label}色值`)
  const write = (next: string) => {
    const trimmed = next.trim()
    if (!trimmed) return commit(target, path, undefined)
    if (!/^#?[0-9a-f]{6}$/i.test(trimmed)) {
      showError(new Error("颜色应为 #RRGGBB"), field.label)
      text.value = current
      return
    }
    commit(target, path, `#${trimmed.replace(/^#/, "").toUpperCase()}`)
  }
  picker.addEventListener("change", () => {
    text.value = picker.value.toUpperCase()
    commit(target, path, picker.value.toUpperCase())
  })
  text.addEventListener("change", () => write(text.value))
  control.append(picker, text)
  row.append(control)
  return row
}

function pointValues(value: Json): [Json, Json] {
  return Array.isArray(value) && value.length === 2 ? [value[0], value[1]] : [undefined, undefined]
}

function pairRow(target: SxiPointer, path: string[], field: AnimationField, value: Json, axes: string[], rowKey = ""): HTMLElement {
  const row = fieldRow(field, value, target, path, rowKey)
  const wrap = element("span", "ui-field-pair")
  const parts = pointValues(value)
  const inputs = axes.map((axis, index) => {
    const box = element("span", "ui-input")
    const affix = element("span", "ui-input-affix")
    affix.textContent = axis
    const input = numberInput(parts[index], `${field.label}${axis}`, !isEditing())
    input.placeholder = axis
    box.append(affix, input)
    wrap.append(box)
    return input
  })
  const write = () => {
    if (inputs.every((input) => !input.value.trim())) return commit(target, path, undefined)
    const next = inputs.map((input) => {
      try {
        return input.value.trim() ? numberValue(input.value) : 0
      } catch {
        return 0
      }
    })
    commit(target, path, next)
  }
  for (const input of inputs) input.addEventListener("change", write)
  row.append(wrap)
  return row
}

function rectRow(target: SxiPointer, path: string[], field: AnimationField, value: Json): HTMLElement[] {
  const rect = Array.isArray(value) && value.length === 2 ? value : undefined
  const origin = pointValues(rect?.[0])
  const size = pointValues(rect?.[1])
  const values = [...origin, ...size]
  const labels = ["位置", "尺寸"]
  const read = (input: HTMLInputElement, fallback: Json) => {
    try {
      return input.value.trim() ? numberValue(input.value) : Number(fallback ?? 0)
    } catch {
      return Number(fallback ?? 0)
    }
  }
  return [0, 1].map((half) => {
    // Both rows write and reset the whole rect, so a reset never leaves one half behind.
    const row = fieldRow(field, value, target, path, `${field.key}.${half}`, undefined, `${field.label}${labels[half]}`)
    const wrap = element("span", "ui-field-pair")
    const inputs = (half === 0 ? ["X", "Y"] : ["W", "H"]).map((axis, index) => {
      const box = element("span", "ui-input")
      const affix = element("span", "ui-input-affix")
      affix.textContent = axis
      const input = numberInput(values[half * 2 + index], `${field.label}${labels[half]}${axis}`, !isEditing())
      input.placeholder = axis
      box.append(affix, input)
      wrap.append(box)
      return input
    })
    for (const input of inputs) {
      input.addEventListener("change", () => {
        const originValue = half === 0
          ? [read(inputs[0], origin[0]), read(inputs[1], origin[1])]
          : [Number(origin[0] ?? 0), Number(origin[1] ?? 0)]
        const sizeValue = half === 1
          ? [read(inputs[0], size[0]), read(inputs[1], size[1])]
          : [Number(size[0] ?? 0), Number(size[1] ?? 0)]
        commit(target, path, [originValue, sizeValue])
      })
    }
    row.append(wrap)
    return row
  })
}

function listRow(target: SxiPointer, path: string[], field: AnimationField, value: Json): HTMLElement {
  const row = fieldRow(field, value, target, path, "")
  const control = element("span", "ui-input")
  const input = element("input")
  input.type = "text"
  input.value = listText(value) ?? ""
  input.placeholder = field.key === "psr" ? "三个正数，如 1,1,1" : "用逗号分隔"
  input.disabled = !isEditing()
  input.setAttribute("aria-label", field.label)
  const write = () => {
    const text = input.value.trim()
    if (!text) return commit(target, path, undefined)
    if (field.key === "psr") {
      const rates = text.split(",").length === 3 ? toPlaySpeedRates(text) : undefined
      if (!rates) {
        input.setCustomValidity("播放速率必须是逗号分隔的三个正数")
        input.reportValidity()
        return
      }
      input.setCustomValidity("")
      return commit(target, path, rates)
    }
    commit(target, path, text.split(",").map((part) => part.trim()).filter(Boolean).map((part) => /^-?\d+(?:\.\d+)?$/.test(part) ? Number(part) : part))
  }
  input.addEventListener("change", write)
  input.addEventListener("input", () => input.setCustomValidity(""))
  control.append(input)
  row.append(control)
  return row
}

function fieldRows(target: SxiPointer, field: AnimationField, value: Json): HTMLElement[] {
  switch (field.kind) {
    case "number": return [numberRow(target, [field.key], field, value)]
    case "bool": return [switchRow(target, [field.key], field, value)]
    case "select": return [selectRow(target, [field.key], field, value)]
    case "color": return [colorRow(target, [field.key], field, value)]
    case "point": return [pairRow(target, [field.key], field, value, field.axes ?? ["X", "Y"])]
    case "rect": return rectRow(target, [field.key], field, value)
    case "list": return [listRow(target, [field.key], field, value)]
    default: return [textRow(target, [field.key], field, value)]
  }
}


/* —— segmented rows: a1 type and unit, combination method —— */
function segmentedRow(label: string, options: Array<[value: string, text: string]>, current: string, onSelect: (value: string) => void, title?: string, identity = label, key?: string, reset?: (baseline: Json) => void): HTMLElement {
  const row = element("div", "ui-field document-property-field")
  if (key) row.dataset.documentKey = key
  row.dataset.inspectorRowKey = JSON.stringify(["segmented", identity])
  row.dataset.inspectorValue = JSON.stringify([current])
  const caption = element("span", "document-field-caption")
  caption.textContent = label
  caption.title = title ?? label
  const group = element("span", "ui-segmented")
  group.setAttribute("role", "group")
  group.setAttribute("aria-label", label)
  // A hidden select carries the value so the inspector's change marks and 重置 cover this row too.
  const proxy = element("select", "animation-proxy") as HTMLSelectElement
  proxy.tabIndex = -1
  proxy.setAttribute("aria-hidden", "true")
  for (const [value, text] of options) {
    const button = element("button")
    button.type = "button"
    button.textContent = text
    button.disabled = !isEditing()
    button.setAttribute("aria-pressed", String(value === current))
    button.addEventListener("click", () => {
      if (value === current) return
      onSelect(value)
    })
    group.append(button)
    proxy.append(new Option(text, value))
  }
  proxy.value = current
  proxy.addEventListener("change", () => onSelect(proxy.value))
  row.addEventListener("inspector-reset", (event) => {
    event.preventDefault()
    const baseline = (JSON.parse((event as CustomEvent<string>).detail) as Json[])[0]
    if (reset) reset(baseline)
    else if (String(baseline) !== proxy.value) onSelect(String(baseline))
  })
  row.append(caption, group, proxy)
  return row
}


function a1TypeRow(target: SxiPointer, entry: AnimationEntry): HTMLElement {
  const type = Number(animationBase(entry.model).t ?? 0)
  const modelPointer = target.slice(0, -1)
  const ends = ["from", "to", "from_p", "to_p", "from_px", "to_px"]
  const snapshot: JsonObject = { type: animationBase(entry.model).t }
  for (const key of ends) if (entry.model[key] !== undefined) snapshot[key] = entry.model[key]
  const row = segmentedRow("变化属性", A1_TYPES.map((label, index) => [String(index), label]), String(type), (next) => {
    editSxi((skin) => {
      const model = asObject(sxiValue(skin, modelPointer))
      if (!model) throw new Error("skin.json 中缺少动画")
      applyPatch(model, a1TypePatch(model, Number(next)))
    })
  }, "透明度、旋转、位移或缩放；切换后起止值换成新属性的写法", `${modelPointer.join(".")}|变化属性`, "t", (baseline) => {
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
  row.dataset.inspectorValue = JSON.stringify([snapshot])
  return row
}

function a1UnitRow(target: SxiPointer, entry: AnimationEntry): HTMLElement {
  const variant = a1Variant(entry.model)
  return segmentedRow("位移单位", [["percent", "比例"], ["pixels", "像素"]], variant === "pixels" ? "pixels" : "percent", (value) => {
    editSxi((skin) => {
      const model = asObject(sxiValue(skin, target))
      if (!model) throw new Error(`skin.json 中缺少 ${target.join(".")}`)
      const patch = a1UnitPatch(model, value === "pixels" ? "pixels" : "percent")
      if (patch) applyPatch(model, patch)
    })
  }, "相对按键尺寸或按像素位移", `${target.join(".")}|位移单位`, "from_px to_px")
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
  const row = element("div", "document-property-field animation-tracker")
  row.hidden = true
  row.dataset.inspectorRowKey = JSON.stringify(["list", identity])
  // Key order changes when skin.json is re-encoded, so compare the canonical Palm JSON instead.
  row.dataset.inspectorValue = JSON.stringify([value === undefined ? null : compactPalmJSON(value)])
  const select = element("select")
  select.tabIndex = -1
  select.setAttribute("aria-hidden", "true")
  select.append(new Option("", ""))
  select.disabled = !isEditing()
  row.append(select)
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
  const section = animationSection("组合", SECTION)
  const target = [...pointer, entry.id, "a3"]
  const children = comboAnimations(entry.model)
  const write = (mutate: (list: number[]) => number[]) => editSxi((skin) => {
    const model = asObject(sxiValue(skin, target))
    if (!model) throw new Error("skin.json 中缺少组合动画")
    model.animations = mutate(comboAnimations(model))
  })
  section.append(segmentedRow("组合方式", [["simultaneous", "同时"], ["sequential", "顺序"], ["random", "随机"]], comboMethod(entry.model), (value) => {
    editSxi((skin) => {
      const model = asObject(sxiValue(skin, target))
      if (!model) throw new Error("skin.json 中缺少组合动画")
      model.a_method = value
      model.method = { [value === "simultaneous" ? "simultaneous" : "sequential"]: {} }
    })
  }, "顺序播放会按列表依次衔接", `${target.join(".")}|组合方式`, "a_method"))
  section.append(comboList({
    editable: isEditing(),
    empty: "还没有子动画；顺序播放需要至少两个。",
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
  section.append(trackedControl(target.concat("animations"), children, (baseline) => {
    write(() => Array.isArray(baseline) ? baseline.filter((item): item is number => typeof item === "number") : [])
  }))
  return section
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
  const section = animationSection("浮动物体", SECTION, `${floaters.length} 个`)
  const edit = (change: (model: JsonObject) => void) => editSxi((skin) => {
    const model = asObject(sxiValue(skin, target))
    if (!model) throw new Error("skin.json 中缺少液体动画")
    change(model)
  })
  section.querySelector("h3")!.append(editButton("plus", "添加浮动物体", () => edit((model) => {
    model.floaters = [...Array.isArray(model.floaters) ? model.floaters : [], floaterDefaults()]
  })))
  section.append(trackedControl([...target, "floaters"], entry.model.floaters, (baseline) => edit((model) => {
    if (baseline === undefined) delete model.floaters
    else model.floaters = baseline
  })))
  if (!floaters.length) {
    const empty = element("p", "inspector-group-subtitle")
    empty.textContent = "还没有浮动物体；添加后液体表面会出现可漂浮的图片。"
    section.append(empty)
    return section
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
    section.append(block)
  }
  return section
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
  return {
    id: entry.id,
    title: `动画 ${entry.id}`,
    kind: kindLabel(entry.kind, entry.model),
    icon: entry.kind === "a1" ? A1_ICONS[Number(animationBase(entry.model).t ?? 0)] ?? "blend" : FAMILY_ICONS[entry.kind] ?? "clapperboard",
    detail: detail.filter(Boolean).join(" · "),
    uses: references.styles.length + references.combos.length,
    problem: baseNeedsFix(entry.kind, entry.model) ? "分类值与动画类型不一致" : missing ? "组合里有不存在的子动画" : undefined,
  }
}

function uses(skin: JsonObject, pointer: SxiPointer, entry: AnimationEntry): AnimationUse[] {
  const references = animationReferences(skin, pointer, entry.id)
  return [
    ...references.styles.map((style) => ({ icon: "palette", title: style.name, detail: `${style.events.join("、")}时播放` })),
    ...references.combos.map((id) => ({ icon: "layers", title: `动画 ${id}`, detail: "作为组合动画的一部分播放" })),
    ...(references.contexts ?? []).map((context) => ({ icon: "layers", title: context, detail: "另一方向的组合动画" })),
  ]
}

function parameterSections(pointer: SxiPointer, entry: AnimationEntry, table: JsonObject): HTMLElement[] {
  if (entry.kind === "a3") return [comboSection(pointer, entry, table)]
  const target: SxiPointer = [...pointer, entry.id, entry.kind]
  const sections = animationGroups(entry.kind, entry.model).map((group) => {
    const section = animationSection(group.title, SECTION)
    for (const field of group.fields) {
      if (entry.kind === "a1" && field.key === "t") {
        section.append(a1TypeRow([...target, "b"], entry))
        continue
      }
      const scoped = field.scope === "base" ? [...target, "b"] : target
      section.append(...fieldRows(scoped, field, field.scope === "base" ? sxiValue(entry.model, ["b", field.key]) : entry.model[field.key]))
    }
    // Only 位移 has a percent / pixel spelling; 旋转 and 缩放 always use percent.
    if (entry.kind === "a1" && group.title === "变化" && Number(animationBase(entry.model).t) === 2) {
      section.append(a1UnitRow(target, entry))
      const note = element("p", "ui-field-note")
      note.textContent = "切换单位只保留数值，不会按画布尺寸换算。"
      section.append(note)
    }
    return section
  })
  if (entry.kind === "a12") sections.push(floatersSection(pointer, entry))
  return sections
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
  const items = entries.map((entry) => listItem(skin, pointer, entry, table))
  const selected = selectedAnimation(items)
  const entry = entries.find((candidate) => candidate.id === selected)
  const resolver = visualResolver()
  const references = entry && animationReferences(skin, pointer, entry.id)
  const family = entry && animationFamilyInfo(entry.kind)
  renderAnimationResource(container, {
    mode: appState.animationDesignMode,
    sectionClass: SECTION,
    items,
    selected,
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
        const neighbour = entries[entries.indexOf(entry) + 1] ?? entries[entries.indexOf(entry) - 1]
        delete asObject(sxiValue(current, pointer))?.[entry.id]
        if (neighbour) rememberAnimation(neighbour.id)
      }),
    },
    player: entry && {
      clip: palmPreviewClip(table, entry.id),
      key: `${SXI_SKIN_PATH}|${pointer.join(".")}|${entry.id}`,
      resolver,
      readFile: resolver instanceof PalmStyles ? (file) => resolver.bytes(file) : undefined,
    },
    warnings: entry && baseNeedsFix(entry.kind, entry.model)
      ? [animationWarning(`分类值 ${String(animationBase(entry.model).c)} 与${family?.label ?? "动画"}不一致，导出后可能无法识别。`, {
          label: "修正", disabled: !isEditing(),
          run: () => commit([...pointer, entry.id, entry.kind, "b"], ["c"], family?.category ?? 0, "修正动画分类"),
        })]
      : [],
    sections: entry ? parameterSections(pointer, entry, table) : [],
    uses: entry ? uses(skin, pointer, entry) : [],
  })
  container.dataset.path = appState.selectedPath
  return true
}

export function sxiAnimationInspectorTitle(): { name: string; context: string } | undefined {
  const pointer = animationPointer()
  if (!pointer) return
  return { name: animationModeTitle(appState.animationDesignMode), context: `${SXI_SKIN_PATH} · ${pointer.slice(1).join(".")}` }
}
