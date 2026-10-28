import type { TextVisual, VisualResolver } from "./atlas.ts"
import type { IniDocument } from "./ini.ts"
import { DEFAULT_CANDIDATE_HEIGHT, DEFAULT_PANEL_WIDTH } from "./keyboard.ts"

type CandidateRect = { x: number; y: number; width: number; height: number }

function candidateRect(document: IniDocument | undefined): CandidateRect | undefined {
  const values = document?.get("CAND", "VIEW_RECT")?.split(",").map(Number)
  if (!values || values.length !== 4 || values.some((value) => !Number.isFinite(value))) return
  const [x, y, width, height] = values
  return width > 0 && height > 0 ? { x, y, width, height } : undefined
}

export function resolveCandidateRect(
  candidate: IniDocument | undefined,
  general: IniDocument | undefined,
): CandidateRect {
  const configured = candidateRect(candidate) ?? candidateRect(general)
  if (configured) return configured
  const panelWidth = Number(general?.get("PANEL", "SIZE")?.split(",")[0])
  return {
    x: 0,
    y: 0,
    width: Number.isFinite(panelWidth) && panelWidth > 0 ? panelWidth : DEFAULT_PANEL_WIDTH,
    height: DEFAULT_CANDIDATE_HEIGHT,
  }
}

/** The density Baidu Android assumes a skin of this panel width was drawn for (`ImeBaseGlobal.d`). */
function skinDensity(width: number): number {
  return width <= 240 ? 0.75
    : width < 360 ? 1
    : width < 480 ? 1.2
    : width < 600 ? 1.5
    : width < 720 ? 2
    : width < 800 ? 2.25
    : width < 960 ? 2.5
    : width < 1080 ? 3
    : width < 1152 ? 3.3
    : width < 1280 ? 3.6
    : 4.4
}

/**
 * Baidu Android's input code bar (`InputBarView`), in skin units: `inset` is `ImeBaseGlobal.L`
 * (2.5dp), `textLeft` is where the code starts (6dp).
 */
export type InputBarMetrics = {
  height: number
  inset: number
  textLeft: number
}

type CandidateInputStyle = InputBarMetrics & { foregroundStyle: string }

/**
 * The bar's box: as wide as the code plus 6dp before and two insets after it; a code wider than
 * the panel fills it and shows its end, an inset from either edge.
 */
export function inputBarBox(
  textWidth: number,
  metrics: InputBarMetrics,
  panelWidth: number,
): { width: number; paddingStart: number; paddingEnd: number } {
  const width = metrics.textLeft + textWidth + metrics.inset * 2
  return width > panelWidth
    ? { width: panelWidth, paddingStart: metrics.inset, paddingEnd: metrics.inset }
    : { width, paddingStart: metrics.textLeft, paddingEnd: metrics.inset * 2 }
}

/** Candidate words: the bar's .cnd [CAND], then gen.ini [CAND] (Palm-exported skins keep it there), then SCAND. */
export function candidateWordsForeground(candidate: IniDocument | undefined, general: IniDocument | undefined): string {
  return candidate?.get("CAND", "FORE_STYLE") ?? general?.get("CAND", "FORE_STYLE") ?? general?.get("SCAND", "SCAND_STYLE") ?? ""
}

/** The first candidate's own style; without one it is drawn like the others. */
export function candidateFirstForeground(candidate: IniDocument | undefined, general: IniDocument | undefined): string {
  return candidate?.get("CAND", "FIRST_FORE") ?? general?.get("CAND", "FIRST_FORE") ?? ""
}

/** iOS sizes the in-keyboard input code from INPUT (its colour still comes from candidateInputForegroundStyle). */
export function candidateInputSizeForeground(general: IniDocument | undefined, candidate?: IniDocument): string {
  return [
    candidate?.get("CAND", "INPUT_STYLE"),
    candidate?.get("INPUT", "FORE_STYLE"),
    general?.get("INPUT", "FORE_STYLE"),
  ].map((value) => value?.trim() ?? "").find(Boolean) ?? ""
}

