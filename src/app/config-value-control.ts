import { element } from "../dom-element.ts"
import { baiduConfigControl, baiduConfigTokens } from "../baidu-config-controls.ts"

/** 输入框保留原始值，供现有历史记录、改动标记和重置流程使用。 */
export function configValueControl(input: HTMLInputElement, section: string, key: string, label: string): HTMLElement | undefined {
  const spec = baiduConfigControl(section, key)
  if (!spec) return
  const value = input.value.trim()
  const commit = (value: string) => {
    input.value = value
    input.dispatchEvent(new Event("change", { bubbles: true }))
  }
  const control = element("span")
  const sync: Array<() => void> = []
  if (spec.kind === "switch" && (!value || [spec.on, spec.off].includes(value))) {
    control.className = "document-switch-control"
    const toggle = element("input", "ui-switch")
    toggle.type = "checkbox"
    toggle.setAttribute("role", "switch")
    toggle.setAttribute("aria-label", label)
    toggle.disabled = input.disabled
    sync.push(() => { toggle.checked = (input.value.trim() || spec.defaultValue) === spec.on })
    toggle.addEventListener("change", (event) => { event.stopPropagation(); commit(toggle.checked ? spec.on : spec.off) })
    control.append(toggle)
  } else if (spec.kind === "multiple") {
    control.className = "ui-segmented"
    control.dataset.multiple = ""
    control.setAttribute("role", "group")
    control.setAttribute("aria-label", label)
    const tokens = () => baiduConfigTokens(input.value, spec.separator, spec.defaultValue)
    const options = [...spec.options]
    for (const token of tokens()) if (!options.some(([value]) => value === token)) options.push([token, `${token}（扩展）`])
    for (const [value, text] of options) {
      const button = element("button")
      button.type = "button"
      button.textContent = text
      button.setAttribute("aria-label", text)
      button.title = `${label}：${value}`
      sync.push(() => {
        const current = tokens()
        button.setAttribute("aria-pressed", String(current.includes(value)))
        button.disabled = input.disabled || Boolean(spec.defaultValue) && current.length === 1 && current.includes(value)
        if (button.disabled && !input.disabled) button.title = `${label}至少保留一项；空值表示默认全部支持`
      })
      button.addEventListener("click", () => {
        const current = tokens()
        commit((current.includes(value) ? current.filter((token) => token !== value) : [...current, value]).join(spec.separator))
      })
      control.append(button)
    }
  } else {
    const options = spec.kind === "choice" ? spec.options : [[spec.off, "关闭"], [spec.on, "开启"]] as const
    if (spec.kind === "choice" && spec.segmented && options.some(([option]) => option === value)) {
      control.className = "ui-segmented"
      control.setAttribute("role", "group")
      control.setAttribute("aria-label", label)
      for (const [value, text] of options) {
        const button = element("button")
        button.type = "button"
        button.textContent = text
        button.setAttribute("aria-label", text)
        button.disabled = input.disabled
        sync.push(() => button.setAttribute("aria-pressed", String(input.value.trim() === value)))
        button.addEventListener("click", () => commit(value))
        control.append(button)
      }
    } else {
      control.className = "ui-input ui-select"
      const select = element("select")
      select.disabled = input.disabled
      select.setAttribute("aria-label", label)
      if (!options.some(([option]) => option === value)) select.append(new Option(value ? `${value}（自定义值）` : "未设置（默认）", input.value))
      select.append(...options.map(([value, text]) => new Option(text, value)))
      sync.push(() => { select.value = input.value })
      select.addEventListener("change", (event) => { event.stopPropagation(); commit(select.value) })
      control.append(select)
    }
  }
  for (const derived of control.querySelectorAll("input, select")) derived.setAttribute("data-config-derived", "")
  input.type = "hidden"
  control.append(input)
  const update = () => sync.forEach((run) => run())
  input.onchange = update
  update()
  return control
}

/** 固定的皮肤信息字段复用动态检查器的组件，不改变原有提交入口。 */
export function syncSkinConfigControl(input: HTMLInputElement): void {
  const previous = input.closest<HTMLElement>("[data-config-control]")
  if (previous) { previous.before(input); previous.remove() }
  input.type = "text"
  const key = input.dataset.skinField ?? ""
  const label = input.parentElement?.querySelector("span")?.textContent?.trim() ?? key
  const row = input.parentElement
  const control = configValueControl(input, "", key, label)
  if (control) {
    control.dataset.configControl = ""
    row?.append(control)
  } else if (key === "VersionCode" && /^\d+$/.test(input.value)) {
    input.type = "number"
    input.min = "0"
    input.step = "1"
  }
}
