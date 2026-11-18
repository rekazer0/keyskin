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

/** 一块板的按键渲染数据；矩形来自布局树，图层来自样式引用。 */
export async function buildBoard(model: SkinModel, board: SkinBoard): Promise<KeyRender[]> {
  const rects = await computeLayout(board.layout, board.size)
  return board.keys.map((key) => {
    const rect = rects.get(key.id) ?? key.rect
    const back = resolveStyle(model.styles, key.style.back)
    const fore = key.style.fore.flatMap((ref) => {
      const style = resolveStyle(model.styles, ref)
      return style ? [style] : []
    })
    const layers = [...(back?.normal ?? []), ...fore.flatMap((style) => style.normal)]
    return { key, rect, ...(back ? { back } : {}), fore, layers }
  })
}
