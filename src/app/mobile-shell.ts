// 移动端 App 外壳：画布页内「画布 + 属性」分屏、底部标签栏的页面切换，以及页面区的左右滑动。
import { mainWorkspace, mobileSplitHandle, mobileTabButtons, sidebarPane, inspectorPane, workspacePane } from "./dom"
import { appState } from "./state"
import { mobileShellQuery } from "./mobile-media"
import { playEnter } from "../motion"

export { mobileShellQuery }

export type MobileTab = "canvas" | "inspector" | "files"

/** 标签栏顺序；左右滑动只能切到相邻的一页，到头不循环。 */
const TABS: readonly MobileTab[] = ["canvas", "inspector", "files"]

/** 每个标签对应的页面。三者共用 main 的同一格，非当前页由 CSS 隐藏。 */
const pages: Record<MobileTab, HTMLElement> = {
  canvas: workspacePane,
  inspector: inspectorPane,
  files: sidebarPane,
}

const SWIPE_MIN_DISTANCE = 56
const SWIPE_HORIZONTAL_RATIO = 1.2
const SPLIT_KEY = "mobile-editor-split"
const SPLIT_DEFAULT = 46
const SPLIT_MIN = 30
const SPLIT_MAX = 70

function keyboardOpen(): boolean {
  return document.documentElement.dataset.keyboardOpen === "true"
}

function currentTab(): MobileTab {
  const tab = document.documentElement.dataset.mobileTab
  return tab === "inspector" || tab === "files" ? tab : "canvas"
}

/** 当前真正可见的页面：画布页在编辑模式下同时包含下方属性。 */
function visiblePages(): Set<MobileTab> {
  const tab = currentTab()
  const visible = new Set<MobileTab>([tab])
  if (tab === "canvas" && document.documentElement.dataset.canvasMode === "edit") visible.add("inspector")
  return visible
}

/** 页面显示 / 编辑模式变化后同步标签选中态与 inert（分屏里两页都可操作）。 */
export function syncMobileShellState(): void {
  const tab = currentTab()
  for (const button of mobileTabButtons) {
    if (button.dataset.mobileTab === tab) button.setAttribute("aria-current", "page")
    else button.removeAttribute("aria-current")
  }
  // 桌面三栏同时可见，不分页，也不设 inert。
  const mobile = mobileShellQuery.matches
  const visible = visiblePages()
  for (const name of TABS) pages[name].inert = mobile && !visible.has(name)
}

/** 切页的唯一入口：写 dataset、更新标签栏选中态、把不可见页面设为 inert。 */
export function setMobileTab(tab: MobileTab): void {
  const root = document.documentElement
  const changed = Boolean(root.dataset.mobileTab) && root.dataset.mobileTab !== tab
  root.dataset.mobileTab = tab
  syncMobileShellState()
  if (changed) playEnter(pages[tab])
}

/** 画布页下方的属性高度（占页面区百分比）。拖动条、键盘方向键都走这里。 */
export function setMobileSplit(value: number, persist = true): void {
  const split = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, Math.round(value)))
  document.documentElement.style.setProperty("--mobile-editor-split", `${split}%`)
  mobileSplitHandle.setAttribute("aria-valuenow", String(split))
  mobileSplitHandle.setAttribute("aria-valuetext", `属性占 ${split}%`)
  if (persist) localStorage.setItem(SPLIT_KEY, String(split))
}

