import { confirmDeletion } from "../ask"
import { renameResourceImage } from "../image-rename"
import { ssfPackage, ssfTheme } from "../ssf-documents"
import { settingsWorkspace, aiDesignChat, pickerDialog, pickerFrame, theme, orientation, $, inspectorResizeHandle, resourceGallery, resourceUploadButton, resourceUploadInput, resourceDownloadButton, resourceRenameButton, resourceDeleteButton, resourceDetail, resourceBackButton, device, clearSimulationButton, simulatedOutput, toolbarMenus, windowMaterial, mode } from "../dom"
import { bindDialog } from "../ask.ts"
import { closeDialog } from "../../motion.ts"
import { applyImageSliceSelection, resourcePickerPayload, selectImageResource, emitPickerView, emitToPicker, onPickerEvent } from "../image-pickers"
import { appState } from "../state"
import { isTauri, isAndroidTauri, playSoundPath, syncDeviceControlIcon, clearSimulatedOutput } from "../canvas-interaction"
import { listen } from "@tauri-apps/api/event"
import { emitStyleLibrary, emitStyleLibraryPreview, emitStyleLibraryImage, applyStyleLibrarySelection, editStyleLibrarySelection, addStyleFromLibrary, duplicateStyle } from "../style-picker"
import { canvasEditable, isEditing, updateDirty, commitBatch, redo, undo, hasUnsavedChanges, prepareDocumentReplacement } from "../edit-history"
import { soundPathForFilename } from "../../sounds.ts"
import { bindPaneResize, applyModeState } from "../mobile-layout"
import { refreshPreview, setGuidesVisible, updateDevicePreview, refreshSimulationPreview, fitCanvasPreview } from "../preview-render"
import { renderResourceInspector, selectResourceImage, uploadResourceImage, hideImageWorkspace, updateResourceActionButtons } from "../resource-inspector"
import { wireResourceSelection } from "../resource-gallery"
import { wireResourceTransfer, downloadResourceSelection, resourceDropTarget, uploadResourceFiles, deleteCatalogFont } from "../resource-transfer"
import { createAtlasWorkspace } from "../../atlas-workspace"
import { createAnimationWorkspace } from "../../animation-workspace"
import { selectFile } from "../navigation"
import { populateKeyInspector } from "../key-inspector"
import { autoSliceSelectedImage, drawAtlas, finishAtlasEdits, scheduleAtlasDraw, commitTile, moveSelectedTile, deleteSelectedTile, populateTileInspector, nextSliceIndex } from "../tile-editing"
import { type TileRect, duplicateTileSlice } from "../../tiles.ts"
import { type Change } from "../../history.ts"
import { showStatus, runFileOperation, showError } from "../file-operations"
import { resourceRootPath, setLayoutImageBytes, openLayoutImageDialog, syncLayoutImageConfig } from "../layout-image-replace"
import { isSupportedSkinPath, loadDroppedPath, loadDroppedSourceWorkspace, loadNativePath, restoreLastSourceWorkspace } from "../archive-io"
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
import { resourceWindow } from "../resource-grid-window"
import { bindListboxKeys } from "../../dom-element.ts"
import { startOnboarding, startOnboardingOnFirstLaunch } from "../onboarding"
import { clearMobilePickerPreview, previewMobilePickerSelection } from "../mobile-picker-preview"

