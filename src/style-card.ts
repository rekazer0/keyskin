import { canvasFont, retinaThumbnail, withTextShadow, type VisualResolver } from "./atlas.ts"
import { element, iconButton } from "./dom-element.ts"
import { releaseOnRemove } from "./dom-lifecycle.ts"
import { createIcon } from "./icons.ts"
import { playEnter } from "./motion.ts"

/** 样式类型的名称与图标：样式列表、全部样式、检查器引用卡共用，同一类型处处同一图标。 */
const styleKinds: Record<string, { label: string; icon: string }> = {
  image: { label: "图片", icon: "image" },
  color: { label: "颜色", icon: "palette" },
  anim: { label: "动画", icon: "clapperboard" },
  text: { label: "文字", icon: "type" },
  sound: { label: "音效", icon: "volume-2" },
  empty: { label: "空", icon: "square-dashed" },
}

export const styleTypeOptions = [
  ["all", "全部类型"], ["image", "图片"], ["color", "颜色"], ["anim", "动画"],
  ["text", "文字"], ["sound", "音效"], ["empty", "空"],
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
  // 放不下时等比缩小字号，不用 fillText 的 maxWidth 把字形横向压扁。
  const sample = text?.text || "键设 Aa"
  const size = Math.min(32, Math.max(16, visual?.fontSize ?? 24)) / 32 * canvas.height * 0.3
  context.font = canvasFont(size, visual)
  const fit = Math.min(1, (canvas.width * 0.85) / Math.max(1, context.measureText(sample).width))
  if (fit < 1) context.font = canvasFont(size * fit, visual)
  context.textAlign = "center"
  context.textBaseline = "middle"
  withTextShadow(context, visual, () => context.fillText(sample, canvas.width / 2, canvas.height / 2))
  canvas.setAttribute("aria-label", `${highlighted ? "按下" : "正常"}文字示例：${text?.text || "键设 Aa"}`)
}

// 几千个样式时缩略图进入视口才绘制，打开列表不必一次画完；尺寸按实际布局取，卡片随窗口缩放后在可见时重画。
const pendingDraws = new WeakMap<Element, () => void>()
const drawing: { observer?: IntersectionObserver; resize?: ResizeObserver } = {}
function drawObserver(): IntersectionObserver {
  return drawing.observer ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      drawing.observer?.unobserve(entry.target)
      pendingDraws.get(entry.target)?.()
    }
  }, { rootMargin: "200px" })
}
function resizeObserver(): ResizeObserver {
  return drawing.resize ??= new ResizeObserver((entries) => {
    for (const entry of entries) if (entry.contentRect.width && entry.contentRect.height) drawObserver().observe(entry.target)
  })
}

/**
 * 画布按显示尺寸绘制，进入视口才画、尺寸变了再画。卡片移出文档后释放位图：WebKit 的 GC 不计入画布位图，
 * 检查器反复重建时旧位图会越积越多（被复用到新卡片里的画布还连着文档，不释放）。
 */
function lazyDraw(owner: Element, target: Element, canvases: HTMLCanvasElement[], draw: (canvas: HTMLCanvasElement, index: number) => void | Promise<void>): void {
  let drawnSize = ""
  pendingDraws.set(target, () => {
    const size = canvases.map(canvas => `${canvas.clientWidth}x${canvas.clientHeight}`).join()
    if (size === drawnSize) return
    drawnSize = size
    canvases.forEach((canvas, index) => {
      retinaThumbnail(canvas, canvas.clientWidth || 160, canvas.clientHeight || 80)
      void draw(canvas, index)
    })
  })
  drawObserver().observe(target)
  resizeObserver().observe(target)
  releaseOnRemove(owner, () => {
    drawObserver().unobserve(target)
    resizeObserver().unobserve(target)
    for (const canvas of canvases) if (!canvas.isConnected) canvas.width = canvas.height = 0
  })
}

