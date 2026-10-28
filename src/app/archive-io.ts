import { clientLog, flushClientLogs } from "../client-log.ts"
import { showSkinLoadProgress, showFileOperationProgress, waitForInterfacePaint, updateFileOperationProgress, showStatus, showError, runFileOperation, readNativeSkinFile, readBrowserSkinFile, exportTargetHidden } from "./file-operations"
import { flushSourceAutosave, activateSourceWorkspace, sourceFilesPayload, decodeBase64Archive, sourceArchiveFromFiles } from "./source-workspace"
import { appState } from "./state"
import { releaseKeySound, keySoundBuffers, sourceDirectoryEnabledBySettings, isTauri, isAndroidTauri, exportButtons, pendingSourcePaths, LAST_SOURCE_WORKSPACE_KEY, isIOSWeb, isAndroidWeb, syncMobileShareLabel } from "./canvas-interaction"
import { SkinArchive } from "../skin.ts"
import { canExport, exportFormatFromPath, exportName, skinFileName, type ExportFormat } from "../export.ts"
import { buildSxiZip } from "../palm/palm-export.ts"
import { bdaCompatibilityWarnings, bdaPlatform, type BdaPlatform, convertBdaPlatform } from "../bda-platform.ts"
import { releaseImagePreviewURL } from "../image-preview.ts"
import { clearImageSlicePicker } from "./image-pickers"
import { aiDesignStatus, aiDesignPanel, theme, device, canvasBackground, canvasWrap, documentName, saveButton, layout, fileOperationDialog, fileOperationClose } from "./dom"
import { setAiDesignDraft, syncAiDesignContext } from "./ai-panel"
import { applyModeState, syncSegmentedControls } from "./mobile-layout"
import { canvasDeviceValue, type CanvasBackground } from "../canvas-background.ts"
import { updateHistoryButtons, updateDirty, prepareDocumentReplacement } from "./edit-history"
import { recordRecentFile } from "./recent-files"
import { renderFiles } from "./file-tree"
import { bdaAvailableLayoutPaths, preferredPath, isBdaLayoutPath } from "./bda-documents"
import { selectFile } from "./navigation"
import { invoke } from "@tauri-apps/api/core"
import { open, save } from "@tauri-apps/plugin-dialog"
import { type SourceFilePayload, type ChosenFileData, type BrowserSaveFileHandle } from "./types"
import { readFile, writeFile } from "@tauri-apps/plugin-fs"
import { convertBdaArchive } from "../bda-convert.ts"
import { flushNumberInputWheel } from "../number-input-wheel.ts"
import { loadBdaBase } from "../operations.ts"
import { isSsfPath, looksLikeSsf } from "../ssf/ssf-package.ts"
import { convertSsfDocument, exportSsf, ssfDocumentBytes } from "../ssf/ssf-convert.ts"
import { convertSxiToBaidu, convertSxiToBda } from "../palm/sxi-to-baidu.ts"
import { rebuildSsfPreview, ssfTemplates } from "./ssf-preview"
import { isSsfBoardPath } from "./ssf-documents"
import { isSxiBoardAddress, palmThemes, preferredPalmBoard, sxiPointer } from "./sxi-documents"
import { boardFileName } from "../palm/sxi-layout.ts"
import { layoutSource } from "./config-context"

