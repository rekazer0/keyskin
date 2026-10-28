import { IniDocument } from "../ini.ts"
import { appState } from "./state"
import { newButton, openButton, saveButton, mobileShareButton, eventLog, fileOperationDialog, fileOperationProgress, fileOperationPercent, fileOperationDetail, fileOperationTitle, fileOperationIcon, fileOperationResult, fileOperationClose, workspaceImage, assetImage, deviceShell, workspaceImageFigure, sourceEditor, asset, sourceName, assetBackButton } from "./dom"
import { alphaMask } from "../layout-scan.ts"
import { updatePanelToolButtons } from "./mobile-layout"
import { renderFiles } from "./file-tree"
import { selectFile } from "./navigation"
import { updateDirty, commitBatch, commitTextChanges } from "./edit-history"
import { refreshPreview } from "./preview-render"
import { updateSourceFileActions } from "./source-files"
import { exportButtons, isTauri, LARGE_SKIN_BYTES } from "./canvas-interaction"
import { canExport, type ExportFormat } from "../export.ts"
import { operationError } from "../operations.ts"
import { clientLog, flushClientLogs } from "../client-log.ts"
import { message } from "@tauri-apps/plugin-dialog"
import { invoke, Channel } from "@tauri-apps/api/core"
import { adaptIos26Variant, adaptIos26KeyboardLayout } from "../ios26.ts"
import { adaptSxiForIos26 } from "../palm/sxi-ios26.ts"
import { SXI_SKIN_PATH } from "../palm/sxi-json.ts"
import { adaptSsfSkinForIos26, isSsfSkinFile } from "../ssf/ssf-ios26.ts"
import { refreshSxiDocument } from "./sxi-documents"
import { type Change } from "../history.ts"
import { replaceImagePreviewURL } from "../image-preview.ts"
import { clearImagePreviewError } from "./resource-inspector"
import { createIcon } from "../icons.ts"
import { type TileRect } from "../tiles.ts"

export async function resizePng(bytes: Uint8Array, xRatio: number, yRatio: number): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes).buffer], { type: "image/png" }))
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(bitmap.width * xRatio))
  canvas.height = Math.max(1, Math.round(bitmap.height * yRatio))
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PNG 缩放失败")), "image/png")
  })
  return new Uint8Array(await blob.arrayBuffer())
}

export function pngImage(bytes: Uint8Array): Promise<ImageBitmap> {
  return createImageBitmap(new Blob([new Uint8Array(bytes).buffer], { type: "image/png" }))
}

/** A PNG of `width` × `height` with each image (or its `source` part) drawn into its rect, in order. */
export async function composePng(width: number, height: number, layers: ReadonlyArray<{ image: CanvasImageSource; source?: TileRect; rect: TileRect }>): Promise<Uint8Array> {
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  const context = canvas.getContext("2d")
  for (const { image, source, rect } of layers) {
    if (source) context?.drawImage(image, ...source, ...rect)
    else context?.drawImage(image, ...rect)
  }
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PNG 缩放失败")), "image/png")
  })
  return new Uint8Array(await blob.arrayBuffer())
}

// 按面板精确尺寸拉伸素材图
export async function fitPngTo(bytes: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  const bitmap = await pngImage(bytes)
  try {
    return await composePng(width, height, [{ image: bitmap, rect: [0, 0, width, height] }])
  } finally {
    bitmap.close()
  }
}

// 复用 fitPngTo 的解码方式，读取像素后只保留 alpha 掩码用于按键网格检测
export async function decodePngMask(bytes: Uint8Array): Promise<{ width: number; height: number; mask: Uint8Array }> {
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes).buffer], { type: "image/png" }))
  const canvas = document.createElement("canvas")
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext("2d", { willReadFrequently: true })
  context?.drawImage(bitmap, 0, 0)
  bitmap.close()
  if (!context) throw new Error("无法读取图片像素")
  return { width: canvas.width, height: canvas.height, mask: alphaMask(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height) }
}

/**
 * Export targets the open skin can reach. BDI/BDS cannot become BDA and a Sogou skin has no Palm
 * (.sxi) path; unreachable items are hidden rather than left as unexplained greyed-out rows.
 */
export function exportTargetHidden(format: ExportFormat): boolean {
  const source = appState.archive?.format
  if (!source) return false
  return !canExport(source, format)
}

function setFileOperationBusy(busy: boolean): void {
  appState.fileOperationRunning = busy
  newButton.disabled = busy
  openButton.disabled = busy
  saveButton.disabled = busy || !appState.archive
  mobileShareButton.disabled = busy || !appState.archive
  updatePanelToolButtons()
  updateSourceFileActions()
  for (const button of exportButtons) {
    button.hidden = exportTargetHidden(button.dataset.exportFormat as ExportFormat)
    button.disabled = busy || !appState.archive || button.hidden
  }
}

