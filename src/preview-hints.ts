import { IniDocument } from "./ini.ts"
import { type PreviewItem } from "./preview-items.ts"

export type LegacyHintIcon = {
  backStyle: string
  foreStyle: string
  size: readonly [number, number]
  position: readonly [number, number]
  padding: readonly [number, number, number, number]
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
  }
}

export function legacyHintIconID(
  hint: LegacyHint | undefined,
  direction: "center" | "up" | "down" | "left" | "right" | "hold",
): string | undefined {
  if (!hint) return
  if (direction === "center") return hint.holdIcon ?? hint.upIcon
  if (direction === "hold") return hint.holdIcon
  return {
    up: hint.upIcon,
    down: hint.downIcon,
    left: hint.leftIcon,
    right: hint.rightIcon,
  }[direction]
}

export function legacyHintText(
  key: Pick<PreviewItem, "up" | "down" | "left" | "right" | "center" | "hold" | "holdSymbols">,
  direction: "center" | "up" | "down" | "left" | "right" | "hold",
): string {
  if (direction === "hold") {
    return key.holdSymbols || (/^F\d+$/i.test(key.hold) ? "" : key.hold)
  }
  return !/^F\d+$/i.test(key[direction]) ? key[direction] : ""
}

export function isLegacyHintInputKey(key: Pick<PreviewItem, "section" | "center">): boolean {
  return /^KEY\d+$/i.test(key.section) && Boolean(key.center.trim()) && !/^F\d+$/i.test(key.center.trim())
}

export function legacyHintCandidates(
  key: Pick<PreviewItem, "up" | "down" | "left" | "right" | "center" | "hold" | "holdSymbols">,
  direction: "up" | "hold",
  bda = false,
): string[] {
  if (bda && direction === "hold" && !key.holdSymbols && !key.hold) {
    const letters = [key.left, key.center, key.right]
      .filter((value) => /^[a-z]$/i.test(value))
    return letters.length > 1 && /^\d$/.test(key.up)
      ? [...new Set([...letters.map((value) => value.toLowerCase()), key.up, ...letters.map((value) => value.toUpperCase())])]
      : [...new Set([key.center.toUpperCase(), key.up, key.center].filter((value) => value && !/^F\d+$/i.test(value)))]
  }
  const values = direction === "up"
    ? [key.up, key.left, key.center, key.right, key.down]
    // HOLDSYM 是无分隔符的字符集（工具书 V6 p154），"," 和 "|" 本身也是候选字符。
    : [...key.holdSymbols || key.hold]
  return [...new Set(values.filter((value) => value && !/^F\d+$/i.test(value)))]
}
