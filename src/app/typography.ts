// 所有皮肤共用的文字属性顺序与控件；格式适配器只提供字段、单位和写回。
import { element } from "../dom-element.ts"
import { field, fieldCaption, fieldControl, type FieldSpec } from "./property-rows"
import { SYSTEM_FONTS, type FontChoice } from "./font-picker"
import { typographyPreview } from "./typography-preview"

type Attribute = "text" | "font" | "size" | "weight" | "bold" | "smooth" | "color" | "pressed" | "shadowColor" | "shadowSize"
type Binding = { key: string; values: string[]; hint?: string; checked?: boolean }
type TypographyOptions = {
  fields: Partial<Record<Attribute, Binding>>
  write(key: string, value: string, merge?: (current: string) => string): void
  fonts?: FontChoice[]
  fontActions?: HTMLElement[]
  fontPlaceholder?: string
  size?: Pick<Extract<FieldSpec, { kind: "number" }>, "unit" | "step" | "min">
  codec?: "argb" | "0xargb"
  editable: boolean
  name?: string
  sample?: string
  track?(row: HTMLElement, keys: string[]): void
}

export function typographyRows(options: TypographyOptions): HTMLElement[] {
  const { fields, write, editable } = options
  const rows: HTMLElement[] = []
  const common = (values: string[]) => values.every(value => value === values[0]) ? values[0] ?? "" : ""
  const fonts = options.fonts ?? SYSTEM_FONTS
  const font = common(fields.font?.values ?? [])
  if (fields.font || fields.size) rows.push(typographyPreview({
    text: fields.text ? common(fields.text.values) : options.sample,
    font: fonts.find(choice => choice.value === font) ?? { value: font, label: font || "系统默认", family: font, missing: /\.(?:ttf|otf|ttc)$/i.test(font) },
    size: common(fields.size?.values ?? []), unit: options.size?.unit,
    weight: fields.bold ? fields.bold.checked ? "700" : "400" : common(fields.weight?.values ?? []),
    color: common(fields.color?.values ?? []), shadowColor: common(fields.shadowColor?.values ?? []), shadowSize: common(fields.shadowSize?.values ?? []),
    smooth: fields.smooth && common(fields.smooth.values), mixed: Object.values(fields).some(binding => new Set(binding.values).size > 1),
  }))
  const add = (attributes: Attribute[], label: string, spec: FieldSpec, commit: (value: string | boolean | string[], edit: { index?: number; merge?: (current: string) => string }) => void) => {
    const bindings = attributes.map(attribute => fields[attribute]!)
    const keys = bindings.map(binding => binding.key)
    const key = keys.join(" ")
    const mixed = bindings.some(binding => new Set(binding.values).size > 1)
    const name = `${options.name ?? ""}${label}`
    let row: HTMLElement
    if (options.track) {
      row = element("div", "ui-field")
      fieldCaption(row, key, label, bindings[0].hint)
      row.append(fieldControl(spec, name, commit, { editable, mixed }))
      options.track(row, keys)
    } else row = field({ key, label, name, rowKey: ["typography", options.name ?? "", key], hint: bindings[0].hint, spec, editable, mixed, commit,
      reset: baseline => {
        if (attributes.length > 1) attributes.forEach((attribute, index) => write(fields[attribute]!.key, (baseline as string[])[index]))
        else commit(baseline as string | boolean, {})
      },
    })
    if (attributes[0] === "font" && options.fontActions?.length) {
      const actions = element("span", "ui-field-actions")
      actions.append(...options.fontActions)
      row.append(actions)
    }
    row.dataset.configEmpty = String(bindings.every(binding => binding.values.every(value => !value.trim())))
    row.dataset.typography = attributes[0]
    if (attributes.length > 1) row.dataset.stack = ""
    rows.push(row)
  }
  for (const [attribute, label] of [["text", "样式内容"], ["font", "字体"], ["size", "字号"], ["weight", "字重"], ["bold", "字重"], ["smooth", "字体平滑"], ["color", "颜色"], ["pressed", "按下颜色"], ["shadowColor", "阴影颜色"], ["shadowSize", "阴影大小"]] as const) {
    const binding = fields[attribute]
    if (!binding || attribute === "pressed" && fields.color) continue
    const value = common(binding.values)
    if (attribute === "color" && fields.pressed) {
      add(["color", "pressed"], label, { kind: "colorPair", values: [value, common(fields.pressed.values)], codec: options.codec ?? "argb", details: true }, (values, { index = 0, merge }) => write(index ? fields.pressed!.key : binding.key, (values as string[])[index], merge))
      continue
    }
    const spec: FieldSpec = attribute === "font" ? { kind: "font", value, choices: options.fonts ?? SYSTEM_FONTS, placeholder: options.fontPlaceholder }
      : attribute === "size" ? { kind: "number", value, unit: "px", min: 0, stepper: true, expression: value === "inf", ...options.size }
      : attribute === "weight" ? { kind: "choice", value, layout: "wrap", options: Array.from({ length: 9 }, (_, index) => [String((index + 1) * 100), String((index + 1) * 100)] as const) }
      : attribute === "shadowSize" ? { kind: "number", value, unit: "px", min: 0, stepper: true }
      : attribute === "bold" ? { kind: "choice", value: binding.checked ? "1" : "0", options: [["0", "常规"], ["1", "粗"]] }
      : attribute === "smooth" ? { kind: "switch", checked: binding.checked ?? value === "1" }
      : ["color", "pressed", "shadowColor"].includes(attribute) ? { kind: "color", value, codec: options.codec ?? "argb", details: true }
      : { kind: "text", value }
    add([attribute], label, spec, (next, { merge }) => write(binding.key, typeof next === "boolean" ? next ? "1" : "0" : next as string, merge))
  }
  if (fields.font) {
    const unsupported: Array<[string, string, FieldSpec]> = [
      ["lineHeight", "行高", { kind: "number", value: "", unit: "×" }],
      ["spacing", "字间距", { kind: "number", value: "", unit: "px" }],
      ["decoration", "装饰", { kind: "flags", values: [], options: [["italic", "斜体", "italic"], ["underline", "下划线", "underline"], ["strikethrough", "删除线", "strikethrough"]] }],
      ["align", "对齐", { kind: "choice", value: "", options: [["left", "左对齐", "align-left"], ["center", "居中", "align-center"], ["right", "右对齐", "align-right"]] }],
    ]
    for (const [attribute, label, spec] of unsupported) {
      const row = field({ key: attribute, label, spec, editable: false, hint: `当前格式的文字样式不支持${label}` })
      row.dataset.typography = attribute
      row.dataset.supported = "false"
      const colorIndex = rows.findIndex(row => row.dataset.typography === "color")
      rows.splice(colorIndex < 0 ? rows.length : colorIndex, 0, row)
    }
  }
  const textRow = rows.find(row => row.dataset.typography === "text")
  if (textRow) {
    rows.splice(rows.indexOf(textRow), 1)
    rows.unshift(Object.assign(element("h4", "ui-typography-heading"), { textContent: "基础" }), textRow, Object.assign(element("h4", "ui-typography-heading"), { textContent: "字体" }))
  }
  return rows
}