export function candidateInputForegroundStyle(
  general: IniDocument | undefined,
  candidate?: IniDocument,
): string {
  return [
    candidate?.get("CAND", "INPUT_STYLE"),
    candidate?.get("INPUT", "FORE_STYLE"),
    general?.get("SCAND", "INPUT_STYLE"),
    general?.get("INPUT", "FORE_STYLE"),
    general?.get("SCAND", "FORE_STYLE"),
  ].map((value) => value?.trim() ?? "").find(Boolean) ?? ""
}

export function resolveCandidateInputTextVisual(
  general: IniDocument | undefined,
  resolver: VisualResolver,
  candidate?: IniDocument,
  inKeyboard = false,
  skinFont = false,
): TextVisual | undefined {
  const visual = resolver.resolveText(candidateInputForegroundStyle(general, candidate), false)
  if (!visual) return
  // 和候选字一样，输入码文字在真机用用户字体（InputBarView/CandHandler），皮肤只提供字号与颜色；
  // 预览不能套 FONT_NAME，否则真机与画布不一致。
  const userFont = candidateUserFont(visual, skinFont)!
  if (!inKeyboard) return userFont
  const input = resolver.resolveText(candidateInputSizeForeground(general, candidate), false)
  // shortcut: iOS 的 INPUT 字号与 SCAND 颜色已按真机截图校准，取得 iOS 绘制代码后核对更多皮肤。
  return { ...input, ...userFont, fontSize: input?.fontSize ?? visual.fontSize }
}

/** iOS draws the inline row with SCAND; Android's popup uses INPUT. */
export function candidateInputBackgroundStyle(
  general: IniDocument | undefined,
  candidate?: IniDocument,
  inKeyboard = false,
): string {
  return [
    inKeyboard ? candidate?.get("SCAND", "BACK_STYLE") : undefined,
    candidate?.get("INPUT", "BACK_STYLE"),
    inKeyboard ? general?.get("SCAND", "BACK_STYLE") : undefined,
    general?.get("INPUT", "BACK_STYLE"),
  ].map((value) => value?.split(",")[0].trim() ?? "").find(Boolean) ?? ""
}

// 百度真机候选字使用用户字体（含字重），皮肤样式只提供字号与颜色。编辑器无法得知用户字体，
// 因此预览固定用系统字体，不能套用皮肤 FONT_NAME / FONT_PATH，否则会与真机不一致。
// 搜狗皮肤的 TYPEFACE 由皮肤自己指定（skinFont），照用。
function candidateUserFont(visual: TextVisual | undefined, skinFont: boolean): TextVisual | undefined {
  return visual && (skinFont ? visual : { ...visual, fontName: undefined })
}

export function resolveCandidateTextVisuals(
  candidate: IniDocument | undefined,
  general: IniDocument | undefined,
  resolver: VisualResolver,
  skinFont = false,
): { normal: TextVisual | undefined; first: TextVisual | undefined } {
  return {
    normal: candidateUserFont(resolver.resolveText(candidateWordsForeground(candidate, general), false), skinFont),
    first: candidateUserFont(resolver.resolveText(candidateFirstForeground(candidate, general), false), skinFont),
  }
}

export function resolveCandidateInputStyle(
  general: IniDocument | undefined,
  resolver: VisualResolver,
  width: number,
  candidate?: IniDocument,
  inKeyboard = false,
): CandidateInputStyle {
  const foregroundStyle = candidateInputForegroundStyle(general, candidate)
  const fontSize = resolveCandidateInputTextVisual(general, resolver, candidate, inKeyboard)?.fontSize
  const background = inKeyboard
    ? resolver.sourceSize?.(candidateInputBackgroundStyle(general, candidate, true), false)
    : undefined
  return { foregroundStyle, ...inputBarMetrics(fontSize, width, background) }
}

/** The bar for a code `fontSize` high; iOS's in-keyboard row takes a full-width background's height. */
export function inputBarMetrics(fontSize: number | undefined, width: number, background?: { width: number; height: number }): InputBarMetrics {
  if (!fontSize || fontSize <= 0) return { height: 0, inset: 0, textLeft: 0 }
  const density = skinDensity(width)
  const inset = Math.trunc(density * 2.5)
  const height = background?.width === width && background.height > 0 ? background.height : fontSize + inset * 2
  return { height, inset, textLeft: Math.trunc(density * 6) }
}