/** 类型标识只放图标，类型名在悬停提示与无障碍名称里。 */
export function styleKindIcon(kind: string, label = styleKinds[kind]?.label ?? kind, icon = styleKinds[kind]?.icon ?? "square-dashed"): HTMLElement {
  const badge = element("span", "ui-style-card-kind")
  badge.dataset.styleKind = kind
  badge.title = label
  badge.setAttribute("role", "img")
  badge.setAttribute("aria-label", label)
  badge.append(createIcon(icon, 14))
  return badge
}

/** 卡片底部：被引用时 link 图标 + 次数，其后一行短摘要。列表给了引用数（哪怕是 0）就总留这一行，卡片才等高。 */
function cardMeta(uses?: number, note?: string): HTMLElement | undefined {
  if (uses === undefined && !note) return
  const meta = element("span", "ui-list-item-meta")
  if (uses) {
    const badge = element("span", "ui-badge")
    badge.dataset.uses = String(uses)
    badge.title = `${uses} 处引用`
    badge.append(createIcon("link", 14), String(uses))
    meta.append(badge)
  }
  if (note) meta.append(Object.assign(element("small"), { textContent: note }))
  return meta
}

/** 列表卡片的键盘：Space 选中，Enter 选中并执行主动作（同双击），Delete / Backspace 删除。 */
function bindCardKeys(card: HTMLElement, remove?: HTMLButtonElement): void {
  card.addEventListener("keydown", event => {
    if (event.target !== card) return
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault()
      card.click()
      if (event.key === "Enter") card.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))
    } else if ((event.key === "Delete" || event.key === "Backspace") && remove && !remove.disabled) {
      event.preventDefault()
      remove.click()
    }
  })
}

/**
 * Both windows share this card structure (role=option in a listbox). Visual styles show normal and pressed
 * states; animation previews use the same thumbnail player and styling in each window.
 */
export function styleCard(options: {
  id: string; label: string; kind: string; kindLabel?: string; kindIcon?: string
  info?: string
  animationPreview?: boolean
  draw?: (canvas: HTMLCanvasElement, highlighted: boolean) => void | Promise<void>
  animation?: () => HTMLElement[] | Promise<HTMLElement[]>
  summary?: string
  sound?: () => HTMLElement
  canvas?: (width: number, height: number) => HTMLCanvasElement
  /** How many places reference it; shown as a link badge, and the reason removal is blocked. */
  uses?: number
  note?: string
  /** A trash strip on the right edge (hover, selected or focused) and the Delete key. */
  remove?: { run(): void; blocked?: string }
}): HTMLElement {
  const card = element("div", "ui-style-card")
  card.tabIndex = 0
  card.setAttribute("role", "option")
  card.setAttribute("aria-selected", "false")
  if (options.info) card.title = [options.label, options.info].join(" · ")
  card.dataset.styleKind = options.kind
  card.dataset.styleId = options.id
  const heading = element("span", "ui-style-card-heading")
  const label = element("strong")
  label.textContent = options.label
  heading.append(label)
  if (options.info) {
    const info = element("span", "ui-style-card-info")
    info.textContent = options.info
    heading.append(info)
  }
  heading.append(styleKindIcon(options.kind, options.kindLabel, options.kindIcon))
  let remove: HTMLButtonElement | undefined
  if (options.remove) {
    const { run, blocked } = options.remove
    remove = removeStrip(`删除${options.label}`, run)
    remove.disabled = Boolean(blocked)
    if (blocked) remove.title = blocked
  }
  bindCardKeys(card, remove)
  const previews = element("span", "ui-style-preview")
  if (options.kind === "anim" || options.animationPreview) {
    previews.dataset.variant = "animation"
    previews.title = options.summary || "未设置"
    previews.setAttribute("aria-label", previews.title)
    pendingDraws.set(previews, () => {
      if (card.isConnected) void Promise.resolve(options.animation?.() ?? []).then(players => {
        if (card.isConnected) previews.append(...players)
      })
    })
    drawObserver().observe(previews)
    releaseOnRemove(card, () => drawObserver().unobserve(previews))
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
    if (options.draw) lazyDraw(card, previews, canvases, (canvas, index) => options.draw?.(canvas, Boolean(index)))
  }
  const caption = element("span", "ui-style-card-caption")
  caption.append(heading)
  card.append(caption, previews)
  const meta = cardMeta(options.uses, options.note)
  if (meta) card.append(meta)
  if (remove) card.append(remove)
  if (options.sound) (options.kind === "sound" ? previews : heading).append(options.sound())
  return card
}

