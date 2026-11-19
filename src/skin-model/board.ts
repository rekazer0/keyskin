// 板：几何来源、布局树、容器与按键。
//
// 板的核心形状只有这些：几何的唯一真相是 `layout`（taffy 树），`container` 是计算布局的输入。
// 面板（候选栏、气泡、列表、工具栏、输入栏）的细节属于格式专有内容，放在 `extra` 里，
// 由 `panel.ts` 给出类型契约；不在这里展开成字段，否则板与面板的建模会分叉。
import type { Size } from "taffy-layout"
import type { Key } from "./key.ts"
import type { LayoutBoard } from "./layout.ts"
import type { StyleRef } from "./style.ts"
import type { BoardKind, GeometrySource, Orientation, Theme } from "./types.ts"

export type Board = {
  id: string
  kind: BoardKind
  theme: Theme
  orientation: Orientation
  /** 描述 `container` 从哪来。 */
  geometry: GeometrySource
  /** 计算布局用的容器尺寸，是输入不是结果。 */
  container: Size<number>
  /** 布局是 taffy 树，不是矩形集合。 */
  layout: LayoutBoard
  /** 面板自身的样式引用。 */
  backdrop?: StyleRef
  keys: Key[]
  /** 包里声明但本板没有的键（SXI 的 deleteKey）。 */
  removedKeys?: string[]
  /** 格式专有的、还没建模的字段，原样保留。 */
  extra?: ReadonlyMap<string, unknown>
}
