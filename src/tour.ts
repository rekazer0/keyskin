import { createIcon } from "./icons.ts"

/** 引导里的一步。 */
export interface TourStep {
  /** 高亮的目标，取第一个可见的元素；不填时说明卡片居中显示。 */
  target?: string[]
  title: string
  body: string
  /** 需要用户亲手点击高亮处才继续：`hint` 提示要点什么，`done()` 成立后自动进入下一步。 */
  action?: { hint: string; done: () => boolean }
  /** 返回 false 时跳过本步（例如还没打开皮肤）。 */
  when?: () => boolean
  /** 离开本步时调用（收起菜单等）。 */
  leave?: () => void
}

interface TourRect { x: number; y: number; width: number; height: number }
interface Size { width: number; height: number }

const GAP = 12
const MARGIN = 16
const HOLE_PADDING = 4

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max))

/** 说明卡片依次尝试放在目标的下方、上方、右侧、左侧；都放不下（目标占了大半屏）时贴在离目标较远的一端。 */
export function placeTourCard(target: TourRect | undefined, card: Size, viewport: Size): { x: number; y: number } {
  const centerX = clamp(viewport.width / 2 - card.width / 2, MARGIN, viewport.width - card.width - MARGIN)
  if (!target) return { x: centerX, y: clamp(viewport.height / 2 - card.height / 2, MARGIN, viewport.height - card.height - MARGIN) }
  const bottom = target.y + target.height
  const right = target.x + target.width
  const alongX = clamp(target.x + target.width / 2 - card.width / 2, MARGIN, viewport.width - card.width - MARGIN)
  const alongY = clamp(target.y + target.height / 2 - card.height / 2, MARGIN, viewport.height - card.height - MARGIN)
  if (bottom + GAP + card.height <= viewport.height - MARGIN) return { x: alongX, y: bottom + GAP }
  if (target.y - GAP - card.height >= MARGIN) return { x: alongX, y: target.y - GAP - card.height }
  if (right + GAP + card.width <= viewport.width - MARGIN) return { x: right + GAP, y: alongY }
  if (target.x - GAP - card.width >= MARGIN) return { x: target.x - GAP - card.width, y: alongY }
  const nearTop = target.y + target.height / 2 < viewport.height / 2
  return { x: centerX, y: nearTop ? viewport.height - card.height - MARGIN : MARGIN }
}

function visibleTarget(selectors: string[] | undefined): HTMLElement | undefined {
  for (const selector of selectors ?? []) {
    for (const element of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      const rect = element.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) return element
    }
  }
  return undefined
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

function place(node: HTMLElement, x: number, y: number, width: number, height: number): void {
  node.style.left = `${x}px`
  node.style.top = `${y}px`
  node.style.width = `${Math.max(0, width)}px`
  node.style.height = `${Math.max(0, height)}px`
}

/**
 * 逐步高亮界面元素并显示说明。遮罩只挖空当前目标；要求点击的步骤允许点穿挖空处，其余步骤挡住页面。
 * `busy()` 为真时（有弹窗或文件操作中）整层隐藏，结束后再回来。返回停止函数。
 */
