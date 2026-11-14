import { bindListboxKeys, element, emptyState } from "./dom-element.ts"
import { IniDocument } from "./ini.ts"
import { iniPreviewClip } from "./animation-preview-model.ts"
import { animationPlayer } from "./animation-player.ts"
import { bindDialog } from "./app/ask.ts"
import { closeDialog } from "./motion.ts"
import type { BdaAnimationKind } from "./bda.ts"

export type AnimationPreset = { id: string; label: string; category: "press" | "particle" | "loop"; fields: Record<string, string> }

export const ANIMATION_PRESETS: readonly AnimationPreset[] = [
  { id: "press-scale", label: "轻按缩放", category: "press", fields: { CATEGORY: "0", TYPE: "3", FROM: "100,100", TO: "94,94", DURATION: "120", INTPOL: "2", REPEAT_MODE: "1" } },
  { id: "press-fade", label: "按下淡入", category: "press", fields: { CATEGORY: "0", TYPE: "0", FROM: "0", TO: "255", DURATION: "180", INTPOL: "2" } },
  { id: "pulse", label: "呼吸循环", category: "loop", fields: { CATEGORY: "0", TYPE: "0", FROM: "128", TO: "255", DURATION: "1000", REPEAT_CNT: "inf", REPEAT_MODE: "1" } },
  { id: "rotate", label: "旋转循环", category: "loop", fields: { CATEGORY: "0", TYPE: "1", FROM: "0", TO: "360", DURATION: "1600", REPEAT_CNT: "inf", PIVOT: "50,50" } },
  { id: "burst", label: "触点迸发", category: "particle", fields: { CATEGORY: "3", TYPE: "0", LIFE: "300,600", TOTAL_NUMBER: "12", BIRTH_RATE: "120", VELOCITY: "60,140", VELOCITY_DIRECTION: "0,360", INIT_SCALE: "0.5,1", INIT_ALPHA: "255,255", DURATION: "100", EMIT_REGION: "0,0,1,1", EMIT_TYPE: "1" } },
  { id: "rain", label: "轻落粒子", category: "particle", fields: { CATEGORY: "3", TYPE: "0", LIFE: "1000,1500", TOTAL_NUMBER: "20", BIRTH_RATE: "8", VELOCITY: "30,80", VELOCITY_DIRECTION: "80,100", INIT_SCALE: "0.5,1", INIT_ALPHA: "255,255", DURATION: "2500", EMIT_REGION: "0,0,1,1", EMIT_TYPE: "0" } },
]

/** BDA 保留当前效果的类型与资源绑定，只替换该类型支持的参数。 */
export function bdaPresetFields(preset: AnimationPreset, kind: BdaAnimationKind): Record<string, number> | undefined {
  const fields = preset.fields
  const expected = preset.category === "particle" ? "emitter" : fields.TYPE === "0" ? "alpha" : fields.TYPE === "1" ? "rotate" : "scale"
  if (kind !== expected) return
  const result: Record<string, number> = { duration: Number(fields.DURATION) / (kind === "emitter" ? 1000 : 1), repeatCount: fields.REPEAT_CNT === "inf" ? 2147483647 : 1, repeatMode: Number(fields.REPEAT_MODE ?? 0) }
  const range = (property: string, value: string | undefined) => {
    if (!value) return
    const [min, max = min] = value.split(",").map(Number)
    result[`${property}Min`] = min
    result[`${property}Max`] = max
  }
  if (kind === "emitter") {
    result.totalNumber = Number(fields.TOTAL_NUMBER)
    result.birthRate = Number(fields.BIRTH_RATE)
    for (const [key, property] of [["LIFE", "life"], ["VELOCITY", "velocity"], ["VELOCITY_DIRECTION", "velocityDirection"], ["INIT_SCALE", "scale"], ["INIT_ALPHA", "alpha"]]) range(property, fields[key])
  } else {
    result.delay = 0
    result.interpolation = Number(fields.INTPOL ?? 0)
    if (kind === "scale") result.interpolationXYX = result.interpolationXYY = result.interpolation
    for (const [key, property] of [["FROM", "from"], ["TO", "to"]]) {
      const values = fields[key].split(",")
      if (kind === "scale") { range(`${property}X`, values[0]); range(`${property}Y`, values[1] ?? values[0]) }
      else range(property, values[0])
    }
    // BDA 保留目标的变换中心，避免覆盖已有像素中心后预览与写回不一致。
  }
  return result
}

