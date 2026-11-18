import { appState } from "./state"
import { resourceDetail, resourceGallery } from "./dom"
import { updateResourceActionButtons } from "./resource-inspector"
import { startResourceDrag } from "./resource-transfer"
import { releaseKeySound } from "./canvas-interaction"

function resourceCards(): HTMLElement[] {
  return [...resourceGallery.querySelectorAll<HTMLElement>('.resource-item[role="option"]')]
}

/** 重建网格后只保留仍可见的选择，避免筛选后误下载或删除隐藏项。 */
export function syncResourceSelection(): void {
  const cards = resourceCards()
  const visible = new Set(cards.map(card => card.dataset.path!))
  appState.selectedResourceGalleryPaths = appState.selectedResourceGalleryPaths.filter(path => visible.has(path))
  if (!appState.selectedResourceGalleryPaths.includes(appState.selectedResourceGalleryPath)) {
    appState.selectedResourceGalleryPath = appState.selectedResourceGalleryPaths.at(-1) ?? ""
  }
  applyResourceSelection()
}

function applyResourceSelection(): void {
  if (appState.resourceInspectorMode === "sound" && appState.selectedSoundID !== appState.selectedResourceGalleryPath) {
    releaseKeySound()
    appState.selectedSoundID = appState.selectedResourceGalleryPath
  }
  const selected = new Set(appState.selectedResourceGalleryPaths)
  for (const card of resourceGallery.querySelectorAll<HTMLElement>('.resource-item[aria-selected="true"]')) {
    if (!selected.has(card.dataset.path!)) card.setAttribute("aria-selected", "false")
  }
  const cards = selected.size > 1 ? new Map(resourceCards().map(card => [card.dataset.path!, card])) : undefined
  for (const path of selected) {
    const card = cards ? cards.get(path) : resourceGallery.querySelector<HTMLElement>(`.resource-item[data-path="${CSS.escape(path)}"]`)
    if (card?.getAttribute("aria-selected") !== "true") card?.setAttribute("aria-selected", "true")
  }
  for (const card of resourceGallery.querySelectorAll<HTMLElement>('.resource-item[tabindex="0"]')) {
    if (card.dataset.path !== appState.selectedResourceGalleryPath) card.tabIndex = -1
  }
  const focus = resourceGallery.querySelector<HTMLElement>(appState.selectedResourceGalleryPath
    ? `.resource-item[data-path="${CSS.escape(appState.selectedResourceGalleryPath)}"]` : ".resource-item")
  if (focus) focus.tabIndex = 0
  resourceGallery.setAttribute("aria-multiselectable", "true")
  updateResourceActionButtons()
  resourceGallery.dispatchEvent(new Event("resource-selection-change"))
}

export function selectGalleryItem(path: string): void {
  const unchanged = appState.selectedResourceGalleryPaths.includes(path) && appState.selectedResourceGalleryPath === path
  if (!appState.selectedResourceGalleryPaths.includes(path)) {
    appState.selectedResourceGalleryPaths = [path]
    appState.resourceSelectionAnchor = path
  }
  appState.selectedResourceGalleryPath = path
  if (!unchanged) applyResourceSelection()
  resourceGallery.querySelector<HTMLElement>(`.resource-item[data-path="${CSS.escape(path)}"]`)?.scrollIntoView({ block: "nearest" })
}

function chooseResourceCard(card: HTMLElement, event: MouseEvent | KeyboardEvent): void {
  const path = card.dataset.path!
  const additive = event.metaKey || event.ctrlKey
  const selected = new Set(additive ? appState.selectedResourceGalleryPaths : [])
  const cards = event.shiftKey ? resourceCards() : []
  const anchor = cards.findIndex(item => item.dataset.path === appState.resourceSelectionAnchor)
  const index = cards.indexOf(card)
  if (event.shiftKey && anchor >= 0) {
    for (const item of cards.slice(Math.min(anchor, index), Math.max(anchor, index) + 1)) selected.add(item.dataset.path!)
  } else {
    if (selected.has(path)) selected.delete(path)
    else selected.add(path)
    appState.resourceSelectionAnchor = path
  }
  appState.selectedResourceGalleryPaths = [...selected]
  appState.selectedResourceGalleryPath = selected.has(path) ? path : [...selected].at(-1) ?? ""
  if (!selected.size && appState.resourceInspectorMode === "style") {
    appState.selectedStyleID = ""
    resourceDetail.hidden = true
  }
  applyResourceSelection()
  const primary = resourceGallery.querySelector<HTMLElement>(`.resource-item[data-path="${CSS.escape(appState.selectedResourceGalleryPath)}"]`)
  primary?.dispatchEvent(new Event("resource-preview"))
  card.focus({ preventScroll: true })
}

/** 单击选择与主动作分开；图片、样式和音效沿用同一套选择语义。 */
export function bindResourceCard(card: HTMLElement, path: string, open: () => void, preview?: () => void): void {
  card.classList.add("resource-item")
  card.tabIndex = -1
  card.dataset.path = path
  card.addEventListener("click", event => chooseResourceCard(card, event))
  if (preview) card.addEventListener("resource-preview", preview)
  card.addEventListener("dblclick", event => {
    if (event.target instanceof Element && event.target.closest("button, input, audio") && event.target !== card) return
    selectGalleryItem(path)
    open()
  })
  if (appState.archive?.getBytes(path.replace(/^file:/, ""))) {
    card.draggable = true
    card.addEventListener("dragstart", event => {
      if (!appState.selectedResourceGalleryPaths.includes(path)) selectGalleryItem(path)
      startResourceDrag(event)
    })
    card.querySelectorAll("img").forEach(image => { image.draggable = false })
  }
}

export function wireResourceSelection(): void {
  resourceGallery.addEventListener("click", event => {
    if (event.target !== resourceGallery) return
    appState.selectedResourceGalleryPaths = []
    appState.selectedResourceGalleryPath = ""
    if (appState.resourceInspectorMode === "style") { appState.selectedStyleID = ""; resourceDetail.hidden = true }
    syncResourceSelection()
  })
  resourceGallery.addEventListener("keydown", event => {
    const card = (event.target as Element).closest<HTMLElement>(".resource-item")
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
      event.preventDefault()
      event.stopPropagation()
      appState.selectedResourceGalleryPaths = resourceCards().map(item => item.dataset.path!)
      appState.selectedResourceGalleryPath = card?.dataset.path ?? appState.selectedResourceGalleryPaths[0] ?? ""
      syncResourceSelection()
    } else if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      appState.selectedResourceGalleryPaths = []
      appState.selectedResourceGalleryPath = ""
      if (appState.resourceInspectorMode === "style") { appState.selectedStyleID = ""; resourceDetail.hidden = true }
      syncResourceSelection()
    } else if (card && event.key === " " && (event.metaKey || event.ctrlKey || event.shiftKey)) {
      event.preventDefault()
      event.stopPropagation()
      chooseResourceCard(card, event)
    }
  }, { capture: true })
}
