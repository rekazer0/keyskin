// IR 的基础语义类型。这里不出现任何输入法格式的字段名。
//
// 覆盖的信息维度：颜色、方向与主题、三种量纲的矩形、板的几何来源、按键动作与状态、
// 触摸区、资源与元信息。位置与尺寸一律使用 taffy 的类型，不另建同名结构。
import type { Size } from "taffy-layout"

/** 统一颜色表示：8 位十六进制 ARGB，如 `FF112233`。 */
export type Color = string

export type Orientation = "port" | "land"
export type Theme = "light" | "dark"

/** 像素矩形，原点左上。 */
export type Box = { x: number; y: number; width: number; height: number }

/** 归一化矩形，0~1，顺序 left,top,right,bottom。相对父容器，不能与像素矩形互转。 */
export type UnitRect = { left: number; top: number; right: number; bottom: number }

/** 像素边距，顺序 left,top,right,bottom。 */
export type Edges = { left: number; top: number; right: number; bottom: number }

export type BoardKind = "main" | "number" | "symbol" | "candidate" | "hint" | "list" | "toolbar" | "input" | "popup" | "other"

/** 板的几何从哪里来：包里自带、客户端内置、或外部基准文件。 */
export type GeometrySource =
  | { kind: "document" }
  | { kind: "client"; basis?: string }
  | { kind: "basis"; asset: string }

/** 按键事件；`trigger` 动作表达短按与长按指向不同动作。 */
export type KeyEvent = "press" | "long-press" | "swipe-up" | "swipe-down" | "swipe-left" | "swipe-right"

/** 动效槽位：按键按下、松开、面板显示、隐藏与长按。 */
export type MotionSlot = "press" | "release" | "show" | "hide" | "hold"

/** 按键动作的语义；格式独有的码放在 `system`。 */
export type KeyAction =
  | { kind: "text"; value: string }
  | { kind: "delete"; forward?: boolean }
  | { kind: "enter" }
  | { kind: "candidate-page"; direction: "up" | "down" }
  | { kind: "case"; mode: "title" | "lock" }
  | { kind: "switch"; board: BoardKind }
  | { kind: "open-app"; app?: string }
  | { kind: "trigger"; event: "up" | "hold"; target: KeyAction }
  | { kind: "system"; code: string }

/**
 * 非图片资源。
 * `data` 是文件内容：模型要能独立写出完整包，音效与字体的字节就得在模型里，
 * 不能靠导出时回源包捡。
 */
export type SkinResource =
  | { kind: "audio"; path: string; format?: string; duration?: number; data?: Uint8Array }
  | { kind: "font"; path: string; family?: string; weight?: number; data?: Uint8Array }
  | { kind: "frame"; path: string; duration?: number; data?: Uint8Array }
  /**
   * 无法解码成像素的图片文件（搜狗包里的 webp）。
   * 模型至少要能原样写出它，否则写回会引用一个不存在的文件；它进不了 `images`，因为那里是像素。
   */
  | { kind: "image"; path: string; format?: string; data?: Uint8Array }

/** 皮肤元信息；`scale` 是设计宽到目标分辨率的换算比例。 */
export type SkinMeta = {
  name?: string
  author?: string
  version?: string
  /** 这套皮肤按哪个宽度设计；所有像素都是它基准下的像素。 */
  designWidth?: number
  /** 设计宽到目标分辨率的换算比例。 */
  scale?: number
  /** 同一个皮肤的其它分辨率副本指向主 variant 的 id。 */
  variantOf?: string
  variantRole?: "primary" | "derived"
  platform?: string
  theme: Theme
  orientation: Orientation
  resolution?: Size<number>
  description?: string
}
