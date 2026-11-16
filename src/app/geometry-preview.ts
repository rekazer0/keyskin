import { element } from "../dom-element.ts"
import { retinaThumbnail } from "../atlas.ts"
import { releaseOnRemove } from "../dom-lifecycle.ts"
import type { Rect } from "../preview-items.ts"

/** 按真实选区绘制；拖动只改临时示意，松开才提交一次修改。 */
export function geometryPreview(original: Rect[], commit?: (rects: Rect[]) => void): HTMLElement {
  const root = element("div", "ui-geometry-preview")
  const canvas = element("canvas")
  canvas.setAttribute("role", "img")
  const box = element("div", "ui-geometry-box")
  root.append(canvas, box)
  let rects = original.map(rect => ({ ...rect }))
  const bounds = (values: Rect[]) => {
    const x = Math.min(...values.map(rect => rect.x)), y = Math.min(...values.map(rect => rect.y))
    return { x, y, width: Math.max(...values.map(rect => rect.x + rect.width)) - x, height: Math.max(...values.map(rect => rect.y + rect.height)) - y }
  }
  let scale = 1
  let drag: { id: number; x: number; y: number; corner: string; scale: number; rects: Rect[] } | undefined
  const draw = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight
    if (!w || !h) return
    const context = canvas.getContext("2d")
    if (!context) return
    // 缓冲尺寸不变时会保留变换，清屏和重绘前必须重置，避免高 DPI 缩放逐帧累积。
    context.resetTransform()
    retinaThumbnail(canvas, w, h)
    context.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0)
    const style = getComputedStyle(root), selection = bounds(rects)
    const inset = Number.parseFloat(style.getPropertyValue("--space-lg"))
    scale = drag?.scale ?? Math.min((w - inset * 2) / Math.max(1, selection.width), (h - inset * 2) / Math.max(1, selection.height))
    // 内边距控件保留可操作空间，极扁的按键仍按实际数值修改。
    const width = Math.min(w - inset * 2, Math.max(selection.width * scale, Number.parseFloat(style.getPropertyValue("--geometry-box-min-width"))))
    const height = Math.min(h - inset * 2, Math.max(selection.height * scale, Number.parseFloat(style.getPropertyValue("--geometry-box-min-height"))))
    const x = (w - width) / 2, y = (h - height) / 2
    Object.assign(box.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` })
    context.strokeStyle = style.getPropertyValue("--accent").trim()
    context.fillStyle = style.getPropertyValue("--panel").trim()
    context.fillRect(x, y, width, height)
    context.strokeRect(x, y, width, height)
    if (rects.length > 1) for (const rect of rects) {
      context.strokeRect(x + (rect.x - selection.x) * width / Math.max(1, selection.width), y + (rect.y - selection.y) * height / Math.max(1, selection.height), rect.width * width / Math.max(1, selection.width), rect.height * height / Math.max(1, selection.height))
    }
    context.fillStyle = style.getPropertyValue("--accent").trim()
    context.font = `${style.getPropertyValue("--font-size-xs")} ${style.getPropertyValue("--font-mono")}`
    context.textAlign = "center"
    context.textBaseline = "middle"
    context.fillText(`${selection.width} × ${selection.height}`, w / 2, h / 2)
    canvas.setAttribute("aria-label", `${rects.length > 1 ? `已选 ${rects.length} 个按键，` : ""}位置 ${selection.x}, ${selection.y}，尺寸 ${selection.width} × ${selection.height}`)
  }
  const change = (values: Rect[], corner: string, dx: number, dy: number) => {
    const before = bounds(values)
    const width = Math.max(1, before.width + (corner.includes("w") ? -dx : dx))
    const height = Math.max(1, before.height + (corner.includes("n") ? -dy : dy))
    const x = before.x + (corner.includes("w") ? before.width - width : 0)
    const y = before.y + (corner.includes("n") ? before.height - height : 0)
    rects = values.map(rect => ({
      x: Math.round(x + (rect.x - before.x) * width / Math.max(1, before.width)),
      y: Math.round(y + (rect.y - before.y) * height / Math.max(1, before.height)),
      width: Math.max(1, Math.round(rect.width * width / Math.max(1, before.width))),
      height: Math.max(1, Math.round(rect.height * height / Math.max(1, before.height))),
    }))
    draw()
  }
  if (commit) for (const [corner, label] of [["nw", "左上"], ["ne", "右上"], ["sw", "左下"], ["se", "右下"]]) {
    const handle = element("button", "ui-geometry-handle")
    handle.type = "button"
    handle.dataset.corner = corner
    handle.setAttribute("aria-label", `${label}缩放，方向键调整尺寸`)
    handle.addEventListener("pointerdown", event => {
      if (event.button !== 0 || drag) return
      event.preventDefault()
      handle.focus({ preventScroll: true })
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, corner, scale, rects: rects.map(rect => ({ ...rect })) }
      handle.setPointerCapture(event.pointerId)
    })
    handle.addEventListener("pointermove", event => {
      if (!drag || drag.id !== event.pointerId) return
      change(drag.rects, drag.corner, Math.round((event.clientX - drag.x) / drag.scale), Math.round((event.clientY - drag.y) / drag.scale))
    })
    const finish = (event: PointerEvent) => {
      if (!drag || drag.id !== event.pointerId) return
      const before = drag.rects
      drag = undefined
      if (event.type !== "pointerup") rects = before
      draw()
      if (JSON.stringify(before) !== JSON.stringify(rects)) commit(rects)
    }
    handle.addEventListener("pointerup", finish)
    handle.addEventListener("pointercancel", finish)
    handle.addEventListener("lostpointercapture", finish)
    handle.addEventListener("keydown", event => {
      if (!event.key.startsWith("Arrow")) return
      event.preventDefault()
      const step = event.shiftKey ? 10 : 1
      change(rects, corner, event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0, event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0)
      const parent = root.closest("#quick-inspector") ?? root.parentElement
      commit(rects)
      Array.from(parent?.querySelectorAll<HTMLButtonElement>(`.ui-geometry-handle[data-corner="${corner}"]`) ?? []).find(button => button.getClientRects().length)?.focus({ preventScroll: true })
    })
    box.append(handle)
  }
  const resize = new ResizeObserver(draw)
  resize.observe(canvas)
  const theme = new MutationObserver(draw)
  theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-app-theme", "data-accent", "style"] })
  releaseOnRemove(canvas, () => { resize.disconnect(); theme.disconnect(); canvas.width = canvas.height = 0 })
  return root
}
