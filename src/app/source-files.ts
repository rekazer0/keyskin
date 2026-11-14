import { emptyState, searchField } from "../dom-element"
import { appState } from "./state"
import { sidebarViewButtons, files, sourceFileToolbar, sourceFileSearchToggle, sourceFileSearch, sourceUploadButton, sourceDownloadButton, sourceCopyButton, sourcePasteButton, sourceMoveButton, sourceRenameButton, sourceDeleteButton } from "./dom"
import { isEditing, updateDirty, commitBatch } from "./edit-history"
import { type SourceTransfer, type SourceUpload } from "./types"
import { renderFiles } from "./file-tree"
import { selectFile } from "./navigation"
import { refreshPreview } from "./preview-render"

/** 左侧栏的行：源文件树是 tree（aria-selected），概览是导航（aria-current）。 */
export function setRowSelected(row: HTMLElement | undefined, on: boolean): void {
  if (!row) return
  const attribute = row.getAttribute("role") === "treeitem" ? "aria-selected" : "aria-current"
  if (on && attribute === "aria-selected") {
    for (const selected of files.querySelectorAll('.raw-files [aria-selected="true"]')) selected.removeAttribute("aria-selected")
    appState.sourceSelectionAnchor = row
  }
  if (on) row.setAttribute(attribute, "true")
  else row.removeAttribute(attribute)
}

export function setSidebarView(view: "overview" | "source"): void {
  appState.sidebarView = view
  for (const button of sidebarViewButtons) {
    const on = button.dataset.sidebarView === view
    button.setAttribute("aria-pressed", String(on))
  }
  files.querySelector<HTMLElement>(".sidebar-overview")?.toggleAttribute("hidden", view !== "overview")
  files.querySelector<HTMLElement>(".raw-files")?.toggleAttribute("hidden", view !== "source")
  sourceFileToolbar.hidden = view !== "source"
  updateSourceFileActions()
}

function sourceRowSelection(row: HTMLElement): { path: string; folder: boolean } | undefined {
  const path = row.dataset.path ?? row.dataset.folderPath
  return path ? { path, folder: !row.dataset.path } : undefined
}

export function sourceSelections(): { path: string; folder: boolean }[] {
  return [...files.querySelectorAll<HTMLElement>('.raw-files [aria-selected="true"]')]
    .filter(row => row.getClientRects().length > 0)
    .flatMap(row => sourceRowSelection(row) ?? [])
}

export function sourceSelection(): { path: string; folder: boolean } | undefined {
  const selected = sourceSelections()
  return selected.length === 1 ? selected[0] : undefined
}

export function visibleSourceRows(): HTMLElement[] {
  return [...files.querySelectorAll<HTMLElement>(".raw-files .source-tree-row")].filter(row => row.getClientRects().length > 0)
}

export function selectSourceRow(row: HTMLElement, event?: MouseEvent | KeyboardEvent): void {
  const rows = visibleSourceRows()
  const additive = Boolean(event?.ctrlKey || event?.metaKey)
  const anchor = rows.indexOf(appState.sourceSelectionAnchor ?? appState.selectedFileButton!)
  const index = rows.indexOf(row)
  const selected = new Set(additive ? rows.filter(item => item.getAttribute("aria-selected") === "true") : [])
  if (event?.shiftKey && anchor >= 0 && index >= 0) {
    for (const item of rows.slice(Math.min(anchor, index), Math.max(anchor, index) + 1)) selected.add(item)
  } else {
    if (selected.has(row)) selected.delete(row)
    else selected.add(row)
    appState.sourceSelectionAnchor = row
  }
  setRowSelected(appState.selectedFileButton, false)
  for (const item of files.querySelectorAll<HTMLElement>(".raw-files .source-tree-row")) {
    if (selected.has(item)) item.setAttribute("aria-selected", "true")
    else item.removeAttribute("aria-selected")
    item.tabIndex = item === row ? 0 : -1
  }
  appState.selectedFileButton = row
  row.focus()
  updateSourceFileActions()
}

export function updateSourceFileActions(): void {
  const selected = sourceSelections()
  const selection = selected.length === 1 ? selected[0] : undefined
  const available = Boolean(appState.archive) && !appState.fileOperationRunning
  sourceUploadButton.disabled = !available
  sourceDownloadButton.disabled = appState.fileOperationRunning || !selection || selection.folder
  sourceCopyButton.disabled = appState.fileOperationRunning || !selected.length
  sourcePasteButton.disabled = !available || !appState.sourceTransfer?.files.length
  sourceMoveButton.disabled = !available || !selected.length
  sourceRenameButton.disabled = !available || !selection
  sourceDeleteButton.disabled = !available || !selected.length
  sourceCopyButton.setAttribute("aria-pressed", String(appState.sourceTransfer?.mode === "copy"))
  sourceMoveButton.setAttribute("aria-pressed", String(appState.sourceTransfer?.mode === "move"))
}

