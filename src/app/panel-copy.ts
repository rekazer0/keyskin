// 面板复制: copy a folder or file of the skin, optionally scaled to another panel size. Baidu skins
// copy files; a Palm skin copies parts of skin.json by their address ("skin.json/default/port_layout/")
// and its image folders with the parts they belong to; a Sogou skin copies its own files and lists a
// copied resolution folder.

import { IniDocument } from "../ini.ts"
import { appState } from "./state"
import { panelCopySource, panelSourceWidth, panelSourceHeight, panelTargetWidth, panelTargetHeight, panelScaleEnabled, panelScaleOptions, panelCopyTarget, panelScaleSummary, panelCopySourceOptions, panelCopyTargetOptions, theme, orientation, layout, panelScaleDialog } from "./dom"
import { archiveCopyPaths, archivePathOptions, scaleIniDocument } from "../panel-tools.ts"
import { scheduleSourceAutosave } from "./source-workspace"
import { syncSegmentedControls } from "./mobile-layout"
import { renderFiles } from "./file-tree"
import { selectFile } from "./navigation"
import { commitBatch, updateDirty } from "./edit-history"
import { updateDevicePreview } from "./preview-render"
import { resizePng, showError } from "./file-operations"
import { type Change } from "../history.ts"
import { SXI_SKIN_PATH } from "../palm/sxi-json.ts"
import { applySxiCopies, sxiCopyParts, sxiFolderParts, sxiPartAddresses } from "../palm/sxi-panel-copy.ts"
import { PalmBoard } from "../palm/palm-board.ts"
import { scaleSsfLook } from "../ssf/ssf-resolutions.ts"
import { listSsfResolutionInTheme, listSsfResolutionInTime, ssfResolutionFolder } from "../ssf/ssf-panel-copy.ts"
import { ssfPackage, ssfSkeleton } from "./ssf-documents"
import { isSxiBoardAddress, palmBoardTypes, palmSkin, PALM_SHARED_BOARD, palmOrientation, palmTheme, refreshSxiDocument, sxiBoardAddress, sxiPointer } from "./sxi-documents"

export function panelSizeFrom(document: IniDocument | undefined): [number, number] | undefined {
  const size = document?.get("PANEL", "SIZE")?.split(",").map(Number)
  return size?.length === 2 && size.every((value) => Number.isFinite(value) && value > 0)
    ? size as [number, number]
    : undefined
}

/** A Sogou folder's panel: its screen width, as tall as the official skeleton's keyboard at that width. */
function ssfPanelSize(path: string): [number, number] | undefined {
  const width = ssfResolutionFolder(path)
  const skeleton = ssfSkeleton()
  const general = `${theme.value}/skin/port/gen.ini`
  const size = width && skeleton?.isText(general) ? panelSizeFrom(IniDocument.parse(skeleton.getText(general))) : undefined
  return width && size ? [width, Math.round(size[1] * width / size[0])] : undefined
}

/**
 * A Palm board's panel (its own size, else `defaultGlobal`'s); for any other part or folder, the
 * shared size of the layout it is in (an orientation's, a theme's portrait one).
 */
function palmPanelSize(path: string): [number, number] | undefined {
  const pointer = sxiPointer(path) ?? sxiFolderParts(path)?.[0]
  if (!pointer?.length || !appState.archive) return
  const layout = pointer[1]?.endsWith("_layout") ? pointer[1] : `${palmOrientation()}_layout`
  const type = pointer[2] === "b" && pointer[3] ? pointer[3] : PALM_SHARED_BOARD
  const board = new PalmBoard(palmSkin(appState.archive), pointer[0] === "night" ? "night" : "default", layout === "land_layout" ? "land" : "port", type)
  return board.width > 0 && board.height > 0 ? [board.width, board.height] : undefined
}

function panelSizeForPath(path: string): [number, number] | undefined {
  if (appState.archive?.format === "ssf") return ssfPanelSize(path)
  if (appState.archive?.format === "sxi") return palmPanelSize(path)
  if (!appState.archive?.isText(path)) return
  const directory = path.slice(0, path.lastIndexOf("/"))
  return panelSizeFrom(IniDocument.parse(appState.archive.getText(path))) ??
    (appState.archive.isText(`${directory}/gen.ini`) ? panelSizeFrom(IniDocument.parse(appState.archive.getText(`${directory}/gen.ini`))) : undefined)
}

/** Paths the dialog copies from and to; a Palm skin also lists the parts of its skin.json. */
function panelCopyNames(): string[] {
  const archive = appState.archive
  if (!archive) return []
  return archive.format === "sxi" && archive.isText(SXI_SKIN_PATH) ? [...archive.names(), ...sxiPartAddresses(archive.getText(SXI_SKIN_PATH))] : archive.names()
}

