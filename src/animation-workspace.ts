/*
 * 动效设计 / 粒子设计的桌面布局（DESIGN.md §10「动画资源」）：动画列表放在左侧栏（和图片资源一样），
 * 画布照常显示键盘布局，播放预览停靠在画布下方，检查器只留引用和参数。
 * 窄屏仍在检查器里自上而下排列，由 animation-inspector.ts 决定。
 */
import { element, iconButton } from "./dom-element.ts"
import { createIcon } from "./icons.ts"

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
  workspace.append(stage)

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
