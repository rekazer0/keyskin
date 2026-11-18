import { ask, confirmDeletion } from "../ask"
import { wireSourceFileMenu } from "../source-file-menu"
import { wireAiSessions } from "../ai-sessions"
import { openShareDialog, wireMobileExport } from "../mobile-export"
import { wirePinnedToolbar } from "../pinned-toolbar"
import { wireAdbShare } from "../adb-share"
import { sourceEditPath } from "../ssf-documents"
import { requestEditMode, setMobilePane } from "../mobile-layout"
import { sourceUploadButton, sourcePasteButton, sourceMoveButton, sourceDeleteButton, toolbarMenus, newButton, openButton, browserOpen, $, saveButton, mobileShareButton, checkUpdateButton, aboutDiagnostics, exportLogsButton, exportLogsStatus, copyQqGroupButton, settingsEntryButtons, settingsWorkspace, settingsModelNav, settingsStorageSection, settingsModelSection, aiDraftApply, aiDraftCancel, sourceDirectoryEnabled, sourceDirectory, chooseSourceDirectory, resetSourceDirectory, sourceDirectoryStatus, sidebarViewButtons, defaultDevice, device, canvasBackground, hintPreviewEnabled, editorCrosshair, editorCoordinateSnap, appTheme, interfaceTheme, sourceFontSize, windowMaterial, windowMaterialOpacity, overviewMetaVisible, files, sourceCompletionEnabled, sourceValueHintsEnabled, sourceLineExplanationEnabled, undoButton, redoButton, fileOperationDialog, canvasWrap, replaceAssetButton, imageOpen, assetBackButton, sourceColorPicker } from "../dom"
import { appState } from "../state"
import { isEditing, commitBatch, prepareDocumentReplacement, undo, redo, commitBytes, updateDirty, commitText } from "../edit-history"
import { wireSourceFileSearch, sourceTargetFolder, sourceCopyPath, refreshAfterSourceMutation, setSourceTransfer, sourceSelections, sourcePaths, setSidebarView, revealSourceFile } from "../source-files"
import { type Change } from "../../history.ts"
import { preview, source, scheduleSelectionInspectorSync, isTauri, settingsNavItems, isAndroidTauri, isAndroidWeb, isIOSWeb, LAST_SOURCE_WORKSPACE_KEY, currentDeviceValue } from "../canvas-interaction"
import { startNewDocument, wireNewProjectChooser } from "../new-document"
import { runFileOperation, readBrowserSkinFile, showImage, showStatus, showError } from "../file-operations"
import { openNative, saveArchive, currentExportFormat, shareArchiveToMobile, writeToChosenFile, isSupportedSkinPath, loadDroppedFile, openSkinBytes, UNSUPPORTED_SKIN_MESSAGE } from "../archive-io"
import { recentFilesKey, recentPreviewCache, recentThumbRequest, renderRecentFiles, wireRecentPage } from "../recent-files"
import { dismissLayoutOverview } from "../layout-overview"
import { releaseArchivePreview } from "../../template-preview"
import { refreshUpdateStatus, settingsController, showSettingsPage, nativeSettings, savedDefaultDevice, applyCanvasBackground, initialCanvasBackground, applyEditorCrosshairSetting, applyAppTheme, systemTheme, savedSourceFontSize, applySourceFontSize, saveSourceFontSize, initializeWindowMaterial, handleWindowMaterialError, applyWindowMaterialWithRetry, currentWindowMaterialOpacity, applyWindowMaterialOpacity, startWindowsWindowDrag, restoreWindowMaterialAfterDrag, applySourceEditorFeatures, setCanvasDropState } from "../preferences"
import { clientLogZip, clientLog } from "../../client-log.ts"
import { applyAiDesignDraft, discardAiDesignDraft, toggleAiDraftComparison } from "../ai-panel"
import { activateSourceWorkspace, chooseAndroidSourceDirectory, applySourceDirectory } from "../source-workspace"
import { invoke } from "@tauri-apps/api/core"
import { open } from "@tauri-apps/plugin-dialog"
import { canvasDeviceValue, type CanvasBackground } from "../../canvas-background.ts"
import { updateDevicePreview, refreshPreview } from "../preview-render"
import { setLayoutImageHighlight, setLayoutImageBytes, openLayoutImageDialog } from "../layout-image-replace"
import { selectFile } from "../navigation"
import { isBdaAppearancePartPath, commitBdaSourceEdit } from "../bda-documents"
import { commitSxiSourceEdit, isSxiSourcePath } from "../sxi-documents"
import { scheduleSourceInputHighlight, applySourceColorPicker, selectKeyFromSourceOffset } from "../source-panel"
import { IniDocument } from "../../ini.ts"
import { tileSlices } from "../../tiles.ts"
import { bindListActionKeys, bindMenuKeys } from "../../dom-element.ts"
import { populateTileInspector, drawAtlas } from "../tile-editing"
import { type SourceEditorCursorMove } from "../../lazy-source-editor.ts"
import { keyEventElement } from "../key-editing"