/** 样式卡、样式引用卡右侧的移除条（.ui-style-remove）：悬停卡片时半透明出现，悬停自身时加宽变红。 */
function removeStrip(label: string, run: () => void): HTMLButtonElement {
  const button = iconButton("trash-2", label, event => {
    // 移除后 label 中的控件会重建，阻止默认点击转发给新的添加按钮。
    event.preventDefault()
    event.stopPropagation()
    run()
  })
  button.className = "ui-style-remove"
  return button
}

/** 网格末尾新建样式的虚线卡：只放 plus 图标。 */
export function styleAddCard(onAdd: () => void): HTMLButtonElement {
  const card = iconButton("plus", "新建样式", onAdd)
  card.className = "ui-style-add"
  card.replaceChildren(createIcon("plus", 20))
  playEnter(card)
  return card
}

export type StyleReferenceState = {
  label: string
  /** Draws the state at the canvas's display size; omit for `content`. */
  draw?(canvas: HTMLCanvasElement): void | Promise<void>
  /** An animation thumbnail, a sound sample or a status text instead of a canvas. */
  content?: Element | string
  /** `edit` is a Command/Ctrl click: go to the referenced style or animation. */
  onClick?(edit: boolean): void
}

/** 引用字段标题右侧的添加入口，选择后才写入配置。 */
export function styleReferenceAddButton(label: string, run: () => void, disabled = false): HTMLButtonElement {
  const add = iconButton("plus", label, run)
  add.classList.add("ui-style-ref-append")
  add.dataset.size = "sm"
  add.disabled = disabled
  return add
}

/**
 * 检查器里的样式引用卡（.ui-style-ref，DESIGN.md §10）：左侧可直接输入的编号与类型图标，右侧并排的状态预览
 * 或单格内容。未配置时从字段标题添加；每张已绑定的卡都可移除。
 */
export function styleReferenceCard(options: {
  /** The editable number; Sogou cards have one file name per state. */
  name: HTMLInputElement | HTMLInputElement[]
  kind?: HTMLElement
  states: StyleReferenceState[]
  remove?: { label: string; run(): void }
  disabled?: boolean
}): HTMLElement {
  const card = element("div", "ui-style-ref")
  const meta = element("span", "ui-style-ref-meta")
  for (const name of [options.name].flat()) {
    name.classList.add("ui-style-ref-number")
    meta.append(name)
  }
  if (options.kind) meta.append(options.kind)
  const states = element("span", "ui-style-ref-states")
  const action = (item: HTMLElement, run: ((edit: boolean) => void) | undefined) => {
    item.setAttribute("role", "button")
    item.tabIndex = options.disabled && !run ? -1 : 0
    item.addEventListener("click", event => { event.preventDefault(); run?.(event.metaKey || event.ctrlKey) })
    item.addEventListener("keydown", event => {
      if (event.target !== item || (event.key !== "Enter" && event.key !== " ")) return
      event.preventDefault()
      run?.(event.metaKey || event.ctrlKey)
    })
  }
  const canvases: HTMLCanvasElement[] = []
  const draws: Array<(canvas: HTMLCanvasElement) => void | Promise<void>> = []
  for (const [index, item] of options.states.entries()) {
    const state = element("span", "ui-style-state")
    state.dataset.state = options.states.length === 1 ? "single" : index ? "pressed" : "normal"
    state.title = item.label
    state.setAttribute("aria-label", item.label)
    if (item.draw) {
      const canvas = element("canvas")
      canvas.setAttribute("aria-hidden", "true")
      state.append(canvas)
      canvases.push(canvas)
      draws.push(item.draw)
    } else if (item.content) state.append(item.content)
    action(state, item.onClick)
    states.append(state)
  }
  if (options.states.length === 1) states.dataset.variant = "single"
  if (canvases.length) lazyDraw(card, states, canvases, (canvas, index) => draws[index](canvas))
  card.append(meta, states)
  if (options.remove && !options.disabled) {
    card.append(removeStrip(options.remove.label, options.remove.run))
  }
  return card
}

