import { canvasFont, canvasFontFamily, fontWeight, parseColor, retinaThumbnail, withTextShadow } from "../atlas.ts"
import { element } from "../dom-element.ts"
import { releaseOnRemove } from "../dom-lifecycle.ts"
import type { FontChoice } from "./font-picker"

/** 展示真实字段与字体；混合值或缺失字体明确提示，不用示例冒充当前文字。 */
export function typographyPreview(options: {
  text?: string; font: FontChoice; size?: string; unit?: string; weight?: string; color?: string; shadowColor?: string; shadowSize?: string; smooth?: string; mixed: boolean
}): HTMLElement {
  const root = element("div", "ui-typography-preview")
  root.setAttribute("role", "group")
  root.setAttribute("aria-label", "文字预览")
  const header = element("div", "ui-typography-preview-heading")
  const source = element("small")
  source.textContent = [options.font.label || "系统默认", options.size ? `${options.size} ${options.unit ?? "px"}` : ""].filter(Boolean).join(" · ")
  source.title = options.font.detail ?? source.textContent
  header.append(Object.assign(element("span"), { textContent: "预览" }), source)
  const canvas = element("canvas")
  canvas.setAttribute("role", "img")
  const tags = element("div", "ui-typography-preview-tags")
  const weight = fontWeight(options.weight)
  for (const text of [weight ? `字重 ${weight}` : "", options.color ? `#${options.color.replace(/^(?:0x|#)/i, "").slice(-6).toUpperCase()}` : "", options.smooth !== undefined ? `字体平滑 ${options.smooth === "0" ? "关" : "开"}` : "", options.shadowSize ? `阴影 ${options.shadowSize} px` : ""]) {
    if (text) tags.append(Object.assign(element("span", "ui-badge"), { textContent: text }))
  }
  root.append(header, canvas, tags)
  let generation = 0
  const draw = async () => {
    const token = ++generation
    canvas.setAttribute("aria-busy", "true")
    let failed = false
    try { await options.font.ready } catch { failed = true }
    if (!canvas.isConnected || token !== generation) return
    const loaded = !failed && !options.font.missing && (!options.font.ready || Array.from(document.fonts).some(face => face.family === options.font.family && face.status === "loaded"))
    const text = options.mixed ? "混合" : !loaded ? "字体无法预览" : options.text || "键设 Aa 123"
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    const context = retinaThumbnail(canvas, width, height).getContext("2d")
    if (!context) return
    const scale = canvas.width / Math.max(1, width)
    context.scale(scale, scale)
    const style = getComputedStyle(root)
    const size = Number(options.size) * (options.unit === "屏宽" ? width : 1) || Number.parseFloat(style.getPropertyValue("--typography-preview-font-size"))
    const visual = { fontName: options.font.family, weight, shadowColor: parseColor(options.shadowColor?.replace(/^0x/i, "")), shadowSize: Number(options.shadowSize) || 0 }
    context.font = canvasFont(size, visual)
    const fit = Math.min(1, (width - 24) / Math.max(1, context.measureText(text).width), (height - 16) / size)
    context.font = loaded && !options.mixed ? canvasFont(size * fit, visual) : `${style.getPropertyValue("--font-size-sm")} ${canvasFontFamily(undefined)}`
    context.fillStyle = options.mixed || !loaded ? style.getPropertyValue("--tertiary").trim() : parseColor(options.color?.replace(/^0x/i, "")) ?? style.getPropertyValue("--text").trim()
    context.textAlign = "center"
    context.textBaseline = "middle"
    withTextShadow(context, visual, () => context.fillText(text, width / 2, height / 2))
    canvas.dataset.fontFamily = loaded ? options.font.family ?? "system-ui" : ""
    canvas.setAttribute("aria-label", options.mixed || !loaded ? text : `${options.text ? "当前文字" : "字体示例"}：${text}`)
    canvas.setAttribute("aria-busy", "false")
  }
  const observer = new ResizeObserver(() => { void draw() })
  observer.observe(canvas)
  const theme = new MutationObserver(() => { void draw() })
  theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-app-theme", "data-accent", "style"] })
  releaseOnRemove(canvas, () => { generation++; observer.disconnect(); theme.disconnect(); canvas.width = canvas.height = 0 })
  return root
}
