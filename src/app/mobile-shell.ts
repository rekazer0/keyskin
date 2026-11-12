// 移动端 App 外壳：底部标签栏切换三个页面（画布 / 属性 / 文件），以及页面区的左右滑动。
import { mainWorkspace, mobileTabButtons, sidebarPane, inspectorPane, workspacePane } from "./dom"
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

function keyboardOpen(): boolean {
  return document.documentElement.dataset.keyboardOpen === "true"
}

function currentTab(): MobileTab {
  const tab = document.documentElement.dataset.mobileTab
  return tab === "inspector" || tab === "files" ? tab : "canvas"
}

/** 切页的唯一入口：写 dataset、更新标签栏选中态、把隐藏页面设为 inert。 */
export function setMobileTab(tab: MobileTab): void {
  const root = document.documentElement
  const changed = Boolean(root.dataset.mobileTab) && root.dataset.mobileTab !== tab
  root.dataset.mobileTab = tab
  for (const button of mobileTabButtons) {
    if (button.dataset.mobileTab === tab) button.setAttribute("aria-current", "page")
    else button.removeAttribute("aria-current")
  }
  // 桌面三栏同时可见，不分页，也不设 inert。
  const mobile = mobileShellQuery.matches
  for (const name of TABS) pages[name].inert = mobile && name !== tab
  if (changed) playEnter(pages[tab])
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
    // 画布有自己的双指缩放、平移和按键拖动；表单控件也不接管横向滑动。
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
  // 进出移动端断点时重新写 inert：桌面清掉，移动端给隐藏页面补上。
  mobileShellQuery.addEventListener("change", () => setMobileTab(currentTab()))
}
