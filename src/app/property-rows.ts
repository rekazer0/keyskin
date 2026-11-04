/*
 * 检查器属性行的唯一入口（DESIGN.md §10）：field() 建一行 .ui-field（标签 + 按 spec 自动选的控件），
 * section() 建一个分组。只依赖通用 DOM，BDA 这类纯模块也能用；编辑模式和样式引用卡由应用启动时
 * bindFieldServices() 接上。每行记下渲染时的值（data-inspector-value），检查器的改动标记与重置都以它为准，
 * 重置时把那个值交回 commit。
 */
import { drawVisualPreview, type Visual } from "../atlas.ts"
import { element } from "../dom-element.ts"
import { createIcon } from "../icons.ts"
import { soundStyleSample, styleReferenceCard } from "../style-card.ts"

/** 选项：值、文字（纯图标分段时只进悬停提示与 aria-label）、可选图标。 */
type Choice = readonly [value: string, label: string, icon?: string]
type Bounds = { min: number; max: number; step?: number }
type ColorCodec = "argb" | "0xargb" | "#rgb"

/** 有自然范围的数值一张表：同一种值在所有格式里是同一个滑块范围。 */
const RANGES = {
  duration: { min: 0, max: 2000, step: 10 },
  count: { min: 0, max: 200 },
  rate: { min: 0, max: 50, step: 0.1 },
  alpha: { min: 0, max: 255 },
  angle: { min: -360, max: 360 },
  fontSize: { min: 1, max: 160 },
  border: { min: 0, max: 20 },
  weight: { min: 100, max: 900, step: 100 },
} satisfies Record<string, Bounds>

export type FieldSpec =
  /** `validate` 返回问题时就地提示（浏览器校验气泡），不写回。 */
  | { kind: "text"; value: string; placeholder?: string; suggestions?: readonly string[]; validate?(value: string): string | undefined }
  /** `expression`：允许 rand(a,b) / inf，用 text + inputmode=decimal（DESIGN.md §10）。 */
  | { kind: "number"; value: string; unit?: string; step?: number; min?: number; range?: keyof typeof RANGES; expression?: boolean }
  /** 几格并排的值（X / Y、最小 / 最大、四边）；`options` 时每格是下拉（X / Y 各自的插值器）。 */
  | { kind: "parts"; affixes: readonly string[]; values: readonly string[]; columns?: number; expression?: boolean; step?: number; unit?: string; options?: readonly Choice[] }
  | { kind: "switch"; checked: boolean }
  /** ≤4 项分段（都有图标时纯图标），grid3 是 3×3 图标格，更多项或 select 用下拉；当前值不在选项里时总是下拉。 */
  | { kind: "choice"; value: string; options: readonly Choice[]; layout?: "grid3" | "select" | "labeled"; unset?: boolean }
  | { kind: "flags"; values: readonly string[]; options: readonly Choice[]; keepOne?: string }
  | { kind: "color"; value: string; codec: ColorCodec }
  | { kind: "colorPair"; values: readonly [string, string]; codec: ColorCodec }
  /** 样式编号（逗号分隔）：bindFieldServices 的 decorateStyle 把输入框换成引用卡列表。 */
  | { kind: "style"; value: string; reference: string }
  | { kind: "image"; value: string; placeholder?: string; suggestions?: readonly string[]; load(): Promise<Visual | undefined> | undefined; pick?(): void }
  | { kind: "sound"; value: string; files: readonly string[]; sample?: HTMLElement }
  | { kind: "readonly"; value: string }

type Values = {
  text: string; number: string; choice: string; color: string; style: string; image: string; sound: string
  parts: string[]; flags: string[]; colorPair: string[]; switch: boolean; readonly: never
}
/** 多目标时的提示：改了哪一格（parts / colorPair），以及只换被改分量的合并函数（颜色）。 */
type Edit = { index?: number; merge?(current: string): string }
type Commit<S extends FieldSpec> = (value: Values[S["kind"]], edit: Edit) => void

type FieldOptions<S extends FieldSpec> = {
  key: string
  label: string
  /** 控件的无障碍名称（默认同标签），标签之外还要带上对象时用，如「候选字字号」。 */
  name?: string
  spec: S
  commit?: Commit<S>
  mixed?: boolean
  /** 跨重绘不变的行标识：改动标记按它记住第一次渲染的值。 */
  rowKey?: unknown
  /** 改动标记比较、重置交回的值；默认是 spec 的值。 */
  baseline?: unknown
  reset?(baseline: unknown): void
  /** 默认读应用的编辑模式。 */
  editable?: boolean
}

