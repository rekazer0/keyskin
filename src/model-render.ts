// 从 IR 取渲染需要的样式与图片。
//
// 输入只有 `SkinModel`（styles/images/resourceIndex）与一块板；不读任何格式包，
// 也不认识格式名。几何与样式都在模型里，渲染不再回头问格式层「这个编号是什么」。
import type { StyleTextVisual, TextVisual, Visual, VisualResolver } from "@/atlas.ts"
import type { Board } from "@/skin-model/board.ts"
import type { SkinImage } from "@/skin-model/image.ts"
import type { SkinModel } from "@/skin-model/model.ts"
import type { SkinLayer, SkinStyle, Stretch, TextStyle } from "@/skin-model/style.ts"

const bitmaps = new WeakMap<SkinImage, Promise<ImageBitmap | undefined>>()

/** IR 的像素转位图；按图片对象缓存，同一张图不同样式共用一次解码。 */
function bitmapOf(image: SkinImage): Promise<ImageBitmap | undefined> {
  let result = bitmaps.get(image)
  if (!result) {
    const data = new ImageData(new Uint8ClampedArray(image.data), image.width, image.height)
    result = createImageBitmap(data).catch(() => undefined)
    bitmaps.set(image, result)
  }
  return result
}

/** IR 的颜色是 `AARRGGBB` 十六进制；渲染要 CSS 颜色。 */
function colorCss(value: string): string {
  const hex = value.trim().replace(/^#/, "")
  if (!/^[0-9a-f]{8}$/i.test(hex)) return value.startsWith("#") ? value : `#${hex}`
  const alpha = Number.parseInt(hex.slice(0, 2), 16) / 255
  const red = Number.parseInt(hex.slice(2, 4), 16)
  const green = Number.parseInt(hex.slice(4, 6), 16)
  const blue = Number.parseInt(hex.slice(6, 8), 16)
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

function textVisual(style: TextStyle | undefined): TextVisual | undefined {
  if (!style) return
  return {
    ...(style.font ? { fontName: style.font } : {}),
    ...(style.fontSize !== undefined ? { fontSize: style.fontSize } : {}),
    ...(style.weight !== undefined ? { weight: style.weight } : {}),
    ...(style.color ? { color: colorCss(style.color) } : {}),
    ...(style.shadow ? { shadowColor: colorCss(style.shadow.color), shadowSize: style.shadow.size } : {}),
  }
}

/** 按下态优先；没有按下态就沿用普通态。 */
function layersOf(style: SkinStyle | undefined, highlighted: boolean): SkinLayer[] | undefined {
  if (!style) return
  return (highlighted ? style.pressed ?? style.normal : style.normal)
}

function firstLayer<K extends SkinLayer["kind"]>(
  layers: readonly SkinLayer[] | undefined,
  kind: K,
): Extract<SkinLayer, { kind: K }> | undefined {
  return layers?.find((layer): layer is Extract<SkinLayer, { kind: K }> => layer.kind === kind)
}

export class ModelResolver implements VisualResolver {
  constructor(private readonly model: SkinModel, private readonly board?: Board) {}

  async resolve(styleID: string, highlighted: boolean): Promise<Visual | undefined> {
    const layers = layersOf(this.model.styles.get(styleID), highlighted)
    const image = firstLayer(layers, "image")
    if (image) {
      const source = this.model.images.get(image.image)
      const bitmap = source ? await bitmapOf(source) : undefined
      const inner = stretchInner(image.stretch, source)
      return {
        ...(bitmap ? { image: bitmap } : {}),
        ...(inner ? { inner } : {}),
        ...(image.tint ? { filterColor: colorCss(image.tint) } : {}),
      }
    }
    const color = firstLayer(layers, "color")
    if (color) return { color: colorCss(color.value) }
    const text = firstLayer(layers, "text")
    if (text) return { text: { text: text.text ?? "", ...textVisual(text.style) } }
    const border = firstLayer(layers, "border")
    if (border) return { borderColor: colorCss(border.color) }
  }

  /** 逗号分隔的样式 id 列表；字段级取第一个有值的，与多前景样式的写法一致。 */
  resolveText(foreground: string, highlighted: boolean): TextVisual | undefined {
    const result: TextVisual = {}
    const tokens = foreground.split(",").map((value) => value.trim()).filter(Boolean)
    for (const token of tokens) {
      const text = firstLayer(layersOf(this.model.styles.get(token), highlighted), "text")
      if (!text) continue
      const visual = textVisual(text.style)
      if (!visual) continue
      if (result.fontName === undefined && visual.fontName) result.fontName = visual.fontName
      if (result.fontSize === undefined && visual.fontSize !== undefined) result.fontSize = visual.fontSize
      if (result.weight === undefined && visual.weight !== undefined) result.weight = visual.weight
      if (result.color === undefined && visual.color) result.color = visual.color
      if (result.shadowColor === undefined && visual.shadowColor) result.shadowColor = visual.shadowColor
      if (result.shadowSize === undefined && visual.shadowSize !== undefined) result.shadowSize = visual.shadowSize
    }
    return Object.keys(result).length ? result : undefined
  }

  /** 列表格用独立字体绘制；倍率由板的列表内容声明，缺省不缩放。 */
  resolveListText(foreground: string, highlighted: boolean): TextVisual | undefined {
    const visual = this.resolveText(foreground, highlighted)
    const scale = this.board?.panels?.list?.content?.fontScale
    if (!visual || scale === undefined || scale === 1 || visual.fontSize === undefined) return visual
    return { ...visual, fontSize: visual.fontSize * scale }
  }

  resolveStyleText(styleID: string, highlighted: boolean): StyleTextVisual | undefined {
    const text = firstLayer(layersOf(this.model.styles.get(styleID), highlighted), "text")
    if (text?.text === undefined) return
    return { text: text.text, ...this.resolveText(styleID, highlighted) }
  }

  /** 动画与帧序列引用的是包里的原始资源名；按模型里的索引换算成图片 id。 */
  async resolveResource(resourceID: string): Promise<Visual | undefined> {
    const imageID = this.model.resourceIndex.get(resourceID) ?? resourceID
    const image = this.model.images.get(imageID)
    const bitmap = image ? await bitmapOf(image) : undefined
    return bitmap ? { image: bitmap } : undefined
  }

  /** 工具栏图标来自当前板的工具栏项；没有板时没有工具栏。 */
  async resolveToolbarImages(): Promise<Visual[]> {
    const items = this.board?.panels?.toolbar?.items ?? []
    return Promise.all(items.map(async (item) => {
      const imageID = item.icon ? this.model.resourceIndex.get(item.icon) ?? item.icon : undefined
      const image = imageID ? this.model.images.get(imageID) : undefined
      const bitmap = image ? await bitmapOf(image) : undefined
      return {
        ...(bitmap ? { image: bitmap } : {}),
        ...(item.label ? { label: item.label } : {}),
      }
    }))
  }
}

/** 拉伸信息 → 九宫格内缩；没有图片尺寸时只认 `region` 的原始内框。 */
function stretchInner(
  stretch: Stretch | undefined,
  image: SkinImage | undefined,
): [number, number, number, number] | undefined {
  if (!stretch || stretch.kind === "none") return
  if (stretch.kind === "region") {
    return [stretch.inner.x, stretch.inner.y, stretch.inner.width, stretch.inner.height]
  }
  if (stretch.kind === "nine-slice" && image) {
    const { left, top, right, bottom } = stretch.edges
    return [left, top, image.width - left - right, image.height - top - bottom]
  }
}
