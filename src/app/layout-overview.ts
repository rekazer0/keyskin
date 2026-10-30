import { appState } from "./state"
import { canvasWrap, candidateArea, deviceShell, editorCrosshair, files, layoutOverview, layoutOverviewGrid, layoutOverviewToggle, mode, orientation, previewCanvas, previewZoomIn, previewZoomOut, theme } from "./dom"
import { currentDeviceValue, preview, toolbarPreview } from "./canvas-interaction"
import { applyPreviewZoom, keyboardSnapshot, setPreviewPan } from "./preview-render"
import { selectChoice } from "./mobile-layout"

// 全局预览：概览里的每个布局按原分辨率截图，排成正方形网格，数量不足的格子留空。
// 当前格子放的是真正的画布（按交互预览响应点击），其余格子是截图；空格进入当前布局。

type Overview = NonNullable<typeof appState.layoutOverview>

const layoutButtons = () => Array.from(files.querySelectorAll<HTMLButtonElement>(
  `.sidebar-overview :is(.nav-layout, [data-overview-group="数字与符号"] .nav-item)`,
))
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
// getAnimations() 会先刷新样式，刚改的过渡也会被等到；时长为 0（减弱动效）时立即完成。
const settle = (element: Element) => Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => undefined)))
const cells = () => Array.from(layoutOverviewGrid.children) as HTMLElement[]
const frameOf = (index: number) => cells()[index]?.querySelector<HTMLElement>(".layout-overview-frame")
const current = (state: Overview) => appState.layoutOverview === state && !state.closing
const drawn = () => Promise.all([preview.whenDrawn(), toolbarPreview.whenDrawn()]).catch(() => undefined)
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
// 截图都在交互预览下画，与模式无关；皮肤状态（skinState）随布局变化，不算在内。皮肤改动（revision）单独比较。
const cacheKey = () => [theme.value, orientation.value, currentDeviceValue()].join("|")

const transform = (state: Overview) => `translate(${state.x}px, ${state.y}px) scale(${state.zoom})`

function place(state: Overview, instant = false): void {
  clearTimeout(state.settleTimer)
  // 放大前先按目标倍率重新排版（手势时多放大一些，少排几次），transform 始终 ≤ 1，过渡和手势全程清晰。
  const visual = state.zoom * state.scale
  if (visual > state.scale * 1.01) relayout(state, Math.min(state.maxZoom, visual * (instant ? 1.5 : 1)))
  // 手势期间网格单独合成、跟手移动；停手（或过渡结束）后撤掉合成层，排版太大时缩回来。
  layoutOverviewGrid.toggleAttribute("data-instant", instant)
  layoutOverviewGrid.style.transform = transform(state)
  const wait = instant ? 250 : parseFloat(getComputedStyle(layoutOverviewGrid).transitionDuration) * 1000 + 50
  state.settleTimer = setTimeout(() => settleScale(state), wait)
}

/**
 * 按 scale 重新排版（--_scale），transform 同时缩小同样倍数，画面不动。
 * WebKit 把合成层按 1 倍栅格化，靠 transform 放大会糊，所以排版跟着显示倍率走，transform 只缩小。
 */
function relayout(state: Overview, scale: number): void {
  // 过渡途中按此刻实际显示的位置接着走，不跳回上一个目标。
  const shown = new DOMMatrix(getComputedStyle(layoutOverviewGrid).transform)
  const ratio = state.scale / scale
  state.zoom *= ratio
  state.scale = scale
  layoutOverviewGrid.toggleAttribute("data-instant", true)
  layoutOverviewGrid.style.setProperty("--_scale", String(scale))
  layoutOverviewGrid.style.transform = `translate(${shown.e}px, ${shown.f}px) scale(${shown.a * ratio})`
  void layoutOverviewGrid.offsetWidth
  layoutOverviewGrid.removeAttribute("data-instant")
  fitLiveKeyboard()
}

/** 停手后：缩小了很多就把排版缩回来，拖动的合成层不会太大。 */
function settleScale(state: Overview): void {
  layoutOverviewGrid.removeAttribute("data-instant")
  if (!current(state)) return
  const scale = Math.max(1, state.zoom * state.scale)
  if (state.scale > scale * 1.6) relayout(state, scale)
}

/** 画布上键盘（候选栏顶到面板底）在屏幕上的位置。 */
function keyboardRect(): { left: number; top: number; width: number } {
  const panel = previewCanvas.getBoundingClientRect()
  const top = candidateArea.hidden ? panel.top : Math.min(panel.top, candidateArea.getBoundingClientRect().top)
  return { left: panel.left, top, width: panel.width }
}