function panelCopySourceSize(): [number, number] | undefined {
  if (!appState.archive) return
  const source = panelCopySource.value.trim().replace(/\\/g, "/").replace(/\/+$/, "")
  if (appState.archive.format === "ssf") return ssfPanelSize(source)
  if (appState.archive.format === "sxi") return palmPanelSize(source)
  if (appState.archive.isText(source)) return panelSizeForPath(source)
  for (const path of appState.archive.names()) {
    if (path.startsWith(`${source}/`) && /\.ini$/i.test(path)) {
      const size = panelSizeForPath(path)
      if (size) return size
    }
  }
}

export function updatePanelCopyForm(): void {
  if (!appState.archive) return
  const sourceSize = panelCopySourceSize()
  panelSourceWidth.value = sourceSize ? String(sourceSize[0]) : ""
  panelSourceHeight.value = sourceSize ? String(sourceSize[1]) : ""
  if (!panelTargetWidth.value && sourceSize) panelTargetWidth.value = String(sourceSize[0])
  if (!panelTargetHeight.value && sourceSize) panelTargetHeight.value = String(sourceSize[1])
  if (!sourceSize) panelScaleEnabled.checked = false
  panelScaleEnabled.disabled = !sourceSize
  panelScaleOptions.hidden = !panelScaleEnabled.checked
  panelSourceWidth.disabled = true
  panelSourceHeight.disabled = true
  panelTargetWidth.disabled = !panelScaleEnabled.checked
  panelTargetHeight.disabled = !panelScaleEnabled.checked
  try {
    const copies = archiveCopyPaths(panelCopyNames(), panelCopySource.value, panelCopyTarget.value)
    panelScaleSummary.textContent = copies.length === 1
      ? `目标：${copies[0].target}`
      : `目标：${panelCopyTarget.value.trim()}（${copies.length} 个文件）`
  } catch {
    panelScaleSummary.textContent = ""
  }
}

function defaultPanelCopyTarget(source: string): string {
  if (source.endsWith("/")) return `${source.slice(0, -1)}_copy/`
  const slash = source.lastIndexOf("/") + 1
  const dot = source.lastIndexOf(".")
  return dot >= slash
    ? `${source.slice(0, dot)}_copy${source.slice(dot)}`
    : `${source}_copy`
}

/** Where the dialog starts: the open layout (Baidu), the current theme's layout folder (Palm) or resolution (Sogou). */
function defaultPanelCopySource(paths: readonly string[]): string {
  if (paths.includes(appState.selectedPath)) return appState.selectedPath
  const resolution = appState.archive?.format === "ssf" ? ssfPackage()?.resolution : undefined
  const preferred = resolution ? `${resolution}/` : appState.archive?.format === "sxi"
    ? `${SXI_SKIN_PATH}/${palmTheme()}/${palmOrientation()}_layout/`
    : `${theme.value}/skin/${orientation.value}/${layout.value}`
  return paths.find((path) => path === preferred) ?? paths[0]
}

/** A Sogou resolution folder goes to the next common screen width the skin does not have yet. */
function defaultTarget(source: string, paths: readonly string[]): string {
  if (appState.archive?.format !== "ssf" || !/^\d+\/$/.test(source)) return defaultPanelCopyTarget(source)
  return ["1080/", "720/", "480/"].find((folder) => !paths.includes(folder)) ?? defaultPanelCopyTarget(source)
}

export function openPanelCopyDialog(): void {
  if (!appState.archive) return
  const paths = archivePathOptions(panelCopyNames())
  if (!paths.length) {
    showError(new Error("皮肤中没有可复制的目录或文件"), "打开面板复制")
    return
  }
  const options = paths.map((value) => Object.assign(document.createElement("option"), { value }))
  panelCopySourceOptions.replaceChildren(...options.map((option) => option.cloneNode(true)))
  panelCopyTargetOptions.replaceChildren(...options)
  panelCopySource.value = defaultPanelCopySource(paths)
  panelCopyTarget.value = defaultTarget(panelCopySource.value, paths)
  panelScaleEnabled.checked = false
  panelTargetWidth.value = ""
  panelTargetHeight.value = ""
  updatePanelCopyForm()
  panelScaleDialog.showModal()
}

/** The copied folders, with a trailing slash; undefined when a single file is copied. */
function copiedFolders(copies: ReadonlyArray<{ source: string; target: string }>): { source: string; target: string } | undefined {
  const [source, target] = [panelCopySource.value, panelCopyTarget.value].map((value) => value.trim().replace(/\\/g, "/").replace(/\/+$/, ""))
  return copies.length === 1 && copies[0].source === source ? undefined : { source: `${source}/`, target: `${target}/` }
}

