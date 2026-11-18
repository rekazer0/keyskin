import { source, keyboardFields, layoutActionButtons, preview, inspectorTabButtons, mobilePortraitQuery, activateSkinState, selectCandidateBar } from "../canvas-interaction"
import { bindDialog } from "../ask.ts"
import { renderResourceCatalogSearch } from "../resource-page"
import { searchField } from "../../dom-element.ts"
import { closeDialog } from "../../motion.ts"
import { type SourceEditorValueClick } from "../../lazy-source-editor.ts"
import { openSourceColorPicker, openSourceStyleDefinition, openSourceStylePicker, scheduleSourceSearch, closeSourceFind, findSourceMatch, openSourceFind, syncSourceFindBarOffset, replaceSourceMatches, updateInspectorView, updateSourceHighlight, toggleInspectorSource } from "../source-panel"
import { settingsWorkspace, sourceSearch, sourceSearchPrevious, sourceSearchNext, sourceFindToggle, sourceEditor, sourceReplaceToggle, sourceReplaceRow, sourceReplacement, sourceReplace, sourceReplaceAll, keyFields, toolbarFields, skinFields, gapFields, quickInspector, keyModeButtons, keyActionButtons, keyActionMenuItems, aiDesignPanel, aiDesignStatus, theme, orientation, mode, eventLog, modeChoiceButtons, mobileChoiceButtons, toggleGuides, mobilePreviewGuides, newTileButton, duplicateTileButton, deleteTileButton, resourceBackButton, resourceSearch, resourceCategory, bdaTileUsage, tileModeButtons, atlasCanvas, workspaceImage, tileSourceFields, tileInnerFields, skinState, panelScaleButton, adaptIos26Button, replaceLayoutImageButton, layoutImageFile, layoutImageOpen, layoutImageDialog, layoutImageTargetInputs, layoutImageScope, layoutImageError, layoutImageConfigButtons, layoutImageConfigFieldset, layoutImageForm, panelCopySource, panelTargetWidth, panelTargetHeight, panelCopyTarget, panelScaleEnabled, panelScaleForm, panelScaleDialog, candidateArea, fontImportInput } from "../dom"
import { appState } from "../state"
import { resourceSourceToggle } from "../dom"
import { resizeMobileInspector } from "../mobile-inspector"
import { updateSelectedKey, updateKeyboard, updateToolbar, updateSkinInfo, populateKeyInspector } from "../key-inspector"
import { scrollSelectedSource } from "../config-context"
import { applyExactGap, moveMixedCoordinate, applyLayoutAction, copySelectedKeys, deleteSelectedKeys } from "../key-editing"
import { shouldClearMixedInput } from "../../mixed-input.ts"
import { syncCandidateSelection, updateDevicePreview, refreshPreview, setGuidesVisible } from "../preview-render"
import { setMobilePane, syncSegmentedControls, applyModeState, selectChoice, setMobileInspectorGroup, requestEditMode } from "../mobile-layout"
import { ensureAiChat, aiDesignErrorMessage } from "../ai-panel"
import { switchSsfPreviewLayout } from "../ssf-preview"
import { preferredPalmBoard, switchPalmLayout } from "../sxi-documents"
import { preferredPath, createMissingVariant, bdaAvailableLayoutPaths, bdaAppearanceStyleGroups, bdaAppearanceStylePath } from "../bda-documents"
import { renderFiles } from "../file-tree"
import { selectFile } from "../navigation"
import { IniDocument } from "../../ini.ts"
import { importFontFile } from "../skin-fonts"
import { populateTileInspector, setDrawingTile, duplicateSelectedTile, deleteSelectedTile, drawAtlas, atlasPoint, scheduleAtlasDraw, commitTile, updateSelectedTile, nextSliceIndex } from "../tile-editing"
import { isEditing } from "../edit-history"
import { selectStyleResource, showResourceList, renderResourceInspector, renderStyleResourceDetail } from "../resource-inspector"
import { revealSourceFile } from "../source-files"
import { type BdaAppearanceStyleGroup } from "../../bda.ts"
import { tileSliceAt, boundedTileRect, moveTileRect } from "../../tiles.ts"
import { resizeTileSlice } from "../../tiles"
import { runFileOperation, adaptArchiveForIos26 } from "../file-operations"
import { openPanelCopyDialog, updatePanelCopyForm, copyPanel } from "../panel-copy"
import { openLayoutImageDialog, acceptLayoutImageFile, syncLayoutImageConfig, updateLayoutImageForm, applyLayoutImage, layoutImageScopeText } from "../layout-image-replace"
import { type LayoutImageTarget } from "../../layout-image.ts"
import { type LayoutImageConfig } from "../types"
import { inspectorSourceToggle } from "../dom"
import { layoutConversionButton, mobileLayoutImageTarget, mobileLayoutImageConfig, mobilePanelScaleMode } from "../dom"
import { openLayoutConversionDialog } from "../layout-conversion"

