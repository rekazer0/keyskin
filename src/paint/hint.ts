// 长按/滑动提示气泡：一条柱状候选或单字气泡，画在按键上方。
//
// 位置、尺寸与候选都来自格式已解析好的数据；这里只负责摆位与画字。
import { canvasFont, type TextVisual, type Visual } from "../atlas.ts"
import { drawVisual, phoneForegroundVisual } from "../preview-draw.ts"
import type { HintKey } from "../preview-hints.ts"
import { legacyHintSelectedIndex, legacyHintText } from "../preview-hints.ts"

export type HintRect = { x: number; y: number; width: number; height: number }

export type HintPaintData = {
  /** 气泡图的尺寸、相对按键的偏移与内边距。 */
  size: readonly [number, number]
  position: readonly [number, number]
  padding: readonly [number, number, number, number]
  background?: Visual
  foreground?: Visual
  candidates: readonly string[]
  /** 单元格的常态图与选中图。 */
  cellVisuals: readonly (Visual | undefined)[]
  textVisual?: TextVisual
  selectedTextVisual?: TextVisual
  cellSize?: readonly [number, number]
  direction: "center" | "up" | "down" | "left" | "right" | "hold"
  /** 柱状候选：一条里排多个字；否则只画一个字。 */
  bar: boolean
  panelWidth: number
  dark: boolean
  /** 选中格的宽度，指针事件要按它算命中。 */
  onCellWidth(width: number): void
}

/** 画一次气泡；`anchor` 是气泡所属按键的矩形。 */
export function paintHintBubble(
  context: CanvasRenderingContext2D,
  key: HintKey,
  anchor: HintRect,
  data: HintPaintData,
): void {
  const [baseWidth, height] = data.size
  const [offsetX, offsetY] = data.position
  const [left, top, right, bottom] = data.padding
  const desiredCellWidth = data.cellSize?.[0] && data.cellSize[0] > 0
    ? data.cellSize[0]
    : Math.max(data.panelWidth / 14, data.textVisual?.fontSize ?? 0, data.cellVisuals[1]?.source?.[2] ?? 0)
  const width = data.bar
    ? Math.min(data.panelWidth, Math.max(baseWidth, left + right + data.candidates.length * desiredCellWidth))
    : baseWidth
  const cellWidth = data.bar ? (width - left - right) / data.candidates.length : desiredCellWidth
  const x = Math.max(0, Math.min(data.panelWidth - width, anchor.x + (anchor.width - width) / 2 + offsetX))
  // 九键长按时数字键的气泡要挂在按键上方之外，避免盖住键面。
  const nineKeyBar = data.direction === "hold" && /^\d$/.test(key.up) && data.candidates.length > 3
  const rect = { x, y: nineKeyBar ? -height + offsetY : anchor.y - height + offsetY, width, height }
  drawVisual(context, data.background, rect, true)
  drawVisual(context, phoneForegroundVisual(data.foreground), rect, false)
  if (!data.bar) {
    const text = legacyHintText(key, data.direction)
    if (!text) return
    context.fillStyle = data.textVisual?.color ?? (data.dark ? "#f5f5f7" : "#17191c")
    context.font = canvasFont(data.textVisual?.fontSize ?? Math.max(18, Math.min(42, height * 0.25)), data.textVisual)
    context.textAlign = "center"
    context.textBaseline = "middle"
    context.fillText(text, rect.x + left + (width - left - right) / 2, rect.y + top + (height - top - bottom) / 2)
    return
  }
  const selected = data.direction === "up" ? 0 : legacyHintSelectedIndex(key, data.candidates)
  data.onCellWidth(cellWidth)
  const cellHeight = data.cellSize?.[1] && data.cellSize[1] > 0
    ? Math.min(data.cellSize[1], height - top - bottom)
    : height - top - bottom
  data.candidates.forEach((action, index) => {
    const cell = { x: rect.x + left + index * cellWidth, y: rect.y + top, width: cellWidth, height: cellHeight }
    drawVisual(context, data.cellVisuals[index === selected ? 1 : 0], cell, true)
    const text = index === selected ? data.selectedTextVisual ?? data.textVisual : data.textVisual
    context.fillStyle = text?.color ?? (data.dark ? "#f5f5f7" : "#17191c")
    context.font = canvasFont(text?.fontSize ?? Math.max(18, Math.min(42, height * 0.25)), text)
    context.textAlign = "center"
    context.textBaseline = "middle"
    context.fillText(action, cell.x + cell.width / 2, cell.y + cell.height / 2)
  })
}
