import { canvasFont, retinaThumbnail, type VisualResolver } from "./atlas.ts"
import { element } from "./dom-element.ts"
import { releaseOnRemove } from "./dom-lifecycle.ts"
import { createIcon } from "./icons.ts"

export const styleTypeOptions = [
  ["all", "全部类型"], ["image", "图片"], ["color", "颜色"], ["anim", "动画"],
  ["text", "文字"], ["sound", "声音"], ["empty", "空"],
] as const
export const styleUsageOptions = [
  ["all", "全部"], ["panel", "键盘背景"], ["key", "按键背景"], ["candidate", "候选栏"], ["foreground", "前景"],
] as const

export function styleMatches(item: { kind: string; categories: Iterable<string>; search: string; sound?: boolean }, kind: string, usage: string, query: string): boolean {
  return (kind === "all" || (kind === "sound" ? item.sound || item.kind === "sound" : item.kind === kind))
    && (usage === "all" || [...item.categories].includes(usage))
    && item.search.toLowerCase().includes(query.trim().toLowerCase().replace(/^#/, ""))
}

export function styleFilterButtons(options: readonly (readonly [string, string])[], attribute: string, selected: string, change: (value: string) => void): HTMLElement {
  const group = element("div", "ui-style-filters")
  group.setAttribute("role", "group")
  group.setAttribute("aria-label", attribute === "libraryKind" ? "按样式类型筛选" : "按当前布局用途筛选")
  for (const [value, label] of options) {
    const button = element("button", "ui-button")
    button.type = "button"
    button.dataset.variant = "quiet"
    button.dataset[attribute] = value
    button.setAttribute("aria-pressed", String(value === selected))
    button.textContent = label
    button.addEventListener("click", () => change(value))
    group.append(button)
  }
  return group
}

export async function textStyleSample(canvas: HTMLCanvasElement, resolver: VisualResolver, styleID: string, highlighted: boolean): Promise<void> {
  await resolver.ready?.()
  const text = resolver.resolveStyleText?.(styleID, highlighted)
  const visual = text ?? resolver.resolveText(styleID, highlighted)
  const context = canvas.getContext("2d")
  if (!context) return
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = visual?.color ?? getComputedStyle(canvas).getPropertyValue("--text").trim()
  // 字号随预览块高度缩放：保留样式间的大小差别，又不会在宽卡片里撑满或在窄卡片里小到看不清。
  context.font = canvasFont(Math.min(32, Math.max(16, visual?.fontSize ?? 24)) / 32 * canvas.height * 0.3, visual)
  context.textAlign = "center"
  context.textBaseline = "middle"
  context.fillText(text?.text || "键设 Aa", canvas.width / 2, canvas.height / 2, canvas.width - 16)
  canvas.setAttribute("aria-label", `${highlighted ? "按下" : "正常"}文字示例：${text?.text || "键设 Aa"}`)
}

// 几千个样式时缩略图进入视口才绘制，打开列表不必一次画完；尺寸按实际布局取，宽窄卡片都清晰。
const pendingDraws = new WeakMap<Element, () => void>()
const drawing: { observer?: IntersectionObserver } = {}
function drawObserver(): IntersectionObserver {
  return drawing.observer ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      drawing.observer?.unobserve(entry.target)
      pendingDraws.get(entry.target)?.()
      pendingDraws.delete(entry.target)
    }
  }, { rootMargin: "200px" })
}

/**
 * Both windows share this card structure. Visual styles show normal and pressed states; animation
 * previews use the same thumbnail player and styling in each window.
 */
export function styleCard(options: {
  id: string; label: string; kind: string; kindLabel: string; kindIcon: string
  info?: string
  /** Animation INFO on its own line; timing belongs in summary, never here. */
  subtitle?: string
  animationPreview?: boolean
  draw?: (canvas: HTMLCanvasElement, highlighted: boolean) => void | Promise<void>
  animation?: () => HTMLElement[]
  summary?: string
  sound?: () => HTMLElement
  canvas?: (width: number, height: number) => HTMLCanvasElement
}): HTMLElement {
  const card = element("div", "ui-style-card")
  card.tabIndex = 0
  card.setAttribute("role", "button")
  card.setAttribute("aria-pressed", "false")
  if (options.info || options.subtitle) card.title = [options.label, options.info, options.subtitle].filter(Boolean).join(" · ")
  card.dataset.styleKind = options.kind
  card.dataset.styleId = options.id
  card.addEventListener("keydown", event => {
    if (event.target === card && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); card.click() }
  })
  const heading = element("span", "ui-style-card-heading")
  const label = element("strong")
  label.textContent = options.label
  heading.append(label)
  if (options.info) {
    const info = element("span", "ui-style-card-info")
    info.textContent = options.info
    heading.append(info)
  }
  const badge = element("span", "ui-style-card-kind")
  badge.dataset.styleKind = options.kind
  badge.title = options.kindLabel
  badge.setAttribute("role", "img")
  badge.setAttribute("aria-label", options.kindLabel)
  badge.append(createIcon(options.kindIcon, 14))
  heading.append(badge)
  const previews = element("span", "ui-style-preview")
  if (options.kind === "anim" || options.animationPreview) {
    previews.dataset.variant = "animation"
    previews.title = options.summary || "动画引用缺失或未配置"
    previews.setAttribute("aria-label", previews.title)
    requestAnimationFrame(() => {
      if (card.isConnected) previews.append(...options.animation?.() ?? [])
    })
  } else if (options.kind === "empty") {
    previews.title = "暂无样式属性"
    previews.setAttribute("aria-label", previews.title)
  } else if (options.kind !== "sound") {
    const canvases = [false, true].map((highlighted) => {
      const state = element("span", "ui-style-state")
      state.dataset.state = highlighted ? "pressed" : "normal"
      const canvas = options.canvas?.(160, 80) ?? element("canvas")
      canvas.setAttribute("role", "img")
      canvas.setAttribute("aria-label", highlighted ? "按下状态" : "正常状态")
      state.append(canvas)
      previews.append(state)
      return canvas
    })
    if (options.draw) {
      pendingDraws.set(previews, () => canvases.forEach((canvas, highlighted) => {
        retinaThumbnail(canvas, canvas.clientWidth || 160, canvas.clientHeight || 80)
        void options.draw?.(canvas, Boolean(highlighted))
      }))
      drawObserver().observe(previews)
      releaseOnRemove(card, () => drawObserver().unobserve(previews))
    }
  }
  const caption = element("span", "ui-style-card-caption")
  caption.append(heading)
  if (options.subtitle?.trim()) {
    const subtitle = element("span", "ui-style-card-subtitle")
    subtitle.textContent = options.subtitle.trim()
    subtitle.title = subtitle.textContent
    caption.append(subtitle)
  }
  card.append(caption, previews)
  if (options.sound) (options.kind === "sound" ? previews : heading).append(options.sound())
  return card
}
