import { confirmDeletion } from "./ask"
import { zipSync } from "fflate"
import { isSoundPath, soundMimeType } from "../sounds"
import { appState } from "./state"
import { resourceListView, resourceInspector, workspacePane, resourceUploadInput, resourceSearch, theme, orientation } from "./dom"
import { currentSoundEntries, prepareResourceImage, renderResourceInspector } from "./resource-inspector"
import { commitBatch, isEditing, updateDirty } from "./edit-history"
import { isTauri, keySoundBuffers, releaseKeySound } from "./canvas-interaction"
import { runFileOperation, showError, showStatus } from "./file-operations"
import { invoke } from "@tauri-apps/api/core"
import { writeToChosenFile } from "./archive-io"
import { syncResourceSelection } from "./resource-gallery"
import type { Change } from "../history"
import { openResources } from "./resource-navigation"
import { isFontFile, sanitizeFontFileName, skinStylePaths, withFontReferencesCleared } from "../font-files"
import { validateFont } from "./skin-fonts"
import { renderResourceCatalogSearch } from "./resource-page"
import { refreshPreview } from "./preview-render"

function selectedResourceFiles(): string[] {
  return (appState.resourceCatalog ? [appState.selectedResourceCatalogItem] : appState.selectedResourceGalleryPaths).map(path => path.replace(/^file:/, ""))
    .filter(path => appState.archive?.getBytes(path))
}

function resourceDownload(): { name: string; bytes: Uint8Array; mime: string } | undefined {
  const archive = appState.archive
  const paths = selectedResourceFiles()
  if (!archive || !paths.length) return
  if (paths.length === 1) {
    const path = paths[0]!
    return { name: path.split("/").pop()!, bytes: archive.getBytes(path)!, mime: isSoundPath(path) ? soundMimeType(path) : isFontFile(path) ? "application/octet-stream" : "image/png" }
  }
  return { name: "资源.zip", bytes: zipSync(Object.fromEntries(paths.map(path => [path, archive.getBytes(path)!])), { level: 0 }), mime: "application/zip" }
}

export async function downloadResourceSelection(): Promise<boolean> {
  const file = resourceDownload()
  return Boolean(file && await writeToChosenFile(file.name, file.bytes))
}

export function startResourceDrag(event: DragEvent): void {
  const file = resourceDownload()
  if (!file || !event.dataTransfer) { event.preventDefault(); return }
  if (isTauri() && document.documentElement.classList.contains("macos")) {
    event.preventDefault()
    void invoke("start_resource_drag", { name: file.name, bytes: Array.from(file.bytes) }).catch(error => showError(error, "拖出资源"))
    return
  }
  const url = URL.createObjectURL(new Blob([Uint8Array.from(file.bytes)], { type: file.mime }))
  event.dataTransfer.effectAllowed = "copy"
  event.dataTransfer.setData("DownloadURL", `${file.mime}:${file.name}:${url}`)
  event.dataTransfer.setData("text/uri-list", url)
  // 下载管理器可能在 dragend 之后才读取 URL。
  const card = event.currentTarget as HTMLElement
  card.addEventListener("dragend", () => {
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }, { once: true })
}

