import { wireResourcePage } from "./resource-page"
import { applyWindowMaterialOpacity } from "./preferences"
import { openShareDialog } from "./mobile-export"
import { bindDialog } from "./ask"
import { closeDialog } from "../motion"
import { appState } from "./state"
import { selectFile } from "./navigation"
import { setSidebarView } from "./source-files"
import { openResources, resourceNavigationPath } from "./resource-navigation"
import { $, canvasWrap, files, inspectorTabs, mobileExportOpen, workspaceExport, workspaceNavigation, workspaceToolsDialog, workspaceToolsContext, workspaceNavigationOpacity, inspectorSourceToggle, shareDialog, resourcePageTabs, resourceTheme, mode, layout, settingsWorkspace } from "./dom"

function bindNavigationKeys(container: HTMLElement, selector: string, selectOnMove = false): void {
  const keys = ["ArrowUp", "ArrowDown", "Home", "End"]
  if (selectOnMove) keys.push("ArrowLeft", "ArrowRight")
  container.addEventListener("keydown", event => {
    const key = event.key
    if (event.defaultPrevented || event.isComposing || !keys.includes(key)) return
    const buttons = [...container.querySelectorAll<HTMLButtonElement>(selector)].filter(button => !button.disabled && button.getClientRects().length)
    const index = buttons.indexOf(event.target as HTMLButtonElement)
    if (index < 0) return
    const next = key === "Home" ? 0 : key === "End" ? buttons.length - 1
      : (index + (["ArrowDown", "ArrowRight"].includes(key) ? 1 : -1) + buttons.length) % buttons.length
    event.preventDefault()
    if (selectOnMove) buttons[next].click()
    buttons[next].focus()
  })
}

function bindPageReorder(group: HTMLElement, pages: HTMLButtonElement[]): void {
  const storageKey = "workspace-navigation-order"
  const ordered = () => Array.from(group.children) as HTMLButtonElement[]
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]")
    if (Array.isArray(saved) && saved.length) {
      const keys = new Set([...saved, ...pages.map(page => page.dataset.workspacePage)])
      for (const key of keys) {
        const page = pages.find(button => button.dataset.workspacePage === key)
        if (page) group.append(page)
      }
    }
  } catch { /* 损坏或不可用的本机存储不影响导航。 */ }
  const place = (page: HTMLButtonElement, before: Element | null) => {
    if (page.nextElementSibling === before) return
    const focused = document.activeElement === page
    group.insertBefore(page, before)
    if (focused) page.focus({ preventScroll: true })
    try { localStorage.setItem(storageKey, JSON.stringify(ordered().map(button => button.dataset.workspacePage))) }
    catch { /* 存储不可用时仍可在当前窗口排序。 */ }
  }
  for (const page of pages) page.setAttribute("aria-keyshortcuts", "Alt+ArrowUp Alt+ArrowDown")
  group.addEventListener("keydown", event => {
    const page = event.target as HTMLButtonElement
    if (!event.altKey || !pages.includes(page) || !["ArrowUp", "ArrowDown"].includes(event.key)) return
    event.preventDefault()
    const sibling = event.key === "ArrowUp" ? page.previousElementSibling : page.nextElementSibling
    if (sibling) place(page, event.key === "ArrowUp" ? sibling : sibling.nextElementSibling)
    page.scrollIntoView({ block: "nearest" })
  })

  let gesture: { page: HTMLButtonElement; id: number; x: number; y: number; top: number; offsetY: number; active: boolean } | undefined
  let frame = 0
  let suppressClick = false
  const clearMarker = () => group.querySelector("[data-insert]")?.removeAttribute("data-insert")
  const cancel = () => {
    if (!gesture) return
    const { page, id } = gesture
    gesture = undefined
    cancelAnimationFrame(frame)
    frame = 0
    page.removeAttribute("data-reordering")
    page.style.removeProperty("translate")
    clearMarker()
    if (group.hasPointerCapture(id)) group.releasePointerCapture(id)
  }
  const targetAt = (x: number, y: number) => {
    const { left, right, top, bottom } = group.getBoundingClientRect()
    if (x < left || x >= right || y < top || y >= bottom) return
    const others = ordered().filter(page => page !== gesture?.page)
    const before = others.find(page => {
      const { top, height } = page.getBoundingClientRect()
      return y < top + height / 2
    }) ?? null
    return { before, marker: before ?? others.at(-1)!, top, bottom }
  }
  const preview = () => {
    frame = 0
    if (!gesture?.active) return
    clearMarker()
    const { page, x, y, top, offsetY } = gesture
    const target = targetAt(x, y)
    if (!target) {
      page.style.removeProperty("translate")
      return
    }
    if (page.nextElementSibling !== target.before) target.marker.dataset.insert = target.before ? "before" : "after"
    const height = page.offsetHeight
    const draggedTop = Math.max(target.top, Math.min(y - offsetY, target.bottom - height))
    const scroll = group.scrollTop
    page.style.translate = `0 ${draggedTop + scroll - top}px`
    const edge = height / 2
    const delta = Math.max(0, y - target.bottom + edge) - Math.max(0, target.top + edge - y)
    if (delta) group.scrollTop += delta / 4
    if (group.scrollTop !== scroll) frame = requestAnimationFrame(preview)
  }
  group.addEventListener("pointerdown", event => {
    if (!event.isPrimary || event.button !== 0) return
    cancel()
    suppressClick = false
    if (event.pointerType !== "mouse") return
    const page = (event.target as Element).closest<HTMLButtonElement>("[data-workspace-page]:enabled")
    if (!page) return
    const { pointerId: id, clientX: x, clientY: y } = event
    const { top } = page.getBoundingClientRect()
    gesture = { page, id, x, y, top: top + group.scrollTop, offsetY: y - top, active: false }
  })
  window.addEventListener("pointermove", event => {
    if (!gesture || gesture.id !== event.pointerId) return
    const { clientX: x, clientY: y } = event
    if (!gesture.active) {
      if (Math.abs(y - gesture.y) < 6) return
      if (gesture.page.disabled || !group.getClientRects().length) return cancel()
      gesture.active = suppressClick = true
      gesture.page.dataset.reordering = ""
      group.setPointerCapture(gesture.id)
    }
    Object.assign(gesture, { x, y })
    if (!frame) frame = requestAnimationFrame(preview)
  })
  window.addEventListener("pointerup", event => {
    if (!gesture || gesture.id !== event.pointerId) return
    const { active, page } = gesture
    const target = active && !page.disabled && targetAt(event.clientX, event.clientY)
    cancel()
    if (target) place(page, target.before)
  })
  window.addEventListener("pointercancel", event => { if (gesture?.id === event.pointerId) cancel() })
  group.addEventListener("lostpointercapture", event => { if (event.target === group && gesture?.id === event.pointerId) cancel() })
  window.addEventListener("blur", cancel)
  window.addEventListener("keydown", event => {
    if (!gesture?.active || event.key !== "Escape") return
    event.preventDefault()
    event.stopPropagation()
    cancel()
  }, true)
  group.addEventListener("contextmenu", event => { if (gesture) event.preventDefault() })
  group.addEventListener("click", event => {
    if (!suppressClick || !event.detail) return
    event.preventDefault()
    event.stopPropagation()
  }, true)
}

