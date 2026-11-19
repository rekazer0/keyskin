// 编辑期的叠加层：框选矩形。它不属于皮肤，是编辑器自己的可视反馈。
export type MarqueeRect = { x: number; y: number; width: number; height: number }

/** 画框选矩形：填充淡、边框实；颜色惰性取，没框选时不碰样式表。 */
export function paintMarquee(
  context: CanvasRenderingContext2D,
  rect: MarqueeRect | undefined,
  color: () => string,
): void {
  if (!rect) return
  const { x, y, width, height } = rect
  context.save()
  context.strokeStyle = context.fillStyle = color()
  context.globalAlpha = 0.15
  context.fillRect(x, y, width, height)
  context.globalAlpha = 1
  context.strokeRect(x, y, width, height)
  context.restore()
}