const services = { editing: () => false, decorateStyle: (_input: HTMLInputElement, _reference: string) => {} }

/** 应用启动时接上编辑模式与样式引用卡；纯模块（BDA 动画检查器）直接传 editable。 */
export function bindFieldServices(next: typeof services): void {
  Object.assign(services, next)
}

/** 标签列；`key` 是原始字段名，供筛选与悬停提示。 */
export function fieldCaption(row: HTMLElement, key: string, label: string): void {
  row.dataset.documentKey = key
  const span = element("span", "document-field-caption")
  span.title = label === key ? key : `${label}（${key}）`
  const name = element("span", "document-field-name")
  name.textContent = label
  span.append(name)
  row.append(span)
}

/** 一行属性。 */
export function field<S extends FieldSpec>(options: FieldOptions<S>): HTMLElement {
  const { spec } = options
  const control = fieldControl(spec, options.name ?? options.label, (value, edit) => options.commit?.(value as never, edit), {
    editable: (options.editable ?? services.editing()) && Boolean(options.commit), mixed: options.mixed,
  })
  // 只有一个输入控件时整行是 label；分段、卡片这类含按钮的行用 div，点标签不会误按第一个按钮。
  const single = ["text", "number", "switch"].includes(spec.kind) || spec.kind === "choice" && control.classList.contains("ui-select")
  const row = element(single ? "label" : "div", "ui-field")
  fieldCaption(row, options.key, options.label)
  row.append(control)
  if (spec.kind === "style" || spec.kind === "image") {
    row.classList.add("style-reference-field")
    if (spec.kind === "style") services.decorateStyle(control as HTMLInputElement, spec.reference)
  }
  if (options.rowKey !== undefined) row.dataset.inspectorRowKey = JSON.stringify(options.rowKey)
  if (options.commit && spec.kind !== "readonly") {
    row.dataset.inspectorValue = JSON.stringify(["baseline" in options ? options.baseline : specValue(spec)])
    row.addEventListener("inspector-reset", (event) => {
      event.preventDefault()
      const [baseline] = JSON.parse((event as CustomEvent<string>).detail) as unknown[]
      if (options.reset) options.reset(baseline)
      else options.commit!(baseline as never, {})
    })
  }
  return row
}

function specValue(spec: FieldSpec): unknown {
  switch (spec.kind) {
    case "switch": return spec.checked
    case "parts": case "flags": case "colorPair": return spec.values
    default: return spec.value
  }
}

/** 分组：标题、可选的只读计数（派生的 ANIM_NUM、BUILD_NUM 等）与标题行尾的操作。`code` 只给筛选与测试看。 */
export function section(title: string, rows: HTMLElement[] = [], options: { className?: string; count?: string; code?: string; actions?: HTMLElement[] } = {}): HTMLElement {
  const node = element("section", `ui-section ${options.className ?? "document-property-section"}`)
  node.dataset.inspectorGroupLabel = title
  const heading = element("h3", "document-section-heading")
  const name = element("span", "document-section-title")
  name.textContent = title
  heading.append(name)
  if (options.code) heading.append(Object.assign(element("span", "document-section-code"), { textContent: options.code }))
  if (options.count !== undefined) {
    const count = element("span", "ui-badge")
    count.dataset.variant = "pill"
    count.textContent = options.count
    heading.append(count)
  }
  heading.append(...options.actions ?? [])
  node.append(heading, ...rows)
  return node
}

