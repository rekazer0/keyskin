// 按键：动作、状态覆盖、样式/动效/音效引用。
//
// 按键不携带几何：矩形只由所属板的布局树算出（computeLayout(board.layout)）。
// 同一份几何只有一处表达，视图、命中、导出都从布局树取。
import type { Rect } from "taffy-layout"
import type { BoardKind, KeyEvent, MotionSlot, SkinAction } from "./types.ts"
import type { LayoutBox } from "./layout.ts"
import type { SkinStyle } from "./style.ts"

/** 按键的样式引用：背景、按下背景、前景层、文字与图标。 */
export type KeyStyleRefs = {
  back?: string
  pressedBack?: string
  fore: string[]
  text?: string
  icon?: string
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
  style?: Partial<KeyStyleRefs>
  /** 这个状态下的标签放置类型。 */
  labelPosition?: readonly number[]
}

/** 按键对状态样式的引用：哪个状态配上哪个段。 */
export type TipRef = {
  state: string
  section: number
}

export type SkinKey = {
  id: string
  /** 触摸命中区域；它是命中语义，不是绘制几何，不与布局树重复。 */
  touchRect?: LayoutBox
  padding?: Rect<number>
  /** 默认状态下的动作。 */
  actions: Partial<Record<KeyEvent, SkinAction>>
  style: KeyStyleRefs
  motions?: Partial<Record<MotionSlot, string>>
  sound?: string
  label?: string
  /** 标签在按键内的放置类型；布局文件里写成 `POS_TYPE=`，一个到四个值不等。 */
  labelPosition?: readonly number[]
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

/** 按键样式引用里实际存在的 id，按 id 去重。 */
export function styleReferences(key: SkinKey): string[] {
  return [key.style.back, key.style.pressedBack, key.style.text, key.style.icon, ...key.style.fore]
    .filter((id): id is string => Boolean(id))
    .filter((id, index, all) => all.indexOf(id) === index)
}

/** 按键引用的样式在模型样式表里解析；缺失的引用直接省略。 */
export function keyStyles(styles: ReadonlyMap<string, SkinStyle> | undefined, key: SkinKey): SkinStyle[] {
  return styleReferences(key).flatMap((id) => {
    const style = styles?.get(id)
    return style ? [style] : []
  })
}
