import { IniDocument } from "./ini.ts"
import { type PreviewItem } from "./preview-items.ts"
import { actionText } from "./skin-model/inspect.ts"
import type { KeyEvent } from "./skin-model/types.ts"

export type LegacyHintIcon = {
  backStyle: string
  foreStyle: string
  size: readonly [number, number]
  position: readonly [number, number]
  padding: readonly [number, number, number, number]
  cellStyle?: string
  cellSize?: readonly [number, number]
}

export type LegacyHint = {
  icons: Map<string, LegacyHintIcon>
  upIcon?: string
  downIcon?: string
  leftIcon?: string
  rightIcon?: string
  holdIcon?: string
  barIcon?: string
  arrowIcon?: string
  cellStyle?: string
  cellSize?: readonly [number, number]
  defaultCandidates?: boolean
}

function fixedNumberTuple(value: string | undefined, length: number): number[] | undefined {
  const parts = value?.split(",").map((part) => Number(part.trim()))
  return parts?.length === length && parts.every(Number.isFinite) ? parts : undefined
}

export function parseLegacyHint(document: IniDocument | undefined): LegacyHint | undefined {
  if (!document) return
  const icons = new Map<string, LegacyHintIcon>()
  for (const section of document.sections()) {
    const id = section.match(/^ICON(.+)$/i)?.[1]
    if (!id) continue
    const size = fixedNumberTuple(document.get(section, "SIZE"), 2)
    if (!size || size[0] <= 0 || size[1] <= 0) continue
    const position = fixedNumberTuple(document.get(section, "POS"), 2) ?? [0, 0]
    const padding = fixedNumberTuple(document.get(section, "PADDING"), 4) ?? [0, 0, 0, 0]
    icons.set(id, {
      backStyle: document.get(section, "BACK_STYLE") ?? "",
      foreStyle: document.get(section, "FORE_STYLE") ?? "",
      size: size as [number, number],
      position: position as [number, number],
      padding: padding as [number, number, number, number],
    })
  }
  if (!icons.size) return
  return {
    icons,
    upIcon: document.get("DRAW", "ICON_UP"),
    downIcon: document.get("DRAW", "ICON_DN"),
    leftIcon: document.get("DRAW", "ICON_LT"),
    rightIcon: document.get("DRAW", "ICON_RT"),
    holdIcon: document.get("HINT", "BACK_ICON"),
    barIcon: document.get("BAR", "BACK_ICON"),
    arrowIcon: document.get("BAR", "ARROW_ICON"),
    cellStyle: document.get("BAR", "CELL_STYLE"),
    cellSize: fixedNumberTuple(document.get("BAR", "CELL_SIZE"), 2) as [number, number] | undefined,
  }
}

export function legacyHintIconID(
  hint: LegacyHint | undefined,
  direction: "center" | "up" | "down" | "left" | "right" | "hold",
): string | undefined {
  if (!hint) return
  if (direction === "center") return hint.holdIcon
  if (direction === "hold") return hint.holdIcon
  return {
    up: hint.upIcon,
    down: hint.downIcon,
    left: hint.leftIcon,
    right: hint.rightIcon,
  }[direction]
}

/** 提示要用到的按键信息：段名、各方向的动作文本、长按符号集。 */
export type HintKey = {
  section: string
  center: string
  up: string
  down: string
  left: string
  right: string
  hold: string
  holdSymbols: string
}

/** 从一个渲染项取出提示需要的那几个动作。 */
export function hintKeyOf(key: PreviewItem): HintKey {
  const text = (event: KeyEvent): string => actionText(key.key.actions?.[event]) ?? ""
  return {
    section: key.section,
    center: text("press"),
    up: text("swipe-up"),
    down: text("swipe-down"),
    left: text("swipe-left"),
    right: text("swipe-right"),
    hold: text("long-press"),
    holdSymbols: key.key.holdSymbol ?? "",
  }
}

/** 状态键在某个方向上的文本：动作从 IR 的动作表取，长按符号从按键上取。 */
export function legacyHintText(
  key: HintKey,
  direction: "center" | "up" | "down" | "left" | "right" | "hold",
): string {
  if (direction === "hold") {
    return key.holdSymbols || hintActionText(key.hold)
  }
  return hintActionText(key[direction])
}

function hintActionText(value: string): string {
  return /^(?:F\d+|S\d+(?:_\d+)?|Z\+.+)$/i.test(value.trim()) ? "" : value
}

export function isLegacyHintInputKey(key: HintKey): boolean {
  return /^KEY\d+$/i.test(key.section) && Boolean(hintActionText(key.center).trim())
}

export function legacyHintCandidates(
  key: HintKey,
  direction: "up" | "hold",
  defaults = false,
): string[] {
  if (defaults && direction === "hold" && !key.holdSymbols && !key.hold) {
    const letters = [key.left, key.center, key.right, key.down].filter((value) => /^[a-z]$/i.test(value))
    return letters.length > 1 && /^\d$/.test(key.up)
      ? [...new Set([...letters.map((value) => value.toUpperCase()), key.up, ...letters.map((value) => value.toLowerCase())])]
      : [...new Set([key.center.toUpperCase(), key.up, key.left, key.center, key.right, key.down].filter((value) => hintActionText(value)))]
  }
  const values = direction === "up"
    ? [key.up, key.left, key.center, key.right, key.down]
    // HOLDSYM 是无分隔符的字符集（工具书 V6 p154），"," 和 "|" 本身也是候选字符。
    : key.holdSymbols ? [...key.holdSymbols] : [key.hold]
  return [...new Set(values.filter((value) => hintActionText(value)))]
}

export function legacyHintHasHold(key: HintKey, hint: LegacyHint | undefined, defaults: boolean): boolean {
  return Boolean(key.hold || key.holdSymbols || hint?.barIcon && isLegacyHintInputKey(key) && legacyHintCandidates(key, "hold", defaults).length)
}

export function legacyHintSelectedIndex(key: HintKey, candidates: readonly string[]): number {
  const hasHold = Boolean(key.hold || key.holdSymbols)
  return !hasHold && /^\d$/.test(key.up) && candidates.includes(key.up)
    ? candidates.indexOf(key.up)
    : Math.max(0, candidates.lastIndexOf(key.center))
}
