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
const STAGE_HEIGHT_VAR = "--_animation-stage-height"
/** 播放条实测高度，供播放条手柄和画布缩放控件定位。 */
const STAGE_OFFSET_VAR = "--_animation-stage-offset"
const STAGE_MIN_HEIGHT = 160
const CANVAS_MIN_HEIGHT = 120
/** 工具栏 48 + 底部状态栏 30，都是动画工作区里固定高度的行。 */
const FIXED_ROWS_HEIGHT = 78

export type AnimationWorkspaceHosts = {
  /** The sidebar library body: actions and the animation list. */
  library: HTMLElement
  /** The second list: the styles (BDA targets) that play the animations here. */
  styles: HTMLElement
  /** The strip docked under the keyboard canvas: the selected animation's title, player and warnings. */
  stage: HTMLElement
  /** The header: 动效设计 or 粒子设计, with the list's count. */
  setMode(particle: boolean, count: string): void
  /** Names the second list (样式 / 目标) with its count; `undefined` hides its switch. */
  setStyles(noun: string | undefined, count: number): void
  /** Switches the left column between the animation list and the style list. */
  show(list: AnimationList): void
  /** Hides list rows that do not match the search box; re-run after the list is rebuilt. */
  filter(): void
}

export type AnimationList = "animations" | "styles"

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
  /* —— 左栏分两份列表：动画 与 样式，用分段开关切换 —— */
  const tabs = element("div", "ui-segmented animation-library-tabs")
  tabs.dataset.fill = ""
  tabs.setAttribute("role", "group")
  tabs.setAttribute("aria-label", "左侧列表")
  const bodies: Record<AnimationList, HTMLElement> = {
    animations: element("div", "animation-library-pane"),
    styles: element("div", "animation-library-pane"),
  }
  const tabButtons = { animations: tab("animations", "动画"), styles: tab("styles", "样式") }
  const body = element("div", "animation-library-body")
  body.append(bodies.animations, bodies.styles)
  library.append(header, search, tabs, body)
  sidebar.append(library)
  const stage = element("section", "animation-stage")
  stage.id = "animation-stage"
  stage.setAttribute("aria-label", "动画预览")
  const stageResize = element("button", "animation-stage-resize-handle")
  stageResize.type = "button"
  stageResize.setAttribute("aria-label", "调整动画预览高度")
  stageResize.setAttribute("role", "slider")
  stageResize.setAttribute("aria-orientation", "vertical")
  stageResize.setAttribute("aria-valuemin", String(STAGE_MIN_HEIGHT))
  stageResize.title = "拖动调整预览高度；方向键调整，双击恢复默认"
  workspace.append(stage, stageResize)

  /* —— 播放条高度：拖动上边缘改高，双击恢复随内容的高度 —— */
  const clampHeight = (height: number) => Math.max(STAGE_MIN_HEIGHT, Math.min(workspace.clientHeight - FIXED_ROWS_HEIGHT - CANVAS_MIN_HEIGHT, height))
  const setStageHeight = (height: number) => {
    const value = Math.round(clampHeight(height))
    workspace.style.setProperty(STAGE_HEIGHT_VAR, `${value}px`)
    stageResize.setAttribute("aria-valuemax", String(Math.max(STAGE_MIN_HEIGHT, workspace.clientHeight - FIXED_ROWS_HEIGHT - CANVAS_MIN_HEIGHT)))
    stageResize.setAttribute("aria-valuenow", String(value))
  }
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
  stageResize.addEventListener("keydown", (event) => {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return
    event.preventDefault()
    const current = Number(stageResize.getAttribute("aria-valuenow")) || stage.getBoundingClientRect().height
    const step = event.shiftKey ? 40 : 10
    const next = event.key === "Home" ? STAGE_MIN_HEIGHT : event.key === "End"
      ? workspace.clientHeight - FIXED_ROWS_HEIGHT - CANVAS_MIN_HEIGHT
      : current + (event.key === "ArrowUp" ? step : -step)
    setStageHeight(next)
    workspace.style.setProperty(STAGE_OFFSET_VAR, `${Math.round(stage.getBoundingClientRect().height)}px`)
    localStorage.setItem(STAGE_HEIGHT_KEY, String(Math.round(stage.getBoundingClientRect().height)))
  })
  stageResize.addEventListener("pointerdown", (event) => {
    dragging = true
    moved = false
    startY = event.clientY
    startHeight = stage.getBoundingClientRect().height
    stageResize.setAttribute("aria-busy", "true")
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
    stageResize.removeAttribute("aria-busy")
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

  /* —— 两份列表：动画与样式共用搜索框，切换只改显示哪一栏 —— */
  let list: AnimationList = "animations"
  let noun = "动效"
  let styleNoun = ""
  let styleCount = 0
  let animationCount = ""
  const applyCount = () => {
    count.textContent = list === "styles" ? `${styleCount} 个` : animationCount
  }
  const show = (next: AnimationList) => {
    if (next === "styles" && !styleNoun) return
    list = next
    for (const key of ["animations", "styles"] as const) {
      tabButtons[key].setAttribute("aria-pressed", String(key === list))
      bodies[key].hidden = key !== list
    }
    const subject = list === "styles" ? styleNoun : noun
    searchInput.placeholder = `搜索${subject}`
    searchInput.setAttribute("aria-label", `搜索${subject}`)
    applyCount()
  }
  function tab(name: AnimationList, label: string): HTMLButtonElement {
    const button = element("button")
    button.type = "button"
    button.textContent = label
    button.addEventListener("click", () => show(name))
    tabs.append(button)
    return button
  }

  const filter = () => {
    const query = searchInput.value.trim().toLowerCase()
    for (const option of body.querySelectorAll<HTMLElement>("[data-animation-id], [data-style-id]")) {
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
    library: bodies.animations,
    styles: bodies.styles,
    stage,
    setMode(particle, total) {
      noun = particle ? "粒子" : "动效"
      animationCount = total
      title.textContent = `${noun}设计`
      library.setAttribute("aria-label", `${noun}设计`)
      show(list)
    },
    setStyles(next, total) {
      styleNoun = next ?? ""
      styleCount = total
      tabButtons.styles.textContent = styleNoun || "样式"
      tabButtons.styles.hidden = !styleNoun
      if (!styleNoun && list === "styles") show("animations")
      applyCount()
    },
    show,
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
      bodies.animations.replaceChildren()
      bodies.styles.replaceChildren()
      stage.replaceChildren()
      searchInput.value = ""
      styleNoun = ""
      tabButtons.styles.hidden = true
      show("animations")
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
