// An SSF document is edited as its own files; the canvas takes its boards from the official Sogou
// skeleton, a read-only package kept next to the document, and paints the skin's own files onto them.

import { loadBuiltInProjectTemplate } from "../operations.ts"
import { SkinArchive } from "../skin.ts"
import { documentPackage, ssfSkeleton, type SsfTemplates } from "../ssf/ssf-convert.ts"
import type { SsfPackage } from "../ssf/ssf-package.ts"
import { selectedVariant } from "./bda-documents"
import { layout, orientation, theme } from "./dom"
import { showStatus } from "./file-operations"
import { syncSegmentedControls } from "./mobile-layout"
import { refreshPreview, updateDevicePreview } from "./preview-render"
import { appState } from "./state"
import { preview } from "./canvas-interaction"
import { renderFiles } from "./file-tree"
import { selectFile } from "./navigation"
import { isSsfBoardPath, ssfBoardDocument } from "./ssf-documents"

/** The open SSF document's own files as a package, read again only when the document changes. */
export function ssfDocumentPackage(archive: SkinArchive): SsfPackage {
  const cached = appState.ssfPackage
  if (cached?.archive === archive && cached.revision === archive.revision) return cached.pkg
  const pkg = documentPackage(archive)
  appState.ssfPackage = { archive, revision: archive.revision, pkg }
  return pkg
}

export async function ssfTemplates(): Promise<SsfTemplates> {
  if (!appState.ssfTemplates) {
    const [bdaBytes, sogouBytes] = await Promise.all([
      loadBuiltInProjectTemplate("default-android"),
      loadBuiltInProjectTemplate("official-sogou"),
    ])
    const bda = SkinArchive.open(bdaBytes, "bda")
    appState.ssfTemplates ??= {
      bda,
      sogou: SkinArchive.open(sogouBytes),
    }
  }
  return appState.ssfTemplates
}

/**
 * Lays out the official skeleton for the looks and resolution the open SSF document has; the skeleton
 * does not change with the skin's styles, so it is rebuilt only when those do. Returns the package's
 * warnings (looks it cannot show).
 */
export function rebuildSsfPreview(): string[] {
  const archive = appState.archive
  if (archive?.format !== "ssf" || !appState.ssfTemplates) return []
  const pkg = ssfDocumentPackage(archive)
  const key = `${pkg.resolution}|${[...pkg.themes.keys()].join(",")}`
  if (appState.ssfSkeleton?.archive !== archive || appState.ssfSkeleton.key !== key) {
    appState.ssfSkeleton = { archive, key, boards: ssfSkeleton(pkg, appState.ssfTemplates.sogou) }
    const board = ssfBoardDocument(appState.layoutPath)
    if (board) appState.layoutDocument = board
  }
  return pkg.warnings
}

/**
 * Switching theme, orientation or layout only changes which skeleton board the canvas shows: the
 * file selection stays, and a look the skin lacks is not created (that would add Baidu files to it).
 */
export function switchSsfPreviewLayout(path: string): void {
  const board = ssfBoardDocument(path)
  if (board) {
    const boardSelected = isSsfBoardPath(appState.selectedPath) || appState.selectedPath === appState.layoutPath
    appState.layoutPath = path
    appState.layoutDocument = board
    appState.selectedKeySections = []
    preview.setSelected([])
    // 外观切换后，概览显示当前搜狗外观的原始配置文件。
    renderFiles()
    if (boardSelected) selectFile(path)
  } else {
    const current = selectedVariant()
    theme.value = current.theme
    orientation.value = current.orientation
    layout.value = appState.layoutPath.split("/").pop() ?? layout.value
    showStatus("这套搜狗皮肤没有这种外观")
  }
  updateDevicePreview()
  syncSegmentedControls()
  refreshPreview()
}
