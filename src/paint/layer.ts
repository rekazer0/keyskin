// 从 IR 图层画一块。
//
// 位图由调用方按需解码（`model.images.get(layer.image)` → `bitmapOf`）后传入；这里只做绘制，
// 不认识格式，也不回头查任何样式表。`SkinLayer` 的每个分支对应一种画法。
import { canvasFontFamily, isTransparentColor } from "@/atlas.ts"
import type { SkinLayer, TextStyle } from "@/skin-model/style.ts"
import { colorCss } from "@/skin-model/style.ts"
import type { Box } from "@/skin-model/types.ts"

/** 九宫格轴：固定边、可拉伸区、固定边。尺寸不足时按比例压缩固定边。 */
function nineSliceAxis(size: number, leading: number, trailing: number): [number, number, number, number] {
  const fixed = leading + trailing
  const scale = fixed > size && fixed > 0 ? size / fixed : 1
  const first = Math.round(leading * scale)
  const second = Math.max(first, Math.round(size - trailing * scale))
  return [0, first, second, size]
}

let buffer: HTMLCanvasElement | undefined

function nineSliceBuffer(): HTMLCanvasElement {
  buffer ??= document.createElement("canvas")
  return buffer
}

/** 九宫格：源图按内缩切成九块，四角不拉伸。`source` 是整片位图 `[0,0,w,h]`。 */
function paintNineSlice(
  context: CanvasRenderingContext2D,
  bitmap: ImageBitmap,
  inner: Box,
  destination: Box,
  pixelScale: number,
): void {
  const width = Math.max(1, Math.round(destination.width * pixelScale))
  const height = Math.max(1, Math.round(destination.height * pixelScale))
  const canvas = nineSliceBuffer()
  if (!(canvas.width >= width + 2)) canvas.width = width + 2
  if (!(canvas.height >= height + 2)) canvas.height = height + 2
  const bufferContext = canvas.getContext("2d")
  if (!bufferContext) return
  bufferContext.clearRect(0, 0, canvas.width, canvas.height)
  bufferContext.imageSmoothingEnabled = true
  bufferContext.imageSmoothingQuality = "high"

  const sourceWidth = bitmap.width
  const sourceHeight = bitmap.height
  const xs = [0, inner.x, inner.x + inner.width, sourceWidth]
  const ys = [0, inner.y, inner.y + inner.height, sourceHeight]
  const dx = nineSliceAxis(width, inner.x, sourceWidth - inner.x - inner.width)
  const dy = nineSliceAxis(height, inner.y, sourceHeight - inner.y - inner.height)
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      const fromWidth = xs[column + 1] - xs[column]
      const fromHeight = ys[row + 1] - ys[row]
      const toWidth = dx[column + 1] - dx[column]
      const toHeight = dy[row + 1] - dy[row]
      if (fromWidth <= 0 || fromHeight <= 0 || toWidth <= 0 || toHeight <= 0) continue
      bufferContext.drawImage(bitmap, xs[column], ys[row], fromWidth, fromHeight, dx[column], dy[row], toWidth, toHeight)
    }
  }
  context.drawImage(canvas as CanvasImageSource, 0, 0, width, height, destination.x, destination.y, destination.width, destination.height)
}

/** `edges` 的内缩换算成源图坐标的内框。 */
function edgesInner(layer: Extract<SkinLayer, { kind: "image" }>, bitmap: ImageBitmap): Box | undefined {
  const stretch = layer.stretch
  if (!stretch) return
  if (stretch.kind === "region") return stretch.inner
  if (stretch.kind !== "nine-slice") return
  const { left, top, right, bottom } = stretch.edges
  return { x: left, y: top, width: bitmap.width - left - right, height: bitmap.height - top - bottom }
}

function fontCss(style: TextStyle, size: number): string {
  return `${style.weight ? `${style.weight} ` : ""}${size}px ${canvasFontFamily(style.font)}`
}

/** 文字：按图层给的样式居中画；阴影照现行参数（`size/5` 模糊、向下偏移 `size`）。 */
function paintText(context: CanvasRenderingContext2D, layer: Extract<SkinLayer, { kind: "text" }>, destination: Box): void {
  const text = layer.text
  if (!text) return
  const style = layer.style
  const size = style.fontSize ?? Math.max(18, Math.min(42, destination.height * 0.25))
  context.save()
  context.font = fontCss(style, size)
  context.fillStyle = style.color ? colorCss(style.color) : "#17191c"
  context.textAlign = "center"
  context.textBaseline = "middle"
  const shadow = style.shadow
  if (shadow && shadow.size > 0 && !isTransparentColor(colorCss(shadow.color))) {
    context.shadowColor = colorCss(shadow.color)
    context.shadowBlur = shadow.size / 5
    context.shadowOffsetX = shadow.offset?.x ?? 0
    context.shadowOffsetY = shadow.offset?.y ?? shadow.size
  }
  context.fillText(text, destination.x + destination.width / 2, destination.y + destination.height / 2)
  context.restore()
}

