import { bindListboxKeys, element, emptyState, searchField } from "../dom-element"
import { createIcon } from "../icons"
import { actionDescription, knownFunctionCodes, knownSkinStates } from "../actions"
import { bindDialog } from "./ask"
import { requestEditMode, setMobilePane, setMobileInspectorGroup } from "./mobile-layout"
import { mobilePortraitQuery, preview } from "./canvas-interaction"
import { appState } from "./state"
import { mobileInspectorResize, mobilePropertyTabs, quickInspector, inspectorPane } from "./dom"
import { syncMobileAppearance } from "./mobile-appearance"
import { isEditing } from "./edit-history"
import { stepButton } from "./property-rows"
import { syncMobileKeyAnimation } from "./mobile-key-animation"
import { wireGestureRecording } from "./gesture-recording"

/** 手机分类复用原属性行和提交逻辑。 */
export function syncMobilePropertyGroups(groups: HTMLElement[]): void {
  const selected = appState.selectedKeySections.length > 0
  inspectorPane.dataset.mobileKey = String(selected)
  mobilePropertyTabs.hidden = !selected || appState.selectedKeySections.length > 1 || !appState.archive || appState.selectedPath !== appState.layoutPath
  const actionLibrary = quickInspector.querySelector<HTMLButtonElement>(".mobile-action-library")
  if (actionLibrary) actionLibrary.disabled = appState.archive?.format === "ssf"
  const context = JSON.stringify([appState.selectedPath, appState.selectedKeySections])
  if (context !== appState.mobileInspectorContext) {
    appState.mobileInspectorContext = context
    appState.mobileInspectorCategory = "geometry"
    appState.mobileAppearancePressed = false
    preview.setAppearanceState()
  }
  for (const group of groups) {
    const label = group.dataset.inspectorGroupLabel ?? group.querySelector("h3")?.textContent ?? ""
    group.dataset.inspectorGroupLabel = label
    group.dataset.mobileCategory = /布局|排列|几何/.test(label) ? "geometry" : /音效|声音/.test(label) ? "sound"
      : /动画|动效|粒子/.test(label) ? "animation" : /手势|动作/.test(label) ? "actions" : /文字|字体|提示/.test(label) ? "typography" : "appearance"
  }
  if (!groups.some(group => group.dataset.mobileCategory === appState.mobileInspectorCategory)) {
    appState.mobileInspectorCategory = groups[0]?.dataset.mobileCategory ?? "geometry"
  }
  for (const button of mobilePropertyTabs.querySelectorAll<HTMLButtonElement>("button")) {
    button.disabled = !groups.some(group => group.dataset.mobileCategory === button.dataset.mobileCategory)
  }
  for (const button of quickInspector.querySelectorAll<HTMLButtonElement>(".geometry-fields .ui-step")) {
    button.disabled = !isEditing() || button.parentElement!.querySelector("input")!.disabled
  }
  syncCategory()
  syncMobileAppearance()
  syncMobileKeyAnimation()
}

