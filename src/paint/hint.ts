// 长按/滑动提示气泡：一条柱状候选或单字气泡，画在按键上方。
//
// 位置、尺寸与候选都来自格式已解析好的数据；样式与位图由调用方从模型取好，这里只负责摆位与画字。
import { canvasFontFamily } from "../atlas.ts"
import type { LayerPaint } from "./key.ts"
import { paintLayer } from "./layer.ts"
import { colorCss, type TextStyle } from "../skin-model/style.ts"
import type { HintKey } from "../preview-hints.ts"
import { legacyHintSelectedIndex, legacyHintText } from "../preview-hints.ts"

export type HintRect = { x: number; y: number; width: number; height: number }

export type HintPaintData = {
  /** 气泡图的尺寸、相对按键的偏移与内边距。 */
  size: readonly [number, number]
  position: readonly [number, number]
  padding: readonly [number, number, number, number]
  background?: LayerPaint
  foreground?: LayerPaint
  candidates: readonly string[]
  /** 单元格的常态图与选中图。 */
  cellVisuals: readonly (LayerPaint | undefined)[]
  textStyle?: TextStyle
  selectedTextStyle?: TextStyle
  cellSize?: readonly [number, number]
  direction: "center" | "up" | "down" | "left" | "right" | "hold"
  /** 柱状候选：一条里排多个字；否则只画一个字。 */
  bar: boolean
  panelWidth: number
  dark: boolean
}

function fontCss(style: TextStyle | undefined, size: number): string {
  return `${style?.weight ? `${style.weight} ` : ""}${size}px ${canvasFontFamily(style?.font)}`
}

/** 气泡的宽度与格子宽度；柱状才按候选数铺开，单字气泡用基准宽。 */
function hintBarWidth(data: HintPaintData): { width: number; cellWidth: number } {
  const [baseWidth] = data.size
  const [left, , right] = data.padding
  const desiredCellWidth = data.cellSize?.[0] && data.cellSize[0] > 0
    ? data.cellSize[0]
    : Math.max(data.panelWidth / 14, data.textStyle?.fontSize ?? 0, data.cellVisuals[1]?.bitmap?.width ?? 0)
  const width = data.bar
    ? Math.min(data.panelWidth, Math.max(baseWidth, left + right + data.candidates.length * desiredCellWidth))
    : baseWidth
  return { width, cellWidth: data.bar ? (width - left - right) / data.candidates.length : desiredCellWidth }
}

/** 柱状候选的格子宽度；指针事件按它算命中，非柱状没有格子。 */
export function hintCellWidth(data: HintPaintData): number | undefined {
  if (!data.bar || !data.candidates.length) return undefined
  return hintBarWidth(data).cellWidth
}

/** 画一次气泡；`anchor` 是气泡所属按键的矩形。 */
export function paintHintBubble(
  context: CanvasRenderingContext2D,
  key: HintKey,
  anchor: HintRect,
  data: HintPaintData,
): void {
  const [, height] = data.size
  const [offsetX, offsetY] = data.position
  const [left, top, right, bottom] = data.padding
  const { width, cellWidth } = hintBarWidth(data)
  const x = Math.max(0, Math.min(data.panelWidth - width, anchor.x + (anchor.width - width) / 2 + offsetX))
  // 九键长按时数字键的气泡要挂在按键上方之外，避免盖住键面。
  const nineKeyBar = data.direction === "hold" && /^\d$/.test(key.up) && data.candidates.length > 3
  const rect = { x, y: nineKeyBar ? -height + offsetY : anchor.y - height + offsetY, width, height }
  if (data.background) paintLayer(context, data.background.layer, data.background.bitmap, rect)
  if (data.foreground) paintLayer(context, data.foreground.layer, data.foreground.bitmap, rect)
  if (!data.bar) {
    const text = legacyHintText(key, data.direction)
    if (!text) return
    context.fillStyle = data.textStyle?.color ? colorCss(data.textStyle.color) : (data.dark ? "#f5f5f7" : "#17191c")
    context.font = fontCss(data.textStyle, data.textStyle?.fontSize ?? Math.max(18, Math.min(42, height * 0.25)))
    context.textAlign = "center"
    context.textBaseline = "middle"
    context.fillText(text, rect.x + left + (width - left - right) / 2, rect.y + top + (height - top - bottom) / 2)
    return
  }
  const selected = data.direction === "up" ? 0 : legacyHintSelectedIndex(key, data.candidates)
  const cellHeight = data.cellSize?.[1] && data.cellSize[1] > 0
    ? Math.min(data.cellSize[1], height - top - bottom)
    : height - top - bottom
  data.candidates.forEach((action, index) => {
    const cell = { x: rect.x + left + index * cellWidth, y: rect.y + top, width: cellWidth, height: cellHeight }
    const visual = data.cellVisuals[index === selected ? 1 : 0]
    if (visual) paintLayer(context, visual.layer, visual.bitmap, cell)
    const text = index === selected ? data.selectedTextStyle ?? data.textStyle : data.textStyle
    context.fillStyle = text?.color ? colorCss(text.color) : (data.dark ? "#f5f5f7" : "#17191c")
    context.font = fontCss(text, text?.fontSize ?? Math.max(18, Math.min(42, height * 0.25)))
    context.textAlign = "center"
    context.textBaseline = "middle"
    context.fillText(action, cell.x + cell.width / 2, cell.y + cell.height / 2)
  })
}
