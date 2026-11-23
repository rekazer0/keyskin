/**
 * 动效辅助（DESIGN.md §6）：时长与曲线从 tokens.css 读取；原生 progress.value 由 animateProgress 插值。
 * prefers-reduced-motion 下 tokens 把时长归零，动画随之跳过。
 */

type Duration = "fast" | "base" | "slow"
type Ease = "standard" | "emphasized"

/** Production CSS can shorten a millisecond token to seconds (e.g. 500ms → .5s). */
export function cssTimeMs(value: string): number {
  const time = value.trim()
  return Number.parseFloat(time) * (time.endsWith("s") && !time.endsWith("ms") ? 1000 : 1)
}

function timing(duration: Duration, ease: Ease): KeyframeAnimationOptions | undefined {
  const style = getComputedStyle(document.documentElement)
  const ms = cssTimeMs(style.getPropertyValue(`--duration-${duration}`))
  if (!(ms > 0) || typeof Element.prototype.animate !== "function") return undefined
  return { duration: ms, easing: style.getPropertyValue(`--ease-${ease}`).trim() || "ease-out" }
}

const entering = new WeakMap<Element, Animation>()

type ProgressMotion = { frame: number; target: number; updated: (value: number) => void }
const progressMotions = new WeakMap<HTMLProgressElement, ProgressMotion>()

/** Progress events often arrive in chunks; keep one token-timed frame loop and retarget it. */
export function animateProgress(progress: HTMLProgressElement, target: number, updated: (value: number) => void): void {
  let motion = progressMotions.get(progress)
  if (!motion) {
    motion = { frame: 0, target, updated }
    progressMotions.set(progress, motion)
  }
  motion.target = target
  motion.updated = updated
  if (target >= progress.max || target === 0) {
    if (motion.frame) cancelAnimationFrame(motion.frame)
    motion.frame = 0
    progress.value = target
    updated(target)
    return
  }
  if (motion.frame) return

  const duration = cssTimeMs(getComputedStyle(document.documentElement).getPropertyValue("--duration-base"))
  if (!(duration > 0)) {
    progress.value = target
    updated(target)
    return
  }

  let previous = 0
  const tick = (now: number) => {
    const elapsed = previous ? Math.min(64, now - previous) : 16
    previous = now
    const difference = motion!.target - progress.value
    const value = Math.abs(difference) < 0.1
      ? motion!.target
      : progress.value + difference * (1 - Math.exp(-3 * elapsed / duration))
    const settled = Math.abs(motion!.target - value) < 0.1
    progress.value = settled ? motion!.target : value
    motion!.updated(progress.value)
    motion!.frame = settled ? 0 : requestAnimationFrame(tick)
  }
  motion.frame = requestAnimationFrame(tick)
}

/** 同一表面只保留最后一次反馈；减少动态效果时也取消旧动画。 */
function animateChange(element: Element, frames: Keyframe[]): void {
  entering.get(element)?.cancel()
  const options = timing("base", "standard")
  if (options) entering.set(element, element.animate(frames, options))
}

export function playEnter(element: Element | null | undefined): void {
  if (element) animateChange(element, [{ opacity: 0 }, { opacity: 1 }])
}

export function playPageSlide(element: Element, direction: -1 | 1): void {
  const offset = direction === 1 ? "var(--space-xl)" : "calc(-1 * var(--space-xl))"
  animateChange(element, [
    { opacity: 0, transform: `translateX(${offset})` },
    { opacity: 1, transform: "translateX(0)" },
  ])
}

export function playRotation(element: Element, fromDegrees: number): void {
  animateChange(element, [{ transform: `rotate(${fromDegrees}deg)` }, { transform: "rotate(0deg)" }])
}

/**
 * 关闭 .ui-dialog：先淡出（入场由 components.css 的 ui-dialog-in 播放），再 close(value)。
 * 时长为 0 时直接关；淡出途中再次调用不重复播放。
 */
const closing = new WeakMap<HTMLDialogElement, Promise<void>>()

export function closeDialog(dialog: HTMLDialogElement, value?: string): Promise<void> {
  const pending = closing.get(dialog)
  if (pending) return pending
  if (!dialog.open) return Promise.resolve()
  const options = timing("base", "standard")
  if (!options) { dialog.close(value); return Promise.resolve() }
  const fade = { ...options, fill: "forwards" as const }
  const travel = getComputedStyle(dialog).getPropertyValue("--_dialog-travel").trim()
  // 仅淡出的弹窗不声明 transform，避免把内部的固定定位元素移离视口坐标。
  const animations: Animation[] = []
  try {
    animations.push(dialog.animate([{ offset: 1, opacity: 0, ...(travel && travel !== "none" ? { transform: travel } : {}) }], fade))
    animations.push(dialog.animate([{ offset: 1, opacity: 0 }], { ...fade, pseudoElement: "::backdrop" }))
  } catch (error) {
    // WebView 74 rejects partial keyframes. Never block a dialog handoff for an animation.
    if (!(error instanceof DOMException)) throw error
    for (const animation of animations) animation.cancel()
    dialog.close(value)
    return Promise.resolve()
  }
  const finished = new Promise<void>(resolve => {
    // 窗口隐藏、节点被移除或外部取消动画，也必须结束关闭流程。
    const finish = () => {
      if (!closing.delete(dialog)) return
      if (dialog.open) dialog.close(value)
      for (const animation of animations) animation.cancel()
      resolve()
    }
    animations[0]!.addEventListener("finish", finish, { once: true })
    animations[0]!.addEventListener("cancel", finish, { once: true })
  })
  closing.set(dialog, finished)
  return finished
}