/** 拖动分割线：手指移动时只改几何值，松手才写入本地偏好。 */
function initMobileSplit(): void {
  setMobileSplit(Number(localStorage.getItem(SPLIT_KEY)) || SPLIT_DEFAULT, false)
  let pointerId = -1
  mobileSplitHandle.addEventListener("pointerdown", (event) => {
    if (!mobileShellQuery.matches) return
    pointerId = event.pointerId
    mobileSplitHandle.setPointerCapture(pointerId)
    event.preventDefault()
  })
  mobileSplitHandle.addEventListener("pointermove", (event) => {
    if (pointerId !== event.pointerId) return
    const main = mainWorkspace.getBoundingClientRect()
    if (!main.height) return
    setMobileSplit(((main.bottom - event.clientY) / main.height) * 100, false)
  })
  const finish = (event: PointerEvent) => {
    if (pointerId !== event.pointerId) return
    pointerId = -1
    if (mobileSplitHandle.hasPointerCapture(event.pointerId)) mobileSplitHandle.releasePointerCapture(event.pointerId)
    setMobileSplit(Number(mobileSplitHandle.getAttribute("aria-valuenow")) || SPLIT_DEFAULT)
  }
  mobileSplitHandle.addEventListener("pointerup", finish)
  mobileSplitHandle.addEventListener("pointercancel", finish)
  mobileSplitHandle.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
    event.preventDefault()
    const current = Number(mobileSplitHandle.getAttribute("aria-valuenow")) || SPLIT_DEFAULT
    setMobileSplit(current + (event.key === "ArrowUp" ? 2 : -2))
  })
}

/** 达到滑动阈值就切到相邻标签；方向以「画布 · 属性 · 文件」的顺序为准。 */
function switchBySwipe(deltaX: number, deltaY: number): void {
  if (Math.abs(deltaX) < SWIPE_MIN_DISTANCE || Math.abs(deltaX) < Math.abs(deltaY) * SWIPE_HORIZONTAL_RATIO) return
  if (!appState.archive || keyboardOpen()) return
  const next = TABS[TABS.indexOf(currentTab()) + (deltaX < 0 ? 1 : -1)]
  if (next) setMobileTab(next)
}

export function initMobileShell(): void {
  setMobileTab(currentTab())
  for (const button of mobileTabButtons) {
    const tab = button.dataset.mobileTab
    button.addEventListener("click", () => setMobileTab(tab === "inspector" || tab === "files" ? tab : "canvas"))
  }
  // 页面区左右滑动：只认触摸与笔（鼠标拖动留给画布），竖向滚动不抢。
  mainWorkspace.addEventListener("pointerdown", (event) => {
    if (!mobileShellQuery.matches || event.pointerType === "mouse" || event.button !== 0) return
    if (!appState.archive || keyboardOpen()) return
    // 画布页里画布和属性同屏，横向手势留给编辑；只在属性页 / 文件页翻页。
    if (currentTab() === "canvas") return
    if ((event.target as Element | null)?.closest?.(".canvas-wrap, input, textarea, select, .cm-editor")) return
    appState.mobileSwipeStart = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
  })
  mainWorkspace.addEventListener("pointermove", (event) => {
    const start = appState.mobileSwipeStart
    if (!start || start.pointerId !== event.pointerId) return
    const deltaX = event.clientX - start.x
    const deltaY = event.clientY - start.y
    if (Math.abs(deltaY) > 12 && Math.abs(deltaY) > Math.abs(deltaX)) {
      appState.mobileSwipeStart = undefined
      return
    }
    if (Math.abs(deltaX) < SWIPE_MIN_DISTANCE || Math.abs(deltaX) < Math.abs(deltaY) * SWIPE_HORIZONTAL_RATIO) return
    appState.mobileSwipeStart = undefined
    switchBySwipe(deltaX, deltaY)
  })
  mainWorkspace.addEventListener("pointerup", (event) => {
    const start = appState.mobileSwipeStart
    if (!start || start.pointerId !== event.pointerId) return
    appState.mobileSwipeStart = undefined
    switchBySwipe(event.clientX - start.x, event.clientY - start.y)
  })
  mainWorkspace.addEventListener("pointercancel", (event) => {
    if (appState.mobileSwipeStart?.pointerId === event.pointerId) appState.mobileSwipeStart = undefined
  })
  initMobileSplit()
  // 进出移动端断点时重新写 inert：桌面清掉，移动端给隐藏页面补上。
  mobileShellQuery.addEventListener("change", () => setMobileTab(currentTab()))
}
