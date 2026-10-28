import { type StyleTextVisual, type Visual, canvasFont, isTransparentColor } from "./atlas.ts"
import { type Rect } from "./preview-items.ts"




type NineSliceCanvas = Pick<HTMLCanvasElement, "width" | "height" | "getContext">

let nineSliceBuffer: HTMLCanvasElement | undefined

export function setCanvasSize(
  canvas: Pick<HTMLCanvasElement, "width" | "height">,
  width: number,
  height: number,
): boolean {
  if (canvas.width === width && canvas.height === height) return false
  canvas.width = width
  canvas.height = height
  return true
}

export function constrainedCanvasSize(
  width: number,
  height: number,
  maxWidth = Number.POSITIVE_INFINITY,
  maxHeight = Number.POSITIVE_INFINITY,
): { width: number; height: number } {
  const safeWidth = Math.max(1, Math.round(width))
  const safeHeight = Math.max(1, Math.round(height))
  const scale = Math.min(1, maxWidth / safeWidth, maxHeight / safeHeight)
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  }
}

function sharedNineSliceBuffer(): HTMLCanvasElement {
  nineSliceBuffer ??= document.createElement("canvas")
  return nineSliceBuffer
}

function nineSliceAxis(size: number, leading: number, trailing: number): [number, number, number, number] {
  const fixed = leading + trailing
  const scale = fixed > size && fixed > 0 ? size / fixed : 1
  const first = Math.round(leading * scale)
  const second = Math.max(first, Math.round(size - trailing * scale))
  return [0, first, second, size]
}

export function drawNineSliceImage(
  context: Pick<CanvasRenderingContext2D, "drawImage">,
  visual: Visual,
  destination: Rect,
  createCanvas: () => NineSliceCanvas = sharedNineSliceBuffer,
): void {
  if (!visual.image || !visual.source || !visual.inner) return
  const [sx, sy, sw, sh] = visual.source
  const [ix, iy, iw, ih] = visual.inner
  const width = Math.max(1, Math.round(destination.width))
  const height = Math.max(1, Math.round(destination.height))
  // 此画布会被下一次绘制覆盖，不能作为不同样式或尺寸的缓存结果。
  // 只增不减：WebKit 每次改画布尺寸都重新分配 GPU 缓冲，逐键重设会让每次重绘分配几十次。
  const buffer = createCanvas()
  // Keep a transparent filtering margin even before the buffer first grows past this key.
  if (!(buffer.width >= width + 2)) buffer.width = width + 2
  if (!(buffer.height >= height + 2)) buffer.height = height + 2
  const bufferContext = buffer.getContext("2d")
  if (!bufferContext) return
  // Image filtering samples beyond the source crop; clear the retained buffer's old edge pixels too.
  bufferContext.clearRect(0, 0, buffer.width, buffer.height)
  bufferContext.imageSmoothingEnabled = true
  bufferContext.imageSmoothingQuality = "high"

  const xs = [0, ix, ix + iw, sw]
  const ys = [0, iy, iy + ih, sh]
  const dx = nineSliceAxis(width, ix, sw - ix - iw)
  const dy = nineSliceAxis(height, iy, sh - iy - ih)
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      const sourceWidth = xs[column + 1] - xs[column]
      const sourceHeight = ys[row + 1] - ys[row]
      const targetWidth = dx[column + 1] - dx[column]
      const targetHeight = dy[row + 1] - dy[row]
      if (sourceWidth <= 0 || sourceHeight <= 0 || targetWidth <= 0 || targetHeight <= 0) continue
      bufferContext.drawImage(
        visual.image,
        sx + xs[column],
        sy + ys[row],
        sourceWidth,
        sourceHeight,
        dx[column],
        dy[row],
        targetWidth,
        targetHeight,
      )
    }
  }
  context.drawImage(
    buffer as CanvasImageSource,
    0,
    0,
    width,
    height,
    destination.x,
    destination.y,
    destination.width,
    destination.height,
  )
}

