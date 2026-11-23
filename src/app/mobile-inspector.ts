import { iconButton } from "../dom-element"
import { requestEditMode, setMobilePane, setMobileInspectorGroup } from "./mobile-layout"
import { mobilePortraitQuery, preview } from "./canvas-interaction"
import { appState } from "./state"
import { mobileInspectorResize, quickInspector, inspectorPane } from "./dom"
import { isEditing } from "./edit-history"
import { visiblePreviewItems } from "../preview-items"
import { cssTimeMs } from "../motion"
import { wireGestureRecording } from "./gesture-recording"

/** 换对象时更新手机停靠高度，不改变属性控件。 */
export function syncMobileInspectorDock(): boolean {
  const selected = appState.selectedKeySections.length > 0
  inspectorPane.dataset.mobileKey = String(selected)
  const context = JSON.stringify([appState.selectedPath, appState.selectedKeySections, appState.selectedCandidate, appState.selectedToolbarSections])
  const changed = context !== appState.mobileInspectorContext
  if (changed) {
    appState.mobileInspectorContext = context
    const panel = appState.selectedPath === appState.layoutPath && !selected && !appState.selectedCandidate
    if (mobilePortraitQuery.matches && isEditing()) resizeMobileInspector(panel ? 90 : 50)
  }
  return changed
}

const detents = [32, 50, 90] as const
const detentLabels = ["全开", "半开", "探出"] as const

export function resizeMobileInspector(value: number): void {
  const index = value < 41 ? 0 : value < 70 ? 1 : 2
  document.documentElement.dataset.mobilePanel = ["expanded", "normal", "peek"][index]
  mobileInspectorResize.setAttribute("aria-valuenow", String(detents[index]))
  mobileInspectorResize.setAttribute("aria-valuetext", detentLabels[index])
}