export function showStatus(text: string, kind: "progress" | "success" = "success"): void {
  eventLog.dataset.kind = kind
  eventLog.textContent = text
}

export function showError(error: unknown, action = "操作"): void {
  const text = operationError(action, error)
  clientLog.error("operation.error", { action }, error)
  void flushClientLogs()
  eventLog.dataset.kind = "error"
  eventLog.textContent = text
  if (isTauri() && !fileOperationDialog.open) {
    void message(text, { title: `${action}失败`, kind: "error" }).catch(() => {})
  }
}

export function updateFileOperationProgress(value: number, detail: string): void {
  fileOperationProgress.value = Math.max(0, Math.min(100, value))
  fileOperationProgress.textContent = `${Math.round(fileOperationProgress.value)}%`
  fileOperationPercent.textContent = fileOperationProgress.textContent
  fileOperationDetail.textContent = detail
}

export function showSkinLoadProgress(size: number): boolean {
  if (size <= LARGE_SKIN_BYTES) return false
  showFileOperationProgress()
  return true
}

export function showFileOperationProgress(): void {
  appState.fileOperationProgressVisible = true
  if (!fileOperationDialog.open) fileOperationDialog.showModal()
}

export async function readBrowserSkinFile(file: File): Promise<Uint8Array> {
  if (!showSkinLoadProgress(file.size)) return new Uint8Array(await file.arrayBuffer())
  const output = new Uint8Array(file.size)
  const reader = file.stream().getReader()
  let offset = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    output.set(value, offset)
    offset += value.length
    updateFileOperationProgress(2 + offset / file.size * 16, `正在读取皮肤文件… ${Math.round(offset / file.size * 100)}%`)
  }
  return output
}

export async function readNativeSkinFile(path: string): Promise<Uint8Array> {
  const size = await invoke<number>("skin_file_size", { path })
  if (showSkinLoadProgress(size)) {
    updateFileOperationProgress(2, "正在读取皮肤文件… 0%")
    await waitForInterfacePaint()
  }
  const progress = new Channel<[number, number]>()
  progress.onmessage = ([loaded, total]) => {
    if (!appState.fileOperationProgressVisible) return
    updateFileOperationProgress(2 + loaded / total * 16, `正在读取皮肤文件… ${Math.round(loaded / total * 100)}%`)
  }
  // 后端直接回传二进制，避免 Vec<u8> 被序列化成 JSON 数字数组。
  return new Uint8Array(await invoke<ArrayBuffer>("read_skin_file", { path, progress }))
}

export function waitForInterfacePaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}

function ios26StylePath(genPath: string): string | undefined {
  if (!appState.archive) return
  const directory = genPath.slice(0, genPath.lastIndexOf("/"))
  const themeRoot = genPath.split("/").slice(0, 2).join("/")
  return [`${directory}/res/default.css`, `${themeRoot}/res/default.css`]
    .find((path) => appState.archive?.isText(path))
}

export function adaptArchiveForIos26(): boolean {
  const archive = appState.archive
  if (!archive) return false
  if (archive.format === "sxi") {
    commitTextChanges([{ path: SXI_SKIN_PATH, before: archive.getText(SXI_SKIN_PATH), after: adaptSxiForIos26(archive.getText(SXI_SKIN_PATH)) }])
    refreshSxiDocument()
    return true
  }
  if (archive.format === "ssf") {
    const looks = archive.names().filter(isSsfSkinFile)
    if (!looks.length) throw new Error("没有找到可适配的 phoneSkin.ini。")
    commitTextChanges(looks.map((path) => ({ path, before: archive.getText(path), after: adaptSsfSkinForIos26(archive.getText(path)) })))
    return true
  }
  const staged = new Map<string, string>()
  let variants = 0
  const text = (path: string) => staged.get(path) ?? archive.getText(path)
  for (const genPath of archive.names().filter((path) => /\/(?:port|land)\/gen\.ini$/i.test(path))) {
    const directory = genPath.slice(0, genPath.lastIndexOf("/"))
    const gen = IniDocument.parse(text(genPath))
    const candidateName = gen.get("CAND", "LAYOUT_NAME") ?? "cand1"
    const candidatePath = `${directory}/${candidateName.replace(/\.cnd$/i, "")}.cnd`
    const stylePath = ios26StylePath(genPath)
    if (!archive.isText(candidatePath) || !stylePath) continue
    variants++
    const adapted = adaptIos26Variant(text(candidatePath), text(genPath), text(stylePath))
    staged.set(candidatePath, adapted.candidate)
    staged.set(genPath, adapted.general)
    staged.set(stylePath, adapted.styles)
    for (const path of archive.names().filter((path) => path.startsWith(`${directory}/`) && /\.ini$/i.test(path))) {
      if (!archive.isText(path)) continue
      const name = path.slice(directory.length + 1)
      staged.set(path, adaptIos26KeyboardLayout(
        name,
        text(path),
        adapted.panelStyle,
        gen.get("MORE", "SYM_LAYOUT") ?? "symbol",
      ))
    }
  }
  const changes: Change[] = [...staged].flatMap(([path, after]) => {
    const before = archive.getText(path)
    return before === after ? [] : [{ kind: "text" as const, path, before, after }]
  })
  if (!variants) throw new Error("没有找到可适配的候选栏和通用配置。")
  if (!changes.length) return true
  commitBatch(changes)
  renderFiles()
  if (appState.selectedPath && archive.isText(appState.selectedPath)) selectFile(appState.selectedPath)
  refreshPreview()
  updateDirty()
  return true
}

