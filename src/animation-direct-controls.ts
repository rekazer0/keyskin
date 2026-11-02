import { IniDocument } from "./ini.ts"
import { element } from "./dom-element.ts"
import { animationEasing } from "./preview-animation.ts"
import { animationHandlePoint, animationHandleValue, animationHandles, moveAnimationHandle, type AnimationHandle } from "./animation-direct-model.ts"
import { LEGACY_ANIMATION_INTPOL_OPTIONS, writeLegacyAnimationFields } from "./legacy-animation.ts"
import type { Rect } from "./preview-items.ts"

export type AnimationDirectEdit = { text: string; section: string; editable: boolean; commit(text: string): void }

type StageAPI = {
  stage: HTMLElement; timeline: HTMLElement; lanes: HTMLElement; key: Rect
  fit(): number
  duration(): number
  stop(): void
  preview(text: string, at: number): void
}

/** Gesture drafts stay inside the component. Only pointerup/change reaches the document history. */
export function animationDirectControls(edit: AnimationDirectEdit, api: StageAPI): { sync(): void } {
  let text = edit.text
  let before: string | undefined
  let active: HTMLElement | undefined
  const doc = () => IniDocument.parse(text)
  const pivot = () => {
    const document = doc(), raw = document.get(edit.section, "PIVOT")
    const values = (raw ?? document.get(edit.section, "PIVOT_PX") ?? "50,50").split(",").map((value) => Number(value) / (raw !== undefined ? 100 : document.get(edit.section, "PIVOT_PX") !== undefined ? 108 : 100))
    return values.length === 2 && values.every(Number.isFinite) ? values : [0.5, 0.5]
  }
  const handles = animationHandles(doc(), edit.section)
  const overlay = element("div", "ui-animation-handles")
  api.stage.append(overlay)
  const nodes = new Map<HTMLElement, AnimationHandle>()
  const tail = handles.find((handle) => handle.field === "DURATION")
  const extent = tail ? Math.max(400, api.duration() * 1.5) : api.duration()
  const fields = element("div", "ui-animation-direct-fields")
  const curve = element("canvas", "ui-animation-curve")
  curve.width = 320; curve.height = 96
  curve.setAttribute("aria-label", "插值曲线")
  const curveCodes = doc().get(edit.section, "INTPOL")
  if (curveCodes !== undefined && !handles.some((handle) => handle.field === "VELOCITY")) {
    const wrap = element("label", "ui-input ui-select")
    const select = element("select")
    select.setAttribute("aria-label", "运动曲线")
    select.disabled = !edit.editable
    select.append(...LEGACY_ANIMATION_INTPOL_OPTIONS.map(([value, label]) => new Option(label, value)))
    if (curveCodes.includes(",") || !LEGACY_ANIMATION_INTPOL_OPTIONS.some(([value]) => value === curveCodes)) select.append(new Option(`当前 ${curveCodes}`, curveCodes))
    select.value = curveCodes
    select.addEventListener("change", () => edit.commit(writeLegacyAnimationFields(text, edit.section, { INTPOL: select.value })))
    wrap.append(select)
    fields.append(curve, wrap)
  }
  const drawCurve = () => {
    if (!fields.contains(curve)) return
    const context = curve.getContext("2d")!, style = getComputedStyle(api.stage)
    context.clearRect(0, 0, curve.width, curve.height)
    context.strokeStyle = style.getPropertyValue("--line").trim()
    context.beginPath(); context.moveTo(8, 8); context.lineTo(8, 88); context.lineTo(312, 88); context.stroke()
    for (const [axis, code] of (doc().get(edit.section, "INTPOL") ?? "0").split(",").entries()) {
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
    for (const [node, original] of nodes) {
      const handle = animationHandles(doc(), edit.section).find((item) => item.field === original.field && item.index === original.index)!
      node.setAttribute("aria-valuenow", String(handle.value))
      node.setAttribute("aria-valuetext", `${handle.value} ${handle.unit}`)
      node.title = `${handle.label} · ${handle.value} ${handle.unit}`
      const short = handle.field === "DURATION" ? "单程" : handle.label.startsWith("缩放") || handle.label.startsWith("位移") ? handle.label.slice(-1) : handle.label.startsWith("方向") ? `角${handle.index ? "上" : "下"}` : handle.label.startsWith("速度") ? `速${handle.index ? "上" : "下"}` : handle.label
      node.textContent = `${short} ${handle.value}${handle.unit}`
      if (handle.field === "DURATION") node.style.left = `${Math.min(98, (Number(doc().get(edit.section, "DELAY") ?? 0) + handle.value) / extent * 100)}%`
      else if (handle.label !== "终止透明度") {
        const point = animationHandlePoint(handle, api.key, pivot())
        node.style.left = `${(160 + (point[0] - 160) * api.fit()) / 320 * 100}%`
        node.style.top = `${(80 + (point[1] - 80) * api.fit()) / 160 * 100}%`
      }
    }
    drawCurve()
  }
  const sample = () => {
    const document = doc(), time = handles.some((handle) => handle.field === "VELOCITY") ? 400 : Number(document.get(edit.section, "DELAY") ?? 0) + Number(document.get(edit.section, "DURATION") ?? 0) * 0.999
    api.preview(text, time)
    sync()
  }
  const cancel = () => {
    if (before === undefined) return
    text = before; before = undefined; active = undefined
    api.preview(text, 0); sync()
  }
  const finish = (node: HTMLElement) => {
    if (before === undefined) return
    const original = before; before = undefined; active = undefined
    if (text !== original) {
      edit.commit(text)
      // A parameter commit rebuilds the player; restore keyboard access to the equivalent handle.
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`.ui-animation-handle[data-field="${node.dataset.field}"][data-index="${node.dataset.index}"]`)?.focus())
    }
  }
  for (const handle of handles) {
    const node = element("button", "ui-button ui-animation-handle")
    node.type = "button"; node.disabled = !edit.editable
    node.dataset.field = handle.field; node.dataset.index = String(handle.index)
    node.setAttribute("role", "slider"); node.setAttribute("aria-label", handle.label)
    if (handle.min !== undefined) node.setAttribute("aria-valuemin", String(handle.min))
    if (handle.max !== undefined) node.setAttribute("aria-valuemax", String(handle.max))
    nodes.set(node, handle)
    if (handle.field === "DURATION") api.lanes.append(node)
    else if (handle.label === "终止透明度") fields.append(node)
    else overlay.append(node)
    node.addEventListener("pointerdown", (event) => {
      event.preventDefault(); event.stopPropagation(); api.stop()
      node.focus(); before = text; active = node; node.setPointerCapture(event.pointerId)
    })
    node.addEventListener("pointermove", (event) => {
      if (before === undefined || active !== node || !node.hasPointerCapture(event.pointerId)) return
      const box = (handle.field === "DURATION" ? api.lanes : api.stage).getBoundingClientRect()
      if (!box.width || !box.height) return
      let value: number
      if (handle.field === "DURATION") value = (event.clientX - box.left) / box.width * extent - Number(doc().get(edit.section, "DELAY") ?? 0)
      else if (handle.label === "终止透明度") value = (event.clientX - box.left) / box.width * 255
      else value = animationHandleValue(handle, [160 + ((event.clientX - box.left) / box.width * 320 - 160) / api.fit(), 80 + ((event.clientY - box.top) / box.height * 160 - 80) / api.fit()], api.key, pivot())
      text = moveAnimationHandle(text, edit.section, handle, Math.round(value))
      sample()
    })
    node.addEventListener("pointerup", (event) => { event.stopPropagation(); finish(node) })
    node.addEventListener("pointercancel", cancel)
    node.addEventListener("lostpointercapture", cancel)
    node.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.stopPropagation(); cancel(); return }
      if (!["ArrowLeft", "ArrowDown", "ArrowRight", "ArrowUp"].includes(event.key)) return
      event.preventDefault(); event.stopPropagation(); api.stop()
      before ??= text
      active = node
      const current = animationHandles(doc(), edit.section).find((item) => item.field === handle.field && item.index === handle.index)!
      text = moveAnimationHandle(text, edit.section, handle, current.value + (["ArrowRight", "ArrowUp"].includes(event.key) ? 1 : -1) * handle.step * (event.shiftKey ? 10 : 1))
      sample()
    })
    node.addEventListener("keyup", (event) => { if (event.key.startsWith("Arrow")) finish(node) })
    node.addEventListener("blur", () => { if (before !== undefined && active === node) finish(node) })
  }
  if (fields.childElementCount) api.timeline.append(fields)
  sync()
  return { sync }
}
