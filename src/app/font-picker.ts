import { canvasFontFamily, retinaThumbnail, type EmbeddedFont } from "../atlas.ts"
import { bindListboxKeys, element, emptyState, searchField } from "../dom-element.ts"
import { releaseOnRemove } from "../dom-lifecycle.ts"
import { bindDialog } from "./ask.ts"
import { createIcon } from "../icons.ts"

export const SYSTEM_FONTS = [
  { value: "", label: "系统默认" }, { value: "sans-serif", label: "无衬线" }, { value: "serif", label: "衬线" }, { value: "monospace", label: "等宽" },
]

export type FontChoice = { value: string; label: string; detail?: string; family?: string; load?: (preview?: AbortSignal) => EmbeddedFont | undefined; missing?: boolean }

export async function resolveFontChoice(choice: FontChoice, preview?: AbortSignal): Promise<{ family?: string; loaded: boolean }> {
  if (choice.missing) return { loaded: false }
  if (!choice.load) return { family: choice.family, loaded: true }
  const font = choice.load(preview)
  return font && await font.ready ? { family: font.family, loaded: true } : { loaded: false }
}

/** 可手输名称，也可点字形预览选择；两种操作共用同一个字段。 */
export function fontControl(spec: { value: string; choices: FontChoice[]; placeholder?: string }, label: string, commit: (value: string) => void, state: { editable: boolean; mixed?: boolean }): HTMLElement {
  const wrap = element("span", "ui-input ui-font-control")
  const input = element("input")
  input.value = spec.value
  input.placeholder = state.mixed ? "混合" : spec.placeholder ?? "系统默认"
  input.setAttribute("aria-label", label)
  input.disabled = !state.editable
  input.addEventListener("change", () => commit(input.value.trim()))
  const button = element("button", "ui-button ui-font-picker")
  button.type = "button"
  button.setAttribute("aria-label", `选择${label}`)
  button.setAttribute("aria-haspopup", "dialog")
  button.disabled = !state.editable
  const choice = spec.choices.find(choice => choice.value === spec.value) ?? { value: spec.value, label: spec.value, family: spec.value, missing: /\.(?:ttf|otf|ttc)$/i.test(spec.value) }
  button.append(fontSample(state.mixed ? { value: "", label: "混合" } : choice, state.mixed ? "混合" : "Aa"), createIcon("chevron-down", 14))
  button.title = choice.detail ?? choice.label
  button.addEventListener("click", () => {
    const choices = [...spec.choices]
    if (spec.value && !choices.some(choice => choice.value === spec.value)) choices.push(choice)
    openFontPicker(`选择${label}`, choices, state.mixed ? undefined : spec.value, value => {
      if (wrap.isConnected && state.editable) commit(value)
    })
  })
  wrap.append(input, button)
  return wrap
}

/** 字形直接用预览画布已加载的字体，避免把皮肤字体应用到编辑器界面。 */
async function drawFontSample(canvas: HTMLCanvasElement, choice: FontChoice, resolved: ReturnType<typeof resolveFontChoice>, sample = "键设 Aa 123"): Promise<void> {
  canvas.setAttribute("aria-busy", "true")
  const { family, loaded } = await resolved
  if (!canvas.isConnected || !canvas.clientWidth || !canvas.clientHeight) return
  const context = retinaThumbnail(canvas, canvas.clientWidth, canvas.clientHeight).getContext("2d")
  if (!context) return
  const style = getComputedStyle(canvas)
  const text = loaded ? sample : "无法预览"
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = style.getPropertyValue(loaded ? "--text" : "--tertiary").trim()
  const size = Number.parseFloat(style.getPropertyValue("--font-size-xl")) * canvas.height / (canvas.clientHeight || 48)
  context.font = `${size}px ${canvasFontFamily(family)}`
  const fit = Math.min(1, canvas.width * 0.9 / Math.max(1, context.measureText(text).width))
  context.font = `${size * fit}px ${canvasFontFamily(family)}`
  context.textAlign = "center"
  context.textBaseline = "middle"
  context.fillText(text, canvas.width / 2, canvas.height / 2)
  canvas.dataset.fontFamily = loaded ? family ?? "system-ui" : ""
  canvas.setAttribute("aria-label", `${choice.label}：${text}`)
  canvas.setAttribute("aria-busy", "false")
}

