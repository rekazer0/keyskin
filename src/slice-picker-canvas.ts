import type { TileSlice } from "./tiles.ts"
import { wheelZoomFactor } from "./wheel-zoom.ts"

// 超过浏览器画布尺寸上限会整张变白，按最长边限制
const MAX_CANVAS_SIDE = 8192
export const MIN_SLICE_ZOOM = 1
export const MAX_SLICE_ZOOM = 8
// 没有 TIL 切片时整张图作为唯一可选项，引用写成不带序号的图片名
export const WHOLE_IMAGE_INDEX = -1

export function pickableSlices(slices: TileSlice[], image: HTMLImageElement): TileSlice[] {
  return slices.length ? slices : [{ index: WHOLE_IMAGE_INDEX, source: [0, 0, image.naturalWidth, image.naturalHeight] }]
}

// 画布像素按 devicePixelRatio 分配，切片线和文字在高分屏上不再被拉伸发虚。
// cssScale 为每个原图像素对应的 CSS 像素；返回画布像素 / 原图像素，供点击换算。
export function drawSlicePicker(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  slices: TileSlice[],
  selectedIndex: number | undefined,
  cssScale: number,
  colors: { normal: string; selected: string },
): number {
  const context = canvas.getContext("2d")
  if (!context || !image.naturalWidth) return 1
  const dpr = window.devicePixelRatio || 1
  const scaleCap = MAX_CANVAS_SIDE / (Math.max(image.naturalWidth, image.naturalHeight) * dpr)
  const css = Math.min(cssScale, scaleCap)
  canvas.style.width = `${image.naturalWidth * css}px`
  canvas.style.height = `${image.naturalHeight * css}px`
  canvas.width = Math.max(1, Math.round(image.naturalWidth * css * dpr))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * css * dpr))
  const scale = canvas.width / image.naturalWidth
  context.clearRect(0, 0, canvas.width, canvas.height)
  // 放大后保留像素硬边，便于看清切片边界
  context.imageSmoothingEnabled = scale < 2
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const line = Math.max(1, Math.round(dpr))
  context.font = `${Math.round(11 * dpr)}px ui-monospace, monospace`
  context.textBaseline = "top"
  for (const slice of slices) {
    const [x, y, width, height] = slice.source
    const selected = slice.index === selectedIndex
    const lineWidth = selected ? line * 2 : line
    const left = Math.round(x * scale)
    const top = Math.round(y * scale)
    const right = Math.round((x + width) * scale)
    const bottom = Math.round((y + height) * scale)
    context.lineWidth = lineWidth
    context.strokeStyle = selected ? colors.selected : colors.normal
    // 描边落在整像素内侧，线条锐利且相邻切片不互相覆盖
    context.strokeRect(left + lineWidth / 2, top + lineWidth / 2, Math.max(0, right - left - lineWidth), Math.max(0, bottom - top - lineWidth))
    const label = slice.index === WHOLE_IMAGE_INDEX ? "整张图" : `IMG${slice.index}`
    context.fillStyle = context.strokeStyle
    context.fillRect(left, top, context.measureText(label).width + 6 * dpr, Math.round(15 * dpr))
    context.fillStyle = "#fff"
    context.fillText(label, left + 3 * dpr, top + 2 * dpr)
  }
  return scale
}

// ⌘/Ctrl + 滚轮、触控板捏合（Chromium 发 ctrl+wheel，WebKit 发 gesture 事件）缩放，指针下的位置保持不动。
// zoomBy 收到倍率后自行限制范围并重绘。
export function bindSlicePickerZoom(stage: HTMLElement, canvas: HTMLCanvasElement, zoomBy: (factor: number) => void): void {
  const zoomAt = (factor: number, clientX: number, clientY: number) => {
    const before = canvas.getBoundingClientRect()
    const fx = (clientX - before.left) / before.width
    const fy = (clientY - before.top) / before.height
    zoomBy(factor)
    const after = canvas.getBoundingClientRect()
    stage.scrollLeft += after.left + fx * after.width - clientX
    stage.scrollTop += after.top + fy * after.height - clientY
  }
  stage.addEventListener("wheel", (event) => {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    zoomAt(wheelZoomFactor(event), event.clientX, event.clientY)
  }, { passive: false })
  // 触屏：单指拖动平移，双指捏合缩放（同时跟随两指中点平移）
  const touches = new Map<number, { x: number; y: number }>()
  const pinch = () => {
    const [a, b] = [...touches.values()]
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) }
  }
  stage.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "touch") touches.set(event.pointerId, { x: event.clientX, y: event.clientY })
  })
  stage.addEventListener("pointermove", (event) => {
    const last = touches.get(event.pointerId)
    if (!last) return
    const before = touches.size === 2 ? pinch() : undefined
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (before) {
      const after = pinch()
      stage.scrollLeft -= after.x - before.x
      stage.scrollTop -= after.y - before.y
      if (before.distance) zoomAt(after.distance / before.distance, after.x, after.y)
    } else if (touches.size === 1) {
      stage.scrollLeft -= event.clientX - last.x
      stage.scrollTop -= event.clientY - last.y
    }
  })
  for (const type of ["pointerup", "pointercancel"]) stage.addEventListener(type, (event) => touches.delete((event as PointerEvent).pointerId))
  let gestureScale = 1
  type GestureEvent = UIEvent & { scale: number; clientX: number; clientY: number }
  stage.addEventListener("gesturestart", (event) => {
    event.preventDefault()
    gestureScale = 1
  })
  stage.addEventListener("gesturechange", (event) => {
    event.preventDefault()
    if (touches.size > 1) return
    const gesture = event as GestureEvent
    zoomAt(gesture.scale / gestureScale, gesture.clientX, gesture.clientY)
    gestureScale = gesture.scale
  })
}
