import { bindListboxKeys, element, iconButton } from "./dom-element.ts"
import { closeDialog } from "./motion.ts"
import { bindDialog } from "./app/ask.ts"
import { wheelZoomFactor } from "./wheel-zoom"
import type { TileSlice } from "./tiles"
import "./atlas-workspace.css"

type AtlasState = {
  active: boolean
  preview: boolean
  styleActive: boolean
  soundActive: boolean
  styleSelected: boolean
  path: string
  width: number
  height: number
  slices: TileSlice[]
  selected?: TileSlice
  selectMobileSlice?(index: number): void
  dirty: boolean
  editable: boolean
  bda: boolean
  guides: boolean
}

export function createAtlasWorkspace(actions: {
  begin(): void
  finish(save: boolean): void
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
  const categories = get("#resource-page-sidebar")
  const workspace = get(".workspace")
  const canvasWrap = get(".canvas-wrap")
  const canvas = get("#atlas-canvas") as HTMLCanvasElement
  const image = get("#workspace-image")
  const figure = get("#workspace-image-figure")
  const figureHome = figure.parentElement!
  const inspector = get("#tile-inspector")
  const inspectorHome = inspector.parentElement!
  const dialog = element("dialog", "ui-dialog ui-image-editor atlas-workspace")
  dialog.id = "atlas-editor-dialog"
  dialog.dataset.variant = "atlas"
  dialog.setAttribute("aria-label", "编辑切片")
  const form = element("form", "ui-form")
  form.method = "dialog"
  form.noValidate = true
  const dialogHeader = element("header", "ui-dialog-header")
  const dialogTitle = element("div")
  dialogTitle.append(Object.assign(element("h2"), { textContent: "编辑切片" }))
  dialogHeader.append(dialogTitle)
  const body = element("div", "ui-dialog-body")
  const stage = element("div", "ui-image-editor-preview")
  const controls = element("div", "ui-image-editor-controls")
  const sliceList = element("div", "ui-resource-grid mobile-atlas-slices")
  sliceList.setAttribute("role", "listbox")
  sliceList.setAttribute("aria-label", "图片切片")
  sliceList.hidden = true
  bindListboxKeys(sliceList, row => { row.click(); row.focus() })
  controls.append(sliceList)
  let sliceSignature = ""
  const wrap = element("div", "atlas-surface ui-checker")
  wrap.dataset.size = "lg"
  stage.append(wrap)
  body.append(stage, controls)
  const footer = element("footer", "ui-dialog-footer")
  const status = element("span", "ui-dialog-status")
  status.setAttribute("role", "status")
  const cancel = Object.assign(element("button", "ui-button"), { type: "button", textContent: "取消", autofocus: true })
  const save = Object.assign(element("button", "ui-button"), { type: "submit", textContent: "保存", value: "save" })
  save.dataset.variant = "primary"
  const discard = () => { void closeDialog(dialog, "cancel") }
  cancel.addEventListener("click", discard)
  form.addEventListener("submit", event => {
    if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur()
    if (save.disabled) event.preventDefault()
  })
  footer.append(status, cancel, save)
  form.append(dialogHeader, body, footer)
  dialog.append(form)
  bindDialog(dialog, discard)
  document.body.append(dialog)
  // 原图由浏览器合成，命中区域跟随原图，只有标注画布分配视口大小的像素。
  const viewport = Object.assign(element("canvas"), { id: "atlas-viewport", width: 1, height: 1 })
  viewport.setAttribute("aria-hidden", "true")
  canvas.after(viewport)
  const heading = element("div", "atlas-image-title")
  const title = element("strong")
  const meta = element("small")
  heading.append(title, meta)
  dialogTitle.append(heading)
  const button = (id: string, label: string, icon: string, action: () => void) => Object.assign(iconButton(icon, label, action), { id })
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
  get("#resource-selection-actions").after(extras)
  const grid = button("atlas-grid", "显示切片网格", "grid-2x2", actions.guides)
  const autoSlice = button("atlas-auto-slice", "自动切片", "scissors", actions.autoSlice)
  for (const tool of [grid, autoSlice]) tool.dataset.variant = "filled"
  toolbar.append(grid, autoSlice)
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
  let state: AtlasState | undefined
  let zoomValue = 1
  let fitted = true
  let panLocked = true
  let editorActive = false
  let lastPath = ""
  let panX = 0
  let panY = 0
  const setPan = (x: number, y: number) => {
    if (panX === x && panY === y) return
    panX = x
    panY = y
    if (dialog.dataset.mobileAtlas === "true" && !CSS.supports("translate", "0")) {
      image.style.transform = canvas.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
    } else image.style.translate = canvas.style.translate = `${Math.round(x)}px ${Math.round(y)}px`
    actions.redraw()
  }
  const resize = () => {
    if (!editorActive || !state?.width || !state.height) return
    if (fitted) {
      const inset = dialog.dataset.mobileAtlas === "true" ? parseFloat(getComputedStyle(figure).paddingLeft) * 2 : 64
      zoomValue = Math.max(0.01, Math.min(1, (wrap.clientWidth - inset) / state.width, (wrap.clientHeight - inset) / state.height))
      setPan(0, 0)
    }
    image.style.width = canvas.style.width = `${Math.round(state.width * zoomValue)}px`
    image.style.height = canvas.style.height = `${Math.round(state.height * zoomValue)}px`
    image.dataset.sampling = zoomValue * devicePixelRatio > 1 ? "nearest" : "auto"
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
  const fit = button("atlas-zoom-fit", "适配", "scan", () => { fitted = true; resize(); actions.redraw() })
  const syncPanLock = () => {
    fit.ariaPressed = String(panLocked)
    fit.ariaLabel = fit.title = panLocked ? "图集已锁定（双击解锁）" : "适配图集（双击锁定）"
  }
  fit.addEventListener("dblclick", () => { panLocked = !panLocked; syncPanLock() })
  syncPanLock()
  zoom.append(button("atlas-zoom-out", "缩小", "minus", () => zoomBy(1 / 1.2)), fit, button("atlas-zoom-in", "放大", "plus", () => zoomBy(1.2)))
  stage.append(zoom)
  wrap.addEventListener("wheel", event => {
    if (!editorActive) return
    event.preventDefault()
    if (!panLocked) zoomBy(wheelZoomFactor(event), { x: event.clientX, y: event.clientY })
  }, { passive: false })
  // 解锁后可拖动画布；与主画布一样，空格左键或中键可临时平移。
  // 切片绘制、移动、缩放会捕获指针，此时不平移。
  let spaceHeld = false
  let candidate: { id: number; x: number; y: number } | undefined
  let pan: { id: number; x: number; y: number; panX: number; panY: number } | undefined
  dialog.addEventListener("keydown", event => {
    if (event.code !== "Space" || (event.target as Element).closest("input, textarea, select, [contenteditable]")) return
    spaceHeld = true
    if (event.target === canvas || wrap.matches(":hover")) event.preventDefault()
  })
  addEventListener("keyup", event => { if (event.code === "Space") spaceHeld = false })
  addEventListener("blur", () => { spaceHeld = false })
  const startPan = (event: PointerEvent) => {
    candidate = undefined
    fitted = false
    pan = { id: event.pointerId, x: event.clientX, y: event.clientY, panX, panY }
    wrap.setPointerCapture(event.pointerId)
    wrap.classList.add("atlas-panning")
  }
  wrap.addEventListener("pointerdown", event => {
    if (!editorActive || pan || !(event.button === 1 || event.button === 0 && spaceHeld)) return
    event.preventDefault()
    event.stopPropagation()
    canvas.focus({ preventScroll: true })
    startPan(event)
  }, { capture: true })
  wrap.addEventListener("pointerdown", event => {
    if (!editorActive || panLocked || pan || event.button !== 0 || event.pointerType === "touch"
      || event.ctrlKey || event.metaKey || event.shiftKey || canvas.hasPointerCapture(event.pointerId)) return
    candidate = { id: event.pointerId, x: event.clientX, y: event.clientY }
  })
  wrap.addEventListener("pointermove", event => {
    if (!(event.buttons & 1) && candidate?.id === event.pointerId) candidate = undefined
    if (!panLocked && candidate?.id === event.pointerId && Math.hypot(event.clientX - candidate.x, event.clientY - candidate.y) >= 3) {
      const start = candidate
      startPan(event)
      pan!.x = start.x
      pan!.y = start.y
    }
    if (pan?.id !== event.pointerId) return
    setPan(pan.panX + event.clientX - pan.x, pan.panY + event.clientY - pan.y)
  })
  const endPan = (event: PointerEvent) => {
    if (candidate?.id === event.pointerId) candidate = undefined
    if (pan?.id !== event.pointerId) return
    pan = undefined
    wrap.classList.remove("atlas-panning")
  }
  wrap.addEventListener("pointerup", endPan)
  wrap.addEventListener("pointercancel", endPan)
  wrap.addEventListener("lostpointercapture", endPan)
  let resizeFrame = 0
  const observer = new ResizeObserver(() => {
    if (!editorActive || resizeFrame) return
    resizeFrame = requestAnimationFrame(() => { resizeFrame = 0; resize(); actions.redraw() })
  })
  observer.observe(wrap)
  observer.observe(canvas.parentElement!)
  const media = matchMedia("(min-width: 761px) and (min-height: 601px), (min-width: 951px)")
  const portrait = matchMedia("(max-width: 760px) and (orientation: portrait)")
  let finishing = false
  dialog.addEventListener("close", () => {
    finishing = true
    actions.finish(dialog.returnValue === "save")
    finishing = false
  })
  const isDesktopEditor = () => media.matches && !canvasWrap.classList.contains("empty")
  let desktopEditor = isDesktopEditor()
  const update = (next: AtlasState) => {
    state = next
    form.dataset.readonly = String(!next.editable)
    desktopEditor = isDesktopEditor()
    const mobileEditor = portrait.matches && Boolean(next.selectMobileSlice)
    editorActive = (desktopEditor || mobileEditor) && next.active && Boolean(next.path)
    if (mobileEditor && editorActive) dialog.dataset.mobileAtlas = "true"
    else delete dialog.dataset.mobileAtlas
    sliceList.hidden = !mobileEditor || !editorActive || !next.slices.length
    if (!sliceList.hidden) {
      const signature = next.slices.map(({ index, source }) => `${index}:${source[2]}:${source[3]}`).join("|")
      if (signature !== sliceSignature) {
        sliceSignature = signature
        sliceList.replaceChildren(...next.slices.map(({ index, source }) => {
          const option = Object.assign(element("button", "ui-list-item"), { type: "button" })
          option.dataset.sliceIndex = String(index)
          option.setAttribute("role", "option")
          const text = element("span", "ui-list-item-text")
          text.append(Object.assign(element("strong"), { textContent: `IMG${index}` }), Object.assign(element("small"), { textContent: `${source[2]} × ${source[3]}` }))
          option.append(text)
          option.addEventListener("click", () => state?.selectMobileSlice?.(index))
          return option
        }))
      }
      for (const option of sliceList.querySelectorAll<HTMLButtonElement>("button")) {
        const selected = Number(option.dataset.sliceIndex) === next.selected?.index
        option.setAttribute("aria-selected", String(selected))
        option.tabIndex = selected || !next.selected && option === sliceList.firstElementChild ? 0 : -1
      }
    }
    extras.hidden = !desktopEditor || !next.active || !next.preview
    save.disabled = !next.editable
    const message = next.dirty ? "有未保存的切片修改" : ""
    if (status.textContent !== message) status.textContent = message
    const libraryActive = desktopEditor && (next.active || next.styleActive || next.soundActive)
    document.body.classList.toggle("resource-workspace", libraryActive)
    get("#resource-gallery").dataset.variant = libraryActive ? "cards" : ""
    document.body.classList.toggle("style-workspace", desktopEditor && next.styleActive)
    if (libraryActive) {
      if (categories.parentElement !== sidebar) sidebar.append(categories)
      if (list.parentElement !== workspace) workspace.append(list)
      list.hidden = false
    } else if (list.parentElement !== listHome) {
      list.append(categories)
      listHome.prepend(list)
      list.hidden = next.active && Boolean(next.path) || next.styleActive && next.styleSelected
    }
    if (editorActive) {
      if (figure.parentElement !== wrap) wrap.append(figure)
      if (inspector.parentElement !== controls) controls.append(inspector)
      if (toolbar.parentElement !== stage) stage.prepend(toolbar)
      if (!dialog.open && !finishing) {
        actions.begin()
        dialog.returnValue = ""
        dialog.showModal()
      }
      if (desktopEditor) list.hidden = false
    } else {
      if (dialog.open) discard()
      if (figure.parentElement === wrap) figureHome.append(figure)
      if (inspector.parentElement === controls) inspectorHome.append(inspector)
      if (toolbar.parentElement !== toolbarHome) toolbarHome.prepend(toolbar)
      canvas.style.removeProperty("width")
      canvas.style.removeProperty("height")
      canvas.style.removeProperty("translate")
      canvas.style.removeProperty("transform")
      image.removeAttribute("style")
      if (viewport.width !== 1) viewport.width = 1
      if (viewport.height !== 1) viewport.height = 1
    }
    const slice = next.selected
    title.textContent = next.path.split("/").pop() || "图片"
    title.title = next.path
    get(".source-heading .inspector-context h2").textContent = next.styleActive ? "样式编辑" : "检查器"
    meta.textContent = next.path ? `${next.width} × ${next.height} · ${next.slices.length} 个切片` : ""
    toggle.checked = Boolean(slice?.inner)
    toggle.disabled = !slice || !next.editable || next.bda
    stretch.hidden = next.bda
    copy.disabled = !next.editable
    create.disabled = folder.disabled = !next.editable
    autoSlice.disabled = !next.path || !next.editable || next.bda
    grid.setAttribute("aria-pressed", String(next.guides))
    if (lastPath !== next.path) { lastPath = next.path; fitted = true }
    resize()
  }
  const syncLayout = () => { if (state) { update(state); actions.redraw() } }
  media.addEventListener("change", syncLayout)
  portrait.addEventListener("change", syncLayout)
  new MutationObserver(() => {
    if (desktopEditor !== isDesktopEditor()) syncLayout()
  }).observe(canvasWrap, { attributes: true, attributeFilter: ["class"] })
  return { update, viewportCanvas: () => editorActive ? viewport : undefined }
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

