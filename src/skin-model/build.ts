// 基于布局与样式构建渲染模型。
//
// 布局树用 taffy 计算每个按键的矩形；样式引用在模型样式表里解析成图层。
// 这是预览与导出共用的“板 → 可绘制按键”的路径。
import type { SkinBoard } from "./board.ts"
import type { SkinKey } from "./key.ts"
import type { LayoutBox } from "./layout.ts"
import { computeLayout } from "./layout.ts"
import type { SkinModel } from "./model.ts"
import { resolveStyle, type SkinLayer, type SkinStyle } from "./style.ts"

export type KeyRender = {
  key: SkinKey
  rect: LayoutBox
  back?: SkinStyle
  fore: SkinStyle[]
  /** 正常态最终绘制的图层：背景 + 前景。 */
  layers: SkinLayer[]
}

/** 一块板的按键渲染数据；矩形来自布局树，图层来自按键容器各自的层。 */
export async function buildBoard(model: SkinModel, board: SkinBoard): Promise<KeyRender[]> {
  const rects = await computeLayout(board.layout, board.size)
  return board.keys.flatMap((key) => {
    const rect = rects.get(key.id)
    // 布局树里没有这个键就没有几何；不给兜底值，缺了就是缺了。
    if (!rect) return []
    const back = resolveStyle(model.styles, key.container.back?.style)
    const fore = key.container.fore.flatMap((layer) => {
      const style = resolveStyle(model.styles, layer.style)
      return style ? [style] : []
    })
    const layers = [...(back?.normal ?? []), ...fore.flatMap((style) => style.normal)]
    return { key, rect, ...(back ? { back } : {}), fore, layers }
  })
}
