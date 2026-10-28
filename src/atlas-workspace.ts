import { createIcon } from "./icons"
import { wheelZoomFactor } from "./wheel-zoom"
import type { TileSlice } from "./tiles"
import "./atlas-workspace.css"

type AtlasState = {
  active: boolean
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
  create(name: string, width: number, height: number): void
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
  const header = document.createElement("div")
  header.className = "atlas-header"
  header.innerHTML = '<div class="atlas-image-title"><strong></strong><small></small></div><span class="atlas-selection"></span>'
  const title = header.querySelector("strong")!
  const meta = header.querySelector("small")!
  const badge = header.querySelector<HTMLElement>(".atlas-selection")!
  workspace.prepend(header)
  const button = (id: string, label: string, icon: string, action: () => void) => {
    const element = document.createElement("button")
    element.id = id
    element.type = "button"
    element.className = "toolbar-button"
    element.title = label
    element.setAttribute("aria-label", label)
    element.append(createIcon(icon, 16))
    element.addEventListener("click", action)
    return element
  }
  const back = button("atlas-back", "返回布局", "arrow-left", actions.back)
  list.querySelector(".inspector-title")!.prepend(back)
  const copy = button("atlas-copy-image", "复制图片及切片", "copy", actions.copy)
  const createDialog = document.createElement("dialog")
  createDialog.id = "atlas-create-dialog"
  createDialog.className = "app-dialog"
  createDialog.innerHTML = '<form method="dialog"><header><h2>新建图片</h2><p>创建一张透明 PNG，之后可在画布中添加切片。</p></header><label>名称<input name="name" aria-label="图片名称" value="image.png" required></label><div class="atlas-create-size"><label>宽<input name="width" aria-label="图片宽度" type="number" min="1" max="8192" value="512" required></label><label>高<input name="height" aria-label="图片高度" type="number" min="1" max="8192" value="512" required></label></div><footer><button type="submit" value="cancel" formnovalidate>取消</button><button class="primary" type="submit" value="create">创建</button></footer></form>'
  createDialog.querySelector("form")!.addEventListener("submit", event => {
    if ((event as SubmitEvent).submitter?.getAttribute("value") !== "create") return
    const data = new FormData(createDialog.querySelector("form")!)
    actions.create(String(data.get("name")).trim(), Number(data.get("width")), Number(data.get("height")))
  })
  document.body.append(createDialog)
  const create = button("atlas-create-image", "新建图片", "plus", () => createDialog.showModal())
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
  const extras = document.createElement("span")
  extras.className = "atlas-resource-extras"
  extras.append(copy, create, folder, input)
  list.querySelector(".resource-actions")!.append(extras)
  const grid = button("atlas-grid", "显示切片网格", "grid-2x2", actions.guides)
  const autoSlice = button("atlas-auto-slice", "自动切片", "scissors", actions.autoSlice)
  toolbar.append(grid, autoSlice)
  const reference = document.createElement("div")
  reference.className = "atlas-reference"
  reference.innerHTML = '<span>引用</span><output></output>'
  get("#tile-preview-wrap").after(reference)
  const sourceHeading = document.createElement("h3")
  sourceHeading.className = "atlas-source-heading"
  sourceHeading.textContent = "切片区域"
  get("#tile-source-fields").before(sourceHeading)
  const stretch = document.createElement("label")
  stretch.className = "atlas-stretch"
  stretch.innerHTML = '<span>按九宫格拉伸</span><input type="checkbox" role="switch" aria-label="按九宫格拉伸">'
  const toggle = stretch.querySelector("input")!
  toggle.addEventListener("change", () => actions.stretch(toggle.checked))
  // 开关决定下方拉伸边距是否生效，放在边距字段之前
  get("#tile-inner-title").before(stretch)
  const status = document.createElement("div")
  status.className = "atlas-status"
  status.setAttribute("role", "status")
  workspace.append(status)
  const zoom = document.createElement("div")
  zoom.className = "atlas-zoom"
  const percent = document.createElement("output")
  percent.setAttribute("aria-label", "图集缩放比例")
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
    percent.textContent = `${Math.round(zoomValue * 100)}%`
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
  zoom.append(button("atlas-zoom-out", "缩小图集", "minus", () => zoomBy(1 / 1.2)), percent,
    button("atlas-zoom-in", "放大图集", "plus", () => zoomBy(1.2)),
    button("atlas-zoom-fit", "适配图集", "maximize", () => { fitted = true; resize(); actions.redraw() }))
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
    if (desktopActive) {
      if (list.parentElement !== sidebar) sidebar.append(list)
      if (toolbar.parentElement !== header) header.insertBefore(toolbar, badge)
      list.hidden = false
    } else {
      if (list.parentElement !== listHome) {
        listHome.prepend(list)
        list.hidden = next.active && Boolean(next.path)
      }
      if (toolbar.parentElement !== toolbarHome) toolbarHome.prepend(toolbar)
      canvas.style.removeProperty("width")
      canvas.style.removeProperty("height")
      canvas.style.removeProperty("translate")
    }
    const slice = next.selected
    title.textContent = next.path.split("/").pop() || "皮肤图片"
    title.title = next.path
    get(".source-heading .inspector-context h2").textContent = desktopActive ? (slice ? `切片 #${slice.index}` : "切片") : "检查器"
    meta.textContent = next.path ? `${next.width} × ${next.height} · ${next.slices.length} 个切片` : "未选择图片"
    badge.textContent = slice ? `切片 #${slice.index} · ${slice.source[2]} × ${slice.source[3]}` : "未选择切片"
    // 引用按切片统计：没选切片时不能说整张图「无引用」。
    reference.querySelector("output")!.textContent = next.reference || (slice ? "无引用" : "选中切片后显示")
    toggle.checked = Boolean(slice?.inner)
    toggle.disabled = !slice || !next.editable || next.bda
    stretch.hidden = next.bda
    copy.disabled = !next.path || !next.editable
    create.disabled = folder.disabled = !next.editable
    autoSlice.disabled = !next.path || !next.editable || next.bda
    grid.classList.toggle("active", next.guides)
    grid.setAttribute("aria-pressed", String(next.guides))
    status.textContent = `${slice ? `已选 1 个切片 · 切片 #${slice.index}` : "未选择切片"} · 原图 ${next.width} × ${next.height}`
    if (lastPath !== next.path) { lastPath = next.path; fitted = true }
    resize()
  }
  media.addEventListener("change", () => { if (state) update(state) })
  return { update }
}