/** 移动缩放网格，让第 index 格正好盖在 target 上。 */
function alignCell(state: Overview, index: number, target: { left: number; top: number; width: number }): void {
  const from = frameOf(index)?.getBoundingClientRect()
  if (!from?.width) return
  const box = layoutOverview.getBoundingClientRect()
  const localX = (from.left - box.left - state.x) / state.zoom
  const localY = (from.top - box.top - state.y) / state.zoom
  state.zoom *= target.width / from.width
  state.x = target.left - box.left - localX * state.zoom
  state.y = target.top - box.top - localY * state.zoom
}

function showSnapshot(index: number, snapshot: HTMLCanvasElement | undefined): void {
  const frame = frameOf(index)
  if (!frame) return
  if (snapshot) {
    const previous = frame.querySelector(":scope > canvas")
    previous?.remove()
    frame.prepend(snapshot)
    // 旧截图换成新的，不再弹一次。
    if (previous) snapshot.getAnimations().forEach((animation) => animation.finish())
  } else {
    cells()[index].querySelector(".layout-overview-label")!.textContent += " · 无法预览"
  }
}

function focusCell(state: Overview, index: number): void {
  state.index = index
  for (const [i, cell] of cells().entries()) cell.ariaSelected = String(i === index)
}

/** 把画布上的键盘（候选栏顶到面板底）缩放对齐到当前格子。 */
export function fitLiveKeyboard(): void {
  const state = appState.layoutOverview
  const frame = state?.live.parentElement
  if (!state || !frame) return
  state.live.style.transform = "none"
  const box = state.live.getBoundingClientRect()
  const scale = box.width / state.live.offsetWidth || 1
  const keyboard = keyboardRect()
  const fit = frame.offsetWidth / (keyboard.width / scale)
  state.live.style.transform = `scale(${fit}) translate(${(box.left - keyboard.left) / scale}px, ${(box.top - keyboard.top) / scale}px)`
}

/** 让第 index 格变成真正的画布：切到它的布局，画好后再从截图换成实时画布。 */
async function goLive(state: Overview, index: number): Promise<void> {
  focusCell(state, index)
  const frame = frameOf(index)
  const path = cells()[index]?.dataset.path
  const button = layoutButtons().find((candidate) => candidate.dataset.path === path)
  if (!frame || !button) return
  state.live.parentElement?.removeAttribute("data-live")
  frame.dataset.live = "pending"
  frame.append(state.live)
  if (appState.layoutPath !== path) button.click()
  await drawn()
  if (state.index !== index || !current(state) || state.capturing) return
  fitLiveKeyboard()
  frame.dataset.live = "ready"
}

export function selectLayoutCell(index: number): void {
  const state = appState.layoutOverview
  if (state && current(state) && index !== state.index && cells()[index]) void goLive(state, index)
}

export function fitLayoutOverview(instant = false): void {
  const state = appState.layoutOverview
  if (!state) return
  const width = layoutOverviewGrid.offsetWidth
  const height = layoutOverviewGrid.offsetHeight
  state.zoom = Math.min((layoutOverview.clientWidth - 64) / width, (layoutOverview.clientHeight - 64) / height)
  state.x = (layoutOverview.clientWidth - width * state.zoom) / 2
  state.y = (layoutOverview.clientHeight - height * state.zoom) / 2
  state.touched = false
  state.idleAt = 0
  place(state, instant)
}

export function zoomLayoutOverview(factor: number, anchor?: { x: number; y: number }, instant = false): void {
  const state = appState.layoutOverview
  if (!state) return
  const bounds = layoutOverview.getBoundingClientRect()
  const x = (anchor?.x ?? bounds.left + bounds.width / 2) - bounds.left
  const y = (anchor?.y ?? bounds.top + bounds.height / 2) - bounds.top
  // 最大放大到截图的原生分辨率（与画布的位图一致），再放大只会变糊；倍率按排版前的尺寸算。
  const zoom = Math.min(state.maxZoom / state.scale, Math.max(0.05 / state.scale, state.zoom * factor))
  state.x = x - (x - state.x) * zoom / state.zoom
  state.y = y - (y - state.y) * zoom / state.zoom
  state.zoom = zoom
  state.touched = true
  state.idleAt = performance.now() + 250
  place(state, instant)
}

