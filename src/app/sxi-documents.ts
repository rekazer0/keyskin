// A Palm `.sxi` document is its skin.json, read and edited as JSON. The editor addresses each part it
// shows (a board, a candidate bar, a bubble, the style and animation tables, the skin info) by its
// skin.json pointer, "skin.json/default/port_layout/b/t9Pinyin"; nothing is converted to other files.

import { appState } from "./state"
import { source } from "./canvas-interaction"
import { layout, orientation, sourceName, theme } from "./dom"
import { setSourceValue } from "./config-context"
import { commitText, isEditing, updateDirty } from "./edit-history"
import { showError, showStatus } from "./file-operations"
import { refreshPreview, updateDevicePreview } from "./preview-render"
import { renderFiles } from "./file-tree"
import { selectFile } from "./navigation"
import { syncSegmentedControls } from "./mobile-layout"
import { renderResourceInspector, renderStyleResourceDetail } from "./resource-inspector"
import { boardTypeFromIniFileName } from "../palm/palm-board-types.ts"
import { populateKeyInspector } from "./key-inspector"
import type { PalmOrientation, PalmTheme } from "../palm/palm-board.ts"
import { SXI_SKIN_PATH, parseSkinJson, parseSkinJsonValue, sxiAddressPointer, sxiFragment, sxiFragmentPath } from "../palm/sxi-json.ts"
import { asObject, type JsonObject } from "../palm/sxi-ini.ts"
import type { SkinArchive } from "../skin.ts"

/** The open `.sxi` document's skin.json, parsed again only when the document changes. */
export function palmSkin(archive: SkinArchive): JsonObject {
  const cached = appState.palmSkin
  if (cached?.archive === archive && cached.revision === archive.revision) return cached.skin
  const skin = parseSkinJson(archive.getText(SXI_SKIN_PATH))
  appState.palmSkin = { archive, revision: archive.revision, skin }
  return skin
}

/** The open Palm document's skin.json; undefined for other documents or a skin.json that does not parse. */
export function openPalmSkin(): JsonObject | undefined {
  const archive = appState.archive
  if (archive?.format !== "sxi" || !archive.isText(SXI_SKIN_PATH)) return
  try {
    return palmSkin(archive)
  } catch {
    return
  }
}

/** The skin.json pointer an editor address names; undefined for files and for other documents. */
export function sxiPointer(path: string): string[] | undefined {
  return appState.archive?.format === "sxi" ? sxiAddressPointer(path) : undefined
}

export function palmTheme(value = theme.value): PalmTheme {
  return value === "dark" ? "night" : "default"
}

export function palmOrientation(value = orientation.value): PalmOrientation {
  return value === "land" ? "land" : "port"
}

/** `defaultGlobal` holds what every board of a layout falls back to; it is not a board the canvas shows. */
export const PALM_SHARED_BOARD = "defaultGlobal"

/** Board types of a theme and orientation. */
export function palmBoardTypes(themeKey = palmTheme(), orientationKey = palmOrientation()): string[] {
  const skin = openPalmSkin()
  return Object.keys(asObject(skin ? sxiFragment(skin, [themeKey, `${orientationKey}_layout`, "b"]) : undefined) ?? {})
    .filter((type) => type !== PALM_SHARED_BOARD)
}

export function sxiBoardAddress(type: string, themeKey = palmTheme(), orientationKey = palmOrientation()): string {
  return sxiFragmentPath([themeKey, `${orientationKey}_layout`, "b", type])
}

/** The Palm themes the skin has, as the theme picker names them. */
export function palmThemes(): string[] {
  const skin = openPalmSkin()
  return ["light", "dark"].filter((value) => asObject(skin?.[palmTheme(value)]))
}

/** The board the canvas shows for a theme and orientation: `type` (else the layout picker's, py_9.ini is t9Pinyin) when there is one, else the first. */
export function preferredPalmBoard(type = boardTypeFromIniFileName(layout.value)): string | undefined {
  const types = palmBoardTypes()
  const chosen = type && types.includes(type) ? type : types[0]
  return chosen ? sxiBoardAddress(chosen) : undefined
}

/**
 * Switching theme or orientation shows the same board there; a look the skin lacks is not created
 * (skin.json would gain a theme the skin never had), the pickers go back instead.
 */
