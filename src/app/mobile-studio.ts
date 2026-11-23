import { wireMobileSettings } from "./mobile-settings"
import { element, iconButton } from "../dom-element"
import { showResourceList } from "./resource-inspector"
import { openResources } from "./resource-navigation"
import { createIcon } from "../icons"
import { bindDialog } from "./ask"
import { closeDialog } from "../motion"
import { appState } from "./state"
import { Channel, invoke } from "@tauri-apps/api/core"
import { isAndroidTauri, mobilePortraitQuery } from "./canvas-interaction"
import { setMobilePane, selectChoice } from "./mobile-layout"
import { selectFile } from "./navigation"
import { nativeSettings, showSettingsPage } from "./preferences"
import { setGuidesVisible } from "./preview-render"
import { $, canvasWrap, mode, theme, orientation, device, settingsWorkspace, files, mobileAppMore, resourceInspector, resourceListTitle, newButton, inspectorTabs, workspaceImageFigure, skinFieldsGroup, simulatedOutput, mobileProjectDialog, mobileProjectToggle, sidebarPane, workspacePane, welcomeScroller, sourceEditor, documentName, inspectorSourceToggle, quickInspector } from "./dom"

function wireAndroidInsets(root: HTMLElement): void {
  if (!isAndroidTauri()) return
  const handler = new Channel<Record<string, number>>()
  handler.onmessage = overlap => {
    for (const edge of ["top", "bottom", "left", "right"]) {
      const value = overlap[edge] ?? 0
      root.style.setProperty(`--android-overlap-${edge}`, `${value / window.devicePixelRatio}px`)
    }
    root.dispatchEvent(new CustomEvent("android-ime-overlap", { detail: (overlap.ime ?? 0) / window.devicePixelRatio }))
  }
  void invoke("observe_window_insets", { handler }).catch(() => {})
}

