// Palm and Sogou documents are drawn from their own files. A Palm canvas reads skin.json for
// everything: the board's size, keys and states, the candidate bar, the styles, animations and hint
// bubbles. A Sogou canvas lists the keys of Sogou's official skeleton (the skin has no layout) and
// paints phoneSkin.ini onto them.

import { AtlasResolver, type TextVisual } from "../atlas.ts"
import { inputBarMetrics } from "../candidate-style.ts"
import { IniDocument } from "../ini.ts"
import type { NativeScene, SceneLayer } from "../native-scene.ts"
import { PalmBoard, type PalmOrientation, type PalmTheme } from "../palm/palm-board.ts"
import { palmBoardScene, palmCandidateScene, palmHint } from "../palm/palm-scene.ts"
import type { PalmStyles } from "../palm/palm-styles.ts"
import { PalmMotion } from "../palm/palm-motion.ts"
import type { Json } from "../palm/sxi-ini.ts"
import type { SkinArchive } from "../skin.ts"
import type { SsfTheme } from "../ssf/ssf-package.ts"
import { animateSsfScene } from "../ssf/ssf-motion.ts"
import { SsfStyles, ssfBoardScene, ssfCandidateScene } from "../ssf/ssf-scene.ts"
import { visualResolver } from "./bda-documents"
import { candidateBackgroundPreview, preview, toolbarPreview } from "./canvas-interaction"
import { applyCandidateSpacing, hideCandidateInputBar, showCandidateInputBar, toolbarConfigPath } from "./config-context"
import { candidateArea, candidateBackgroundCanvas, candidateInput, candidateWords, hintPreviewEnabled, theme as themeInput, toolbarCanvas, toolbarStrip } from "./dom"
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
  preview.setDocument(undefined)
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

function ssfScenes(archive: SkinArchive): boolean {
  const template = appState.ssfTemplates?.sogou
  const match = appState.layoutPath.match(/^(light|dark)\/skin\/(port|land)\/([^/]+)\.ini$/)
  const layout = appState.layoutDocument
  if (!template || !match || !layout) return false
  const [, theme, orientation, name] = match
  const templatePath = (file: string) => `light/skin/${orientation}/${file}`
  const templateText = (file: string) => template.isText(templatePath(file)) ? IniDocument.parse(template.getText(templatePath(file))) : undefined
  const templateLayout = templateText(`${name}.ini`)
  if (!templateLayout) return false
  const pkg = ssfDocumentPackage(archive)
  const styles = new SsfStyles(archive, pkg, theme as SsfTheme)
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
    .then((scene) => animateSsfScene(scene, styles, layout, name, orientation === "land", popups)))
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
export function refreshNativeScenes(): void {
  const archive = appState.archive
  for (const canvas of [preview, toolbarPreview, candidateBackgroundPreview]) canvas.setNativeItems(undefined)
  if (archive?.format === "ssf" && ssfScenes(archive)) return
  for (const canvas of [preview, toolbarPreview, candidateBackgroundPreview]) canvas.setScene(undefined)
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
      ...look.weight ? { bold: look.weight >= 700 } : {},
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
