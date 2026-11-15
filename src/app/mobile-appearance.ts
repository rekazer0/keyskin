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
    quickInspector.prepend(root)
  }
  root.replaceChildren()
  const selected = appState.selectedKeySections.length > 0
  root.hidden = !selected || !mobilePortraitQuery.matches || !["bdi", "bds"].includes(appState.archive?.format ?? "")
  quickInspector.dataset.mobileAppearanceExpanded = String(appState.mobileAppearanceExpanded)
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
    row.dataset.mobileAdvanced = ""
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
    row.append(thumbnail, Object.assign(element("span"), { textContent: label }), value, createIcon("chevron-right"))
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
  heading.append("背景样式")
  const choose = element("button", "ui-button")
  choose.type = "button"
  choose.textContent = "查看全部 ›"
  choose.setAttribute("aria-label", "更换背景")
  choose.addEventListener("click", () => {
    const list = background?.closest(".ui-style-ref-list")
    ;(list?.querySelector<HTMLElement>(`.ui-style-state[data-state="${appState.mobileAppearancePressed ? "pressed" : "normal"}"]`)
      ?? background?.closest(".ui-field")?.querySelector<HTMLElement>(".ui-style-ref-append"))?.click()
  })
  heading.append(choose)
  const states = element("div", "mobile-background-states")
  states.setAttribute("aria-label", "外观状态")
  for (const [pressed, label] of [[false, "正常"], [true, "按下"]] as const) {
    const button = element("button")
    button.type = "button"
    button.dataset.appearanceState = pressed ? "pressed" : "normal"
    button.setAttribute("aria-pressed", String(appState.mobileAppearancePressed === pressed))
    button.setAttribute("aria-label", `${label}背景预览，双击更换`)
    const canvas = element("canvas")
    canvas.width = 72; canvas.height = 96
    button.append(canvas, Object.assign(element("span"), { textContent: label }), Object.assign(element("small"), { textContent: backgroundID ? `STYLE${backgroundID}` : "未设置" }))
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
    button.addEventListener("dblclick", () => choose.click())
    states.append(button)
  }
  root.append(heading, states)
  reference(foreground, "前景", "layers")
  const text = element("button", "ui-property-link")
  text.type = "button"
  const textIcon = element("span", "ui-property-link-thumbnail")
  textIcon.append(createIcon("type"))
  text.append(textIcon, "文字颜色", Object.assign(element("small"), { textContent: "字体与颜色" }), createIcon("chevron-right"))
  if (resolver && foreground?.value) void resolver.resolve(foreground.value, appState.mobileAppearancePressed).then(visual => {
    if (visual?.color) {
      const rgb = visual.color.match(/[\d.]+/g)?.slice(0, 3).map(Number)
      text.querySelector("small")!.textContent = rgb?.length === 3 ? `#${rgb.map(value => value.toString(16).padStart(2, "0")).join("").toUpperCase()}` : visual.color
    }
  }).catch(() => {})
  const expand = () => {
    appState.mobileAppearanceExpanded = !appState.mobileAppearanceExpanded
    quickInspector.dataset.mobileAppearanceExpanded = String(appState.mobileAppearanceExpanded)
    more.setAttribute("aria-expanded", String(appState.mobileAppearanceExpanded))
  }
  text.addEventListener("click", () => {
    document.querySelector<HTMLButtonElement>('#mobile-property-tabs [data-mobile-category="typography"]')?.click()
  })
  const more = element("button", "ui-button")
  more.type = "button"
  more.dataset.variant = "quiet"
  more.textContent = "高级样式"
  more.setAttribute("aria-expanded", String(appState.mobileAppearanceExpanded))
  more.append(createIcon("sliders-horizontal"))
  more.addEventListener("click", expand)
  root.append(text, more)
}