/** 图片资源卡片（.ui-image-card）：侧栏图片列表与「全部图片」共用。 */
export function imageResourceCard(options: { path: string; src?: string; load?: () => Promise<string | undefined>; til?: boolean; slices?: number; uses?: number }): HTMLElement {
  const card = element("div", "ui-image-card")
  card.tabIndex = 0
  card.setAttribute("role", "option")
  card.setAttribute("aria-selected", "false")
  card.dataset.path = options.path
  card.title = options.path
  const image = element("img")
  if (options.src) image.src = options.src
  image.alt = ""
  image.loading = "lazy"
  const preview = element("span", "ui-image-card-preview")
  if (options.load) {
    pendingDraws.set(preview, () => {
      void options.load?.().then(src => { if (src && card.isConnected) image.src = src })
    })
    drawObserver().observe(preview)
    releaseOnRemove(card, () => drawObserver().unobserve(preview))
  }
  const size = element("span", "ui-image-card-size")
  size.hidden = true
  preview.append(image, size)
  image.addEventListener("load", () => {
    size.textContent = `${image.naturalWidth} × ${image.naturalHeight}`
    size.hidden = false
  })
  const caption = element("span", "ui-image-card-caption")
  const name = element("strong")
  name.textContent = options.path.split("/").pop() ?? options.path
  caption.append(name)
  if (options.til || options.slices) {
    const til = element("span", "ui-image-card-til")
    til.title = options.slices ? `${options.slices} 个切片` : "有切片"
    til.setAttribute("aria-label", til.title)
    til.append(createIcon("grid-2x2"))
    caption.append(til)
  }
  card.append(preview, caption)
  const meta = cardMeta(options.uses)
  if (meta) card.append(meta)
  bindCardKeys(card)
  return card
}

/** 唯一的音效试听外观；播放由调用方注入（主窗口直接播放，弹窗发消息给主窗口），没有 play 时按钮禁用。 */
export function soundStyleSample(filename: string | undefined, play?: (sample: HTMLElement) => void): HTMLElement {
  const root = element("div", "ui-style-sound")
  root.title = filename ?? "未设置"
  const button = iconButton("play", "试听")
  button.disabled = !play
  button.addEventListener("click", event => {
    event.stopPropagation()
    play?.(root)
  })
  const info = element("span", "ui-style-sound-info")
  const name = element("strong")
  name.textContent = filename ?? "未设置"
  const meta = element("small")
  meta.textContent = filename && !play ? "文件缺失" : ""
  info.append(name, meta)
  root.append(button, info)
  return root
}

/** 试听中切到停止图标；出错时把原因写在文件名下面。 */
export function setSoundSamplePlaying(sample: HTMLElement, playing: boolean, error = ""): void {
  const button = sample.querySelector<HTMLButtonElement>(".ui-icon-button")
  button?.replaceChildren(createIcon(playing ? "square" : "play", 14))
  button?.setAttribute("aria-label", playing ? "停止试听" : "试听")
  if (button) button.title = button.getAttribute("aria-label")!
  sample.dataset.playing = String(playing)
  const meta = sample.querySelector("small")
  if (meta && error) meta.textContent = error
}
