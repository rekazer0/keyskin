type NumberInputRoot = Document | HTMLElement
const NUMBER_WHEEL_IDLE_MS = 350
const SHIFT_STEPS = 10
const SCRUB_PX_PER_STEP = 2
const SCRUB_THRESHOLD_PX = 3

type WheelSession = {
  field: HTMLInputElement
  token: object
  mixed: boolean
  delta: number
  value: string
  committed: string
  dirty: boolean
  deferred: Map<unknown, () => void>
}
let dispatchSession: WheelSession | undefined
const finishers = new Set<() => void>()
const installed = new WeakSet<NumberInputRoot>()

/** Only synchronous writes caused by our input/change dispatch belong to the gesture. */
export function numberInputGesture(): object | undefined { return dispatchSession?.token }
export function flushNumberInputWheel(): void { for (const finish of finishers) finish() }
export function deferNumberInputRefresh(key: unknown, refresh: () => void): boolean {
  if (!dispatchSession) return false
  dispatchSession.deferred.set(key, refresh)
  return true
}

/** Number fields, and decimal text fields (values that may also be `rand(a,b)` or `inf`) while they hold a plain number. */
function isNumberField(input: HTMLInputElement): boolean {
  return input.type === "number" || input.type === "text" && input.inputMode === "decimal" && /^-?\d*\.?\d*$/.test(input.value.trim())
}

function isEditableNumberInput(target: EventTarget | null): target is HTMLInputElement {
  return target instanceof HTMLInputElement && isNumberField(target) && !target.disabled && !target.readOnly
}

function stepNumber(input: HTMLInputElement, steps: number): void {
  if (input.type === "number" && input.step !== "any") {
    input.stepUp(steps)
    return
  }
  const value = Number(input.value || 0) + steps * (Number(input.step) || 1)
  const min = input.min === "" ? -Infinity : Number(input.min)
  const max = input.max === "" ? Infinity : Number(input.max)
  input.value = String(Math.round(Math.min(max, Math.max(min, value)) * 1e6) / 1e6)
}

/** 可拖动调整数值的把手（单位前缀、行标签）对应的那一个数值输入框；有多个或不可编辑时不能拖。 */
export function scrubbableField(handle: Element): HTMLInputElement | undefined {
  const scope = handle.parentElement
  const fields = scope ? Array.from(scope.querySelectorAll("input")).filter(isNumberField) : []
  return fields.length === 1 && isEditableNumberInput(fields[0]) ? fields[0] : undefined
}

