// 样式：图层模型。
//
// 一个样式由若干图层组成，正常、按下、禁用各一份；图片、颜色、文字、边框、图标、渐变与音效
// 都是同一套图层。九宫格与拉伸信息挂在图片图层上，不再依赖格式自己的字段名。
import type { Point, Rect, Size } from "taffy-layout"
import type { Color } from "./types.ts"

export type ImageFit = "stretch" | "nine-slice" | "center" | "tile"

export type NineSlice = {
  /** 可拉伸边与角的尺寸，从图层图片的边缘算起。 */
  inner: Rect<number>
  /** 位图像素到布局单位的比例。 */
  pixelScale?: number
}

export type TextStyle = {
  font?: string
  fontSize?: number
  weight?: number
  color?: Color
  shadow?: { color: Color; size: number; offset?: Point<number> }
}

export type SkinLayer =
  | { kind: "image"; image: string; fit?: ImageFit; nineSlice?: NineSlice; alpha?: number; filter?: Color }
  | { kind: "color"; value: Color }
  | { kind: "text"; text?: string; style: TextStyle }
  | { kind: "border"; color: Color; width: number; radius?: number }
  | { kind: "icon"; image: string; size?: Size<number> }
  | { kind: "gradient"; stops: ReadonlyArray<{ offset: number; color: Color }>; direction: "horizontal" | "vertical" }
  | { kind: "sound"; file: string }

export type SkinStyle = {
  normal: SkinLayer[]
  pressed?: SkinLayer[]
  disabled?: SkinLayer[]
}

export type SkinStyles = ReadonlyMap<string, SkinStyle>

/** ARGB 数字统一成 8 位十六进制。 */
export function argbHex(value: number): string {
  return (value >>> 0).toString(16).padStart(8, "0").toUpperCase()
}

/** 引用 id 去掉 `STYLE` 前缀后查样式。 */
export function resolveStyle(styles: SkinStyles | undefined, ref: string | undefined): SkinStyle | undefined {
  const id = ref?.trim().replace(/^STYLE/i, "")
  if (!id) return
  return styles?.get(id)
}

/** 样式的图片图层，便于只需要背景图的调用方。 */
export function imageLayer(style: SkinStyle | undefined): Extract<SkinLayer, { kind: "image" }> | undefined {
  return style?.normal.find((layer): layer is Extract<SkinLayer, { kind: "image" }> => layer.kind === "image")
}
