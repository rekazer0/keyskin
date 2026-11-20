// 工具栏条：一条横向槽位，图标按等分摆。
//
// 位置由 IR 的工具栏组件给出；这里只负责把图标放到各自槽位里。
import type { LayerPaint } from "./key.ts"
import { paintLayer } from "./layer.ts"

export type StripRect = { x: number; y: number; width: number; height: number }

/** 把 `images` 等分铺进 `rect`；没有矩形或没有图标就不画。 */
export function paintToolbarStrip(
  context: CanvasRenderingContext2D,
  images: readonly LayerPaint[],
  rect: StripRect | undefined,
): void {
  if (!rect || !images.length) return
  const slotWidth = rect.width / images.length
  images.forEach((paint, index) => {
    const slot = { x: rect.x + index * slotWidth, y: rect.y, width: slotWidth, height: rect.height }
    const bitmap = paint.bitmap
    // 图标按位图尺寸等比缩进槽位并居中；设备像素比由渲染上下文处理，不从文件名推断。
    const scale = bitmap ? Math.min(1, slot.width / bitmap.width, slot.height / bitmap.height) : 1
    const width = bitmap ? bitmap.width * scale : slot.width
    const height = bitmap ? bitmap.height * scale : slot.height
    const destination = { x: slot.x + (slot.width - width) / 2, y: slot.y + (slot.height - height) / 2, width, height }
    paintLayer(context, paint.layer, bitmap, destination)
  })
}
