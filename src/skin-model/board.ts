// 板：布局、面板背景、候选栏、气泡、列表、工具栏、输入码与按键。
//
// 面板组件用组件级类型表达（候选栏/气泡/列表/工具栏/输入码），而不是各格式的段结构。
import type { Point, Rect, Size } from "taffy-layout"
import type { SkinKey, TipBody } from "./key.ts"
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
  /** 气泡面板文件的引用名，布局文件里写成 `[HINT]` 的 `LAYOUT_NAME`。 */
  layoutName?: string
  /** 气泡类型，布局文件里写成 `[HINT]` 的 `TYPE`。 */
  type?: number
}

export type ListPanel = {
  style?: string
  cellStyle?: string
  cellSize?: Size<number>
  count?: number
  orientation?: "horizontal" | "vertical"
  /** 列表里各项的排布方向与来源名，布局文件里写成 `LIST_ORDER` 与 `NAMES`。 */
  order?: string
  names?: readonly string[]
  /** 列表在板上的位置与向外留白，布局文件里写成 `POS` 与 `PADDING`。 */
  offset?: Point<number>
  padding?: Rect<number>
  /** 列表类型，布局文件里写成 `TYPE`。 */
  type?: number
  /** 列表项取值，布局文件里写成 `VALUES`。 */
  values?: readonly string[]
}

export type InputBar = {
  style?: string
  textStyle?: TextStyle
  height?: number
}

/** 符号键盘菜单：各类别指向哪块布局，以及它自己的网格与样式。 */
export type MoreMenu = {
  layouts: ReadonlyMap<string, string>
  cellStyle?: string
  foreStyle?: string
  grid?: Size<number>
  layoutName?: string
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
  /** 手写区的前台样式；布局文件里写成 `HW_FORE_STYLE`。 */
  handwritingStyle?: string
  /** 布局文件声明的键数 `KEY_NUM`；它可能与实际读出的键数不同。 */
  keyCount?: number
  /** 布局文件声明的状态槽位数 `TIP_NUM`；它可能多于实际定义的 `[TIPn]` 段。 */
  tipCount?: number
  /**
   * 状态样式段池：段号 → 定义。`[TIPn]` 是布局文件里的命名空间，
   * 按键用 `overrideSections` 引用；没被引用的段同样保留，否则导出就丢了。
   */
  tips?: ReadonlyMap<number, TipBody>
  /** 符号键盘的引用菜单：类别 → 布局名，布局文件里写成 `[MORE]` 的各类 `*_LAYOUT`。 */
  more?: MoreMenu
  /**
   * 布局文件里声明但内容为空的段，按原顺序保留。
   * 有字段的段必须在 IR 里有对应字段；这里只承载「声明了这个面板但配置在别处」这一事实。
   */
  emptySections?: readonly string[]
}
