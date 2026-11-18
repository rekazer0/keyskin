import { bindListboxKeys, element, emptyState, searchField } from "../dom-element"
import { createIcon } from "../icons"
import { actionDescription, knownFunctionCodes, knownSkinStates } from "../actions"
import { bindDialog } from "./ask"
import { requestEditMode, setMobilePane, setMobileInspectorGroup } from "./mobile-layout"
import { mobilePortraitQuery, preview, toolbarPreview } from "./canvas-interaction"
import { appState } from "./state"
import { mobileInspectorResize, mobilePropertyTabs, quickInspector, inspectorPane, mobileInspectorGroups, keyFields, toolbarFields, gapFields } from "./dom"
import { syncMobileAppearance } from "./mobile-appearance"
import { wireNumberSlider } from "./property-rows"
import { syncMobileKeyAnimation } from "./mobile-key-animation"
import { wireGestureRecording } from "./gesture-recording"

/** 手机分类复用原属性行和提交逻辑。 */
export function syncMobilePropertyGroups(groups: HTMLElement[]): void {
  const selected = appState.selectedKeySections.length > 0
  inspectorPane.dataset.mobileKey = String(selected)
  const actionLibrary = quickInspector.querySelector<HTMLButtonElement>(".mobile-action-library")
  if (actionLibrary) actionLibrary.disabled = !quickInspector.querySelector(".key-gesture-fields .inspector-gesture > input:not([readonly]):not(:disabled)")
  const context = JSON.stringify([appState.selectedPath, appState.selectedKeySections])
  if (context !== appState.mobileInspectorContext) {
    appState.mobileInspectorContext = context
    appState.mobileInspectorCategory = "geometry"
    appState.mobileAppearancePressed = false
    preview.setAppearanceState()
  }
  for (const group of groups) {
    const label = group.dataset.inspectorGroupLabel ?? ""
    group.dataset.mobileCategory = ({ 布局: "geometry", 样式: "appearance", 文字: "typography", 手势: "actions", 音效: "sound", 动画: "animation" } as Record<string, string>)[label] ?? label
  }
  preview.setAppearanceState(mobilePortraitQuery.matches && appState.mobileAppearancePressed ? appState.selectedKeySections[0] : undefined)
  syncMobileAppearance()
  syncMobileKeyAnimation()
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
    if (dialog.returnValue === "apply" && input.isConnected && !input.disabled && !input.readOnly) {
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
  document.documentElement.style.setProperty("--mobile-inspector-split", `calc(var(--mobile-workspace-height) * ${split / 100})`)
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
    const group = input.closest<HTMLElement>(".mobile-inspector-managed")
    if (group?.dataset.mobileInspectorGroup) setMobileInspectorGroup(group.dataset.mobileInspectorGroup)
    if (mobilePortraitQuery.matches) {
      const slider = input.previousElementSibling?.querySelector<HTMLInputElement>(".ui-slider")
      slider?.scrollIntoView({ block: "nearest" })
      slider?.focus()
    } else {
      input.scrollIntoView({ block: "nearest" })
      input.focus()
      input.select()
    }
  }
  const actions = element("button", "ui-button mobile-action-library")
  actions.type = "button"
  actions.append(createIcon("list"), "动作库")
  actions.addEventListener("click", openActionLibrary)
  quickInspector.querySelector(".key-gesture-fields > h3")!.append(actions)
  for (const input of [...keyFields, ...toolbarFields, ...gapFields].filter(field => field.type === "number")) {
    wireNumberSlider(input, {
      commit: input.dataset.keyField ? "input" : "change",
      bounds: () => {
        const key = input.dataset.keyField
        const toolbarPart = input.dataset.toolbarField === "VIEW_RECT" ? input.dataset.toolbarPart : undefined
        if (!["x", "y", "width", "height"].includes(key ?? "") && toolbarPart === undefined) return { step: 1 }
        const size = (toolbarPart === undefined ? preview : toolbarPreview).logicalSize()
        const max = key === "y" || key === "height" || toolbarPart === "1" || toolbarPart === "3" ? size.height : size.width
        return { min: input.min === "" ? -max : Number(input.min), max, step: 1 }
      },
    })
  }
  // 同一条分类栏在手机放到对象头下方；不复制分组、筛选、重置或格式专属操作。
  const rail = mobileInspectorGroups.parentElement!
  const positionRail = () => {
    if (mobilePortraitQuery.matches) mobilePropertyTabs.append(rail)
    else quickInspector.prepend(rail)
  }
  quickInspector.addEventListener("focusin", event => {
    if (!mobilePortraitQuery.matches || !(event.target instanceof HTMLElement)) return
    const id = event.target.closest<HTMLElement>(".mobile-inspector-managed")?.dataset.mobileInspectorGroup
    if (id && id !== quickInspector.dataset.mobileInspectorGroup) setMobileInspectorGroup(id, false)
  })
  positionRail()
  mobilePortraitQuery.addEventListener("change", positionRail)
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
