// Visual property inspector for a Palm skin's `ss_2` animation table. One section per animation: a
// timeline, the playback controls its base model owns, the family's fields in purpose groups, and
// dedicated editors for combination tracks and liquid floaters. Every edit is written into skin.json
// as one undo step through the same helpers the rest of the Palm inspector uses.

import { element } from "../dom-element.ts"
import { createIcon } from "../icons"
import { animationPlayer } from "../animation-player.ts"
import { palmPreviewClip } from "../palm/palm-preview-clip.ts"
import { PalmStyles } from "../palm/palm-styles.ts"
import { visualResolver } from "./bda-documents"
import {
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
import { editSxi, sxiSkin, sxiValue, writeSxiValue, type SxiPointer } from "./sxi-fields"
import { animationActions, animationCreateControl } from "./sxi-animation-actions"
import { sxiPointer } from "./sxi-documents"
import { appState } from "./state"

type AnimationEntry = { id: string; kind: string; model: JsonObject; wrap: JsonObject }

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
      const model = asObject(sxiValue(sxiSkin(), target))
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


/* —— a1-specific rows: type, unit and the values it changes —— */
function segmentedRow(label: string, options: Array<[value: string, text: string]>, current: string, onSelect: (value: string) => void, title?: string, identity = label, key?: string): HTMLElement {
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
  const proxy = element("select", "sxi-animation-proxy") as HTMLSelectElement
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
    const baseline = String((JSON.parse((event as CustomEvent<string>).detail) as Json[])[0])
    if (baseline !== proxy.value) onSelect(baseline)
  })
  row.append(caption, group, proxy)
  return row
}