/** Palm and Sogou copies: one undo step, written through their own files. */
async function copyNativePanel(copies: ReadonlyArray<{ source: string; target: string }>, scaled: boolean, xRatio: number, yRatio: number): Promise<void> {
  const archive = appState.archive!
  const changes: Change[] = []
  const encoder = new TextEncoder()
  for (const { source, target } of copies) {
    if (archive.format === "sxi" && sxiPointer(source)) continue
    if (archive.format === "sxi" && (target === SXI_SKIN_PATH || sxiPointer(target))) {
      throw new Error(`${target} 是 skin.json 中的位置，不能用文件覆盖`)
    }
    const bytes = archive.getBytes(source)!
    const after = scaled && source.toLowerCase().endsWith(".png")
      ? await resizePng(bytes, xRatio, yRatio)
      : scaled && archive.format === "ssf" && /\.ini$/i.test(source) && archive.isText(source)
        ? encoder.encode(scaleSsfLook(archive.getText(source), xRatio, yRatio))
        : bytes.slice()
    changes.push({ kind: "bytes", path: target, before: archive.getBytes(target), after })
  }
  const text = (path: string, after: string) => {
    const before = archive.getText(path)
    if (before !== after) changes.push({ kind: "text", path, before, after })
  }
  if (archive.format === "sxi") {
    const folders = copiedFolders(copies)
    const parts = sxiCopyParts(copies, folders)
    if (parts.length) text(SXI_SKIN_PATH, applySxiCopies(archive.getText(SXI_SKIN_PATH), parts, scaled ? xRatio : 1, scaled ? yRatio : 1, folders))
  } else {
    const [source, target] = [panelCopySource.value, panelCopyTarget.value].map((value) => value.trim().replace(/\/+$/, ""))
    if (/^\d+$/.test(source) && /^\d+$/.test(target)) {
      if (archive.isText("time.ini")) text("time.ini", listSsfResolutionInTime(archive.getText("time.ini"), source, target))
      if (archive.isText("phoneTheme.ini")) text("phoneTheme.ini", listSsfResolutionInTheme(archive.getText("phoneTheme.ini"), target))
    }
  }
  commitBatch(changes)
  if (archive.format === "sxi") refreshSxiDocument()
}

export async function copyPanel(): Promise<boolean> {
  if (!appState.archive) return false
  const currentArchive = appState.archive
  const copies = archiveCopyPaths(panelCopyNames(), panelCopySource.value, panelCopyTarget.value)

  let xRatio = 1
  let yRatio = 1
  if (panelScaleEnabled.checked) {
    const sourceSize = panelCopySourceSize()
    const targetWidth = Number(panelTargetWidth.value)
    const targetHeight = Number(panelTargetHeight.value)
    if (!sourceSize || ![targetWidth, targetHeight].every((value) => Number.isFinite(value) && value > 0)) {
      throw new Error("面板分辨率必须是正数")
    }
    xRatio = targetWidth / sourceSize[0]
    yRatio = targetHeight / sourceSize[1]
  }
  const scaled = panelScaleEnabled.checked && (xRatio !== 1 || yRatio !== 1)

  if (currentArchive.format === "sxi" || currentArchive.format === "ssf") {
    await copyNativePanel(copies, scaled, xRatio, yRatio)
  } else {
    const staged = new Map<string, Uint8Array>()
    const encoder = new TextEncoder()
    for (const { source, target } of copies) {
      const bytes = currentArchive.getBytes(source)!
      const output = scaled && source.toLowerCase().endsWith(".png")
        ? await resizePng(bytes, xRatio, yRatio)
        : scaled && /\.(?:ini|til)$/i.test(source) && currentArchive.isText(source)
          ? encoder.encode(scaleIniDocument(IniDocument.parse(currentArchive.getText(source)), xRatio, yRatio).toString())
          : bytes.slice()
      staged.set(target, output)
    }
    for (const [path, bytes] of staged) currentArchive.setBytes(path, bytes)
    scheduleSourceAutosave([...staged.keys()])
  }

  const targetPath = copies[0].target
  const palmTarget = sxiPointer(targetPath)
  const variant = palmTarget
    ? [, palmTarget[0] === "night" ? "dark" : "light", palmTarget[1]?.match(/^(port|land)_layout$/)?.[1] ?? orientation.value]
    : targetPath.match(/^(light|dark)\/skin\/(port|land)\//)
  if (variant) {
    theme.value = variant[1]!
    orientation.value = variant[2] as "port" | "land"
    syncSegmentedControls()
  }
  renderFiles()
  if (currentArchive.format === "sxi") {
    // The canvas shows the copied board, else the board it showed in the copy's theme and orientation.
    const shown = sxiPointer(appState.layoutPath)?.[3] ?? ""
    const board = isSxiBoardAddress(targetPath) ? targetPath : palmBoardTypes().includes(shown) ? sxiBoardAddress(shown) : sxiBoardAddress(palmBoardTypes()[0] ?? "")
    if (isSxiBoardAddress(board)) selectFile(board)
  } else if (currentArchive.names().includes(targetPath)) selectFile(targetPath)
  updateDirty()
  updateDevicePreview()
  return true
}
