// 按键：动作、状态覆盖、样式/动效/音效引用。
//
// 按键不携带几何：矩形只由所属板的布局树算出（computeLayout(board.layout)）。
// 同一份几何只有一处表达，视图、命中、导出都从布局树取。
import type { Point, Rect } from "taffy-layout"
import type { BoardKind, KeyEvent, MotionSlot, SkinAction } from "./types.ts"
import type { LayoutBox } from "./layout.ts"
import type { SkinStyle } from "./style.ts"

/** 按键的样式引用：背景、按下背景、前景层、文字与图标。 */
/**
 * 按键内部的一层；它自持样式、偏移与动画，渲染时不需要外部再拼。
 * 前景是层栈，背景与图标各一层。
 */
export type KeyLayer = {
  /** 样式表里的样式名；按下时才画出来的层可以没有常态样式。 */
  style?: string
  /** 相对按键的偏移；空位表示这一层不偏移。 */
  offset?: Point<number>
  /** 这一层自己的动画样式。 */
  anim?: string
  /** 按下时的样式；只有背景层用它。 */
  pressed?: string
}

/**
 * 按键容器：按键是一个终点组件，外部只知道它占哪块矩形，
 * 内部各层由它自己按顺序画。
 */
export type KeyContainer = {
  /** 背景层（最底）。 */
  back?: KeyLayer
  /** 前景层栈，从下到上。 */
  fore: KeyLayer[]
  /** 文字层：显示什么、什么样式、放在哪。 */
  text?: {
    content?: string
    style?: string
    /** 放置类型，原文件给几个就带回几个。 */
    placement?: readonly number[]
  }
  /** 图标层。 */
  icon?: string
  /** 按下时整键的效果样式。 */
  press?: string
}

/** 某个皮肤状态下的按键差异（显示/动作/样式覆盖）。 */
export type KeyStateOverride = TipBody & {
  state: string
  /** 原文件里的 `[TIPn]` 段号；写回时沿用，不能按数组下标重排。 */
  section?: number
}

/** `[TIPn]` 段的内容；状态名来自引用方，段本身不带。 */
export type TipBody = {
  visible?: boolean
  actions?: Partial<Record<KeyEvent, SkinAction>>
  /** 这个状态下的一套层定义；缺的层沿用按键默认。 */
  container?: Partial<KeyContainer>
  /** 这个状态下的标签放置类型。 */
  labelPosition?: readonly number[]
  /** 这个状态下的长按符号串。 */
  holdSymbol?: string
  /** 这个状态下的说明文字；`[TIPn]` 的 `INFO`。 */
  info?: string
  /** 这个状态下的按键矩形；状态切换时键可能换位置。 */
  viewRect?: LayoutBox
}

/** 按键对状态样式的引用：哪个状态配上哪个段。 */
export type TipRef = {
  state: string
  section: number
}

export type SkinKey = {
  id: string
  /** 这个按键覆盖的段；列表单元格这类合成项会指向多个段。 */
  sections?: readonly string[]
  /** 默认状态下是否可见；状态覆盖里的 `visible` 优先。 */
  visible?: boolean
  /** 触摸命中区域；它是命中语义，不是绘制几何，不与布局树重复。 */
  /** 触摸区；`null` 表示显式声明没有触摸区，`undefined` 表示沿用按键矩形。 */
  touchRect?: LayoutBox | null
  padding?: Rect<number>
  /** 默认状态下的动作。 */
  actions: Partial<Record<KeyEvent, SkinAction>>
  /** 按键容器：它自己知道内部有几层、每层怎么画。 */
  container: KeyContainer
  motions?: Partial<Record<MotionSlot, string>>
  sound?: string
  label?: string
  /** 长按弹出的符号串；布局文件里写成 `HOLDSYM`。 */
  holdSymbol?: string
  /** 按键的说明文字；布局文件里写成 `INFO`，只给制作者看。 */
  info?: string
  /** 标签在按键内的放置类型；布局文件里写成 `POS_TYPE=`，一个到四个值不等。 */
  labelPosition?: readonly number[]
  /** 前景图标的固定绘制区域；布局文件里写成 `FOREGROUND_RECT`。 */
  foreRect?: LayoutBox
  editable?: boolean
  /** 引用板上哪些状态样式段，以及各自对应哪个状态；定义在 `board.tips` 里。 */
  stateRefs?: readonly TipRef[]
}

/** 按键是否可被编辑（客户端排布的板不可增删）。 */
export function keyEditable(key: SkinKey, boardKind: BoardKind, geometry: "document" | "client" | "basis"): boolean {
  if (key.editable !== undefined) return key.editable
  if (geometry === "client") return false
  return boardKind !== "candidate" && boardKind !== "toolbar"
}

/** 按键容器里所有层的样式引用，按 id 去重。 */
export function styleReferences(key: SkinKey): string[] {
  const ids = [
    key.container.back?.style,
    key.container.back?.pressed,
    key.container.text?.style,
    key.container.icon,
    ...key.container.fore.map((layer) => layer.style),
    ...key.container.fore.map((layer) => layer.anim),
    key.container.back?.anim,
    key.container.press,
  ]
  return ids.filter((id): id is string => Boolean(id)).filter((id, index, all) => all.indexOf(id) === index)
}

/** 按键引用的样式在模型样式表里解析；缺失的引用直接省略。 */
export function keyStyles(styles: ReadonlyMap<string, SkinStyle> | undefined, key: SkinKey): SkinStyle[] {
  return styleReferences(key).flatMap((id) => {
    const style = styles?.get(id)
    return style ? [style] : []
  })
}