/** 不带行的控件本身：给仍自己拼行的旧检查器用（configValueControl、numberParts）。 */
export function fieldControl<S extends FieldSpec>(spec: S, label: string, commit: Commit<S>, state: { editable: boolean; mixed?: boolean }): HTMLElement {
  const send = commit as (value: unknown, edit: Edit) => void
  const disabled = !state.editable
  const placeholder = state.mixed ? "混合" : "未设置"
  switch (spec.kind) {
    case "text": {
      const box = element("span", "ui-input")
      const input = textInput(spec.value, label, placeholder, disabled)
      if (spec.placeholder && !state.mixed) input.placeholder = spec.placeholder
      input.addEventListener("change", () => {
        const problem = input.value.trim() ? spec.validate?.(input.value.trim()) : undefined
        if (spec.validate) input.setCustomValidity(problem ?? "")
        if (problem) input.reportValidity()
        else send(input.value.trim(), {})
      })
      if (spec.validate) input.addEventListener("input", () => input.setCustomValidity(""))
      box.append(input)
      if (spec.suggestions?.length) box.append(suggestions(input, spec.suggestions))
      return box
    }
    case "number": return numberControl(spec, label, placeholder, disabled, (value) => send(value, {}))
    case "parts": return partsControl(spec, label, placeholder, disabled, (values, index) => send(values, { index }))
    case "switch": {
      const input = element("input", "ui-switch")
      input.type = "checkbox"
      input.setAttribute("role", "switch")
      input.setAttribute("aria-label", label)
      input.checked = spec.checked
      input.disabled = disabled
      input.addEventListener("change", () => send(input.checked, {}))
      return input
    }
    case "choice": return choiceControl(spec, label, disabled, (value) => send(value, {}))
    case "flags": return flagsControl(spec, label, disabled, (values) => send(values, {}))
    case "color": return colorControl(spec.value, spec.codec, label, disabled, Boolean(state.mixed), (value, merge) => send(value, { merge }))
    case "colorPair": {
      const pair = element("span", "ui-field-pair")
      spec.values.forEach((value, index) => pair.append(colorControl(value, spec.codec, `${label}${index ? "按下" : "正常"}`, disabled, Boolean(state.mixed) && !value, (next, merge) => {
        const values = [...spec.values]
        values[index] = next
        send(values, { index, merge })
      })))
      return pair
    }
    case "style": {
      const input = element("input")
      input.value = spec.value
      input.disabled = disabled
      input.setAttribute("aria-label", label)
      input.addEventListener("change", () => send(input.value.trim(), {}))
      return input
    }
    case "image": return imageControl(spec, label, disabled, (value) => send(value, {}))
    case "sound": {
      const wrap = element("span", "ui-sound-field")
      const files = spec.files.includes(spec.value) || !spec.value ? spec.files : [spec.value, ...spec.files]
      const select = choiceControl({ kind: "choice", value: spec.value, options: files.map((file) => [file, file]), layout: "select", unset: true }, label, disabled, (value) => send(value, {}))
      wrap.append(spec.sample ?? soundStyleSample(spec.value || undefined), select)
      return wrap
    }
    case "readonly": {
      const output = element("span", "ui-field-value")
      output.textContent = spec.value
      output.title = spec.value
      return output
    }
  }
}

function textInput(value: string, label: string, placeholder: string, disabled: boolean): HTMLInputElement {
  const input = element("input")
  input.type = "text"
  input.value = value
  input.placeholder = placeholder
  input.disabled = disabled
  input.setAttribute("aria-label", label)
  return input
}

let suggestionID = 0
function suggestions(input: HTMLInputElement, values: readonly string[]): HTMLDataListElement {
  const list = element("datalist")
  list.id = `field-suggestions-${++suggestionID}`
  list.append(...values.map((value) => new Option(value)))
  input.setAttribute("list", list.id)
  return list
}

/* —— 数值 —— */
const NUMBER = /^-?\d+(?:\.\d+)?$/
const EXPRESSION = /^(?:-?\d+(?:\.\d+)?|rand\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)|inf)$/i
const validNumber = (text: string, expression?: boolean) => !text || (expression ? EXPRESSION : NUMBER).test(text)

function numberInput(value: string, label: string, placeholder: string, disabled: boolean, expression?: boolean, step?: number, min?: number): HTMLInputElement {
  const input = textInput(value, label, placeholder, disabled)
  // 数值之外的写法（rand()、inf）放不进 number 输入框，一编辑就会丢。
  if (expression || value && !NUMBER.test(value)) input.inputMode = "decimal"
  else {
    input.type = "number"
    input.step = step === undefined ? "any" : String(step)
    if (min !== undefined) input.min = String(min)
  }
  return input
}

function numberControl(spec: Extract<FieldSpec, { kind: "number" }>, label: string, placeholder: string, disabled: boolean, commit: (value: string) => void): HTMLElement {
  const box = element("span", "ui-input")
  const input = numberInput(spec.value, label, placeholder, disabled, spec.expression, spec.step, spec.min)
  input.addEventListener("change", () => {
    const text = input.value.trim()
    if (validNumber(text, spec.expression)) commit(text)
    else input.value = spec.value
  })
  box.append(input)
  if (spec.unit) box.append(Object.assign(element("span", "ui-input-affix"), { textContent: spec.unit }))
  const range = spec.range && RANGES[spec.range]
  return range && input.type === "number" ? sliderField(box, input, range) : box
}