/** 源文件工具栏、源码目录、设置项、窗口事件与拖放。只在启动时由 main.ts 按顺序调用一次。 */
export function wireFilesAndSettings(): void {
  wirePinnedToolbar()
  wireAdbShare()
  wireSourceFileMenu()
  wireSourceFileSearch()
  for (const button of [sourceUploadButton, sourcePasteButton, sourceMoveButton, sourceDeleteButton]) {
    button.addEventListener("click", (event) => {
      if (isEditing()) return
      event.stopImmediatePropagation()
      requestEditMode()
    }, { capture: true })
  }
  sourcePasteButton.addEventListener("click", () => {
    if (!appState.archive || !isEditing() || !appState.sourceTransfer?.files.length) return
    const folder = sourceTargetFolder()
    if (appState.sourceTransfer.mode === "move" && appState.sourceTransfer.roots.some(root =>
      root.folder && (folder === root.sourcePath || folder.startsWith(`${root.sourcePath}/`)))) {
      showError(new Error("不能将文件夹移动到自身内部"), "移动")
      return
    }
    let copies = appState.sourceTransfer.files.map(({ path, source, bytes }) => ({
      path: folder ? `${folder}/${path}` : path,
      source,
      bytes,
    }))
    if (appState.sourceTransfer.mode === "move" && copies.every(({ path, source }) => path === source)) return
    // 复制后粘贴回原位置：按访达习惯另存为「名称 副本」，而不是询问是否用自己替换自己。
    if (appState.sourceTransfer.mode === "copy") {
      const names = [...appState.archive.names(), ...copies.map(copy => copy.path)]
      for (const root of appState.sourceTransfer.roots) {
        const top = `${folder ? `${folder}/` : ""}${root.path}`
        if (top !== root.sourcePath) continue
        const renamed = sourceCopyPath(top, candidate => names.some(name => name === candidate || name.startsWith(`${candidate}/`)))
        copies = copies.map(copy => copy.path === top || root.folder && copy.path.startsWith(`${top}/`)
          ? { ...copy, path: renamed + copy.path.slice(top.length) } : copy)
        names.push(renamed)
      }
    }
    // 覆盖同名文件和删除一样进撤销栈，不再弹确认框（DESIGN.md §7）。
    const sources = new Set(appState.sourceTransfer.files.map(({ source }) => source))
    const changes: Change[] = copies.map(({ path, bytes }) => ({
      kind: "bytes",
      path,
      before: appState.archive!.getBytes(path)?.slice(),
      after: bytes.slice(),
    }))
    if (appState.sourceTransfer.mode === "move") {
      for (const source of sources) {
        if (!copies.some(({ path }) => path === source)) {
          changes.push({ kind: "bytes", path: source, before: appState.archive.getBytes(source)?.slice() })
        }
      }
      appState.sourceTransfer = undefined
    }
    commitBatch(changes)
    refreshAfterSourceMutation(copies[0]?.path)
  })
  sourceMoveButton.addEventListener("click", () => {
    setSourceTransfer("move")
  })
  bindListActionKeys(files, sourceDeleteButton.parentElement!)
  sourceDeleteButton.addEventListener("click", async () => {
    const archive = appState.archive
    const selected = sourceSelections()
    if (!archive || !selected.length || !isEditing()) return
    const paths = [...new Set(selected.flatMap(sourcePaths))]
    if (!paths.length) return
    const revision = archive.revision
    if (!await confirmDeletion(`删除 ${selected.length} 项源文件？`) || appState.archive !== archive || archive.revision !== revision || !isEditing()) return
    commitBatch(paths.map((path) => ({
      kind: "bytes",
      path,
      before: archive.getBytes(path)?.slice(),
    })))
    refreshAfterSourceMutation()
    showStatus(`已删除 ${selected.length} 项，可撤销`)
  })
  for (const menu of toolbarMenus) {
    bindMenuKeys(menu)
    menu.addEventListener("click", (event) => {
      if ((event.target as Element).closest("button")) menu.open = false
    })
  }
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.isComposing || event.defaultPrevented) return
    const menuOpen = toolbarMenus.some((menu) => menu.open)
    for (const menu of toolbarMenus) menu.open = false
    // Esc 取消画布上的按键选择（与点空白处一致）；输入框、弹窗和菜单里的 Esc 留给它们自己。
    if (menuOpen || !settingsWorkspace.hidden || !isEditing() || !appState.selectedKeySections.length || document.querySelector("dialog[open]")) return
    if (keyEventElement(event.target)?.closest("input, textarea, select, [contenteditable], .cm-editor")) return
    preview.setSelected([])
    appState.selectedKeySections = []
    source.collapseSelection()
    scheduleSelectionInspectorSync(preview)
  })
  // ⌘/Ctrl + S 保存；不接管的话浏览器会弹“保存网页”。
  document.addEventListener("keydown", (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "s") return
    event.preventDefault()
    if (document.querySelector("dialog[open]")) return
    if (!settingsWorkspace.hidden) { $("#settings-save").click(); return }
    if (saveButton.disabled) return
    // 正在输入的字段先提交，保存下来的才是屏幕上的值。
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    saveButton.click()
  })
  wireNewProjectChooser()
  newButton.addEventListener("click", () => void startNewDocument())
  openButton.addEventListener("click", () => {
    if (isTauri()) void runFileOperation("打开", openNative)
    // 文件选择框必须在点击里同步弹出：先等导出确认再 click()，移动端浏览器会因失去用户手势而拦掉选择框。
    else browserOpen.click()
  })
  wireRecentPage()
  $("#recent-clear")?.addEventListener("click", () => {
    localStorage.removeItem(recentFilesKey)
    for (const cached of recentPreviewCache.values()) releaseArchivePreview(cached.image)
    recentPreviewCache.clear()
    void recentThumbRequest("readwrite", (store) => store.clear()).catch(() => undefined)
    renderRecentFiles()
  })
  $("#welcome-recent-open")?.addEventListener("click", () => openButton.click())
  $("#mobile-welcome-open").addEventListener("click", () => openButton.click())
  // 回到启动页但不关闭当前皮肤；打开别的皮肤时再询问是否导出。
  $("#recent-files")?.addEventListener("click", () => {
    dismissLayoutOverview()
    canvasWrap.classList.add("empty")
    setMobilePane("canvas")
    renderRecentFiles()
  })
  renderRecentFiles()
  saveButton.addEventListener("click", () => {
    openShareDialog()
    void runFileOperation("保存", () => saveArchive(false, currentExportFormat()))
  })
  mobileShareButton.addEventListener("click", () => {
    openShareDialog()
    void runFileOperation("分享皮肤", shareArchiveToMobile)
  })
  wireMobileExport()
  checkUpdateButton.addEventListener("click", () => void refreshUpdateStatus())
  aboutDiagnostics.hidden = !isTauri()
  exportLogsButton.addEventListener("click", () => void runFileOperation("导出日志", async () => {
    exportLogsButton.disabled = true
    exportLogsStatus.textContent = "正在整理日志…"
    try {
      const date = new Date().toISOString().slice(0, 10)
      const path = await writeToChosenFile(`keyskin-logs-${date}.zip`, await clientLogZip(), "诊断日志")
      exportLogsStatus.textContent = path ? "日志已导出。" : "已取消导出。"
      return Boolean(path)
    } catch (error) {
      exportLogsStatus.textContent = `导出失败：${error instanceof Error ? error.message : String(error)}`
      clientLog.error("logs.export_failed", {}, error)
      throw error
    } finally {
      exportLogsButton.disabled = false
    }
  }))
  // 连点时第二次读到的是「已复制」：原文案只在绑定时取一次。
  const qqGroupLabel = copyQqGroupButton.textContent ?? "QQ群：228040912"
  let qqGroupReset = 0
  copyQqGroupButton.addEventListener("click", async () => {
    const value = "228040912"
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value)
      else throw new Error("clipboard unavailable")
    } catch {
      const fallback = document.createElement("textarea")
      fallback.value = value
      fallback.style.position = "fixed"
      fallback.style.opacity = "0"
      document.body.append(fallback)
      fallback.select()
      document.execCommand("copy")
      fallback.remove()
    }
    copyQqGroupButton.textContent = "QQ群号已复制"
    window.clearTimeout(qqGroupReset)
    qqGroupReset = window.setTimeout(() => { copyQqGroupButton.textContent = qqGroupLabel }, 1400)
  })
  const settingsTitle = $("#settings-title")
  let settingsTrigger: HTMLElement | undefined
  let confirmingSettingsExit = false
  settingsWorkspace.addEventListener("settings-exit", () => {
    const fallback = $('[data-settings-entry="settings"]')
    const button = settingsTrigger?.getClientRects().length ? settingsTrigger : fallback
    button.focus({ preventScroll: true })
  })
  for (const button of settingsEntryButtons) {
    button.addEventListener("click", () => {
      const entry = button.dataset.settingsEntry!
      const opening = settingsWorkspace.hidden
      if (opening) {
        settingsTrigger = button
        settingsController.begin()
        settingsWorkspace.hidden = false
        settingsWorkspace.dispatchEvent(new Event("settings-enter"))
      }
      if (entry !== "settings") showSettingsPage(entry)
      for (const menu of toolbarMenus) menu.open = false
      if (opening || entry !== "settings") settingsTitle.focus({ preventScroll: true })
    })
  }
  const leaveSettings = async (next?: HTMLButtonElement) => {
    if (settingsWorkspace.hidden || settingsController.isSaving() || confirmingSettingsExit) return
    if (settingsController.dirty()) {
      confirmingSettingsExit = true
      try {
        if (await ask({ title: "放弃未保存的设置？", detail: "离开后，本次未保存的设置会恢复为之前的值。", actions: [
          { label: "继续编辑", value: "cancel" }, { label: "放弃更改", value: "discard", variant: "danger" },
        ] }) !== "discard") return
      } finally { confirmingSettingsExit = false }
    }
    settingsController.cancel()
    if (next) {
      next.focus({ preventScroll: true })
      next.click()
    }
  }
  settingsWorkspace.addEventListener("settings-request-exit", () => void leaveSettings())
  document.addEventListener("keydown", (event) => {
    if (settingsWorkspace.hidden || document.querySelector("dialog[open]") || event.isComposing || event.defaultPrevented) return
    if (event.key === "Escape") {
      event.preventDefault()
      void leaveSettings()
    }
  })
  for (const nav of [$("#workspace-navigation"), $("#mobile-navigation")]) nav.addEventListener("click", (event) => {
    if (settingsWorkspace.hidden) return
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-workspace-page], [data-mobile-page]")
    if (!button) return
    event.stopImmediatePropagation()
    void leaveSettings(button)
  }, true)
  for (const button of settingsNavItems) {
    button.addEventListener("click", () => showSettingsPage(button.dataset.settingsPage ?? "appearance"))
    button.addEventListener("keydown", (event) => {
      if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
      event.preventDefault()
      const visibleItems = settingsNavItems.filter(item => !item.hidden)
      const offset = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1
      const index = visibleItems.indexOf(button)
      const next = event.key === "Home" ? visibleItems[0] : event.key === "End" ? visibleItems.at(-1) : visibleItems[(index + offset + visibleItems.length) % visibleItems.length]
      next?.focus()
      next?.click()
    })
  }
  settingsModelNav.hidden = !nativeSettings
  if (!nativeSettings) settingsStorageSection.hidden = true
  settingsModelSection.toggleAttribute("data-platform-hidden", !nativeSettings)
  // 网页端拿不到文件路径，不记录最近打开；也没有模型设置，AI 设计用不了。
  $(".welcome-recent")!.toggleAttribute("data-platform-hidden", !nativeSettings)
  $('[data-inspector-tab="ai"]')!.hidden = !nativeSettings
  showSettingsPage("appearance")
  wireAiSessions()
  aiDraftApply.addEventListener("click", () => applyAiDesignDraft())
  $("#ai-draft-compare").addEventListener("click", toggleAiDraftComparison)
  aiDraftCancel.addEventListener("click", () => {
    discardAiDesignDraft("草稿已丢弃 · 本轮未修改皮肤，可调整要求后重试")
  })
  sourceDirectoryEnabled.addEventListener("change", () => void (async () => {
    if (!sourceDirectoryEnabled.checked) {
      if (isAndroidTauri()) localStorage.removeItem("source-directory-enabled")
      else localStorage.setItem("source-directory-enabled", "false")
      localStorage.removeItem(LAST_SOURCE_WORKSPACE_KEY)
      appState.sourceWorkspacePendingArchive = undefined
      await activateSourceWorkspace("", "")
      sourceDirectory.disabled = true
      chooseSourceDirectory.disabled = true
      resetSourceDirectory.disabled = true
      if (isAndroidTauri()) {
        localStorage.removeItem("source-directory")
        sourceDirectory.value = ""
      }
      sourceDirectoryStatus.textContent = "已关闭 · 不会写入源码文件"
      return
    }
    if (isAndroidTauri()) {
      const granted = await chooseAndroidSourceDirectory()
      sourceDirectoryEnabled.checked = granted
      sourceDirectory.disabled = !granted
      chooseSourceDirectory.disabled = !granted
      if (granted) localStorage.setItem("source-directory-enabled", "true")
      else sourceDirectoryStatus.textContent = "未授权 · 不会写入源码文件"
      return
    }
    localStorage.setItem("source-directory-enabled", "true")
    sourceDirectory.disabled = false
    chooseSourceDirectory.disabled = false
    resetSourceDirectory.disabled = false
    await applySourceDirectory(localStorage.getItem("source-directory"))
  })())
  sourceDirectory.addEventListener("change", () => void applySourceDirectory(sourceDirectory.value))
  sourceDirectory.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return
    event.preventDefault()
    void applySourceDirectory(sourceDirectory.value)
  })
  chooseSourceDirectory.addEventListener("click", () => void (async () => {
    if (isAndroidTauri()) {
      await chooseAndroidSourceDirectory()
      return
    }
    const path = await open({
      multiple: false,
      directory: true,
      title: "选择皮肤源码保存目录",
      defaultPath: sourceDirectory.value || undefined,
    })
    if (typeof path === "string") await applySourceDirectory(path)
  })())
  resetSourceDirectory.addEventListener("click", () => void applySourceDirectory(null))
  for (const button of sidebarViewButtons) {
    button.addEventListener("click", () => setSidebarView(button.dataset.sidebarView === "source" ? "source" : "overview"))
  }
  defaultDevice.value = Array.from(defaultDevice.options).some((option) => option.value === savedDefaultDevice)
    ? savedDefaultDevice!
    : currentDeviceValue()
  defaultDevice.addEventListener("change", () => {
    localStorage.setItem("default-device", defaultDevice.value)
  })
  applyCanvasBackground(initialCanvasBackground)
  if (currentDeviceValue() === "canvas") device.value = canvasDeviceValue(initialCanvasBackground)
  canvasBackground.addEventListener("change", () => {
    const background = canvasBackground.value as CanvasBackground
    applyCanvasBackground(background)
    if (currentDeviceValue() === "canvas") {
      device.value = canvasDeviceValue(background)
      updateDevicePreview()
      refreshPreview()
    }
  })
  hintPreviewEnabled.checked = localStorage.getItem("hint-preview-enabled") !== "off"
  hintPreviewEnabled.addEventListener("change", () => {
    localStorage.setItem("hint-preview-enabled", hintPreviewEnabled.checked ? "on" : "off")
    refreshPreview()
  })
  editorCrosshair.checked = localStorage.getItem("editor-crosshair") !== "off"
  editorCoordinateSnap.checked = localStorage.getItem("editor-coordinate-snap") !== "off"
  applyEditorCrosshairSetting()
  editorCrosshair.addEventListener("change", () => {
    localStorage.setItem("editor-crosshair", editorCrosshair.checked ? "on" : "off")
    applyEditorCrosshairSetting()
  })
  editorCoordinateSnap.addEventListener("change", () => {
    localStorage.setItem("editor-coordinate-snap", editorCoordinateSnap.checked ? "on" : "off")
  })
  appTheme.value = localStorage.getItem("app-theme") ?? "system"
  const savedInterfaceTheme = localStorage.getItem(interfaceTheme.id)
  interfaceTheme.value = Array.from(interfaceTheme.options).some(option => option.value === savedInterfaceTheme) ? savedInterfaceTheme! : "default"
  interfaceTheme.addEventListener("change", () => {
    localStorage.setItem(interfaceTheme.id, interfaceTheme.value)
    applyAppTheme()
  })
  applyAppTheme()
  appTheme.addEventListener("change", () => {
    localStorage.setItem("app-theme", appTheme.value)
    applyAppTheme()
  })
  systemTheme.addEventListener("change", applyAppTheme)
  if (savedSourceFontSize && Number.isFinite(Number(savedSourceFontSize)) && Number(savedSourceFontSize) >= 8 && Number(savedSourceFontSize) <= 32) {
    sourceFontSize.value = savedSourceFontSize
  }
  applySourceFontSize()
  sourceFontSize.addEventListener("input", applySourceFontSize)
  sourceFontSize.addEventListener("change", saveSourceFontSize)
  sourceFontSize.addEventListener("blur", saveSourceFontSize)
  void initializeWindowMaterial().catch((error) => handleWindowMaterialError(error, "读取窗口材质"))
  windowMaterial.addEventListener("change", () => {
    localStorage.setItem("window-material", windowMaterial.checked ? "on" : "off")
    void applyWindowMaterialWithRetry().catch((error) => handleWindowMaterialError(error, "切换窗口材质"))
  })
  windowMaterialOpacity.addEventListener("input", () => {
    const storageKey = appState.windowMaterialKind === "acrylic" ? "window-acrylic-opacity" : "window-glass-opacity"
    localStorage.setItem(storageKey, String(currentWindowMaterialOpacity()))
    applyWindowMaterialOpacity()
  })
  windowMaterialOpacity.addEventListener("change", () => {
    void applyWindowMaterialWithRetry().catch((error) => handleWindowMaterialError(error, "切换窗口材质"))
  })
  const isWindowDragTarget = (target: EventTarget | null): target is Element =>
    target instanceof Element && Boolean(target.closest("[data-tauri-drag-region='deep']")) &&
    !target.closest("[data-tauri-drag-region='false'], button, input, select, textarea, a, label, summary, [contenteditable]:not([contenteditable='false']), [tabindex]:not([tabindex='-1']), [role='button'], [role='link'], [role='menuitem'], [role='tab'], [role='checkbox'], [role='radio'], [role='switch'], [role='option']")
  const isMacWindow = () => document.documentElement.classList.contains("macos") && isTauri()
  document.addEventListener("pointerdown", (event) => {
    if (!isMacWindow() || event.button !== 0 || event.pointerType !== "mouse" || !isWindowDragTarget(event.target)) return
    // WKWebView can deliver IPC after AppKit's mouse-down has expired. Track
    // the captured pointer instead of asking AppKit to replay that event.
    const target = event.target
    const { pointerId } = event
    let { screenX, screenY } = event
    const drag = new AbortController()
    const move = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return
      const dx = event.screenX - screenX
      const dy = event.screenY - screenY
      screenX = event.screenX
      screenY = event.screenY
      if (dx || dy) void invoke("move_macos_window", { dx, dy }).catch(error => {
        drag.abort()
        showError(error, "拖动窗口")
      })
    }
    target.setPointerCapture(pointerId)
    document.addEventListener("pointermove", move, { capture: true, signal: drag.signal })
    document.addEventListener("pointerup", move, { capture: true, signal: drag.signal })
    document.addEventListener("lostpointercapture", (event) => {
      if (event.pointerId === pointerId) drag.abort()
    }, { capture: true, signal: drag.signal })
  })
  document.addEventListener("mousedown", (event) => {
    if (event.button !== 0 || event.detail !== 1 || !isWindowDragTarget(event.target)) return
    const windowsMaterial = document.documentElement.classList.contains("windows") &&
      windowMaterial.checked && !event.target.closest(".ui-pinned-toolbar")
    if (!isMacWindow() && !windowsMaterial) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (windowsMaterial) void startWindowsWindowDrag()
  }, true)
  window.addEventListener("mouseup", () => {
    if (appState.windowDragPointerDown) void restoreWindowMaterialAfterDrag()
  }, true)
  overviewMetaVisible.checked = localStorage.getItem("overview-meta-visible") === "on"
  files.toggleAttribute("data-overview-meta", overviewMetaVisible.checked)
  overviewMetaVisible.addEventListener("change", () => {
    localStorage.setItem("overview-meta-visible", overviewMetaVisible.checked ? "on" : "off")
    files.toggleAttribute("data-overview-meta", overviewMetaVisible.checked)
  })
  sourceCompletionEnabled.checked = localStorage.getItem("source-completion-enabled") === "on"
  sourceValueHintsEnabled.checked = localStorage.getItem("source-value-hints-enabled") === "on"
  sourceLineExplanationEnabled.checked = localStorage.getItem("source-line-explanation-enabled") === "on"
  applySourceEditorFeatures()
  for (const [input, key] of [
    [sourceCompletionEnabled, "source-completion-enabled"],
    [sourceValueHintsEnabled, "source-value-hints-enabled"],
    [sourceLineExplanationEnabled, "source-line-explanation-enabled"],
  ] as const) input.addEventListener("change", () => {
    localStorage.setItem(key, input.checked ? "on" : "off")
    applySourceEditorFeatures()
  })
  undoButton.addEventListener("click", undo)
  redoButton.addEventListener("click", redo)
  // 手机文件选择器无法可靠识别自定义扩展名，改由 change 里校验扩展名。
  if (isIOSWeb() || isAndroidWeb()) browserOpen.removeAttribute("accept")
  browserOpen.addEventListener("change", async () => {
    const file = browserOpen.files?.[0]
    if (file) {
      await runFileOperation("打开", async () => {
        if (!isSupportedSkinPath(file.name)) throw new Error(UNSUPPORTED_SKIN_MESSAGE)
        if (!(await prepareDocumentReplacement("open"))) return false
        return openSkinBytes(await readBrowserSkinFile(file), file.name)
      })
    }
    browserOpen.value = ""
  })
  fileOperationDialog.addEventListener("cancel", (event) => {
    if (appState.fileOperationRunning) event.preventDefault()
  })
  canvasWrap.addEventListener("dragenter", (event) => {
    event.preventDefault()
    appState.canvasDragDepth += 1
    setCanvasDropState(true)
  })
  canvasWrap.addEventListener("dragover", (event) => {
    event.preventDefault()
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy"
      const file = event.dataTransfer.files[0]
      setLayoutImageHighlight(Boolean(appState.archive && appState.archive.format !== "bda" && file && /\.png$/i.test(file.name)))
    }
  })
  canvasWrap.addEventListener("dragleave", (event) => {
    event.preventDefault()
    appState.canvasDragDepth = Math.max(0, appState.canvasDragDepth - 1)
    if (!appState.canvasDragDepth) {
      setCanvasDropState(false)
      setLayoutImageHighlight(false)
    }
  })
  canvasWrap.addEventListener("drop", (event) => {
    event.preventDefault()
    appState.canvasDragDepth = 0
    setCanvasDropState(false)
    setLayoutImageHighlight(false)
    const file = event.dataTransfer?.files[0]
    if (!file) return
    if (/\.png$/i.test(file.name)) {
      if (!appState.archive || appState.archive.format === "bda") return
      const reader = new FileReader()
      reader.onload = () => {
        setLayoutImageBytes(new Uint8Array(reader.result as ArrayBuffer))
        openLayoutImageDialog()
      }
      reader.readAsArrayBuffer(file)
      return
    }
    void runFileOperation("打开", () => loadDroppedFile(file))
  })
  replaceAssetButton.addEventListener("click", () => imageOpen.click())
  assetBackButton.addEventListener("click", () => {
    const path = appState.assetReturnPath
    if (!path || !appState.archive?.names().includes(path)) return
    appState.assetReturnPath = ""
    selectFile(path)
    revealSourceFile(path)
  })
  imageOpen.addEventListener("change", async () => {
    const file = imageOpen.files?.[0]
    if (file && isEditing() && appState.archive?.isImage(appState.selectedPath)) {
      const targetArchive = appState.archive
      const path = appState.selectedPath
      await runFileOperation("替换图片", async () => {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }))
        bitmap.close()
        if (appState.archive !== targetArchive || !isEditing()) return false
        commitBytes(path, appState.archive.getBytes(path)?.slice(), bytes)
        if (appState.selectedPath === path) showImage(path)
        refreshPreview()
        updateDirty()
        return true
      })
    }
    imageOpen.value = ""
  })
  source.addEventListener("input", () => {
    if (!isEditing() || !appState.archive || !appState.selectedPath) return
    if (appState.archive.isBdaConfig(appState.selectedPath) || isBdaAppearancePartPath(appState.selectedPath) || isSxiSourcePath(appState.selectedPath)) {
      scheduleSourceInputHighlight()
      return
    }
    if (appState.resourceConfigActive && appState.selectedResourcePath) {
      const before = appState.tileDocument.toString()
      appState.tileDocument = IniDocument.parse(source.value)
      commitText(appState.tilePath, before, source.value)
      appState.slices = tileSlices(appState.tileDocument)
      if (!appState.slices.some((slice) => slice.index === appState.selectedTileIndex)) appState.selectedTileIndex = undefined
      populateTileInspector()
      drawAtlas()
      updateDirty()
      scheduleSourceInputHighlight()
      return
    }
    const sourcePath = sourceEditPath()
    if (sourcePath !== appState.selectedPath) {
      commitText(sourcePath, appState.archive.getText(sourcePath), source.value)
      updateDirty()
      scheduleSourceInputHighlight(true)
      return
    }
    const before = appState.archive.getText(appState.selectedPath)
    appState.selectedDocument = IniDocument.parse(source.value)
    commitText(appState.selectedPath, before, source.value)
    if (appState.selectedPath === appState.layoutPath) appState.layoutDocument = appState.selectedDocument
    updateDirty()
    scheduleSourceInputHighlight(true)
  })
  source.addEventListener("change", commitBdaSourceEdit)
  source.addEventListener("change", commitSxiSourceEdit)
  sourceColorPicker.addEventListener("change", applySourceColorPicker)
  /**
   * Reverse direction of the canvas ↔ source link: putting the caret inside a
   * configuration block selects the key that block describes. The canvas is
   * updated without echoing back into the editor, so the two stay in step
   * without fighting over the caret.
   *
   * The lazy editor is a plain EventTarget rather than a DOM node, so this is
   * bound to the instance (the editor also re-raises with `bubbles`, which the
   * document-level listener below picks up if that ever changes).
   */
  source.addEventListener("cursormove", (event) => {
    const detail = (event as CustomEvent<SourceEditorCursorMove>).detail
    if (!detail) return
    selectKeyFromSourceOffset(detail.offset)
  })
}