/** 源码编辑器、属性字段、主题与方向、资源与键盘图替换。只在启动时由 main.ts 按顺序调用一次。 */
export function wireEditingControls(): void {
  inspectorSourceToggle.addEventListener("click", () => toggleInspectorSource(populateKeyInspector))
  resourceSourceToggle.addEventListener("click", () => toggleInspectorSource(() => {
    if (appState.inspectorTab === "properties") void renderStyleResourceDetail()
  }))
  fontImportInput.addEventListener("change", () => {
    const file = fontImportInput.files?.[0]
    if (file) void importFontFile(file, fontImportInput.dataset.theme)
  })
  source.addEventListener("valueclick", (event) => {
    const detail = (event as CustomEvent<SourceEditorValueClick>).detail
    if (!detail || detail.kind === "action") return
    if (detail.kind === "color") openSourceColorPicker(detail)
    else if (detail.kind === "style" && detail.modifier) openSourceStyleDefinition(detail.value.replace(/^STYLE/i, ""))
    else if (detail.kind === "style") openSourceStylePicker(detail)
  })
  sourceSearch.addEventListener("input", () => {
    appState.sourceSearchIndex = sourceSearch.value.trim() ? 0 : -1
    scheduleSourceSearch()
  })
  sourceSearch.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault()
      closeSourceFind()
      return
    }
    if (event.key !== "Enter") return
    event.preventDefault()
    findSourceMatch(event.shiftKey ? -1 : 1)
  })
  sourceSearchPrevious.addEventListener("click", () => findSourceMatch(-1))
  sourceSearchNext.addEventListener("click", () => findSourceMatch(1))
  sourceFindToggle.addEventListener("click", () => {
    if (appState.sourceFindVisible) closeSourceFind()
    else openSourceFind()
  })
  window.addEventListener("keydown", (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== "f") return
    if (!settingsWorkspace.hidden || sourceEditor.hidden) return
    event.preventDefault()
    openSourceFind()
  })
  sourceReplaceToggle.addEventListener("click", () => {
    const expanded = sourceReplaceRow.hidden
    sourceReplaceRow.hidden = !expanded
    sourceReplaceToggle.setAttribute("aria-expanded", String(expanded))
    sourceReplaceToggle.title = sourceReplaceToggle.ariaLabel = expanded ? "收起替换" : "展开替换"
    syncSourceFindBarOffset()
    if (expanded) sourceReplacement.focus()
  })
  sourceReplace.addEventListener("click", () => replaceSourceMatches(false))
  sourceReplaceAll.addEventListener("click", () => replaceSourceMatches(true))
  sourceReplacement.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return
    event.preventDefault()
    replaceSourceMatches(event.metaKey || event.ctrlKey)
  })
  for (const field of keyFields) {
    field.addEventListener("input", () => {
      updateSelectedKey(field)
    })
  }
  for (const field of keyboardFields) {
    field.addEventListener("change", () => updateKeyboard(field))
  }
  for (const field of toolbarFields) {
    field.addEventListener("change", () => updateToolbar(field))
  }
  for (const field of skinFields) {
    field.addEventListener("change", () => updateSkinInfo(field))
  }
  for (const field of gapFields) {
    field.addEventListener("change", () => applyExactGap(field))
  }
  // Mixed coordinate wheel edits share the document-level gesture scheduler/history.
  quickInspector.addEventListener("keydown", (event) => {
    const field = event.target
    if (!(field instanceof HTMLInputElement)) return
    const direction = (event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0) * (event.shiftKey ? 10 : 1)
    if (moveMixedCoordinate(field, direction, event.repeat)) {
      event.preventDefault()
      return
    }
    if (!shouldClearMixedInput(event.key, field.placeholder, field.disabled)) return
    event.preventDefault()
    field.value = ""
    field.placeholder = ""
    field.dispatchEvent(new Event("input", { bubbles: true }))
  })
  for (const button of layoutActionButtons) {
    button.addEventListener("click", () => applyLayoutAction(button.dataset.layoutAction ?? ""))
  }
  for (const button of keyModeButtons) {
    button.addEventListener("click", () => {
      appState.keyMode = button.dataset.keyMode === "move" ? "move" : "select"
      keyModeButtons.forEach((item) => item.setAttribute("aria-pressed", String(item.dataset.keyMode === appState.keyMode)))
      preview.setEditTool(appState.keyMode)
    })
  }
  for (const button of keyActionButtons) {
    button.addEventListener("click", () => {
      if (button.dataset.keyAction === "copy") copySelectedKeys()
      else if (button.dataset.keyAction === "swap") applyLayoutAction("swap")
      else deleteSelectedKeys()
    })
  }
  // 手机「更多」菜单项：点它等于点同一个对象操作按钮（动作、撤销、提示都只写一遍）
  for (const item of keyActionMenuItems) {
    item.addEventListener("click", () => {
      keyActionButtons.find((button) => button.dataset.keyAction === item.dataset.keyActionRef)?.click()
    })
  }
  for (const button of inspectorTabButtons) {
    button.addEventListener("click", () => {
      const tab = button.dataset.inspectorTab
      appState.inspectorTab = tab === "source" ? "source" : tab === "ai" ? "ai" : "properties"
      if (mobilePortraitQuery.matches) {
        if (appState.inspectorTab !== "properties" && document.documentElement.dataset.mobilePanel === "collapsed") resizeMobileInspector(50)
        setMobilePane("inspector")
      }
      updateInspectorView()
      if (!quickInspector.hidden) populateKeyInspector()
      if (!aiDesignPanel.hidden) {
        void ensureAiChat()
          .catch((error) => { aiDesignStatus.textContent = aiDesignErrorMessage(error) })
      }
    })
  }
  for (const control of [theme, orientation]) {
    control.addEventListener("change", () => {
      const browsing = control === theme && appState.resourceConfigActive
      const archive = appState.archive
      const otherOrientation = orientation.value === "port" ? "land" : "port"
      let path = preferredPath()
      // 切换外观或横竖屏时，搜狗皮肤停留在当前键盘（概览里选的可能不是 9 / 26 键）。
      if (appState.archive?.format === "ssf") {
        return switchSsfPreviewLayout(path.replace(/[^/]+$/, appState.layoutPath.split("/").pop()!))
      }
      if (archive?.format === "sxi") {
        if (browsing && !preferredPalmBoard()) orientation.value = otherOrientation
        return switchPalmLayout()
      }
      if (control === theme && archive) {
        // 外观目录已就绪；在目标外观中选择可用布局，不补复制单个布局。
        const layouts = () => {
          if (archive.format === "bda") return bdaAvailableLayoutPaths()
          const prefix = `${theme.value}/skin/${orientation.value}/`
          return archive.names().filter(name => name.startsWith(prefix) && /^(?!gen\.ini$)[^/]+\.ini$/i.test(name.slice(prefix.length)))
        }
        let paths = layouts()
        if (!paths.length) {
          const previous = orientation.value
          orientation.value = otherOrientation
          paths = layouts()
          if (!paths.length) orientation.value = previous
        }
        path = paths.includes(preferredPath()) ? preferredPath() : paths[0] ?? path
        if (!paths.length) renderFiles()
      } else if (!createMissingVariant(path)) return
      let selected = false
      if (appState.archive?.format === "bda") {
        renderFiles()
        if (bdaAvailableLayoutPaths().includes(path)) {
          selectFile(path)
          selected = true
        }
      } else if (appState.archive?.names().includes(path)) {
        appState.layoutPath = path
        appState.layoutDocument = IniDocument.parse(appState.archive.getText(path))
        appState.selectedKeySections = []
        preview.setSelected([])
        renderFiles()
        selectFile(path)
        selected = true
      }
      updateDevicePreview()
      syncSegmentedControls()
      if (!selected) refreshPreview()
    })
  }
  mode.addEventListener("change", () => {
    applyModeState()
    if (appState.resourceConfigActive) {
      renderResourceInspector()
      if (appState.resourceInspectorMode === "style" && appState.selectedStyleID) void renderStyleResourceDetail()
      populateTileInspector()
    }
    else populateKeyInspector()
    eventLog.textContent = ""
  })
  // 只读表单里的禁用控件仍接收指针（components.css），点击统一提示切换模式。
  document.addEventListener("pointerdown", (event) => {
    const target = event.target instanceof Element ? event.target.closest(":disabled") : null
    if (!target?.closest('.ui-form[data-readonly="true"]')) return
    event.preventDefault()
    requestEditMode()
  })
  for (const button of modeChoiceButtons) {
    button.addEventListener("click", () => selectChoice(mode, button.dataset.modeChoice ?? "preview"))
  }
  for (const button of mobileChoiceButtons) {
    button.addEventListener("click", () => {
      const choice = button.dataset.mobileChoice
      const select = choice === "mode" ? mode : choice === "theme" ? theme : orientation
      const values = Array.from(select.options).map((option) => option.value)
      const next = values[(values.indexOf(select.value) + 1) % values.length]
      selectChoice(select, next)
    })
  }
  for (const button of [toggleGuides, mobilePreviewGuides]) {
    button.addEventListener("click", () => setGuidesVisible(!appState.guidesVisible))
  }
  newTileButton.addEventListener("click", () => {
    if (!appState.selectedResourcePath || !isEditing()) return
    if (!appState.guidesVisible) setGuidesVisible(true)
    setDrawingTile(!appState.drawingTile)
  })
  duplicateTileButton.addEventListener("click", duplicateSelectedTile)
  deleteTileButton.addEventListener("click", deleteSelectedTile)
  resourceBackButton.addEventListener("click", () => {
    if (appState.resourceInspectorMode === "image" && appState.bdaSliceReturn) {
      const { path, styleID, styleReturnPath, styleReturnCandidate } = appState.bdaSliceReturn
      selectFile(path, "overview", "style")
      appState.styleReturnPath = styleReturnPath
      appState.styleReturnCandidate = styleReturnCandidate
      selectStyleResource(styleID)
      return
    }
    if (appState.resourceInspectorMode === "style" && appState.styleReturnPath) {
      const path = appState.styleReturnPath
      const selection = [...appState.styleReturnSelection]
      const candidate = appState.styleReturnCandidate
      const scrollTop = appState.styleReturnScrollTop
      const inspectorGroup = appState.styleReturnInspectorGroup
      appState.styleReturnPath = ""
      appState.styleReturnCandidate = false
      selectFile(path, "overview")
      appState.selectedKeySections = candidate ? [] : selection
      appState.selectedToolbarSections = candidate ? selection : []
      appState.selectedCandidate = candidate
      preview.setSelected(appState.selectedKeySections)
      syncCandidateSelection()
      populateKeyInspector()
      if (inspectorGroup) setMobileInspectorGroup(inspectorGroup, false)
      quickInspector.scrollTop = scrollTop
      revealSourceFile(path)
      return
    }
    showResourceList()
  })
  searchField({ label: "搜索图片", input: resourceSearch, onInput: () => { if (!renderResourceCatalogSearch()) renderResourceInspector() } })
  resourceCategory.addEventListener("change", () => {
    if (appState.archive?.format !== "bda" || appState.resourceInspectorMode !== "style" || !appState.resourceConfigActive) {
      renderResourceInspector()
      return
    }
    const group = resourceCategory.value as BdaAppearanceStyleGroup
    if (!bdaAppearanceStyleGroups.some(([value]) => value === group)) return
    source.commit()
    appState.selectedBdaStyleGroup = group
    renderFiles()
    selectFile(bdaAppearanceStylePath(group), "overview", "style")
  })
  bdaTileUsage.addEventListener("change", () => {
    appState.selectedTileIndex = Number(bdaTileUsage.value)
    populateTileInspector()
    drawAtlas()
  })
  for (const button of tileModeButtons) {
    button.addEventListener("click", () => {
      appState.tileMode = button.dataset.tileMode === "move" ? "move" : "select"
      tileModeButtons.forEach((item) => item.setAttribute("aria-pressed", String(item === button)))
      setDrawingTile(false)
    })
  }
  atlasCanvas.addEventListener("pointerdown", (event) => {
    if (!appState.resourceConfigActive || event.button !== 0) return
    const point = atlasPoint(event)
    if (appState.drawingTile) {
      appState.tileDragStart = point
      appState.tileDraft = undefined
      atlasCanvas.setPointerCapture(event.pointerId)
      return
    }
    appState.tileResizeCorner = undefined
    const selected = appState.slices.find(slice => slice.index === appState.selectedTileIndex)
    if (selected && isEditing() && appState.archive?.format !== "bda" && appState.guidesVisible) {
      const [x, y, w, h] = selected.source
      const radius = 9 * workspaceImage.naturalWidth / Math.max(1, atlasCanvas.getBoundingClientRect().width)
      const corner = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].findIndex(([cx, cy]) => Math.abs(point.x - cx) <= radius && Math.abs(point.y - cy) <= radius)
      if (corner >= 0) {
        appState.tileResizeCorner = corner
        appState.movingTile = appState.tileDragOriginal = selected
        atlasCanvas.setPointerCapture(event.pointerId)
        return
      }
    }
    const hit = appState.archive?.format === "bda"
      ? appState.slices.find((slice) => slice.index === appState.selectedTileIndex)
      : tileSliceAt(appState.slices, point)
    appState.selectedTileIndex = hit?.index
    updateSourceHighlight()
    if (hit) requestAnimationFrame(scrollSelectedSource)
    if (appState.tileMode === "move" && hit && isEditing() && appState.archive?.format !== "bda") {
      appState.movingTile = hit
      appState.tileDragOriginal = hit
      appState.moveStart = point
      appState.moveSource = hit.source
      atlasCanvas.setPointerCapture(event.pointerId)
    }
    populateTileInspector()
    drawAtlas()
  })
  atlasCanvas.addEventListener("pointermove", (event) => {
    if (appState.tileResizeCorner !== undefined && appState.tileDragOriginal) {
      appState.movingTile = resizeTileSlice(appState.tileDragOriginal, appState.tileResizeCorner, atlasPoint(event), workspaceImage.naturalWidth, workspaceImage.naturalHeight)
      scheduleAtlasDraw()
      return
    }
    if (appState.tileDragStart && appState.drawingTile) {
      appState.tileDraft = boundedTileRect(appState.tileDragStart, atlasPoint(event), workspaceImage.naturalWidth, workspaceImage.naturalHeight)
      scheduleAtlasDraw()
      return
    }
    if (!appState.moveStart || !appState.moveSource || !appState.movingTile) return
    const point = atlasPoint(event)
    const source = moveTileRect(appState.moveSource, point.x - appState.moveStart.x, point.y - appState.moveStart.y, workspaceImage.naturalWidth, workspaceImage.naturalHeight)
    const dx = source[0] - appState.moveSource[0]
    const dy = source[1] - appState.moveSource[1]
    appState.movingTile = { ...appState.movingTile, source, ...(appState.tileDragOriginal?.inner ? { inner: moveTileRect(appState.tileDragOriginal.inner, dx, dy, workspaceImage.naturalWidth, workspaceImage.naturalHeight) } : {}) }
    scheduleAtlasDraw()
  })
  atlasCanvas.addEventListener("pointerup", (event) => {
    if (atlasCanvas.hasPointerCapture(event.pointerId)) atlasCanvas.releasePointerCapture(event.pointerId)
    appState.tileResizeCorner = undefined
    appState.tileDragOriginal = undefined
    if (appState.tileDragStart && appState.drawingTile) {
      appState.tileDraft = boundedTileRect(appState.tileDragStart, atlasPoint(event), workspaceImage.naturalWidth, workspaceImage.naturalHeight)
      const source = appState.tileDraft
      setDrawingTile(false)
      if (source) commitTile({ index: nextSliceIndex(), source })
      return
    }
    if (appState.movingTile) {
      const moved = appState.movingTile
      appState.movingTile = undefined
      appState.moveStart = undefined
      appState.moveSource = undefined
      commitTile(moved)
    }
  })
  atlasCanvas.addEventListener("pointercancel", () => {
    appState.tileResizeCorner = undefined
    appState.tileDragOriginal = undefined
    setDrawingTile(false)
    appState.movingTile = undefined
    appState.moveStart = undefined
    appState.moveSource = undefined
    drawAtlas()
  })
  for (const field of [...tileSourceFields, ...tileInnerFields]) {
    field.addEventListener("change", updateSelectedTile)
  }
  skinState.addEventListener("change", () => {
    const state = skinState.value ? Number(skinState.value) : undefined
    activateSkinState(state)
  })
  panelScaleButton.addEventListener("click", openPanelCopyDialog)
  layoutConversionButton.addEventListener("click", openLayoutConversionDialog)
  // 适配走撤销栈，不再确认（DESIGN.md §7）。
  adaptIos26Button.addEventListener("click", () => void runFileOperation("适配 iOS 26", adaptArchiveForIos26))
  replaceLayoutImageButton.addEventListener("click", openLayoutImageDialog)
  bindDialog(layoutImageDialog)
  bindDialog(panelScaleDialog)
  layoutImageFile.addEventListener("click", () => layoutImageOpen.click())
  layoutImageOpen.addEventListener("change", () => {
    acceptLayoutImageFile(layoutImageOpen.files?.[0])
    layoutImageOpen.value = ""
  })
  layoutImageFile.addEventListener("dragenter", (event) => {
    if (!event.dataTransfer?.types.includes("Files")) return
    event.preventDefault()
    appState.layoutImageDragDepth += 1
    layoutImageFile.classList.add("drop-target")
  })
  layoutImageFile.addEventListener("dragover", (event) => {
    if (!event.dataTransfer?.types.includes("Files")) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
  })
  layoutImageFile.addEventListener("dragleave", () => {
    appState.layoutImageDragDepth = Math.max(0, appState.layoutImageDragDepth - 1)
    if (!appState.layoutImageDragDepth) layoutImageFile.classList.remove("drop-target")
  })
  layoutImageFile.addEventListener("drop", (event) => {
    if (!event.dataTransfer?.types.includes("Files")) return
    event.preventDefault()
    appState.layoutImageDragDepth = 0
    layoutImageFile.classList.remove("drop-target")
    acceptLayoutImageFile(event.dataTransfer.files[0])
  })
  layoutImageDialog.addEventListener("dragover", (event) => {
    if (event.dataTransfer?.types.includes("Files")) event.preventDefault()
  })
  layoutImageDialog.addEventListener("drop", (event) => {
    if (event.dataTransfer?.types.includes("Files")) event.preventDefault()
  })
  for (const input of layoutImageTargetInputs) {
    input.addEventListener("change", () => {
      appState.layoutImageTarget = input.value as LayoutImageTarget
      layoutImageScope.textContent = layoutImageScopeText()
      layoutImageError.hidden = true
      layoutImageError.textContent = ""
      syncLayoutImageConfig()
      updateLayoutImageForm()
    })
  }
  for (const button of layoutImageConfigButtons) {
    button.addEventListener("click", () => {
      if (layoutImageConfigFieldset.disabled) return
      const value = button.dataset.layoutImageConfig as LayoutImageConfig
      if (value === appState.layoutImageConfig) return
      appState.layoutImageConfig = value
      syncLayoutImageConfig()
    })
  }
  mobileLayoutImageTarget.addEventListener("change", () => {
    const input = layoutImageTargetInputs.find(input => input.value === mobileLayoutImageTarget.value)!
    input.checked = true
    input.dispatchEvent(new Event("change"))
  })
  mobileLayoutImageConfig.addEventListener("change", () => {
    layoutImageConfigButtons.find(button => button.dataset.layoutImageConfig === mobileLayoutImageConfig.value)?.click()
  })
  layoutImageForm.addEventListener("submit", (event) => {
    const submitter = event.submitter as HTMLButtonElement | null
    if (submitter?.value !== "apply") return
    event.preventDefault()
    void applyLayoutImage()
  })
  panelCopySource.addEventListener("input", () => {
    panelTargetWidth.value = ""
    panelTargetHeight.value = ""
    updatePanelCopyForm()
  })
  panelCopyTarget.addEventListener("input", updatePanelCopyForm)
  panelScaleEnabled.addEventListener("change", updatePanelCopyForm)
  mobilePanelScaleMode.addEventListener("change", () => {
    panelScaleEnabled.checked = mobilePanelScaleMode.value === "scale"
    updatePanelCopyForm()
  })
  panelScaleForm.addEventListener("submit", (event) => {
    if ((event.submitter as HTMLButtonElement | null)?.value !== "copy") return
    event.preventDefault()
    closeDialog(panelScaleDialog)
    void runFileOperation("复制面板", copyPanel)
  })
  candidateArea.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLElement && event.target.id === "candidate-input" && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault()
      event.target.click()
    }
  })
  candidateArea.addEventListener("click", (event) => {
    if (!isEditing()) return
    if (event.target instanceof Element && event.target.closest("#toolbar-preview")) return
    const inputRegion = event.target instanceof Element && Boolean(event.target.closest("#candidate-input"))
    if (inputRegion) appState.textStyleTarget = "input"
    selectCandidateBar(inputRegion)
  })
}
