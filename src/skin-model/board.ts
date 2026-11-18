// 板：布局、面板背景、候选栏、气泡、列表、工具栏、输入码与按键。
//
// 面板组件用组件级类型表达（候选栏/气泡/列表/工具栏/输入码），而不是各格式的段结构。
import type { Point, Size } from "taffy-layout"
import type { SkinKey } from "./key.ts"
import type { LayoutBoard } from "./layout.ts"
import type { TextStyle } from "./style.ts"
import type { BoardGeometry, BoardKind, Orientation, SkinAction } from "./types.ts"

export type PanelBackdrop = {
  style?: string
  blur?: boolean
  radius?: number
  opacity?: number
}

export type ToolbarItem = {
  id: string
  icon?: string
  label?: string
  action?: SkinAction
  visible?: boolean
  /** 图标在工具栏里的位置与尺寸；面板文件按它写 `POS` 与 `SIZE`。 */
  offset?: Point<number>
  size?: Size<number>
}

export type Toolbar = {
  style?: string
  items: ToolbarItem[]
  height?: number
  iconSize?: Size<number>
}

export type CandidateBar = {
  style?: string
  cellStyle?: string
  textStyle?: TextStyle
  inputStyle?: string
  icons?: ToolbarItem[]
  orientation?: "horizontal" | "vertical"
  gravity?: "top" | "bottom"
}

export type HintBubble = {
  style?: string
  textStyle?: TextStyle
  offset?: Point<number>
  corner?: number
}

export type ListPanel = {
  style?: string
  cellStyle?: string
  cellSize?: Size<number>
  count?: number
  orientation?: "horizontal" | "vertical"
}

export type InputBar = {
  style?: string
  textStyle?: TextStyle
  height?: number
}

/** 板之间的跳转：按下或长按某个动作进入另一块板。 */
export type BoardTransition = { trigger: "press" | "long-press"; target: BoardKind }

export type SkinBoard = {
  id: string
  kind: BoardKind
  geometry: BoardGeometry
  orientation: Orientation
  size: Size<number>
  layout: LayoutBoard
  backdrop?: PanelBackdrop
  candidate?: CandidateBar
  hint?: HintBubble
  list?: ListPanel
  toolbar?: Toolbar
  input?: InputBar
  keys: SkinKey[]
  transitions?: BoardTransition[]
}