export function panLayoutOverview(x: number, y: number): void {
  const state = appState.layoutOverview
  if (!state) return
  Object.assign(state, { x, y, touched: true, idleAt: performance.now() + 250 })
  place(state, true)
}

/** 全局预览里移动当前格子；平时直接切到前一个 / 后一个布局。 */
export function stepLayout(dx: number, dy: number): void {
  const state = appState.layoutOverview
  if (state) {
    selectLayoutCell(state.index + dx + dy * state.columns)
    return
  }
  const buttons = layoutButtons()
  if (!buttons.length) return
  const index = buttons.findIndex((button) => button.dataset.path === appState.layoutPath)
  buttons[(index + (dx || dy) + buttons.length) % buttons.length].click()
}

export async function openLayoutOverview(): Promise<void> {
  if (appState.layoutOverview || !appState.archive) return
  const buttons = layoutButtons()
  if (!buttons.length) return
  appState.layoutOverviewReturn = false
  const originIndex = buttons.findIndex((button) => button.dataset.path === appState.layoutPath)
  const columns = Math.ceil(Math.sqrt(buttons.length))
  const live = document.createElement("span")
  live.className = "layout-overview-live"
  const state: Overview = {
    index: Math.max(0, originIndex), columns, zoom: 1, scale: 1, x: 0, y: 0, maxZoom: 4, touched: false, capturing: false, idleAt: 0, closing: false,
    mode: mode.value, previewPan: { x: appState.previewPanX, y: appState.previewPanY }, home: deviceShell.nextSibling, live,
  }
  appState.layoutOverview = state
  // 全局预览里没有十字线浮层，画布要显示系统光标。
  preview.setCrosshair(false)
  toolbarPreview.setCrosshair(false)
  layoutOverviewGrid.style.setProperty("--_columns", String(columns))
  layoutOverviewGrid.style.removeProperty("--_scale")
  layoutOverviewGrid.replaceChildren(...buttons.map((button, index) => {
    const cell = document.createElement("div")
    cell.className = "layout-overview-cell"
    cell.role = "option"
    cell.dataset.path = button.dataset.path
    const frame = document.createElement("span")
    frame.className = "layout-overview-frame"
    const label = document.createElement("span")
    label.className = "layout-overview-label"
    label.textContent = button.querySelector(".nav-label")?.textContent ?? ""
    cell.append(frame, label)
    cell.addEventListener("click", () => { if (!state.pan?.moved) selectLayoutCell(index) })
    return cell
  }))
  focusCell(state, state.index)
  layoutOverviewToggle.ariaPressed = "true"
  previewZoomOut.disabled = previewZoomIn.disabled = false
  // 全局预览里的画布按交互预览响应点击，进入布局时恢复原来的模式。
  selectChoice(mode, "preview")
  const key = cacheKey()
  const revision = appState.archive.revision
  const cached = appState.layoutOverviewCache?.archive === appState.archive && appState.layoutOverviewCache.key === key
    ? appState.layoutOverviewCache
    : undefined
  // 皮肤改过：先摆上次的截图，再逐个重截替换，不用从空格子等起。
  const stale = cached?.revision !== revision ? cached?.snapshots : undefined
  const cache = cached && !stale ? cached : appState.layoutOverviewCache = { archive: appState.archive, key, revision, snapshots: new Map() }
  for (const [index, button] of buttons.entries()) {
    const path = button.dataset.path ?? ""
    const snapshot = cache.snapshots.get(path) ?? stale?.get(path)
    if (snapshot) showSnapshot(index, snapshot)
  }
  // 画布上现成的布局直接截，空格子按它的比例占位。
  if (originIndex >= 0) {
    await drawn()
    const first = keyboardSnapshot()
    if (first) {
      cache.snapshots.set(buttons[originIndex].dataset.path ?? "", first)
      layoutOverviewGrid.style.setProperty("--_aspect", String(first.width / first.height))
      showSnapshot(originIndex, first)
    }
  }
  // 进入动画从画布上键盘的位置开始，先记下它。
  const keyboard = originIndex >= 0 ? keyboardRect() : undefined
  setPreviewPan(0, 0)
  live.append(deviceShell)
  frameOf(state.index)?.append(live)
  frameOf(state.index)?.setAttribute("data-live", "pending")
  // 与进入布局相反：只有当前格子正好盖在画布的键盘上，网格从这里缩小到全貌，其余格子淡入。
  layoutOverview.dataset.entering = ""
  layoutOverview.hidden = false
  frameOf(state.index)?.querySelector("canvas")?.getAnimations().forEach((animation) => animation.finish())
  const snapshotWidth = layoutOverviewGrid.querySelector<HTMLCanvasElement>(".layout-overview-frame > canvas")?.width
  if (snapshotWidth) state.maxZoom = snapshotWidth / devicePixelRatio / (frameOf(0)?.offsetWidth || 1)
  fitLayoutOverview(true)
  if (keyboard) {
    alignCell(state, state.index, keyboard)
    place(state, true)
  }
  canvasWrap.dataset.layoutOverview = ""
  void layoutOverview.offsetWidth
  delete layoutOverview.dataset.entering
  fitLayoutOverview()
  // 从当前格子附近开始截。
  const missing = buttons.filter((button) => !cache.snapshots.has(button.dataset.path ?? ""))
    .sort((a, b) => Math.abs(buttons.indexOf(a) - state.index) - Math.abs(buttons.indexOf(b) - state.index))
  state.capturing = true
  for (const button of missing) {
    while (current(state) && performance.now() < state.idleAt) await pause(60)
    if (!current(state)) return
    const path = button.dataset.path ?? ""
    button.click()
    const snapshot = appState.layoutPath === path ? (await drawn(), keyboardSnapshot()) : undefined
    if (snapshot) cache.snapshots.set(path, snapshot)
    if (appState.layoutOverview !== state) return
    showSnapshot(buttons.indexOf(button), snapshot)
  }
  state.capturing = false
  if (!current(state)) return
  // 截图比占位高时网格会变大；用户还没缩放或拖动过就重新适配。
  if (missing.length && !state.touched) fitLayoutOverview()
  await goLive(state, state.index)
}