function a1TypeRow(basePointer: SxiPointer, entry: AnimationEntry): HTMLElement {
  const field = animationGroups("a1", entry.model)
    .flatMap((group) => group.fields)
    .find((item) => item.key === "t")!
  const type = Number(animationBase(entry.model).t ?? 0)
  const patchType = (next: number) => {
    if (!Number.isFinite(next) || next === type) return
    editSxi((skin) => {
      const model = asObject(sxiValue(skin, [...basePointer.slice(0, -1)]))
      if (!model) throw new Error("skin.json 中缺少动画")
      applyPatch(model, a1TypePatch(model, next))
    })
  }
  const ends = ["from", "to", "from_p", "to_p", "from_px", "to_px"]
  const snapshot: JsonObject = { type: animationBase(entry.model).t }
  for (const key of ends) if (entry.model[key] !== undefined) snapshot[key] = entry.model[key]
  const row = selectRow(basePointer, ["t"], field, type, (next) => patchType(Number(next)), (baseline) => {
    const saved = asObject(baseline)
    if (!saved) return
    editSxi((skin) => {
      const model = asObject(sxiValue(skin, basePointer.slice(0, -1)))
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
  }, "相对按键尺寸或按像素位移", `${target.join(".")}|位移单位`, "FROM_PX TO_PX")
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

/* —— a3: combination tracks —— */
/**
 * Structural editors (the combination list, the floater list) are not single value rows, so a hidden
 * row carries their value: the shell can mark the section and 重置 can put the list back.
 */
function trackedControl(identity: unknown[], value: Json, restore: (baseline: Json) => void): HTMLElement {
  const row = element("div", "document-property-field sxi-animation-tracker")
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

function iconButton(icon: string, label: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const button = element("button", "ui-icon-button")
  button.type = "button"
  button.dataset.size = "sm"
  button.setAttribute("aria-label", label)
  button.title = label
  button.disabled = disabled || !isEditing()
  button.append(createIcon(icon, 14))
  button.addEventListener("click", onClick)
  return button
}

function comboEditor(pointer: SxiPointer, entry: AnimationEntry, table: JsonObject): HTMLElement {
  const block = element("div", "ui-subsection sxi-animation-block")
  const heading = element("h4")
  heading.textContent = "组合轨道"
  block.append(heading)
  const model = entry.model
  const children = comboAnimations(model)
  const write = (mutate: (list: number[]) => number[]) => {
    editSxi((skin) => {
      const target = asObject(sxiValue(skin, [...pointer, entry.id, "a3"]))
      if (!target) throw new Error("skin.json 中缺少组合动画")
      target.animations = mutate(comboAnimations(target))
    })
  }
  block.append(segmentedRow("组合方式", [["simultaneous", "同时"], ["sequential", "顺序"], ["random", "随机"]], comboMethod(model), (value) => {
    editSxi((skin) => {
      const target = asObject(sxiValue(skin, [...pointer, entry.id, "a3"]))
      if (!target) throw new Error("skin.json 中缺少组合动画")
      target.a_method = value
      target.method = { [value === "simultaneous" ? "simultaneous" : "sequential"]: {} }
    })
  }, "顺序播放会按列表依次衔接", `${[...pointer, entry.id, "a3"].join(".")}|组合方式`, "a_method"))
  const list = element("ol", "sxi-combo-list")
  list.setAttribute("aria-label", "子动画")
  for (const [index, id] of children.entries()) {
    const child = asObject(table[String(id)])
    const info = child && animationModel(child)
    const item = element("li", "sxi-combo-item")
    const order = element("span", "sxi-combo-order")
    order.textContent = String(index + 1)
    const name = element("span", "sxi-combo-name")
    name.textContent = info ? `动画 ${id}` : `动画 ${id}（未找到）`
    if (!info) item.dataset.missing = ""
    const detail = element("small")
    detail.textContent = info
      ? `${animationFamilyInfo(info.kind)?.label ?? info.kind} · ${timelineText(animationTimeline(info.kind, info.model, table))}`
      : "子动画不存在，请替换或移除这个引用"
    name.append(detail)
    const actions = element("span", "sxi-combo-actions")
    actions.append(
      iconButton("arrow-up", `上移动画 ${id}`, () => write((items) => swap(items, index, index - 1)), index === 0),
      iconButton("arrow-down", `下移动画 ${id}`, () => write((items) => swap(items, index, index + 1)), index === children.length - 1),
      iconButton("x", `移除动画 ${id}`, () => write((items) => items.filter((_, position) => position !== index))),
    )
    item.append(order, name, actions)
    list.append(item)
  }
  if (children.length) block.append(list)
  else {
    const empty = element("p", "inspector-group-subtitle")
    empty.textContent = "还没有子动画；顺序播放需要至少两个。"
    block.append(empty)
  }
  block.append(trackedControl([...pointer, entry.id, "a3", "animations"], children, (baseline) => {
    editSxi((skin) => {
      const target = asObject(sxiValue(skin, [...pointer, entry.id, "a3"]))
      if (!target) throw new Error("skin.json 中缺少组合动画")
      target.animations = Array.isArray(baseline) ? baseline : []
    })
  }))
  const remaining = addableComboIds(table, entry.id).filter((id) => !children.some((child) => String(child) === id))
  if (remaining.length) {
    const add = element("div", "sxi-combo-add")
    const control = element("span", "ui-input ui-select")
    const select = element("select")
    select.setAttribute("aria-label", "添加子动画")
    select.disabled = !isEditing()
    select.append(new Option("添加子动画…", ""))
    for (const id of remaining) select.append(new Option(`动画 ${id}`, id))
    select.addEventListener("change", () => {
      if (!select.value) return
      const next = Number(select.value)
      write((items) => [...items, next])
    })
    control.append(select)
    add.append(control)
    block.append(add)
  }
  return block
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
  return `${timeline.duration ?? 0} ms`
}

/* —— a12: floaters —— */
function floatersBlock(pointer: SxiPointer, entry: AnimationEntry): HTMLElement | undefined {
  const floaters = Array.isArray(entry.model.floaters) ? entry.model.floaters : []
  const block = element("div", "ui-subsection sxi-animation-block")
  const heading = element("div", "sxi-animation-block-heading")
  const title = element("h4")
  title.textContent = `浮动物体（${floaters.length}）`
  const addButton = element("button", "ui-button sxi-animation-add") as HTMLButtonElement
  addButton.type = "button"
  addButton.dataset.variant = "quiet"
  addButton.dataset.size = "sm"
  addButton.append(createIcon("plus", 14), Object.assign(element("span"), { textContent: "添加" }))
  addButton.setAttribute("aria-label", "添加浮动物体")
  addButton.disabled = !isEditing()
  heading.append(title, addButton)
  addButton.addEventListener("click", () => {
    editSxi((skin) => {
      const model = asObject(sxiValue(skin, [...pointer, entry.id, "a12"]))
      if (!model) throw new Error("skin.json 中缺少液体动画")
      model.floaters = [...Array.isArray(model.floaters) ? model.floaters : [], floaterDefaults()]
    })
  })
  block.append(heading)
  block.append(trackedControl([...pointer, entry.id, "a12", "floaters"], entry.model.floaters, (baseline) => {
    editSxi((skin) => {
      const model = asObject(sxiValue(skin, [...pointer, entry.id, "a12"]))
      if (!model) throw new Error("skin.json 中缺少液体动画")
      if (baseline === undefined) delete model.floaters
      else model.floaters = baseline
    })
  }))
  if (!floaters.length) {
    const empty = element("p", "inspector-group-subtitle")
    empty.textContent = "还没有浮动物体；添加后液体表面会出现可漂浮的图片。"
    block.append(empty)
    return block
  }
  const fields = floaterFields()
  for (const [index, value] of floaters.entries()) {
    const floater = asObject(value)
    if (!floater) continue
    const card = element("div", "sxi-animation-floater")
    const header = element("div", "sxi-animation-floater-heading")
    const name = element("h5")
    name.textContent = `物体 ${index + 1}`
    header.append(name)
    header.append(iconButton("trash-2", `删除物体 ${index + 1}`, () => {
      editSxi((skin) => {
        const model = asObject(sxiValue(skin, [...pointer, entry.id, "a12"]))
        if (!model) throw new Error("skin.json 中缺少液体动画")
        model.floaters = (Array.isArray(model.floaters) ? model.floaters : []).filter((_, position) => position !== index)
      })
    }))
    card.append(header)
    const grid = element("div", "document-property-grid")
    const target: SxiPointer = [...pointer, entry.id, "a12", "floaters", index]
    for (const field of fields) grid.append(...fieldRows(target, field, floater[field.key]))
    card.append(grid)
    block.append(card)
  }
  return block
}

/* —— section —— */
function referenceNote(skin: JsonObject, pointer: SxiPointer, entry: AnimationEntry): HTMLElement {
  const references = animationReferences(skin, pointer, entry.id)
  const sections = references.styles.map((style) => `${style.name}（${style.events.join("、")}）`)
  const combos = [...references.combos.map((id) => `动画 ${id}`), ...references.contexts ?? []]
  const note = element("p", "inspector-group-subtitle sxi-animation-references")
  note.textContent = sections.length || combos.length
    ? [sections.length ? `播放：${sections.join("、")}` : "", combos.length ? `被 ${combos.join("、")} 组合` : ""].filter(Boolean).join(" · ")
    : "还没有样式播放这个动画。"
  return note
}

function renderSection(skin: JsonObject, pointer: SxiPointer, entry: AnimationEntry, table: JsonObject): HTMLElement {
  const family = animationFamilyInfo(entry.kind)
  const section = element("section", "ui-section document-property-section sxi-animation-section")
  section.dataset.inspectorGroupLabel = `动画 ${entry.id}`
  const heading = element("h3", "document-section-heading")
  const title = element("span", "document-section-title")
  title.textContent = `动画 ${entry.id}`
  const code = element("span", "document-section-code")
  code.textContent = family?.label ?? entry.kind
  heading.append(title, code, animationActions(pointer, entry.id, skin))
  section.append(heading)
  const resolver = visualResolver()
  section.append(animationPlayer({ clip: palmPreviewClip(table, entry.id), resolver,
    readFile: resolver instanceof PalmStyles ? (file) => resolver.bytes(file) : undefined }))
  const summary = element("p", "inspector-group-subtitle sxi-animation-summary")
  summary.textContent = family?.summary ?? ""
  section.append(summary)
  section.append(referenceNote(skin, pointer, entry))
  if (baseNeedsFix(entry.kind, entry.model)) {
    const warning = element("div", "sxi-animation-warning")
    const text = element("span")
    text.textContent = `分类值 ${String(animationBase(entry.model).c)} 与动画类型不一致，导出后可能无法识别。`
    const fix = element("button", "ui-button")
    fix.type = "button"
    fix.dataset.variant = "quiet"
    fix.dataset.size = "sm"
    fix.textContent = "修正"
    fix.disabled = !isEditing()
    fix.addEventListener("click", () => commit([...pointer, entry.id, entry.kind, "b"], ["c"], family?.category ?? 0, "修正动画分类"))
    warning.append(text, fix)
    section.append(warning)
  }
  if (entry.kind === "a3") {
    section.append(comboEditor(pointer, entry, table))
    return section
  }
  const target: SxiPointer = [...pointer, entry.id, entry.kind]
  for (const group of animationGroups(entry.kind, entry.model)) {
    const block = element("div", "ui-subsection sxi-animation-block")
    const blockTitle = element("h4")
    blockTitle.textContent = group.title
    block.append(blockTitle)
    const grid = element("div", "document-property-grid")
    const scoped = group.scope === "base" ? [...target, "b"] : target
    for (const field of group.fields) {
      const value = group.scope === "base" ? sxiValue(entry.model, ["b", field.key]) : entry.model[field.key]
      const rows = group.scope === "base" && entry.kind === "a1" && field.key === "t"
        ? [a1TypeRow([...target, "b"], entry)]
        : fieldRows(scoped, field, value)
      grid.append(...rows)
    }
    block.append(grid)
    // Only 位移 has a percent / pixel spelling; 旋转 and 缩放 always use percent.
    if (entry.kind === "a1" && group.title === "时间与曲线"
      && Number(animationBase(entry.model).t) === 2 && (a1Variant(entry.model) === "point" || a1Variant(entry.model) === "pixels")) {
      block.append(a1UnitRow(target, entry))
      const unitNote = element("p", "ui-field-note")
      unitNote.textContent = "切换单位只保留数值，不会按画布尺寸换算。"
      block.append(unitNote)
    }
    section.append(block)
  }
  if (entry.kind === "a12") {
    const floaters = floatersBlock(pointer, entry)
    if (floaters) section.append(floaters)
  }
  return section
}

/* —— entry points —— */
export function populateSxiAnimationInspector(container: HTMLElement): boolean {
  const pointer = animationPointer()
  const skin = pointer && sxiSkin()
  const table = skin && pointer ? asObject(sxiValue(skin, pointer)) : undefined
  if (!pointer || !skin || !table) return false
  const create = element("div", "ui-section")
  create.append(animationCreateControl(pointer))
  container.append(create)
  const entries = animationEntries(table).filter((entry) => appState.animationDesignMode === "all"
    || (entry.kind === "a4") === (appState.animationDesignMode === "particle"))
  if (!entries.length) {
    const section = element("section", "ui-section document-property-section")
    section.dataset.inspectorGroupLabel = "动画"
    const heading = element("h3", "document-section-heading")
    const title = element("span", "document-section-title")
    title.textContent = appState.animationDesignMode === "particle" ? "粒子设计" : "动效设计"
    heading.append(title)
    const empty = element("p", "inspector-group-subtitle")
    empty.textContent = "当前分类还没有动画。从上方选择类型即可创建，再在样式的动画事件中绑定编号。"
    section.append(heading, empty)
    container.append(section)
  } else {
    container.append(...entries.map((entry) => renderSection(skin, pointer, entry, table)))
  }
  container.dataset.path = appState.selectedPath
  return true
}

export function sxiAnimationInspectorTitle(): { name: string; context: string } | undefined {
  const pointer = animationPointer()
  if (!pointer) return
  return { name: appState.animationDesignMode === "particle" ? "粒子设计" : appState.animationDesignMode === "motion" ? "动效设计" : "动画与动效", context: `${SXI_SKIN_PATH} · ${pointer.slice(1).join(".")}` }
}