export async function loadArchive(
  bytes: Uint8Array | SkinArchive,
  path: string,
  isNew = false,
  existingSourceWorkspace = "",
  displayName = "",
  sourcePrefix = "",
): Promise<void> {
  const started = performance.now()
  const sizeBytes = bytes instanceof SkinArchive
    ? bytes.sourceFiles().reduce((total, file) => total + file.data.byteLength, 0)
    : bytes.byteLength
  clientLog.info("archive.load.start", {
    name: (displayName || path).split(/[\\/]/).pop() || (isNew ? "new-project" : "unnamed"),
    sizeBytes,
    sourceWorkspace: Boolean(existingSourceWorkspace),
  })
  if (showSkinLoadProgress(sizeBytes)) await waitForInterfacePaint()
  await flushSourceAutosave()
  await activateSourceWorkspace("", "")
  appState.sourceWorkspacePendingArchive = undefined
  releaseKeySound()
  keySoundBuffers.clear()
  let nextArchive: SkinArchive
  try {
    updateFileOperationProgress(18, "正在解析皮肤包…")
    nextArchive = bytes instanceof SkinArchive ? bytes : await SkinArchive.openAsync(
      bytes,
      exportFormatFromPath(displayName || path),
      appState.fileOperationProgressVisible
        ? (progress) => updateFileOperationProgress(18 + progress * 32, `正在解析皮肤包… ${Math.round(progress * 100)}%`)
        : undefined,
    )
  } catch (error) {
    clientLog.error("archive.parse.error", {
      name: (displayName || path).split(/[\\/]/).pop() || "unnamed",
      sizeBytes,
      durationMs: Math.round(performance.now() - started),
    }, error)
    void flushClientLogs()
    throw error
  }
  if (nextArchive.format === "bda" && !appState.bdaBase) {
    updateFileOperationProgress(52, "正在加载 BDA 基础布局…")
    appState.bdaBase = await SkinArchive.openAsync(await loadBdaBase())
  }
  if (nextArchive.format === "ssf") {
    updateFileOperationProgress(52, "正在生成搜狗皮肤预览…")
    await ssfTemplates()
  }
  const bdaWarnings = bdaCompatibilityWarnings(nextArchive)
  if (bdaWarnings.length) clientLog.info("bda.compatibility.warning", { warnings: bdaWarnings.join("；") })
  updateFileOperationProgress(55, "正在建立编辑工作区…")
  let nextSourceWorkspace = existingSourceWorkspace
  let pendingSourceDirectory: string | null | undefined
  const sourceDirectoryActive = sourceDirectoryEnabledBySettings()
  const configuredDirectory = sourceDirectoryActive ? localStorage.getItem("source-directory") || null : null
  if (isTauri() && sourceDirectoryActive && !nextSourceWorkspace && (!isAndroidTauri() || configuredDirectory)) {
    pendingSourceDirectory = configuredDirectory
  }
  appState.assetURL = releaseImagePreviewURL(appState.assetURL)
  clearImageSlicePicker()
  appState.archive = nextArchive
  const ssfWarnings = rebuildSsfPreview()
  if (ssfWarnings.length) clientLog.info("ssf.preview.warning", { warnings: ssfWarnings.join("；") })
  appState.aiDesignConversationTarget = nextArchive
  appState.aiDesignConversation = []
  aiDesignStatus.textContent = ""
  aiDesignPanel.dataset.state = "idle"
  setAiDesignDraft(undefined)
  appState.aiChatController?.clear()
  if (pendingSourceDirectory !== undefined) appState.sourceWorkspacePendingArchive = nextArchive
  appState.sourceTransfer = undefined
  // A Sogou skin's looks are the skeleton's themes; the other formats keep theirs in `<theme>/skin/`.
  const availableThemes = appState.archive.format === "sxi" ? palmThemes() : ["light", "dark"].filter((value) =>
    layoutSource()?.names().some((name) => name.startsWith(`${value}/skin/`)),
  )
  if (!availableThemes.includes(theme.value)) theme.value = availableThemes[0] ?? "light"
  syncSegmentedControls()
  const preferredDevice = localStorage.getItem("default-device")
  if (preferredDevice === "canvas") {
    device.value = canvasDeviceValue(canvasBackground.value as CanvasBackground)
  } else if (preferredDevice && Array.from(device.options).some((option) => option.value === preferredDevice)) {
    device.value = preferredDevice
  }
  canvasWrap.classList.remove("empty")
  appState.currentPath = path
  appState.unsavedNew = isNew
  appState.undoStack = []
  appState.redoStack = []
  updateHistoryButtons()
  documentName.textContent = isNew
    ? exportName(displayName || "未命名", appState.archive.format)
    : displayName || documentNameForPath(path, nextArchive)
  syncAiDesignContext()
  if (!isNew && isTauri() && path) recordRecentFile(path, documentName.textContent, existingSourceWorkspace)
  saveButton.disabled = false
  for (const button of exportButtons) {
    button.hidden = exportTargetHidden(button.dataset.exportFormat as ExportFormat)
    button.disabled = button.hidden
  }
  syncMobileShareLabel()
  updateFileOperationProgress(68, "正在生成文件列表…")
  await waitForInterfacePaint()
  renderFiles()
  const bdaLayouts = bdaAvailableLayoutPaths()
  appState.layoutPath = appState.archive.format === "bda" && !bdaLayouts.includes(preferredPath())
    ? bdaLayouts[0] ?? preferredPath()
    : appState.archive.format === "sxi" ? preferredPalmBoard() ?? preferredPath()
    : preferredPath()
  const palmBoard = sxiPointer(appState.layoutPath)
  appState.previewReturnName = palmBoard ? boardFileName(palmBoard[3]) : appState.layoutPath.split("/").pop() ?? layout.value
  const initial = appState.archive.format === "bda" && isBdaLayoutPath(appState.layoutPath)
    ? appState.layoutPath
    : appState.archive.names().includes(appState.layoutPath) || isSsfBoardPath(appState.layoutPath) || isSxiBoardAddress(appState.layoutPath)
      ? appState.layoutPath
      : appState.archive.names().find((name) => appState.archive?.isText(name))
  if (initial) {
    appState.layoutPath = initial
    updateFileOperationProgress(82, "正在生成皮肤预览…")
    selectFile(initial)
  }
  // The canvas edits keys only for Baidu skins, so the mode state follows the document's format.
  applyModeState()
  updateFileOperationProgress(92, "正在连接源码工作区…")
  await activateSourceWorkspace(nextSourceWorkspace, sourcePrefix)
  if (pendingSourceDirectory !== undefined) {
    const pendingArchive = nextArchive
    void (async () => {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
      try {
        return await invoke<string>("create_source_workspace", {
          directory: pendingSourceDirectory,
          name: path || displayName || exportName("未命名", nextArchive.format),
          files: sourceFilesPayload(nextArchive),
        })
      } catch (error) {
        if (isAndroidTauri() || !pendingSourceDirectory) throw error
        const workspace = await invoke<string>("create_source_workspace", {
          directory: null,
          name: path || displayName || exportName("未命名", nextArchive.format),
          files: sourceFilesPayload(nextArchive),
        })
        showStatus("自定义源码目录不可用，本次已保存到内置目录")
        return workspace
      }
    })().then(async (workspace) => {
      if (appState.archive !== pendingArchive || appState.sourceWorkspacePendingArchive !== pendingArchive) return
      const pendingPaths = [...pendingSourcePaths]
      await activateSourceWorkspace(workspace, sourcePrefix)
      if (appState.archive !== pendingArchive || appState.sourceWorkspacePendingArchive !== pendingArchive) return
      if (!isNew && path) recordRecentFile(path, documentName.textContent, workspace)
      pendingPaths.forEach((changedPath) => pendingSourcePaths.add(changedPath))
      await flushSourceAutosave()
      appState.sourceWorkspacePendingArchive = undefined
      showStatus(isAndroidTauri() ? "源码已保存到授权目录" : "源码工作区已就绪")
    }).catch((error) => {
      if (appState.archive !== pendingArchive || appState.sourceWorkspacePendingArchive !== pendingArchive) return
      appState.sourceWorkspacePendingArchive = undefined
      pendingSourcePaths.clear()
      showError(error, "保存源码到授权目录")
    })
  }
  updateDirty()
  clientLog.info("archive.load.finish", {
    format: nextArchive.format,
    fileCount: nextArchive.names().length,
    durationMs: Math.round(performance.now() - started),
  })
}

