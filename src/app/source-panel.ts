import { isSxiSourcePath, sxiPointer } from "./sxi-documents"
import { sxiSectionRanges } from "../palm/sxi-edit.ts"
import { isSsfBoardPath, sourceEditPath } from "./ssf-documents"
import { syncAtlasWorkspace } from "./tile-editing"
import { files, sourceName, quickInspector, asset, resourceInspector, sourceEditor, aiDesignPanel, sourceToolbar, sourceFindToggle, sourceSearch, sourceValueHintsEnabled, sourceCompletionEnabled, sourceLineExplanationEnabled, sourceSearchCount, sourceSearchPrevious, sourceSearchNext, sourceReplacement, sourceReplace, sourceReplaceAll, sourceColorPicker, sourceStyleProxy } from "./dom"
import { appState } from "./state"
import { showsLayoutProperties, selectedSourceSections, styleConfigPath, sxiSourceRanges } from "./config-context"
import { isBdaLayoutPath, bdaAppearancePart, isBdaVirtualTextPath, isBdaAppearancePartPath, commitBdaSourceEdit, visualResolver, bdaAppearanceStylePath } from "./bda-documents"
import { inspectorTabButtons, source, mobilePortraitQuery, preview } from "./canvas-interaction"
import { loadVisibleSourceEditor } from "./resource-inspector"
import { refreshPreview, syncCandidateSelection } from "./preview-render"
import { populateKeyInspector } from "./key-inspector"
import { jsonPropertyRanges, iniSectionRanges, findTextMatches, replaceTextMatches, jsonPropertyAtOffset, iniSectionAtOffset } from "../highlight.ts"
import { selectedBdaSourceKeys } from "./document-inspector"
import { sourceValueRanges, replacedSourceColor } from "../source-value-ranges.ts"
import { type SourceEditorValueRange, type SourceEditorValueClick } from "../lazy-source-editor.ts"
import { retinaThumbnail, drawVisualPreview } from "../atlas.ts"
import { bdaStyleRef } from "../bda.ts"
import { selectFile } from "./navigation"
import { setMobilePane } from "./mobile-layout"
import { isEditing } from "./edit-history"
import { openStylePicker } from "./style-picker"
import { openStyleReferenceStateImage } from "./style-references"
import { previewItems } from "../preview-items.ts"

export function updateInspectorView(): void {
  syncAtlasWorkspace()
  const imageSelected = Boolean(appState.archive?.isImage(appState.selectedPath))
  const overviewSelected = Boolean(
    files.querySelector(`.sidebar-overview button[data-path="${CSS.escape(appState.selectedPath)}"]`),
  )
  const layoutSelected = appState.selectedPath === appState.layoutPath && /\.ini$/i.test(appState.selectedPath)
  // ini/cnd/pop 布局配置文档自带属性面板，无需依赖概览分组；其余文本仍要求来自概览或当前布局。
  const configLayoutSelected = showsLayoutProperties(appState.selectedPath)
  const propertiesAvailable = Boolean(
    appState.selectedPath && (
      appState.archive?.isText(appState.selectedPath) || appState.archive?.isBdaConfig(appState.selectedPath) || isBdaLayoutPath(appState.selectedPath) ||
      isSsfBoardPath(appState.selectedPath) || Boolean(sxiPointer(appState.selectedPath)) ||
      bdaAppearancePart(appState.selectedPath)
    ) && (configLayoutSelected || overviewSelected || layoutSelected) && !imageSelected,
  )
  for (const button of inspectorTabButtons) {
    const tab = button.dataset.inspectorTab
    const available = appState.resourceConfigActive
      ? tab === "ai" || tab === "properties" || tab === "source" && Boolean(appState.selectedPath) && !(
        (appState.archive?.format === "bda" || appState.archive?.format === "ssf") && appState.resourceInspectorMode === "image"
      )
      :
      tab === "ai"
        ? true
        : tab === "properties"
        ? imageSelected || propertiesAvailable
        : !imageSelected && Boolean(appState.selectedPath)
    button.disabled = !available
    button.classList.toggle("active", tab === appState.inspectorTab && available)
    button.setAttribute("aria-pressed", String(tab === appState.inspectorTab && available))
  }
  if (appState.resourceConfigActive) {
    sourceName.textContent = appState.inspectorTab === "source" && appState.selectedResourcePath
      ? appState.archive?.format === "bda" ? "BDA 切片由 appearanceConfig 管理" : appState.tilePath
      : appState.selectedResourcePath || appState.selectedPath
    if (sxiPointer(appState.selectedPath)) sourceName.textContent = "skin.json"
    quickInspector.hidden = true
    asset.hidden = true
    resourceInspector.hidden = appState.inspectorTab !== "properties"
    sourceEditor.hidden = appState.inspectorTab !== "source"
    aiDesignPanel.hidden = appState.inspectorTab !== "ai"
    updateSourceFindVisibility()
    loadVisibleSourceEditor()
    return
  }
  resourceInspector.hidden = true
  if (imageSelected) {
    quickInspector.hidden = true
    sourceEditor.hidden = true
    aiDesignPanel.hidden = appState.inspectorTab !== "ai"
    asset.hidden = appState.inspectorTab === "ai"
    updateSourceFindVisibility()
    return
  }
  asset.hidden = true
  quickInspector.hidden = appState.inspectorTab !== "properties" || !propertiesAvailable
  sourceEditor.hidden = appState.inspectorTab !== "source"
  aiDesignPanel.hidden = appState.inspectorTab !== "ai"
  updateSourceFindVisibility()
  loadVisibleSourceEditor()
}

