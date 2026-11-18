import { applyWindowMaterialOpacity } from "./preferences"
import { bindDialog } from "./ask"
import { closeDialog } from "../motion"
import { appState } from "./state"
import { selectFile } from "./navigation"
import { setSidebarView } from "./source-files"
import { $, canvasWrap, files, inspectorTabs, mobileExportOpen, workspaceExport, workspaceNavigation, workspaceToolsDialog, workspaceNavigationOpacity } from "./dom"

/** 桌面导航复用原视图和操作，禁用状态随原入口同步。 */
export function wireWorkspaceNavigation(): void {
  const saveOpacity = () => {
    applyWindowMaterialOpacity()
    localStorage.setItem(workspaceNavigationOpacity.id, workspaceNavigationOpacity.value)
  }
  workspaceNavigationOpacity.addEventListener("input", saveOpacity)
  workspaceNavigationOpacity.addEventListener("change", saveOpacity)
  const pages = [...workspaceNavigation.querySelectorAll<HTMLButtonElement>("[data-workspace-page]")]
  const tools = [...workspaceToolsDialog.querySelectorAll<HTMLButtonElement>("[data-workspace-tool]")]
  const originalAction = (button: HTMLButtonElement) => $<HTMLButtonElement>(`#${button.dataset.workspaceTool}`)
  const resourceEntry = () => files.querySelector<HTMLButtonElement>('.sidebar-overview [data-nav-mode="style"], .sidebar-overview [data-nav-mode="resource"], .sidebar-overview [data-nav-mode="sound"]')
  const animationEntry = () => {
    const entries = [...files.querySelectorAll<HTMLButtonElement>(`.sidebar-overview [data-nav-mode="${appState.animationWorkspaceMode}"]`)]
    return entries.find(entry => entry.dataset.path === appState.selectedPath) ?? entries[0]
  }
  const inspectorTab = (tab: string) => inspectorTabs.querySelector<HTMLButtonElement>(`[data-inspector-tab="${tab}"]`)?.click()
  bindDialog(workspaceToolsDialog)
  const sync = () => {
    const loaded = Boolean(appState.archive) && !canvasWrap.classList.contains("empty")
    const current = workspaceToolsDialog.open ? "tools"
      : !loaded ? "files"
      : loaded && (appState.sidebarView === "source" || appState.inspectorTab === "source") ? "source"
      : loaded && appState.resourceConfigActive ? "resources"
      : loaded && appState.animationDesignMode !== "all" ? "animation" : "overview"
    for (const button of pages) {
      const page = button.dataset.workspacePage
      button.disabled = page === "overview" ? !appState.archive
        : page !== "files" && (!loaded || page === "resources" && !resourceEntry() || page === "animation" && !animationEntry())
      if (page === current) button.setAttribute("aria-current", "page")
      else button.removeAttribute("aria-current")
      if (page === "tools") button.setAttribute("aria-expanded", String(workspaceToolsDialog.open))
    }
    workspaceExport.disabled = !loaded || mobileExportOpen.disabled
    for (const button of tools) {
      const original = originalAction(button)
      button.disabled = original.disabled
      button.hidden = original.hidden
    }
  }
  for (const button of pages) button.addEventListener("click", () => {
    const page = button.dataset.workspacePage
    if (page === "files") $("#recent-files").click()
    else if (page === "tools") workspaceToolsDialog.showModal()
    else if (page === "resources" || page === "animation") {
      setSidebarView("overview")
      const entry = page === "resources" ? resourceEntry() : animationEntry()
      entry?.click()
      if (page === "animation") appState.animationWorkspace?.showAll()
      inspectorTab("properties")
    } else if (appState.archive) {
      canvasWrap.classList.remove("empty")
      const source = page === "source"
      const path = source && appState.selectedPath && !appState.archive.isImage(appState.selectedPath)
        ? appState.selectedPath : appState.layoutPath
      appState.animationDesignMode = "all"
      if (path) selectFile(path, source ? "source" : "overview")
      setSidebarView(source ? "source" : "overview")
      inspectorTab(source ? "source" : "properties")
    }
    sync()
  })
  for (const button of tools) button.addEventListener("click", async () => {
    await closeDialog(workspaceToolsDialog)
    originalAction(button).click()
  })
  workspaceExport.addEventListener("click", () => mobileExportOpen.click())
  workspaceToolsDialog.addEventListener("close", sync)
  workspaceNavigation.addEventListener("keydown", event => {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return
    const buttons = [...workspaceNavigation.querySelectorAll<HTMLElement>('button.ui-icon-button:not(:disabled)')]
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (index < 0) return
    event.preventDefault()
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length
    buttons[next]?.focus()
  })
  const observer = new MutationObserver(sync)
  observer.observe(files, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-current", "aria-selected", "hidden"] })
  observer.observe(inspectorTabs, { subtree: true, attributes: true, attributeFilter: ["aria-selected"] })
  observer.observe(canvasWrap, { attributes: true, attributeFilter: ["class"] })
  observer.observe(mobileExportOpen, { attributes: true, attributeFilter: ["disabled"] })
  for (const button of tools) observer.observe(originalAction(button), { attributes: true, attributeFilter: ["disabled", "hidden"] })
  sync()
}
