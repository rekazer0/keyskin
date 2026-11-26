// Palm and Sogou documents are drawn from their own files. A Palm canvas reads skin.json for
// everything: the board's size, keys and states, the candidate bar, the styles, animations and hint
// bubbles. A Sogou canvas lists the keys of Sogou's official skeleton (the skin has no layout) and
// paints phoneSkin.ini onto them.

import { AtlasResolver, type TextVisual } from "../atlas.ts"
import { candidateWordsForeground, inputBarMetrics } from "../candidate-style.ts"
import { IniDocument } from "../ini.ts"
import { iosCandidateBackground, iosDefaultToolbarScene, iosToolbarImageScene } from "../ios-preview.ts"
import { hasIosToolbarGeometry, implicitIosToolbarRect } from "../ios-toolbar-geometry.ts"
import { previewItems } from "../preview-items.ts"
import type { NativeScene, SceneLayer } from "../native-scene.ts"
import { PalmBoard, type PalmOrientation, type PalmTheme } from "../palm/palm-board.ts"
import { palmBoardScene, palmCandidateScene, palmHint } from "../palm/palm-scene.ts"
import type { PalmStyles } from "../palm/palm-styles.ts"
import { PalmMotion } from "../palm/palm-motion.ts"
import type { Json } from "../palm/sxi-ini.ts"
import type { SkinArchive } from "../skin.ts"
import type { SsfPackage, SsfTheme } from "../ssf/ssf-package.ts"
import { animateSsfScene } from "../ssf/ssf-motion.ts"
import { SsfStyles, ssfBoardScene, ssfCandidateScene } from "../ssf/ssf-scene.ts"
import { textDocument, visualResolver } from "./bda-documents"
import { candidateBackgroundPreview, preview, previewScreenWidth, toolbarPreview } from "./canvas-interaction"
import { applyCandidateSpacing, genConfigPath, hideCandidateInputBar, showCandidateInputBar, toolbarConfigPath } from "./config-context"
import { candidateArea, candidateBackgroundCanvas, candidateComposition, candidateInput, candidateWords, hintPreviewEnabled, theme as themeInput, toolbarCanvas, toolbarStrip } from "./dom"
import { canvasEditable } from "./edit-history"
import { applyCandidateTextVisual, applyDeviceKeyboardGeometry, devicePreviewTransparent, inputBarInKeyboard, updatePanelTools } from "./preview-render"
import { ssfDocumentPackage } from "./ssf-preview"
import { ssfSkeleton } from "./ssf-documents"
import { isSxiBoardAddress, palmSkin, sxiPointer } from "./sxi-documents"
import { appState } from "./state"

type CandidateScene = { bar: SceneLayer[]; icons: NativeScene }
type CandidateText = { words?: TextVisual; first?: TextVisual; input?: TextVisual }

/** The toolbar canvas follows the keyboard state; the bar's backdrop does not change with it. */
function setCandidateScenes(build: (state: number | undefined) => Promise<CandidateScene>): void {
  const scenes = new Map<number | undefined, Promise<CandidateScene>>()
  const scene = (state: number | undefined) => {
    let built = scenes.get(state)
    if (!built) scenes.set(state, built = build(state))
    return built
  }
  toolbarPreview.setScene((state) => scene(state).then(({ icons }) => icons))
  candidateBackgroundPreview.setScene(() => scene(undefined).then(({ bar }) => ({ background: bar, keys: [] })))
}

/** The Palm board the open document shows, read from its skin.json as it is now. */
function palmBoard(): PalmBoard | undefined {
  const archive = appState.archive
  if (!archive || !isSxiBoardAddress(appState.layoutPath)) return
  const [theme, layoutKey, , type] = sxiPointer(appState.layoutPath) as [PalmTheme, string, string, string]
  return new PalmBoard(palmSkin(archive), theme, layoutKey.replace(/_layout$/, "") as PalmOrientation, type)
}