// —— 分段控件：选中项切换时，滑块从旧选项滑到新选项 ——
// 只监听 aria-pressed / aria-selected 的变化（这两个属性很少变），不给每个控件单独挂观察者。

const SEGMENTED = ".ui-segmented:not([data-multiple])"
const ON = "true"

function boxIn(container: Element, outer: DOMRect, element: Element): DOMRect {
  const inner = element.getBoundingClientRect()
  return new DOMRect(
    inner.left - outer.left - container.clientLeft + container.scrollLeft,
    inner.top - outer.top - container.clientTop + container.scrollTop,
    inner.width,
    inner.height,
  )
}

function slide(container: HTMLElement, from: DOMRect, to: DOMRect, options: KeyframeAnimationOptions): void {
  if (!from.width || !to.width || (from.x === to.x && from.y === to.y)) return
  container.querySelector(":scope > .ui-segment-thumb")?.remove()
  const thumb = document.createElement("div")
  thumb.className = "ui-segment-thumb"
  thumb.setAttribute("aria-hidden", "true")
  thumb.style.transform = `translate(${to.x}px, ${to.y}px)`
  thumb.style.width = `${to.width}px`
  thumb.style.height = `${to.height}px`
  container.prepend(thumb)
  container.dataset.sliding = ""
  const start = `translate(${from.x}px, ${from.y}px) scale(${from.width / to.width}, ${from.height / to.height})`
  const animation = thumb.animate([{ transform: start }, { transform: thumb.style.transform }], options)
  const finish = () => {
    if (!thumb.isConnected) return
    thumb.remove()
    delete container.dataset.sliding
  }
  animation.addEventListener("finish", finish)
  animation.addEventListener("cancel", finish)
}

export function initSegmentSlide(): void {
  const observer = new MutationObserver((records) => {
    const previous = new Map<HTMLElement, HTMLElement>()
    const targets = new Map<HTMLElement, HTMLElement>()
    for (const record of records) {
      const button = record.target as HTMLElement
      const container = button.parentElement
      if (!container?.matches(SEGMENTED)) continue
      if (record.oldValue === ON && button.getAttribute(record.attributeName!) !== ON && !previous.has(container)) {
        previous.set(container, button)
      } else if (record.oldValue !== ON && button.getAttribute(record.attributeName!) === ON) {
        targets.set(container, button)
      }
    }
    if (!previous.size || !targets.size) return
    const options = timing("base", "emphasized")
    if (!options) return
    // 先读完各组的几何，再统一写入滑块，避免组间交替布局。
    const slides: [HTMLElement, DOMRect, DOMRect][] = []
    for (const [container, target] of targets) {
      const source = previous.get(container)
      if (!source || !target.isConnected) continue
      const outer = container.getBoundingClientRect()
      if (!outer.width) continue
      const thumb = container.querySelector(":scope > .ui-segment-thumb")
      slides.push([container, boxIn(container, outer, thumb ?? source), boxIn(container, outer, target)])
    }
    for (const [container, from, to] of slides) slide(container, from, to, options)
  })
  observer.observe(document.body, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ["aria-pressed", "aria-selected"] })
}

/** 用户点开折叠组时，组内内容淡入；程序重建列表时自动展开的组不播放。 */
export function initDisclosureReveal(root: HTMLElement): void {
  root.addEventListener("click", (event) => {
    const summary = (event.target as Element | null)?.closest("summary")
    const group = summary?.parentElement
    if (!(group instanceof HTMLDetailsElement) || group.open || !root.contains(group)) return
    group.addEventListener("toggle", () => {
      if (!group.open) return
      for (const child of Array.from(group.children)) if (child !== summary) playEnter(child)
    }, { once: true })
  })
}

/** 整窗换色（浅色 / 深色）：交给 View Transitions 交叉淡化；不支持、后台或时长为 0 时直接切换。 */
export function crossfade(update: () => void): void {
  if (!("startViewTransition" in document) || document.visibilityState !== "visible" || !timing("slow", "standard")) {
    update()
    return
  }
  // 窗口尺寸变化等会中止过渡：主题已经换好，只是不播放淡化，中止不算错误。
  const transition = document.startViewTransition(update)
  transition.ready.catch(() => {})
  transition.finished.catch(() => {})
}
