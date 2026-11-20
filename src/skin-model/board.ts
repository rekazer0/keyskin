// 板：几何来源、布局树、容器、面板组件与按键。
//
// 板的几何唯一真相是 `layout`（taffy 树），`container` 是计算布局的输入。
// 面板组件（候选栏、气泡、列表、工具栏、输入栏）是板上的正式字段 `panels`，
// 类型契约在 `panel.ts`；`extra` 只装未建模的原始字段，不装这一层语义。
import type { Size } from "taffy-layout"
import type { Key } from "./key.ts"
import type { LayoutBoard } from "./layout.ts"
import type { BoardPanels } from "./panel.ts"
import type { StyleRef } from "./style.ts"
import type { BoardKind, GeometrySource, Orientation, Theme } from "./types.ts"

/**
 * 布局容器的尺寸。
 *
 * `unknown` 是显式状态：包与骨架都没有给出画布尺寸时，不能伪造一个 0——
 * 那会让 `computeLayout` 拿到 0 高容器并算出全零矩形，看起来像「有几何」。
 */
export type ContainerSize =
  | { kind: "known"; size: Size<number> }
  | { kind: "unknown" }

/** 已知容器尺寸的简写。 */
export function knownContainer(size: Size<number>): ContainerSize {
  return { kind: "known", size }
}

/** 容器的确定尺寸；未知时返回 undefined，调用方据此跳过布局而不是传 0。 */
export function containerOf(board: Board): Size<number> | undefined {
  return board.container.kind === "known" ? board.container.size : undefined
}

export type Board = {
  id: string
  kind: BoardKind
  theme: Theme
  orientation: Orientation
  /** 描述 `container` 从哪来。 */
  geometry: GeometrySource
  /**
   * 可见面板尺寸，是计算布局的输入。键允许超出它——
   * 内容实际尺寸由 `computeLayout` 的结果派生，不在这里存第二份。
   */
  container: ContainerSize
  /** 布局是 taffy 树，不是矩形集合。 */
  layout: LayoutBoard
  /** 面板自身的样式引用。 */
  backdrop?: StyleRef
  /**
   * 面板组件：候选栏、气泡、列表、工具栏与输入栏。
   *
   * 它们是板上的区域，几何相对本板推导（BDS 的 `gen.ini POS` + `CELL_SIZE`），
   * 所以要挂在板上而不是独立成板；`extra` 只放未建模的原始字段，不放这一层语义。
   */
  panels?: BoardPanels
  keys: Key[]
  /** 包里声明但本板没有的键（SXI 的 deleteKey）。 */
  removedKeys?: string[]
  /** 格式专有的、还没建模的字段，原样保留。 */
  extra?: ReadonlyMap<string, unknown>
}