/**
 * 画一个 IR 图层。
 *
 * `stretch` 由 `layer.stretch` 决定：缺省或 `none` 时按位图原尺寸居中（不放大），
 * 其余按九宫格/区域拉伸填满目标框。
 */
export function paintLayer(
  context: CanvasRenderingContext2D,
  layer: SkinLayer,
  bitmap: ImageBitmap | undefined,
  destination: Box,
  pixelScale = 1,
): void {
  if (layer.kind === "color") {
    if (isTransparentColor(colorCss(layer.value))) return
    context.fillStyle = colorCss(layer.value)
    context.fillRect(destination.x, destination.y, destination.width, destination.height)
    return
  }
  if (layer.kind === "text") {
    paintText(context, layer, destination)
    return
  }
  if (layer.kind === "border") {
    if (isTransparentColor(colorCss(layer.color))) return
    context.strokeStyle = colorCss(layer.color)
    context.lineWidth = Math.max(1, layer.width)
    context.strokeRect(destination.x + 0.5, destination.y + 0.5, destination.width - 1, destination.height - 1)
    return
  }
  if (layer.kind === "gradient") {
    const gradient = layer.direction === "horizontal"
      ? context.createLinearGradient(destination.x, destination.y, destination.x + destination.width, destination.y)
      : context.createLinearGradient(destination.x, destination.y, destination.x, destination.y + destination.height)
    for (const stop of layer.stops) gradient.addColorStop(stop.offset, colorCss(stop.color))
    context.fillStyle = gradient
    context.fillRect(destination.x, destination.y, destination.width, destination.height)
    return
  }
  if (layer.kind === "icon") {
    // 图标按位图原尺寸居中；`box`/`size` 的定位由调用方决定目标框。
    if (bitmap) paintPlainImage(context, bitmap, destination)
    return
  }
  if (layer.kind === "image") {
    if (!bitmap) return
    paintImage(context, layer, bitmap, destination, pixelScale)
  }
}

function paintPlainImage(context: CanvasRenderingContext2D, bitmap: ImageBitmap, destination: Box): void {
  context.drawImage(
    bitmap,
    0,
    0,
    bitmap.width,
    bitmap.height,
    destination.x + (destination.width - bitmap.width) / 2,
    destination.y + (destination.height - bitmap.height) / 2,
    bitmap.width,
    bitmap.height,
  )
}

function paintImage(
  context: CanvasRenderingContext2D,
  layer: Extract<SkinLayer, { kind: "image" }>,
  bitmap: ImageBitmap,
  destination: Box,
  pixelScale: number,
): void {
  const inner = edgesInner(layer, bitmap)
  const stretch = layer.stretch
  if (stretch && stretch.kind !== "none" && inner) {
    paintNineSlice(context, bitmap, inner, destination, pixelScale)
  } else if (stretch && stretch.kind !== "none") {
    // 有拉伸但拿不到内框时按整图拉伸填满。
    context.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, destination.x, destination.y, destination.width, destination.height)
  } else {
    // 不拉伸：按位图原尺寸居中，不放大。
    context.drawImage(
      bitmap,
      0,
      0,
      bitmap.width,
      bitmap.height,
      destination.x + (destination.width - bitmap.width) / 2,
      destination.y + (destination.height - bitmap.height) / 2,
      bitmap.width,
      bitmap.height,
    )
  }
  if (layer.tint && !isTransparentColor(colorCss(layer.tint))) {
    context.save()
    const tint = colorCss(layer.tint)
    const match = tint.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/)
    context.globalAlpha = match ? Math.max(0, Math.min(1, Number(match[1]))) : 1
    context.fillStyle = match ? `rgb(${match[1]}, ${match[2]}, ${match[3]})` : tint
    context.fillRect(destination.x, destination.y, destination.width, destination.height)
    context.restore()
  }
}

/** 把一张图层画进预览画布：背景填满，前景等比缩放并居中。 */
export function paintLayerPreview(
  canvas: HTMLCanvasElement,
  paint: { layer: SkinLayer; bitmap?: ImageBitmap } | undefined,
  foreground = false,
): void {
  const context = canvas.getContext("2d")
  if (!context) return
  context.clearRect(0, 0, canvas.width, canvas.height)
  if (!paint) return
  const box = { x: 0, y: 0, width: canvas.width, height: canvas.height }
  if (!foreground) {
    paintLayer(context, paint.layer, paint.bitmap, box)
    return
  }
  const width = paint.bitmap?.width ?? box.width
  const height = paint.bitmap?.height ?? box.height
  const fit = Math.min(1, box.width / width, box.height / height)
  paintLayer(context, paint.layer, paint.bitmap, {
    x: (box.width - width * fit) / 2,
    y: (box.height - height * fit) / 2,
    width: width * fit,
    height: height * fit,
  })
}
