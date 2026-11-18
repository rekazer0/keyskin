// IR 的基础语义类型。这里不出现任何输入法格式的字段名。
//
// 覆盖的信息维度：外观/方向/平台、分辨率与缩放、按键动作、按键事件、动效槽位、资源与元信息。
// 位置、尺寸与距离一律使用 taffy 的类型，不另建同名结构。
import type { Size } from "taffy-layout"

export type Appearance = "light" | "dark"
export type Orientation = "port" | "land"

/** 统一颜色表示：8 位十六进制 ARGB，如 `FF112233`。 */
export type Color = string

export type BoardKind = "main" | "number" | "symbol" | "candidate" | "hint" | "list" | "toolbar" | "input" | "popup" | "other"

/** 按键位置从哪里来：文档自带、客户端内置、或官方基础布局。 */
export type BoardGeometry = "document" | "client" | "basis"

export type KeyEvent = "press" | "long-press" | "swipe-up" | "swipe-down" | "swipe-left" | "swipe-right"

/** 动效槽位：按键按下、松开、面板显示、隐藏与长按。 */
export type MotionSlot = "press" | "release" | "show" | "hide" | "hold"

/** 按键动作的语义；格式独有的码放在 `system`。 */
export type SkinAction =
  | { kind: "text"; value: string }
  | { kind: "delete"; forward?: boolean }
  | { kind: "enter" }
  | { kind: "candidate-page"; direction: "up" | "down" }
  | { kind: "case"; mode: "title" | "lock" }
  | { kind: "switch"; board: BoardKind }
  | { kind: "open-app"; app?: string }
  | { kind: "system"; code: string }

export type SkinResource =
  | { kind: "image"; path: string; size?: Size<number>; format?: string }
  | { kind: "audio"; path: string; format?: string; duration?: number }
  | { kind: "font"; path: string; family?: string; weight?: number }
  | { kind: "frame"; path: string; duration?: number }

/** 皮肤元信息；`scale` 是设计宽到目标分辨率的换算比例。 */
export type SkinMeta = {
  name?: string
  author?: string
  version?: string
  platform?: string
  appearance: Appearance
  orientation: Orientation
  resolution?: Size<number>
  designWidth?: number
  scale?: number
  description?: string
}
