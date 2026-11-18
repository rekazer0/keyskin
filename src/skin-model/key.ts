// 按键：动作、状态覆盖、样式/动效/音效引用与几何。
//
// 按键不再绑定任何格式的段名或字段：id 是稳定标识，矩形与布局树节点对应，动作按事件存放。
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
export type KeyStateOverride = {
  state: string
  visible?: boolean
  actions?: Partial<Record<KeyEvent, SkinAction>>
  style?: Partial<KeyStyleRefs>
}

export type SkinKey = {
  id: string
  rect: LayoutBox
  touchRect?: LayoutBox
  padding?: Rect<number>
  /** 默认状态下的动作。 */
  actions: Partial<Record<KeyEvent, SkinAction>>
  style: KeyStyleRefs
  motions?: Partial<Record<MotionSlot, string>>
  sound?: string
  label?: string
  editable?: boolean
  overrides?: KeyStateOverride[]
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