export async function runFileOperation(
  action: string,
  operation: () => boolean | Promise<boolean>,
): Promise<void> {
  if (appState.fileOperationRunning) {
    // 拖入、最近打开、模板卡片在上一个操作结束前也能触发：给出提示，不再静默忽略。
    showStatus(`正在${appState.currentFileOperation}，请稍后再${action}。`, "progress")
    return
  }
  appState.currentFileOperation = action
  setFileOperationBusy(true)
  appState.fileOperationProgressVisible = false
  showStatus(`正在${action}…`, "progress")
  fileOperationDialog.dataset.outcome = "progress"
  fileOperationIcon.replaceChildren(createIcon("keyboard", 20))
  fileOperationTitle.textContent = `正在${action}`
  fileOperationClose.textContent = "关闭"
  fileOperationClose.dataset.variant = "primary"
  fileOperationResult.hidden = true
  fileOperationResult.textContent = ""
  fileOperationClose.disabled = true
  updateFileOperationProgress(2, "正在准备…")
  const started = performance.now()
  clientLog.info("operation.start", { action })
  try {
    const completed = await operation()
    clientLog.info("operation.finish", {
      action,
      outcome: completed ? "completed" : "cancelled",
      durationMs: Math.round(performance.now() - started),
    })
    const result = completed ? `${action}完成。` : `${action}已取消。`
    showStatus(result)
    if (completed && /^(保存|导出)/.test(action)) showFileOperationProgress()
    if (appState.fileOperationProgressVisible) {
      fileOperationDialog.dataset.outcome = completed ? "success" : "cancelled"
      fileOperationIcon.replaceChildren(createIcon(completed ? "check" : "x", 20))
      fileOperationTitle.textContent = completed ? `${action}成功` : `${action}已取消`
      fileOperationClose.textContent = completed ? "完成" : "关闭"
      updateFileOperationProgress(completed ? 100 : fileOperationProgress.value, completed ? "处理完成，可继续编辑皮肤。" : "未进行更改")
      fileOperationResult.textContent = result
      fileOperationResult.hidden = completed
      if (completed && (action === "打开" || action.startsWith("下载"))) {
        fileOperationDialog.close()
        appState.fileOperationProgressVisible = false
      }
    }
  } catch (error) {
    clientLog.info("operation.finish", {
      action,
      outcome: "failed",
      durationMs: Math.round(performance.now() - started),
    })
    showError(error, action)
    if (appState.fileOperationProgressVisible) {
      fileOperationDialog.dataset.outcome = "error"
      fileOperationIcon.replaceChildren(createIcon("circle-alert", 20))
      fileOperationTitle.textContent = `${action}失败`
      fileOperationDetail.textContent = "处理已停止"
      fileOperationResult.textContent = operationError(action, error)
      fileOperationResult.hidden = false
    }
  } finally {
    setFileOperationBusy(false)
    if (appState.fileOperationProgressVisible) {
      fileOperationClose.disabled = false
      fileOperationClose.dataset.variant = "primary"
      fileOperationClose.focus()
    }
  }
}

let shownImageBytes: Uint8Array | undefined

export function showImage(path: string): void {
  const bytes = appState.archive?.getBytes(path)
  if (!bytes) return
  // 同一份字节不换 URL：重新解码期间切片画布会空白一帧。
  if (bytes !== shownImageBytes || !appState.assetURL) {
    shownImageBytes = bytes
    appState.assetURL = replaceImagePreviewURL(appState.assetURL, bytes)
    clearImagePreviewError()
    workspaceImage.src = appState.assetURL
    assetImage.src = appState.assetURL
  }
  deviceShell.hidden = true
  workspaceImageFigure.hidden = false
  sourceEditor.hidden = true
  asset.hidden = appState.resourceConfigActive
  sourceName.textContent = path
  assetBackButton.disabled = !appState.assetReturnPath
}
