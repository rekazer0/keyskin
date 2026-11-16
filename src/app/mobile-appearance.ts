import { element } from "../dom-element"
import { createIcon } from "../icons"
import { drawVisualPreview } from "../atlas"
import { appState } from "./state"
import { mobilePortraitQuery, preview } from "./canvas-interaction"
import { quickInspector, keyFields } from "./dom"
import { visualResolver } from "./bda-documents"
import { canAddStyle, duplicateStyle } from "./style-picker"
import { styleUsages } from "./style-references"
import { isEditing, updateHistoryButtons } from "./edit-history"
import { updateSelectedKey } from "./key-inspector"
import { syncMobileKeyPreview } from "./mobile-key-preview"

/** 手机只换属性的入口，仍由原字段负责选择、校验和写回。 */
export function syncMobileAppearance(): void {
  let root = quickInspector.querySelector<HTMLElement>(".mobile-appearance")
  if (!root) {
    root = element("section", "mobile-appearance")
    quickInspector.querySelector(".key-appearance-fields > h3")!.after(root)
  }
  root.replaceChildren()
  const selected = appState.selectedKeySections.length === 1
  root.hidden = !selected || !mobilePortraitQuery.matches || !["bdi", "bds"].includes(appState.archive?.format ?? "")
  if (root.hidden) { preview.setAppearanceState(); return }
  const background = keyFields.find(input => input.dataset.keyField === "BACK_STYLE")
  const foreground = keyFields.find(input => input.dataset.keyField === "FORE_STYLE")
  const backgroundID = background?.value.split(",")[0]?.trim()
  const uses = backgroundID ? styleUsages(backgroundID).length : 0
  if (uses > 1 && background && !background.closest<HTMLElement>(".ui-section")?.hidden) {
    const note = element("div", "ui-scope-note")
    const copy = element("span")
    copy.append(Object.assign(element("strong"), { textContent: "背景 · 共享样式" }),
      Object.assign(element("small"), { textContent: `修改将影响 ${uses} 处引用` }))
    const isolate = element("button", "ui-button")
    isolate.type = "button"
    isolate.textContent = "仅改背景"
    isolate.disabled = !isEditing() || !canAddStyle()
    isolate.setAttribute("aria-label", "为选中按键创建独立背景样式")
    isolate.append(createIcon("chevron-right"))
    isolate.addEventListener("click", () => {
      const previous = appState.undoStack.at(-1)
      const id = duplicateStyle(backgroundID!)
      if (!id) return
      background.value = id
      updateSelectedKey(background)
      const changes = appState.undoStack.splice(previous ? appState.undoStack.indexOf(previous) + 1 : 0)
      if (changes.length) appState.undoStack.push(changes.length === 1 ? changes[0] : { kind: "batch", changes })
      updateHistoryButtons()
    })
    note.append(createIcon("link"), copy, isolate)
    root.append(note)
  }
  const resolver = visualResolver()
  const reference = (input: HTMLInputElement | undefined, label: string, icon: string) => {
    if (!input || input.closest<HTMLElement>(".ui-section")?.hidden) return
    const row = element("button", "ui-property-link")
    row.type = "button"
    row.setAttribute("aria-label", `更换${label}`)
    row.disabled = input.disabled
    const thumbnail = element("span", "ui-property-link-thumbnail")
    const canvas = element("canvas")
    canvas.width = canvas.height = 72
    thumbnail.append(createIcon(icon))
    const id = input.value.split(",")[0]?.trim()
    const value = element("small")
    value.textContent = id ? `样式 ${id}` : input.placeholder || "未设置"
    if (id && resolver) void resolver.resolve(id, appState.mobileAppearancePressed).then(visual => {
      if (!row.isConnected || !visual) return
      drawVisualPreview(canvas, [visual], label === "前景")
      thumbnail.replaceChildren(canvas)
      value.textContent = visual.imagePath?.split("/").pop() ?? `样式 ${id}`
    }).catch(() => {})
    const copy = element("span", "ui-property-link-copy")
    copy.append(Object.assign(element("strong"), { textContent: `${label}样式` }), value)
    row.append(thumbnail, copy, createIcon("chevron-right"))
    row.addEventListener("click", () => {
      const list = input.closest(".ui-style-ref-list")
      const state = list?.querySelector<HTMLElement>(`.ui-style-ref .ui-style-state[data-state="${appState.mobileAppearancePressed ? "pressed" : "normal"}"]`)
        ?? list?.querySelector<HTMLElement>(".ui-style-ref .ui-style-state")
      const add = input.closest(".ui-field")?.querySelector<HTMLElement>(".ui-style-ref-append")
      ;(state ?? add)?.click()
    })
    root!.append(row)
  }
  const heading = element("h3", "mobile-appearance-heading")
  heading.append("外观")
  const chooseBackground = () => {
    const list = background?.closest(".ui-style-ref-list")
    ;(list?.querySelector<HTMLElement>(`.ui-style-state[data-state="${appState.mobileAppearancePressed ? "pressed" : "normal"}"]`)
      ?? background?.closest(".ui-field")?.querySelector<HTMLElement>(".ui-style-ref-append"))?.click()
  }
  const states = element("div", "mobile-background-states")
  states.setAttribute("aria-label", "外观状态")
  for (const [pressed, label] of [[false, "正常"], [true, "按下"]] as const) {
    const button = element("button", "ui-button")
    button.type = "button"
    button.dataset.appearanceState = pressed ? "pressed" : "normal"
    button.setAttribute("aria-pressed", String(appState.mobileAppearancePressed === pressed))
    button.setAttribute("aria-label", `${label}背景预览，双击更换`)
    const canvas = element("canvas")
    canvas.width = 240; canvas.height = 80
    const caption = Object.assign(element("span"), { textContent: label })
    caption.append(Object.assign(element("small"), { textContent: backgroundID ? `STYLE${backgroundID}` : "未设置" }))
    button.append(canvas, caption)
    const foregroundID = foreground?.value.split(",")[0]?.trim() ?? ""
    const foregroundText = resolver?.resolveStyleText?.(foregroundID, pressed)
    if (backgroundID && resolver) void Promise.all([resolver.resolve(backgroundID, pressed), foregroundText ? { text: foregroundText } : resolver.resolve(foregroundID, pressed)]).then(visuals => {
      if (button.isConnected) drawVisualPreview(canvas, visuals, false)
    }).catch(() => {})
    button.addEventListener("click", () => {
      appState.mobileAppearancePressed = pressed
      preview.setAppearanceState(pressed ? appState.selectedKeySections[0] : undefined)
      syncMobileKeyPreview(pressed)
      syncMobileAppearance()
    })
    button.addEventListener("dblclick", chooseBackground)
    states.append(button)
  }
  root.append(heading, states)
  reference(background, "背景", "image")
  reference(foreground, "前景", "layers")
}