export async function openNative(): Promise<boolean> {
  if (!(await prepareDocumentReplacement())) return false
  const path = await open({
    multiple: false,
    // Android filters by MIME type; custom skin extensions have no reliable mapping.
    filters: isAndroidTauri() ? undefined : [{ name: "输入法皮肤", extensions: ["bdi", "bds", "bda", "ssf", "mssf", "sxi"] }],
  })
  if (typeof path !== "string") return false
  await loadNativePath(path)
  return true
}

/** skinPath 非空时表示从最近皮肤打开：保存仍写回原皮肤文件，并沿用这个源码目录。 */
export async function loadSourceWorkspace(path: string, skinPath = ""): Promise<boolean> {
  if (isAndroidTauri() && path.startsWith("content://")) {
    const encoded = await invoke<string>("open_source_workspace_archive", { path })
    const decodedPath = decodeURIComponent(path)
    const directoryName = decodedPath.split(/[\\/:]/).filter(Boolean).pop()?.toLowerCase() ?? ""
    const sourcePrefix = directoryName === "dark" || directoryName === "light"
      ? `${directoryName}/`
      : ""
    const name = decodedPath.split(/[\\/]/).filter(Boolean).pop() || "皮肤源码"
    const packed = SkinArchive.open(decodeBase64Archive(encoded))
    await loadArchive(sourceArchiveFromFiles(packed.sourceFiles()), skinPath, false, path, skinPath ? "" : name, sourcePrefix)
    return true
  }
  // 整个源码目录读完才知道大小，先按皮肤包大小决定是否立即弹出进度，免得点了半天没反应。
  if (skinPath && showSkinLoadProgress(await invoke<number>("skin_file_size", { path: skinPath }).catch(() => 0))) {
    updateFileOperationProgress(2, "正在读取源码目录…")
    await waitForInterfacePaint()
  }
  const files = await invoke<SourceFilePayload[]>("open_source_workspace", { path })
  const directoryName = path.split(/[\\/]/).filter(Boolean).pop()?.toLowerCase() ?? ""
  const sourcePrefix = directoryName === "dark" || directoryName === "light"
    ? `${directoryName}/`
    : ""
  const sourceFiles = files
    .filter((file) => !file.path.endsWith("/.DS_Store") && file.path !== ".DS_Store")
    .filter((file) => file.path.includes("/") || !/\.(?:bdi|bds|bda)$/i.test(file.path))
    .map((file) => ({
      path: sourcePrefix
        && file.path !== "Info.txt"
        && file.path !== "demo.png"
        && !file.path.startsWith(sourcePrefix)
        ? `${sourcePrefix}${file.path}`
        : file.path,
      data: decodeBase64Archive(file.data),
    }))
  if (!sourceFiles.length) throw new Error("源码文件夹为空")
  const sourceArchive = sourceArchiveFromFiles(sourceFiles)
  const name = path.split(/[\\/]/).pop() || "皮肤源码"
  await loadArchive(sourceArchive, skinPath, false, path, skinPath ? "" : name, sourcePrefix)
  return true
}

