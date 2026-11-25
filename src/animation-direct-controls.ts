import { element } from "./dom-element.ts"
import { animationEasing } from "./preview-animation.ts"
import { animationHandlePoint, animationHandleValue, type AnimationHandle } from "./animation-direct-model.ts"
import { LEGACY_ANIMATION_INTPOL_OPTIONS } from "./legacy-animation.ts"
import type { PreviewClip } from "./animation-preview-model.ts"
import type { Rect } from "./preview-items.ts"

export type AnimationDirectEdit = {
  handles: AnimationHandle[]
  pivot?: readonly number[]
  delay?: number
  curve?: { codes: string; commit(value: string): void }
  preview(handle: AnimationHandle, value: number): PreviewClip
  commit(handle: AnimationHandle, value: number): void
}

type StageAPI = {
  stage: HTMLElement; timeline: HTMLElement; lanes: HTMLElement; docked?: boolean; key: Rect
  fit(): number
  extent(): number
  stop(): void
  preview(clip: PreviewClip | undefined, at: number): void
}

/** Gesture drafts stay inside the component. Only pointerup or keyup reaches document history. */
export function animationDirectControls(edit: AnimationDirectEdit, api: StageAPI): { sync(): void } {
  const { handles, pivot = [0.5, 0.5], delay = 0 } = edit
  let draft: { node: HTMLElement; handle: AnimationHandle; value: number; pointer?: number } | undefined
  const overlay = element("div", "ui-animation-handles")
  api.stage.append(overlay)
  const nodes = new Map<HTMLElement, AnimationHandle>()
  const fields = element("div", "ui-animation-direct-fields")
  let curve: HTMLCanvasElement | undefined
  const curveEdit = api.docked ? undefined : edit.curve
  const curveCodes = curveEdit?.codes
  if (curveEdit && curveCodes !== undefined && !handles.some((handle) => handle.field === "VELOCITY")) {
    curve = element("canvas", "ui-animation-curve")
    curve.width = 320; curve.height = 96
    curve.setAttribute("aria-label", "插值曲线")
    const wrap = element("label", "ui-input ui-select")
    const select = element("select")
    select.setAttribute("aria-label", "运动曲线")
    select.append(...LEGACY_ANIMATION_INTPOL_OPTIONS.map(([value, label]) => new Option(label, value)))
    if (curveCodes.includes(",") || !LEGACY_ANIMATION_INTPOL_OPTIONS.some(([value]) => value === curveCodes)) select.append(new Option(`当前 ${curveCodes}`, curveCodes))
    select.value = curveCodes
    select.addEventListener("change", () => curveEdit.commit(select.value))
    wrap.append(select)
    fields.append(curve, wrap)
  }
  const drawCurve = () => {
    if (!curve) return
    const context = curve.getContext("2d")!, style = getComputedStyle(api.stage)
    context.clearRect(0, 0, curve.width, curve.height)
    context.strokeStyle = style.getPropertyValue("--line").trim()
    context.beginPath(); context.moveTo(8, 8); context.lineTo(8, 88); context.lineTo(312, 88); context.stroke()
    for (const [axis, code] of (curveCodes ?? "0").split(",").entries()) {
      context.strokeStyle = style.getPropertyValue(axis ? "--secondary" : "--accent").trim()
      context.beginPath()
      for (let index = 0; index <= 80; index++) {
        const x = 8 + index / 80 * 304, y = 88 - animationEasing(Number(code), index / 80) * 80
        if (index) context.lineTo(x, y); else context.moveTo(x, y)
      }
      context.stroke()
    }
  }
  const sync = () => {
    const current = handles.map(handle => draft?.handle === handle ? { ...handle, value: draft.value } : handle)
    const axisY = api.docked && current.find(handle => handle.label.endsWith(" Y"))
    const axisYPoint = axisY ? animationHandlePoint(axisY, api.key, pivot) : undefined
    for (const [node, original] of nodes) {
      const handle = current.find((item) => item.field === original.field && item.index === original.index)!
      node.setAttribute("aria-valuenow", String(handle.value))
      node.setAttribute("aria-valuetext", `${handle.value} ${handle.unit}`)
      node.title = `${handle.label} · ${handle.value} ${handle.unit}`
      const short = handle.field === "DURATION" ? "单程" : handle.label.startsWith("缩放") || handle.label.startsWith("位移") ? handle.label.slice(-1) : handle.label.startsWith("方向") ? `角${handle.index ? "上" : "下"}` : handle.label.startsWith("速度") ? `速${handle.index ? "上" : "下"}` : handle.label
      node.textContent = `${short} ${handle.value}${handle.unit}`
      if (handle.field === "DURATION") node.style.left = `${Math.min(98, (delay + handle.value) / api.extent() * 100)}%`
      else if (handle.label !== "终止透明度") {
        const point = animationHandlePoint(handle, api.key, pivot)
        // Shift X only along the axis that doesn't affect its drag value.
        if (axisYPoint && handle.label.endsWith(" X")) node.dataset.offset = point[1] <= axisYPoint[1] ? "up" : "down"
        node.style.left = `${(160 + (point[0] - 160) * api.fit()) / 320 * 100}%`
        node.style.top = `${(80 + (point[1] - 80) * api.fit()) / 160 * 100}%`
      }
    }
    drawCurve()
  }
  const sample = (value: number) => {
    if (!draft || !Number.isFinite(value)) return
    const { handle } = draft
    const next = Math.max(handle.min ?? -Infinity, Math.min(handle.max ?? Infinity, Math.round(value * 100) / 100))
    if (next === draft.value) return
    draft.value = next
    const clip = edit.preview(handle, next)
    const particle = clip.particles[0]
    const time = particle ? particle.start + Math.min(400, particle.duration / 2) : delay + (clip.lanes[0]?.duration ?? 0) * 0.999
    api.preview(clip, time)
    sync()
  }
  const cancel = () => {
    if (!draft) return
    const { node, pointer } = draft
    draft = undefined
    if (pointer !== undefined && node.hasPointerCapture(pointer)) node.releasePointerCapture(pointer)
    api.preview(undefined, 0); sync()
  }
  const finish = (node: HTMLElement) => {
    if (draft?.node !== node) return
    const { handle, value } = draft
    draft = undefined
    if (value === handle.value) { api.preview(undefined, 0); sync(); return }
    const focused = document.activeElement === node
    const host = api.stage.closest("#animation-stage, #document-fields, #bda-config-fields")
    edit.commit(handle, value)
    // A parameter commit rebuilds the player; restore keyboard access to the equivalent handle.
    if (focused) requestAnimationFrame(() => {
      if (document.activeElement !== document.body) return
      host?.querySelector<HTMLElement>(`.ui-animation-handle[data-field="${node.dataset.field}"][data-index="${node.dataset.index}"]`)?.focus({ preventScroll: true })
    })
  }
  for (const handle of handles) {
    const node = element("button", "ui-button ui-animation-handle")
    node.type = "button"
    node.dataset.field = handle.field; node.dataset.index = String(handle.index)
    node.setAttribute("role", "slider"); node.setAttribute("aria-label", handle.label)
    if (handle.min !== undefined) node.setAttribute("aria-valuemin", String(handle.min))
    if (handle.max !== undefined) node.setAttribute("aria-valuemax", String(handle.max))
    nodes.set(node, handle)
    if (handle.field === "DURATION") api.lanes.append(node)
    else if (handle.label === "终止透明度") fields.append(node)
    else overlay.append(node)
    node.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || draft) return
      event.preventDefault(); event.stopPropagation(); api.stop()
      node.focus(); draft = { node, handle, value: handle.value, pointer: event.pointerId }; node.setPointerCapture(event.pointerId)
    })
    node.addEventListener("pointermove", (event) => {
      if (draft?.node !== node || draft.pointer !== event.pointerId || !node.hasPointerCapture(event.pointerId)) return
      const box = (handle.field === "DURATION" ? api.lanes : overlay).getBoundingClientRect()
      if (!box.width || !box.height) return
      let value: number
      if (handle.field === "DURATION") value = (event.clientX - box.left) / box.width * api.extent() - delay
      else if (handle.label === "终止透明度") value = (event.clientX - box.left) / box.width * (handle.max ?? 255)
      else value = animationHandleValue(handle, [160 + ((event.clientX - box.left) / box.width * 320 - 160) / api.fit(), 80 + ((event.clientY - box.top) / box.height * 160 - 80) / api.fit()], api.key, pivot)
      sample(Math.round(value))
    })
    node.addEventListener("pointerup", (event) => {
      if (draft?.pointer !== event.pointerId) return
      event.stopPropagation(); finish(node)
    })
    const cancelPointer = (event: PointerEvent) => { if (draft?.pointer === event.pointerId) cancel() }
    node.addEventListener("pointercancel", cancelPointer)
    node.addEventListener("lostpointercapture", cancelPointer)
    node.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && draft?.node === node) { event.stopPropagation(); cancel(); return }
      if (!["ArrowLeft", "ArrowDown", "ArrowRight", "ArrowUp"].includes(event.key)) return
      event.preventDefault(); event.stopPropagation(); api.stop()
      draft ??= { node, handle, value: handle.value }
      if (draft.node !== node || draft.pointer !== undefined) return
      sample(draft.value + (["ArrowRight", "ArrowUp"].includes(event.key) ? 1 : -1) * handle.step * (event.shiftKey ? 10 : 1))
    })
    node.addEventListener("keyup", (event) => { if (event.key.startsWith("Arrow") && draft?.pointer === undefined) finish(node) })
    node.addEventListener("blur", () => { if (draft?.node === node) draft.pointer === undefined ? finish(node) : cancel() })
  }
  if (fields.childElementCount) api.timeline.append(fields)
  sync()
  return { sync }
}