/** 桌面导航复用原视图和操作，禁用状态随原入口同步。 */
export function wireWorkspaceNavigation(): void {
  wireResourcePage()
  const saveOpacity = () => {
    applyWindowMaterialOpacity()
    localStorage.setItem(workspaceNavigationOpacity.id, workspaceNavigationOpacity.value)
  }
  workspaceNavigationOpacity.addEventListener("input", saveOpacity)
  workspaceNavigationOpacity.addEventListener("change", saveOpacity)
  const pageGroup = workspaceNavigation.querySelector<HTMLElement>(".ui-workspace-navigation-pages")!
  const pages = [...pageGroup.querySelectorAll<HTMLButtonElement>("[data-workspace-page]")]
  bindPageReorder(pageGroup, pages)
  const settingsEntry = workspaceNavigation.querySelector<HTMLButtonElement>('[data-settings-entry="settings"]')!
  const resourcePages = [...resourcePageTabs.querySelectorAll<HTMLButtonElement>("[data-resource-page]")]
  const tools = [...workspaceToolsDialog.querySelectorAll<HTMLButtonElement>("[data-workspace-tool]")]
  const originals = new Map(tools.map(button => [button, $<HTMLButtonElement>(`#${button.dataset.workspaceTool}`)]))
  const originalAction = (button: HTMLButtonElement) => originals.get(button)!
  const animationEntry = () => {
    const entries = [...files.querySelectorAll<HTMLButtonElement>(`.sidebar-overview [data-nav-mode="${appState.animationWorkspaceMode}"]`)]
    return entries.find(entry => entry.dataset.path === appState.selectedPath) ?? entries[0]
  }
  const inspectorTab = (tab: string) => inspectorTabs.querySelector<HTMLButtonElement>(`[data-inspector-tab="${tab}"]`)?.click()
  bindDialog(workspaceToolsDialog)
  const sync = () => {
    const loaded = Boolean(appState.archive)
    const current = !settingsWorkspace.hidden ? "settings" : workspaceToolsDialog.open ? "tools"
      : !loaded || canvasWrap.classList.contains("empty") ? "files"
      : appState.inspectorTab === "ai" ? "ai"
      : appState.resourceConfigActive ? "resources"
      : appState.animationDesignMode !== "all" ? "animation"
      : (appState.sidebarView === "source" || appState.inspectorTab === "source" && inspectorSourceToggle.hidden) ? "source" : "overview"
    const settingsCurrent = current === "settings" ? "page" : null
    if (settingsEntry.ariaCurrent !== settingsCurrent) settingsEntry.ariaCurrent = settingsCurrent
    for (const button of pages) {
      const page = button.dataset.workspacePage
      button.disabled = appState.fileOperationRunning || page !== "files" && (
        !loaded || page === "resources" && !resourceNavigationPath("image") || page === "animation" && !animationEntry())
      if (page === current) button.setAttribute("aria-current", "page")
      else button.removeAttribute("aria-current")
      if (page === "tools") button.setAttribute("aria-expanded", String(workspaceToolsDialog.open))
    }
    for (const button of resourcePages) {
      const kind = button.dataset.resourcePage as "style" | "image" | "sound"
      button.disabled = !resourceNavigationPath(kind)
    }
    workspaceExport.disabled = !settingsWorkspace.hidden || !loaded || mobileExportOpen.disabled
    workspaceExport.setAttribute("aria-expanded", String(shareDialog.open))
    for (const button of tools) {
      const original = originalAction(button)
      button.setAttribute("aria-disabled", String(original.disabled || original.hidden && original !== mobileExportOpen))
      const note = button.querySelector("small")!
      if (button.dataset.workspaceTool === "adb-share") note.textContent = original.hidden ? "仅限桌面客户端" : "推送至 Android 设备"
      if (button.dataset.workspaceTool === "layout-conversion") note.textContent = original.hidden ? "当前皮肤格式不支持" : "在键盘布局之间转换"
    }
    if (workspaceToolsDialog.open) {
      const context = [appState.archive?.format.toUpperCase(), layout.selectedOptions[0]?.textContent,
        mode.value === "edit" ? "编辑模式" : "切换至编辑模式后使用工具"].filter(Boolean).join(" · ")
      if (workspaceToolsContext.textContent !== context) workspaceToolsContext.textContent = context
    }
  }
  for (const button of pages) button.addEventListener("click", () => {
    const page = button.dataset.workspacePage
    if (page === "files") $("#recent-files").click()
    else if (page === "tools") workspaceToolsDialog.showModal()
    else if (appState.archive) {
      canvasWrap.classList.remove("empty")
      if (page === "resources" || page === "animation") {
        setSidebarView("overview")
        if (page === "resources") openResources()
        else {
          animationEntry()?.click()
          appState.animationWorkspace?.showAll()
        }
        inspectorTab("properties")
      } else {
        const source = page === "source"
        const path = source && appState.selectedPath && !appState.archive.isImage(appState.selectedPath)
          ? appState.selectedPath : appState.layoutPath
        appState.animationDesignMode = "all"
        if (path) selectFile(path, source ? "source" : "overview")
        setSidebarView(source ? "source" : "overview")
        inspectorTab(source ? "source" : page === "ai" ? "ai" : "properties")
      }
    }
    sync()
    if (page === "tools") tools.find(tool => tool.getAttribute("aria-disabled") === "false")?.focus()
  })
  for (const button of resourcePages) {
    button.addEventListener("click", () => {
      if (button.dataset.resourcePage === "style") appState.resourceStyleType = "all"
      openResources(button.dataset.resourcePage as "style" | "image" | "sound")
      sync()
    })
  }
  bindNavigationKeys(resourcePageTabs, "button", true)
  bindNavigationKeys(resourceTheme, "button", true)
  for (const button of tools) button.addEventListener("click", async () => {
    if (button.getAttribute("aria-disabled") === "true") return
    if (workspaceToolsDialog.open) await closeDialog(workspaceToolsDialog)
    if (button.dataset.workspaceTool === "adb-share") openShareDialog()
    originalAction(button).click()
  })
  bindNavigationKeys(workspaceToolsDialog, "[data-workspace-tool]")
  workspaceToolsDialog.addEventListener("close", sync)
  bindNavigationKeys(workspaceNavigation, "button.ui-icon-button")
  const observer = new MutationObserver(sync)
  observer.observe(settingsWorkspace, { attributes: true, attributeFilter: ["hidden"] })
  observer.observe(files, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-current", "aria-selected", "hidden"] })
  observer.observe(inspectorTabs, { subtree: true, attributes: true, attributeFilter: ["aria-selected"] })
  observer.observe(canvasWrap, { attributes: true, attributeFilter: ["class"] })
  observer.observe(shareDialog, { attributes: true, attributeFilter: ["open"] })
  observer.observe(mobileExportOpen, { attributes: true, attributeFilter: ["disabled"] })
  for (const button of tools) observer.observe(originalAction(button), { attributes: true, attributeFilter: ["disabled", "hidden"] })
  sync()
}