function styleID(value: Json): string {
  return value === undefined || value === null ? "" : String(value)
}

/** Press and show animations and hint bubbles, from the theme's `ss_1` / `ss_2` and the board's `h`. */
/** Palm presses and bubbles come from skin.json itself (palm-motion.ts, `h`), not the shared Baidu engine. */
function palmHints(board: PalmBoard): void {
  preview.setAnimation(undefined)
  preview.setLegacyAnimation(undefined)
  toolbarPreview.setLegacyAnimation(undefined)
  const hint = board.hint && hintPreviewEnabled.checked ? palmHint(board.hint) : undefined
  preview.setLegacyHints(hint, hint, false)
}

/** Candidate words, first candidate and input code as Baidu's engine looks them up; Palm draws them in the user's font. */
function palmCandidateText(board: PalmBoard, styles: PalmStyles, inKeyboard: boolean): CandidateText {
  const ids = board.candidateTextStyles
  const text = (id: Json) => {
    const visual = styles.resolveText(styleID(id), false)
    return visual && { ...visual, fontName: undefined }
  }
  const input = text(ids.input)
  const size = inKeyboard ? text(ids.inputSize) : undefined
  return { words: text(ids.words), first: text(ids.first), input: input && { ...input, fontSize: size?.fontSize ?? input.fontSize } }
}

/** The toolbar strip and its backdrop for `board`; returns their size, or none on a symbol board. */
function palmCandidateBar(board: PalmBoard, styles: PalmStyles, text: CandidateText, inKeyboard: boolean): { height: number; inputHeight: number } | undefined {
  const size = board.candidateSize
  if (candidateArea.hidden || !size) {
    delete toolbarStrip.dataset.path
    toolbarStrip.hidden = true
    candidateBackgroundCanvas.hidden = true
    hideCandidateInputBar()
    return
  }
  const dark = themeInput.value === "dark" ? "dark" : "light"
  toolbarStrip.hidden = false
  const path = toolbarConfigPath()
  if (path) toolbarStrip.dataset.path = path
  for (const canvas of [toolbarPreview, candidateBackgroundPreview]) {
    canvas.setResolver(styles)
    canvas.setOffsets(undefined)
    canvas.setDefaults(undefined)
    canvas.setTheme(dark)
    canvas.setPanel("", size.width, size.height)
  }
  toolbarPreview.setTransparent(true)
  candidateBackgroundPreview.setTransparent(devicePreviewTransparent())
  candidateBackgroundCanvas.hidden = false
  candidateBackgroundPreview.setNativeItems(() => [])
  toolbarPreview.setNativeItems((state, composing) => palmBoard()?.candidateItems(state, composing) ?? [])
  toolbarPreview.setMode(canvasEditable() ? "edit" : "preview")
  const ids = board.candidateTextStyles
  const inlineBack = inKeyboard ? styles.sourceSize(styleID(ids.inlineBack), false) : undefined
  const metrics = inputBarMetrics(text.input?.fontSize, size.width, inlineBack)
  showCandidateInputBar(styles, metrics, size.width, styleID(inKeyboard ? ids.inlineBack ?? ids.inputBack : ids.inputBack))
  toolbarCanvas.style.setProperty("--toolbar-width", String(size.width))
  toolbarCanvas.style.setProperty("--toolbar-height", String(size.height))
  toolbarCanvas.style.setProperty("--candidate-input-height", String(metrics.height))
  applyCandidateSpacing(board.candidateSpacing, size.width)
  return { height: size.height, inputHeight: metrics.height }
}

/**
 * Refreshes every canvas of an open Palm document from skin.json. Returns false when the document is
 * not a Palm board.
 */
