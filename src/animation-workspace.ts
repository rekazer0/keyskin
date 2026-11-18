/*
 * 动效设计 / 粒子设计的桌面布局（DESIGN.md §10「动画资源」）：动画列表放在左侧栏（和图片资源一样），
 * 画布照常显示键盘布局，播放预览停靠在画布下方，检查器只留引用和参数。
 * 播放条默认按内容高度停靠，拖动上边缘可以改高（双击恢复默认），高度与位置只影响窗口，不写进皮肤。
 * 窄屏仍在检查器里自上而下排列，由 animation-inspector.ts 决定。
 */
import { element, emptyState, paneHeader, searchField } from "./dom-element.ts"
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

type AnimationWorkspaceHosts = {
  /** The sidebar library body: actions and the animation list. */
  library: HTMLElement
  /** The second list: the styles (BDA targets) that play the animations here. */
  styles: HTMLElement
  /** The strip docked under the keyboard canvas: the selected animation's title, player and warnings. */
  stage: HTMLElement
  /** Syncs the animation category and the active list's count. */
  setMode(particle: boolean, count: string, totals: readonly [motion: number, particle: number]): void
  readonly allTypes: boolean
  readonly create: HTMLElement
  /** Names the second list (样式 / 目标) with its count; `undefined` hides its switch. */
  setStyles(noun: string | undefined, count: number): void
  /** Switches the left column between the animation list and the style list. */
  show(list: AnimationList): void
  /** Hides list rows that do not match the search box; re-run after the list is rebuilt. */
  filter(): void
}

type AnimationList = "animations" | "styles"

const shared: { hosts?: AnimationWorkspaceHosts } = {}

/** Where the animation inspector puts its list and player, or nothing on narrow windows and other views. */
export function animationWorkspaceHosts(): AnimationWorkspaceHosts | undefined {
  return shared.hosts
}

