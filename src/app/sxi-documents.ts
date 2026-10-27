import { appState } from "./state"
import { source } from "./canvas-interaction"
import { sourceName } from "./dom"
import { setSourceValue } from "./config-context"
import { commitText, isEditing, updateDirty } from "./edit-history"
import { showError } from "./file-operations"
import { refreshPreview } from "./preview-render"
import { populateKeyInspector } from "./key-inspector"
import { IniDocument } from "../ini.ts"
import { SXI_SKIN_PATH, parseSkinJson, parseSkinJsonValue } from "../palm/sxi-projection.ts"
import type { JsonObject } from "../palm/sxi-ini.ts"
import type { SkinArchive } from "../skin.ts"

/** The open `.sxi` document's skin.json, parsed again only when the document changes. */
export function palmSkin(archive: SkinArchive): JsonObject {
  const cached = appState.palmSkin
  if (cached?.archive === archive && cached.revision === archive.revision) return cached.skin
  const skin = parseSkinJson(archive.getText(SXI_SKIN_PATH))
  appState.palmSkin = { archive, revision: archive.revision, skin }
  return skin
}

// `.sxi` layouts, styles and tiles are generated views; the source editor always shows the native
// skin.json instead of exposing one of those converted files as source.
export function isSxiSourcePath(path: string): boolean {
  const archive = appState.archive
  return archive?.format === "sxi" && (Boolean(archive.derivedPointer(path)) || archive.isText(path) && /\.json$/i.test(path))
}

function sxiSourcePath(path: string): string {
  return appState.archive!.derivedPointer(path) ? SXI_SKIN_PATH : path
}

export function showSxiSource(path: string): void {
  const sourcePath = sxiSourcePath(path)
  if (!appState.archive!.derivedPointer(path)) appState.selectedDocument = undefined
  setSourceValue(appState.archive!.getText(sourcePath))
  source.disabled = false
  sourceName.textContent = sourcePath
}

export function commitSxiSourceEdit(): void {
  const archive = appState.archive
  const path = appState.selectedPath
  if (!isEditing() || !archive || !isSxiSourcePath(path)) return
  const sourcePath = sxiSourcePath(path)
  try {
    if (sourcePath === SXI_SKIN_PATH) parseSkinJson(source.value)
    else parseSkinJsonValue(source.value)
    commitText(sourcePath, archive.getText(sourcePath), source.value)
  } catch (error) {
    showError(error, `编辑 ${sourcePath}`)
  }
  if (archive.isText(appState.layoutPath)) appState.layoutDocument = IniDocument.parse(archive.getText(appState.layoutPath))
  if (archive.isText(path)) appState.selectedDocument = IniDocument.parse(archive.getText(path))
  showSxiSource(path)
  refreshPreview()
  populateKeyInspector()
  updateDirty()
}

export function refreshSxiDocument(): void {
  const archive = appState.archive!
  if (archive.isText(appState.layoutPath)) appState.layoutDocument = IniDocument.parse(archive.getText(appState.layoutPath))
  if (archive.isText(appState.selectedPath)) {
    appState.selectedDocument = IniDocument.parse(archive.getText(appState.selectedPath))
    showSxiSource(appState.selectedPath)
  }
  refreshPreview()
  populateKeyInspector()
  updateDirty()
}