export function refreshPalmPreview(): boolean {
  const archive = appState.archive
  const board = palmBoard()
  const styles = visualResolver()
  if (!archive || !board || !styles) return false
  const palmStyles = styles as PalmStyles
  const skin = palmSkin(archive)
  const inKeyboard = inputBarInKeyboard()
  const text = palmCandidateText(board, palmStyles, inKeyboard)
  const bar = palmCandidateBar(board, palmStyles, text, inKeyboard)
  palmHints(board)
  const motion = PalmMotion.load(skin, board.theme, board.orientation, board, palmStyles)
  preview.setResolver(styles)
  preview.setOffsets(undefined)
  preview.setDefaults(undefined)
  preview.setTheme(board.theme === "night" ? "dark" : "light")
  preview.setTransparent(devicePreviewTransparent())
  appState.firstCandidateTextVisual = text.first
  appState.candidateTextWidth = board.width
  applyCandidateTextVisual(candidateInput, text.input, board.width)
  applyCandidateTextVisual(candidateWords, text.words ?? { color: "#ffffff" }, board.width)
  const firstCandidate = candidateWords.firstElementChild as HTMLElement | null
  if (firstCandidate) applyCandidateTextVisual(firstCandidate, text.first, board.width)
  preview.setPanel("", board.width, board.height, board.panelAnimation)
  preview.setNativeItems((state) => palmBoard()?.items(state) ?? [])
  const candidateHeight = bar?.height ?? 0
  const candidateInputHeight = bar?.inputHeight ?? 0
  const surfaceHeight = updatePanelTools(board.width, board.height, candidateHeight, { items: board.items(undefined), states: board.states() })
  appState.activeKeyboardGeometry = { panelWidth: board.width, panelHeight: surfaceHeight, candidateHeight, candidateInputHeight }
  applyDeviceKeyboardGeometry(board.width, surfaceHeight, candidateHeight, candidateInputHeight)
  preview.setDocument(undefined, `${appState.layoutPath}|${board.theme}|${board.orientation}`)
  // The board is read again for each state and after each edit, so the scene follows skin.json.
  preview.setScene((state) => {
    const current = palmBoard()
    return current ? motion.then((loaded) => palmBoardScene(current, palmStyles, state, loaded)) : Promise.resolve(undefined)
  })
  setCandidateScenes((state) => {
    const current = palmBoard()
    return current
      ? palmCandidateScene(current, palmStyles, state)
      : Promise.resolve({ bar: [], icons: { background: [], keys: [] } })
  })
  return true
}

function ssfScenes(archive: SkinArchive, draft?: SsfPackage): boolean {
  const template = appState.ssfTemplates?.sogou
  const match = appState.layoutPath.match(/^(light|dark)\/skin\/(port|land)\/([^/]+)\.ini$/)
  const layout = appState.layoutDocument
  if (!template || !match || !layout) return false
  const [, theme, orientation, name] = match
  const templatePath = (file: string) => `light/skin/${orientation}/${file}`
  const templateText = (file: string) => template.isText(templatePath(file)) ? IniDocument.parse(template.getText(templatePath(file))) : undefined
  const templateLayout = templateText(`${name}.ini`)
  if (!templateLayout) return false
  const pkg = draft ?? ssfDocumentPackage(archive)
  const screenWidth = previewScreenWidth()
  const styles = new SsfStyles(archive, pkg, theme as SsfTheme, screenWidth / preview.panelWidth)
  const resolver = new AtlasResolver(template, "light", orientation)
  const templateGen = templateText("gen.ini")
  const width = (document?: IniDocument) => Number(document?.get("PANEL", "SIZE")?.split(",")[0])
  const scale = width(layout) && width(templateGen) ? width(layout) / width(templateGen) : 1
  const skeleton = { layout, template: templateLayout, resolver, offsets: templateGen, scale }
  const candidatePath = toolbarConfigPath()
  const boards = ssfSkeleton()
  const candidates = candidatePath && boards?.isText(candidatePath) ? IniDocument.parse(boards.getText(candidatePath)) : undefined
  const barHeight = candidates && !toolbarPreview.canvas.closest("[hidden]") ? toolbarPreview.panelHeight : 0
  const size = { width: preview.panelWidth, height: preview.surfaceHeight }
  const popups = hintPreviewEnabled.checked
  preview.setScene(() => ssfBoardScene(styles, skeleton, name, orientation === "land", { ...size, barHeight })
    .then((scene) => animateSsfScene(scene, styles, layout, name, orientation === "land", popups, screenWidth)))
  const templateCandidates = candidatePath && templateText(candidatePath.split("/").pop()!)
  if (candidates && templateCandidates) {
    setCandidateScenes(() => ssfCandidateScene(styles, candidates, templateCandidates, resolver, {
      width: toolbarPreview.panelWidth,
      height: toolbarPreview.panelHeight,
      panelHeight: size.height,
    }))
  }
  return true
}

