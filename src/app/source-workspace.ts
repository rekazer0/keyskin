import { appState } from "./state"
import { resolveSourceArchivePath, type SourceWriteSnapshot, writePendingSourcePaths, consumeSourceWriteSnapshot } from "../source-tree.ts"
import { sourceWriteSnapshots, pendingSourcePaths, pendingSourceWatchPaths, isAndroidTauri, isTauri, LAST_SOURCE_WORKSPACE_KEY, sourceDirectoryEnabledBySettings } from "./canvas-interaction"
import { SkinArchive } from "../skin.ts"
import { type SourceFilePayload, type SourceChangePayload } from "./types"
import { decodedBdaSource, applyDecodedBdaSource } from "../bda-source.ts"
import { discardAiDesignDraft } from "./ai-panel"
import { invoke, Channel } from "@tauri-apps/api/core"
import { showError, showStatus } from "./file-operations"
import { updateHistoryButtons, updateDirty } from "./edit-history"
import { renderFiles } from "./file-tree"
import { IniDocument } from "../ini.ts"
import { isBdaAppearancePartPath, refreshBdaLayout } from "./bda-documents"
import { selectFile } from "./navigation"
import { refreshPreview } from "./preview-render"
import { populateKeyInspector } from "./key-inspector"
import { watch } from "@tauri-apps/plugin-fs"
import { sourceDirectory, sourceDirectoryStatus, settingsStorageSection, sourceDirectoryEnabled, chooseSourceDirectory, resetSourceDirectory } from "./dom"
import { message } from "@tauri-apps/plugin-dialog"

function sourcePathForWorkspace(path: string): string {
  return appState.sourceWorkspacePrefix && path.startsWith(appState.sourceWorkspacePrefix)
    ? path.slice(appState.sourceWorkspacePrefix.length)
    : path
}

function sourcePathForArchive(path: string): string {
  return resolveSourceArchivePath(
    path,
    appState.sourceWorkspacePrefix,
    appState.archive?.sourceFiles().map((file) => file.path) ?? [],
  )
}

function sourceWriteKey(path: string): string {
  const normalized = path.replaceAll("\\", "/")
  return navigator.userAgent.includes("Windows") ? normalized.toLowerCase() : normalized
}

function rememberSourceWrite(path: string, data: SourceWriteSnapshot): void {
  const key = sourceWriteKey(path)
  const snapshots = sourceWriteSnapshots.get(key) ?? []
  snapshots.push(data)
  sourceWriteSnapshots.set(key, snapshots.slice(-4))
  if (appState.sourceWriteSnapshotTimer !== undefined) clearTimeout(appState.sourceWriteSnapshotTimer)
  appState.sourceWriteSnapshotTimer = window.setTimeout(() => {
    sourceWriteSnapshots.clear()
    appState.sourceWriteSnapshotTimer = undefined
  }, 10_000)
}