export function syncSourceFindBarOffset(): void {
  // 悬浮按钮始终贴在搜索栏上方，避免被底部弹出的搜索栏盖住。
  const height = sourceToolbar.hidden ? 0 : sourceToolbar.offsetHeight
  sourceEditor.style.setProperty("--source-find-bar-height", `${height}px`)
}

export function updateSourceFindVisibility(): void {
  // 圆形查找按钮悬浮在源代码右下角，点击后底部弹出搜索栏；Ctrl/Cmd + F 也可唤出。
  const sourceVisible = !sourceEditor.hidden
  const expanded = sourceVisible && appState.sourceFindVisible
  sourceFindToggle.hidden = !sourceVisible
  sourceFindToggle.setAttribute("aria-pressed", String(expanded))
  sourceFindToggle.setAttribute("aria-expanded", String(expanded))
  sourceFindToggle.title = sourceFindToggle.ariaLabel = appState.sourceFindVisible ? "收起查找" : "查找（Ctrl/⌘ + F）"
  sourceToolbar.hidden = !expanded
  syncSourceFindBarOffset()
}

export function openSourceFind(): void {
  if (sourceEditor.hidden) return
  appState.sourceFindVisible = true
  updateSourceFindVisibility()
  sourceSearch.focus()
  sourceSearch.select()
}

export function closeSourceFind(): void {
  if (!appState.sourceFindVisible) return
  appState.sourceFindVisible = false
  updateSourceFindVisibility()
  sourceFindToggle.focus()
}

const SOURCE_SEARCH_HIGHLIGHT_LIMIT = 20_000

export function scheduleSourceInputHighlight(refreshInspector = false): void {
  appState.sourceInputRefreshPending ||= refreshInspector
  if (appState.sourceInputHighlightTimer !== undefined) window.clearTimeout(appState.sourceInputHighlightTimer)
  appState.sourceInputHighlightTimer = window.setTimeout(() => {
    appState.sourceInputHighlightTimer = undefined
    updateSourceHighlight()
  }, 100)
}

export function scheduleSourceSearch(): void {
  if (appState.sourceSearchTimer !== undefined) window.clearTimeout(appState.sourceSearchTimer)
  appState.sourceSearchTimer = window.setTimeout(() => {
    appState.sourceSearchTimer = undefined
    updateSourceHighlight()
  }, 80)
}