function partsControl(spec: Extract<FieldSpec, { kind: "parts" }>, label: string, placeholder: string, disabled: boolean, commit: (values: string[], index: number) => void): HTMLElement {
  const pair = element("span", "ui-field-pair")
  if (spec.columns) pair.dataset.columns = String(spec.columns)
  const inputs = spec.affixes.map((affix, index): HTMLInputElement | HTMLSelectElement => {
    const value = spec.values[index] ?? ""
    const box = element("span", spec.options ? "ui-input ui-select" : "ui-input")
    box.append(Object.assign(element("span", "ui-input-affix"), { textContent: affix }))
    let input: HTMLInputElement | HTMLSelectElement
    if (spec.options) {
      input = element("select")
      if (!spec.options.some(([option]) => option === value)) input.append(new Option(value ? `${value}（自定义值）` : "未设置", value))
      input.append(...spec.options.map(([option, text]) => new Option(text, option)))
      input.value = value
      input.disabled = disabled
      input.setAttribute("aria-label", `${label}${affix}`)
    } else input = numberInput(value, `${label}${affix}`, placeholder, disabled, spec.expression, spec.step)
    box.append(input)
    if (spec.unit) box.append(Object.assign(element("span", "ui-input-affix"), { textContent: spec.unit }))
    pair.append(box)
    input.addEventListener("change", () => {
      const values = inputs.map((field) => field.value.trim())
      if (spec.options || values.every((text) => validNumber(text, spec.expression))) commit(values, index)
      else inputs.forEach((field, position) => { field.value = spec.values[position] ?? "" })
    })
    return input
  })
  return pair
}

/** 数值框旁的滑块（有自然范围的值）：拖动只改数值框，松开提交一次。 */
function sliderField(control: HTMLElement, input: HTMLInputElement, bounds: Bounds): HTMLElement {
  const wrap = element("span", "ui-slider-field")
  const range = element("input", "ui-slider")
  range.type = "range"
  range.min = String(bounds.min)
  range.step = String(bounds.step ?? 1)
  const numeric = () => input.value.trim() !== "" && Number.isFinite(Number(input.value))
  const sync = () => {
    const value = Number(input.value)
    range.max = String(Math.max(bounds.max, Number.isFinite(value) ? value : bounds.min))
    range.value = String(Number.isFinite(value) && input.value.trim() ? value : bounds.min)
    range.disabled = input.disabled || !numeric()
  }
  sync()
  let before: string | undefined
  range.addEventListener("input", () => {
    before ??= input.value
    input.value = range.value
  })
  const finish = () => {
    if (before === undefined) return
    const original = before
    before = undefined
    if (input.value !== original) input.dispatchEvent(new Event("change", { bubbles: true }))
  }
  range.addEventListener("change", finish)
  range.addEventListener("pointerup", finish)
  range.addEventListener("pointercancel", finish)
  range.addEventListener("keydown", (event) => { if (event.key === "Escape" && before !== undefined) { input.value = before; before = undefined } })
  input.addEventListener("input", sync)
  wrap.append(range, control)
  return wrap
}

/** 仍自己拼行的检查器（搜狗、手心）用的一排带前缀的数值框；`onChange` 拿到全部格子的值。 */
export function numberParts(row: HTMLElement, label: string, affixes: string[], values: string[], onChange: (values: string[], index: number) => void, columns?: number): void {
  row.append(partsControl({ kind: "parts", affixes, values, columns, step: values.some((value) => value.includes(".")) ? undefined : 1 }, label, "未设置", !services.editing(), (next, index) => {
    if (next[index] !== "") onChange(next, index)
  }))
}