/** 预览只读临时配置；直到点击应用才交给原生格式适配器写回。 */
export function openAnimationPresets(items: readonly AnimationPreset[], apply: (preset: AnimationPreset) => void, applyLabel = "应用"): void {
  const dialog = element("dialog", "ui-dialog")
  dialog.dataset.variant = "ask"
  dialog.setAttribute("aria-label", "动效预设")
  const form = element("form")
  form.method = "dialog"
  const header = element("header", "ui-dialog-header")
  const heading = element("div")
  heading.append(Object.assign(element("h2"), { textContent: "动效预设" }))
  header.append(heading)
  const body = element("div", "ui-dialog-body")
  body.dataset.layout = "stack"
  const filters = element("div", "ui-segmented")
  filters.dataset.fill = ""
  const list = element("div", "ui-listbox")
  list.setAttribute("role", "listbox")
  list.setAttribute("aria-label", "动效预设")
  const preview = element("div")
  const note = Object.assign(element("p", "ui-field-note"), { textContent: "预设写入原生动画参数，可一步撤销。粒子预设应用后需选择粒子图片，并绑定到按键样式。" })
  const footer = element("footer", "ui-dialog-footer")
  const cancel = Object.assign(element("button", "ui-button"), { type: "button", textContent: "取消" })
  cancel.addEventListener("click", () => closeDialog(dialog))
  const confirm = Object.assign(element("button", "ui-button"), { type: "button", textContent: applyLabel })
  confirm.dataset.variant = "primary"
  let selected = items[0]
  let category = selected?.category
  const select = (row: HTMLElement) => {
    selected = items.find(item => item.id === row.dataset.presetId)!
    for (const child of list.querySelectorAll<HTMLElement>('[role="option"]')) {
      child.setAttribute("aria-selected", String(child === row))
      child.tabIndex = child === row ? 0 : -1
    }
    const document = IniDocument.parse("")
    document.appendSection("ANIM1", Object.entries(selected.fields).map(([key, value]) => ({ key, value })))
    if (selected.category === "particle") document.set("ANIM1", "PARTICLE_IMAGE", "preview")
    preview.replaceChildren(animationPlayer({ clip: iniPreviewClip(document, "ANIM1"), key: `preset:${selected.id}` }))
    confirm.disabled = false
  }
  const render = () => {
    const shown = items.filter(item => item.category === category)
    list.replaceChildren(...shown.map(item => {
      const row = Object.assign(element("button", "ui-list-item"), { type: "button", textContent: item.label })
      row.dataset.presetId = item.id
      row.setAttribute("role", "option")
      row.addEventListener("click", () => select(row))
      row.addEventListener("dblclick", () => confirm.click())
      row.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); confirm.click() } })
      return row
    }))
    const first = list.firstElementChild as HTMLElement | null
    if (first) select(first)
    else { list.append(emptyState("list")); preview.replaceChildren(); confirm.disabled = true }
  }
  for (const [value, label] of [["press", "按下"], ["particle", "粒子"], ["loop", "循环"]] as const) {
    const button = Object.assign(element("button"), { type: "button", textContent: label })
    button.disabled = !items.some(item => item.category === value)
    button.setAttribute("aria-pressed", String(category === value))
    button.addEventListener("click", () => {
      category = value
      for (const child of filters.children) child.setAttribute("aria-pressed", String(child === button))
      render()
    })
    filters.append(button)
  }
  confirm.addEventListener("click", () => { if (selected) { apply(selected); closeDialog(dialog) } })
  bindListboxKeys(list, select)
  footer.append(cancel, confirm)
  body.append(filters, list, preview, note)
  form.append(header, body, footer)
  dialog.append(form)
  bindDialog(dialog)
  dialog.addEventListener("close", () => dialog.remove(), { once: true })
  document.body.append(dialog)
  render()
  dialog.showModal()
  cancel.focus()
}