export async function restoreLastSourceWorkspace(): Promise<void> {
  if (!isAndroidTauri() || localStorage.getItem("source-directory-enabled") !== "true") return
  const lastSourceWorkspace = localStorage.getItem(LAST_SOURCE_WORKSPACE_KEY)
  if (!lastSourceWorkspace) return
  await runFileOperation("恢复上次皮肤源码", async () => {
    try {
      return await loadSourceWorkspace(lastSourceWorkspace)
    } catch (error) {
      localStorage.removeItem(LAST_SOURCE_WORKSPACE_KEY)
      throw error
    }
  })
}

export const UNSUPPORTED_SKIN_MESSAGE = "仅支持 .bda、.bdi、.bds、.ssf、.mssf 或 .sxi 皮肤文件"

/** Opens a skin file's bytes; a Sogou skin is unpacked first when it uses the encrypted container. */
export async function openSkinBytes(bytes: Uint8Array, path: string): Promise<boolean> {
  // Android pickers return content:// URIs without the file name, so the bytes decide there.
  const ssf = isSsfPath(path) || (path.startsWith("content://") && looksLikeSsf(bytes))
  await loadArchive(ssf ? await ssfDocumentBytes(bytes) : bytes, path)
  return true
}

export async function loadNativePath(path: string): Promise<boolean> {
  if (!isSupportedSkinPath(path)) throw new Error(UNSUPPORTED_SKIN_MESSAGE)
  const bytes = path.startsWith("content://")
    ? await readFile(path)
    : await readNativeSkinFile(path)
  return openSkinBytes(bytes, path)
}

export function isSupportedSkinPath(path: string): boolean {
  return path.startsWith("content://") || /\.(bdi|bds|bda|m?ssf|sxi)$/i.test(path)
}

export async function loadDroppedFile(file: File): Promise<boolean> {
  if (!isSupportedSkinPath(file.name)) return false
  if (!(await prepareDocumentReplacement())) return false
  return openSkinBytes(await readBrowserSkinFile(file), file.name)
}

export async function loadDroppedPath(path: string): Promise<boolean> {
  if (!isSupportedSkinPath(path)) return false
  if (!(await prepareDocumentReplacement())) return false
  return loadNativePath(path)
}

