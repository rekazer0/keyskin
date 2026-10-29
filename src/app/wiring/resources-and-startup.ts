import { aiDesignChat, pickerDialog, pickerFrame, theme, orientation, $, inspectorResizeHandle, styleAddButton, newStyleID, newStyleDialog, newStyleForm, layout, resourceUploadButton, resourceUploadInput, resourceDownloadButton, resourceDeleteButton, resourceDetail, device, clearSimulationButton, simulatedOutput, toolbarMenus, windowMaterial, mode } from "../dom"
import { updateSelectedImageReference, pickerImageReference, resourcePickerPayload, selectImageResource, pickableImagePaths, emitPickerView, emitToPicker, onPickerEvent } from "../image-pickers"
import { appState } from "../state"
import { isTauri, isAndroidTauri, playSoundPath, syncDeviceControlIcon, clearSimulatedOutput } from "../canvas-interaction"
import { listen } from "@tauri-apps/api/event"
import { WebviewWindow } from "@tauri-apps/api/webviewWindow"
import { type ProjectChoice } from "../../project-chooser"
import { finishNativeProjectChoice } from "../new-document"
import { emitStyleLibrary, applyStyleLibrarySelection, editStyleLibrarySelection, addStyleFromLibrary, nextStyleID, showNewStyleError, availableStyleIDs, canAddStyle } from "../style-picker"
import { editSxi } from "../sxi-fields"
import { addPalmStyle } from "../../palm/palm-style-edit.ts"
import { palmTheme } from "../sxi-documents"
import { canvasEditable, isEditing, commitText, updateDirty, commitBatch, redo, undo, hasUnsavedChanges, prepareDocumentReplacement } from "../edit-history"
import { WHOLE_IMAGE_INDEX } from "../../slice-picker-canvas.ts"
import { soundPathForFilename } from "../../sounds.ts"
import { bindPaneResize, applyModeState } from "../mobile-layout"
import { styleConfigPath, setSourceValue, currentConfigPath } from "../config-context"
import { IniDocument } from "../../ini.ts"
import { openStyleReferenceEditor } from "../style-references"
import { refreshPreview, setGuidesVisible, updateDevicePreview, refreshSimulationPreview, fitCanvasPreview } from "../preview-render"
import { selectStyleResource, renderResourceInspector, selectResourceImage, uploadKeySound, currentSoundEntries, hideImageWorkspace, updateResourceActionButtons } from "../resource-inspector"
import { createAtlasWorkspace } from "../../atlas-workspace"
import { selectFile } from "../navigation"
import { autoSliceSelectedImage, drawAtlas, commitTile, moveSelectedTile, deleteSelectedTile, populateTileInspector, nextSliceIndex } from "../tile-editing"
import { type TileRect, duplicateTileSlice } from "../../tiles.ts"
import { type Change } from "../../history.ts"
import { showStatus, runFileOperation, showError } from "../file-operations"
import { resourceRootPath, setLayoutImageBytes, openLayoutImageDialog, syncLayoutImageConfig } from "../layout-image-replace"
import { writeToChosenFile, isSupportedSkinPath, loadDroppedPath, loadDroppedSourceWorkspace, loadNativePath, restoreLastSourceWorkspace } from "../archive-io"
import { canvasBackgroundFromDevice } from "../../canvas-background.ts"
import { applyCanvasBackground, applyWindowMaterialWithRetry, handleWindowMaterialError, sourceDirectoryInitialization, refreshUpdateStatus } from "../preferences"
import { syncAiDesignContext } from "../ai-panel"
import { isTextEditingTarget, moveSelectedKeys, deleteSelectedKeys } from "../key-editing"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { invoke } from "@tauri-apps/api/core"
import { onBackButtonPress } from "@tauri-apps/api/app"
import { getCurrentWebview } from "@tauri-apps/api/webview"
import { setSourceDropTarget, sourceDropFolder, commitSourceUploads } from "../source-files"
import { updateSourceHighlight, updateInspectorView } from "../source-panel"
import { initInspectorShell } from "../../inspector-shell.ts"
import { startOnboarding, startOnboardingOnFirstLaunch } from "../onboarding"

