import { appState } from "./state"
import { source, toolbarPreview, preview, mobilePortraitQuery } from "./canvas-interaction"
import { toggleGuides, mobileToggleGuides, newTileButton, atlasCanvas, resourceListView, resourceDetail, sourceName, quickInspector, files } from "./dom"
import { setGuidesVisible, refreshPreview, syncCandidateSelection } from "./preview-render"
import { bdaAppearancePart, currentBdaAppearance, bdaBasePath, refreshBdaLayout, isBdaVirtualTextPath, isBdaLayoutPath, isBdaAppearancePartPath } from "./bda-documents"
import { hideImageWorkspace, renderResourceInspector, selectResourceImage } from "./resource-inspector"
import { IniDocument } from "../ini.ts"
import { previewItems } from "../preview-items.ts"
import { setSourceValue, showsLayoutProperties } from "./config-context"
import { decodedBdaAppearancePart, decodedBdaSource, decodedBdaEditorSource, bdaDecodedSourceEditable } from "../bda-source.ts"
import { showImage } from "./file-operations"
import { isListCell } from "../layout.ts"
import { updateInspectorView, updateSourceSearchStatus } from "./source-panel"
import { pickableImagePaths } from "./image-pickers"
import { populateKeyInspector } from "./key-inspector"
import { isSsfBoardPath, sourceEditPath, ssfBoardDocument } from "./ssf-documents"
import { isSxiBoardAddress, isSxiSourcePath, showSxiSource, sxiPointer } from "./sxi-documents"
import { ensureSourcePathRendered, setSidebarView, updateSourceFileActions } from "./source-files"

export function currentNavigationMode(): string {
  if (appState.resourceConfigActive) return appState.resourceInspectorMode === "image" ? "resource" : appState.resourceInspectorMode
  return appState.animationDesignMode === "all" ? "document" : appState.animationDesignMode
}