export async function loadDroppedSourceWorkspace(path: string): Promise<boolean> {
  if (!(await prepareDocumentReplacement())) return false
  return loadSourceWorkspace(path)
}

export function currentExportFormat(): ExportFormat {
  return exportFormatFromPath(appState.currentPath) ?? appState.archive?.format ?? "bdi"
}

export function mobileShareFormat(): ExportFormat {
  if (appState.archive?.format === "bda" || appState.archive?.format === "ssf" || appState.archive?.format === "sxi") return appState.archive.format
  if (isIOSWeb()) return "bdi"
  if (isAndroidTauri() || isAndroidWeb()) return "bds"
  return currentExportFormat()
}

// Save dialogs use each input method's name for its own package format.
function exportTargetLabel(format: ExportFormat): string {
  return format === "sxi" ? "手心皮肤" : format === "ssf" ? "搜狗皮肤" : `${format.toUpperCase()} 皮肤`
}

export async function exportArchive(format: ExportFormat, targetBdaPlatform?: Exclude<BdaPlatform, "unknown">): Promise<{
  bytes: Uint8Array
  converted: boolean
  warnings: string[]
} | undefined> {
  if (!appState.archive) throw new Error("当前没有可保存的皮肤")
  if (appState.aiDraftPreview) throw new Error("请先应用或丢弃 AI 修改草稿")
  if (!canExport(appState.archive.format, format)) throw new Error(`${appState.archive.format.toUpperCase()} 皮肤不能导出为 ${format.toUpperCase()}`)
  if (format === "sxi" && appState.archive.format !== "sxi") {
    updateFileOperationProgress(22, "正在导出手心皮肤…")
    await waitForInterfacePaint()
    let source: SkinArchive = appState.archive
    // `.sxi` is INI-based, so a BDA source needs the official INI base layout first.
    if (appState.archive.format === "bda") {
      if (!appState.bdaBase) throw new Error("无法加载 BDA 官方基础布局")
      updateFileOperationProgress(34, "正在转换 BDA 配置…")
      const converted = convertBdaArchive(appState.archive, appState.bdaBase)
      if (converted.warnings.length && !window.confirm(
        `BDA 转换为手心皮肤时将降级以下内容：\n\n${converted.warnings.join("\n")}\n\n继续导出吗？`,
      )) return
      source = converted.archive
    }
    const result = buildSxiZip(source)
    if (result.warnings.length) clientLog.info("sxi.export.warning", { warnings: result.warnings.join("；") })
    return { bytes: result.bytes, converted: true, warnings: result.warnings }
  }
  if (appState.archive.format === "ssf" && format !== "ssf" && format !== "sxi") {
    updateFileOperationProgress(22, `正在转换为 ${format.toUpperCase()}…`)
    await waitForInterfacePaint()
    const result = await convertSsfDocument(appState.archive, format, await ssfTemplates())
    if (result.warnings.length && !window.confirm(
      `搜狗皮肤转换为 ${format.toUpperCase()} 时将降级以下内容：\n\n${result.warnings.join("\n")}\n\n继续导出吗？`,
    )) return
    // The converter writes Android BDA; iOS gets the same platform conversion as any BDA.
    const bytes = format === "bda" && targetBdaPlatform === "ios"
      ? await convertBdaPlatform(SkinArchive.open(result.bytes, "bda"), "ios").toBytesAsync()
      : result.bytes
    return { bytes, converted: true, warnings: result.warnings }
  }
  if (appState.archive.format === "sxi" && format !== "sxi") {
    if (format === "ssf") throw new Error("手心皮肤不能直接导出为搜狗皮肤")
    updateFileOperationProgress(22, `正在转换为 ${format.toUpperCase()}…`)
    await waitForInterfacePaint()
    const result = format === "bda"
      ? await convertSxiToBda(appState.archive, (await ssfTemplates()).bda)
      : await convertSxiToBaidu(appState.archive, format)
    if (result.warnings.length && !window.confirm(
      `手心皮肤转换为 ${format.toUpperCase()} 时将降级以下内容：\n\n${result.warnings.join("\n")}\n\n继续导出吗？`,
    )) return
    // The BDA writer emits the Android package; iOS gets the usual platform conversion.
    const bytes = format === "bda" && targetBdaPlatform === "ios"
      ? await convertBdaPlatform(SkinArchive.open(result.bytes, "bda"), "ios").toBytesAsync()
      : result.bytes
    return { bytes, converted: true, warnings: result.warnings }
  }
  if (format === "ssf") {
    if (appState.archive.format === "ssf") return { bytes: await appState.archive.toBytesAsync("ssf"), converted: false, warnings: [] }
    updateFileOperationProgress(22, "正在导出搜狗皮肤…")
    await waitForInterfacePaint()
    const result = await exportSsf(appState.archive, appState.bdaBase)
    if (result.warnings.length && !window.confirm(
      `转换为搜狗皮肤时将降级以下内容：\n\n${result.warnings.join("\n")}\n\n继续导出吗？`,
    )) return
    return { bytes: result.bytes, converted: true, warnings: result.warnings }
  }
  updateFileOperationProgress(22, `正在生成 ${format.toUpperCase()} 皮肤包…`)
  if (appState.archive.format === "bda" && format === "bda" && targetBdaPlatform) {
    const result = convertBdaPlatform(appState.archive, targetBdaPlatform)
    return { bytes: await result.toBytesAsync(), converted: true, warnings: bdaCompatibilityWarnings(appState.archive) }
  }
  if (appState.archive.format !== "bda" || format === "bda" || format === "sxi") {
    const soundWarnings: string[] = []
    const bytes = await appState.archive.toBytesAsync(format, soundWarnings)
    reportSoundWarnings(soundWarnings)
    return { bytes, converted: false, warnings: soundWarnings }
  }
  if (!appState.bdaBase) throw new Error("无法加载 BDA 官方基础布局")
  await waitForInterfacePaint()
  updateFileOperationProgress(34, "正在转换 BDA 配置…")
  const result = convertBdaArchive(appState.archive, appState.bdaBase, format)
  if (result.warnings.length && !window.confirm(
    `BDA 转换为 ${format.toUpperCase()} 时将降级以下内容：\n\n${result.warnings.join("\n")}\n\n继续导出吗？`,
  )) return
  updateFileOperationProgress(48, `正在压缩 ${format.toUpperCase()} 皮肤包…`)
  const soundWarnings: string[] = []
  const bytes = await result.archive.platformBytesAsync(format, soundWarnings)
  reportSoundWarnings(soundWarnings)
  return { bytes, converted: true, warnings: [...result.warnings, ...soundWarnings] }
}

