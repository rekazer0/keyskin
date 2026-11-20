// 样式：图层模型。
//
// 一个样式由若干图层组成，正常、按下、禁用各一份；图片、颜色、文字、边框、图标、渐变与音效
// 都是同一套图层。拉伸信息挂在图片图层上，用 `Stretch` 表达，不再依赖格式自己的字段名。
import type { Point, Size } from "taffy-layout"
import type { Box, Color, Edges, UnitRect } from "./types.ts"
import type { SkinModel } from "./model.ts"
import type { SoundBinding } from "./sound.ts"

export type StyleRef = string

/**
 * 图片拉伸。四种形态不能合并：
 * `region` 说「中间这块可以拉伸」，`nine-slice` 说「四周这几条不能拉伸」，
 * 两者方向相反，互转需要图片尺寸；`unknown-six` 的语义未定，原样保留。
 */
export type Stretch =
  | { kind: "none" }
  | { kind: "nine-slice"; edges: Edges }
  | { kind: "region"; inner: Box }
  | { kind: "unknown-six"; values: readonly number[] }

export type TextStyle = {
  font?: string
  fontSize?: number
  weight?: number
  color?: Color
  shadow?: { color: Color; size: number; offset?: Point<number> }
}

export type SkinLayer =
  | { kind: "image"; image: string; stretch?: Stretch; tint?: Color; alpha?: number }
  | { kind: "color"; value: Color }
  | { kind: "text"; text?: string; style: TextStyle }
  | { kind: "border"; color: Color; width: number; radius?: number }
  | { kind: "icon"; image: string; box?: UnitRect; size?: Size<number> }
  | { kind: "gradient"; stops: ReadonlyArray<{ offset: number; color: Color }>; direction: "horizontal" | "vertical" }
  | { kind: "sound"; binding: SoundBinding }

export type SkinStyle = {
  normal: SkinLayer[]
  pressed?: SkinLayer[]
  disabled?: SkinLayer[]
}

export type SkinStyles = ReadonlyMap<StyleRef, SkinStyle>

/** 样式表：样式引用到样式的映射。 */
export type StyleTable = SkinStyles

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

/** 按状态取样式图层；没有样式就是空数组。渲染只读模型，不认识格式。 */
export function styleLayers(model: SkinModel | undefined, styleID: string, highlighted: boolean): readonly SkinLayer[] {
  const style = model?.styles.get(styleID)
  if (!style) return []
  return highlighted ? style.pressed ?? style.normal : style.normal
}

/** IR 的颜色是 `AARRGGBB` 十六进制；渲染要 CSS 颜色。 */
export function colorCss(value: string): string {
  const hex = value.trim().replace(/^#/, "")
  if (!/^[0-9a-f]{8}$/i.test(hex)) return value.startsWith("#") ? value : `#${hex}`
  const alpha = Number.parseInt(hex.slice(0, 2), 16) / 255
  const red = Number.parseInt(hex.slice(2, 4), 16)
  const green = Number.parseInt(hex.slice(4, 6), 16)
  const blue = Number.parseInt(hex.slice(6, 8), 16)
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

/** 逗号分隔的样式 id：取文字层，字段级取第一个有值的（BDS 的多前景写法）。 */
export function styleText(model: SkinModel | undefined, styleIDs: string, highlighted: boolean): TextStyle | undefined {
  if (!model) return
  const result: TextStyle = {}
  for (const token of styleIDs.split(",").map((value) => value.trim()).filter(Boolean)) {
    const text = styleLayers(model, token, highlighted).find((layer) => layer.kind === "text")
    if (text?.kind !== "text") continue
    const style = text.style
    if (result.font === undefined && style.font) result.font = style.font
    if (result.fontSize === undefined && style.fontSize !== undefined) result.fontSize = style.fontSize
    if (result.weight === undefined && style.weight !== undefined) result.weight = style.weight
    if (result.color === undefined && style.color) result.color = style.color
    if (result.shadow === undefined && style.shadow) result.shadow = style.shadow
  }
  return Object.keys(result).length ? result : undefined
}

/** 样式自带的标签：文字层的内容与样式。 */
export function styleLabel(
  model: SkinModel | undefined,
  styleID: string,
  highlighted: boolean,
): { text: string; style: TextStyle } | undefined {
  const text = styleLayers(model, styleID, highlighted).find((layer) => layer.kind === "text")
  if (text?.kind !== "text" || text.text === undefined) return
  return { text: text.text, style: text.style }
}
