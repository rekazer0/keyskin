import { element } from "../dom-element.ts"
import { baiduConfigControl, baiduConfigSumParts, baiduConfigTokens } from "../baidu-config-controls.ts"
import { fieldCaption, fieldControl, type FieldSpec } from "./property-rows"

type Config = NonNullable<ReturnType<typeof baiduConfigControl>>

/** The field() spec for a Baidu value; undefined keeps the raw text box (a value the control cannot show). */
function configSpec(config: Config, value: string, label: string): FieldSpec | undefined {
  switch (config.kind) {
    case "switch":
      return !value || [config.on, config.off].includes(value) ? { kind: "switch", checked: (value || config.defaultValue) === config.on } : undefined
    case "multiple":
      return { kind: "flags", values: baiduConfigTokens(value, config.separator, config.defaultValue), options: config.options,
        keepOne: config.defaultValue ? `${label}至少保留一项；空值表示默认全部支持` : undefined }
    case "choice": return { kind: "choice", value, options: config.options, layout: config.layout }
    case "color": return { kind: "color", value, codec: "argb" }
    case "sum": return undefined
  }
}

function encode(config: Config, value: string | string[] | boolean): string {
  if (typeof value === "boolean") return config.kind === "switch" ? value ? config.on : config.off : String(value)
  return Array.isArray(value) ? value.join(config.kind === "multiple" ? config.separator : ",") : value
}

/**
 * 百度配置值的类型化控件（开关、分段、九宫格、颜色……，见 baidu-config-controls.ts）。原输入框隐藏保留原始值，
 * 仍是历史记录、改动标记和重置的入口；它的值变了（含重置）就按新值重建控件。
 */
export function configValueControl(input: HTMLInputElement, section: string, key: string, label: string): HTMLElement | undefined {
  const config = baiduConfigControl(section, key, input.value)
  const sum = config?.kind === "sum" ? config : undefined
  const build = (): HTMLElement | undefined => {
    const value = input.value.trim()
    const editable = { editable: !input.disabled }
    if (!sum) {
      const spec = config && configSpec(config, value, label)
      return spec && fieldControl(spec, label, (next) => commit(encode(config!, next as string | string[] | boolean)), editable)
    }
    const parts = baiduConfigSumParts(sum, value)
    if (!parts) return
    const pair = element("span", "ui-field-pair")
    sum.parts.forEach((part, index) => pair.append(fieldControl({ kind: "choice", value: parts[index], options: part.options }, `${label}${part.label}`, (next) => {
      const values = parts.map((current, position) => Number(position === index ? next : current || sum.parts[position].options[0][0]))
      commit(String(values.reduce((total, item) => total + item, 0)))
    }, editable)))
    return pair
  }
  const commit = (value: string) => {
    input.value = value
    input.dispatchEvent(new Event("change", { bubbles: true }))
  }
  if (!build()) return
  const wrap = element("span", "config-value-control")
  const render = () => {
    const control = build()
    if (!control) return
    // 重建会换掉被点的那个按钮：把焦点交给新控件里同名的那一个。
    const focused = wrap.contains(document.activeElement) ? document.activeElement?.getAttribute("aria-label") : undefined
    for (const derived of control.querySelectorAll("input, select")) derived.setAttribute("data-config-derived", "")
    wrap.replaceChildren(control, input)
    if (focused) control.querySelector<HTMLElement>(`[aria-label="${CSS.escape(focused)}"]`)?.focus()
  }
  input.type = "hidden"
  // 属性而不是监听器：皮肤信息字段每次同步都重新包一层，旧的一层不能再把输入框拿回去。
  input.onchange = render
  render()
  return wrap
}

/** 一行百度配置值（类型化控件）；值不适合类型化控件时返回 undefined，调用方退回普通 field()。 */
export function configField(section: string, key: string, label: string, value: string, editable: boolean, commit: (value: string) => void): HTMLElement | undefined {
  const input = element("input")
  input.value = value
  input.disabled = !editable
  input.setAttribute("aria-label", label)
  input.addEventListener("change", () => commit(input.value))
  const control = configValueControl(input, section, key, label)
  if (!control) return
  const row = element("div", "ui-field")
  fieldCaption(row, key, label)
  row.append(control)
  return row
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