/** Immediate lightweight value feedback; one expensive input/change dispatch per frame. */
export function installNumberInputWheel(root: NumberInputRoot = document, options: {
  isMixed?: (field: HTMLInputElement) => boolean
  moveMixed?: (field: HTMLInputElement, steps: number) => void
} = {}): void {
  if (installed.has(root)) return
  installed.add(root)
  let session: WheelSession | undefined
  let frame = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const flush = () => {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    const current = session
    if (!current?.dirty) return
    current.dirty = false
    if (!current.field.isConnected || !isEditableNumberInput(current.field)) return
    const previous = dispatchSession
    dispatchSession = current
    try {
      if (current.mixed) {
        const delta = current.delta
        current.delta = 0
        if (delta) options.moveMixed?.(current.field, delta)
      } else if (current.value !== current.committed) {
        current.field.value = current.value
        current.committed = current.value
        current.field.dispatchEvent(new Event("input", { bubbles: true }))
        current.field.dispatchEvent(new Event("change", { bubbles: true }))
      }
    } finally { dispatchSession = previous }
  }
  const finish = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    try { flush() } finally {
      const ended = session
      session = undefined
      if (ended) for (const refresh of ended.deferred.values()) refresh()
    }
  }
  finishers.add(finish)
  // 一次连续手势（滚轮、拖动、Shift + 方向键）内：数值立即变化，每帧最多写回一次，结束后合成一步撤销。
  const nudge = (field: HTMLInputElement, steps: number) => {
    if (session?.field !== field) finish()
    session ??= { field, token: {}, mixed: options.isMixed?.(field) ?? false,
      delta: 0, value: field.value, committed: field.value, dirty: false, deferred: new Map() }
    if (session.mixed) session.delta += steps
    else {
      stepNumber(field, steps)
      session.value = field.value
    }
    session.dirty = true
    if (!frame) frame = requestAnimationFrame(flush)
  }
  const finishWhenIdle = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(finish, NUMBER_WHEEL_IDLE_MS)
  }
  root.addEventListener("wheel", (event) => {
    const wheel = event as WheelEvent
    if (wheel.defaultPrevented) return
    // 只有点进去（聚焦）的输入框才吃滚轮，否则滚轮照常滚动面板。
    if (!isEditableNumberInput(wheel.target) || wheel.target !== document.activeElement
      || wheel.ctrlKey || wheel.metaKey || !wheel.deltaY) {
      finish()
      return
    }
    wheel.preventDefault()
    nudge(wheel.target, wheel.deltaY < 0 ? 1 : -1)
    finishWhenIdle()
  }, { passive: false })
  // Shift + ↑/↓ 一次改 10（Figma、Blender 的习惯）；不带 Shift 时交给原生输入框。
  root.addEventListener("keydown", (event) => {
    const key = event as KeyboardEvent
    if (!key.shiftKey || key.defaultPrevented || (key.key !== "ArrowUp" && key.key !== "ArrowDown")) return
    if (!isEditableNumberInput(key.target)) return
    key.preventDefault()
    nudge(key.target, key.key === "ArrowUp" ? SHIFT_STEPS : -SHIFT_STEPS)
    flush()
    finishWhenIdle()
  })
  // 按住数值的标签或单位前缀左右拖动来调整（scrubbing）；按住 Shift 每格 10。没拖动就是普通点击，聚焦输入框。
  root.addEventListener("pointerdown", (event) => {
    const pointer = event as PointerEvent
    const handle = pointer.button === 0 ? (pointer.target as Element | null)?.closest?.<HTMLElement>("[data-scrub]") : null
    const field = handle ? scrubbableField(handle) : undefined
    if (!handle || !field) return
    pointer.preventDefault()
    if (document.activeElement instanceof HTMLElement && document.activeElement !== field) document.activeElement.blur()
    handle.setPointerCapture(pointer.pointerId)
    let lastX = pointer.clientX
    let rest = 0
    let moved = false
    const move = (moveEvent: PointerEvent) => {
      rest += moveEvent.clientX - lastX
      lastX = moveEvent.clientX
      if (!moved && Math.abs(rest) < SCRUB_THRESHOLD_PX) return
      if (!moved) handle.setAttribute("data-scrubbing", "")
      moved = true
      const steps = Math.trunc(rest / SCRUB_PX_PER_STEP)
      if (!steps) return
      rest -= steps * SCRUB_PX_PER_STEP
      nudge(field, steps * (moveEvent.shiftKey ? SHIFT_STEPS : 1))
    }
    const end = (endEvent: PointerEvent) => {
      handle.removeEventListener("pointermove", move)
      handle.removeEventListener("pointerup", end)
      handle.removeEventListener("pointercancel", end)
      handle.removeAttribute("data-scrubbing")
      if (handle.hasPointerCapture(pointer.pointerId)) handle.releasePointerCapture(pointer.pointerId)
      finish()
      if (moved) {
        // 拖完以后的 click 不再触发标签聚焦输入框。
        const swallow = (click: Event) => click.preventDefault()
        handle.addEventListener("click", swallow, { capture: true, once: true })
        setTimeout(() => handle.removeEventListener("click", swallow, { capture: true }), 0)
        return
      }
      // 手机上竖向滑动交给页面滚动（touch-action: pan-y），浏览器接管后发 pointercancel，不当作点击。
      if (endEvent.type === "pointercancel") return
      field.focus()
      field.select()
    }
    handle.addEventListener("pointermove", move)
    handle.addEventListener("pointerup", end)
    handle.addEventListener("pointercancel", end)
  })
  // Flush before selection, typing, save and undo handlers see the new context.
  root.addEventListener("pointerdown", finish, true)
  root.addEventListener("keydown", (event) => {
    const key = event as KeyboardEvent
    if (isEditableNumberInput(key.target) && (key.key === "Shift" || key.shiftKey && (key.key === "ArrowUp" || key.key === "ArrowDown"))) return
    finish()
  }, true)
  root.addEventListener("focusout", () => { if (!dispatchSession) finish() }, true)
  window.addEventListener("blur", finish)
  document.addEventListener("visibilitychange", () => { if (document.hidden) finish() })
}