/** 样式图片资源、面板缩放、模拟输入与启动时的初始状态。只在启动时由 main.ts 按顺序调用一次。 */
export function wireResourcesAndStartup(): void {
  if (isTauri()) {
    void listen("new-project-ready", () => {
      appState.nativeProjectWindowReady = true
      void WebviewWindow.getByLabel("new-project").then((window) => window?.setFocus())
    })
    void listen<ProjectChoice>("new-project-select", (event) => {
      appState.newProjectOptions = event.payload
      finishNativeProjectChoice(event.payload.templateID)
    })
    void listen("new-project-cancel", () => finishNativeProjectChoice())
  }
  void onPickerEvent("picker-window-ready", () => {
    appState.pickerFrameReady = true
    void emitPickerView(appState.pickerRequestedView)
  })
  void onPickerEvent("picker-close", () => pickerDialog.close())
  pickerDialog.addEventListener("close", () => {
    appState.pickerFrameReady = false
    pickerFrame.src = "about:blank"
  })
  // 网页端弹窗的遮罩点在 dialog 自身上，iframe 内的点击不会冒泡过来。
  pickerDialog.addEventListener("click", (event) => { if (event.target === pickerDialog) pickerDialog.close() })
  void onPickerEvent<{ index: number }>("image-picker-select", ({ index }) => {
    if (!isEditing() || !appState.pickerTarget) return
    if (index === WHOLE_IMAGE_INDEX ? appState.pickerSlices.length : !appState.pickerSlices.some((slice) => slice.index === index)) return
    appState.pickerSelectedIndex = index
    updateSelectedImageReference(appState.pickerTarget, pickerImageReference(index))
  })
  // 切片窗口返回「全部样式」：留在同一个窗口里切视图。
  void onPickerEvent("image-picker-back-styles", () => void emitStyleLibrary(true))
  void onPickerEvent<{ styleID?: string; imagePath?: string }>("style-library-apply", (selected) => {
    appState.styleLibrarySelected = selected
    applyStyleLibrarySelection()
  })
  void onPickerEvent<{ styleID?: string; imagePath?: string }>("style-library-edit", (selected) => {
    appState.styleLibrarySelected = selected
    editStyleLibrarySelection()
  })
  void onPickerEvent("style-library-add", addStyleFromLibrary)
  void onPickerEvent<{ filename: string }>("style-library-play", ({ filename }) => {
    const path = soundPathForFilename(appState.archive?.names() ?? [], theme.value, orientation.value, filename)
    if (path) playSoundPath(path)
  })
  void onPickerEvent("image-picker-resources-request", () => void emitToPicker("image-picker-resources-data", resourcePickerPayload()))
  void onPickerEvent<{ path: string }>("resource-picker-select", ({ path }) => selectImageResource(path))
  bindPaneResize($("#sidebar-resize-handle"), "--sidebar-width", "sidebarWidthV2", 180, 420, 248, 1)
  bindPaneResize(inspectorResizeHandle, "--inspector-width", "inspectorWidthV5", 220, Math.max(700, window.innerWidth - 720), 360, -1)
  styleAddButton.addEventListener("click", () => {
    if (!canAddStyle() || !isEditing()) return
    newStyleID.value = nextStyleID()
    showNewStyleError("")
    newStyleDialog.showModal()
    newStyleID.select()
  })
  newStyleForm.addEventListener("submit", (event) => {
    if ((event.submitter as HTMLButtonElement | null)?.value !== "create") return
    event.preventDefault()
    const styleID = newStyleID.value.trim()
    if (!/^\d+$/.test(styleID)) {
      showNewStyleError("样式序号必须是非负整数")
      return
    }
    if (availableStyleIDs().includes(styleID)) {
      showNewStyleError(`STYLE${styleID} 已存在`)
      return
    }
    const path = styleConfigPath()
    // A Palm style joins the theme's shared table in skin.json.
    if (appState.archive?.format === "sxi") editSxi((skin) => { addPalmStyle(skin, palmTheme(), {}, styleID) })
    else {
      if (!appState.archive?.isText(path)) return
      const stylesDocument = IniDocument.parse(appState.archive.getText(path))
      const before = stylesDocument.toString()
      stylesDocument.appendSection(`STYLE${styleID}`, [])
      const currentMax = Number(stylesDocument.get("GLOBAL", "STYLE_NUM") ?? -1)
      const numericID = Number(styleID)
      if (!Number.isFinite(currentMax) || numericID > currentMax) stylesDocument.set("GLOBAL", "STYLE_NUM", styleID)
      commitText(path, before, stylesDocument.toString())
      setSourceValue(stylesDocument.toString())
    }
    const applyTarget = appState.newStyleApplyTarget
    newStyleDialog.close()
    // 检查器缩略图传入的是行内克隆输入框（未挂载），只看是否可编辑。
    if (applyTarget && !applyTarget.disabled) {
      applyTarget.value = styleID
      applyTarget.dispatchEvent(new Event("input", { bubbles: true }))
      applyTarget.dispatchEvent(new Event("change", { bubbles: true }))
      openStyleReferenceEditor(styleID)
      refreshPreview()
      updateDirty()
      return
    }
    appState.selectedResourceGalleryPath = `STYLE${styleID}`
    selectStyleResource(styleID)
    refreshPreview()
    updateDirty()
  })
  appState.atlasWorkspace = createAtlasWorkspace({
    back: () => selectFile(appState.layoutPath || currentConfigPath(layout.value)),
    autoSlice: () => { void autoSliceSelectedImage() },
    guides: () => setGuidesVisible(!appState.guidesVisible),
    redraw: () => drawAtlas(),
    stretch: enabled => {
      const slice = appState.slices.find(item => item.index === appState.selectedTileIndex)
      if (!slice || !isEditing() || appState.archive?.format === "bda") return
      const [x, y, width, height] = slice.source
      const left = Math.floor(width / 4), top = Math.floor(height / 4)
      commitTile({ index: slice.index, source: slice.source, ...(enabled ? { inner: [x + left, y + top, width - left * 2, height - top * 2] as TileRect } : {}) })
    },
    copy: () => {
      if (!appState.archive || !appState.selectedResourcePath || !isEditing()) return
      const base = appState.selectedResourcePath.replace(/\.png$/i, "")
      let target = `${base}_copy`
      for (let index = 2; appState.archive.getBytes(`${target}.png`) || appState.archive.getBytes(`${target}.til`); index++) target = `${base}_copy${index}`
      const changes: Change[] = ["png", "til"].flatMap(extension => {
        const bytes = appState.archive!.getBytes(`${base}.${extension}`)
        return bytes ? [{ kind: "bytes" as const, path: `${target}.${extension}`, after: bytes.slice() }] : []
      })
      commitBatch(changes)
      renderResourceInspector()
      selectResourceImage(`${target}.png`)
      updateDirty()
    },
    create: (name, width, height) => {
      if (!appState.archive || !isEditing()) return
      if (!/^[^\\/:*?"<>|]+\.png$/i.test(name) || name.startsWith(".")) { showStatus("请输入有效的 PNG 文件名"); return }
      const size = [width, height]
      if (size.length !== 2 || size.some(n => !Number.isInteger(n) || n < 1 || n > 8192)) { showStatus("图片宽高必须是 1 至 8192 的整数"); return }
      const base = appState.selectedResourcePath.substring(0, appState.selectedResourcePath.lastIndexOf("/")) || resourceRootPath()
      const path = `${base}/${name}`
      if (appState.archive.getBytes(path)) { showStatus("同名图片已存在"); return }
      const targetArchive = appState.archive
      const canvas = document.createElement("canvas")
      canvas.width = size[0]; canvas.height = size[1]
      canvas.toBlob(blob => {
        if (!blob) return
        void runFileOperation("新建图片", async () => {
          const bytes = new Uint8Array(await blob.arrayBuffer())
          if (appState.archive !== targetArchive || !isEditing()) return false
          commitBatch([{ kind: "bytes", path, after: bytes }])
          renderResourceInspector()
          selectResourceImage(path)
          updateDirty()
          return true
        })
      }, "image/png")
    },
    import: files => {
      if (!appState.archive || !isEditing() || !files.length) return
      const targetArchive = appState.archive
      const base = appState.selectedResourcePath.substring(0, appState.selectedResourcePath.lastIndexOf("/")) || resourceRootPath()
      void runFileOperation("导入图片目录", async () => {
        const changes: Array<Extract<Change, { kind: "bytes" }>> = []
        const paths = new Set<string>()
        for (const file of files) {
          const relative = file.webkitRelativePath.split("/").slice(1).join("/") || file.name
          if (relative.split("/").some(part => part === ".." || !part)) throw new Error("无效的资源路径")
          const path = `${base}/${relative}`
          if (paths.has(path)) throw new Error(`目录中存在重名资源：${relative}`)
          paths.add(path)
          const bytes = new Uint8Array(await file.arrayBuffer())
          if (/\.png$/i.test(file.name)) {
            const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }))
            bitmap.close()
          }
          changes.push({ kind: "bytes", path, before: targetArchive.getBytes(path)?.slice(), after: bytes })
        }
        if (appState.archive !== targetArchive || !isEditing()) return false
        commitBatch(changes)
        renderResourceInspector()
        const image = changes.find(change => /\.png$/i.test(change.path))
        if (image) selectResourceImage(image.path)
        updateDirty()
        return true
      })
    },
  })
  resourceUploadButton.addEventListener("click", () => {
    if (!appState.archive || !isEditing()) return
    resourceUploadInput.value = ""
    resourceUploadInput.click()
  })
  resourceUploadInput.addEventListener("change", () => {
    const file = resourceUploadInput.files?.[0]
    if (!file || !appState.archive || !isEditing()) return
    if (appState.resourceInspectorMode === "sound") {
      void runFileOperation("上传按键音效", () => uploadKeySound(file))
      return
    }
    const targetArchive = appState.archive
    void runFileOperation("上传图片", async () => {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }))
      bitmap.close()
      if (appState.archive !== targetArchive || !isEditing()) return false
      const paths = pickableImagePaths()
      const base = paths[0]?.split("/").slice(0, -1).join("/") ?? `${theme.value}/skin/${orientation.value}/res`
      const targetPath = `${base}/${file.name}`
      const before = appState.archive.getBytes(targetPath)
      commitBatch([{ kind: "bytes", path: targetPath, before: before?.slice(), after: bytes }])
      renderResourceInspector()
      updateDirty()
      selectResourceImage(targetPath)
      return true
    })
  })
  resourceDownloadButton.addEventListener("click", () => {
    void runFileOperation(appState.resourceInspectorMode === "sound" ? "下载按键音效" : "下载图片", async () => {
      if (appState.resourceInspectorMode === "sound") {
        const entry = currentSoundEntries().find((item) => item.id === appState.selectedSoundID)
        const bytes = entry?.path ? appState.archive?.getBytes(entry.path) : undefined
        if (!entry?.path || !bytes) return false
        return Boolean(await writeToChosenFile(entry.filename, bytes))
      }
      if (!appState.archive || !appState.selectedResourceGalleryPath) return false
      const bytes = appState.archive.getBytes(appState.selectedResourceGalleryPath)
      if (!bytes) return false
      return Boolean(await writeToChosenFile(
        appState.selectedResourceGalleryPath.split("/").pop() ?? "image.png",
        bytes,
      ))
    })
  })
  resourceDeleteButton.addEventListener("click", () => {
    if (!appState.archive || !appState.selectedResourceGalleryPath || !isEditing()) return
    const name = appState.selectedResourceGalleryPath.split("/").pop() ?? appState.selectedResourceGalleryPath
    const before = appState.archive.getBytes(appState.selectedResourceGalleryPath)
    if (!before) return
    commitBatch([{ kind: "bytes", path: appState.selectedResourceGalleryPath, before }])
    if (appState.selectedResourcePath === appState.selectedResourceGalleryPath) {
      appState.selectedResourcePath = ""
      appState.slices = []
      appState.selectedTileIndex = undefined
      resourceDetail.hidden = true
      hideImageWorkspace()
    }
    appState.selectedResourceGalleryPath = ""
    updateResourceActionButtons()
    renderResourceInspector()
    updateDirty()
    showStatus(`已删除图片 ${name}，可撤销。`)
  })
  device.addEventListener("change", () => {
    const background = canvasBackgroundFromDevice(device.value)
    if (background) applyCanvasBackground(background)
    syncDeviceControlIcon()
    syncAiDesignContext()
    updateDevicePreview()
    refreshPreview()
  })
  clearSimulationButton.addEventListener("click", clearSimulatedOutput)
  simulatedOutput.addEventListener("input", refreshSimulationPreview)
  window.addEventListener("keydown", (event) => {
    const movement: Record<string, readonly [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }
    const direction = movement[event.key]
    if (direction) {
      if (appState.resourceConfigActive && !isTextEditingTarget(event.target)) {
        if (appState.selectedTileIndex === undefined || !isEditing()) return
        event.preventDefault()
        const distance = event.shiftKey ? 10 : 1
        moveSelectedTile(direction[0] * distance, direction[1] * distance, event.repeat)
        return
      }
      if (!canvasEditable() || !appState.selectedKeySections.length || isTextEditingTarget(event.target)) return
      event.preventDefault()
      const distance = event.shiftKey ? 10 : 1
      moveSelectedKeys(direction[0] * distance, direction[1] * distance, appState.selectedKeySections, event.repeat)
      return
    }
    if (appState.resourceConfigActive && !isTextEditingTarget(event.target)) {
      if ((event.key === "Delete" || event.key === "Backspace") && isEditing()) {
        event.preventDefault()
        deleteSelectedTile()
        return
      }
      if (event.metaKey || event.ctrlKey) {
        if (event.key.toLowerCase() === "c") {
          const existing = appState.slices.find((slice) => slice.index === appState.selectedTileIndex)
          if (existing) {
            appState.copiedTile = duplicateTileSlice(existing, existing.index)
            event.preventDefault()
          }
          return
        }
        if (event.key.toLowerCase() === "v" && appState.copiedTile && isEditing()) {
          event.preventDefault()
          const index = nextSliceIndex()
          commitTile({ ...appState.copiedTile, index })
          appState.selectedTileIndex = index
          populateTileInspector()
          drawAtlas()
          return
        }
      }
    }
    if (
      (event.key === "Delete" || event.key === "Backspace") &&
      canvasEditable() &&
      appState.selectedKeySections.length &&
      !isTextEditingTarget(event.target)
    ) {
      event.preventDefault()
      deleteSelectedKeys()
      return
    }
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return
    // The AI composer keeps its own text undo; the skin history is not what the user is typing.
    if (event.composedPath().includes(aiDesignChat)) return
    event.preventDefault()
    if (event.shiftKey) redo()
    else undo()
  })
  window.addEventListener("pointerdown", (event) => {
    for (const menu of toolbarMenus) {
      if (menu.open && !menu.contains(event.target as Node)) menu.open = false
    }
  })
  window.addEventListener("beforeunload", (event) => {
    if (isTauri() || !hasUnsavedChanges()) return
    event.preventDefault()
    event.returnValue = ""
  })
  // 安卓没有窗口关闭事件，返回键先收起最上层弹窗，再走未保存确认后退出。
  if (isAndroidTauri()) {
    void onBackButtonPress(async () => {
      const dialog = [...document.querySelectorAll<HTMLDialogElement>("dialog[open]")].at(-1)
      if (dialog) {
        if (dialog.dispatchEvent(new Event("cancel", { cancelable: true }))) dialog.close()
        return
      }
      if (await prepareDocumentReplacement()) void invoke("quit_app")
    })
  }
  if (isTauri()) {
    let movingDebounce: ReturnType<typeof setTimeout> | undefined
    void getCurrentWindow().onMoved(() => {
      clearTimeout(movingDebounce)
      clearTimeout(appState.fitCanvasDebounce)
      movingDebounce = setTimeout(() => { fitCanvasPreview() }, 300)
    })
    // 窗口获得焦点时重新同步材质状态，修复 Windows 10 亚克力材质导致的窗口移动卡顿问题
    void getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused && windowMaterial.checked && !appState.windowDragPointerDown && !appState.windowDragMaterialDisabled) {
        void applyWindowMaterialWithRetry().catch((error) => handleWindowMaterialError(error, "恢复窗口材质"))
      }
    })
    let destroyingWindow = false
    void getCurrentWindow().onCloseRequested(async (event) => {
      if (destroyingWindow) return
      event.preventDefault()
      const shouldClose = await prepareDocumentReplacement()
      if (!shouldClose) return
      destroyingWindow = true
      void invoke("quit_app")
    })
    void (async () => {
      const scaleFactor = await getCurrentWindow().scaleFactor()
      await getCurrentWebview().onDragDropEvent((event) => {
        const payload = event.payload
        if (payload.type === "leave") {
          setSourceDropTarget()
          return
        }
        const target = document.elementFromPoint(
          payload.position.x / scaleFactor,
          payload.position.y / scaleFactor,
        )
        const folder = sourceDropFolder(target)
        if (payload.type === "enter" || payload.type === "over") {
          setSourceDropTarget(folder === undefined ? undefined : target)
          return
        }
        setSourceDropTarget()
        void (async () => {
          if (payload.paths.length === 1 && isSupportedSkinPath(payload.paths[0])) {
            await runFileOperation("打开", () => loadDroppedPath(payload.paths[0]))
            return
          }
          for (const path of payload.paths) {
            if (await invoke<boolean>("path_is_directory", { path })) {
              await runFileOperation("打开源码文件夹", () => loadDroppedSourceWorkspace(path))
              return
            }
          }
          if (folder !== undefined && appState.archive && isEditing()) {
            await runFileOperation("上传文件", async () => commitSourceUploads(
              await Promise.all(payload.paths.map(async (path) => ({
                name: path,
                bytes: new Uint8Array(await invoke<ArrayBuffer>("read_file", { path })),
              }))),
              folder,
            ))
            return
          }
          const pngPath = payload.paths.find((path) => /\.png$/i.test(path))
          if (pngPath) {
            if (!appState.archive || appState.archive.format === "bda") return
            const bytes = new Uint8Array(await invoke<ArrayBuffer>("read_file", { path: pngPath }))
            setLayoutImageBytes(bytes)
            openLayoutImageDialog()
            return
          }
          const path = payload.paths.find(isSupportedSkinPath)
          if (path) await runFileOperation("打开", () => loadDroppedPath(path))
        })().catch((error) => showError(error, "处理拖入文件"))
      })
    })()
    void listen<string[]>("opened", async (event) => {
      const path = event.payload[0]
      if (path && (await prepareDocumentReplacement())) {
        void runFileOperation("打开", () => loadNativePath(path))
      }
    })
    void invoke<string[]>("take_opened_files")
      .then(async (paths) => {
        if (paths[0]) {
          await runFileOperation("打开", () => loadNativePath(paths[0]))
          return
        }
        await sourceDirectoryInitialization
        await restoreLastSourceWorkspace()
      })
      .catch((error) => showError(error, "读取启动文件"))
  }
  // 初始化性能优化

  mode.value = "preview"
  applyModeState()
  syncLayoutImageConfig()
  syncDeviceControlIcon()
  updateDevicePreview()
  updateSourceHighlight()
  updateInspectorView()
  void refreshUpdateStatus()
  // 检查器外壳：搜索 / 状态作用域 / 常驻动作条 / 分区折叠
  initInspectorShell()
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-start-tour]")) button.addEventListener("click", startOnboarding)
  // 电脑版与安卓版首次打开时自动播放使用教程
  if (isTauri()) requestAnimationFrame(startOnboardingOnFirstLaunch)
}
