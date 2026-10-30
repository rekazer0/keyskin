import { stateStyleValue, stateTipSection } from "./panel-tools.ts"
import { IniDocument } from "./ini.ts"
import { skinStateFallbackText } from "./actions.ts"
import { DEFAULT_PANEL_WIDTH, DEFAULT_CANDIDATE_HEIGHT } from "./keyboard.ts"

export type Rect = { x: number; y: number; width: number; height: number }

export type PreviewItem = {
  section: string
  sections: string[]
  rect: Rect
  touchRect?: Rect | null
  foreRect?: Rect
  // PADDING 左,上,右,下：背景和前景画在 rect 往里缩后的区域，选中和触摸仍按 rect
  padding?: readonly [number, number, number, number]
  editable: boolean
  show: string
  center: string
  up: string
  down: string
  left: string
  right: string
  hold: string
  holdSymbols: string
  backStyle: string
  highlightBackStyle?: string
  foreStyle: string
  foreStyles: string[]
  foreOffsets: Array<[number, number] | undefined>
  positionTypes: string[]
  statStyle: string
  animStyle?: string
  backAnimStyle?: string
  foreAnimStyle?: string
  foreAnimStyles: string[]
  /** PRESS_STYLE：按下时整键的按压效果样式（如粒子），与 ANIM_STYLE 系列一同播放。 */
  pressStyle?: string
}

/** Styles whose PRESS_ANIM plays when the key is pressed. */
export function keyAnimationStyles(key: PreviewItem): string[] {
  return [key.animStyle, key.backAnimStyle, ...key.foreAnimStyles, key.pressStyle].filter((style): style is string => Boolean(style))
}

function duplicateKeySignature(item: PreviewItem): string | undefined {
  if (!item.editable || !/^KEY\d+$/i.test(item.section)) return
  const actions = [item.show, item.center, item.up, item.down, item.left, item.right, item.hold]
  if (!actions.some(Boolean)) return
  return [item.rect.x, item.rect.y, item.rect.width, item.rect.height, ...actions].join("\u0000")
}

export function visiblePreviewItems(
  items: readonly PreviewItem[],
  state?: number,
): PreviewItem[] {
  const groups = new Map<string, PreviewItem[]>()
  for (const item of items) {
    const signature = duplicateKeySignature(item)
    if (signature) groups.set(signature, [...(groups.get(signature) ?? []), item])
  }
  const handled = new Set<PreviewItem>()
  const visible: PreviewItem[] = []
  for (const item of items) {
    if (handled.has(item)) continue
    const signature = duplicateKeySignature(item)
    const group = signature ? groups.get(signature) ?? [item] : [item]
    const stateGroup = group.filter((candidate) => candidate.statStyle)
    const fallbackGroup = group.filter((candidate) => !candidate.statStyle)
    if (stateGroup.length && fallbackGroup.length) {
      group.forEach((candidate) => handled.add(candidate))
      const selected = stateGroup.find((candidate) =>
        stateTipSection(candidate.statStyle, state) !== undefined
      ) ?? fallbackGroup[0] ?? stateGroup[0]
      visible.push({
        ...selected,
        sections: group.flatMap((candidate) => candidate.sections),
      })
    } else {
      handled.add(item)
      visible.push(item)
    }
  }
  return visible
}

