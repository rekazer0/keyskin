import { openActionMenu } from "./context-menu"
import { openRenameDialog } from "./ask"
import { source } from "./canvas-interaction"
import { files, sourceFileToolbar, sourceRenameButton } from "./dom"
import { commitBatch, isEditing } from "./edit-history"
import { requestEditMode } from "./mobile-layout"
import { selectSourceRow, refreshAfterSourceMutation, sourcePaths, sourceSelection } from "./source-files"
import { appState } from "./state"

function renameSourceFile(): void {
  if (!isEditing()) { requestEditMode(); return }
  const archive = appState.archive, selection = sourceSelection()
  if (!archive || !selection) return
  source.commit()
  openRenameDialog(selection.path.split("/").pop()!, name => {
    if (appState.archive !== archive || !isEditing()) return
    const target = selection.path.slice(0, selection.path.lastIndexOf("/") + 1) + name
    if (target === selection.path) return
    if (archive.names().some(path => path.toLowerCase() === target.toLowerCase() || path.toLowerCase().startsWith(`${target.toLowerCase()}/`))) {
      throw new Error("已存在同名文件或文件夹")
    }
    const paths = sourcePaths(selection)
    if (!paths.length) throw new Error("原文件或文件夹已不存在")
    // shortcut: 不改写配置内的文件引用；需要资源重构时再按格式解析引用。
    commitBatch(paths.flatMap(path => [
      { kind: "bytes", path: target + path.slice(selection.path.length), after: archive.getBytes(path)!.slice() },
      { kind: "bytes", path, before: archive.getBytes(path)!.slice() },
    ]))
    refreshAfterSourceMutation(target + paths[0].slice(selection.path.length))
  })
}

/** 右键菜单直接调用工具栏按钮，操作顺序与禁用状态只有一个来源。 */
export function wireSourceFileMenu(): void {
  sourceRenameButton.addEventListener("click", renameSourceFile)
  const openMenu = (row: HTMLElement, x: number, y: number) => {
    if (row.getAttribute("aria-selected") !== "true") row.click()
    openActionMenu(row, x, y, "源文件操作", sourceFileToolbar.querySelectorAll<HTMLButtonElement>(":scope > button:not(#source-file-search-toggle)"))
  }
  files.addEventListener("contextmenu", event => {
    const row = (event.target as Element).closest<HTMLElement>(".raw-files .source-tree-row")
    if (!row) return
    event.preventDefault()
    // macOS 会把 Ctrl 单击派发为 contextmenu，仍按多选处理。
    if (event.ctrlKey) { selectSourceRow(row, event); return }
    openMenu(row, event.clientX, event.clientY)
  })
  files.addEventListener("keydown", event => {
    const row = (event.target as Element).closest<HTMLElement>(".raw-files .source-tree-row")
    if (!row) return
    if (event.key === "F2" && !sourceRenameButton.disabled) { event.preventDefault(); sourceRenameButton.click() }
    if (event.key === "ContextMenu" || event.shiftKey && event.key === "F10") {
      event.preventDefault()
      const box = row.getBoundingClientRect()
      openMenu(row, box.left, box.bottom)
    }
  })
}
