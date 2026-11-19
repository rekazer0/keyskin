// 编辑期的选中反馈：选中描边与未确认草稿的虚线框。
//
// 它不属于皮肤，是编辑器告诉使用者「这些键现在被选中 / 刚被 AI 改过」。
export type SelectionRect = { x: number; y: number; width: number; height: number }

/** 实线选中框；`color` 惰性取，没选中时不碰样式表。 */
export function strokeSelected(
  context: CanvasRenderingContext2D,
  rect: SelectionRect,
  color: () => string,
): void {
  context.strokeStyle = color()
  context.lineWidth = 4
  context.strokeRect(rect.x + 2, rect.y + 2, rect.width - 4, rect.height - 4)
}

/** 未确认的 AI 草稿：虚线橙框，与任何实线选中区分开。 */
export function strokeDraft(context: CanvasRenderingContext2D, rect: SelectionRect): void {
  const inset = 3
  context.save()
  context.strokeStyle = "#ff6b2c"
  context.lineWidth = 3
  context.setLineDash([9, 6])
  context.strokeRect(
    rect.x + inset,
    rect.y + inset,
    Math.max(0, rect.width - inset * 2),
    Math.max(0, rect.height - inset * 2),
  )
  context.restore()
}