/** 样式图片资源、面板缩放、模拟输入与启动时的初始状态。只在启动时由 main.ts 按顺序调用一次。 */
export function wireResourcesAndStartup(): void {
  void onPickerEvent("picker-window-ready", () => {
    appState.pickerFrameReady = true
    void emitPickerView(appState.pickerRequestedView)
  })
  bindDialog(pickerDialog)
  void onPickerEvent("picker-close", () => closeDialog(pickerDialog))
  pickerDialog.addEventListener("close", () => {
    clearMobilePickerPreview()
    appState.pickerFrameReady = false
    pickerFrame.src = "about:blank"
  })
  void onPickerEvent<{ index: number; newStyle?: boolean }>("image-picker-select", ({ index, newStyle }) => {
    void applyImageSliceSelection(index, newStyle)
  })
  // 切片窗口返回「全部样式」：留在同一个窗口里切视图。
  void onPickerEvent("image-picker-back-styles", () => void emitStyleLibrary(true))
  void onPickerEvent<{ session: string; styleID: string }>("style-library-preview-request", request => void emitStyleLibraryPreview(request))
  void onPickerEvent<{ session: string; key: string }>("style-library-image-request", request => void emitStyleLibraryImage(request))
  void onPickerEvent<{ session?: string; styleID?: string; imagePath?: string }>("style-library-preview-selection", selected => void previewMobilePickerSelection(selected))
  void onPickerEvent<{ styleID?: string; imagePath?: string; toStyle?: boolean; replaceAll?: boolean }>("style-library-apply", (selected) => {
    clearMobilePickerPreview()
    appState.styleLibrarySelected = selected
    applyStyleLibrarySelection(selected.toStyle, selected.replaceAll)
  })
  void onPickerEvent<{ styleID?: string; imagePath?: string }>("style-library-edit", (selected) => {
    appState.styleLibrarySelected = selected
    editStyleLibrarySelection()
  })
  void onPickerEvent("style-library-add", addStyleFromLibrary)
  void onPickerEvent<{ session: string; name: string; bytes: number[] }>("style-library-import", payload => {
    if (!isEditing() || payload.session !== appState.styleLibrarySession?.session || !Array.isArray(payload.bytes)) return
    void runFileOperation("导入图片", async () => {
      const path = await uploadResourceImage(new File([Uint8Array.from(payload.bytes)], payload.name))
      if (!path) return false
      await emitStyleLibrary()
      await emitToPicker("style-library-imported", { path })
      return true
    })
  })
  void onPickerEvent<{ styleID: string }>("style-library-duplicate", ({ styleID }) => { if (duplicateStyle(styleID)) void emitStyleLibrary() })
  void onPickerEvent<{ filename: string }>("style-library-play", ({ filename }) => {
    const path = appState.archive?.format === "ssf" ? ssfPackage()?.soundPath(ssfTheme(), filename)
      : soundPathForFilename(appState.archive?.names() ?? [], theme.value, orientation.value, filename)
    if (path) playSoundPath(path)
  })
  void onPickerEvent("image-picker-resources-request", () => void emitToPicker("image-picker-resources-data", resourcePickerPayload()))
  void onPickerEvent<{ path: string }>("resource-picker-select", ({ path }) => selectImageResource(path))
  bindPaneResize($("#sidebar-resize-handle"), "--sidebar-width", "sidebarWidthV2", 180, 248, 1)
  bindPaneResize(inspectorResizeHandle, "--inspector-width", "inspectorWidthV5", 220, 360, -1)
  // 样式 / 图片列表：方向键换选中，⌘D 复制选中的样式（Delete 由卡片自己处理）。
  wireResourceSelection()
  wireResourceTransfer()
  bindListboxKeys(resourceGallery, (card, event) => {
    card.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey }))
    card.focus()
  }, () => resourceWindow)
  resourceRenameButton.addEventListener("click", renameResourceImage)
  resourceGallery.addEventListener("keydown", (event) => {
    if (!event.defaultPrevented && event.key === "F2" && !resourceRenameButton.disabled && !resourceRenameButton.hidden) {
      event.preventDefault()
      resourceRenameButton.click()
    }
  })
  appState.animationWorkspace = createAnimationWorkspace({
    relayout: () => populateKeyInspector(),
    changeMode: particle => selectFile(appState.selectedPath, "overview", particle ? "particle" : "motion"),
    changeLayout: option => {
      const path = appState.selectedPath
      const category = appState.animationWorkspaceMode
      option.click()
      selectFile(path, "overview", category)
    },
  })
  appState.atlasWorkspace = createAtlasWorkspace({
    begin: () => { appState.atlasEdits = new Map() },
    finish: save => finishAtlasEdits(save, () => {
      if (appState.selectedResourcePath) resourceBackButton.click()
    }),
    autoSlice: () => { void autoSliceSelectedImage() },
    guides: () => setGuidesVisible(!appState.guidesVisible),
    redraw: scheduleAtlasDraw,
    stretch: enabled => {
      const slice = appState.slices.find(item => item.index === appState.selectedTileIndex)
      if (!slice || !isEditing() || appState.archive?.format === "bda") return
      const [x, y, width, height] = slice.source
      const left = Math.floor(width / 4), top = Math.floor(height / 4)
      commitTile({ index: slice.index, source: slice.source, ...(enabled ? { inner: [x + left, y + top, width - left * 2, height - top * 2] as TileRect } : {}) })
    },
    copy: () => {
      const path = appState.selectedResourceGalleryPath
      if (!appState.archive?.isImage(path) || !isEditing()) return
      const base = path.replace(/\.png$/i, "")
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
    // 校验失败返回错误文字，由对话框在框内显示（DESIGN.md §7）。
    create: (name, width, height) => {
      if (!appState.archive || !isEditing()) return "交互预览中无法编辑"
      if (!/^[^\\/:*?"<>|]+\.png$/i.test(name) || name.startsWith(".")) return "请输入有效的 PNG 文件名"
      const size = [width, height]
      if (size.some(n => !Number.isInteger(n) || n < 1 || n > 8192)) return "宽高必须是 1 至 8192 的整数"
      const base = appState.selectedResourceGalleryPath.substring(0, appState.selectedResourceGalleryPath.lastIndexOf("/")) || resourceRootPath()
      const path = `${base}/${name}`
      if (appState.archive.getBytes(path)) return "同名图片已存在"
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
      const base = appState.selectedResourceGalleryPath.substring(0, appState.selectedResourceGalleryPath.lastIndexOf("/")) || resourceRootPath()
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
  resourceDownloadButton.addEventListener("click", () => {
    void runFileOperation("下载资源", downloadResourceSelection)
  })
  resourceDeleteButton.addEventListener("click", async () => {
    if (appState.resourceCatalog === "font") { await deleteCatalogFont(); return }
    const archive = appState.archive
    if (!archive || appState.resourceInspectorMode !== "image" || !isEditing()) return
    const paths = appState.selectedResourceGalleryPaths.filter(path => archive.isImage(path))
    if (!paths.length) return
    const revision = archive.revision
    const target = paths.length === 1 ? `图片「${paths[0].split("/").pop()}」` : `${paths.length} 张图片`
    if (!await confirmDeletion(`删除${target}？`) || appState.archive !== archive || archive.revision !== revision || !isEditing()) return
    commitBatch(paths.map(path => ({ kind: "bytes", path, before: archive.getBytes(path) })))
    if (paths.includes(appState.selectedResourcePath)) {
      appState.selectedResourcePath = ""
      appState.slices = []
      appState.selectedTileIndex = undefined
      resourceDetail.hidden = true
      hideImageWorkspace()
    }
    appState.selectedResourceGalleryPath = ""
    appState.selectedResourceGalleryPaths = []
    updateResourceActionButtons()
    renderResourceInspector()
    updateDirty()
    showStatus(`已删除 ${paths.length} 张图片，可撤销`)
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
    // 列表、菜单、搜索框已经处理过这次按键（方向键选项、Delete 删除列表项、Esc 清除）。
    if (event.defaultPrevented || !settingsWorkspace.hidden) return
    const deleting = event.key === "Delete" && !event.repeat && !event.metaKey && !event.ctrlKey
      && !isTextEditingTarget(event.target) && !document.querySelector('dialog[open]:not(#atlas-editor-dialog)')
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
      if (deleting && isEditing()) {
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
    if (deleting && canvasEditable() && appState.selectedKeySections.length) {
      event.preventDefault()
      deleteSelectedKeys()
      return
    }
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return
    // The AI composer keeps its own text undo; the skin history is not what the user is typing.
    if (appState.atlasEdits || event.composedPath().includes(aiDesignChat)) return
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
      if (!settingsWorkspace.hidden) { settingsWorkspace.dispatchEvent(new Event("settings-request-exit")); return }
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
    // AppKit tracks activation itself; only the Windows material needs focus recovery.
    if (document.documentElement.classList.contains("windows")) void getCurrentWindow().onFocusChanged(({ payload: focused }) => {
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
        if (resourceDropTarget(target)) {
          if (!isEditing()) return
          if (payload.type === "drop") {
            const archive = appState.archive
            void runFileOperation("上传资源", async () => {
              const files = await Promise.all(payload.paths.map(async path => new File(
                [new Uint8Array(await invoke<ArrayBuffer>("read_file", { path }))], path.split(/[\\/]/).pop()!,
              )))
              return appState.archive === archive && uploadResourceFiles(files)
            })
          }
          return
        }
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
      if (path && (await prepareDocumentReplacement("open"))) {
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