export function switchPalmLayout(): void {
  const shown = sxiPointer(appState.layoutPath)
  const board = preferredPalmBoard(shown?.[3])
  if (board) {
    renderFiles()
    selectFile(board)
  } else {
    if (shown) {
      theme.value = shown[0] === "night" ? "dark" : "light"
      orientation.value = shown[1] === "land_layout" ? "land" : "port"
    }
    showStatus("这套手心皮肤没有这种外观")
  }
  updateDevicePreview()
  syncSegmentedControls()
  refreshPreview()
}

/** A board the canvas can show: `skin.json/<theme>/<orientation>_layout/b/<type>`, `defaultGlobal` aside. */
export function isSxiBoardAddress(path: string): boolean {
  const pointer = sxiPointer(path)
  const skin = openPalmSkin()
  return Boolean(pointer?.length === 4 && pointer[2] === "b" && pointer[3] !== PALM_SHARED_BOARD && skin && asObject(sxiFragment(skin, pointer)))
}

/**
 * A theme's style table. Each id is looked up in the orientation's own `ss_1` first, then in `s_info`'s
 * (palm-styles.ts), so the table is addressed by the shared one.
 */
export function palmStyleTableAddress(themeKey = palmTheme()): string {
  return sxiFragmentPath([themeKey, "s_info", "ss_1"])
}

/** The animation table (`ss_2`) the orientation plays: its own, else the theme's shared one. */
export function palmAnimationTableAddress(themeKey = palmTheme(), orientationKey = palmOrientation()): string | undefined {
  const skin = openPalmSkin()
  const table = [`s_${orientationKey}`, "s_info"].find((name) => skin && asObject(sxiFragment(skin, [themeKey, name, "ss_2"])))
  return table && sxiFragmentPath([themeKey, table, "ss_2"])
}

/** The candidate bar (`c.<file>`) a board names in `cand.file`, else the one `defaultGlobal` names. */
export function palmCandidateAddress(board = appState.layoutPath): string | undefined {
  const skin = openPalmSkin()
  const pointer = sxiPointer(board)
  const layout = pointer?.[2] === "b" && skin ? pointer.slice(0, 2) : [palmTheme(), `${palmOrientation()}_layout`]
  const boards = asObject(skin ? sxiFragment(skin, [...layout, "b"]) : undefined) ?? {}
  const own = pointer?.[2] === "b" ? asObject(boards[pointer[3]]) : undefined
  const file = asObject(own?.cand)?.file ?? asObject(asObject(boards[PALM_SHARED_BOARD])?.cand)?.file
  return typeof file === "string" && skin && asObject(sxiFragment(skin, [...layout, "c", file])) ? sxiFragmentPath([...layout, "c", file]) : undefined
}

/** Selections the source editor shows skin.json for: every address, and the package's own JSON files. */
export function isSxiSourcePath(path: string): boolean {
  const archive = appState.archive
  return archive?.format === "sxi" && (Boolean(sxiPointer(path)) || archive.isText(path) && /\.json$/i.test(path))
}

function sxiSourcePath(path: string): string {
  return sxiPointer(path) ? SXI_SKIN_PATH : path
}

export function showSxiSource(path: string): void {
  const sourcePath = sxiSourcePath(path)
  setSourceValue(appState.archive!.getText(sourcePath))
  source.disabled = false
  sourceName.textContent = sourcePath
}

export function commitSxiSourceEdit(): void {
  const archive = appState.archive
  const path = appState.selectedPath
  if (!isEditing() || !archive || !isSxiSourcePath(path)) return
  const sourcePath = sxiSourcePath(path)
  try {
    if (sourcePath === SXI_SKIN_PATH) parseSkinJson(source.value)
    else parseSkinJsonValue(source.value)
    commitText(sourcePath, archive.getText(sourcePath), source.value)
  } catch (error) {
    showError(error, `编辑 ${sourcePath}`)
  }
  refreshSxiDocument()
}

/** Shows the edited skin.json everywhere: the source editor, the canvas, the inspector and the style library. */
export function refreshSxiDocument(): void {
  if (isSxiSourcePath(appState.selectedPath)) showSxiSource(appState.selectedPath)
  refreshPreview()
  populateKeyInspector()
  if (appState.resourceConfigActive && appState.resourceInspectorMode === "style") {
    renderResourceInspector()
    if (appState.selectedStyleID) void renderStyleResourceDetail()
  }
  updateDirty()
}
