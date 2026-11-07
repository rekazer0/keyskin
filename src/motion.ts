/**
 * 动效辅助（DESIGN.md §6）：时长与曲线从 tokens.css 读取；原生 progress.value 由 animateProgress 插值。
 * prefers-reduced-motion 下 tokens 把时长归零，动画随之跳过。
 */

type Duration = "fast" | "base" | "slow"
type Ease = "standard" | "emphasized"

function timing(duration: Duration, ease: Ease): KeyframeAnimationOptions | undefined {
  const style = getComputedStyle(document.documentElement)
  const ms = Number.parseFloat(style.getPropertyValue(`--duration-${duration}`))
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
  if (target >= progress.max) {
    if (motion.frame) cancelAnimationFrame(motion.frame)
    motion.frame = 0
    progress.value = target
    updated(target)
    return
  }
  if (motion.frame) return

  const duration = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--duration-base"))
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

/** 内容换了一批（换选择对象、换设置页）时淡入；连续触发时只保留最后一次。 */
export function playEnter(element: Element | null | undefined): void {
  if (!element) return
  const options = timing("base", "standard")
  if (!options) return
  entering.get(element)?.cancel()
  entering.set(element, element.animate([{ opacity: 0 }, { opacity: 1 }], options))
}

/**
 * 关闭 .ui-dialog：先淡出（入场由 components.css 的 ui-dialog-in 播放），再 close(value)。
 * 时长为 0 时直接关；淡出途中再次调用不重复播放。
 */
const closing = new WeakSet<HTMLDialogElement>()

export function closeDialog(dialog: HTMLDialogElement, value?: string): void {
  if (!dialog.open || closing.has(dialog)) return
  const options = timing("base", "standard")
  if (!options) return dialog.close(value)
  closing.add(dialog)
  const fade = { ...options, fill: "forwards" as const }
  const animations = [
    dialog.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(0.98)" }], fade),
    dialog.animate([{ opacity: 1 }, { opacity: 0 }], { ...fade, pseudoElement: "::backdrop" }),
  ]
  animations[0]!.addEventListener("finish", () => {
    closing.delete(dialog)
    dialog.close(value)
    for (const animation of animations) animation.cancel()
  })
}

// —— 分段控件：选中项切换时，滑块从旧选项滑到新选项 ——
// 只监听 aria-pressed / aria-selected 的变化（这两个属性很少变），不给每个控件单独挂观察者。

const SEGMENTED = ".ui-segmented:not([data-multiple])"
const ON = "true"

function boxIn(container: Element, element: Element): DOMRect {
  const outer = container.getBoundingClientRect()
  const inner = element.getBoundingClientRect()
  return new DOMRect(
    inner.left - outer.left - container.clientLeft + container.scrollLeft,
    inner.top - outer.top - container.clientTop + container.scrollTop,
    inner.width,
    inner.height,
  )
}

function slide(container: HTMLElement, from: DOMRect, target: HTMLElement): void {
  const options = timing("base", "emphasized")
  const to = boxIn(container, target)
  if (!options || !from.width || !to.width || (from.x === to.x && from.y === to.y)) return
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
    const previous = new Map<Element, DOMRect>()
    const targets = new Map<HTMLElement, HTMLElement>()
    for (const record of records) {
      const button = record.target as HTMLElement
      const container = button.parentElement
      if (!container?.matches(SEGMENTED)) continue
      if (record.oldValue === ON && button.getAttribute(record.attributeName!) !== ON && !previous.has(container)) {
        // 上一次滑动还没结束：从滑块当前的位置接着滑
        const thumb = container.querySelector(":scope > .ui-segment-thumb")
        previous.set(container, boxIn(container, thumb ?? button))
      } else if (record.oldValue !== ON && button.getAttribute(record.attributeName!) === ON) {
        targets.set(container, button)
      }
    }
    for (const [container, target] of targets) {
      const from = previous.get(container)
      if (from && target.isConnected) slide(container, from, target)
    }
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