export function createAnimationWorkspace(actions: { back(): void; relayout(): void; changeMode(particle: boolean): void; changeLayout(option: HTMLButtonElement): void }) {
  const sidebar = document.querySelector<HTMLElement>(".sidebar")!
  const workspace = document.querySelector<HTMLElement>(".workspace")!
  const library = element("section", "animation-library")
  library.id = "animation-library"
  const create = element("div", "animation-library-create")
  const tabs = element("div", "ui-segmented animation-library-tabs")
  const header = paneHeader({ back: { to: "概览", run: actions.back }, title: "动画", actions: [tabs, create] })
  const count = header.querySelector<HTMLElement>(".ui-badge")!
  let allTypes = false
  const modes = element("div", "ui-style-filters animation-library-modes")
  modes.dataset.variant = "pill"
  modes.setAttribute("role", "group")
  modes.setAttribute("aria-label", "动画类型")
  const filters = ([ ["all", "全部"], ["motion", "动效"], ["particle", "粒子"] ] as const).map(([mode, label]) => {
    const button = element("button", "ui-button")
    const total = element("small")
    button.type = "button"
    button.dataset.animationMode = mode
    button.append(label, total)
    button.addEventListener("click", () => {
      if (button.getAttribute("aria-pressed") === "true" && list === "animations") return
      allTypes = mode === "all"
      searchInput.value = ""
      searchInput.dispatchEvent(new Event("input"))
      show("animations")
      if (allTypes) actions.relayout()
      else actions.changeMode(mode === "particle")
    })
    modes.append(button)
    return { button, total }
  })
  const search = searchField({ label: "搜索", onInput: () => filter() })
  const searchInput = search.querySelector("input")!
  /* —— 左栏分两份列表：动画 与 样式，用分段开关切换 —— */
  tabs.dataset.variant = "icon"
  tabs.dataset.size = "sm"
  tabs.setAttribute("role", "group")
  tabs.setAttribute("aria-label", "左侧列表")
  const bodies: Record<AnimationList, HTMLElement> = {
    animations: element("div", "animation-library-pane"),
    styles: element("div", "animation-library-pane"),
  }
  const tabButtons = { animations: tab("animations", "动画"), styles: tab("styles", "样式") }
  const body = element("div", "animation-library-body")
  body.append(bodies.animations, bodies.styles)
  library.append(header, search, modes, body)
  for (const group of [modes, tabs]) group.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
    const buttons = [...group.querySelectorAll<HTMLButtonElement>("button:not([hidden])")]
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (index < 0) return
    event.preventDefault()
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length
    buttons[next]?.click()
    buttons[next]?.focus()
  })
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
    const height = Math.round(stage.getBoundingClientRect().height)
    if (!height) return
    workspace.style.setProperty(STAGE_OFFSET_VAR, `${height}px`)
    stageResize.setAttribute("aria-valuenow", String(height))
    stageResize.setAttribute("aria-valuemax", String(Math.max(STAGE_MIN_HEIGHT, workspace.clientHeight - FIXED_ROWS_HEIGHT - CANVAS_MIN_HEIGHT)))
    stageResize.setAttribute("aria-valuetext", `${height} 像素`)
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
    if (event.button !== 0 || !event.isPrimary) return
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
  stageResize.addEventListener("lostpointercapture", finishResize)
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
  let styleNoun = ""
  let styleCount = 0
  let animationCount = ""
  const applyCount = () => {
    const options = bodies[list].querySelectorAll<HTMLElement>("[role='option']")
    count.textContent = searchInput.value.trim()
      ? `${[...options].filter(option => !option.hidden).length} / ${options.length}`
      : list === "styles" ? String(styleCount) : animationCount
    count.hidden = !count.textContent
  }
  const show = (next: AnimationList) => {
    if (next === "styles" && !styleNoun) return
    list = next
    for (const key of ["animations", "styles"] as const) {
      tabButtons[key].setAttribute("aria-pressed", String(key === list))
      bodies[key].hidden = key !== list
    }
    create.hidden = list === "styles"
    searchInput.setAttribute("aria-label", `搜索${list === "styles" ? styleNoun : "动画名称"}`)
    filter()
  }
  function tab(name: AnimationList, label: string): HTMLButtonElement {
    const button = element("button")
    button.type = "button"
    button.setAttribute("aria-label", label)
    button.title = label
    button.append(createIcon(name === "animations" ? "film" : "paintbrush", 14))
    button.addEventListener("click", () => show(name))
    tabs.append(button)
    return button
  }

  const filter = () => {
    const query = searchInput.value.trim().toLowerCase()
    for (const option of body.querySelectorAll<HTMLElement>("[data-animation-id], [data-style-id]")) {
      const hidden = Boolean(query) && !option.textContent!.toLowerCase().includes(query)
      if (option.hidden !== hidden) option.hidden = hidden
    }
    for (const pane of Object.values(bodies)) {
      const box = pane.querySelector<HTMLElement>(".ui-listbox")
      if (!box) continue
      const visible = [...box.querySelectorAll<HTMLElement>('[role="option"]')].filter(option => !option.hidden)
      let empty = box.querySelector<HTMLElement>("[data-search-empty]")
      if (!empty && query && !visible.length) {
        empty = emptyState("search-x")
        empty.dataset.searchEmpty = ""
        box.append(empty)
      }
      if (empty) empty.hidden = !query || visible.length > 0
      const focusable = visible.find(option => option.getAttribute("aria-selected") === "true") ?? visible[0]
      for (const option of visible) {
        const tabIndex = option === focusable ? 0 : -1
        if (option.tabIndex !== tabIndex) option.tabIndex = tabIndex
      }
    }
    applyCount()
  }
  const hosts: AnimationWorkspaceHosts = {
    library: bodies.animations,
    styles: bodies.styles,
    stage,
    create,
    get allTypes() { return allTypes },
    setMode(particle, total, [motionCount, particleCount]) {
      animationCount = total
      library.setAttribute("aria-label", "动画")
      const active = allTypes ? 0 : particle ? 2 : 1
      filters.forEach(({ button, total }, index) => {
        const next = String([motionCount + particleCount, motionCount, particleCount][index])
        if (total.textContent !== next) total.textContent = next
        button.setAttribute("aria-pressed", String(index === active))
      })
      show(list)
    },
    setStyles(next, total) {
      styleNoun = next ?? ""
      styleCount = total
      const label = styleNoun || "样式"
      if (tabButtons.styles.getAttribute("aria-label") !== label) {
        tabButtons.styles.setAttribute("aria-label", label)
        tabButtons.styles.title = label
        tabButtons.styles.replaceChildren(createIcon(label === "目标" ? "crosshair" : "paintbrush", 14))
      }
      tabButtons.styles.hidden = !styleNoun
      if (!styleNoun && list === "styles") show("animations")
      applyCount()
    },
    show,
    filter,
  }
  const layoutControl = element("label", "ui-input ui-select animation-layout-control")
  layoutControl.hidden = true
  const layoutIcon = element("span", "ui-input-affix")
  layoutIcon.append(createIcon("keyboard", 14))
  const layoutSelect = element("select")
  layoutSelect.setAttribute("aria-label", "动画预览布局")
  layoutControl.append(layoutIcon, layoutSelect)
  const toolbar = workspace.querySelector(".preview-toolbar")!
  toolbar.prepend(layoutControl)
  const guides = workspace.querySelector("#toggle-guides")!
  const toolbarStart = guides.parentElement!
  const toolbarEnd = workspace.querySelector(".preview-toolbar-end")!
  const fit = workspace.querySelector("#preview-zoom-fit")!
  const zoom = fit.parentElement!
  const zoomValue = element("output", "animation-zoom-value")
  zoomValue.setAttribute("aria-label", "画布缩放比例")
  zoomValue.setAttribute("aria-live", "off")
  const panelStatus = workspace.querySelector("#panel-status")!
  const syncZoom = () => { zoomValue.value = panelStatus.textContent?.split(" · ").at(-1) ?? "" }
  const zoomObserver = new MutationObserver(syncZoom)
  let layoutButtons = new Map<string, HTMLButtonElement>()
  layoutSelect.addEventListener("change", () => {
    const option = layoutButtons.get(layoutSelect.value)
    if (!option) return
    const previous = allTypes
    actions.changeLayout(option)
    if (allTypes !== previous) { allTypes = previous; actions.relayout() }
    layoutSelect.focus()
  })
  function syncLayouts(path: string) {
    layoutButtons = new Map([...sidebar.querySelectorAll<HTMLButtonElement>(".nav-layout[data-path]")].map(button => [button.dataset.path!, button]))
    if (!layoutButtons.has(path)) { layoutControl.hidden = true; return }
    const options = [...layoutButtons].map(([value, button]) => new Option(button.querySelector(".nav-label")?.textContent ?? value, value))
    if (JSON.stringify([...layoutSelect.options].map(option => [option.value, option.text])) !== JSON.stringify(options.map(option => [option.value, option.text]))) {
      layoutSelect.replaceChildren(...options)
    }
    layoutSelect.value = path
    layoutControl.hidden = false
  }

  const media = matchMedia("(min-width: 761px) and (min-height: 601px), (min-width: 951px)")
  let wanted = false
  const apply = () => {
    const active = wanted && media.matches
    document.body.classList.toggle("animation-workspace", active)
    if (active === Boolean(shared.hosts)) return
    shared.hosts = active ? hosts : undefined
    if (active) {
      toolbarEnd.prepend(guides)
      toolbarEnd.append(fit)
      zoom.firstElementChild?.after(zoomValue)
      syncZoom()
      zoomObserver.observe(panelStatus, { childList: true })
    } else {
      toolbarStart.prepend(guides)
      zoom.firstElementChild?.after(fit)
      zoomObserver.disconnect()
      zoomValue.remove()
      layoutControl.hidden = true
    }
    if (!active) {
      bodies.animations.replaceChildren()
      bodies.styles.replaceChildren()
      stage.replaceChildren()
      create.replaceChildren()
      allTypes = false
      searchInput.value = ""
      searchInput.dispatchEvent(new Event("input"))
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
    showAll() {
      if (!shared.hosts || allTypes) return
      filters[0].button.click()
    },
    update(active: boolean, path?: string) {
      wanted = active
      apply()
      if (path && shared.hosts) syncLayouts(path)
    },
  }
}
