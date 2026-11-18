import { element } from "../dom-element"
import { appState } from "./state"
import { resourceGallery as grid } from "./dom"

/** 保留分段的滚动高度，只有视口附近的段持有卡片、位图与播放器。 */
export let resourceWindow: ReturnType<typeof windowPages> | undefined

export function clearResourceWindow(): void {
  if (!resourceWindow) return
  resourceWindow.dispose()
  grid.replaceChildren()
  grid.removeAttribute("tabindex")
  resourceWindow = undefined
}

export function appendResourceCards(paths: string[], card: (index: number) => HTMLElement, extra?: HTMLElement): void {
  if (paths.length < 150) {
    grid.append(...paths.map((_, i) => card(i)))
    if (extra) grid.append(extra)
    return
  }
  resourceWindow = windowPages(paths, card, extra)
}

function windowPages(paths: string[], card: (index: number) => HTMLElement, extra?: HTMLElement) {
  const total = paths.length + Number(Boolean(extra))
  const pages: HTMLElement[] = []
  const rowsPerPage = 6
  let columns = 1, perPage = 1, layoutKey = ""
  function mount(page: HTMLElement) {
    if (page.firstChild) return
    const start = Number(page.dataset.start)
    const nodes = []
    for (let i = start; i < Math.min(total, start + perPage); i++) {
      if (i === paths.length) nodes.push(extra!)
      else {
        const node = card(i)
        node.setAttribute("aria-posinset", String(i + 1))
        node.setAttribute("aria-setsize", String(paths.length))
        nodes.push(node)
      }
    }
    page.style.removeProperty("height")
    page.append(...nodes)
  }
  function syncTabStop() {
    grid.tabIndex = grid.querySelector('.resource-item[tabindex="0"]') ? -1 : 0
  }
  const visibility = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const page = entry.target as HTMLElement
      if (page.parentElement !== grid) continue
      if (entry.isIntersecting) mount(page)
      else if (page.firstChild && entry.boundingClientRect.height && !page.contains(document.activeElement)) {
        page.style.height = `${entry.boundingClientRect.height}px`
        page.replaceChildren()
      }
    }
    syncTabStop()
  }, { root: grid, rootMargin: "300px 0px" })
  function releaseBlurredPage(event: FocusEvent) {
    const page = (event.target as Element).closest<HTMLElement>(".ui-resource-grid-page")
    if (page && !page.contains(event.relatedTarget as Node | null)) {
      visibility.unobserve(page)
      visibility.observe(page)
    }
  }
  function layout() {
    if (!grid.clientWidth) return
    const css = getComputedStyle(grid)
    const key = `${css.gridTemplateColumns}|${css.rowGap}`
    if (key === layoutKey) return
    layoutKey = key
    const focused = (document.activeElement as HTMLElement)?.closest<HTMLElement>(".resource-item")
    const focusIndex = focused && grid.contains(focused) ? paths.indexOf(focused.dataset.path!) : -1
    const top = grid.getBoundingClientRect().top
    const anchor = pages.find(page => page.getBoundingClientRect().bottom > top)
    const index = Number(anchor?.dataset.start ?? 0)
    columns = css.gridTemplateColumns.split(" ").length
    perPage = columns * rowsPerPage
    visibility.disconnect()
    pages.length = 0
    for (let i = 0; i < total; i += perPage) {
      const page = element("div", "ui-resource-grid-page")
      page.dataset.start = String(i)
      page.setAttribute("role", "presentation")
      pages.push(page)
    }
    grid.replaceChildren(...pages)
    mount(pages[0])
    const gap = parseFloat(css.rowGap) || 0
    const row = (pages[0].getBoundingClientRect().height + gap) / Math.ceil(Math.min(total, perPage) / columns)
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i]
      if (i) page.style.height = `${Math.ceil(Math.min(perPage, total - i * perPage) / columns) * row - gap}px`
      visibility.observe(page)
    }
    if (index) at(index)?.scrollIntoView({ block: "start" })
    if (focusIndex >= 0) at(focusIndex)?.focus({ preventScroll: true })
  }
  function at(index: number) {
    const page = pages[Math.floor(index / perPage)]
    if (!page) return
    mount(page)
    return page.children[index % perPage] as HTMLElement
  }
  const resize = new ResizeObserver(layout)
  grid.addEventListener("focusout", releaseBlurredPage)
  grid.addEventListener("resource-selection-change", syncTabStop)
  resize.observe(grid)
  layout()
  return {
    paths, length: paths.length, at, layout,
    get columns() { return columns },
    get current() {
      const focused = (document.activeElement as HTMLElement)?.closest<HTMLElement>(".resource-item")
      return paths.indexOf(focused && grid.contains(focused) ? focused.dataset.path! : appState.selectedResourceGalleryPath)
    },
    dispose() {
      visibility.disconnect()
      resize.disconnect()
      grid.removeEventListener("focusout", releaseBlurredPage)
      grid.removeEventListener("resource-selection-change", syncTabStop)
    },
  }
}