/* —— 选项 —— */
function choiceControl(spec: Extract<FieldSpec, { kind: "choice" }>, label: string, disabled: boolean, commit: (value: string) => void): HTMLElement {
  const known = spec.options.some(([value]) => value === spec.value)
  const icons = spec.options.every(([, , icon]) => icon)
  const labeled = icons && spec.layout === "labeled"
  if (spec.layout !== "select" && (known || !spec.value) && (spec.layout === "grid3" || spec.options.length <= 4)) {
    const group = element("span", "ui-segmented")
    group.setAttribute("role", "group")
    group.setAttribute("aria-label", label)
    if (labeled) group.dataset.fill = ""
    else if (icons) group.dataset.variant = "icon"
    if (spec.layout === "grid3") group.dataset.layout = "grid3"
    for (const [value, text, icon] of spec.options) {
      const button = element("button")
      button.type = "button"
      button.disabled = disabled
      button.setAttribute("aria-pressed", String(value === spec.value))
      button.setAttribute("aria-label", text)
      if (labeled) button.append(createIcon(icon!, 14), text)
      else if (icons) {
        button.title = text
        button.append(createIcon(icon!, 14))
      } else button.textContent = text
      // 取消默认动作：所在行若是 <label>，提交后控件重建，标签会把这次点击再转给第一个按钮。
      button.addEventListener("click", (event) => { event.preventDefault(); if (value !== spec.value) commit(value) })
      group.append(button)
    }
    return group
  }
  const box = element("span", "ui-input ui-select")
  const select = element("select")
  select.disabled = disabled
  select.setAttribute("aria-label", label)
  if (!spec.value && (spec.unset || !known)) select.append(new Option("未设置", ""))
  else if (!known) select.append(new Option(`${spec.value}（自定义值）`, spec.value))
  select.append(...spec.options.map(([value, text]) => new Option(text, value)))
  select.value = spec.value
  select.addEventListener("change", () => commit(select.value))
  box.append(select)
  return box
}

/** 可组合的功能标识：每项一个 aria-pressed 按钮，`keepOne` 时最后一项不能取消（提示写在 title 里）。 */
function flagsControl(spec: Extract<FieldSpec, { kind: "flags" }>, label: string, disabled: boolean, commit: (values: string[]) => void): HTMLElement {
  const group = element("span", "ui-segmented")
  group.dataset.multiple = ""
  group.setAttribute("role", "group")
  group.setAttribute("aria-label", label)
  const options = [...spec.options, ...spec.values.filter((value) => !spec.options.some(([option]) => option === value)).map((value): Choice => [value, `${value}（扩展）`])]
  for (const [value, text] of options) {
    const on = spec.values.includes(value)
    const button = element("button")
    button.type = "button"
    button.textContent = text
    button.setAttribute("aria-label", text)
    button.setAttribute("aria-pressed", String(on))
    button.title = `${label}：${value}`
    button.disabled = disabled || Boolean(spec.keepOne) && on && spec.values.length === 1
    if (button.disabled && !disabled) button.title = spec.keepOne!
    button.addEventListener("click", (event) => {
      event.preventDefault()
      commit(on ? spec.values.filter((item) => item !== value) : [...spec.values, value])
    })
    group.append(button)
  }
  return group
}

/* —— 颜色：色块 + 不透明度 %，点色块弹出取色与色值 —— */
type Rgba = { rgb: string; alpha: number }

