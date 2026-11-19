// 布局节点的一行描述。
//
// 直接读 taffy 样式，不在别处另存一份布局语义。taffy 的缺省值（flex 行、relative、auto）
// 不写进来，否则每个节点长得一样，看不出这层结构是怎么被理解的。
import { Display, FlexDirection, Position } from "taffy-layout"
import type { Dimension, LengthPercentage, LengthPercentageAuto, Rect } from "taffy-layout"
import type { LayoutNode } from "./layout.ts"

/** 长度换成文本：像素取整，百分比与 auto 原样保留。 */
function length(value: LengthPercentage | Dimension | LengthPercentageAuto): string {
  return typeof value === "number" ? String(Math.round(value)) : value
}

/** 四边压成「左 上 右 下」；四边一致时只写一个数。 */
function edges(rect: Rect<LengthPercentage | LengthPercentageAuto> | undefined): string | undefined {
  if (!rect) return
  const parts = [rect.left, rect.right, rect.top, rect.bottom].map(length)
  if (parts.every((part) => part === parts[0])) return parts[0]
  return `${parts[0]} ${parts[2]} ${parts[1]} ${parts[3]}`
}

export function describeNode(node: LayoutNode): string {
  const style = node.style
  const parts: string[] = []
  const display = style.display === Display.Grid ? "grid" : style.display === Display.Block ? "block" : "flex"
  parts.push(style.flexDirection === FlexDirection.Column ? `${display} column` : display)
  if (style.position === Position.Absolute) parts.push("absolute")
  const size = style.size
  if (size?.width !== undefined || size?.height !== undefined) {
    parts.push(`${size.width === undefined ? "auto" : length(size.width)} × ${size.height === undefined ? "auto" : length(size.height)}`)
  }
  const gap = style.gap
  if (gap) parts.push(`gap ${length(gap.width)} ${length(gap.height)}`)
  const padding = edges(style.padding)
  if (padding) parts.push(`padding ${padding}`)
  const margin = edges(style.margin)
  if (margin) parts.push(`margin ${margin}`)
  const inset = edges(style.inset)
  if (inset) parts.push(`inset ${inset}`)
  return parts.join(" · ")
}
