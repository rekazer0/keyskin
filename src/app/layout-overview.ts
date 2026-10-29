import { appState } from "./state"
import { canvasWrap, candidateArea, deviceShell, files, layoutOverview, layoutOverviewGrid, layoutOverviewToggle, mode, orientation, previewCanvas, previewZoomIn, previewZoomOut, theme } from "./dom"
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
// 截图都在交互预览下画，与模式无关；皮肤状态（skinState）随布局变化，不算在内。
const cacheKey = () => [appState.archive?.revision, theme.value, orientation.value, currentDeviceValue()].join("|")

function place(state: Overview, instant = false): void {
  // 手势期间网格单独合成、跟手移动；停手后撤掉合成层，让浏览器按当前倍率重新清晰地栅格化。
  clearTimeout(state.settleTimer)
  layoutOverviewGrid.toggleAttribute("data-instant", instant)
  if (instant) state.settleTimer = setTimeout(() => layoutOverviewGrid.removeAttribute("data-instant"), 250)
  layoutOverviewGrid.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.zoom})`
}

function showSnapshot(index: number, snapshot: HTMLCanvasElement | undefined): void {
  const frame = frameOf(index)
  if (!frame) return
  if (snapshot) {
    frame.querySelector(":scope > canvas")?.remove()
    frame.prepend(snapshot)
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
  const panel = previewCanvas.getBoundingClientRect()
  const top = candidateArea.hidden ? panel.top : Math.min(panel.top, candidateArea.getBoundingClientRect().top)
  const fit = frame.offsetWidth / (panel.width / scale)
  state.live.style.transform = `scale(${fit}) translate(${(box.left - panel.left) / scale}px, ${(box.top - top) / scale}px)`
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
  // 最大放大到截图的原生分辨率（与画布的位图一致），再放大只会变糊。
  const zoom = Math.min(state.maxZoom, Math.max(0.05, state.zoom * factor))
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
    index: Math.max(0, originIndex), columns, zoom: 1, x: 0, y: 0, maxZoom: 4, touched: false, capturing: false, idleAt: 0, closing: false,
    mode: mode.value, previewPan: { x: appState.previewPanX, y: appState.previewPanY }, home: deviceShell.nextSibling, live,
  }
  appState.layoutOverview = state
  layoutOverviewGrid.style.setProperty("--_columns", String(columns))
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
  const cached = appState.layoutOverviewCache
  const cache = cached?.archive === appState.archive && cached.key === key
    ? cached
    : appState.layoutOverviewCache = { archive: appState.archive, key, snapshots: new Map() }
  for (const [index, button] of buttons.entries()) {
    const snapshot = cache.snapshots.get(button.dataset.path ?? "")
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
  setPreviewPan(0, 0)
  live.append(deviceShell)
  frameOf(state.index)?.append(live)
  frameOf(state.index)?.setAttribute("data-live", "pending")
  layoutOverview.hidden = false
  const snapshotWidth = layoutOverviewGrid.querySelector<HTMLCanvasElement>(".layout-overview-frame > canvas")?.width
  if (snapshotWidth) state.maxZoom = snapshotWidth / devicePixelRatio / (frameOf(0)?.offsetWidth || 1)
  fitLayoutOverview(true)
  // 从稍小处放大进入，同时淡出画布原位置。
  zoomLayoutOverview(0.92, undefined, true)
  void layoutOverview.offsetWidth
  canvasWrap.dataset.layoutOverview = ""
  fitLayoutOverview()
  const missing = buttons.filter((button) => !cache.snapshots.has(button.dataset.path ?? ""))
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

/** 进入当前格子的布局：画布放回原处，网格放大到画布上键盘的位置后交叉淡出。 */
export async function closeLayoutOverview(): Promise<void> {
  const state = appState.layoutOverview
  if (!state || state.closing) return
  state.closing = true
  // 截图途中进入时检查器还没重建，即使布局没变也要重新选中一次。
  const rebuild = state.capturing
  state.capturing = false
  const index = state.index
  const path = cells()[index]?.dataset.path
  const button = layoutButtons().find((candidate) => candidate.dataset.path === path)
  if (button && (appState.layoutPath !== path || rebuild)) button.click()
  await drawn()
  // 换成实时画布此刻的样子，再把画布交还编辑器。
  const snapshot = keyboardSnapshot()
  if (snapshot && path && appState.layoutOverviewCache) appState.layoutOverviewCache.snapshots.set(path, snapshot)
  showSnapshot(index, snapshot)
  state.live.parentElement?.removeAttribute("data-live")
  canvasWrap.insertBefore(deviceShell, state.home)
  state.live.remove()
  setPreviewPan(state.previewPan.x, state.previewPan.y)
  selectChoice(mode, state.mode)
  layoutOverview.dataset.closing = ""
  const target = frameOf(index)?.querySelector("canvas")
  if (target) {
    await nextFrame()
    await drawn()
    await nextFrame()
    const from = target.getBoundingClientRect()
    const panel = previewCanvas.getBoundingClientRect()
    const top = candidateArea.hidden ? panel.top : Math.min(panel.top, candidateArea.getBoundingClientRect().top)
    const box = layoutOverview.getBoundingClientRect()
    const localX = (from.left - box.left - state.x) / state.zoom
    const localY = (from.top - box.top - state.y) / state.zoom
    state.zoom *= panel.width / from.width
    state.x = panel.left - box.left - localX * state.zoom
    state.y = top - box.top - localY * state.zoom
    place(state)
    await settle(layoutOverviewGrid)
  }
  delete canvasWrap.dataset.layoutOverview
  await settle(layoutOverview)
  layoutOverview.hidden = true
  delete layoutOverview.dataset.closing
  layoutOverviewGrid.replaceChildren()
  appState.layoutOverview = undefined
  appState.layoutOverviewReturn = true
  layoutOverviewToggle.ariaPressed = "false"
  applyPreviewZoom(appState.previewZoom)
}
