import { retinaThumbnail, type Visual } from "../atlas.ts"
import { element, emptyState } from "../dom-element.ts"
import { parseSsfImage } from "../ssf/ssf-package.ts"
import { drawVisual } from "../preview-draw.ts"
import { bindDialog } from "./ask"

/** SSF 原图与拉伸边界共用检查器的校验、写回和撤销。滑块拖动预览，松开只提交一次。 */
export function openSsfImageEditor(options: {
  label: string
  value(): string | undefined
  load(): Promise<Visual | undefined>
  stretch(): HTMLElement
  size(): { width: number; height: number }
  pixelScale(): number
  replace(refresh: () => void): void
  close(): void
}): void {
  const dialog = element("dialog", "ui-dialog ui-image-editor")
  dialog.setAttribute("aria-label", "编辑图片")
  const form = element("form", "ui-form")
  form.method = "dialog"
  const header = element("header", "ui-dialog-header")
  const heading = element("div")
  const title = Object.assign(element("h2"), { textContent: "编辑图片" })
  const filename = element("p")
  heading.append(title, filename)
  header.append(heading)
  const body = element("div", "ui-dialog-body")
  const stage = element("div", "ui-image-editor-preview ui-checker")
  stage.dataset.size = "lg"
  const canvas = element("canvas")
  canvas.setAttribute("role", "img")
  canvas.setAttribute("aria-label", "图片拉伸区域预览")
  const result = element("div", "ui-image-editor-result ui-checker")
  const resultCanvas = element("canvas")
  resultCanvas.setAttribute("role", "img")
  resultCanvas.setAttribute("aria-label", "拉伸效果实时预览")
  result.append(resultCanvas)
  const footer = element("footer", "ui-dialog-footer")
  const replace = Object.assign(element("button", "ui-button"), { type: "button", textContent: "更换图片…" })
  const done = Object.assign(element("button", "ui-button"), { textContent: "完成" })
  done.dataset.variant = "primary"
  footer.append(replace, done)
  form.append(header, body, footer)
  dialog.append(form)
  bindDialog(dialog)
  let visual: Visual | undefined
  let numbers: HTMLInputElement[] = []
  let guides: HTMLButtonElement[] = []
  let imageScale = 1
  let observer: MutationObserver | undefined
  let generation = 0
  const draw = () => {
    retinaThumbnail(canvas, stage.clientWidth, stage.clientHeight)
    const context = canvas.getContext("2d")
    if (!context || !visual?.source || !visual.image) return
    const [sx, sy, width, height] = visual.source
    const scale = Math.min(canvas.width / width, canvas.height / height) * 0.9
    const x = (canvas.width - width * scale) / 2
    const y = (canvas.height - height * scale) / 2
    const ratio = stage.clientWidth / canvas.width
    imageScale = scale * ratio
    context.drawImage(visual.image, sx, sy, width, height, x, y, width * scale, height * scale)
    const current = parseSsfImage(options.value())?.stretch ?? [0, width, 0, height]
    const band = numbers.map((input, index) => input.value === "" ? current[index] : Number(input.value))
    retinaThumbnail(resultCanvas, result.clientWidth, result.clientHeight)
    const resultContext = resultCanvas.getContext("2d")
    const size = options.size()
    const resultScale = Math.min(resultCanvas.width / size.width, resultCanvas.height / size.height) * 0.9
    if (resultContext && size.width > 0 && size.height > 0 && band.every(Number.isFinite) && band[1] > band[0] && band[3] > band[2]) {
      resultContext.save()
      resultContext.translate((resultCanvas.width - size.width * resultScale) / 2, (resultCanvas.height - size.height * resultScale) / 2)
      resultContext.scale(resultScale, resultScale)
      drawVisual(resultContext, { ...visual, inner: [band[0], band[2], band[1] - band[0], band[3] - band[2]], nineSlicePixelScale: options.pixelScale() }, { x: 0, y: 0, width: size.width, height: size.height }, true)
      resultContext.restore()
    }
    for (const [index, value] of band.entries()) {
      const guide = guides[index]
      if (!guide) continue
      if (index < 2) guide.style.left = `${(x + value * scale) * ratio}px`
      else guide.style.top = `${(y + value * scale) * ratio}px`
      guide.setAttribute("aria-valuenow", String(value))
      guide.setAttribute("aria-valuemin", numbers[index].min)
      guide.setAttribute("aria-valuemax", numbers[index].max)
      guide.disabled = numbers[index].disabled
    }
  }
  const render = async () => {
    const version = ++generation
    observer?.disconnect()
    filename.textContent = `${options.label} · ${parseSsfImage(options.value())?.file ?? "未设置"}`
    visual = undefined
    resultCanvas.getContext("2d")?.clearRect(0, 0, resultCanvas.width, resultCanvas.height)
    numbers = []
    guides = []
    stage.replaceChildren(emptyState("image-off"))
    stage.setAttribute("aria-busy", "true")
    const fields = options.stretch()
    const controls = element("div", "ui-image-editor-controls")
    const sample = element("div", "ui-field")
    sample.dataset.stack = ""
    sample.append(Object.assign(element("span"), { textContent: "拉伸预览" }), result)
    controls.append(fields, sample)
    body.replaceChildren(stage, controls)
    const loaded = await options.load().catch(() => undefined)
    if (!dialog.open || version !== generation) return
    visual = loaded
    stage.removeAttribute("aria-busy")
    if (!visual?.source) {
      stage.replaceChildren(emptyState("image-off", "引用缺失"))
      for (const input of fields.querySelectorAll("input")) input.disabled = true
      return
    }
    stage.replaceChildren(canvas)
    numbers = [...fields.querySelectorAll<HTMLInputElement>('input[type="number"]')]
    const previewStretch = () => fields.dispatchEvent(new Event("ssf-stretch-preview"))
    const ranges = numbers.map((input) => {
      const control = input.parentElement!
      const wrap = element("span", "ui-slider-field")
      const range = element("input", "ui-slider")
      range.type = "range"
      range.setAttribute("aria-label", `${input.getAttribute("aria-label")}滑块`)
      control.replaceWith(wrap)
      wrap.append(range, control)
      let before: string | undefined
      const cancel = () => {
        if (before === undefined) return
        input.value = before
        before = undefined
        sync()
        previewStretch()
        draw()
      }
      range.addEventListener("input", () => { before ??= input.value; input.value = range.value; previewStretch(); draw() })
      range.addEventListener("change", () => { before = undefined; input.dispatchEvent(new Event("change", { bubbles: true })); sync(); draw() })
      range.addEventListener("pointercancel", cancel)
      range.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return
        event.preventDefault()
        event.stopPropagation()
        cancel()
      })
      return range
    })
    const sync = () => numbers.forEach((input, index) => {
      const range = ranges[index]
      range.min = input.min
      range.max = input.max
      range.step = input.step
      range.value = input.value || input.min
      range.disabled = input.disabled
    })
    guides = numbers.map((input, index) => {
      const guide = element("button", "ui-image-editor-guide")
      guide.type = "button"
      guide.dataset.axis = index < 2 ? "x" : "y"
      if (index % 2) guide.dataset.variant = "end"
      guide.setAttribute("role", "slider")
      guide.setAttribute("aria-label", `${input.getAttribute("aria-label")}辅助线`)
      guide.setAttribute("aria-orientation", index < 2 ? "horizontal" : "vertical")
      let drag: { id: number; before: string; start: number; origin: number } | undefined
      const preview = (value: number) => {
        input.value = String(Math.max(Number(input.min), Math.min(Number(input.max), Math.round(value))))
        sync()
        previewStretch()
        draw()
      }
      const finish = (cancel = false) => {
        if (!drag) return
        const { id, before } = drag
        drag = undefined
        if (cancel) input.value = before
        else if (input.value !== before) input.dispatchEvent(new Event("change", { bubbles: true }))
        if (cancel || input.value === before) previewStretch()
        if (guide.hasPointerCapture(id)) guide.releasePointerCapture(id)
        guide.removeAttribute("data-dragging")
        sync()
        draw()
      }
      guide.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return
        event.preventDefault()
        guide.focus({ preventScroll: true })
        drag = { id: event.pointerId, before: input.value, start: index < 2 ? event.clientX : event.clientY, origin: Number(input.value || ranges[index].value) }
        guide.setAttribute("data-dragging", "")
        guide.setPointerCapture(event.pointerId)
      })
      guide.addEventListener("pointermove", (event) => {
        if (!drag || drag.id !== event.pointerId) return
        const position = index < 2 ? event.clientX : event.clientY
        preview(drag.origin + (position - drag.start) / imageScale)
      })
      guide.addEventListener("pointerup", () => finish())
      guide.addEventListener("pointercancel", () => finish(true))
      guide.addEventListener("lostpointercapture", () => finish(true))
      guide.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && drag) {
          event.preventDefault()
          event.stopPropagation()
          finish(true)
          return
        }
        const direction = index < 2 ? { ArrowLeft: -1, ArrowRight: 1 } : { ArrowUp: -1, ArrowDown: 1 }
        const delta = direction[event.key as keyof typeof direction]
        if (delta === undefined || drag) return
        event.preventDefault()
        event.stopPropagation()
        preview(Number(input.value || ranges[index].value) + delta * (event.shiftKey ? 10 : 1))
        input.dispatchEvent(new Event("change", { bubbles: true }))
      })
      return guide
    })
    stage.append(...guides)
    observer = new MutationObserver(() => { sync(); draw() })
    for (const input of numbers) observer.observe(input, { attributes: true, attributeFilter: ["min", "max", "disabled"] })
    fields.addEventListener("input", (event) => { if ((event.target as HTMLInputElement).type !== "range") { sync(); draw() } })
    fields.addEventListener("change", () => { sync(); draw() })
    sync()
    draw()
  }
  replace.addEventListener("click", () => options.replace(() => { if (dialog.open) void render() }))
  const resize = new ResizeObserver(draw)
  dialog.addEventListener("close", () => {
    generation++
    observer?.disconnect()
    resize.disconnect()
    canvas.width = canvas.height = 0
    resultCanvas.width = resultCanvas.height = 0
    dialog.remove()
    options.close()
  }, { once: true })
  document.body.append(dialog)
  dialog.showModal()
  resize.observe(stage)
  resize.observe(result)
  void render()
  done.focus({ preventScroll: true })
}