export function effectivePreviewItem(
  document: IniDocument,
  item: PreviewItem,
  state?: number,
): PreviewItem {
  const tip = stateTipSection(item.statStyle, state)
  if (tip === undefined) return item
  const section = `TIP${tip}`
  const hasTip = document.sections().includes(section)
  const fallbackText = hasTip ? undefined : skinStateFallbackText(state)
  if (fallbackText) {
    return {
      ...item,
      show: fallbackText,
      foreStyle: "",
      foreStyles: [],
      foreOffsets: [],
      positionTypes: [],
      foreAnimStyle: undefined,
      foreAnimStyles: [],
    }
  }
  const value = (name: string): string | undefined => document.get(section, name)
  const backStyle = value("BACK_STYLE")
  const foreStyle = value("FORE_STYLE")
  const positionType = value("POS_TYPE")
  const foreOffset = value("FORE_OFFSET")
  const foreAnimStyle = value("FORE_ANIM_STYLE")
  const backAnimStyle = value("BACK_ANIM_STYLE")
  const animStyle = value("ANIM_STYLE")
  const centerValue = (/^ICON\d+$/i.test(item.section) ? value("KEY") : undefined) ?? value("CENTER")
  const center = centerValue ?? item.center
  const down = value("DOWN") ?? (centerValue === undefined ? item.down : center)
  const foreStyles = foreStyle === undefined
    ? item.foreStyles
    : foreStyle.split(",").map((token) => token.trim()).filter(Boolean)
  return {
    ...item,
    show: value("SHOW") ?? item.show,
    center,
    up: value("UP") ?? item.up,
    down,
    left: value("LEFT") ?? item.left,
    right: value("RIGHT") ?? item.right,
    hold: value("HOLD") ?? item.hold,
    holdSymbols: value("HOLDSYM") ?? item.holdSymbols,
    backStyle: backStyle === undefined ? item.backStyle : backStyle.split(",")[0],
    highlightBackStyle: value("HL_BACK_STYLE")?.split(",")[0] ?? item.highlightBackStyle,
    foreStyle: foreStyles[0] ?? "",
    foreStyles,
    foreOffsets: foreOffset === undefined
      ? item.foreOffsets
      : foreOffset.split(";").map(parseOffset),
    positionTypes: positionType === undefined
      ? item.positionTypes
      : positionType.split(",").map((token) => token.trim()).filter(Boolean),
    animStyle: animStyle ?? item.animStyle,
    pressStyle: value("PRESS_STYLE") ?? item.pressStyle,
    backAnimStyle: backAnimStyle ?? item.backAnimStyle,
    foreAnimStyle: foreAnimStyle === undefined
      ? item.foreAnimStyle
      : foreAnimStyle.split(",")[0],
    foreAnimStyles: foreAnimStyle === undefined
      ? item.foreAnimStyles
      : foreAnimStyle.split(",").map((token) => token.trim()).filter(Boolean),
  }
}

export function previewStateImpact(
  document: IniDocument | undefined,
  state: number | undefined,
): { mapped: boolean; resolved: boolean } {
  if (!document || state === undefined) return { mapped: false, resolved: false }
  const tips = document.entries().flatMap(({ key, value }) => {
    if (key !== "STAT_STYLE") return []
    const tip = stateStyleValue(value, state)
    return tip === undefined ? [] : [tip]
  })
  if (!tips.length) return { mapped: false, resolved: false }
  const sections = new Set(document.sections())
  return {
    mapped: true,
    resolved: Boolean(skinStateFallbackText(state)) || tips.some((tip) => sections.has(`TIP${tip}`)),
  }
}

function previewBackground(theme: "light" | "dark"): string {
  return theme === "dark" ? "#1c1c1e" : "#d1d4da"
}

export function previewSurfaceColor(theme: "light" | "dark", transparent: boolean): string | undefined {
  return transparent ? undefined : previewBackground(theme)
}

export function isFullPanelPreviewItem(
  item: Pick<PreviewItem, "rect">,
  panelWidth: number,
  panelHeight: number,
): boolean {
  return item.rect.x <= 0 && item.rect.y <= 0 &&
    item.rect.x + item.rect.width >= panelWidth &&
    item.rect.y + item.rect.height >= panelHeight
}

export function previewDrawOrder(
  items: readonly PreviewItem[],
  panelWidth: number,
  panelHeight: number,
  topSection?: string,
): PreviewItem[] {
  const layer = (item: PreviewItem) => item.section === topSection
    ? 2
    : isFullPanelPreviewItem(item, panelWidth, panelHeight) ? 0 : 1
  return [...items].sort((left, right) => layer(left) - layer(right))
}

export function shouldDrawItemBackground(
  item: PreviewItem,
  panelStyle: string,
  panelWidth: number,
  panelHeight: number,
): boolean {
  return !(item.backStyle === panelStyle && isFullPanelPreviewItem(item, panelWidth, panelHeight))
}

