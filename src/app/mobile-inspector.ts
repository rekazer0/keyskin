import { bindListboxKeys, element, emptyState, searchField } from "../dom-element"
import { createIcon } from "../icons"
import { actionDescription, knownFunctionCodes, knownSkinStates } from "../actions"
import { bindDialog } from "./ask"
import { requestEditMode, setMobilePane } from "./mobile-layout"
import { mobilePortraitQuery, preview } from "./canvas-interaction"
import { appState } from "./state"
import { mobileInspectorResize, mobilePropertyTabs, mobilePreviewToggle, quickInspector, inspectorPane } from "./dom"

/** 手机分类复用原属性行和提交逻辑；布局等低频参数收起后仍可展开。 */
export function syncMobilePropertyGroups(groups: HTMLElement[]): void {
  const selected = appState.selectedKeySections.length > 0
  inspectorPane.dataset.mobileKey = String(selected)
  mobilePropertyTabs.hidden = !selected
  const context = JSON.stringify([appState.selectedPath, appState.selectedKeySections])
  if (context !== appState.mobileInspectorContext) {
    appState.mobileInspectorContext = context
    appState.mobileInspectorCategory = "appearance"
    appState.mobileInspectorExpanded.clear()
  }
  for (const group of groups) {
    const label = group.dataset.inspectorGroupLabel ?? group.querySelector("h3")?.textContent ?? ""
    group.dataset.inspectorGroupLabel = label
    group.dataset.mobileCategory = /文字|字体/.test(label) ? "text" : /手势|动作|音效|动画/.test(label) ? "actions" : "appearance"
    const secondary = /^(布局|排列)$/.test(label)
    group.dataset.mobileCollapsed = String(secondary && !appState.mobileInspectorExpanded.has(label))
    const heading = group.querySelector("h3")
    if (secondary && heading && !heading.querySelector(".mobile-group-disclosure")) {
      const button = element("button", "ui-button mobile-group-disclosure")
      button.type = "button"
      button.append(label, createIcon("chevron-down"))
      button.addEventListener("click", () => {
        const open = group.dataset.mobileCollapsed === "true"
        if (open) appState.mobileInspectorExpanded.add(label)
        else appState.mobileInspectorExpanded.delete(label)
        group.dataset.mobileCollapsed = String(!open)
        button.setAttribute("aria-expanded", String(open))
      })
      heading.append(button)
      heading.setAttribute("aria-label", label)
    }
    heading?.querySelector(".mobile-group-disclosure")?.setAttribute("aria-expanded", String(group.dataset.mobileCollapsed !== "true"))
  }
  syncCategory()
}

function syncCategory(): void {
  quickInspector.dataset.mobileCategory = appState.mobileInspectorCategory
  for (const button of mobilePropertyTabs.querySelectorAll<HTMLButtonElement>("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.mobileCategory === appState.mobileInspectorCategory))
  }
}

function openActionLibrary(): void {
  const inputs = Array.from(quickInspector.querySelectorAll<HTMLInputElement>(".inspector-gesture > input"))
    .filter(input => !input.disabled)
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

export function wireMobileInspector(): void {
  preview.onMeasure = (_section, dimension) => {
    if (mobilePortraitQuery.matches) setMobilePane("inspector")
    const input = appState.archive?.format === "sxi"
      ? quickInspector.querySelectorAll<HTMLInputElement>('[data-document-key="rect.size"] input[type="number"]')[dimension === "width" ? 0 : 1]
      : quickInspector.querySelector<HTMLInputElement>(`[data-key-field="${dimension}"]`)
    if (!input) return
    if (input.disabled) { requestEditMode(); return }
    appState.mobileInspectorCategory = "appearance"
    syncCategory()
    const group = input.closest<HTMLElement>("[data-mobile-collapsed]")
    if (group?.dataset.mobileCollapsed === "true") group.querySelector<HTMLButtonElement>(".mobile-group-disclosure")?.click()
    input.scrollIntoView({ block: "nearest" })
    input.focus()
    input.select()
  }
  const actions = element("button", "ui-button mobile-action-library")
  actions.type = "button"
  actions.append(createIcon("list"), "动作库")
  actions.addEventListener("click", openActionLibrary)
  quickInspector.querySelector(".key-gesture-fields > h3")!.append(actions)
  for (const button of mobilePropertyTabs.querySelectorAll<HTMLButtonElement>("button")) button.addEventListener("click", () => {
    appState.mobileInspectorCategory = button.dataset.mobileCategory!
    syncCategory()
    quickInspector.scrollTop = 0
  })
  const resize = (value: number) => {
    const split = Math.max(14, Math.min(62, value))
    document.documentElement.style.setProperty("--mobile-inspector-split", `${split}%`)
    mobileInspectorResize.setAttribute("aria-valuenow", String(Math.round(split)))
    mobileInspectorResize.setAttribute("aria-valuetext", `画布占 ${Math.round(split)}%`)
  }
  mobilePreviewToggle.addEventListener("click", () => {
    const collapsed = document.documentElement.dataset.mobilePreview !== "collapsed"
    document.documentElement.dataset.mobilePreview = collapsed ? "collapsed" : "expanded"
    mobilePreviewToggle.setAttribute("aria-expanded", String(!collapsed))
    const label = collapsed ? "展开画布" : "收起画布"
    mobilePreviewToggle.setAttribute("aria-label", label)
    mobilePreviewToggle.title = label
  })
  mobileInspectorResize.addEventListener("pointerdown", event => {
    mobileInspectorResize.setPointerCapture(event.pointerId)
    event.preventDefault()
  })
  mobileInspectorResize.addEventListener("pointermove", event => {
    if (!mobileInspectorResize.hasPointerCapture(event.pointerId) || !mobilePortraitQuery.matches) return
    const main = mobileInspectorResize.parentElement!.getBoundingClientRect()
    resize((event.clientY - main.top) / main.height * 100)
  })
  mobileInspectorResize.addEventListener("keydown", event => {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return
    event.preventDefault()
    resize(event.key === "Home" ? 14 : event.key === "End" ? 62
      : Number(mobileInspectorResize.getAttribute("aria-valuenow")) + (event.key === "ArrowUp" ? -2 : 2))
  })
  mobileInspectorResize.addEventListener("dblclick", () => resize(22))
}
