/*
 * 动效设计 / 粒子设计的桌面布局（DESIGN.md §10「动画资源」）：动画列表放在左侧栏（和图片资源一样），
 * 画布照常显示键盘布局，播放预览停靠在画布下方，检查器只留引用和参数。
 * 播放条默认按内容高度停靠，拖动上边缘可以改高（双击恢复默认），高度与位置只影响窗口，不写进皮肤。
 * 窄屏仍在检查器里自上而下排列，由 animation-inspector.ts 决定。
 */
import { element, iconButton } from "./dom-element.ts"
import { createIcon } from "./icons.ts"

const STAGE_HEIGHT_KEY = "animationStageHeightV1"
/** 播放条高度：未设置时随内容；拖动后是固定像素值。 */
const STAGE_HEIGHT_VAR = "--animation-stage-height"
/** 播放条实测高度，供播放条手柄和画布缩放控件定位。 */
const STAGE_OFFSET_VAR = "--animation-stage-offset"
const STAGE_MIN_HEIGHT = 160
const CANVAS_MIN_HEIGHT = 120
/** 工具栏 48 + 底部状态栏 30，都是动画工作区里固定高度的行。 */
const FIXED_ROWS_HEIGHT = 78

export type AnimationWorkspaceHosts = {
  /** The sidebar library body: actions and the list. */
  library: HTMLElement
  /** The strip docked under the keyboard canvas: the selected animation's title, player and warnings. */
  stage: HTMLElement
  /** The header: 动效设计 or 粒子设计, with the list's count. */
  setMode(particle: boolean, count: string): void
  /** Hides list rows that do not match the search box; re-run after the list is rebuilt. */
  filter(): void
}

const shared: { hosts?: AnimationWorkspaceHosts } = {}

/** Where the animation inspector puts its list and player, or nothing on narrow windows and other views. */
export function animationWorkspaceHosts(): AnimationWorkspaceHosts | undefined {
  return shared.hosts
}