/** Points a Sogou document's canvases at its native scenes; other formats paint their layout's styles. */
export function refreshNativeScenes(draft?: SsfPackage): void {
  const archive = appState.archive
  for (const canvas of [preview, toolbarPreview, candidateBackgroundPreview]) canvas.setNativeItems(undefined)
  if (archive?.format === "ssf" && ssfScenes(archive, draft)) return
  for (const canvas of [preview, toolbarPreview, candidateBackgroundPreview]) canvas.setScene(undefined)
  preview.setPanelTopInset(0)
  if ((archive?.format !== "bdi" && archive?.format !== "bds") || candidateArea.hidden) return
  const resolver = visualResolver()
  if (!resolver) return
  if (!inputBarInKeyboard()) {
    candidateBackgroundPreview.setScene(async () => {
      const { panelStyle, panelWidth: width, panelHeight: height } = candidateBackgroundPreview
      const rect = { x: 0, y: 0, width, height }
      const [normal, highlight] = await Promise.all([resolver.resolve(panelStyle, false), resolver.resolve(panelStyle, true)])
      const background: SceneLayer[] = []
      // Android keeps NM_IMG under a distinct CAND highlight, including when the highlight slice is missing.
      if (normal?.image && (normal.image !== highlight?.image || normal.source?.join() !== highlight?.source?.join())) {
        background.push({ kind: "image", rect, visual: {
          ...normal,
          color: highlight?.color ?? normal.color,
          borderColor: highlight?.image ? undefined : highlight?.borderColor ?? normal.borderColor,
        } })
        if (highlight?.image) background.push({ kind: "image", rect, visual: { ...highlight, color: undefined } })
      } else if (highlight) background.push({ kind: "image", rect, visual: highlight })
      return { background, keys: [] }
    })
    return
  }
  if (archive.format !== "bdi") return
  const path = toolbarConfigPath()
  const candidate = path && textDocument(path)
  if (!candidate) return
  const general = textDocument(genConfigPath())
  const width = preview.panelWidth
  const height = toolbarPreview.panelHeight
  const inputHeight = appState.candidateInputBar?.metrics.height ?? 0
  const sharedInput = candidateBackgroundCanvas.hasAttribute("data-shared-input-background")
  preview.setPanelTopInset(height + inputHeight)
  const nativeFunctions = candidate.sections().some((section) => candidate.get(section, "KEY")?.trim() === "F14")
  const items = [...new Map([
    ...previewItems(candidate, width, height, general),
    ...previewItems(candidate, width, height, general, true),
  ].map((item) => [item.section, item])).values()]
  if (nativeFunctions && !hasIosToolbarGeometry(general, candidate)) {
    toolbarPreview.setScene(() => iosDefaultToolbarScene(general, candidate, resolver, items, width, height))
  } else {
    const implicit = candidateComposition.hidden ? implicitIosToolbarRect(general, candidate, width, height) : undefined
    toolbarPreview.setScene(() => iosToolbarImageScene(
      resolver, items, width, height, toolbarPreview.devicePointWidth,
      resolver.resolveText(candidateWordsForeground(candidate, general), false)?.color ?? getComputedStyle(toolbarPreview.canvas).color, implicit,
    ))
  }
  candidateBackgroundPreview.setScene(() => iosCandidateBackground(
    resolver, preview.panelStyle, candidateBackgroundPreview.panelStyle,
    width, preview.surfaceHeight, height, inputHeight, sharedInput,
  ))
}