export function selectFile(
  path: string,
  preferredSidebarView = appState.sidebarView,
  resourceMode: "document" | "image" | "style" | "sound" | "motion" | "particle" = "document",
  preserveInspectorView = false,
): void {
  if (resourceMode !== "image") appState.bdaSliceReturn = undefined
  if (path !== appState.selectedPath) {
    source.commit()
    appState.selectedToolbarSections = []
    toolbarPreview.setSelected([])
  }
  appState.selectedCandidate = false
  const previousInspectorTab = appState.inspectorTab
  const preserveCurrentInspectorView = preserveInspectorView || path === appState.selectedPath
  if (path !== appState.selectedPath) appState.sourceHistoryHighlight = undefined
  appState.styleReturnPath = ""
  appState.styleReturnCandidate = false
  // A document refresh (undo, source sync, tree rebuild) keeps the selected animation view and its picked key.
  if (path !== appState.selectedPath || (resourceMode === "motion" || resourceMode === "particle") && resourceMode !== appState.animationDesignMode) appState.animationKeys = []
  if (resourceMode === "motion" || resourceMode === "particle") appState.animationDesignMode = resourceMode
  else if (path !== appState.selectedPath) appState.animationDesignMode = "all"
  appState.animationWorkspace?.update(appState.animationDesignMode !== "all")
  preview.animationView = appState.animationDesignMode !== "all"
  appState.resourceConfigActive = resourceMode === "image" || resourceMode === "style" || resourceMode === "sound"
  appState.resourceInspectorMode = resourceMode === "style" ? "style" : resourceMode === "sound" ? "sound" : "image"
  const guideLabel = appState.resourceInspectorMode === "image" && appState.resourceConfigActive ? "切片网格" : "辅助线"
  for (const button of [toggleGuides, mobileToggleGuides]) {
    button.title = guideLabel
    button.setAttribute("aria-label", guideLabel)
  }
  if (appState.resourceInspectorMode === "image" && appState.resourceConfigActive) setGuidesVisible(true)
  if (!appState.resourceConfigActive) {
    appState.selectedResourcePath = ""
    appState.drawingTile = false
    appState.tileDragStart = undefined
    appState.tileDraft = undefined
    newTileButton.classList.remove("active")
    atlasCanvas.classList.remove("drawing")
  } else {
    appState.selectedResourcePath = ""
    appState.selectedStyleID = ""
    appState.selectedSoundID = ""
    appState.selectedResourceGalleryPath = ""
    resourceListView.hidden = false
    resourceDetail.hidden = true
  }
  if (appState.archive?.isImage(path) && appState.selectedPath && !appState.archive.isImage(appState.selectedPath)) {
    appState.assetReturnPath = appState.selectedPath
  }
  appState.selectedPath = path
  if (path !== appState.layoutPath) {
    appState.selectedKeySections = []
    preview.setSelected([])
  }
  const appearancePart = bdaAppearancePart(path)
  if (appearancePart) {
    hideImageWorkspace()
    const info = currentBdaAppearance()
    if (!info) return
    const basePath = bdaBasePath(path)
    const base = appearancePart.kind === "panel" && appState.bdaBase?.isText(basePath)
      ? IniDocument.parse(appState.bdaBase.getText(basePath))
      : undefined
    const previewLayout = Boolean(base && previewItems(base).some((item) => item.editable))
    if (previewLayout && !refreshBdaLayout(path)) return
    appState.selectedDocument = previewLayout ? appState.layoutDocument : undefined
    if (previewLayout) {
      appState.selectedKeySections = []
      preview.setSelected([])
    }
    setSourceValue(decodedBdaAppearancePart(info.bytes, appearancePart))
    source.disabled = false
    const partName = appearancePart.kind === "panel" ? appearancePart.name : appearancePart.group
    sourceName.textContent = `${info.path} · ${partName} · 解码源码`
    appState.inspectorTab = "properties"
  } else if (isBdaVirtualTextPath(path)) {
    hideImageWorkspace()
    const panelName = path.split("/").pop()?.replace(/\.ini$/i, "") ?? path
    const base = IniDocument.parse(appState.bdaBase!.getText(bdaBasePath(path)))
    const previewLayout = isBdaLayoutPath(path) && previewItems(base).some((item) => item.editable)
    if (previewLayout && !refreshBdaLayout(path)) return
    if (previewLayout) appState.layoutPath = path
    appState.selectedDocument = previewLayout ? appState.layoutDocument : base
    if (previewLayout) {
      appState.selectedKeySections = []
      preview.setSelected([])
    }
    const info = currentBdaAppearance()
    setSourceValue(info ? decodedBdaSource(info.path, info.bytes, panelName) : "{}")
    source.disabled = true
    sourceName.textContent = info ? `${info.path} · ${panelName} · 解码源码` : panelName
    appState.inspectorTab = "properties"
  } else if (sxiPointer(path)) {
    // A part of a Palm skin.json: the source editor shows skin.json, the inspector the part itself.
    hideImageWorkspace()
    appState.selectedDocument = undefined
    showSxiSource(path)
    if (isSxiBoardAddress(path)) {
      // Undo / redo reselect the same board: the key selection stays.
      const kept = path === appState.layoutPath ? appState.selectedKeySections : []
      appState.layoutPath = path
      appState.layoutDocument = undefined
      appState.selectedKeySections = kept
      preview.setSelected(kept)
      refreshPreview()
    }
    appState.inspectorTab = "properties"
  } else if (appState.archive?.isImage(path)) {
    appState.inspectorTab = "properties"
    appState.selectedDocument = undefined
    showImage(path)
  } else if (appState.archive?.isText(path) || isSsfBoardPath(path)) {
    hideImageWorkspace()
    // A Sogou board is a skeleton layout, not a file of the skin; its source is the skin's phoneSkin.ini.
    appState.selectedDocument = ssfBoardDocument(path) ?? IniDocument.parse(appState.archive!.getText(path))
    const sourcePath = sourceEditPath(path)
    setSourceValue(appState.archive!.getText(sourcePath))
    source.disabled = false
    sourceName.textContent = sourcePath
    const previewLayout =
      /\.ini$/i.test(path) &&
      !/(^|\/)gen\.ini$/i.test(path) &&
      previewItems(appState.selectedDocument).some((item) => item.editable)
    if (previewLayout) {
      // 撤销 / 重做会重新选中同一个布局：保留仍然存在的按键选择，检查器不跳回面板。
      const existing = new Set(appState.selectedDocument.sections())
      const kept = path === appState.layoutPath
        ? appState.selectedKeySections.filter((section) => existing.has(section) || isListCell(section))
        : []
      appState.layoutPath = path
      appState.layoutDocument = appState.selectedDocument
      appState.selectedKeySections = kept
      preview.setSelected(kept)
      appState.inspectorTab = "properties"
    } else if (preferredSidebarView === "overview" || showsLayoutProperties(path)) {
      // INI/CND/POP 布局文件始终打开属性面板，不论从哪个侧边栏点进来。
      appState.inspectorTab = "properties"
    } else if (path !== appState.layoutPath) {
      appState.inspectorTab = "source"
    }
    if (isSxiSourcePath(path)) showSxiSource(path)
  } else if (appState.archive?.isBdaConfig(path)) {
    hideImageWorkspace()
    appState.selectedDocument = undefined
    setSourceValue(decodedBdaEditorSource(path, appState.archive.getBytes(path)!))
    source.disabled = !bdaDecodedSourceEditable(path)
    sourceName.textContent = `${path} · 解码源码${source.disabled ? "（原始字段，只读）" : ""}`
    appState.inspectorTab = "properties"
  } else {
    return
  }
  if (path === appState.layoutPath && appState.selectedDocument) {
    appState.layoutDocument = appState.selectedDocument
    refreshPreview()
  }
  if (preferredSidebarView === "source" && (
    appState.archive?.isText(path) || appState.archive?.isBdaConfig(path) || isBdaAppearancePartPath(path)
) && path !== appState.layoutPath && !showsLayoutProperties(path)) {
    appState.inspectorTab = "source"
  }
  // 右侧停在源代码时，任何选择操作都不跳回属性面板。
  if (preserveCurrentInspectorView || previousInspectorTab === "source") {
    appState.inspectorTab = previousInspectorTab
  }
  updateInspectorView()
  if (appState.resourceConfigActive) renderResourceInspector()
  if (resourceMode === "image" && appState.archive) {
    const firstImage = pickableImagePaths()[0]
    if (firstImage) selectResourceImage(firstImage)
  }
  if (!quickInspector.hidden) populateKeyInspector()
  appState.selectedFileButton?.classList.remove("selected")
  if (preferredSidebarView === "source") ensureSourcePathRendered(path)
  const preferredContainer = files.querySelector(preferredSidebarView === "overview" ? ".sidebar-overview" : ".raw-files")
  const navMode = currentNavigationMode()
  appState.selectedFileButton = preferredContainer?.querySelector<HTMLElement>(`button[data-path="${CSS.escape(path)}"][data-nav-mode="${navMode}"]`)
    ?? preferredContainer?.querySelector<HTMLElement>(`button[data-path="${CSS.escape(path)}"]`)
    ?? files.querySelector<HTMLElement>(`button[data-path="${CSS.escape(path)}"]`)
    ?? undefined
  if (appState.selectedFileButton) {
    setSidebarView(appState.selectedFileButton.closest(".raw-files") ? "source" : "overview")
  }
  appState.selectedFileButton?.classList.add("selected")
  if (mobilePortraitQuery.matches) {
    const group = appState.selectedFileButton?.closest<HTMLElement>(".nav-group")?.dataset.overviewGroup
    files.querySelector<HTMLButtonElement>(`.mobile-overview-groups button[data-overview-group="${CSS.escape(group ?? "")}"]`)?.click()
  }
  updateSourceFileActions()
  updateSourceSearchStatus()
  syncCandidateSelection()
}

export const overviewGroupState = new Map<string, boolean>()
