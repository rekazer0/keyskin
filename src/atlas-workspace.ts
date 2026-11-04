import { createIcon } from "./icons"
import { element, iconButton } from "./dom-element.ts"
import { closeDialog } from "./motion.ts"
import { bindDialog } from "./app/ask.ts"
import { wheelZoomFactor } from "./wheel-zoom"
import type { TileSlice } from "./tiles"
import "./atlas-workspace.css"

type AtlasState = {
  active: boolean
  styleActive: boolean
  styleSelected: boolean
  path: string
  width: number
  height: number
  slices: TileSlice[]
  selected?: TileSlice
  editable: boolean
  bda: boolean
  guides: boolean
  reference: string
}

export function createAtlasWorkspace(actions: {
  back(): void
  copy(): void
  /** 校验失败时返回错误文字，对话框保持打开并在框内显示。 */
  create(name: string, width: number, height: number): string | undefined
  import(files: File[]): void
  autoSlice(): void
  guides(): void
  stretch(enabled: boolean): void
  redraw(): void
}) {
  const get = (selector: string) => document.querySelector<HTMLElement>(selector)!
  const list = get("#resource-list-view")
  const listHome = list.parentElement!
  const toolbar = get("#image-resource-detail > .tile-toolbar")
  const toolbarHome = toolbar.parentElement!
  const sidebar = get(".sidebar")
  const workspace = get(".workspace")
  const canvas = get("#atlas-canvas") as HTMLCanvasElement
  const wrap = get(".canvas-wrap")
  const header = element("div", "atlas-header")
  const heading = element("div", "atlas-image-title")
  const title = element("strong")
  const meta = element("small")
  heading.append(title, meta)
  const badge = element("span", "ui-badge atlas-selection")
  badge.dataset.variant = "selection"
  header.append(heading, badge)
  workspace.prepend(header)
  const button = (id: string, label: string, icon: string, action: () => void) => Object.assign(iconButton(icon, label, action), { id })
  const back = button("atlas-back", "返回", "arrow-left", actions.back)
  back.title = "返回布局"
  list.querySelector(".ui-pane-header")!.prepend(back)
  const copy = button("atlas-copy-image", "复制图片及切片", "copy", actions.copy)
  const createDialog = atlasCreateDialog(actions.create)
  const create = button("atlas-create-image", "新建图片", "plus", () => createDialog.open())
  const input = document.createElement("input")
  input.type = "file"
  input.multiple = true
  input.setAttribute("webkitdirectory", "")
  input.hidden = true
  input.addEventListener("change", () => {
    actions.import(Array.from(input.files ?? []).filter(file => /\.(png|til)$/i.test(file.name)))
    input.value = ""
  })
  const folder = button("atlas-import-folder", "导入图片目录", "folder-input", () => input.click())
  const extras = element("span", "atlas-resource-extras")
  extras.hidden = true
  extras.append(copy, create, folder, input)
  list.querySelector(".resource-actions")!.append(extras)
  const grid = button("atlas-grid", "显示切片网格", "grid-2x2", actions.guides)
  const autoSlice = button("atlas-auto-slice", "自动切片", "scissors", actions.autoSlice)
  for (const tool of [grid, autoSlice]) tool.dataset.variant = "filled"
  toolbar.append(grid, autoSlice)
  const reference = element("div", "atlas-reference")
  reference.append(Object.assign(element("span"), { textContent: "引用" }), element("output"))
  get("#tile-preview-wrap").after(reference)
  const sourceHeading = document.createElement("h3")
  sourceHeading.className = "atlas-source-heading"
  sourceHeading.textContent = "切片区域"
  get("#tile-source-fields").before(sourceHeading)
  const stretch = document.createElement("label")
  stretch.className = "atlas-stretch"
  stretch.innerHTML = '<span>按九宫格拉伸</span><input class="ui-switch" type="checkbox" role="switch" aria-label="按九宫格拉伸">'
  const toggle = stretch.querySelector("input")!
  toggle.addEventListener("change", () => actions.stretch(toggle.checked))
  // 开关决定下方拉伸边距是否生效，放在边距字段之前
  get("#tile-inner-title").before(stretch)
  // 与主画布同一个缩放控件（.preview-zoom-control）：缩小 / 适配 / 放大。
  const zoom = element("div", "preview-zoom-control glass-module")
  zoom.id = "atlas-zoom"
  zoom.setAttribute("aria-label", "图集缩放")
  const zoomButton = (id: string, label: string, icon: string, action: () => void) => {
    const control = Object.assign(element("button"), { id, type: "button", title: label })
    control.setAttribute("aria-label", label)
    control.append(createIcon(icon, 16))
    control.addEventListener("click", action)
    return control
  }
  let state: AtlasState | undefined
  let zoomValue = 1
  let fitted = true
  let desktopActive = false
  let lastPath = ""
  let panX = 0
  let panY = 0
  const setPan = (x: number, y: number) => {
    panX = x
    panY = y
    canvas.style.translate = `${Math.round(x)}px ${Math.round(y)}px`
  }
  const resize = () => {
    if (!desktopActive || !state?.width) return
    if (fitted) {
      zoomValue = Math.max(0.01, Math.min(1, (wrap.clientWidth - 64) / state.width, (wrap.clientHeight - 64) / state.height))
      setPan(0, 0)
    }
    canvas.style.width = `${Math.round(state.width * zoomValue)}px`
    canvas.style.height = `${Math.round(state.height * zoomValue)}px`
    fit.setAttribute("aria-pressed", String(fitted))
  }
  // 与主画布一致：以指针为锚点缩放，锚点下的图像位置保持不动
  const zoomBy = (factor: number, anchor?: { x: number; y: number }) => {
    const before = anchor && canvas.getBoundingClientRect()
    fitted = false
    zoomValue = Math.min(4, Math.max(0.05, zoomValue * factor))
    resize()
    if (anchor && before) {
      const after = canvas.getBoundingClientRect()
      setPan(
        panX + anchor.x - (after.left + (anchor.x - before.left) / before.width * after.width),
        panY + anchor.y - (after.top + (anchor.y - before.top) / before.height * after.height),
      )
    }
    actions.redraw()
  }
  const fit = zoomButton("atlas-zoom-fit", "适配", "scan", () => { fitted = true; resize(); actions.redraw() })
  zoom.append(zoomButton("atlas-zoom-out", "缩小", "minus", () => zoomBy(1 / 1.2)), fit, zoomButton("atlas-zoom-in", "放大", "plus", () => zoomBy(1.2)))
  workspace.append(zoom)
  wrap.addEventListener("wheel", event => {
    if (!desktopActive) return
    event.preventDefault()
    zoomBy(wheelZoomFactor(event), { x: event.clientX, y: event.clientY })
  }, { passive: false })
  // 与主画布一致：拖动任意处（超过 3px）平移；中键或按住空格立即平移。
  // 切片绘制、移动、缩放会捕获指针，此时不平移。
  let spaceHeld = false
  let candidate: { id: number; x: number; y: number } | undefined
  let pan: { x: number; y: number; panX: number; panY: number } | undefined
  addEventListener("keydown", event => {
    if (event.code === "Space" && !(event.target as Element).closest?.("input, textarea, select, [contenteditable]")) spaceHeld = true
  })
  addEventListener("keyup", event => { if (event.code === "Space") spaceHeld = false })
  addEventListener("blur", () => { spaceHeld = false })
  const startPan = (event: PointerEvent) => {
    candidate = undefined
    pan = { x: event.clientX, y: event.clientY, panX, panY }
    wrap.setPointerCapture(event.pointerId)
    wrap.classList.add("atlas-panning")
  }
  wrap.addEventListener("pointerdown", event => {
    if (!desktopActive || !(event.button === 1 || event.button === 0 && spaceHeld)) return
    event.preventDefault()
    event.stopPropagation()
    startPan(event)
  }, { capture: true })
  wrap.addEventListener("pointerdown", event => {
    if (!desktopActive || pan || event.button !== 0 || event.pointerType === "touch" || canvas.hasPointerCapture(event.pointerId)) return
    candidate = { id: event.pointerId, x: event.clientX, y: event.clientY }
  })
  wrap.addEventListener("pointermove", event => {
    if (candidate?.id === event.pointerId && Math.hypot(event.clientX - candidate.x, event.clientY - candidate.y) >= 3) {
      const start = candidate
      startPan(event)
      pan!.x = start.x
      pan!.y = start.y
    }
    if (!pan) return
    setPan(pan.panX + event.clientX - pan.x, pan.panY + event.clientY - pan.y)
  })
  const endPan = () => { candidate = undefined; pan = undefined; wrap.classList.remove("atlas-panning") }
  wrap.addEventListener("pointerup", endPan)
  wrap.addEventListener("pointercancel", endPan)
  new ResizeObserver(() => { resize(); actions.redraw() }).observe(wrap)
  const media = matchMedia("(min-width: 1000px)")
  const update = (next: AtlasState) => {
    state = next
    desktopActive = next.active && media.matches
    document.body.classList.toggle("atlas-workspace", desktopActive)
    extras.hidden = !desktopActive
    const sidebarActive = (next.active || next.styleActive) && media.matches
    document.body.classList.toggle("resource-workspace", sidebarActive)
    document.body.classList.toggle("style-workspace", next.styleActive && media.matches)
    if (sidebarActive) {
      if (list.parentElement !== sidebar) sidebar.append(list)
      list.hidden = false
    } else if (list.parentElement !== listHome) {
      listHome.prepend(list)
      list.hidden = next.active && Boolean(next.path) || next.styleActive && next.styleSelected
    }
    if (desktopActive) {
      if (toolbar.parentElement !== header) header.insertBefore(toolbar, badge)
      list.hidden = false
    } else {
      if (toolbar.parentElement !== toolbarHome) toolbarHome.prepend(toolbar)
      canvas.style.removeProperty("width")
      canvas.style.removeProperty("height")
      canvas.style.removeProperty("translate")
    }
    const slice = next.selected
    title.textContent = next.path.split("/").pop() || "图片"
    title.title = next.path
    get(".source-heading .inspector-context h2").textContent = desktopActive ? (slice ? `切片 #${slice.index}` : "切片") : next.styleActive ? "样式编辑" : "检查器"
    meta.textContent = next.path ? `${next.width} × ${next.height} · ${next.slices.length} 个切片` : ""
    // 选中信息只在这里出现一次（头部 meta 是整张图，角标是当前切片）。
    badge.textContent = slice ? `#${slice.index} · ${slice.source[2]} × ${slice.source[3]}` : ""
    badge.hidden = !slice
    // 引用按切片统计：没选切片时整行隐藏，不说整张图「未使用」。
    reference.querySelector("output")!.textContent = next.reference || "未使用"
    reference.hidden = !slice
    toggle.checked = Boolean(slice?.inner)
    toggle.disabled = !slice || !next.editable || next.bda
    stretch.hidden = next.bda
    copy.disabled = !next.path || !next.editable
    create.disabled = folder.disabled = !next.editable
    autoSlice.disabled = !next.path || !next.editable || next.bda
    grid.setAttribute("aria-pressed", String(next.guides))
    if (lastPath !== next.path) { lastPath = next.path; fitted = true }
    resize()
  }
  media.addEventListener("change", () => { if (state) update(state) })
  return { update }
}