/** 拖入与文件选择共用：全部校验成功后只记一步撤销。 */
export async function uploadResourceFiles(files: File[], source: "picker" | "drop" = "picker"): Promise<boolean> {
  const archive = appState.archive
  if (!archive || !isEditing() || !files.length) return false
  const fontTheme = theme.value
  const catalog = appState.resourceCatalog
  const scope = `${theme.value}/${orientation.value}`
  const changes: Array<Extract<Change, { kind: "bytes" }>> = []
  const paths = new Set<string>()
  const soundBase = currentSoundEntries()[0]?.path.split("/").slice(0, -1).join("/")
    ?? (archive.format === "ssf" ? "default" : `${theme.value}/skin/res`)
  for (const file of files) {
    let change: Extract<Change, { kind: "bytes" }>
    const font = isFontFile(file.name)
    if (source === "picker" && catalog === "font" && !font) throw new Error("请选择 TTF、OTF 或 TTC 字体文件")
    if (font && (source === "drop" || catalog === "font")) {
      if (!["bdi", "bds"].includes(archive.format)) throw new Error("当前格式不支持上传字体")
      const path = `${fontTheme}/skin/res/${sanitizeFontFileName(file.name)}`
      const bytes = new Uint8Array(await file.arrayBuffer())
      await validateFont(bytes)
      change = { kind: "bytes", path, before: archive.getBytes(path)?.slice(), after: bytes }
    } else if (/\.png$/i.test(file.name)) change = await prepareResourceImage(file)
    else if (isSoundPath(file.name)) {
      const name = file.name.split(/[\\/]/).pop()!
      if (!name || /[\u0000-\u001f]/.test(name)) throw new Error("无效的音效文件名")
      const path = `${soundBase}/${name}`
      change = { kind: "bytes", path, before: archive.getBytes(path)?.slice(), after: new Uint8Array(await file.arrayBuffer()) }
    } else throw new Error(source === "drop" ? `不支持拖入此资源：${file.name}` : "请选择 PNG 图片或 OGG、WAV、AIFF、MP3 音效文件")
    if (appState.archive !== archive || !isEditing() || scope !== `${theme.value}/${orientation.value}`) return false
    if (catalog !== appState.resourceCatalog) return false
    if (paths.has(change.path)) throw new Error(`存在重名资源：${file.name}`)
    paths.add(change.path)
    changes.push(change)
  }
  if (appState.archive !== archive || !isEditing()) return false
  commitBatch(changes)
  const lastPath = changes.at(-1)!.path
  const font = isFontFile(lastPath)
  for (const path of paths) keySoundBuffers.delete(path)
  if (!font || [...paths].some(isSoundPath)) releaseKeySound()
  if ([...paths].some(isFontFile)) refreshPreview()
  if (font) {
    if (catalog !== "font") resourceSearch.value = ""
    appState.resourceCatalog = "font"
    appState.selectedResourceCatalogItem = lastPath
    renderResourceCatalogSearch()
  } else {
    const sound = isSoundPath(lastPath)
    openResources(sound ? "sound" : "image")
    appState.selectedResourceGalleryPaths = [...paths]
      .filter(path => sound ? isSoundPath(path) : /\.png$/i.test(path))
      .map(path => sound ? `file:${path}` : path)
    appState.selectedResourceGalleryPath = appState.selectedResourceGalleryPaths.at(-1) ?? ""
    if (appState.resourceInspectorMode === "sound") appState.selectedSoundID = appState.selectedResourceGalleryPath
    renderResourceInspector()
    syncResourceSelection()
  }
  updateDirty()
  showStatus(`已上传 ${files.length} 个资源文件，可撤销`)
  return true
}

/** 删除选中的实际文件并清除它的引用，同名的另一模式字体保留。 */
export async function deleteCatalogFont(): Promise<void> {
  const archive = appState.archive
  const path = appState.selectedResourceCatalogItem
  if (!archive || appState.resourceCatalog !== "font" || !isEditing() || !isFontFile(path) || !archive.getBytes(path)) return
  const revision = archive.revision
  if (!await confirmDeletion(`删除字体「${path.split("/").pop()}」？`, "字体引用也将被清除，删除后可撤销恢复。")
    || appState.archive !== archive || archive.revision !== revision || !isEditing()) return
  const names = archive.names()
  const changes: Change[] = [{ kind: "bytes", path, before: archive.getBytes(path)?.slice() }]
  for (const stylePath of skinStylePaths(names)) {
    const before = archive.getText(stylePath)
    const after = withFontReferencesCleared(before, stylePath, names, new Set([path]), "")
    if (after !== undefined) changes.push({ kind: "text", path: stylePath, before, after })
  }
  commitBatch(changes)
  renderResourceCatalogSearch()
  refreshPreview()
  updateDirty()
  showStatus("已删除字体，可撤销")
}

export function resourceDropTarget(target: Element | null): boolean {
  return Boolean(appState.archive && appState.resourceConfigActive && target
    && [resourceListView, resourceInspector, workspacePane].some(host => host.contains(target)))
}

export function wireResourceTransfer(): void {
  resourceUploadInput.multiple = true
  resourceUploadInput.addEventListener("change", () => {
    void runFileOperation("上传资源", () => uploadResourceFiles(Array.from(resourceUploadInput.files ?? [])))
  })
  for (const host of [resourceListView, resourceInspector, workspacePane]) {
    host.addEventListener("dragover", event => {
      if (!event.dataTransfer?.types.includes("Files") || !resourceDropTarget(event.target as Element)) return
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = isEditing() ? "copy" : "none"
    }, { capture: true })
    host.addEventListener("drop", event => {
      if (!event.dataTransfer?.types.includes("Files") || !resourceDropTarget(event.target as Element)) return
      event.preventDefault()
      event.stopPropagation()
      if (isEditing()) {
        const files = Array.from(event.dataTransfer.files)
        void runFileOperation("上传资源", () => uploadResourceFiles(files, "drop"))
      }
    }, { capture: true })
  }
}