function reportSoundWarnings(warnings: string[]): void {
  if (!warnings.length) return
  clientLog.info("export.sound-warnings", { count: warnings.length, detail: warnings.join("; ") })
  window.alert(`以下按键音未能转换为目标平台格式，导出包中仍引用原文件，目标平台可能没有声音：\n\n${warnings.join("\n")}`)
}

async function saveNative(saveAs: boolean, format: ExportFormat, suggestedName: string): Promise<boolean> {
  if (!appState.archive) throw new Error("当前没有可保存的皮肤")
  let exported: Awaited<ReturnType<typeof exportArchive>>
  let path = appState.currentPath
  if (saveAs || !path || (!path.startsWith("content://") && exportFormatFromPath(path) !== format)) {
    const written = await writeToChosenFile(suggestedName, async () => {
      exported = await exportArchive(format)
      return exported?.bytes
    }, exportTargetLabel(format))
    if (!written || !exported) return false
    path = written
  } else {
    exported = await exportArchive(format)
    if (!exported) return false
    await writeNativePath(path, exported.bytes)
  }
  if (!exported.converted) {
    appState.currentPath = path
    appState.unsavedNew = false
    appState.archive.markSaved(exported.bytes, format)
    documentName.textContent = documentNameForPath(path, appState.archive)
    updateDirty()
  }
  return true
}

// Android hands out content:// URIs whose last segment is an encoded document id, not a file name.
export function documentNameForPath(path: string, archive: SkinArchive): string {
  return path.startsWith("content://")
    ? skinFileName(archive.skinName(), archive.format)
    : path.split(/[\\/]/).pop() || "未命名皮肤"
}

export async function writeNativePath(path: string, bytes: Uint8Array): Promise<void> {
  updateFileOperationProgress(72, "正在写入文件…")
  if (path.startsWith("content://")) {
    await writeFile(path, bytes)
    return
  }
  await invoke("write_file", { path, data: bytes })
}

