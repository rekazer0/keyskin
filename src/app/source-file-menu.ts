import { openActionMenu } from "./context-menu"
import { zipSync } from "fflate"
import { bindListActionKeys } from "../dom-element"
import { ask, confirmDeletion, openRenameDialog } from "./ask"
import { writeToChosenFile } from "./archive-io"
import { runFileOperation, showStatus } from "./file-operations"
import { source } from "./canvas-interaction"
import { files, sourceFileToolbar, sourceFileSearchToggle, sourceFileMore, sourceRenameButton, sourceCopyButton, sourceDownloadButton, sourceDeleteButton, sourceUploadButton, sourceUploadInput, sourceUploadReplace, sourceReplaceInput } from "./dom"
import { commitBatch, isEditing } from "./edit-history"
import { requestEditMode } from "./mobile-layout"
import { selectSourceRow, refreshAfterSourceMutation, sourcePaths, sourceSelection, sourceActionScope, sourceTargetFolder, commitSourceUploads, setSourceTransfer } from "./source-files"
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

async function downloadSourceFiles(): Promise<void> {
  const archive = appState.archive
  const { paths, searching, allResults } = sourceActionScope()
  if (!archive || !paths.length) return
  const revision = archive.revision
  if (searching && await ask({
    title: allResults ? `下载 ${paths.length} 个搜索结果？` : `下载选中的 ${paths.length} 项源文件？`,
    detail: paths.length === 1 ? paths[0] : "这些文件将保存为 ZIP，保留原目录结构。",
    actions: [{ value: "cancel", label: "取消" }, { value: "download", label: "下载", variant: "primary" }],
  }) !== "download") return
  if (appState.archive !== archive || archive.revision !== revision) return
  await runFileOperation("下载文件", async () => {
    const name = paths.length === 1 ? paths[0].split("/").pop()! : allResults ? "源文件搜索结果.zip" : "源文件.zip"
    const bytes = paths.length === 1 ? archive.getBytes(paths[0]) : zipSync(
      Object.fromEntries(paths.map(path => [path, archive.getBytes(path)!])), { level: 0 },
    )
    return Boolean(bytes && await writeToChosenFile(name, bytes))
  })
}

async function deleteSourceFiles(): Promise<void> {
  if (!isEditing()) { requestEditMode(); return }
  const archive = appState.archive
  const { paths, allResults } = sourceActionScope()
  if (!archive || !paths.length) return
  const revision = archive.revision
  const title = allResults ? `删除 ${paths.length} 个搜索结果？` : `删除 ${paths.length} 项源文件？`
  const detail = allResults ? "将删除全部匹配的文件，不只删除选中项。删除后可撤销恢复。" : undefined
  if (!await confirmDeletion(title, detail) || appState.archive !== archive || archive.revision !== revision || !isEditing()) return
  commitBatch(paths.map(path => ({ kind: "bytes", path, before: archive.getBytes(path)?.slice() })))
  refreshAfterSourceMutation()
  showStatus(`已删除 ${paths.length} 项，可撤销`)
}

function replaceSourceFile(): void {
  if (!isEditing()) { requestEditMode(); return }
  const archive = appState.archive, selection = sourceSelection()
  if (!archive || !selection || selection.folder) return
  const { path } = selection
  source.commit()
  const revision = archive.revision
  sourceReplaceInput.value = ""
  sourceReplaceInput.onchange = async () => {
    const file = sourceReplaceInput.files?.[0]
    if (!file || appState.archive !== archive || archive.revision !== revision || !isEditing()) return
    if (await ask({
      title: "上传并替换源文件？",
      detail: `用「${file.name}」替换「${path}」的内容，保留原路径和文件名。替换后可撤销。`,
      actions: [{ value: "cancel", label: "取消" }, { value: "replace", label: "替换", variant: "primary" }],
    }) !== "replace") return
    await runFileOperation("替换文件", async () => {
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (appState.archive !== archive || archive.revision !== revision || !isEditing()) return false
      const before = archive.getBytes(path)
      if (!before) return false
      commitBatch([{ kind: "bytes", path, before: before.slice(), after: bytes }])
      refreshAfterSourceMutation(path)
      return true
    })
  }
  sourceReplaceInput.click()
}

/** 右键菜单直接调用工具栏按钮，操作顺序与禁用状态只有一个来源。 */
export function wireSourceFileMenu(): void {
  sourceRenameButton.addEventListener("click", renameSourceFile)
  sourceDeleteButton.addEventListener("click", deleteSourceFiles)
  sourceDownloadButton.addEventListener("click", downloadSourceFiles)
  sourceUploadReplace.addEventListener("click", replaceSourceFile)
  sourceCopyButton.addEventListener("click", () => setSourceTransfer("copy"))
  bindListActionKeys(files, sourceFileToolbar)
  sourceUploadButton.addEventListener("click", () => {
    if (!isEditing()) { requestEditMode(); return }
    sourceUploadInput.value = ""
    sourceUploadInput.click()
  })
  sourceUploadInput.addEventListener("change", () => {
    const archive = appState.archive, folder = sourceTargetFolder()
    const picked = Array.from(sourceUploadInput.files ?? [])
    if (!archive || !isEditing() || !picked.length) return
    void runFileOperation("上传文件", async () => {
      const uploads = await Promise.all(picked.map(async file => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })))
      return appState.archive === archive && isEditing() && commitSourceUploads(uploads, folder)
    })
  })
  sourceFileMore.addEventListener("click", () => {
    const box = sourceFileMore.getBoundingClientRect()
    const above = sourceFileSearchToggle.ariaExpanded === "true"
    openActionMenu(sourceFileMore, box.left, above ? box.top : box.bottom, "更多源文件操作",
      sourceFileToolbar.querySelectorAll<HTMLButtonElement>("[data-source-overflow]"), above)
  })
  const openMenu = (row: HTMLElement, x: number, y: number) => {
    if (row.getAttribute("aria-selected") !== "true") row.click()
    openActionMenu(row, x, y, "源文件操作", sourceFileToolbar.querySelectorAll<HTMLButtonElement>(":scope > button:not(#source-file-search-toggle, [data-source-mobile])"))
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