/** 手机导航只组织现有视图，文件编辑和提交仍走各自模块。 */
export function wireMobileStudio(): void {
  const operationDialog = $("#file-operation-dialog") as HTMLDialogElement
  for (const button of operationDialog.querySelectorAll<HTMLButtonElement>("[data-operation-close]")) button.addEventListener("click", () => ($("#file-operation-close") as HTMLButtonElement).click())
  $("#mobile-operation-share").addEventListener("click", async () => { await closeDialog(operationDialog); $("#mobile-share").click() })
  const retry = $("#mobile-operation-retry") as HTMLButtonElement
  retry.addEventListener("click", async () => {
    const action = appState.currentFileOperation
    if (appState.fileOperationRunning || !appState.archive || !["保存", "导出", "另存为"].includes(action)) return
    await closeDialog(operationDialog)
    $(action === "保存" ? "#save" : "#mobile-export-open").click()
  })
  new MutationObserver(() => {
    const action = appState.currentFileOperation || "文件操作"
    $("#mobile-operation-title").textContent = operationDialog.dataset.stage === "compatibility" ? "兼容性确认" : `${action}${operationDialog.dataset.outcome === "success" ? "完成" : operationDialog.dataset.outcome === "error" ? "失败" : "处理中"}`
    const disabled = ($("#file-operation-close") as HTMLButtonElement).disabled
    for (const button of operationDialog.querySelectorAll<HTMLButtonElement>("[data-operation-close]")) if (button.disabled !== disabled) button.disabled = disabled
    retry.hidden = operationDialog.dataset.outcome !== "error" || !["保存", "导出", "另存为"].includes(action) || !appState.archive
    retry.textContent = action === "保存" ? "重试保存" : action === "另存为" ? "重试另存为" : "重试导出"
  }).observe(operationDialog, { attributes: true, subtree: true, attributeFilter: ["data-outcome", "data-stage", "disabled"] })
  const root = document.documentElement
  wireAndroidInsets(root)
  const nav = $("#mobile-navigation")
  const navButtons = Array.from(nav.querySelectorAll<HTMLButtonElement>("button"))
  const recentViewport = $("#recent-viewport")
  const recent = $(".welcome-recent")
  const syncRecentEmpty = () => $(".welcome-main").classList.toggle("mobile-recent-empty", recent.hasAttribute("data-platform-hidden") || recentViewport.hidden)
  const recentObserver = new MutationObserver(syncRecentEmpty)
  recentObserver.observe(recentViewport, { attributes: true, attributeFilter: ["hidden"] })
  recentObserver.observe(recent, { attributes: true, attributeFilter: ["data-platform-hidden"] })
  syncRecentEmpty()
  const resourceTheme = $("#resource-theme")
  const themeHome = resourceTheme.parentElement!
  const createResource = $("#resource-create-style")
  const createHome = document.createComment("resource create action")
  createResource.before(createHome)
  bindDialog(mobileProjectDialog)
  mobileProjectDialog.addEventListener("close", () => {
    workspacePane.before(sidebarPane)
    sidebarPane.inert = mobilePortraitQuery.matches
    mobileProjectToggle.setAttribute("aria-expanded", "false")
  })
  mobileProjectToggle.addEventListener("click", () => setMobilePane("layout"))
  const routeTitle = element("strong", "mobile-route-title")
  const routeClose = iconButton("x", "返回编辑", () => nav.querySelector<HTMLButtonElement>('[data-mobile-page="edit"]')!.click())
  routeClose.classList.add("mobile-route-close")
  $(".titlebar").append(routeTitle)
  $(".titlebar-right").append(routeClose)
  const aiHeading = element("header", "mobile-ai-heading")
  const aiContext = element("p", "ui-field-note")
  aiHeading.append(Object.assign(element("h1"), { textContent: "AI 设计" }), aiContext)
  $("#ai-design-panel").prepend(aiHeading)
  const figureHome = workspaceImageFigure.parentElement!
  const simulation = simulatedOutput.closest<HTMLElement>(".simulation")!
  const simulationHome = simulation.parentElement!
  const simulationNext = simulation.nextSibling
  const simulationPlaceholder = simulatedOutput.placeholder
  const sourceReturn = element("button", "ui-button mobile-source-return")
  sourceReturn.type = "button"
  sourceReturn.textContent = "返回属性"
  sourceReturn.addEventListener("click", () => inspectorTabs.querySelector<HTMLButtonElement>('[data-inspector-tab="properties"]')!.click())
  $(".inspector-view-controls").append(sourceReturn)
  let showFullSource = false
  const syncNavigation = () => {
    if (!mobilePortraitQuery.matches) return
    const settings = !settingsWorkspace.hidden
    root.toggleAttribute("data-mobile-settings-open", settings)
    const page = settings ? "settings" : root.dataset.mobilePage
    for (const button of navButtons) {
      const current = (button.dataset.mobilePage ?? button.dataset.settingsEntry) === page ? "page" : null
      if (button.getAttribute("aria-current") === current) continue
      if (current) button.setAttribute("aria-current", current)
      else button.removeAttribute("aria-current")
    }
  }
  new MutationObserver(syncNavigation).observe(settingsWorkspace, { attributes: true, attributeFilter: ["hidden"] })
  const showInspector = (tab: "ai" | "properties") => {
    const button = inspectorTabs.querySelector<HTMLButtonElement>(`[data-inspector-tab="${tab}"]`)
    // Switching inspector tabs already opens the pane; an unchanged tab just needs to be shown.
    if (appState.inspectorTab !== tab && button && !button.disabled) button.click()
    else setMobilePane("inspector")
  }
  for (const button of nav.querySelectorAll<HTMLButtonElement>("[data-mobile-page]")) button.addEventListener("click", () => {
    const page = button.dataset.mobilePage!
    showFullSource = false
    if (page === "home") {
      $("#recent-files").click()
      welcomeScroller?.scrollTo({ top: 0 })
      return
    }
    if (button.hidden || !appState.archive) return
    canvasWrap.classList.remove("empty")
    selectChoice(mode, "edit")
    if (page === "resources") {
      if (!appState.resourceConfigActive) openResources()
      showInspector("properties")
    } else {
      if (appState.layoutPath && appState.selectedPath !== appState.layoutPath) selectFile(appState.layoutPath)
      showInspector(page === "ai" ? "ai" : "properties")
    }
  })
  if (!nativeSettings) $(".mobile-welcome-empty h2").textContent = "网页版不记录最近打开的皮肤"
  $("#mobile-welcome-new").addEventListener("click", () => newButton.click())
  $("#mobile-app-more [data-mobile-action=mobile-canvas-options]").addEventListener("click", () => {
    mobileAppMore.open = false
    mobileAppMore.querySelector("summary")?.focus()
    const dialog = element("dialog", "ui-dialog ui-mobile-sheet")
    dialog.dataset.variant = "canvas-options"
    dialog.setAttribute("aria-label", "画布选项")
    const form = element("form")
    form.method = "dialog"
    const header = element("header", "ui-dialog-header")
    header.append(Object.assign(element("h2"), { textContent: "画布选项" }))
    const body = element("div", "ui-dialog-body")
    for (const [label, select] of [["设备", device], ["方向", orientation], ["外观", theme]] as const) {
      const row = element(select === device ? "label" : "div", "ui-field")
      row.append(Object.assign(element("span"), { textContent: label }))
      if (select !== device) {
        const choices = element("div", "ui-segmented")
        choices.setAttribute("role", "group")
        choices.setAttribute("aria-label", label)
        choices.setAttribute("data-fill", "")
        for (const option of select.options) {
          const button = element("button")
          button.type = "button"
          button.textContent = option.textContent
          button.setAttribute("aria-pressed", String(select.value === option.value))
          button.addEventListener("click", async () => {
            await selectChoice(select, option.value)
            for (const [index, sibling] of [...choices.querySelectorAll("button")].entries()) sibling.setAttribute("aria-pressed", String(select.options[index]?.value === select.value))
          })
          choices.append(button)
        }
        row.append(choices)
      } else {
        const input = element("span", "ui-input ui-select")
        const field = select.cloneNode(true) as HTMLSelectElement
        field.removeAttribute("id")
        field.value = select.value
        field.addEventListener("change", () => selectChoice(select, field.value))
        input.append(field)
        row.append(input)
      }
      body.append(row)
    }
    const guides = element("label", "ui-field")
    const toggle = element("input", "ui-switch")
    toggle.type = "checkbox"
    toggle.setAttribute("role", "switch")
    toggle.checked = appState.guidesVisible
    toggle.addEventListener("change", () => setGuidesVisible(toggle.checked))
    guides.append(Object.assign(element("span"), { textContent: "辅助线与安全区" }), toggle)
    body.append(guides)
    form.append(header, body)
    dialog.append(form)
    bindDialog(dialog)
    dialog.addEventListener("close", () => dialog.remove(), { once: true })
    document.body.append(dialog)
    dialog.showModal()
  })
  const previewReturn = element("button", "ui-button mobile-preview-return")
  previewReturn.type = "button"
  previewReturn.dataset.variant = "primary"
  previewReturn.append(createIcon("pen-line"), "开始编辑")
  previewReturn.addEventListener("click", () => navButtons.find(button => button.dataset.mobilePage === "edit")?.click())
  canvasWrap.append(previewReturn)
  const settingsIndex = () => {
    settingsWorkspace.dataset.mobileSettings = "index"
    $("#settings-title").textContent = "设置"
  }
  const settingsBack = iconButton("arrow-left", "返回设置", () => {
    settingsIndex()
    $("#settings-title").focus({ preventScroll: true })
  })
  settingsBack.classList.add("mobile-settings-back")
  settingsWorkspace.querySelector(".settings-header")!.prepend(settingsBack)
  settingsWorkspace.addEventListener("settings-enter", () => {
    if (mobilePortraitQuery.matches) settingsIndex()
  })
  mobilePortraitQuery.addEventListener("change", settingsIndex)
  const accentInput = $("#interface-accent") as HTMLInputElement
  const accents = element("div", "mobile-accent-presets")
  for (const [name, label] of [["blue", "蓝色"], ["green", "雾绿"], ["purple", "紫色"], ["coral", "珊瑚"], ["slate", "石墨"]]) {
    const button = element("button", "ui-button")
    button.type = "button"
    button.dataset.accent = name
    button.setAttribute("aria-label", label)
    button.addEventListener("click", () => {
      accentInput.value = getComputedStyle(root).getPropertyValue(`--accent-preset-${name}`).trim()
      accentInput.dispatchEvent(new Event("change", { bubbles: true }))
    })
    accents.append(button)
  }
  const accentRow = accentInput.closest(".settings-row")!
  accentRow.classList.add("mobile-settings-accent-row")
  accentRow.append(accents)
  const modelNotice = element("section", "ui-section mobile-model-notice")
  modelNotice.append(Object.assign(element("h3"), { textContent: "在桌面应用中配置模型" }), Object.assign(element("p", "ui-field-note"), { textContent: "AI 设计需要桌面应用与已授权的模型服务。普通编辑和本地改色无需上传。" }))
  if (!nativeSettings) settingsWorkspace.querySelector("[data-settings-panel=model]")!.prepend(modelNotice)
  const modelLink = element("button", "ui-list-item mobile-model-link")
  modelLink.type = "button"
  modelLink.append(createIcon("sparkles"), "AI 模型", createIcon("chevron-right"))
  modelLink.addEventListener("click", () => showSettingsPage("model"))
  settingsWorkspace.querySelector(".settings-sidebar")!.insertBefore(modelLink, $("#settings-tab-about"))
  modelLink.hidden = !$("#settings-model-nav").hidden
  const unavailableModel = element("section", "mobile-model-unavailable")
  unavailableModel.append(Object.assign(element("h3"), { textContent: "对话模型" }), Object.assign(element("div"), { textContent: "服务商 · 未配置" }), Object.assign(element("div"), { textContent: "模型 · 请在桌面应用中设置" }), Object.assign(element("h3"), { textContent: "生图模型" }), Object.assign(element("div"), { textContent: "图片生成服务 · 未配置" }), Object.assign(element("p", "ui-field-note"), { textContent: "仅授权后，内容才发送到模型服务。普通编辑、预览和导出始终在本机处理。" }))
  settingsWorkspace.querySelector("[data-settings-panel=model]")!.append(unavailableModel)
  const modelPage = settingsWorkspace.querySelector<HTMLElement>("[data-settings-panel=model]")!
  if (modelLink.hidden === false) modelPage.removeAttribute("data-platform-hidden")
  modelPage.dataset.mobileUnavailable = String(!modelLink.hidden)
  wireMobileSettings()
  const sync = () => {
    const empty = canvasWrap.classList.contains("empty")
    if (empty || appState.inspectorTab !== "source") showFullSource = false
    const mobilePreview = mobilePortraitQuery.matches && mode.value === "preview" && !empty && !showFullSource
    if (mobilePreview && simulation.parentElement !== canvasWrap) canvasWrap.append(simulation)
    else if (!mobilePreview && simulation.parentElement !== simulationHome) simulationHome.insertBefore(simulation, simulationNext)
    simulation.classList.toggle("mobile-simulation", mobilePreview)
    simulatedOutput.placeholder = mobilePreview ? "" : simulationPlaceholder
    if (mobilePortraitQuery.matches) {
      if (resourceTheme.parentElement === themeHome) $(".mobile-resource-classification").append(resourceTheme)
      if (createResource.parentElement !== $(".resource-actions")) $(".resource-actions").prepend(createResource)
    } else {
      if (resourceTheme.parentElement !== themeHome) themeHome.insertBefore(resourceTheme, $("#resource-page-tabs"))
      if (createResource.previousSibling !== createHome) createHome.after(createResource)
    }
    if (!mobilePortraitQuery.matches) {
      if (workspaceImageFigure.parentElement !== figureHome && !workspaceImageFigure.closest("#atlas-editor-dialog")) figureHome.append(workspaceImageFigure)
      nav.hidden = true
      return
    }
    const name = documentName.textContent?.replace(/\.(?:bdi|bds|bda|ssf|mssf|sxi)$/i, "") ?? ""
    if (documentName.dataset.mobileName !== name) documentName.dataset.mobileName = name
    nav.hidden = false
    for (const button of navButtons) {
      if (!button.dataset.mobilePage) continue
      const disabled = appState.fileOperationRunning || button.dataset.mobilePage !== "home" && !appState.archive
      if (button.disabled !== disabled) button.disabled = disabled
    }
    root.dataset.mobileWelcome = String(empty)
    root.dataset.mobileMode = mode.value
    const aiDescription = [`键设 Chat`, name, appState.archive?.format.toUpperCase()].filter(Boolean).join(" · ")
    if (aiContext.textContent !== aiDescription) aiContext.textContent = aiDescription
    const fullSource = showFullSource && !sourceEditor.hidden && !appState.resourceConfigActive
    root.toggleAttribute("data-mobile-source", fullSource)
    root.toggleAttribute("data-mobile-source-return", !sourceEditor.hidden && (fullSource || quickInspector.hidden || inspectorSourceToggle.hidden))
    const metadata = !empty && !mobilePreview && !skinFieldsGroup.hidden && !quickInspector.hidden
    const library = !empty && !mobilePreview && !resourceInspector.hidden && appState.resourceConfigActive
    root.dataset.mobileResource = String(library || metadata)
    root.dataset.mobileResourceList = String(library && !$("#resource-list-view").hidden)
    const detail = library && !$("#resource-detail").hidden && appState.resourceInspectorMode === "image"
    if (detail) {
      if (workspaceImageFigure.parentElement !== $("#image-resource-detail")) $("#image-resource-detail").prepend(workspaceImageFigure)
    } else if (workspaceImageFigure.parentElement !== figureHome && !workspaceImageFigure.closest("#atlas-editor-dialog")) figureHome.append(workspaceImageFigure)
    const title = fullSource ? "源代码" : metadata ? "皮肤信息" : detail ? "图片与切片" : resourceListTitle.textContent
    if (routeTitle.textContent !== title) routeTitle.textContent = title
    root.dataset.mobileAnimation = String(appState.animationDesignMode !== "all")
    const page = empty ? "home" : mobilePreview ? "edit" : appState.inspectorTab === "ai" ? "ai" : appState.resourceConfigActive || appState.animationDesignMode !== "all" ? "resources" : "edit"
    if (root.dataset.mobilePage !== page) root.dataset.mobilePage = page
    syncNavigation()
    if (mobilePreview) root.dataset.mobilePreview = "true"
    else delete root.dataset.mobilePreview
  }
  const observer = new MutationObserver(sync)
  observer.observe(newButton, { attributes: true, attributeFilter: ["disabled"] })
  observer.observe(canvasWrap, { attributes: true, attributeFilter: ["class"] })
  observer.observe($("#resource-list-view"), { attributes: true, attributeFilter: ["hidden"] })
  observer.observe($("#resource-detail"), { attributes: true, attributeFilter: ["hidden"] })
  observer.observe(skinFieldsGroup, { attributes: true, attributeFilter: ["hidden"] })
  observer.observe(resourceInspector, { attributes: true, attributeFilter: ["hidden"] })
  observer.observe(inspectorTabs, { attributes: true, subtree: true, attributeFilter: ["aria-selected"] })
  observer.observe(root, { attributes: true, attributeFilter: ["data-mobile-pane"] })
  for (const view of [sourceEditor, inspectorSourceToggle, quickInspector]) observer.observe(view, { attributes: true, attributeFilter: ["hidden"] })
  observer.observe(documentName, { childList: true, characterData: true, subtree: true })
  mode.addEventListener("change", sync)
  files.addEventListener("click", event => {
    if (!mobilePortraitQuery.matches) return
    if ((event.target as Element).closest("[data-nav-mode]") && appState.sidebarView === "overview") {
      inspectorTabs.querySelector<HTMLButtonElement>('[data-inspector-tab="properties"]')?.click()
      if (appState.resourceConfigActive) showResourceList()
    }
    queueMicrotask(sync)
  })
  mobileAppMore.addEventListener("click", (event) => {
    if ((event.target as Element).closest("[data-mobile-action=mobile-source-view]")) showFullSource = true
    queueMicrotask(sync)
  })
  mobilePortraitQuery.addEventListener("change", sync)
  sync()
}