export function fontSample(choice: FontChoice, sample?: string, transient = false): HTMLCanvasElement {
  const canvas = element("canvas", "ui-font-sample")
  canvas.width = canvas.height = 0
  canvas.setAttribute("role", "img")
  const lifetime = transient ? new AbortController() : undefined
  let font: ReturnType<typeof resolveFontChoice> | undefined
  const resize = new ResizeObserver(() => {
    if (!canvas.isConnected || !canvas.clientWidth || !canvas.clientHeight) return
    font ??= resolveFontChoice(choice, lifetime?.signal)
    void drawFontSample(canvas, choice, font, sample)
  })
  resize.observe(canvas)
  releaseOnRemove(canvas, () => { lifetime?.abort(); resize.disconnect(); canvas.width = canvas.height = 0 })
  return canvas
}

const visibleSamples = new WeakMap<Element, () => HTMLCanvasElement>()
let fontSampleObserver: IntersectionObserver | undefined
function sampleObserver(): IntersectionObserver {
  fontSampleObserver ??= new IntersectionObserver(entries => {
    for (const { target, isIntersecting } of entries) {
      if (!target.isConnected) continue
      const create = visibleSamples.get(target)
      if (isIntersecting && create && !target.firstChild) target.append(create())
      else if (!isIntersecting) target.replaceChildren()
    }
  })
  return fontSampleObserver
}

/** 只保留可见行的画布；占位与样本同高，滚动时列表不跳动。 */
export function lazyFontSample(choice: FontChoice): HTMLElement {
  const slot = element("span", "ui-font-sample")
  visibleSamples.set(slot, () => fontSample(choice, undefined, true))
  sampleObserver().observe(slot)
  releaseOnRemove(slot, () => fontSampleObserver?.unobserve(slot))
  return slot
}

/** 单击选中、确认后写回；取消、搜索和方向键浏览不会修改文档。 */
function openFontPicker(title: string, choices: FontChoice[], current: string | undefined, commit: (value: string) => void): void {
  const dialog = element("dialog", "ui-dialog")
  dialog.dataset.size = "sm"
  dialog.setAttribute("aria-label", title)
  const form = element("form")
  form.method = "dialog"
  const header = element("header", "ui-dialog-header")
  header.append(Object.assign(element("h2"), { textContent: title }))
  const body = element("div", "ui-dialog-body")
  body.dataset.layout = "stack"
  const list = element("div", "ui-listbox")
  list.dataset.variant = "font"
  list.setAttribute("role", "listbox")
  list.setAttribute("aria-label", title)
  let selected = current
  const apply = Object.assign(element("button", "ui-button"), { textContent: "应用", value: "apply" })
  apply.dataset.variant = "primary"
  const choose = (row: HTMLElement) => {
    selected = row.dataset.fontValue!
    for (const option of list.querySelectorAll<HTMLElement>('[role="option"]')) {
      option.setAttribute("aria-selected", String(option === row))
      option.tabIndex = option === row ? 0 : -1
    }
    apply.disabled = false
    row.focus()
  }
  const render = (query = "") => {
    const visible = choices.filter(choice => `${choice.label} ${choice.detail ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()))
    const selectedVisible = visible.some(choice => choice.value === selected)
    list.replaceChildren(...visible.map((choice, index) => {
      const row = element("button", "ui-list-item ui-font-option")
      row.type = "button"
      row.dataset.fontValue = choice.value
      row.setAttribute("role", "option")
      row.setAttribute("aria-selected", String(choice.value === selected))
      row.tabIndex = choice.value === selected || index === 0 && !selectedVisible ? 0 : -1
      row.title = choice.detail ?? choice.label
      const name = Object.assign(element("strong"), { textContent: choice.label })
      row.append(lazyFontSample(choice), name)
      if (choice.detail) row.append(Object.assign(element("small"), { textContent: choice.detail }))
      row.addEventListener("click", () => choose(row))
      row.addEventListener("dblclick", () => apply.click())
      row.addEventListener("keydown", event => {
        if (event.key === "Enter") { event.preventDefault(); choose(row); apply.click() }
      })
      return row
    }))
    if (!visible.length) list.append(emptyState("search-x"))
    apply.disabled = !selectedVisible
  }
  const search = searchField({ label: "搜索字体", onInput: render })
  bindListboxKeys(list, choose)
  const footer = element("footer", "ui-dialog-footer")
  const cancel = Object.assign(element("button", "ui-button"), { textContent: "取消", value: "cancel" })
  footer.append(cancel, apply)
  body.append(search, list)
  form.append(header, body, footer)
  dialog.append(form)
  bindDialog(dialog)
  dialog.addEventListener("close", () => {
    if (dialog.returnValue === "apply" && selected !== undefined && choices.some(choice => choice.value === selected)) commit(selected)
    dialog.remove()
  }, { once: true })
  document.body.append(dialog)
  dialog.showModal()
  render()
  cancel.focus()
}
