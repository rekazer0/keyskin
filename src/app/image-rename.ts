import { imageRenameChanges } from "../image-rename.ts"
import { openRenameDialog } from "./ask"
import { source } from "./canvas-interaction"
import { resourceListView } from "./dom"
import { commitBatch, isEditing, updateDirty } from "./edit-history"
import { renderFiles } from "./file-tree"
import { showStatus } from "./file-operations"
import { refreshPreview } from "./preview-render"
import { renderResourceInspector, selectResourceImage, showResourceList } from "./resource-inspector"
import { appState } from "./state"

export function renameResourceImage(): void {
  const archive = appState.archive, path = appState.selectedResourceGalleryPath
  if (!archive || appState.resourceInspectorMode !== "image" || !path || !isEditing()) return
  source.commit()
  const listVisible = !resourceListView.hidden
  openRenameDialog(path.split("/").pop()!, name => {
    if (appState.archive !== archive || !isEditing()) return
    const changes = imageRenameChanges(archive, path, name)
    if (!changes.length) return
    const target = path.slice(0, path.lastIndexOf("/") + 1) + name
    commitBatch(changes)
    if (appState.selectedPath === path) appState.selectedPath = target
    renderFiles()
    renderResourceInspector()
    selectResourceImage(target)
    if (listVisible) showResourceList()
    refreshPreview()
    updateDirty()
    showStatus(`已重命名为 ${name}，可撤销`)
  })
}