export function previewHitItem(
  items: readonly PreviewItem[],
  point: { x: number; y: number },
  mode: "edit" | "preview",
  panelWidth: number,
  panelHeight: number,
  state?: number,
): PreviewItem | undefined {
  let best: PreviewItem | undefined
  let fallback: PreviewItem | undefined
  for (const item of [...visiblePreviewItems(items, state)].reverse()) {
    if (!item.editable) continue
    const target = previewHitRect(item, mode)
    if (!target) continue
    if (
      point.x < target.x ||
      point.x > target.x + target.width ||
      point.y < target.y ||
      point.y > target.y + target.height
    ) continue
    if (isFullPanelPreviewItem(item, panelWidth, panelHeight)) {
      fallback ??= item
      continue
    }
    const area = item.rect.width * item.rect.height
    const bestArea = best ? best.rect.width * best.rect.height : Infinity
    if (area < bestArea) best = item
  }
  return best ?? fallback
}

export function effectivePreviewHitItem(
  document: IniDocument,
  items: readonly PreviewItem[],
  point: { x: number; y: number },
  mode: "edit" | "preview",
  panelWidth: number,
  panelHeight: number,
  state?: number,
): PreviewItem | undefined {
  const item = previewHitItem(items, point, mode, panelWidth, panelHeight, state)
  if (!item || mode === "edit") return item
  return effectivePreviewItem(document, item, state)
}

export function previewSelectionVisible(mode: "edit" | "preview", selected: boolean): boolean {
  return mode === "edit" && selected
}

export function previewFallbackText(
  item: PreviewItem,
  hasForeground: boolean,
): string {
  return !hasForeground && item.section?.startsWith("LIST:") ? item.show : ""
}

export function isAdditiveSelection(
  event: Pick<MouseEvent, "metaKey" | "ctrlKey" | "shiftKey">,
): boolean {
  return event.metaKey || event.ctrlKey || event.shiftKey
}

export function isTouchLongPress(pointerType: string, duration: number, distance: number): boolean {
  return pointerType === "touch" && duration >= 450 && distance <= 12
}

function previewHitRect(item: PreviewItem, mode: "edit" | "preview"): Rect | undefined {
  if (mode === "edit") return item.rect
  return item.touchRect === null ? undefined : item.touchRect ?? item.rect
}