/** 开始退出：停掉截图，切到当前格子的布局。 */
function beginClose(state: Overview): string | undefined {
  state.closing = true
  // 截图途中进入时检查器还没重建，即使布局没变也要重新选中一次。
  const rebuild = state.capturing
  state.capturing = false
  const path = cells()[state.index]?.dataset.path
  const button = layoutButtons().find((candidate) => candidate.dataset.path === path)
  if (button && (appState.layoutPath !== path || rebuild)) button.click()
  return path
}

/** 把画布交还编辑器，恢复打开前的模式与位置。 */
function restoreCanvas(state: Overview): void {
  state.live.parentElement?.removeAttribute("data-live")
  canvasWrap.insertBefore(deviceShell, state.home)
  state.live.remove()
  setPreviewPan(state.previewPan.x, state.previewPan.y)
  selectChoice(mode, state.mode)
}

function finishClose(): void {
  delete canvasWrap.dataset.layoutOverview
  layoutOverview.hidden = true
  delete layoutOverview.dataset.closing
  layoutOverviewGrid.replaceChildren()
  appState.layoutOverview = undefined
  preview.setCrosshair(editorCrosshair.checked)
  toolbarPreview.setCrosshair(editorCrosshair.checked)
  layoutOverviewToggle.ariaPressed = "false"
  applyPreviewZoom(appState.previewZoom)
}

/** 立即退出全局预览，不做动画（回到启动页、打开别的皮肤时）。 */
export function dismissLayoutOverview(): void {
  const state = appState.layoutOverview
  if (!state || state.closing) return
  beginClose(state)
  restoreCanvas(state)
  finishClose()
}

/** 进入当前格子的布局：画布放回原处，网格放大到画布上键盘的位置后交叉淡出。 */
export async function closeLayoutOverview(): Promise<void> {
  const state = appState.layoutOverview
  if (!state || state.closing) return
  const index = state.index
  const path = beginClose(state)
  await drawn()
  // 换成实时画布此刻的样子，再把画布交还编辑器。
  const snapshot = keyboardSnapshot()
  if (snapshot && path && appState.layoutOverviewCache) appState.layoutOverviewCache.snapshots.set(path, snapshot)
  showSnapshot(index, snapshot)
  restoreCanvas(state)
  layoutOverview.dataset.closing = ""
  const target = frameOf(index)?.querySelector("canvas")
  if (target) {
    await nextFrame()
    await drawn()
    await nextFrame()
    alignCell(state, index, keyboardRect())
    place(state)
    await settle(layoutOverviewGrid)
  }
  delete canvasWrap.dataset.layoutOverview
  await settle(layoutOverview)
  finishClose()
  appState.layoutOverviewReturn = true
}