export function sourceFilesPayload(value: SkinArchive): SourceFilePayload[] {
  return value.sourceFiles().map((file) => {
    const canonical = value.canonicalSourcePath(file.path)
    const data = value.isBdaConfig(canonical) ? bdaWorkspaceData(canonical, file.data) : file.data
    return { path: file.path, data: encodeBase64(data) }
  })
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = ""
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

export function decodeBase64Archive(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function bdaWorkspaceData(path: string, bytes: Uint8Array): Uint8Array {
  const source = JSON.parse(decodedBdaSource(path, bytes)) as Record<string, unknown>
  source.$bdiEditorRaw = encodeBase64(bytes)
  return new TextEncoder().encode(JSON.stringify(source, null, 2))
}

export function sourceArchiveFromFiles(files: Array<{ path: string; data: Uint8Array }>): SkinArchive {
  const decoder = new TextDecoder()
  return SkinArchive.fromSourceFiles(files.map((file) => {
    if (!/\/\d*(?:appearance|animation|lightAnimation|sound|switch|sticker|scene)Config$/i.test(`/${file.path}`)) return file
    const text = decoder.decode(file.data)
    if (!/^\s*\{/.test(text)) return file
    const raw = (JSON.parse(text) as Record<string, unknown>).$bdiEditorRaw
    if (typeof raw !== "string") throw new Error(`BDA 解码源码缺少 $bdiEditorRaw：${file.path}`)
    return { path: file.path, data: applyDecodedBdaSource(file.path, decodeBase64Archive(raw), text) }
  }))
}

export async function flushSourceAutosave(): Promise<void> {
  if (appState.aiDraftPreview) discardAiDesignDraft("保存源码前已丢弃未应用的 AI 草稿。")
  if (appState.sourceAutosaveTimer !== undefined) {
    clearTimeout(appState.sourceAutosaveTimer)
    appState.sourceAutosaveTimer = undefined
  }
  if (appState.archive && appState.sourceWorkspacePath && pendingSourcePaths.size) {
    const workspace = appState.sourceWorkspacePath
    const value = appState.archive
    appState.sourceAutosaveQueue = appState.sourceAutosaveQueue.catch(() => {}).then(() =>
      writePendingSourcePaths(pendingSourcePaths, async (paths) => {
        const changes: SourceChangePayload[] = paths.map((path) => {
          const archivePath = sourcePathForArchive(path)
          const canonical = value.canonicalSourcePath(archivePath)
          const bytes = value.getSourceBytes(archivePath)
          const data = bytes && value.isBdaConfig(canonical) ? bdaWorkspaceData(canonical, bytes) : bytes
          return { path, data: data ? Array.from(data) : null, directory: false }
        })
        for (const change of changes) rememberSourceWrite(change.path, change.data ? new Uint8Array(change.data) : null)
        await invoke("apply_source_changes", { path: workspace, changes })
      }),
    )
  }
  await appState.sourceAutosaveQueue
}

export function scheduleSourceAutosave(paths: string[]): void {
  if (!appState.archive || (!appState.sourceWorkspacePath && appState.sourceWorkspacePendingArchive !== appState.archive)) return
  for (const path of paths) pendingSourcePaths.add(sourcePathForWorkspace(appState.archive.sourcePath(path)))
  if (!appState.sourceWorkspacePath || appState.sourceAutosaveTimer !== undefined) return
  appState.sourceAutosaveTimer = window.setTimeout(() => {
    // Never write a previewed draft to disk; retry once the draft is resolved.
    if (appState.aiDraftPreview) {
      appState.sourceAutosaveTimer = undefined
      return scheduleSourceAutosave([])
    }
    void flushSourceAutosave().catch((error) => showError(error, "自动保存源码"))
  }, 3 * 60_000)
}

async function refreshExternalSourceFiles(workspace: string, paths: string[]): Promise<void> {
  if (!appState.archive || workspace !== appState.sourceWorkspacePath || !paths.length) return
  const changes = await invoke<SourceChangePayload[]>("read_source_changes", {
    path: workspace,
    changedPaths: paths,
  })
  if (!appState.archive || workspace !== appState.sourceWorkspacePath) return
  let changed = false
  const affected = new Set<string>()
  const ignoredChanges = new Set(changes.filter((change) => {
    const data = change.data ? new Uint8Array(change.data) : null
    return consumeSourceWriteSnapshot(sourceWriteSnapshots, sourceWriteKey(change.path), data)
  }))
  if (appState.aiDraftPreview && changes.some((change) => !ignoredChanges.has(change))) {
    discardAiDesignDraft("源码文件在外部被修改，AI 草稿已丢弃。")
  }
  const directorySnapshots = changes.filter((change) => change.directory && !ignoredChanges.has(change))
  const presentPaths = new Set(changes.filter((change) => !change.directory && change.data).map((change) => sourcePathForArchive(change.path)))
  for (const snapshot of directorySnapshots) {
    const archiveSnapshotPath = sourcePathForArchive(snapshot.path).replace(/\/$/, "")
    const prefix = archiveSnapshotPath ? `${archiveSnapshotPath}/` : ""
    const removed = appState.archive.sourceFiles()
      .filter((file) => (file.path === archiveSnapshotPath || file.path.startsWith(prefix)) && !presentPaths.has(file.path))
      .map((file) => appState.archive!.canonicalSourcePath(file.path))
    for (const canonical of removed) {
      appState.archive.delete(canonical)
      affected.add(canonical)
      changed = true
    }
  }
  for (const change of changes) {
    if (change.directory || ignoredChanges.has(change)) continue
    pendingSourcePaths.delete(change.path)
    const data = change.data ? new Uint8Array(change.data) : null
    if (change.data) {
      const canonical = appState.archive.canonicalSourcePath(sourcePathForArchive(change.path))
      const before = appState.archive.getBytes(canonical)
      const after = before && appState.archive.isBdaConfig(canonical)
        ? applyDecodedBdaSource(canonical, before, new TextDecoder().decode(data!))
        : data!
      if (before && before.length === after.length && before.every((byte, index) => byte === after[index])) continue
      appState.archive.setBytes(canonical, after)
      affected.add(canonical)
      changed = true
      continue
    }
    const removed = appState.archive.sourceFiles()
      .filter((file) => {
        const archivePath = sourcePathForArchive(change.path)
        return file.path === archivePath || file.path.startsWith(`${archivePath}/`)
      })
      .map((file) => appState.archive!.canonicalSourcePath(file.path))
    for (const canonical of removed) {
      appState.archive.delete(canonical)
      affected.add(canonical)
      changed = true
    }
  }
  if (!changed) return
  appState.undoStack = []
  appState.redoStack = []
  updateHistoryButtons()
  renderFiles()
  try {
    if (affected.has(appState.layoutPath) && appState.archive.isText(appState.layoutPath)) {
      appState.layoutDocument = IniDocument.parse(appState.archive.getText(appState.layoutPath))
    }
    if (appState.selectedPath && (appState.archive.getBytes(appState.selectedPath) || isBdaAppearancePartPath(appState.selectedPath))) {
      selectFile(appState.selectedPath, appState.sidebarView, "document", true)
    }
    else {
      const next = appState.archive.names().find((path) => appState.archive?.isText(path))
      if (next) selectFile(next, appState.sidebarView)
    }
    refreshBdaLayout()
    refreshPreview()
    populateKeyInspector()
  } catch (error) {
    showError(error, "刷新外部源码")
  }
  updateDirty()
  showStatus(`已实时刷新 ${affected.size} 个源码文件`)
}

function queueSourceWatch(paths: string[], workspace: string): void {
  if (workspace !== appState.sourceWorkspacePath) return
  for (const path of paths) pendingSourceWatchPaths.add(path)
  if (appState.sourceWatchTimer !== undefined) clearTimeout(appState.sourceWatchTimer)
  appState.sourceWatchTimer = window.setTimeout(() => {
    appState.sourceWatchTimer = undefined
    const changed = [...pendingSourceWatchPaths]
    pendingSourceWatchPaths.clear()
    void refreshExternalSourceFiles(workspace, changed).catch((error) => showError(error, "刷新外部源码"))
  }, 80)
}

export async function activateSourceWorkspace(path: string, prefix = ""): Promise<void> {
  appState.stopSourceWatch?.()
  appState.stopSourceWatch = undefined
  if (isAndroidTauri()) await invoke("stop_source_observer").catch(() => {})
  pendingSourcePaths.clear()
  sourceWriteSnapshots.clear()
  if (appState.sourceWriteSnapshotTimer !== undefined) clearTimeout(appState.sourceWriteSnapshotTimer)
  appState.sourceWriteSnapshotTimer = undefined
  pendingSourceWatchPaths.clear()
  appState.sourceWorkspacePath = path
  appState.sourceWorkspacePrefix = prefix
  if (!isTauri() || !path) return
  if (isAndroidTauri() && path.startsWith("content://")) {
    const handler = new Channel<string>()
    handler.onmessage = (changedPath) => queueSourceWatch([changedPath || path], path)
    await invoke("start_source_observer", { path, handler })
    appState.stopSourceWatch = () => { void invoke("stop_source_observer") }
    if (localStorage.getItem("source-directory-enabled") === "true") {
      localStorage.setItem(LAST_SOURCE_WORKSPACE_KEY, path)
    }
    return
  }
  appState.stopSourceWatch = await watch(path, (event) => {
    if (typeof event.type === "object" && "access" in event.type) return
    queueSourceWatch(event.paths, path)
  }, { recursive: true, delayMs: 120 })
}

function setSourceDirectoryState(path: string, custom: boolean, error = ""): void {
  sourceDirectory.value = path
  sourceDirectory.closest("label")?.setAttribute("data-invalid", String(Boolean(error)))
  sourceDirectoryStatus.textContent = error || (custom
    ? "自定义目录 · 不自动删除源码"
    : "内置目录 · 保留最近 9 份源码")
}

export async function applySourceDirectory(path: string | null): Promise<void> {
  if (!isTauri()) return
  const custom = Boolean(path?.trim())
  const previous = localStorage.getItem("source-directory")
  try {
    const resolved = await invoke<string>("prepare_source_directory", { path: custom ? path!.trim() : null })
    if (custom) {
      localStorage.setItem("source-directory", resolved)
      if (isAndroidTauri() && previous !== resolved) {
        localStorage.removeItem(LAST_SOURCE_WORKSPACE_KEY)
        await activateSourceWorkspace("", "")
      }
    }
    else localStorage.removeItem("source-directory")
    setSourceDirectoryState(resolved, custom)
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    setSourceDirectoryState(path ?? sourceDirectory.value, custom, `目录不可用：${text}`)
  }
}

export async function initializeSourceDirectory(): Promise<void> {
  if (!isTauri()) {
    settingsStorageSection.hidden = true
    return
  }
  const configured = localStorage.getItem("source-directory")
  const enabled = sourceDirectoryEnabledBySettings() && (!isAndroidTauri() || Boolean(configured))
  sourceDirectoryEnabled.checked = enabled
  sourceDirectory.disabled = !enabled
  chooseSourceDirectory.disabled = !enabled
  resetSourceDirectory.disabled = !enabled
  if (isAndroidTauri()) {
    sourceDirectory.readOnly = true
    sourceDirectory.placeholder = "/storage/emulated/0/BdiEditor"
    resetSourceDirectory.hidden = true
    if (!enabled) {
      localStorage.removeItem("source-directory-enabled")
      localStorage.removeItem("source-directory")
      localStorage.removeItem(LAST_SOURCE_WORKSPACE_KEY)
      sourceDirectory.value = ""
    }
  }
  if (!enabled) {
    sourceDirectoryStatus.textContent = "已关闭 · 不会写入源码文件"
    return
  }
  await applySourceDirectory(configured)
}

export async function chooseAndroidSourceDirectory(): Promise<boolean> {
  try {
    await message("开启后，编辑器会把皮肤源码保存到你授权的文件夹。下一步请在系统文件选择器中选择或新建 BdiEditor 文件夹。", {
      title: "授权皮肤源码目录",
      kind: "info",
    })
    await applySourceDirectory(await invoke<string>("pick_source_directory"))
    return true
  } catch (error) {
    if (!String(error).toLowerCase().includes("cancel")) showError(error, "选择源码目录")
    return false
  }
}
