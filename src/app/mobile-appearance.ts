import { element, iconButton } from "../dom-element"
import { createIcon } from "../icons"
import { drawVisualPreview } from "../atlas"
import { textStyleSample } from "../style-card"
import { appState } from "./state"
import { mobilePortraitQuery, preview } from "./canvas-interaction"
import { quickInspector, keyFields } from "./dom"
import { visualResolver } from "./bda-documents"
import { canAddStyle, duplicateStyle, openStylePicker, styleConfigDocument, styleKind } from "./style-picker"
import { openStyleReferenceEditor, refreshStyleReferenceThumbnail, styleUsages } from "./style-references"
import { isEditing, updateHistoryButtons } from "./edit-history"
import { syncMobileKeyPreview } from "./mobile-key-preview"

/** 手机只换入口：每层沿用 PC 引用卡的槽位输入框，增删、选换和撤销共用写回路径。 */
export function syncMobileAppearance(): void {
  let root = quickInspector.querySelector<HTMLElement>(".mobile-appearance")
  if (!root) {
    root = element("section", "mobile-appearance")
    quickInspector.querySelector(".key-appearance-fields > h3")!.after(root)
  }
  root.replaceChildren()
  root.hidden = appState.selectedKeySections.length !== 1 || !mobilePortraitQuery.matches || !["bdi", "bds"].includes(appState.archive?.format ?? "")
  if (root.hidden) { delete root.dataset.layer; preview.setAppearanceState(); return }
  const back = keyFields.find(input => input.dataset.keyField === "BACK_STYLE")!
  const fore = keyFields.find(input => input.dataset.keyField === "FORE_STYLE")!
  const ids = fore.value.split(",").map(id => id.trim()).filter(Boolean)
  if (root.dataset.context !== appState.mobileInspectorContext) delete root.dataset.layer
  root.dataset.context = appState.mobileInspectorContext
  const layer = Number(root.dataset.layer ?? -1)
  const index = layer < ids.length ? layer : -1
  const foreground = index >= 0
  const label = foreground ? `前景 ${index + 1}` : "背景"
  const input = foreground ? fore : back
  const id = foreground ? ids[index] : back.value.trim()
  const disabled = input.disabled || !isEditing()
  const slot = () => {
    if (!foreground) return back
    const list = input.closest<HTMLElement>(".ui-style-ref-list")!
    // PC 的卡片在下一帧刷新；即使立即点击，也不能取到上一按键的槽位。
    refreshStyleReferenceThumbnail(list, input, input.dataset.keyField!)
    return list.querySelector<HTMLInputElement>(`.ui-style-ref-number[data-style-reference-index="${index}"]`)
  }
  const choose = (pressed: boolean, images = false) => {
    const target = slot()
    if (target) openStylePicker(target, pressed, images)
  }
  const write = (value: string, target = slot()) => {
    if (!target) return
    target.value = value
    if (target === back) target.dispatchEvent(new Event("input", { bubbles: true }))
    target.dispatchEvent(new Event("change", { bubbles: true }))
  }
  const heading = element("h3", "mobile-appearance-heading")
  heading.append("样式")
  const replace = element("button", "ui-button")
  replace.type = "button"
  replace.dataset.variant = "quiet"
  replace.textContent = id ? "更换样式" : "选择样式"
  replace.disabled = disabled
  replace.append(createIcon("chevron-right"))
  replace.addEventListener("click", () => choose(appState.mobileAppearancePressed))
  heading.append(replace)
  const layers = element("div", "ui-segmented mobile-appearance-layers")
  layers.setAttribute("role", "group")
  layers.setAttribute("aria-label", "样式图层")
  for (const [at, name] of ["背景", ...ids.map((_, i) => `前景 ${i + 1}`)].entries()) {
    const button = element("button")
    button.type = "button"
    button.textContent = name
    button.setAttribute("aria-pressed", String(at - 1 === index))
    button.addEventListener("click", () => {
      const top = quickInspector.scrollTop
      root.dataset.layer = String(at - 1)
      syncMobileAppearance()
      quickInspector.scrollTop = top
      root.querySelector<HTMLButtonElement>('.mobile-appearance-layers [aria-pressed="true"]')?.focus({ preventScroll: true })
    })
    layers.append(button)
  }
  const add = iconButton("plus", "添加前景", () => fore.closest(".ui-field")?.querySelector<HTMLButtonElement>(".ui-style-ref-append")?.click())
  add.disabled = fore.disabled || !isEditing()
  heading.append(add)
  root.append(heading, layers)
  const reference = element("div", "mobile-appearance-reference")
  const field = element("label", "ui-input")
  field.append("样式编号")
  const number = element("input")
  number.value = id
  number.placeholder = "未设置"
  number.inputMode = "numeric"
  number.disabled = disabled
  number.setAttribute("aria-label", `${label}样式编号`)
  number.addEventListener("change", () => write(number.value.trim()))
  field.append(number)
  reference.append(field)
  const styles = styleConfigDocument()
  const defined = !!id && !!styles?.hasSection(`STYLE${id}`)
  if (id) {
    const edit = iconButton("pencil-line", `编辑${label}样式资源`, () => openStyleReferenceEditor(id))
    edit.disabled = disabled || !defined
    reference.append(edit)
    const remove = iconButton("trash-2", `移除${label}引用`, () => write(""))
    remove.disabled = disabled
    reference.append(remove)
  }
  root.append(reference)
  const states = element("div", "mobile-background-states")
  states.setAttribute("role", "group")
  states.setAttribute("aria-label", `${label}状态`)
  const resolver = visualResolver()
  const kind = styleKind(id, styles)
  const image = kind === "image" || kind === "empty"
  for (const [pressed, state] of [[false, "正常"], [true, "按下"]] as const) {
    const button = element("button", "ui-button")
    button.type = "button"
    button.dataset.appearanceState = pressed ? "pressed" : "normal"
    button.setAttribute("aria-pressed", String(appState.mobileAppearancePressed === pressed))
    button.setAttribute("aria-label", image ? `更换${foreground ? label : ""}${state}图片` : `预览${label}${state}状态`)
    button.disabled = image && disabled
    const canvas = element("canvas")
    canvas.width = 240; canvas.height = 80
    const caption = Object.assign(element("span"), { textContent: `${label} · ${state}` })
    caption.append(Object.assign(element("small"), { textContent: id ? `STYLE${id}` : "未设置" }))
    button.append(canvas, caption)
    if (id && resolver) {
      const draw = kind === "text" ? textStyleSample(canvas, resolver, id, pressed) : resolver.resolve(id, pressed).then(visual => drawVisualPreview(canvas, [visual], foreground))
      void draw.catch(() => {})
    }
    button.addEventListener("click", () => {
      appState.mobileAppearancePressed = pressed
      preview.setAppearanceState(pressed ? appState.selectedKeySections[0] : undefined)
      syncMobileKeyPreview()
      for (const card of states.children) card.setAttribute("aria-pressed", String(card === button))
      if (image) choose(pressed, true)
    })
    states.append(button)
  }
  root.append(states)
  const uses = id ? styleUsages(id).length : 0
  const localLayers = id ? [back.value.trim(), ...ids].filter(other => other === id).length : 0
  if (uses <= 1 && localLayers <= 1) return
  const note = element("div", "ui-scope-note")
  const copy = element("span")
  copy.append(Object.assign(element("strong"), { textContent: `${label} · 共享样式` }),
    Object.assign(element("small"), { textContent: `修改将影响 ${uses} 处引用${localLayers > 1 ? `，本键 ${localLayers} 层共用` : ""}` }))
  const isolate = element("button", "ui-button")
  isolate.type = "button"
  isolate.textContent = `仅改${label}`
  isolate.disabled = disabled || !defined || !canAddStyle()
  isolate.setAttribute("aria-label", `为选中按键创建独立${label}样式`)
  isolate.addEventListener("click", () => {
    const target = slot()
    if (!target) return
    const previous = appState.undoStack.at(-1)
    const independent = duplicateStyle(id)
    if (!independent) return
    write(independent, target)
    const changes = appState.undoStack.splice(previous ? appState.undoStack.indexOf(previous) + 1 : 0)
    if (changes.length) appState.undoStack.push(changes.length === 1 ? changes[0] : { kind: "batch", changes })
    updateHistoryButtons()
  })
  note.append(createIcon("link"), copy, isolate)
  root.append(note)
}
