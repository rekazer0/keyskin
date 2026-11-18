import { wireResourcePage } from "./resource-page"
import { applyWindowMaterialOpacity } from "./preferences"
import { bindDialog } from "./ask"
import { closeDialog } from "../motion"
import { appState } from "./state"
import { selectFile } from "./navigation"
import { setSidebarView } from "./source-files"
import { openResources, resourceNavigationPath } from "./resource-navigation"
import { $, canvasWrap, files, inspectorTabs, mobileExportOpen, workspaceExport, workspaceNavigation, workspaceToolsDialog, workspaceToolsContext, workspaceNavigationOpacity, sharePage, resourcePageTabs, mode, layout } from "./dom"

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

/** 桌面导航复用原视图和操作，禁用状态随原入口同步。 */
export function wireWorkspaceNavigation(): void {
  wireResourcePage()
  const saveOpacity = () => {
    applyWindowMaterialOpacity()
    localStorage.setItem(workspaceNavigationOpacity.id, workspaceNavigationOpacity.value)
  }
  workspaceNavigationOpacity.addEventListener("input", saveOpacity)
  workspaceNavigationOpacity.addEventListener("change", saveOpacity)
  const pages = [...workspaceNavigation.querySelectorAll<HTMLButtonElement>("[data-workspace-page]")]
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
    const loaded = Boolean(appState.archive) && !canvasWrap.classList.contains("empty")
    const current = !sharePage.hidden ? "share" : workspaceToolsDialog.open ? "tools"
      : !loaded ? "files"
      : appState.inspectorTab === "ai" ? "ai"
      : loaded && appState.resourceConfigActive ? "resources"
      : loaded && (appState.sidebarView === "source" || appState.inspectorTab === "source") ? "source"
      : loaded && appState.animationDesignMode !== "all" ? "animation" : "overview"
    for (const button of pages) {
      const page = button.dataset.workspacePage
      button.disabled = appState.fileOperationRunning || (page === "overview" ? !appState.archive
        : page !== "files" && (!loaded || page === "resources" && !resourceNavigationPath("image") || page === "animation" && !animationEntry()))
      if (page === current) button.setAttribute("aria-current", "page")
      else button.removeAttribute("aria-current")
      if (page === "tools") button.setAttribute("aria-expanded", String(workspaceToolsDialog.open))
    }
    for (const button of resourcePages) {
      const kind = button.dataset.resourcePage as "style" | "image" | "sound"
      button.disabled = !resourceNavigationPath(kind)
    }
    workspaceExport.disabled = !loaded || mobileExportOpen.disabled
    if (current === "share") workspaceExport.setAttribute("aria-current", "page")
    else workspaceExport.removeAttribute("aria-current")
    for (const button of tools) {
      const original = originalAction(button)
      button.disabled = original.disabled
      button.hidden = original.hidden
    }
    if (workspaceToolsDialog.open) {
      const context = [appState.archive?.format.toUpperCase(), layout.selectedOptions[0]?.textContent,
        mode.value === "edit" ? "编辑模式" : "切换至编辑模式后使用工具"].filter(Boolean).join(" · ")
      if (workspaceToolsContext.textContent !== context) workspaceToolsContext.textContent = context
      for (const section of workspaceToolsDialog.querySelectorAll<HTMLElement>(".ui-section")) {
        section.hidden = !section.querySelector("[data-workspace-tool]:not([hidden])")
      }
    }
  }
  for (const button of pages) button.addEventListener("click", () => {
    const page = button.dataset.workspacePage
    if (page === "files") $("#recent-files").click()
    else if (page === "tools") workspaceToolsDialog.showModal()
    else if (page === "resources" || page === "animation") {
      setSidebarView("overview")
      if (page === "resources") openResources()
      else {
        animationEntry()?.click()
        appState.animationWorkspace?.showAll()
      }
      inspectorTab("properties")
    } else if (appState.archive) {
      canvasWrap.classList.remove("empty")
      const source = page === "source"
      const path = source && appState.selectedPath && !appState.archive.isImage(appState.selectedPath)
        ? appState.selectedPath : appState.layoutPath
      appState.animationDesignMode = "all"
      if (path) selectFile(path, source ? "source" : "overview")
      setSidebarView(source ? "source" : "overview")
      inspectorTab(source ? "source" : page === "ai" ? "ai" : "properties")
    }
    sync()
    if (page === "tools") tools.find(tool => !tool.disabled && tool.getClientRects().length)?.focus()
  })
  for (const button of resourcePages) {
    button.addEventListener("click", () => {
      if (button.dataset.resourcePage === "style") appState.resourceStyleType = "all"
      openResources(button.dataset.resourcePage as "style" | "image" | "sound")
      sync()
    })
  }
  bindNavigationKeys(resourcePageTabs, "button", true)
  for (const button of tools) button.addEventListener("click", async () => {
    await closeDialog(workspaceToolsDialog)
    originalAction(button).click()
  })
  bindNavigationKeys(workspaceToolsDialog, "[data-workspace-tool]")
  workspaceExport.addEventListener("click", () => mobileExportOpen.click())
  workspaceToolsDialog.addEventListener("close", sync)
  bindNavigationKeys(workspaceNavigation, "button.ui-icon-button")
  const observer = new MutationObserver(sync)
  observer.observe(files, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-current", "aria-selected", "hidden"] })
  observer.observe(inspectorTabs, { subtree: true, attributes: true, attributeFilter: ["aria-selected"] })
  observer.observe(canvasWrap, { attributes: true, attributeFilter: ["class"] })
  observer.observe(sharePage, { attributes: true, attributeFilter: ["hidden"] })
  observer.observe(mobileExportOpen, { attributes: true, attributeFilter: ["disabled"] })
  for (const button of tools) observer.observe(originalAction(button), { attributes: true, attributeFilter: ["disabled", "hidden"] })
  sync()
}
