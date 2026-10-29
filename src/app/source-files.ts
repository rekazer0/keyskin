import { appState } from "./state"
import { sidebarViewButtons, files, sourceFileToolbar, sourceUploadButton, sourceDownloadButton, sourceCopyButton, sourcePasteButton, sourceMoveButton, sourceDeleteButton } from "./dom"
import { isEditing, updateDirty, commitBatch } from "./edit-history"
import { type SourceTransfer, type SourceUpload } from "./types"
import { renderFiles } from "./file-tree"
import { selectFile } from "./navigation"
import { refreshPreview } from "./preview-render"

export function setSidebarView(view: "overview" | "source"): void {
  appState.sidebarView = view
  for (const button of sidebarViewButtons) {
    button.classList.toggle("active", button.dataset.sidebarView === view)
  }
  files.querySelector<HTMLElement>(".sidebar-overview")?.toggleAttribute("hidden", view !== "overview")
  files.querySelector<HTMLElement>(".raw-files")?.toggleAttribute("hidden", view !== "source")
  sourceFileToolbar.hidden = view !== "source"
  updateSourceFileActions()
}

export function sourceSelection(): { path: string; folder: boolean } | undefined {
  if (!appState.selectedFileButton?.closest(".raw-files")) return
  const path = appState.selectedFileButton.dataset.path
    ?? appState.selectedFileButton.dataset.folderPath
    ?? appState.selectedFileButton.closest<HTMLDetailsElement>("details.raw-folder")?.dataset.folderPath
  return path ? { path, folder: !appState.selectedFileButton.dataset.path } : undefined
}

export function updateSourceFileActions(): void {
  const selection = sourceSelection()
  const available = Boolean(appState.archive) && !appState.fileOperationRunning
  sourceUploadButton.disabled = !available
  sourceDownloadButton.disabled = appState.fileOperationRunning || !selection || selection.folder
  sourceCopyButton.disabled = appState.fileOperationRunning || !selection
  sourcePasteButton.disabled = !available || !appState.sourceTransfer?.files.length
  sourceMoveButton.disabled = !available || !selection
  sourceDeleteButton.disabled = !available || !selection
  sourceCopyButton.classList.toggle("active", appState.sourceTransfer?.mode === "copy")
  sourceMoveButton.classList.toggle("active", appState.sourceTransfer?.mode === "move")
  sourceCopyButton.setAttribute("aria-pressed", String(appState.sourceTransfer?.mode === "copy"))
  sourceMoveButton.setAttribute("aria-pressed", String(appState.sourceTransfer?.mode === "move"))
}

export function sourceTargetFolder(): string {
  const selection = sourceSelection()
  if (!selection) return ""
  if (selection.folder) return selection.path
  return selection.path.split("/").slice(0, -1).join("/")
}

export function sourcePaths(selection: { path: string; folder: boolean }): string[] {
  if (!appState.archive) return []
  return selection.folder
    ? appState.archive.names().filter((path) => !path.endsWith("/") && path.startsWith(`${selection.path}/`))
    : appState.archive.getBytes(selection.path) ? [selection.path] : []
}

/** 生成「名称 副本.ext」「名称 副本 2.ext」，跳过已占用的路径。 */
export function sourceCopyPath(path: string, taken: (candidate: string) => boolean): string {
  const slash = path.lastIndexOf("/")
  const name = path.slice(slash + 1)
  const dot = name.lastIndexOf(".")
  const stem = dot > 0 ? name.slice(0, dot) : name
  const extension = dot > 0 ? name.slice(dot) : ""
  for (let index = 1; ; index += 1) {
    const candidate = `${path.slice(0, slash + 1)}${stem} 副本${index > 1 ? ` ${index}` : ""}${extension}`
    if (!taken(candidate)) return candidate
  }
}

export function setSourceTransfer(mode: SourceTransfer["mode"]): void {
  const selection = sourceSelection()
  if (!appState.archive || !selection || mode === "move" && !isEditing()) return
  const base = selection.folder ? `${selection.path.split("/").pop()}/` : ""
  appState.sourceTransfer = {
    mode,
    sourcePath: selection.path,
    folder: selection.folder,
    files: sourcePaths(selection).flatMap((source) => {
      const bytes = appState.archive?.getBytes(source)
      if (!bytes) return []
      const relative = selection.folder ? source.slice(selection.path.length + 1) : source.split("/").pop() ?? source
      return [{ path: `${base}${relative}`, source, bytes: bytes.slice() }]
    }),
  }
  updateSourceFileActions()
}

export function refreshAfterSourceMutation(preferredPath?: string): void {
  if (!appState.archive) return
  const selectedStillExists = appState.archive.getBytes(appState.selectedPath)
  renderFiles()
  setSidebarView("source")
  const next = preferredPath && appState.archive.getBytes(preferredPath)
    ? preferredPath
    : selectedStillExists
      ? appState.selectedPath
      : appState.archive.names().find((path) => appState.archive?.isText(path) || appState.archive?.isImage(path) || appState.archive?.isBdaConfig(path))
  if (next) {
    selectFile(next, "source")
    revealSourceFile(next)
  }
  refreshPreview()
  updateDirty()
}

export function sourceDropFolder(target: Element | null): string | undefined {
  if (!target?.closest(".raw-files")) return
  const folder = target.closest<HTMLElement>(".source-folder-row")?.dataset.folderPath
  if (folder !== undefined) return folder
  const path = target.closest<HTMLElement>(".source-file-row")?.dataset.path
  return path ? path.split("/").slice(0, -1).join("/") : sourceTargetFolder()
}

export function setSourceDropTarget(target?: Element | null): void {
  files.querySelector(".source-drop-target")?.classList.remove("source-drop-target")
  target?.closest<HTMLElement>(".source-tree-row")?.classList.add("source-drop-target")
}

export function commitSourceUploads(uploads: SourceUpload[], folder: string): boolean {
  if (!appState.archive || !uploads.length) return false
  const changes = uploads.map(({ name, bytes }) => {
    const filename = name.split(/[\\/]/).pop() ?? name
    const path = folder ? `${folder}/${filename}` : filename
    return { path, bytes }
  })
  commitBatch(changes.map(({ path, bytes }) => ({
    kind: "bytes",
    path,
    before: appState.archive!.getBytes(path)?.slice(),
    after: bytes,
  })))
  refreshAfterSourceMutation(changes[0]?.path)
  return true
}

export function ensureSourcePathRendered(path: string): void {
  const parts = path.split("/").slice(0, -1)
  for (let index = 1; index <= parts.length; index += 1) {
    const folderPath = parts.slice(0, index).join("/")
    const folder = files.querySelector<HTMLDetailsElement>(`details.raw-folder[data-folder-path="${CSS.escape(folderPath)}"]`)
    // 合并显示的文件夹（如 light/skin/）没有中间层节点，跳过继续找下一层。
    if (!folder) continue
    folder.open = true
    folder.dispatchEvent(new Event("toggle"))
  }
}

export function revealSourceFile(path: string): void {
  ensureSourcePathRendered(path)
  const button = Array.from(files.querySelectorAll<HTMLButtonElement>(".raw-files button[data-path]"))
    .find((item) => item.dataset.path === path)
  if (!button) return
  let parent = button.parentElement
  while (parent) {
    if (parent instanceof HTMLDetailsElement) parent.open = true
    parent = parent.parentElement
  }
  button.scrollIntoView({ block: "nearest" })
}