export function wireMobileInspector(): void {
  wireGestureRecording(quickInspector)
  preview.onMeasure = (_section, dimension) => {
    if (mobilePortraitQuery.matches) {
      setMobilePane("inspector")
      if (document.documentElement.dataset.mobilePanel === "peek") resizeMobileInspector(50)
    }
    const input = appState.archive?.format === "sxi"
      ? quickInspector.querySelectorAll<HTMLInputElement>('[data-document-key="rect.size"] input[type="number"]')[dimension === "width" ? 0 : 1]
      : quickInspector.querySelector<HTMLInputElement>(`[data-key-field="${dimension}"]`)
    if (!input) return
    if (input.disabled) { requestEditMode(); return }
    const group = input.closest<HTMLElement>(".mobile-inspector-managed")
    if (group?.dataset.mobileInspectorGroup) setMobileInspectorGroup(group.dataset.mobileInspectorGroup)
    input.scrollIntoView({ block: "nearest" })
    input.focus({ preventScroll: true })
    input.select()
  }
  const root = document.documentElement
  const header = inspectorPane.querySelector<HTMLElement>(".key-inspector-title")!
  const selectableKeys = () => [...new Set(visiblePreviewItems(preview.keys, preview.skinState)
    .filter(key => key.editable && !key.section.startsWith("LIST")).flatMap(key => key.sections))]
  const selectAll = iconButton("layers", "全选按键", () => {
    if (!isEditing()) return
    const sections = selectableKeys()
    if (!sections.length) return
    preview.setSelected(sections)
    preview.mobileMultiSelect = true
    preview.onSelect(sections)
  })
  selectAll.dataset.mobileDockAction = "select-all"
  const done = iconButton("chevron-down", "收起属性", () => {
    resizeMobileInspector(90)
    mobileInspectorResize.focus({ preventScroll: true })
  })
  done.dataset.mobileDockAction = "done"
  header.append(selectAll, done)

  // 属性与对象源码共用停靠面板；全局源码由外壳独立处理。
  const editor = inspectorPane.querySelector<HTMLElement>("#source-editor")!
  const syncView = () => {
    const view = !editor.hidden ? "source" : !quickInspector.hidden ? "properties" : "other"
    inspectorPane.dataset.mobileInspectorView = view
    const route = root.dataset
    const dock = mobilePortraitQuery.matches && route.mobilePane === "inspector" && route.mobilePage === "edit"
      && route.mobileMode === "edit" && route.mobileWelcome === "false" && route.mobileResource !== "true"
      && !root.hasAttribute("data-mobile-source") && view !== "other"
    root.dataset.mobileDock = String(dock)
    if (dock && view === "source" && route.mobilePanel === "peek") resizeMobileInspector(50)
  }
  const observer = new MutationObserver(syncView)
  for (const panel of [editor, quickInspector]) observer.observe(panel, { attributes: true, attributeFilter: ["hidden"] })
  observer.observe(root, { attributes: true, attributeFilter: ["data-mobile-pane", "data-mobile-page", "data-mobile-mode", "data-mobile-welcome", "data-mobile-resource", "data-mobile-source"] })
  mobilePortraitQuery.addEventListener("change", syncView)
  syncView()
  resizeMobileInspector(90)

  const currentIndex = () => detents.indexOf(Number(mobileInspectorResize.getAttribute("aria-valuenow")) as typeof detents[number])
  const step = (amount: number) => resizeMobileInspector(detents[Math.max(0, Math.min(2, currentIndex() + amount))])
  let drag: { id: number; y: number; height: number; moved: boolean } | undefined
  let suppressClick = false
  let clickTimer = 0
  let dragFrame = 0
  let dragHeight = 0
  mobileInspectorResize.addEventListener("pointerdown", event => {
    if (!event.isPrimary || event.button !== 0 || !mobilePortraitQuery.matches) return
    suppressClick = false
    drag = { id: event.pointerId, y: event.clientY, height: inspectorPane.offsetTop, moved: false }
    mobileInspectorResize.setPointerCapture(event.pointerId)
  })
  mobileInspectorResize.addEventListener("pointermove", event => {
    if (!drag || drag.id !== event.pointerId) return
    const delta = event.clientY - drag.y
    if (!drag.moved && Math.abs(delta) < 8) return
    if (!drag.moved) {
      drag.moved = true
      clearTimeout(clickTimer)
      root.dataset.mobileDockDragging = ""
    }
    dragHeight = drag.height + delta
    if (!dragFrame) dragFrame = requestAnimationFrame(() => {
      dragFrame = 0
      root.style.setProperty("--_mobile-dock-drag", `${dragHeight}px`)
    })
  })
  const endDrag = (event: PointerEvent) => {
    if (!drag || drag.id !== event.pointerId) return
    suppressClick = drag.moved
    const delta = event.clientY - drag.y
    drag = undefined
    if (dragFrame) cancelAnimationFrame(dragFrame)
    dragFrame = 0
    delete root.dataset.mobileDockDragging
    root.style.removeProperty("--_mobile-dock-drag")
    if (event.type === "pointerup" && suppressClick && Math.abs(delta) >= 8) step(Math.sign(delta))
  }
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) mobileInspectorResize.addEventListener(type, endDrag)
  mobileInspectorResize.addEventListener("keydown", event => {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return
    event.preventDefault()
    clearTimeout(clickTimer)
    if (event.key === "Home" || event.key === "End") resizeMobileInspector(event.key === "Home" ? 32 : 90)
    else step(event.key === "ArrowUp" ? -1 : 1)
  })
  const toggle = () => resizeMobileInspector(currentIndex() === 2 ? 50 : 90)
  mobileInspectorResize.addEventListener("click", event => {
    if (event.detail === 0) toggle()
    else if (!suppressClick) {
      clearTimeout(clickTimer)
      const delay = cssTimeMs(getComputedStyle(root).getPropertyValue("--double-click-delay"))
      clickTimer = window.setTimeout(() => { if (root.dataset.mobileDock === "true") toggle() }, delay)
    }
    suppressClick = false
  })
  mobileInspectorResize.addEventListener("dblclick", () => {
    clearTimeout(clickTimer)
    resizeMobileInspector(32)
  })
}
