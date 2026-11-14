import { element } from "./dom-element.ts"
import type { Preview } from "./preview.ts"

/** 标注使用真实布局坐标，点击后交给同一份几何属性编辑。 */
export function drawMeasurements(preview: Preview): void {
  const keys = preview.keys.filter(key => preview.itemSelected(key) && key.editable)
  const key = keys.length === 1 ? keys[0] : undefined
  const visible = Boolean(preview.guides && preview.onMeasure && key && !preview.animationView)
  if (!visible && !preview.measurements) return
  const group = preview.measurements ?? element("div", "ui-measurements")
  if (!preview.measurements) {
    group.setAttribute("role", "group")
    group.setAttribute("aria-label", "尺寸标注")
    for (const [dimension, label] of [["width", "宽度"], ["height", "高度"]] as const) {
      const button = Object.assign(element("button", "ui-button"), { type: "button" })
      button.dataset.dimension = dimension
      button.addEventListener("click", () => {
        const current = preview.keys.filter(key => preview.itemSelected(key) && key.editable)
        if (current.length === 1) preview.onMeasure?.(current[0].section, dimension)
      })
      button.dataset.label = label
      group.append(button)
    }
    preview.canvas.parentElement!.append(group)
    preview.measurements = group
  }
  group.hidden = !visible
  if (!key || !visible) return
  for (const button of group.querySelectorAll<HTMLButtonElement>("button")) {
    const dimension = button.dataset.dimension as "width" | "height"
    const value = Math.round(key.rect[dimension] * 100) / 100
    button.textContent = `${dimension === "width" ? "W" : "H"} ${value}`
    button.setAttribute("aria-label", `${button.dataset.label} ${value}，编辑尺寸`)
    button.disabled = !preview.measurementEditable
    button.title = preview.measurementEditable ? "" : "此格式的按键几何由原生布局决定"
  }
}
