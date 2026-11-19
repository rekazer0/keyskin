// 工具栏条：一条横向槽位，图标按等分摆。
//
// 位置由 IR 的工具栏组件给出；这里只负责把图标放到各自槽位里。
import type { Visual } from "../atlas.ts"
import { drawVisual, toolbarImageRect } from "../preview-draw.ts"

export type StripRect = { x: number; y: number; width: number; height: number }

/** 把 `images` 等分铺进 `rect`；没有矩形或没有图标就不画。 */
export function paintToolbarStrip(
  context: CanvasRenderingContext2D,
  images: readonly Visual[],
  rect: StripRect | undefined,
  panelWidth: number,
  devicePointWidth: number | undefined,
): void {
  if (!rect || !images.length) return
  const slotWidth = rect.width / images.length
  images.forEach((visual, index) => {
    const slot = { x: rect.x + index * slotWidth, y: rect.y, width: slotWidth, height: rect.height }
    drawVisual(context, visual, toolbarImageRect(visual, slot, panelWidth, devicePointWidth), true)
  })
}