/**
 * Asks for the destination before producing the bytes: browsers only open the save picker while the
 * click's user activation is still live (about 5 s), and packaging or converting a skin can outlast it.
 * A producer that resolves to undefined cancels the save.
 */
export async function writeToChosenFile(
  filename: string,
  data: ChosenFileData,
  description = "文件",
): Promise<string | undefined> {
  const produce = () => data instanceof Uint8Array ? Promise.resolve(data) : data()
  const extension = filename.match(/\.([^.\\/]+)$/)?.[1]
  if (isTauri()) {
    let path: string | null
    try {
      path = await save({
        title: "保存文件",
        defaultPath: filename,
        filters: extension ? [{ name: description, extensions: [extension] }] : undefined,
      })
    } catch (error) {
      // The Android picker rejects instead of resolving null when it is dismissed.
      if (/cancel/i.test(String(error))) return
      throw error
    }
    if (!path) return
    const bytes = await produce()
    if (!bytes) return
    await writeNativePath(path, bytes)
    return path
  }
  const picker = (window as typeof window & {
    showSaveFilePicker?: (options: {
      suggestedName: string
      types?: Array<{ description: string; accept: Record<string, string[]> }>
    }) => Promise<BrowserSaveFileHandle>
  }).showSaveFilePicker
  if (!picker) {
    const bytes = await produce()
    if (!bytes) return
    const link = document.createElement("a")
    link.href = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: "application/octet-stream" }))
    link.download = filename
    link.hidden = true
    // Mobile browsers hand blob downloads to a download manager that reads the URL later.
    const revoke = () => setTimeout(() => URL.revokeObjectURL(link.href), 60_000)
    const download = () => {
      document.body.append(link)
      link.click()
      link.remove()
    }
    // Chrome on Android silently drops a scripted download once the click's user activation has
    // expired, which packaging the skin usually outlasts; ask for one more tap in that case.
    if (navigator.userActivation && !navigator.userActivation.isActive) {
      const confirmed = await waitForTap(`${filename} 已生成，轻点“下载”继续`, "下载", download)
      revoke()
      return confirmed ? filename : undefined
    }
    download()
    revoke()
    return filename
  }
  let file: BrowserSaveFileHandle
  try {
    file = await picker.call(window, {
      suggestedName: filename,
      types: extension ? [{
        description,
        accept: { "application/octet-stream": [`.${extension}`] },
      }] : undefined,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return
    throw error
  }
  let bytes: Uint8Array | undefined
  try {
    bytes = await produce()
  } catch (error) {
    await (file as BrowserSaveFileHandle & { remove?: () => Promise<void> }).remove?.().catch(() => undefined)
    throw error
  }
  if (!bytes) {
    await (file as BrowserSaveFileHandle & { remove?: () => Promise<void> }).remove?.().catch(() => undefined)
    return
  }
  const writable = await file.createWritable()
  await writable.write(bytes)
  await writable.close()
  return file.name
}

async function downloadArchive(format: ExportFormat, suggestedName: string): Promise<boolean> {
  if (!appState.archive) throw new Error("当前没有可保存的皮肤")
  let exported: Awaited<ReturnType<typeof exportArchive>>
  const path = await writeToChosenFile(suggestedName, async () => {
    exported = await exportArchive(format)
    return exported?.bytes
  }, exportTargetLabel(format))
  if (!path || !exported) return false
  if (!exported.converted) {
    appState.currentPath = path
    documentName.textContent = suggestedName
    appState.archive.markSaved(exported.bytes, format)
    appState.unsavedNew = false
    updateDirty()
  }
  return true
}

export async function saveArchive(
  saveAs: boolean,
  format: ExportFormat,
  targetBdaPlatform?: Exclude<BdaPlatform, "unknown">,
): Promise<boolean> {
  flushNumberInputWheel()
  const currentName = documentName.textContent?.trim() ?? ""
  const suggestedName = exportName(currentName, format)
  if (targetBdaPlatform) {
    return Boolean(await writeToChosenFile(
      suggestedName,
      async () => (await exportArchive(format, targetBdaPlatform))?.bytes,
      `${targetBdaPlatform === "ios" ? "iOS" : "Android"} BDA 皮肤`,
    ))
  }
  return isTauri()
    ? saveNative(saveAs, format, suggestedName)
    : downloadArchive(format, suggestedName)
}

export async function shareArchiveToMobile(): Promise<boolean> {
  if (!appState.archive) return false
  const ios = isIOSWeb()
  if (!isAndroidTauri()) {
    // Small exports also need visible preparation and error feedback on mobile.
    showFileOperationProgress()
    if (!navigator.share) throw new Error("当前浏览器不支持系统文件分享")
  }
  // .ssf and .sxi go to the Sogou and Palm apps in their own format; Baidu on iOS reads .bdi and iOS .bda.
  const ownFormat = appState.archive.format === "ssf" || appState.archive.format === "sxi"
  if (ios && !ownFormat && appState.archive.format !== "bdi" && (appState.archive.format !== "bda" || bdaPlatform(appState.archive) !== "ios")) {
    throw new Error("当前格式不支持 iOS，请先打开 .bdi 或 iOS 版 .bda 皮肤")
  }
  const format = mobileShareFormat()
  const exported = await exportArchive(format, format === "bda" ? (isIOSWeb() ? "ios" : "android") : undefined)
  if (!exported) return false
  const currentName = documentName.textContent?.trim() || "皮肤"
  const name = exportName(currentName, format)
  if (isAndroidTauri()) {
    updateFileOperationProgress(72, "正在交给系统分享…")
    await invoke("share_file", { name, data: exported.bytes })
    return true
  }
  // WebKit shares the file under its name and types it by extension (WKShareSheet), so the .bdi/.bda/.ssf/.sxi
  // suffix decides which input method iOS offers; Baidu declares com.baidu.inputMethod.skinFile for bdt/bdi/bds/bda.
  const file = new File([new Uint8Array(exported.bytes).buffer], name, { type: "application/octet-stream" })
  if (!navigator.share || navigator.canShare && !navigator.canShare({ files: [file] })) {
    throw new Error("当前设备不支持系统文件分享")
  }
  // Only the file: with no URL or text, WebKit adds the title as a string item ahead of the files, and iOS then
  // hides "copy to app" targets such as the input methods, which accept the skin file alone.
  const share = () => navigator.share!({ files: [file] }).then(() => true).catch((error) => {
    if (error instanceof DOMException && error.name === "AbortError") return false
    throw error
  })
  // Packaging has already awaited asynchronous work. Older iOS versions do not
  // expose userActivation, so always get a fresh tap there before calling share.
  if (ios || navigator.userActivation && !navigator.userActivation.isActive) {
    return waitForTap(`${name} 已生成，轻点“分享”继续`, "分享", share)
  }
  return share()
}

/**
 * Shows a button in the progress dialog and resolves once it is tapped (true) or the dialog is dismissed
 * (false). `onTap` runs inside the tap's click handler, while its user activation is still live.
 */
export function waitForTap(detail: string, label: string, onTap?: () => void | Promise<boolean>): Promise<boolean> {
  return new Promise((resolve, reject) => {
    showFileOperationProgress()
    updateFileOperationProgress(90, detail)
    const share = document.createElement("button")
    share.type = "button"
    share.className = "ui-button primary"
    share.dataset.variant = "primary"
    share.dataset.size = "lg"
    share.textContent = label
    fileOperationClose.before(share)
    fileOperationClose.dataset.variant = "quiet"
    fileOperationClose.disabled = false
    const finish = (confirmed: boolean) => {
      share.remove()
      fileOperationClose.disabled = true
      fileOperationClose.removeEventListener("click", cancel)
      fileOperationDialog.removeEventListener("close", cancel)
      resolve(confirmed)
    }
    const cancel = () => finish(false)
    share.addEventListener("click", async () => {
      try {
        finish(await onTap?.() ?? true)
      } catch (error) {
        share.remove()
        fileOperationClose.disabled = true
        fileOperationClose.removeEventListener("click", cancel)
        fileOperationDialog.removeEventListener("close", cancel)
        reject(error)
      }
    }, { once: true })
    fileOperationClose.addEventListener("click", cancel, { once: true })
    fileOperationDialog.addEventListener("close", cancel, { once: true })
    share.focus()
  })
}