export function createAnimationWorkspace(actions: { back(): void; relayout(): void }) {
  const sidebar = document.querySelector<HTMLElement>(".sidebar")!
  const workspace = document.querySelector<HTMLElement>(".workspace")!
  const library = element("section", "animation-library")
  library.id = "animation-library"
  const header = element("div", "animation-library-header")
  const title = element("strong")
  const count = element("span", "animation-library-count")
  header.append(iconButton("arrow-left", "返回布局", actions.back), title, count)
  const search = element("label", "ui-input")
  const searchInput = element("input")
  searchInput.type = "text"
  searchInput.setAttribute("role", "searchbox")
  searchInput.autocomplete = "off"
  searchInput.spellcheck = false
  const searchIcon = element("span", "ui-input-affix")
  searchIcon.append(createIcon("search", 14))
  search.append(searchIcon, searchInput)
  const body = element("div", "animation-library-body")
  library.append(header, search, body)
  sidebar.append(library)
  const stage = element("section", "animation-stage")
  stage.id = "animation-stage"
  stage.setAttribute("aria-label", "动画预览")
  const stageResize = element("div", "animation-stage-resize-handle")
  stageResize.setAttribute("aria-hidden", "true")
  stageResize.title = "拖动调整预览高度，双击恢复默认"
  workspace.append(stage, stageResize)

  /* —— 播放条高度：拖动上边缘改高，双击恢复随内容的高度 —— */
  const clampHeight = (height: number) =>
    Math.max(STAGE_MIN_HEIGHT, Math.min(workspace.clientHeight - FIXED_ROWS_HEIGHT - CANVAS_MIN_HEIGHT, height))
  const setStageHeight = (height: number) => workspace.style.setProperty(STAGE_HEIGHT_VAR, `${Math.round(clampHeight(height))}px`)
  const storedHeight = Number(localStorage.getItem(STAGE_HEIGHT_KEY))
  if (Number.isFinite(storedHeight) && storedHeight > 0) setStageHeight(storedHeight)
  new ResizeObserver(() => {
    workspace.style.setProperty(STAGE_OFFSET_VAR, `${Math.round(stage.getBoundingClientRect().height)}px`)
  }).observe(stage)
  let dragging = false
  let moved = false
  let startY = 0
  let startHeight = 0
  let pendingHeight: number | undefined
  // 拖动可能比刷新率更频繁：每帧只写一次，松开时才写 localStorage。
  const applyPending = () => {
    if (pendingHeight === undefined) return
    workspace.style.setProperty(STAGE_HEIGHT_VAR, `${pendingHeight}px`)
    workspace.style.setProperty(STAGE_OFFSET_VAR, `${pendingHeight}px`)
    pendingHeight = undefined
  }
  stageResize.addEventListener("pointerdown", (event) => {
    dragging = true
    moved = false
    startY = event.clientY
    startHeight = stage.getBoundingClientRect().height
    stageResize.classList.add("dragging")
    stageResize.setPointerCapture(event.pointerId)
    event.preventDefault()
  })
  stageResize.addEventListener("pointermove", (event) => {
    if (!dragging) return
    moved = true
    if (pendingHeight === undefined) requestAnimationFrame(applyPending)
    pendingHeight = Math.round(clampHeight(startHeight + startY - event.clientY))
  })
  const finishResize = () => {
    if (!dragging) return
    dragging = false
    stageResize.classList.remove("dragging")
    applyPending()
    if (!moved) return
    moved = false
    localStorage.setItem(STAGE_HEIGHT_KEY, String(Math.round(stage.getBoundingClientRect().height)))
  }
  stageResize.addEventListener("pointerup", finishResize)
  stageResize.addEventListener("pointercancel", finishResize)
  stageResize.addEventListener("dblclick", () => {
    pendingHeight = undefined
    workspace.style.removeProperty(STAGE_HEIGHT_VAR)
    localStorage.removeItem(STAGE_HEIGHT_KEY)
  })
  // 窗口变矮时把记住的高度夹回可用范围，不覆盖用户保存的值。
  window.addEventListener("resize", () => {
    const height = Number(localStorage.getItem(STAGE_HEIGHT_KEY))
    if (Number.isFinite(height) && height > 0) setStageHeight(height)
  })

  const filter = () => {
    const query = searchInput.value.trim().toLowerCase()
    for (const option of body.querySelectorAll<HTMLElement>("[data-animation-id]")) {
      option.hidden = Boolean(query) && !option.textContent!.toLowerCase().includes(query)
    }
  }
  searchInput.addEventListener("input", filter)
  searchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !searchInput.value) return
    event.stopPropagation()
    searchInput.value = ""
    filter()
  })
  const hosts: AnimationWorkspaceHosts = {
    library: body,
    stage,
    setMode(particle, total) {
      const noun = particle ? "粒子" : "动效"
      title.textContent = `${noun}设计`
      count.textContent = total
      searchInput.placeholder = `搜索${noun}`
      searchInput.setAttribute("aria-label", `搜索${noun}`)
      library.setAttribute("aria-label", `${noun}设计`)
    },
    filter,
  }
  const media = matchMedia("(min-width: 1000px)")
  let wanted = false
  const apply = () => {
    const active = wanted && media.matches
    document.body.classList.toggle("animation-workspace", active)
    if (active === Boolean(shared.hosts)) return
    shared.hosts = active ? hosts : undefined
    if (!active) {
      body.replaceChildren()
      stage.replaceChildren()
      searchInput.value = ""
    }
  }
  media.addEventListener("change", () => {
    if (!wanted) return
    apply()
    actions.relayout()
  })
  /** Called before each inspector rebuild: on while 动效设计 / 粒子设计 is shown without a key selection. */
  return {
    update(active: boolean) {
      wanted = active
      apply()
    },
  }
}