export function updateSourceHighlight(): void {
  if (appState.sourceSearchTimer !== undefined) window.clearTimeout(appState.sourceSearchTimer)
  appState.sourceSearchTimer = undefined
  if (appState.sourceInputHighlightTimer !== undefined) window.clearTimeout(appState.sourceInputHighlightTimer)
  appState.sourceInputHighlightTimer = undefined
  if (appState.sourceInputRefreshPending) {
    appState.sourceInputRefreshPending = false
    refreshPreview()
    populateKeyInspector()
  }
  const sections = selectedSourceSections()
  const query = sourceSearch.value.trim()
  const bdaSource = Boolean(appState.archive?.format === "bda" && (
    appState.archive.isBdaConfig(appState.selectedPath) || isBdaVirtualTextPath(appState.selectedPath) || isBdaAppearancePartPath(appState.selectedPath)
  ))
  const sxiSource = isSxiSourcePath(appState.selectedPath)
  const jsonSource = bdaSource || sxiSource
  source.setLanguage(jsonSource ? "json" : "ini")
  const matches = sourceSearchMatches()
  updateSourceSearchStatus(matches)
  const selectedRanges = sxiSource
    ? sxiSourceRanges(source.value)
    : bdaSource
    ? jsonPropertyRanges(source.value, selectedBdaSourceKeys())
    : sections.length ? iniSectionRanges(source.value, sections) : appState.sourceHistoryHighlight ? [appState.sourceHistoryHighlight] : []
  const searchRanges = matches.slice(0, SOURCE_SEARCH_HIGHLIGHT_LIMIT)
    .map((start) => [start, start + query.length] as const)
  const activeStart = matches[appState.sourceSearchIndex]
  source.setDecorations({
    selectedRanges,
    searchRanges,
    activeSearchRange: activeStart === undefined ? undefined : [activeStart, activeStart + query.length],
    valueRanges: sourceValueHintsEnabled.checked ? sourceValueRanges(source.value, jsonSource ? "json" : "ini") : [],
  })
  source.setFeatures({
    completion: sourceCompletionEnabled.checked,
    valueHints: sourceValueHintsEnabled.checked,
    explanations: sourceLineExplanationEnabled.checked,
  })
}

function sourceSearchMatches(): number[] {
  return findTextMatches(source.value, sourceSearch.value.trim())
}

export function updateSourceSearchStatus(matches = sourceSearchMatches()): void {
  if (appState.sourceSearchIndex >= matches.length) appState.sourceSearchIndex = -1
  sourceSearchCount.textContent = sourceSearch.value.trim()
    ? `${appState.sourceSearchIndex < 0 ? 0 : appState.sourceSearchIndex + 1}/${matches.length}`
    : ""
  sourceSearchPrevious.disabled = sourceSearchNext.disabled = !matches.length
  const replaceable = Boolean(matches.length) && !source.disabled && !source.readOnly
  sourceReplacement.disabled = sourceReplace.disabled = sourceReplaceAll.disabled = !replaceable
}

export function findSourceMatch(direction: 1 | -1): void {
  const matches = sourceSearchMatches()
  if (!matches.length) {
    appState.sourceSearchIndex = -1
    updateSourceHighlight()
    return
  }
  appState.sourceSearchIndex = appState.sourceSearchIndex < 0
    ? direction > 0 ? 0 : matches.length - 1
    : (appState.sourceSearchIndex + direction + matches.length) % matches.length
  const start = matches[appState.sourceSearchIndex]
  source.setSelectionRange(start, start + sourceSearch.value.trim().length)
  updateSourceHighlight()
}

export function replaceSourceMatches(replaceAll: boolean): void {
  const query = sourceSearch.value.trim()
  const matches = sourceSearchMatches()
  if (!query || !matches.length || source.disabled || source.readOnly) return
  const index = appState.sourceSearchIndex < 0 ? 0 : appState.sourceSearchIndex
  source.value = replaceTextMatches(source.value, query, sourceReplacement.value, replaceAll ? undefined : index)
  appState.sourceSearchIndex = replaceAll ? -1 : index
  source.dispatchEvent(new Event("input", { bubbles: true }))
  if (appState.archive?.isBdaConfig(appState.selectedPath) || isBdaAppearancePartPath(appState.selectedPath)) commitBdaSourceEdit()
  if (!replaceAll) findSourceMatch(1)
}

export function renderSourceValueThumbnail(canvas: HTMLCanvasElement, range: SourceEditorValueRange): void {
  retinaThumbnail(canvas, 48, 30)
  const context = canvas.getContext("2d")
  if (!context) return
  context.clearRect(0, 0, canvas.width, canvas.height)
  if (range.kind === "color") {
    context.fillStyle = range.color ?? "transparent"
    context.fillRect(0, 0, canvas.width, canvas.height)
    return
  }
  const resolver = visualResolver()
  if (!resolver) return
  const styleID = range.value.replace(/^STYLE/i, "")
  void resolver.resolve(styleID, false).then((visual) => {
    if (canvas.isConnected) drawVisualPreview(canvas, [visual], false)
  }).catch(() => {})
}