export function drawListText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
): void {
  context.save()
  context.textAlign = "left"
  context.textBaseline = "alphabetic"
  const metrics = context.measureText(text)
  const values = [
    metrics.actualBoundingBoxAscent,
    metrics.actualBoundingBoxDescent,
    metrics.actualBoundingBoxLeft,
    metrics.actualBoundingBoxRight,
  ]
  if (
    values.every(Number.isFinite) &&
    metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent > 0
  ) {
    const cjkOffset = /^[，。？！]$/.test(text) &&
        metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight >= metrics.width * 0.8
      ? -metrics.width / 4
      : (metrics.actualBoundingBoxLeft - metrics.actualBoundingBoxRight) / 2
    context.fillText(
      text,
      x + cjkOffset,
      y + (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2,
    )
  } else {
    context.textAlign = "center"
    context.textBaseline = "middle"
    context.fillText(text, x, y)
  }
  context.restore()
}

export function foregroundLayerRect(
  key: Rect,
  source: [number, number, number, number] | undefined,
  offset?: [number, number],
): Rect {
  if (!source || !offset) return key
  const [, , width, height] = source
  return {
    x: key.x + (key.width - width) / 2 + offset[0],
    y: key.y + (key.height - height) / 2 + offset[1],
    width,
    height,
  }
}

export function foregroundTextPoint(rect: Rect, offset?: [number, number]): { x: number; y: number } {
  return {
    x: rect.x + rect.width / 2 + (offset?.[0] ?? 0),
    y: rect.y + rect.height / 2 + (offset?.[1] ?? 0),
  }
}

export function phoneForegroundVisual(visual: Visual | undefined): Visual | undefined {
  if (!visual?.image || !visual.source) return
  const { color: _, ...imageVisual } = visual
  return imageVisual
}

export function phoneForegroundLayers(visuals: Array<Visual | undefined>): Array<Visual | undefined> {
  return visuals.map(phoneForegroundVisual)
}

function drawNineSlice(    context: CanvasRenderingContext2D,
  visual: Visual,
  destination: Rect,
): void {
  drawNineSliceImage(context, visual, destination)
}

export function drawVisual(
  context: CanvasRenderingContext2D,
  visual: Visual | undefined,
  destination: Rect,
  stretch: boolean,
): void {
  if (!visual) return
  if (visual.color && !isTransparentColor(visual.color)) {
    context.fillStyle = visual.color
    context.fillRect(destination.x, destination.y, destination.width, destination.height)
  }
  if (!visual.image || !visual.source) {
    strokeBorder(context, visual, destination)
    return
  }
  if (stretch && visual.inner) {
    drawNineSlice(context, visual, destination)
  } else {
    const [sx, sy, sw, sh] = visual.source
    if (stretch) {
      context.drawImage(
        visual.image,
        sx,
        sy,
        sw,
        sh,
        destination.x,
        destination.y,
        destination.width,
        destination.height,
      )
    } else {
      context.drawImage(
        visual.image,
        sx,
        sy,
        sw,
        sh,
        destination.x + (destination.width - sw) / 2,
        destination.y + (destination.height - sh) / 2,
        sw,
        sh,
      )
    }
  }
  // BDA filterColor 是叠加在图片之上的颜色滤镜（tint），在图片之后绘制。
  if (visual.filterColor && !isTransparentColor(visual.filterColor)) {
    context.save()
    context.globalAlpha = filterAlpha(visual.filterColor)
    context.fillStyle = filterRgb(visual.filterColor)
    context.fillRect(destination.x, destination.y, destination.width, destination.height)
    context.restore()
  }
  strokeBorder(context, visual, destination)
}

/**
 * Baidu Android's input code bar background (`InputBarView`): `[INPUT] BACK_STYLE`'s NM_COLOR fills
 * the box, the style's image only when it has no colour (none, or 00000000); BORDER_COLOR edges the
 * left, top and right.
 */
export function drawInputBarBackground(
  context: CanvasRenderingContext2D,
  visual: Visual | undefined,
  width: number,
  height: number,
): void {
  if (!visual) return
  const box = { x: 0, y: 0, width, height }
  if (visual.color && visual.color !== "rgba(0, 0, 0, 0)") {
    if (!isTransparentColor(visual.color)) {
      context.fillStyle = visual.color
      context.fillRect(0, 0, width, height)
    }
  } else {
    drawVisual(context, { ...visual, borderColor: undefined }, box, true)
  }
  if (!visual.borderColor || isTransparentColor(visual.borderColor)) return
  context.strokeStyle = visual.borderColor
  context.lineWidth = 1
  context.beginPath()
  context.moveTo(0.5, height)
  context.lineTo(0.5, 0.5)
  context.lineTo(width - 0.5, 0.5)
  context.lineTo(width - 0.5, height)
  context.stroke()
}

function filterRgb(color: string): string {
  const match = color.match(/^rgba\(([^,]+),([^,]+),([^,]+),/)
  return match ? `rgb(${match[1]}, ${match[2]}, ${match[3]})` : color
}

function filterAlpha(color: string): number {
  const match = color.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/)
  return match ? Math.max(0, Math.min(1, Number(match[1]))) : 1
}

function strokeBorder(
  context: CanvasRenderingContext2D,
  visual: Visual,
  destination: Rect,
): void {
  if (!visual.borderColor || isTransparentColor(visual.borderColor)) return
  context.strokeStyle = visual.borderColor
  context.lineWidth = 1
  context.strokeRect(destination.x + 0.5, destination.y + 0.5, destination.width - 1, destination.height - 1)
}

export function withTransform(
  context: CanvasRenderingContext2D,
  rect: Rect,
  scale: readonly [number, number] | undefined,
  translation: readonly [number, number] | undefined,
  rotation: number | undefined,
  opacity: number | undefined,
  draw: () => void,
  pivot?: readonly [number, number],
): void {
  if (!scale && !translation && rotation === undefined && opacity === undefined) {
    draw()
    return
  }
  const [centerX, centerY] = pivot ?? [rect.x + rect.width / 2, rect.y + rect.height / 2]
  context.save()
  if (opacity !== undefined) context.globalAlpha *= opacity
  if (translation) context.translate(translation[0], translation[1])
  if (scale || rotation !== undefined) {
    context.translate(centerX, centerY)
    if (rotation !== undefined) context.rotate(rotation * Math.PI / 180)
    if (scale) context.scale(scale[0], scale[1])
    context.translate(-centerX, -centerY)
  }
  draw()
  context.restore()
}

export function drawStyleText(
  context: CanvasRenderingContext2D,
  visual: StyleTextVisual,
  point: { x: number; y: number },
  theme: "light" | "dark",
): void {
  context.fillStyle = visual.color ?? (theme === "dark" ? "#f5f5f7" : "#17191c")
  context.font = canvasFont(visual.fontSize ?? 24, visual)
  context.textAlign = "center"
  context.textBaseline = "middle"
  context.fillText(visual.text, point.x, point.y)
}
