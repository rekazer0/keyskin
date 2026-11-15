import { element } from "../dom-element"
import { mobilePortraitQuery } from "./canvas-interaction"
import { quickInspector } from "./dom"
import { appState } from "./state"

/** 摘要转发到原始属性控件，保留格式校验和撤销。 */
export function syncMobilePanelSummary(): void {
  let summary = quickInspector.querySelector<HTMLElement>(".mobile-panel-summary")
  if (!summary) { summary = element("section", "mobile-panel-summary"); quickInspector.prepend(summary) }
  summary.replaceChildren()
  const size = quickInspector.querySelector<HTMLElement>('.document-fields [data-document-key="SIZE"]')
  const height = size?.querySelectorAll<HTMLInputElement>('input[type="number"]')[1]
  const background = quickInspector.querySelector<HTMLElement>('.document-fields [data-document-key="BACK_STYLE"]')
  summary.hidden = !mobilePortraitQuery.matches || appState.selectedKeySections.length > 0 || appState.selectedPath !== appState.layoutPath || !height
  quickInspector.dataset.mobilePanelSummary = String(!summary.hidden)
  if (summary.hidden || !height) return
  if (background) {
    const row = element("div", "ui-field")
    const choose = element("button", "ui-button")
    choose.type = "button"
    choose.textContent = "选择背景 ›"
    const original = background.querySelector<HTMLButtonElement>(".ui-style-state")
    choose.disabled = !original || original.disabled
    choose.addEventListener("click", () => original?.click())
    row.append(Object.assign(element("span"), { textContent: "面板背景" }), choose)
    summary.append(row)
  }
  const row = element("label", "ui-field")
  const input = element("input", "ui-input")
  input.type = "number"; input.min = "1"; input.value = height.value; input.disabled = height.disabled
  input.setAttribute("aria-label", "键盘高度")
  input.addEventListener("change", () => { height.value = input.value; height.dispatchEvent(new Event("change", { bubbles: true })) })
  row.append(Object.assign(element("span"), { textContent: "键盘高度" }), input)
  const more = element("button", "ui-button")
  more.type = "button"
  more.textContent = "高级样式与布局"
  more.setAttribute("aria-expanded", String(appState.mobileAppearanceExpanded))
  more.addEventListener("click", () => {
    appState.mobileAppearanceExpanded = !appState.mobileAppearanceExpanded
    quickInspector.dataset.mobileAppearanceExpanded = String(appState.mobileAppearanceExpanded)
    more.setAttribute("aria-expanded", String(appState.mobileAppearanceExpanded))
  })
  summary.append(row, Object.assign(element("p", "ui-field-note"), { textContent: "双指缩放画布 · 修改后可撤销" }), more)
}