export function sourceTargetFolder(): string {
  const active = appState.selectedFileButton
  const selection = active?.getAttribute("aria-selected") === "true" && active.closest(".raw-files")
    ? sourceRowSelection(active) : sourceSelections()[0]
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
  const selected = sourceSelections()
  if (!appState.archive || !selected.length || mode === "move" && !isEditing()) return
  const roots = selected.filter(item => !selected.some(other => other !== item && other.folder && item.path.startsWith(`${other.path}/`)))
    .map(item => ({ sourcePath: item.path, folder: item.folder, path: item.path.split("/").pop()! }))
  const taken = new Set<string>()
  for (const root of roots) {
    if (taken.has(root.path)) root.path = sourceCopyPath(root.path, candidate => taken.has(candidate))
    taken.add(root.path)
  }
  appState.sourceTransfer = {
    mode,
    roots,
    files: roots.flatMap(root => sourcePaths({ path: root.sourcePath, folder: root.folder }).flatMap(source => {
      const bytes = appState.archive?.getBytes(source)
      return bytes ? [{ path: root.path + source.slice(root.sourcePath.length), source, bytes: bytes.slice() }] : []
    })),
  }
  updateSourceFileActions()
}

export function refreshAfterSourceMutation(preferredPath?: string): void {
  if (!appState.archive) return
  const scrollTop = files.scrollTop
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
    if (preferredPath) revealSourceFile(next)
  }
  if (!preferredPath) files.scrollTo({ top: scrollTop, behavior: "instant" })
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

/** 搜索前记住展开状态，匹配路径先按需加载，再隐藏不匹配的行。 */
export function filterSourceFiles(): void {
  const query = sourceFileSearch.value.trim().toLocaleLowerCase()
  const folders = () => [...files.querySelectorAll<HTMLDetailsElement>(".raw-folder")]
  if (query) {
    appState.sourceSearchFolders ??= new Set(folders().filter(folder => folder.open).map(folder => folder.dataset.folderPath ?? ""))
    for (const path of appState.archive?.names() ?? []) {
      if (!path.endsWith("/") && path.toLocaleLowerCase().includes(query)) ensureSourcePathRendered(path)
    }
  }
  for (const row of files.querySelectorAll<HTMLElement>(".source-file-row")) {
    row.hidden = Boolean(query) && !row.dataset.path?.toLocaleLowerCase().includes(query)
    if (row.hidden) setRowSelected(row, false)
  }
  for (const folder of folders()) {
    const matches = Boolean(folder.querySelector(".source-file-row:not([hidden])"))
    folder.hidden = Boolean(query) && !matches
    if (folder.hidden) setRowSelected(folder.querySelector<HTMLElement>("summary") ?? undefined, false)
    if (query || appState.sourceSearchFolders) {
      folder.open = query ? matches : appState.sourceSearchFolders!.has(folder.dataset.folderPath ?? "")
      folder.querySelector("summary")?.setAttribute("aria-expanded", String(folder.open))
    }
  }
  const tree = files.querySelector(".raw-files")
  tree?.querySelector(":scope > .ui-empty")?.remove()
  if (query && tree?.querySelector<HTMLDetailsElement>(".source-root-folder")?.hidden) tree.append(emptyState("search", "无搜索结果"))
  if (!query) appState.sourceSearchFolders = undefined
  updateSourceFileActions()
}

export function wireSourceFileSearch(): void {
  const field = searchField({ input: sourceFileSearch, label: "搜索文件", onInput: filterSourceFiles })
  const toggle = (open: boolean) => {
    sourceFileSearchToggle.setAttribute("aria-expanded", String(open))
    sourceFileSearchToggle.title = open ? "收起搜索" : "搜索文件"
    sourceFileSearchToggle.setAttribute("aria-label", sourceFileSearchToggle.title)
    if (open) {
      field.prepend(sourceFileSearchToggle)
      field.hidden = false
      sourceFileSearch.focus()
    } else {
      sourceFileToolbar.prepend(sourceFileSearchToggle)
      field.hidden = true
      sourceFileSearch.value = ""
      sourceFileSearch.dispatchEvent(new Event("input"))
      sourceFileSearchToggle.focus()
    }
  }
  sourceFileSearchToggle.addEventListener("click", () => toggle(field.hidden))
  field.addEventListener("keydown", event => {
    if (event.key !== "Escape" || event.isComposing || event.defaultPrevented) return
    event.preventDefault()
    event.stopPropagation()
    toggle(false)
  })
}