export function runTour(steps: TourStep[], options: { busy: () => boolean; onEnd: (completed: boolean) => void }): () => void {
  const root = element("div", "ui-tour")
  const shades = ["top", "right", "bottom", "left"].map((edge) => {
    const shade = element("div", "ui-tour-shade")
    shade.dataset.edge = edge
    return shade
  })
  const block = element("div", "ui-tour-block")
  const ring = element("div", "ui-tour-ring")
  const card = element("section", "ui-tour-card")
  card.setAttribute("role", "dialog")
  card.setAttribute("aria-labelledby", "ui-tour-title")
  card.setAttribute("aria-describedby", "ui-tour-body")
  card.tabIndex = -1
  const counter = element("span", "ui-tour-step")
  const close = element("button", "ui-icon-button")
  close.type = "button"
  close.dataset.size = "sm"
  close.title = "退出教程"
  close.setAttribute("aria-label", "退出教程")
  close.append(createIcon("x"))
  const header = element("header")
  header.append(counter, close)
  const title = element("h2")
  title.id = "ui-tour-title"
  const body = element("p")
  body.id = "ui-tour-body"
  const action = element("p", "ui-tour-action")
  const actionText = element("span")
  action.append(createIcon("pointer"), actionText)
  const back = element("button", "ui-button", "上一步")
  back.type = "button"
  back.dataset.variant = "quiet"
  const next = element("button", "ui-button")
  next.type = "button"
  const footer = element("footer")
  footer.append(back, next)
  card.append(header, title, body, action, footer)
  root.append(...shades, block, ring, card)

  let index = -1
  let target: HTMLElement | undefined
  let frame = 0
  let lastGeometry = ""
  const applicable = (step: TourStep) => step.when?.() !== false && !step.action?.done()

  const end = (completed: boolean) => {
    steps[index]?.leave?.()
    stop()
    options.onEnd(completed)
  }

  const go = (from: number, direction: 1 | -1) => {
    let candidate = from
    while (steps[candidate] && !applicable(steps[candidate])) candidate += direction
    if (!steps[candidate]) {
      if (direction > 0) end(true)
      return
    }
    steps[index]?.leave?.()
    index = candidate
    render()
  }

  const render = () => {
    const step = steps[index]
    counter.textContent = `${index + 1} / ${steps.length}`
    title.textContent = step.title
    body.textContent = step.body
    action.hidden = !step.action
    actionText.textContent = step.action?.hint ?? ""
    root.toggleAttribute("data-action", Boolean(step.action))
    back.hidden = !steps.slice(0, index).some(applicable)
    const last = !steps.slice(index + 1).some(applicable)
    next.textContent = step.action ? "跳过这步" : index === 0 ? "开始" : last ? "完成" : "下一步"
    next.dataset.variant = step.action ? "quiet" : "primary"
    target = visibleTarget(step.target)
    target?.scrollIntoView({ block: "nearest", inline: "nearest" })
    lastGeometry = ""
    layout()
    ;(step.action ? card : next).focus({ preventScroll: true })
  }

  const layout = () => {
    const step = steps[index]
    if (!target?.isConnected || !target.getClientRects().length) target = visibleTarget(step.target)
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    const rect = target?.getBoundingClientRect()
    const hole = rect && {
      x: clamp(rect.x - HOLE_PADDING, 0, viewport.width),
      y: clamp(rect.y - HOLE_PADDING, 0, viewport.height),
      right: clamp(rect.right + HOLE_PADDING, 0, viewport.width),
      bottom: clamp(rect.bottom + HOLE_PADDING, 0, viewport.height),
    }
    const cardSize = { width: card.offsetWidth, height: card.offsetHeight }
    const geometry = JSON.stringify([hole, viewport, cardSize])
    if (geometry === lastGeometry) return
    lastGeometry = geometry
    ring.hidden = !hole
    block.hidden = !hole
    if (hole) {
      const holeWidth = hole.right - hole.x
      const holeHeight = hole.bottom - hole.y
      place(shades[0], 0, 0, viewport.width, hole.y)
      place(shades[1], hole.right, hole.y, viewport.width - hole.right, holeHeight)
      place(shades[2], 0, hole.bottom, viewport.width, viewport.height - hole.bottom)
      place(shades[3], 0, hole.y, hole.x, holeHeight)
      place(block, hole.x, hole.y, holeWidth, holeHeight)
      place(ring, hole.x, hole.y, holeWidth, holeHeight)
    } else {
      place(shades[0], 0, 0, viewport.width, viewport.height)
      for (const shade of shades.slice(1)) place(shade, 0, 0, 0, 0)
    }
    const position = placeTourCard(hole && { x: hole.x, y: hole.y, width: hole.right - hole.x, height: hole.bottom - hole.y }, cardSize, viewport)
    card.style.left = `${position.x}px`
    card.style.top = `${position.y}px`
  }

  const tick = () => {
    frame = requestAnimationFrame(tick)
    if (steps[index].action?.done()) {
      go(index + 1, 1)
      return
    }
    root.hidden = options.busy()
    if (!root.hidden) layout()
  }

  const onKeydown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || root.hidden || event.isComposing) return
    event.preventDefault()
    event.stopPropagation()
    end(false)
  }
  // 遮罩上的按下不传到页面，以免收起正在介绍的菜单。
  root.addEventListener("pointerdown", (event) => event.stopPropagation())
  close.addEventListener("click", () => end(false))
  back.addEventListener("click", () => go(index - 1, -1))
  next.addEventListener("click", () => go(index + 1, 1))
  window.addEventListener("keydown", onKeydown, true)

  function stop(): void {
    cancelAnimationFrame(frame)
    window.removeEventListener("keydown", onKeydown, true)
    root.remove()
  }

  document.body.append(root)
  go(0, 1)
  if (root.isConnected) frame = requestAnimationFrame(tick)
  return stop
}