function syncCategory(): void {
  preview.setAppearanceState(mobilePortraitQuery.matches && appState.mobileAppearancePressed ? appState.selectedKeySections[0] : undefined)
  for (const button of mobilePropertyTabs.querySelectorAll<HTMLButtonElement>("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.mobileCategory === appState.mobileInspectorCategory))
  }
}

function openActionLibrary(): void {
  const inputs = Array.from(quickInspector.querySelectorAll<HTMLInputElement>(".inspector-gesture > input"))
    .filter(input => !input.disabled && !input.readOnly)
  if (!inputs.length) { requestEditMode(); return }
  const dialog = element("dialog", "ui-dialog")
  dialog.dataset.size = "sm"
  dialog.dataset.variant = "ask"
  dialog.setAttribute("aria-label", "手势与动作")
  const form = element("form")
  form.method = "dialog"
  const header = element("header", "ui-dialog-header")
  const heading = element("div")
  heading.append(Object.assign(element("h2"), { textContent: "手势与动作" }))
  header.append(heading)
  const body = element("div", "ui-dialog-body")
  const gesture = element("select")
  gesture.setAttribute("aria-label", "手势")
  gesture.append(...inputs.map(input => new Option(input.previousElementSibling?.textContent?.trim() || input.dataset.keyField, input.dataset.keyField)))
  const select = element("label", "ui-input ui-select")
  select.append(gesture)
  const list = element("div", "ui-listbox")
  list.setAttribute("role", "listbox")
  list.setAttribute("aria-label", "动作库")
  let input = inputs[0]
  let chosen = input.value
  let query = ""
  const choose = (option: HTMLElement) => {
    chosen = option.dataset.actionCode ?? ""
    for (const row of list.querySelectorAll<HTMLElement>('[role="option"]')) {
      const selected = row === option
      row.setAttribute("aria-selected", String(selected))
      row.tabIndex = selected ? 0 : -1
    }
    option.focus()
  }
  const render = () => {
    const codes = [...new Set(["", input.value, ...knownFunctionCodes, ...knownSkinStates.map(state => `S${state}`)])]
    list.replaceChildren(...codes.filter(code => `${code} ${actionDescription(code)}`.toLowerCase().includes(query)).map(code => {
      const row = element("button", "ui-list-item")
      row.type = "button"
      row.dataset.actionCode = code
      row.setAttribute("role", "option")
      row.setAttribute("aria-selected", String(code === chosen))
      row.tabIndex = code === chosen ? 0 : -1
      row.textContent = code ? `${code} · ${actionDescription(code) || code}` : "未设置"
      row.addEventListener("click", () => choose(row))
      row.addEventListener("dblclick", () => apply.click())
      row.addEventListener("keydown", event => {
        if (event.key === "Enter") { event.preventDefault(); apply.click() }
      })
      return row
    }))
    if (!list.childElementCount) list.append(emptyState("search-x"))
  }
  const search = searchField({ label: "搜索动作", onInput(value) { query = value.trim().toLowerCase(); render() } })
  gesture.addEventListener("change", () => {
    input = inputs.find(input => input.dataset.keyField === gesture.value)!
    chosen = input.value
    render()
  })
  bindListboxKeys(list, choose)
  const footer = element("footer", "ui-dialog-footer")
  const cancel = Object.assign(element("button", "ui-button"), { textContent: "取消", value: "cancel" })
  const apply = Object.assign(element("button", "ui-button"), { textContent: "应用", value: "apply" })
  apply.dataset.variant = "primary"
  footer.append(cancel, apply)
  body.append(select, search, list)
  form.append(header, body, footer)
  dialog.append(form)
  bindDialog(dialog)
  dialog.addEventListener("close", () => {
    if (dialog.returnValue === "apply" && input.isConnected && !input.disabled) {
      input.value = chosen
      input.dispatchEvent(new Event("input", { bubbles: true }))
    }
    dialog.remove()
  }, { once: true })
  render()
  document.body.append(dialog)
  dialog.showModal()
  cancel.focus()
}

export function resizeMobileInspector(value: number): void {
  const split = Math.max(32, Math.min(90, value))
  document.documentElement.style.setProperty("--mobile-inspector-split", `${split}%`)
  document.documentElement.dataset.mobilePanel = split >= 80 ? "collapsed" : split <= 36 ? "expanded" : "normal"
  mobileInspectorResize.setAttribute("aria-valuenow", String(Math.round(split)))
  mobileInspectorResize.setAttribute("aria-valuetext", split >= 80 ? "展开属性" : `画布占 ${Math.round(split)}%`)
}

export function wireMobileInspector(): void {
  wireGestureRecording(quickInspector)
  preview.onMeasure = (_section, dimension) => {
    if (mobilePortraitQuery.matches) setMobilePane("inspector")
    const input = appState.archive?.format === "sxi"
      ? quickInspector.querySelectorAll<HTMLInputElement>('[data-document-key="rect.size"] input[type="number"]')[dimension === "width" ? 0 : 1]
      : quickInspector.querySelector<HTMLInputElement>(`[data-key-field="${dimension}"]`)
    if (!input) return
    if (input.disabled) { requestEditMode(); return }
    appState.mobileInspectorCategory = "geometry"
    syncCategory()
    input.scrollIntoView({ block: "nearest" })
    input.focus()
    input.select()
  }
  const actions = element("button", "ui-button mobile-action-library")
  actions.type = "button"
  actions.append(createIcon("list"), "动作库")
  actions.addEventListener("click", openActionLibrary)
  quickInspector.querySelector(".key-gesture-fields > h3")!.append(actions)
  for (const input of quickInspector.querySelectorAll<HTMLInputElement>('.geometry-fields [data-key-field="width"], .geometry-fields [data-key-field="height"]')) {
    const label = input.getAttribute("aria-label")!
    input.parentElement!.prepend(stepButton(-1, input, 1, 1, label, input.disabled))
    input.parentElement!.append(stepButton(1, input, 1, 1, label, input.disabled))
  }
  for (const button of mobilePropertyTabs.querySelectorAll<HTMLButtonElement>("button")) button.addEventListener("click", () => {
    const group = quickInspector.querySelector<HTMLElement>(`.mobile-inspector-managed[data-mobile-category="${button.dataset.mobileCategory}"]`)
    if (group) setMobileInspectorGroup(group.dataset.mobileInspectorGroup!)
  })
  mobilePropertyTabs.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
    const buttons = Array.from(mobilePropertyTabs.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"))
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (index < 0) return
    event.preventDefault()
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length
    buttons[next].click()
    buttons[next].focus()
  })
  mobileInspectorResize.addEventListener("pointerdown", event => {
    mobileInspectorResize.setPointerCapture(event.pointerId)
    mobileInspectorResize.dataset.dragged = "false"
    event.preventDefault()
  })
  mobileInspectorResize.addEventListener("pointermove", event => {
    if (!mobileInspectorResize.hasPointerCapture(event.pointerId) || !mobilePortraitQuery.matches || !event.movementY) return
    mobileInspectorResize.dataset.dragged = "true"
    const main = mobileInspectorResize.parentElement!.getBoundingClientRect()
    resizeMobileInspector((event.clientY - main.top) / main.height * 100)
  })
  mobileInspectorResize.addEventListener("keydown", event => {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return
    event.preventDefault()
    resizeMobileInspector(event.key === "Home" ? 32 : event.key === "End" ? 90
      : Number(mobileInspectorResize.getAttribute("aria-valuenow")) + (event.key === "ArrowUp" ? -4 : 4))
  })
  let clickTimer = 0
  mobileInspectorResize.addEventListener("click", () => {
    if (mobileInspectorResize.dataset.dragged === "true") return
    clearTimeout(clickTimer)
    clickTimer = window.setTimeout(() => resizeMobileInspector(document.documentElement.dataset.mobilePanel === "collapsed" ? 50 : 90),
      Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--double-click-delay")))
  })
  mobileInspectorResize.addEventListener("dblclick", () => { clearTimeout(clickTimer); resizeMobileInspector(32) })
}
