import { mode, unsavedDialog, dirty, undoButton, redoButton, sourceName } from "./dom"
import { appState } from "./state"
import { type UnsavedDecision, unsavedDecision } from "../unsaved.ts"
import { flushNumberInputWheel, numberInputGesture } from "../number-input-wheel.ts"
import { flushSourceAutosave, scheduleSourceAutosave } from "./source-workspace"
import { showError } from "./file-operations"
import { isTauri, recordChange } from "./canvas-interaction"
import { message } from "@tauri-apps/plugin-dialog"
import { saveArchive, currentExportFormat } from "./archive-io"
import { acceptAiDraftPreview, discardAiDesignDraft } from "./ai-panel"
import { type Change } from "../history.ts"
import { insertedTextRange } from "../highlight.ts"
import { IniDocument } from "../ini.ts"
import { setSourceValue } from "./config-context"
import { tileSlices } from "../tiles.ts"
import { updateSourceHighlight } from "./source-panel"
import { populateTileInspector, drawAtlas, loadTiles } from "./tile-editing"
import { refreshPreview } from "./preview-render"
import { populateKeyInspector } from "./key-inspector"
import { renderFiles } from "./file-tree"
import { isBdaAppearancePartPath, refreshBdaLayout, refreshSelectedBdaSource } from "./bda-documents"
import { selectFile } from "./navigation"
import { selectResourceImage, renderResourceInspector } from "./resource-inspector"
import { decodedBdaEditorSource } from "../bda-source.ts"
import { isSsfBoardPath, sourceEditPath } from "./ssf-documents"
import { sxiPointer } from "./sxi-documents"

export function isEditing(): boolean {
  return mode.value === "edit"
}

/**
 * Keys and panels are moved, added and removed on the canvas only for Baidu skins. A Sogou skin has no
 * key geometry: its keys are selected on the canvas and restyled in the inspector.
 */
export function canvasEditable(): boolean {
  return isEditing() && appState.archive?.format !== "ssf"
}

export function hasUnsavedChanges(): boolean {
  return appState.unsavedNew || Boolean(appState.archive?.changed.size)
}

export function chooseUnsavedDecision(): Promise<UnsavedDecision> {
  unsavedDialog.returnValue = ""
  unsavedDialog.showModal()
  return new Promise((resolve) => {
    unsavedDialog.addEventListener(
      "close",
      () => resolve(unsavedDecision(unsavedDialog.returnValue)),
      { once: true },
    )
  })
}

export async function prepareDocumentReplacement(): Promise<boolean> {
  flushNumberInputWheel()
  try {
    await flushSourceAutosave()
  } catch (error) {
    showError(error, "自动保存源码")
    return false
  }
  if (!hasUnsavedChanges()) return true
  let decision: "save" | "discard" | "cancel"
  if (isTauri()) {
    const result = await message("当前皮肤尚未保存。是否先保存修改？", {
      title: "未保存的皮肤",
      kind: "warning",
      buttons: { yes: "保存", no: "不保存", cancel: "取消" },
    })
    decision = unsavedDecision(result)
  } else {
    decision = await chooseUnsavedDecision()
  }
  if (decision === "cancel") return false
  if (decision === "discard") return true
  return saveArchive(false, currentExportFormat())
}

export function updateDirty(): void {
  dirty.hidden = !appState.unsavedNew && !appState.archive?.changed.size
}

export function updateHistoryButtons(): void {
  undoButton.disabled = appState.undoStack.length === 0
  redoButton.disabled = appState.redoStack.length === 0
}

export function commitText(path: string, before: string, after: string, coalesce = false): void {
  if (!appState.archive || before === after) return
  acceptAiDraftPreview()
  appState.sourceHistoryHighlight = undefined
  appState.archive.setText(path, after)
  recordChange(appState.undoStack, { kind: "text", path, before, after }, numberInputGesture(), coalesce)
  appState.redoStack = []
  scheduleSourceAutosave([path])
  updateHistoryButtons()
}

export function commitBytes(path: string, before: Uint8Array | undefined, after: Uint8Array): void {
  if (!appState.archive || before && before.length === after.length && before.every((byte, index) => byte === after[index])) return
  acceptAiDraftPreview()
  appState.archive.setBytes(path, after)
  recordChange(appState.undoStack, { kind: "bytes", path, before, after }, numberInputGesture())
  appState.redoStack = []
  scheduleSourceAutosave([path])
  updateHistoryButtons()
}

export function commitBatch(changes: Change[]): void {
  if (!appState.archive || !changes.length) return
  acceptAiDraftPreview()
  for (const change of changes) {
    if (change.kind === "text") appState.archive.setText(change.path, change.after)
    else if (change.kind === "bytes") {
      if (change.after) appState.archive.setBytes(change.path, change.after)
      else appState.archive.delete(change.path)
    }
  }
  recordChange(appState.undoStack, { kind: "batch", changes }, numberInputGesture())
  appState.redoStack = []
  scheduleSourceAutosave(changes.flatMap((change) => change.kind === "batch" ? [] : [change.path]))
  updateHistoryButtons()
}

/**
 * Commits text edits of several INI files as one undo step, then shows them: the source panel if it
 * holds one of the files, the layout document, the canvas and the inspector.
 */