export function parseRect(value: string | undefined): Rect | undefined {
  const parts = value?.split(",").map(Number)
  if (!parts || parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return
  const [x, y, width, height] = parts
  if (width <= 0 || height <= 0) return
  return { x, y, width, height }
}

function parseTouchRect(value: string | undefined): Rect | null | undefined {
  if (value === undefined) return
  const parts = value.split(",").map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return
  const [x, y, width, height] = parts
  return width <= 0 || height <= 0 ? null : { x, y, width, height }
}

function parsePadding(value: string | undefined): [number, number, number, number] | undefined {
  const parts = value?.split(",").map(Number)
  if (parts?.length !== 4 || parts.some((part) => !Number.isFinite(part))) return
  return parts as [number, number, number, number]
}

export function paddedRect(item: PreviewItem): Rect {
  const { rect, padding } = item
  if (!padding) return rect
  const [left, top, right, bottom] = padding
  return {
    x: rect.x + left,
    y: rect.y + top,
    width: Math.max(0, rect.width - left - right),
    height: Math.max(0, rect.height - top - bottom),
  }
}

export function parseOffset(value: string | undefined): [number, number] | undefined {
  const parts = value?.split(",").map(Number)
  if (!parts || parts.length !== 2 || parts.some((part) => !Number.isFinite(part))) return
  return parts as [number, number]
}

function previewItemSections(document: IniDocument, section: string): string[] {
  if (!/^ICON\d+$/i.test(section)) return [section]
  const tips = [...(document.get(section, "STAT_STYLE") ?? "").matchAll(/(?:^|\|)S\d+_(\d+)(?=\||$)/g)]
    .map((match) => `TIP${match[1]}`)
    .filter((tip, index, values) => document.sections().includes(tip) && values.indexOf(tip) === index)
  return [section, ...tips]
}

// Baidu RelativeOffsetParam uses percentages of the key, truncated toward zero.
export function offsetFromSection(document: IniDocument | undefined, section: string, rect: Pick<Rect, "width" | "height">): [number, number] | undefined {
  if (!document) return
  const absolute = parseOffset(document.get(section, "POS"))
  if (absolute) return absolute
  const relative = parseOffset(document.get(section, "R_POS"))
  return relative && [Math.trunc(rect.width * relative[0] / 100), Math.trunc(rect.height * relative[1] / 100)]
}

function itemFromSection(document: IniDocument, section: string): PreviewItem | undefined {
  const rect = parseRect(document.get(section, "VIEW_RECT"))
  if (!rect) return
  const value = (name: string) => document.get(section, name) ?? ""
  // CAND.FORE_STYLE styles runtime candidate words; it is not a static
  // foreground for the whole candidate bar.
  const foreStyles = section === "CAND"
    ? []
    : value("FORE_STYLE").split(",").map((token) => token.trim()).filter(Boolean)
  const center = value("CENTER") || value("KEY")
  const down = value("DOWN") || center
  return {
    section,
    sections: previewItemSections(document, section),
    rect,
    touchRect: parseTouchRect(document.get(section, "TOUCH_RECT")),
    padding: parsePadding(document.get(section, "PADDING")),
    editable: true,
    show: value("SHOW"),
    center,
    up: value("UP"),
    down,
    left: value("LEFT"),
    right: value("RIGHT"),
    hold: value("HOLD"),
    holdSymbols: value("HOLDSYM"),
    backStyle: value("BACK_STYLE").split(",")[0],
    highlightBackStyle: value("HL_BACK_STYLE").split(",")[0] || undefined,
    foreStyle: foreStyles[0] ?? "",
    foreStyles,
    foreOffsets: value("FORE_OFFSET").split(";").map(parseOffset),
    positionTypes: value("POS_TYPE").split(",").map((token) => token.trim()).filter(Boolean),
    statStyle: value("STAT_STYLE"),
    animStyle: value("ANIM_STYLE"),
    pressStyle: value("PRESS_STYLE"),
    backAnimStyle: value("BACK_ANIM_STYLE"),
    foreAnimStyle: value("FORE_ANIM_STYLE").split(",")[0],
    foreAnimStyles: value("FORE_ANIM_STYLE").split(",").map((token) => token.trim()).filter(Boolean),
  }
}

function listItems(document: IniDocument, defaults?: IniDocument): PreviewItem[] {
  const value = (name: string) => document.get("LIST", name) ?? defaults?.get("LIST", name)
  const type = value("TYPE")?.trim()
  // TYPE=2 is the runtime scrolling-list container used by some Android skins.
  // It is not a static key/candidate strip and must not be painted over the
  // keyboard in the preview. TYPE=0, missing TYPE, and other legacy values
  // remain renderable for compatibility with existing skins.
  if (type === "2") return []
  const cell = value("CELL_SIZE")?.split(",").map(Number)
  const position = value("POS")?.split(",").map(Number)
  const count = Number(value("LIST_NUM"))
  const names = value("NAMES")?.trim().split(/\s+/) ?? []
  if (
    !cell || cell.length !== 2 || cell.some((value) => !Number.isFinite(value) || value <= 0) ||
    !position || position.length !== 2 || position.some((value) => !Number.isFinite(value)) ||
    !Number.isFinite(count) || count <= 0
  ) return []
  const horizontal = value("LIST_ORDER")?.trim() === "1"
  const foreStyles = value("FORE_STYLE")?.split(",").map((token) => token.trim()).filter(Boolean) ?? []
  // 每个标点只负责文字渲染，不可单独选中
  const cells: PreviewItem[] = names.slice(0, count).map((show, index) => ({
    section: `LIST:${index + 1}`,
    sections: [`LIST:${index + 1}`],
    rect: {
      x: position[0] + (horizontal ? index * cell[0] : 0),
      y: position[1] + (horizontal ? 0 : index * cell[1]),
      width: cell[0],
      height: cell[1],
    },
    editable: false,
    show,
    center: "",
    up: "",
    down: "",
    left: "",
    right: "",
    hold: "",
    holdSymbols: "",
    backStyle: value("CELL_STYLE")?.split(",")[0] ?? "",
    foreStyle: foreStyles[0] ?? "",
    foreStyles,
    foreOffsets: [],
    positionTypes: [],
    statStyle: "",
    foreAnimStyles: [],
  }))
  // 整个候选栏是一个可选中按钮
  const bar: PreviewItem = {
    section: "LIST",
    sections: ["LIST"],
    rect: {
      x: position[0],
      y: position[1],
      width: cell[0] * (horizontal ? count : 1),
      height: cell[1] * (horizontal ? 1 : count),
    },
    editable: true,
    show: "",
    center: "",
    up: "",
    down: "",
    left: "",
    right: "",
    hold: "",
    holdSymbols: "",
    backStyle: value("BACK_STYLE")?.split(",")[0] ?? "",
    foreStyle: "",
    foreStyles: [],
    foreOffsets: [],
    positionTypes: [],
    statStyle: "",
    foreAnimStyles: [],
  }
  return [bar, ...cells]
}

export function dynamicToolbarRect(
  document: IniDocument,
  panelWidth: number,
  panelHeight: number,
): Rect | undefined {
  const section = document.sections().find((name) =>
    /^ICON\d+$/i.test(name) && document.get(name, "KEY")?.trim().toUpperCase() === "F14"
  )
  if (!section) return
  const size = document.get(section, "SIZE")?.split(",").map(Number)
  const position = document.get(section, "POS")?.split(",").map(Number)
  const anchor = Number(document.get(section, "ANCHOR_TYPE"))
  if (
    !size || size.length !== 2 || size.some((value) => !Number.isFinite(value) || value <= 0) ||
    !position || position.length !== 2 || position.some((value) => !Number.isFinite(value))
  ) return
  const column = ((anchor - 1) % 3) + 1
  const row = Math.ceil(anchor / 3)
  return {
    x: (column === 2 ? panelWidth / 2 : column === 3 ? panelWidth : 0) + position[0],
    y: (row === 2 ? panelHeight / 2 : row === 3 ? panelHeight : 0) + position[1],
    width: size[0],
    height: size[1],
  }
}

// PERSIST（工具书 V6 p158）：0 都不显示，1 无候选字时，2 有候选字时，3 都显示；未写按 1。
export function persistVisible(persist: string | undefined, composing: boolean): boolean {
  const value = persist?.trim()
  if (value === "0") return false
  if (value === "3") return true
  return composing === (value === "2")
}

export function previewItems(
  document: IniDocument,
  panelWidth = DEFAULT_PANEL_WIDTH,
  panelHeight = DEFAULT_CANDIDATE_HEIGHT,
  defaults?: IniDocument,
  persistentOnly = false,
): PreviewItem[] {
  const list = persistentOnly || !document.sections().includes("LIST")
    ? []
    : listItems(document, defaults)
  const real = document.sections().flatMap((section) => {
    if (/^TIP\d+$/i.test(section)) return []
    if (!persistVisible(document.get(section, "PERSIST"), persistentOnly)) return []
    const item = itemFromSection(document, section)
    return item ? [item] : []
  })
  if (real.length) return [...real, ...list]

  const sections = document.sections().filter((section) =>
    /^(CAND|SWITCH|PANEL|LIST|MORE|ICON\d+|TIP\d+)$/.test(section),
  )
  if (!sections.length) return list
  return [...sections.flatMap((section) => {
    if (
      /^TIP\d+$/.test(section) ||
      !persistVisible(document.get(section, "PERSIST"), persistentOnly)
    ) return []
    const backStyle = document.get(section, "BACK_STYLE")?.split(",")[0] ?? ""
    // CAND.FORE_STYLE styles runtime candidate words; it is not a static
    // foreground for the whole candidate bar.
    const foreStyles = section === "CAND"
      ? []
      : document.get(section, "FORE_STYLE")?.split(",").map((token) => token.trim()).filter(Boolean) ?? []
    const foreStyle = foreStyles[0] ?? ""
    if (
      section !== "CAND" &&
      (!document.get(section, "SIZE") || (!/^ICON\d+$/i.test(section) && !backStyle && !foreStyle))
    ) return []
    const size = document.get(section, "SIZE")?.split(",").map(Number)
    const width = section === "CAND" ? panelWidth : size?.[0] ?? 0
    const height = section === "CAND" ? panelHeight : size?.[1] ?? 0
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return []
    const position = document.get(section, "POS")?.split(",").map(Number) ?? [0, 0]
    const anchor = Number(document.get(section, "ANCHOR_TYPE"))
    const xAnchor = ((anchor - 1) % 3) + 1
    const yAnchor = Math.ceil(anchor / 3)
    const x = section === "CAND"
      ? 0
      : xAnchor === 2
        ? panelWidth / 2 + (position[0] || 0)
        : xAnchor === 3
          ? panelWidth + (position[0] || 0)
          : position[0] || 0
    const y = section === "CAND"
      ? 0
      : yAnchor === 2
        ? panelHeight / 2 + (position[1] || 0)
        : yAnchor === 3
          ? panelHeight + (position[1] || 0)
          : position[1] || 0
    // iOS stores FIX_SIZE in points; skin geometry and @3x artwork use pixels (V6 p158).
    const fixed = document.get(section, "FIX_SIZE")?.split(",").map((value) => Number(value) * 3)
    const foreRect = fixed?.length === 2 && fixed.every(Number.isFinite)
      ? {
          x: x + (width - fixed[0]) / 2,
          y: y + (height - fixed[1]) / 2,
          width: fixed[0],
          height: fixed[1],
        }
      : undefined
    const value = (name: string) => document.get(section, name) ?? ""
    return [{
      section,
      sections: previewItemSections(document, section),
      rect: { x, y, width, height },
      foreRect,
      editable: /^ICON\d+$/i.test(section),
      show: document.get(section, "SHOW") ?? "",
      center: value("KEY") || value("CENTER"),
      up: value("UP"),
      down: value("DOWN"),
      left: value("LEFT"),
      right: value("RIGHT"),
      hold: value("HOLD"),
      holdSymbols: value("HOLDSYM"),
      backStyle,
      highlightBackStyle: value("HL_BACK_STYLE").split(",")[0] || undefined,
      foreStyle,
      foreStyles,
      foreOffsets: [],
      positionTypes: document.get(section, "POS_TYPE")?.split(",").map((token) => token.trim()).filter(Boolean) ?? [],
      statStyle: value("STAT_STYLE"),
      animStyle: value("ANIM_STYLE"),
      pressStyle: value("PRESS_STYLE"),
      backAnimStyle: value("BACK_ANIM_STYLE"),
      foreAnimStyle: value("FORE_ANIM_STYLE").split(",")[0],
      foreAnimStyles: value("FORE_ANIM_STYLE").split(",").map((token) => token.trim()).filter(Boolean),
    }]
  }), ...list]
}

export function previewContentVerticalBounds(
  items: readonly Pick<PreviewItem, "rect">[],
  panelWidth: number,
  panelHeight: number,
): { top: number; height: number } {
  const content = items.filter(({ rect }) =>
    rect.width > 0 && rect.height > 0 &&
    !(rect.x <= 0 && rect.y <= 0 && rect.width >= panelWidth && rect.height >= panelHeight),
  )
  if (!content.length) return { top: 0, height: panelHeight }
  const top = Math.max(0, Math.min(...content.map(({ rect }) => rect.y)))
  const bottom = Math.max(...content.map(({ rect }) => rect.y + rect.height))
  return { top, height: Math.max(1, bottom - top) }
}

/**
 * Height of the drawable preview surface. Some Android IMEs (e.g. the Xiaomi
 * default skin) place extra keys below PANEL.SIZE — the keyboard-switch and
 * clipboard buttons in the navigation bar area. Those keys are real, so the
 * surface grows to include them instead of clipping them off.
 */
export function previewSurfaceHeight(
  items: readonly Pick<PreviewItem, "section" | "rect">[],
  panelHeight: number,
): number {
  let bottom = panelHeight
  for (const { section, rect } of items) {
    if (!/^KEY\d+$/i.test(section) || rect.width <= 0 || rect.height <= 0) continue
    bottom = Math.max(bottom, rect.y + rect.height)
  }
  return Math.ceil(bottom)
}
