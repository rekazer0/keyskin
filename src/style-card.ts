import { canvasFont, retinaThumbnail, type VisualResolver } from "./atlas"
import { element } from "./dom-element"
import { createIcon } from "./icons"

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
  context.font = canvasFont(Math.min(32, Math.max(16, visual?.fontSize ?? 24)), visual)
  context.textAlign = "center"
  context.textBaseline = "middle"
  context.fillText(text?.text || "键设 Aa", canvas.width / 2, canvas.height / 2, canvas.width - 16)
  canvas.setAttribute("aria-label", `${highlighted ? "按下" : "正常"}文字示例：${text?.text || "键设 Aa"}`)
}

/** Both windows supply data and actions; the card's structure and state previews stay identical. */
export function styleCard(options: {
  id: string; label: string; kind: string; kindLabel: string; kindIcon: string
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
  card.dataset.styleKind = options.kind
  card.dataset.styleId = options.id
  card.addEventListener("keydown", event => {
    if (event.target === card && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); card.click() }
  })
  const heading = element("span", "ui-style-card-heading")
  const label = element("strong")
  label.textContent = options.label
  const badge = element("span", "style-kind-badge")
  badge.dataset.styleKind = options.kind
  badge.append(createIcon(options.kindIcon, 14), options.kindLabel)
  heading.append(label, badge)
  const previews = element("span", "ui-style-preview")
  if (options.kind === "anim") {
    requestAnimationFrame(() => {
      if (card.isConnected) previews.prepend(...options.animation?.() ?? [])
    })
    const caption = element("small", "ui-style-caption")
    caption.textContent = options.summary || "动画引用缺失或未配置"
    caption.title = caption.textContent
    previews.append(caption)
  } else if (options.kind === "empty") {
    previews.append(createIcon("square-dashed", 20), "暂无样式属性")
  } else if (options.kind !== "sound") {
    for (const highlighted of [false, true]) {
      const state = element("span", "ui-style-state")
      const canvas = options.canvas?.(160, 88) ?? retinaThumbnail(element("canvas"), 160, 88)
      const label = element("small")
      label.textContent = highlighted ? "按下" : "正常"
      canvas.setAttribute("aria-label", `${label.textContent}状态`)
      state.append(canvas, label)
      previews.append(state)
      void options.draw?.(canvas, highlighted)
    }
  }
  card.append(heading, previews)
  if (options.sound) (options.kind === "sound" ? previews : card).append(options.sound())
  return card
}