export function commitTextChanges(changes: ReadonlyArray<{ path: string; before: string; after: string }>): void {
  const edited = changes.filter((change) => change.before !== change.after)
  if (!appState.archive || !edited.length) return
  if (edited.length === 1) commitText(edited[0].path, edited[0].before, edited[0].after)
  else commitBatch(edited.map((change) => ({ kind: "text" as const, ...change })))
  const selected = edited.find((change) => change.path === appState.selectedPath)
  if (selected && appState.archive.getText(selected.path) === selected.after) {
    appState.selectedDocument = IniDocument.parse(selected.after)
    setSourceValue(selected.after)
  }
  const layout = edited.find((change) => change.path === appState.layoutPath)
  if (layout && appState.archive.getText(layout.path) === layout.after) appState.layoutDocument = IniDocument.parse(layout.after)
  refreshPreview()
  populateKeyInspector()
  updateDirty()
}

export function applyTextSnapshot(path: string, text: string): void {
  if (!appState.archive) return
  if (path === appState.selectedPath) appState.sourceHistoryHighlight = insertedTextRange(appState.archive.getText(path), text)
  appState.archive.setText(path, text)
  scheduleSourceAutosave([path])
  if (path === appState.layoutPath) appState.layoutDocument = IniDocument.parse(text)
  if (path === appState.selectedPath) {
    appState.selectedDocument = IniDocument.parse(text)
    setSourceValue(text)
  } else if (path === sourceEditPath()) setSourceValue(text)
  if (appState.resourceConfigActive && path === appState.tilePath) {
    appState.tileDocument = IniDocument.parse(text)
    appState.slices = tileSlices(appState.tileDocument)
    setSourceValue(text)
    sourceName.textContent = appState.tilePath
    if (!appState.slices.some((slice) => slice.index === appState.selectedTileIndex)) appState.selectedTileIndex = undefined
    updateSourceHighlight()
    populateTileInspector()
    drawAtlas()
  }
  refreshPreview()
  populateKeyInspector()
  updateDirty()
}

export function refreshHistorySelection(): void {
  const path = appState.selectedResourcePath
  const index = appState.selectedTileIndex
  const resourceMode = appState.resourceConfigActive ? appState.resourceInspectorMode : "document"
  renderFiles()
  if (resourceMode === "image" && appState.archive?.isImage(path)) {
    // 切片界面原地刷新：经 selectFile 会先切到第一张图再切回来，画布在两张图之间闪一下。
    renderResourceInspector()
    selectResourceImage(path)
    appState.selectedTileIndex = appState.slices.some(slice => slice.index === index) ? index : undefined
    populateTileInspector()
    drawAtlas()
  } else if (appState.selectedPath && (
    appState.archive?.getBytes(appState.selectedPath) || isBdaAppearancePartPath(appState.selectedPath) ||
    sxiPointer(appState.selectedPath) || isSsfBoardPath(appState.selectedPath)
  )) {
    selectFile(appState.selectedPath, appState.sidebarView, resourceMode)
  }
  updateHistoryButtons()
}

export function undo(): void {
  flushNumberInputWheel()
  if (appState.aiDraftPreview) return discardAiDesignDraft("已撤销 AI 草稿预览 · 未修改皮肤。")
  const change = appState.undoStack.pop()
  if (!change) return
  appState.sourceHistoryHighlight = undefined
  appState.redoStack.push(change)
  applyChangeSnapshot(change, "before")
  refreshHistorySelection()
}

export function redo(): void {
  flushNumberInputWheel()
  if (appState.aiDraftPreview) discardAiDesignDraft("AI 草稿预览已丢弃。")
  const change = appState.redoStack.pop()
  if (!change) return
  appState.sourceHistoryHighlight = undefined
  appState.undoStack.push(change)
  applyChangeSnapshot(change, "after")
  refreshHistorySelection()
}

export function applyChangeSnapshot(change: Change, side: "before" | "after"): void {
  if (change.kind === "batch") {
    const changes = side === "before" ? [...change.changes].reverse() : change.changes
    for (const child of changes) applyChangeSnapshot(child, side)
  } else if (change.kind === "text") applyTextSnapshot(change.path, change[side])
  else applyBytesSnapshot(change.path, change[side])
}

export function applyBytesSnapshot(path: string, bytes?: Uint8Array): void {
  if (!appState.archive) return
  if (bytes) appState.archive.setBytes(path, bytes)
  else appState.archive.delete(path)
  scheduleSourceAutosave([path])
  refreshBdaLayout(appState.layoutPath || undefined)
  if (appState.selectedPath === path && bytes && appState.archive.isBdaConfig(path)) setSourceValue(decodedBdaEditorSource(path, bytes))
  // A BDA panel or style table is a view of appearanceConfig: re-read it, or a later source edit re-applies the undone value.
  else refreshSelectedBdaSource()
  if (appState.resourceConfigActive && appState.archive.format === "bda" && appState.selectedResourcePath) {
    loadTiles(appState.selectedResourcePath)
    renderResourceInspector()
  }
  refreshPreview()
  populateKeyInspector()
  updateDirty()
}