/** 新建图片：.ui-dialog，校验错误显示在框内，通过前不关闭。 */
function atlasCreateDialog(create: (name: string, width: number, height: number) => string | undefined): { open(): void } {
  const dialog = element("dialog", "ui-dialog")
  dialog.id = "atlas-create-dialog"
  dialog.dataset.size = "sm"
  dialog.setAttribute("aria-label", "新建图片")
  const form = element("form", "ui-form")
  form.method = "dialog"
  const header = element("header", "ui-dialog-header")
  const text = element("div")
  text.append(Object.assign(element("h2"), { textContent: "新建图片" }), Object.assign(element("p"), { textContent: "透明 PNG" }))
  header.append(text)
  const input = (name: string, label: string, value: string, type = "text") => {
    const control = Object.assign(element("input"), { name, value, type, required: true })
    control.setAttribute("aria-label", label)
    if (type === "number") Object.assign(control, { min: "1", max: "8192" })
    return control
  }
  const field = (label: string, control: HTMLInputElement) => {
    const row = element("label", "ui-field")
    row.append(Object.assign(element("span"), { textContent: label }), control)
    return row
  }
  const name = input("name", "图片名称", "image.png")
  name.autofocus = true
  const width = input("width", "图片宽度", "512", "number")
  const height = input("height", "图片高度", "512", "number")
  const error = element("p", "ui-field-error")
  error.setAttribute("role", "alert")
  error.hidden = true
  const body = element("div", "ui-dialog-body")
  body.append(field("名称", name), field("宽", width), field("高", height), error)
  const footer = element("footer", "ui-dialog-footer")
  const cancel = Object.assign(element("button", "ui-button"), { value: "cancel", formNoValidate: true, textContent: "取消" })
  const confirm = Object.assign(element("button", "ui-button"), { value: "create", textContent: "新建" })
  confirm.dataset.variant = "primary"
  footer.append(cancel, confirm)
  form.append(header, body, footer)
  dialog.append(form)
  form.addEventListener("submit", (event) => {
    if (event.submitter !== confirm) return
    event.preventDefault()
    const message = create(name.value.trim(), Number(width.value), Number(height.value))
    error.textContent = message ?? ""
    error.hidden = !message
    if (!message) closeDialog(dialog)
  })
  form.addEventListener("input", () => { error.hidden = true })
  bindDialog(dialog)
  document.body.append(dialog)
  return { open: () => { error.hidden = true; dialog.showModal() } }
}