/** 存储写法（codec）：BDS / 手心 / BDA 是 AARRGGBB，搜狗是 0xAARRGGBB，手心动画是 #RRGGBB；读时都接受 6 / 8 位与 # / 0x 前缀。 */
function decodeColor(value: string): Rgba | undefined {
  const hex = value.trim().replace(/^(?:0x|#)/i, "")
  if (!/^[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(hex)) return
  const argb = (hex.length === 6 ? `FF${hex}` : hex).toUpperCase()
  return { rgb: argb.slice(2), alpha: Number.parseInt(argb.slice(0, 2), 16) }
}

function encodeColor(codec: ColorCodec, { rgb, alpha }: Rgba): string {
  if (codec === "#rgb") return `#${rgb}`
  const argb = `${alpha.toString(16).padStart(2, "0").toUpperCase()}${rgb}`
  return codec === "0xargb" ? `0x${argb}` : argb
}

let openPopover: { close(): void } | undefined

function colorControl(value: string, codec: ColorCodec, label: string, disabled: boolean, mixed: boolean, commit: (value: string, merge: (current: string) => string) => void): HTMLElement {
  const current = mixed ? undefined : decodeColor(value)
  const root = element("span", "ui-color-field")
  const swatch = element("button", "ui-swatch ui-checker")
  swatch.type = "button"
  swatch.disabled = disabled
  swatch.setAttribute("aria-label", label)
  swatch.setAttribute("aria-haspopup", "dialog")
  swatch.setAttribute("aria-expanded", "false")
  swatch.title = mixed ? "混合" : value || "未设置"
  const fill = element("canvas")
  fill.width = fill.height = 1
  fill.setAttribute("aria-hidden", "true")
  if (current) {
    const context = fill.getContext("2d")
    if (context) {
      context.fillStyle = `#${current.rgb}${current.alpha.toString(16).padStart(2, "0")}`
      context.fillRect(0, 0, 1, 1)
    }
  }
  swatch.append(fill)
  root.append(swatch)
  // 只改被改的分量：色相变时保留原透明度的精确字节，多目标时各自保留另一半。
  const write = (part: Partial<Rgba>) => {
    const merge = (other: string) => encodeColor(codec, { rgb: "000000", alpha: 255, ...decodeColor(other), ...part })
    commit(merge(mixed ? "" : value), merge)
  }
  if (codec !== "#rgb") {
    const box = element("span", "ui-input")
    const alpha = element("input")
    alpha.type = "number"
    alpha.min = "0"
    alpha.max = "100"
    alpha.step = "1"
    alpha.value = current ? String(Math.round(current.alpha / 2.55)) : ""
    alpha.placeholder = mixed ? "混合" : "100"
    alpha.disabled = disabled
    alpha.setAttribute("aria-label", `${label}不透明度`)
    alpha.addEventListener("change", () => {
      const percent = Number(alpha.value)
      if (alpha.value === "" || !(percent >= 0 && percent <= 100)) alpha.value = current ? String(Math.round(current.alpha / 2.55)) : ""
      else write({ alpha: Math.round(percent * 255 / 100) })
    })
    box.append(alpha, Object.assign(element("span", "ui-input-affix"), { textContent: "%" }))
    root.append(box)
  }
  const popover = element("div", "ui-menu ui-color-popover")
  popover.hidden = true
  popover.setAttribute("role", "dialog")
  popover.setAttribute("aria-label", label)
  const picker = element("input")
  picker.type = "color"
  picker.value = `#${current?.rgb ?? "000000"}`
  picker.setAttribute("aria-label", `${label}取色`)
  picker.addEventListener("change", () => write({ rgb: picker.value.slice(1).toUpperCase() }))
  const hex = element("span", "ui-input")
  const text = textInput(value, `${label}色值`, mixed ? "混合" : "未设置", false)
  text.spellcheck = false
  text.addEventListener("change", () => {
    const entered = text.value.trim()
    const parsed = decodeColor(entered)
    if (!entered) commit("", () => "")
    else if (parsed) commit(encodeColor(codec, parsed), () => encodeColor(codec, parsed))
    else text.value = value
  })
  hex.append(text)
  popover.append(picker, hex)
  root.append(popover)
  const outside = (event: PointerEvent) => { if (!root.contains(event.target as Node)) close() }
  const close = () => {
    popover.hidden = true
    swatch.setAttribute("aria-expanded", "false")
    document.removeEventListener("pointerdown", outside, true)
    if (openPopover?.close === close) openPopover = undefined
  }
  swatch.addEventListener("click", (event) => {
    event.preventDefault()
    if (!popover.hidden) return close()
    openPopover?.close()
    openPopover = { close }
    popover.hidden = false
    swatch.setAttribute("aria-expanded", "true")
    document.addEventListener("pointerdown", outside, true)
    text.focus()
  })
  popover.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return
    event.stopPropagation()
    close()
    swatch.focus()
  })
  return root
}

/* —— 图片：左侧可编辑的名称，右侧图片，点图片选择（DESIGN.md §10） —— */
function imageControl(spec: Extract<FieldSpec, { kind: "image" }>, label: string, disabled: boolean, commit: (value: string) => void): HTMLElement {
  const name = element("input", "ui-style-ref-name")
  name.value = spec.value
  name.placeholder = spec.placeholder ?? "未设置"
  name.disabled = disabled
  name.spellcheck = false
  name.setAttribute("aria-label", label)
  name.addEventListener("change", () => commit(name.value.trim()))
  const visual = spec.load()?.catch(() => undefined)
  const card = styleReferenceCard({
    name,
    states: [{
      label: spec.pick ? `选择${label}` : label,
      draw: async (canvas) => { const loaded = await visual; if (loaded) drawVisualPreview(canvas, [loaded], false) },
      onClick: spec.pick && !disabled ? () => spec.pick!() : undefined,
    }],
    disabled,
  })
  if (spec.suggestions?.length) card.append(suggestions(name, spec.suggestions))
  return card
}