function ssfCandidateText(archive: SkinArchive, width: number): CandidateText | undefined {
  const theme = appState.layoutPath.match(/^(light|dark)\//)?.[1] as SsfTheme | undefined
  if (!theme) return
  const styles = new SsfStyles(archive, ssfDocumentPackage(archive), theme)
  const scale = width / styles.sogouWidth
  const visual = (section: string): TextVisual | undefined => {
    const look = styles.text([section], scale)
    const color = styles.color(section)
    const visual: TextVisual = {
      ...color ? { color } : {},
      ...look.size ? { fontSize: look.size } : {},
      ...look.font ? { fontName: look.font } : {},
      ...look.weight ? { weight: look.weight } : {},
    }
    return Object.keys(visual).length ? visual : undefined
  }
  // Sogou highlights the first candidate with its own style.
  return { words: visual("TextStyle_Candidate"), first: visual("TextStyle_Candidate_Highlight"), input: visual("TextStyle_Composing") }
}

/** A Sogou skin's candidate words, first candidate and input code; a field it leaves out keeps the built-in look. */
export function nativeCandidateText(width: number): CandidateText | undefined {
  const archive = appState.archive
  return archive?.format === "ssf" ? ssfCandidateText(archive, width) : undefined
}

/**
 * Check if the open archive is a Xunfei skin (.it/.itx).
 */
function isXunfeiArchive(archive: SkinArchive): boolean {
  return archive.format === "it" || archive.format === "itx"
}

// ============================================================================
// Xunfei (.it/.itx) Preview
// ============================================================================

/**
 * Find the main config directory in a Xunfei archive.
 * Priority: config/ → 1080/ → first directory containing offset.ini or style.ini
 */
function xunfeiConfigDir(archive: SkinArchive): string | undefined {
  const names = archive.names()
  
  // Try standard candidates first
  for (const candidate of ["config", "1080", "720"]) {
    if (names.some((n) => n === `${candidate}/offset.ini` || n === `${candidate}/style.ini`)) {
      return candidate
    }
  }
  
  // Try looking for skinname/<resolution>/ pattern
  const dirMatch = names.find((n) => /^[^/]+\/\d{3,4}\/(offset|style)\.ini$/.test(n))
  if (dirMatch) {
    const parts = dirMatch.split("/")
    return `${parts[0]}/${parts[1]}`
  }
  
  // Fall back: find any directory containing offset.ini or style.ini
  const match = names.find((n) => n.endsWith("/offset.ini") || n.endsWith("/style.ini"))
  return match ? match.slice(0, match.lastIndexOf("/")) : undefined
}

/**
 * Read a panel size from offset.ini or style.ini.
 */
function xunfeiPanelSize(archive: SkinArchive, dir: string): { width: number; height: number } {
  const offsetPath = `${dir}/offset.ini`
  if (archive.isText(offsetPath)) {
    const doc = IniDocument.parse(archive.getText(offsetPath))
    const w = Number(doc.get("PANEL", "W") ?? doc.get("PANEL", "Width") ?? 0)
    const h = Number(doc.get("PANEL", "H") ?? doc.get("PANEL", "Height") ?? 0)
    if (w > 0 && h > 0) return { width: w, height: h }
  }
  const stylePath = `${dir}/style.ini`
  if (archive.isText(stylePath)) {
    const doc = IniDocument.parse(archive.getText(stylePath))
    const size = doc.get("PANEL", "SIZE")?.split(",").map(Number)
    if (size && size[0] > 0 && size[1] > 0) return { width: size[0], height: size[1] }
  }
  return { width: 1080, height: 585 }
}

/**
 * Refresh the editor's main preview canvas for an open Xunfei (.it/.itx) skin.
 * Returns false when the open archive is not a Xunfei skin.
 */
export function refreshXunfeiPreview(
  updatePanelToolsFn: (w: number, h: number) => number,
  applyDeviceKeyboardGeometryFn: (w: number, h: number, ch: number, ci: number) => void,
  devicePreviewTransparentFn: () => boolean,
): boolean {
  const archive = appState.archive
  if (!archive || !isXunfeiArchive(archive)) return false

  const dir = xunfeiConfigDir(archive)
  if (!dir) return false

  const { width, height } = xunfeiPanelSize(archive, dir)

  // Xunfei has no candidate bar support yet
  candidateArea.hidden = true
  toolbarStrip.hidden = true
  toolbarStrip.dataset.path = ""
  candidateBackgroundCanvas.hidden = true

  preview.setResolver(undefined)
  preview.setOffsets(undefined)
  preview.setDefaults(undefined)
  preview.setTheme("light")
  preview.setTransparent(devicePreviewTransparentFn())
  preview.setPanel("", width, height)
  preview.setDocument(undefined, appState.layoutPath)
  preview.setLegacyAnimation(undefined)
  preview.setLegacyShowAnimation(undefined)
  preview.setLegacyHints(undefined, undefined, false)
  preview.setAnimation(undefined)
  preview.setNativeItems(undefined)

  // Build NativeScene from actual skin images in the archive
  preview.setScene(async () => {
    const cur = appState.archive
    if (!cur || !isXunfeiArchive(cur)) return undefined
    const curDir = xunfeiConfigDir(cur)
    if (!curDir) return undefined

    // Parse image.ini to find the background image
    const imagePath = `${curDir}/image.ini`
    let bgFile: string | undefined
    if (cur.isText(imagePath)) {
      const imageDoc = IniDocument.parse(cur.getText(imagePath))
      for (const section of imageDoc.sections()) {
        const src = imageDoc.get(section, "SRC") ?? imageDoc.get(section, "Src") ?? imageDoc.get(section, "src")
        if (src) {
          // Look for file in archive relative to config dir, res/ subdir, or archive root
          const candidates = [
            src,
            `${curDir}/res/${src}`,
            `${curDir}/${src}`,
            `res/${src}`,
            src.replace(/\\/g, "/"),
          ]
          for (const c of candidates) {
            if (cur.getBytes(c)) { bgFile = c; break }
          }
          if (bgFile) break
        }
      }
    }
    // Fallback: scan for bg.jpg / bg.png / any image
    if (!bgFile) {
      bgFile = cur.names().find((n) => /\/(bg|background)\.(jpg|png|webp)$/i.test(n))
        ?? cur.names().find((n) => /\.(jpg|png|webp)$/.test(n) && Boolean(cur.getBytes(n)))
    }
    if (!bgFile) return undefined

    const bytes = cur.getBytes(bgFile)
    if (!bytes) return undefined

    const type = /\.(jpg|jpeg)$/i.test(bgFile) ? "image/jpeg" : "image/png"
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type })
    const bitmap = await createImageBitmap(blob)
    return {
      background: [{ kind: "image" as const, rect: { x: 0, y: 0, width: bitmap.width, height: bitmap.height }, bitmap }],
      keys: [],
    } as any
  })

  const surfaceHeight = updatePanelToolsFn(width, height)
  appState.activeKeyboardGeometry = { panelWidth: width, panelHeight: surfaceHeight, candidateHeight: 0, candidateInputHeight: 0 }
  applyDeviceKeyboardGeometryFn(width, surfaceHeight, 0, 0)
  return true
}