export function openSourceColorPicker(range: SourceEditorValueClick): void {
  const clean = range.value.trim().replace(/^#/, "")
  if (range.kind !== "color" || !/^[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(clean)) return
  appState.sourceColorPickerTarget = range
  sourceColorPicker.value = `#${(clean.length === 8 ? clean.slice(2) : clean).toLowerCase()}`
  sourceColorPicker.title = range.label ?? `颜色 ${range.value}`
  sourceColorPicker.style.left = `${Math.max(0, Math.min(window.innerWidth - 1, range.anchor.left))}px`
  sourceColorPicker.style.top = `${Math.max(0, Math.min(window.innerHeight - 1, range.anchor.bottom))}px`
  try {
    sourceColorPicker.showPicker()
  } catch {
    sourceColorPicker.click()
  }
}

export function applySourceColorPicker(): void {
  const target = appState.sourceColorPickerTarget
  appState.sourceColorPickerTarget = undefined
  if (!target || source.disabled || source.readOnly) return
  if (source.value.slice(target.from, target.to) !== target.value) return
  const next = replacedSourceColor(target.value, sourceColorPicker.value)
  if (!next) return
  source.replaceRange(target.from, target.to, next)
  source.commit()
}

/** Jumps to a style's definition (source Command/Ctrl click). */
export function openSourceStyleDefinition(styleID: string): void {
  if (!appState.archive) return
  const ref = appState.archive.format === "bda" ? bdaStyleRef(styleID) : undefined
  selectFile(ref ? bdaAppearanceStylePath(`${ref.type}Styles`) : styleConfigPath(), "source")
  const range = ref
    ? jsonPropertyRanges(source.value, [String(ref.key)])[0]
    : iniSectionRanges(source.value, [`STYLE${styleID}`])[0]
  if (range) source.setSelectionRange(range[0], range[1])
  if (mobilePortraitQuery.matches) setMobilePane("inspector")
  void source.load().then(() => source.focus())
}

export function openSourceStylePicker(range: SourceEditorValueRange): void {
  if (range.kind !== "style") return
  const styleID = range.value.replace(/^STYLE/i, "")
  appState.sourceStyleProxyTarget = range
  sourceStyleProxy.value = styleID
  const key = (range.key ?? "STYLE").replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase()
  sourceStyleProxy.dataset.documentStyleKey = key
  const type = appState.archive?.format === "bda" ? bdaStyleRef(styleID)?.type : undefined
  if (type) sourceStyleProxy.dataset.bdaStyleType = type
  else delete sourceStyleProxy.dataset.bdaStyleType
  sourceStyleProxy.disabled = source.disabled || source.readOnly || !isEditing()
  // 与检查器缩略图一致：图片样式进切片选择器（可在其中切到全部样式），声音样式直接进样式库。
  if (key === "SOUND_STYLE") openStylePicker(sourceStyleProxy)
  else void openStyleReferenceStateImage(sourceStyleProxy, key, false)
}

/**
 * Reverse direction of the canvas ↔ source link: putting the caret inside a
 * configuration block selects the key that block describes. The canvas is
 * updated without echoing back into the editor, so the two stay in step
 * without fighting over the caret.
 */
export function selectKeyFromSourceOffset(offset: number): void {
  if (!isEditing() || !appState.archive || !appState.selectedPath) return
  if (appState.selectedPath !== appState.layoutPath || sourceEditPath() !== appState.selectedPath) return
  const bdaSource = appState.archive.format === "bda" && (
    appState.archive.isBdaConfig(appState.selectedPath) || isBdaVirtualTextPath(appState.selectedPath) || isBdaAppearancePartPath(appState.selectedPath)
  )
  const property = bdaSource ? jsonPropertyAtOffset(source.value, offset) : undefined
  // A Palm board's keys are the canvas's own items, read from skin.json.
  const palmBoard = sxiPointer(appState.selectedPath)
  const sxiSection = palmBoard
    ? preview.keys.map((item) => item.section).find((name) => sxiSectionRanges(source.value, [name], palmBoard).some(([a, b]) => offset >= a && offset < b))
    : undefined
  const section = sxiSection ?? (bdaSource || palmBoard ? undefined : iniSectionAtOffset(source.value, offset))
  const panelKey = property && property !== "cand" ? property : undefined
  if (!section && !panelKey) return
  const items = palmBoard ? preview.keys : appState.layoutDocument ? previewItems(appState.layoutDocument) : []
  const match = items.find((item) => item.editable && (
    section !== undefined
      ? item.section === section || item.sections.includes(section)
      : item.center.trim().toLowerCase() === panelKey
  ))
  if (!match) return
  if (appState.selectedKeySections.length === 1 && appState.selectedKeySections[0] === match.section) return
  appState.selectedCandidate = false
  syncCandidateSelection()
  appState.selectedKeySections = [match.section]
  preview.setSelected(appState.selectedKeySections)
  populateKeyInspector()
}
