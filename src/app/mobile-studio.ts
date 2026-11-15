import { element, iconButton } from "../dom-element"
import { showResourceList } from "./resource-inspector"
import { wireMobileShareReview } from "./mobile-share-review"
import { createIcon } from "../icons"
import { bindDialog } from "./ask"
import { closeDialog } from "../motion"
import { appState } from "./state"
import { mobilePortraitQuery, isTauri } from "./canvas-interaction"
import { setMobilePane, selectChoice } from "./mobile-layout"
import { selectFile } from "./navigation"
import { setSidebarView } from "./source-files"
import { prepareDocumentReplacement } from "./edit-history"
import { showSettingsPage } from "./preferences"
import { $, canvasWrap, mode, theme, orientation, device, settingsDialog, files, mobileAppMore, resourceInspector, mobileQuickActions, newButton, openButton, inspectorTabs, workspaceImageFigure, skinFieldsGroup, simulatedOutput } from "./dom"

/** 手机导航只组织现有视图，文件编辑和提交仍走各自模块。 */
export function wireMobileStudio(): void {
  wireMobileShareReview()
  const operationDialog = $("#file-operation-dialog") as HTMLDialogElement
  for (const button of operationDialog.querySelectorAll<HTMLButtonElement>("[data-operation-close]")) button.addEventListener("click", () => ($("#file-operation-close") as HTMLButtonElement).click())
  $("#mobile-operation-share").addEventListener("click", async () => { await closeDialog(operationDialog); $("#mobile-share").click() })
  const retry = $("#mobile-operation-retry") as HTMLButtonElement
  retry.addEventListener("click", async () => {
    const action = appState.currentFileOperation
    if (appState.fileOperationRunning || !appState.archive || !["保存", "导出"].includes(action)) return
    await closeDialog(operationDialog)
    $(action === "保存" ? "#mobile-save" : "#mobile-export-open").click()
  })
  new MutationObserver(() => {
    const action = appState.currentFileOperation || "文件操作"
    $("#mobile-operation-title").textContent = operationDialog.dataset.stage === "compatibility" ? "兼容性确认" : `${action}${operationDialog.dataset.outcome === "success" ? "完成" : operationDialog.dataset.outcome === "error" ? "失败" : "处理中"}`
    const disabled = ($("#file-operation-close") as HTMLButtonElement).disabled
    for (const button of operationDialog.querySelectorAll<HTMLButtonElement>("[data-operation-close]")) if (button.disabled !== disabled) button.disabled = disabled
    retry.hidden = operationDialog.dataset.outcome !== "error" || !["保存", "导出"].includes(action) || !appState.archive
    retry.textContent = action === "保存" ? "重试保存" : "重试导出"
  }).observe(operationDialog, { attributes: true, subtree: true, attributeFilter: ["data-outcome", "data-stage", "disabled"] })
  $("#mobile-export-open").addEventListener("click", () => { $("#mobile-export-source").textContent = `当前皮肤 · ${$("#document-name").textContent}` })
  const root = document.documentElement
  const nav = $("#mobile-navigation")
  const routeTitle = element("strong", "mobile-route-title")
  const routeClose = iconButton("x", "返回编辑", () => nav.querySelector<HTMLButtonElement>('[data-mobile-page="edit"]')!.click())
  routeClose.classList.add("mobile-route-close")
  $(".titlebar").append(routeTitle)
  $(".titlebar-right").append(routeClose)
  const figureHome = workspaceImageFigure.parentElement!
  const simulation = simulatedOutput.closest<HTMLElement>(".simulation")!
  const simulationHome = simulation.parentElement!
  const simulationNext = simulation.nextSibling
  const simulationPlaceholder = simulatedOutput.placeholder
  const simulationNote = element("p", "ui-field-note")
  simulationNote.textContent = "仅模拟外观与按键状态"
  simulationNote.hidden = true
  simulation.append(simulationNote)
  const sourceReturn = element("button", "ui-button mobile-source-return")
  sourceReturn.type = "button"
  sourceReturn.textContent = "返回属性"
  sourceReturn.addEventListener("click", () => inspectorTabs.querySelector<HTMLButtonElement>('[data-inspector-tab="properties"]')!.click())
  $(".inspector-view-controls").append(sourceReturn)
  const setPage = (page: string) => {
    root.dataset.mobilePage = page
    for (const button of nav.querySelectorAll<HTMLElement>("button")) {
      if (button.dataset.mobilePage === page) button.setAttribute("aria-current", "page")
      else button.removeAttribute("aria-current")
    }
  }
  const openResource = (kind: string) => {
    const entry = files.querySelector<HTMLButtonElement>(`.sidebar-overview [data-nav-mode="${kind}"]`)
    if (!entry) return
    entry.click()
    showResourceList()
    inspectorTabs.querySelector<HTMLButtonElement>('[data-inspector-tab="properties"]')?.click()
    setMobilePane("inspector")
    setPage("resources")
    for (const button of document.querySelectorAll<HTMLElement>("[data-mobile-resource]")) button.setAttribute("aria-pressed", String(button.dataset.mobileResource === kind))
  }
  for (const button of nav.querySelectorAll<HTMLButtonElement>("button")) button.addEventListener("click", () => {
    if (!appState.archive) return
    const page = button.dataset.mobilePage!
    if (page === "resources") openResource("style")
    else if (page === "project") { setSidebarView("overview"); setMobilePane("layout"); setPage(page) }
    else {
      if (appState.layoutPath && appState.selectedPath !== appState.layoutPath) selectFile(appState.layoutPath)
      inspectorTabs.querySelector<HTMLButtonElement>('[data-inspector-tab="properties"]')?.click()
      setMobilePane("inspector")
      setPage(page)
    }
  })
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-mobile-resource]")) button.addEventListener("click", () => openResource(button.dataset.mobileResource!))
  $("#mobile-preview-summary").addEventListener("click", () => { setSidebarView("overview"); setMobilePane("layout"); setPage("project") })
  $("#mobile-home").addEventListener("click", () => void (async () => {
    if (root.dataset.mobilePage !== "edit") { nav.querySelector<HTMLButtonElement>('[data-mobile-page="edit"]')!.click(); return }
    if (!(await prepareDocumentReplacement())) return
    canvasWrap.classList.add("empty")
    setMobilePane("canvas")
    setPage("edit")
  })())
  $("#mobile-welcome-new").addEventListener("click", () => newButton.click())
  $("#mobile-welcome-open").addEventListener("click", event => {
    if (!mobilePortraitQuery.matches) return
    event.stopImmediatePropagation()
    const dialog = element("dialog", "ui-dialog ui-mobile-page")
    dialog.setAttribute("aria-label", "打开皮肤")
    const form = element("form")
    form.method = "dialog"
    const header = element("header", "ui-dialog-header")
    header.append(Object.assign(element("h2"), { textContent: "打开皮肤" }))
    const body = element("div", "ui-dialog-body")
    body.append(Object.assign(element("h1"), { textContent: "打开你的皮肤" }), Object.assign(element("p", "ui-field-note"), { textContent: "百度 · 搜狗 · 手心" }))
    const choose = element("button", "ui-mobile-file-choice")
    choose.type = "button"
    choose.append(createIcon("plus"), Object.assign(element("strong"), { textContent: "从“文件”中选择" }), Object.assign(element("small"), { textContent: ".bdi  .bds  .bda  .ssf  .mssf  .sxi" }))
    // 系统文件选择器需要在同一次点击中接管模态层，保留 iOS 用户手势。
    choose.addEventListener("click", () => { dialog.close(); openButton.click() })
    body.append(choose, Object.assign(element("h3"), { textContent: "最近打开" }))
    const recent = $("#welcome-recent-grid").cloneNode(true) as HTMLElement
    recent.removeAttribute("id")
    recent.querySelectorAll("[id]").forEach(node => node.removeAttribute("id"))
    const originals = $("#welcome-recent-grid").querySelectorAll<HTMLButtonElement>("button")
    recent.querySelectorAll<HTMLButtonElement>("button").forEach((button, index) => button.addEventListener("click", () => { originals[index]?.click(); void closeDialog(dialog) }))
    body.append(recent, Object.assign(element("p", "ui-field-note"), { textContent: "文件只在本机处理，不会上传" }))
    form.append(header, body)
    dialog.append(form)
    bindDialog(dialog)
    dialog.addEventListener("close", () => dialog.remove(), { once: true })
    document.body.append(dialog)
    dialog.showModal()
  }, { capture: true })
  const canvasOptions = element("button", "ui-button mobile-canvas-options")
  canvasOptions.type = "button"
  canvasOptions.textContent = "画布选项"
  canvasOptions.addEventListener("click", () => {
    const dialog = element("dialog", "ui-dialog ui-mobile-sheet")
    dialog.setAttribute("aria-label", "画布选项")
    const form = element("form")
    form.method = "dialog"
    const header = element("header", "ui-dialog-header")
    header.append(Object.assign(element("h2"), { textContent: "画布选项" }))
    const body = element("div", "ui-dialog-body")
    for (const [label, select] of [["设备", device], ["方向", orientation], ["外观", theme]] as const) {
      if (select !== device) {
        const choices = element("div", "ui-segmented")
        choices.setAttribute("aria-label", label)
        choices.setAttribute("data-fill", "")
        for (const option of select.options) {
          const button = element("button")
          button.type = "button"
          button.textContent = option.textContent
          button.setAttribute("aria-pressed", String(select.value === option.value))
          button.addEventListener("click", () => {
            selectChoice(select, option.value)
            for (const [index, sibling] of [...choices.querySelectorAll("button")].entries()) sibling.setAttribute("aria-pressed", String(select.options[index]?.value === select.value))
          })
          choices.append(button)
        }
        body.append(choices)
        continue
      }
      const row = element("label", "ui-field")
      const field = element("select", "ui-input")
      field.setAttribute("aria-label", label)
      field.append(...Array.from(select.options, option => new Option(option.textContent ?? option.value, option.value)))
      field.value = select.value
      field.addEventListener("change", () => selectChoice(select, field.value))
      row.append(Object.assign(element("span"), { textContent: label }), field)
      body.append(row)
    }
    const guides = element("button", "ui-list-item")
    guides.type = "button"
    const toggle = element("input", "ui-switch")
    toggle.type = "checkbox"
    toggle.setAttribute("role", "switch")
    toggle.setAttribute("aria-label", "辅助线与安全区")
    toggle.checked = appState.guidesVisible
    guides.append("辅助线与安全区", toggle)
    guides.addEventListener("click", () => { $("#toggle-guides").click(); toggle.checked = appState.guidesVisible })
    body.append(guides)
    form.append(header, body)
    dialog.append(form)
    bindDialog(dialog)
    dialog.addEventListener("close", () => dialog.remove(), { once: true })
    document.body.append(dialog)
    dialog.showModal()
  })
  canvasWrap.append(canvasOptions)
  const previewReturn = element("button", "ui-button mobile-preview-return")
  previewReturn.type = "button"
  previewReturn.dataset.variant = "primary"
  previewReturn.textContent = "返回编辑"
  previewReturn.addEventListener("click", () => selectChoice(mode, "edit"))
  canvasWrap.append(previewReturn)
  const settingsBack = iconButton("arrow-left", "返回设置", () => { settingsDialog.dataset.mobileSettings = "index" })
  settingsBack.classList.add("mobile-settings-back")
  settingsDialog.querySelector(".settings-header")!.prepend(settingsBack)
  for (const button of settingsDialog.querySelectorAll<HTMLButtonElement>("[data-settings-page]")) button.addEventListener("click", () => {
    settingsDialog.dataset.mobileSettings = "detail"
    $("#settings-title").textContent = button.querySelector("span:nth-child(2)")?.textContent ?? "设置"
  })
  new MutationObserver(() => {
    if (!settingsDialog.open || !mobilePortraitQuery.matches) return
    settingsDialog.dataset.mobileSettings = "index"
    $("#settings-title").textContent = "设置"
  }).observe(settingsDialog, { attributes: true, attributeFilter: ["open"] })
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
  accentInput.closest(".settings-row")!.append(accents)
  const modelNotice = element("section", "ui-section mobile-model-notice")
  modelNotice.append(Object.assign(element("h3"), { textContent: "在桌面应用中配置模型" }), Object.assign(element("p", "ui-field-note"), { textContent: "AI 设计需要桌面应用与已授权的模型服务。普通编辑和本地改色无需上传。" }))
  settingsDialog.querySelector("[data-settings-panel=model]")!.prepend(modelNotice)
  const modelLink = element("button", "ui-list-item mobile-model-link")
  modelLink.type = "button"
  modelLink.append(createIcon("sparkles"), "AI 模型", createIcon("chevron-right"))
  modelLink.addEventListener("click", () => {
    showSettingsPage("model")
    settingsDialog.dataset.mobileSettings = "detail"
    $("#settings-title").textContent = "AI 模型设置"
  })
  settingsDialog.querySelector(".settings-sidebar")!.insertBefore(modelLink, $("#settings-tab-about"))
  modelLink.hidden = !$("#settings-model-nav").hidden
  const unavailableModel = element("section", "mobile-model-unavailable")
  unavailableModel.append(Object.assign(element("h3"), { textContent: "对话模型" }), Object.assign(element("div"), { textContent: "服务商 · 未配置" }), Object.assign(element("div"), { textContent: "模型 · 请在桌面应用中设置" }), Object.assign(element("h3"), { textContent: "生图模型" }), Object.assign(element("div"), { textContent: "图片生成服务 · 未配置" }), Object.assign(element("p", "ui-field-note"), { textContent: "仅授权后，内容才发送到模型服务。普通编辑、预览和导出始终在本机处理。" }))
  settingsDialog.querySelector("[data-settings-panel=model]")!.append(unavailableModel)
  root.dataset.mobileAiUnavailable = String(!isTauri())
  $("#mobile-ai-return").addEventListener("click", () => inspectorTabs.querySelector<HTMLButtonElement>('[data-inspector-tab="properties"]')!.click())
  $("#mobile-ai-privacy").addEventListener("click", () => { $("#mobile-app-more [data-app-dialog=settings]").click(); modelLink.click() })
  document.querySelectorAll("[data-sidebar-view]").forEach(button => button.addEventListener("click", () => queueMicrotask(sync)))
  const modelPage = settingsDialog.querySelector<HTMLElement>("[data-settings-panel=model]")!
  if (modelLink.hidden === false) modelPage.removeAttribute("data-platform-hidden")
  modelPage.dataset.mobileUnavailable = String(!modelLink.hidden)
  const sync = () => {
    const mobilePreview = mobilePortraitQuery.matches && mode.value === "preview" && !canvasWrap.classList.contains("empty")
    if (mobilePreview && simulation.parentElement !== canvasWrap) canvasWrap.append(simulation)
    else if (!mobilePreview && simulation.parentElement !== simulationHome) simulationHome.insertBefore(simulation, simulationNext)
    simulation.classList.toggle("mobile-simulation", mobilePreview)
    simulationNote.hidden = !mobilePreview
    simulatedOutput.placeholder = mobilePreview ? "每次敲击，\n都有一点小确幸。" : simulationPlaceholder
    if (!mobilePortraitQuery.matches) {
      if (workspaceImageFigure.parentElement !== figureHome) figureHome.append(workspaceImageFigure)
      nav.hidden = true
      return
    }
    $("#document-name").dataset.mobileName = $("#document-name").textContent?.replace(/\.(?:bdi|bds|bda|ssf|mssf|sxi)$/i, "")
    const empty = canvasWrap.classList.contains("empty")
    nav.hidden = empty
    root.dataset.mobileWelcome = String(empty)
    root.dataset.mobileMode = mode.value
    const metadata = !skinFieldsGroup.hidden && !$("#quick-inspector").hidden
    const library = !resourceInspector.hidden && appState.resourceConfigActive
    root.dataset.mobileResource = String(library || metadata)
    root.dataset.mobileLibrary = String(library)
    const resourceKind = appState.resourceInspectorMode === "style" ? "style" : appState.resourceInspectorMode === "sound" ? "sound" : "resource"
    for (const button of document.querySelectorAll<HTMLElement>("[data-mobile-resource]")) button.setAttribute("aria-pressed", String(button.dataset.mobileResource === resourceKind))
    const detail = library && !$("#resource-detail").hidden && appState.resourceInspectorMode === "image"
    if (detail) {
      if (workspaceImageFigure.parentElement !== $("#image-resource-detail")) $("#image-resource-detail").prepend(workspaceImageFigure)
    } else if (workspaceImageFigure.parentElement !== figureHome) figureHome.append(workspaceImageFigure)
    routeTitle.textContent = metadata ? "皮肤信息" : root.dataset.mobilePane === "layout" ? appState.sidebarView === "source" ? "源文件" : "项目概览" : appState.resourceInspectorMode === "style" ? "全部样式" : appState.resourceInspectorMode === "sound" ? "音效资源" : detail ? "图片与切片" : "全部图片"
    root.dataset.mobileAnimation = String(appState.animationDesignMode !== "all")
    if (!empty && root.dataset.mobilePane === "layout") setPage("project")
    else if (!empty && metadata) setPage("project")
    else if (!empty && (appState.resourceConfigActive || appState.animationDesignMode !== "all")) setPage("resources")
    else setPage("edit")
    $(".mobile-page-heading").textContent = appState.sidebarView === "source" ? "源文件" : "项目概览"
    $("#mobile-canvas-mode [data-mode-choice=edit]").lastChild!.textContent = "编辑"
    nav.hidden = empty
    if (!empty && mode.value === "preview") root.dataset.mobilePreview = "true"
    else delete root.dataset.mobilePreview
    if (!appState.mobileStudioStarted && !empty) {
      appState.mobileStudioStarted = true
      selectChoice(mode, "edit")
    }
  }
  new MutationObserver(sync).observe(canvasWrap, { attributes: true, attributeFilter: ["class"] })
  new MutationObserver(sync).observe($("#resource-detail"), { attributes: true, attributeFilter: ["hidden"] })
  new MutationObserver(sync).observe(skinFieldsGroup, { attributes: true, attributeFilter: ["hidden"] })
  new MutationObserver(sync).observe(resourceInspector, { attributes: true, attributeFilter: ["hidden"] })
  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ["data-mobile-pane"] })
  new MutationObserver(sync).observe($("#document-name"), { childList: true, characterData: true, subtree: true })
  mode.addEventListener("change", sync)
  files.addEventListener("click", event => {
    if (!mobilePortraitQuery.matches) return
    if ((event.target as Element).closest("[data-nav-mode]") && appState.sidebarView === "overview") {
      inspectorTabs.querySelector<HTMLButtonElement>('[data-inspector-tab="properties"]')?.click()
      if (appState.resourceConfigActive) showResourceList()
    }
    queueMicrotask(sync)
  })
  mobileAppMore.addEventListener("click", () => queueMicrotask(sync))
  const placeHistory = () => { if (mobilePortraitQuery.matches) $("#mobile-canvas-history").append(mobileQuickActions) }
  mobilePortraitQuery.addEventListener("change", () => { placeHistory(); sync() })
  placeHistory()
  sync()
}
