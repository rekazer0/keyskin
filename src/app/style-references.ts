import { appState } from "./state"
import { styleConfigPath } from "./config-context"
import { IniDocument } from "../ini.ts"
import { soundPathForFilename } from "../sounds.ts"
import { theme, orientation, keyFields, toolbarFields, quickInspector } from "./dom"
import { createIcon } from "../icons"
import { playSoundPath, keyboardFields } from "./canvas-interaction"
import { openStylePicker, styleConfigDocument, styleKindBadge, styleKind, styleReferenceThumbnailInputs, availableStyleIDs, styleSoundFile } from "./style-picker"
import { sxiPointer } from "./sxi-documents"
import { retinaThumbnail, drawVisualPreview, type Visual } from "../atlas.ts"
import { visualResolver, bdaAppearanceStylePath } from "./bda-documents"
import { type StyleImagePickerTarget } from "./types"
import { openImageSlicePicker } from "./image-pickers"
import { openStyleImageResourceChooser, selectStyleResource } from "./resource-inspector"
import { bdaStyleRef, type BdaAppearanceStyleGroup, type BdaStyleRef, bdaStyleID } from "../bda.ts"
import { NEW_FORE_LAYER } from "../bda-layout-styles.ts"
import { selectFile } from "./navigation"
import { updateBdaAppearanceStyleRef } from "./key-inspector"

export const styleReferenceDrawIDs = new WeakMap<HTMLElement, number>()

export function styleReferenceKey(input: HTMLInputElement): string {
  return input.dataset.keyboardField ?? input.dataset.toolbarField ?? input.dataset.keyField ?? input.dataset.documentStyleKey ?? ""
}

export function isStyleReferenceKey(key: string): boolean {
  if (key === "STAT_STYLE") return false
  return key === "styleID" || /(?:^|\.)(?:[A-Z0-9_]*STYLE|FIRST_BACK|FIRST_FORE|PARTICLE_IMAGE)$/i.test(key)
}

function soundPathForStyle(styleID: string): string | undefined {
  if (!appState.archive) return
  const filename = styleSoundFile(styleID)
  return filename ? soundPathForFilename(appState.archive.names(), theme.value, orientation.value, filename) : undefined
}

export function decorateStyleReferenceInput(input: HTMLInputElement, key = styleReferenceKey(input)): void {
  if (!isStyleReferenceKey(key) || input.closest(".style-reference-input")) return
  const soundStyle = key === "SOUND_STYLE"
  input.dataset.documentStyleKey ||= key
  const parent = input.parentNode
  if (!parent) return
  const wrapper = document.createElement("span")
  wrapper.className = "style-reference-input"
  wrapper.classList.toggle("sound-style-reference", soundStyle)
  parent.insertBefore(wrapper, input)
  // 卡片布局靠这个 class 而不是 :has()：检查器每次重建都会让 :has() 重算整个右栏样式。
  wrapper.closest(".ui-field, .document-property-field, .fore-style-reference-field")?.classList.add("style-reference-field")
  if (soundStyle) {
    const soundMain = document.createElement("span")
    soundMain.className = "sound-style-main"
    soundMain.setAttribute("role", "button")
    soundMain.tabIndex = 0
    const musicIcon = document.createElement("span")
    musicIcon.className = "sound-style-icon"
    musicIcon.append(createIcon("volume-2", 14))
    const soundMeta = document.createElement("span")
    soundMeta.className = "sound-style-main-meta"
    const soundTitle = document.createElement("strong")
    soundTitle.className = "sound-style-name"
    const soundSubtitle = document.createElement("small")
    soundSubtitle.className = "sound-style-file"
    soundMeta.append(soundTitle, soundSubtitle)
    input.classList.add("sound-style-value")
    input.tabIndex = -1
    input.setAttribute("aria-hidden", "true")
    soundMain.append(musicIcon, soundMeta, input)
    // 没有音效时整条就是「选择音效」按钮，有音效时点击试听。
    const activate = () => {
      const path = soundPathForStyle(input.value.split(",")[0]?.trim() ?? "")
      if (path) playSoundPath(path)
      else openStylePicker(input)
    }
    soundMain.addEventListener("click", activate)
    soundMain.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate() }
    })
    wrapper.append(soundMain)
  } else {
    wrapper.append(input)
  }
  const button = document.createElement(soundStyle ? "button" : "span")
  if (button instanceof HTMLButtonElement) button.type = "button"
  button.className = "style-picker-trigger"
  button.classList.toggle("sound-style-trigger", soundStyle)
  if (soundStyle) {
    button.title = "点击更换样式；Command/Ctrl 点击编辑样式"
    button.setAttribute("aria-label", "更换或编辑引用样式")
    button.append(createIcon("ellipsis", 14))

  }
  if (button instanceof HTMLButtonElement) button.addEventListener("click", (event) => {
    if (event.metaKey || event.ctrlKey) openStyleReferenceEditor(input.value.split(",")[0]?.trim() ?? "")
    else openStylePicker(input)
  })
  input.addEventListener("input", () => void refreshStyleReferenceThumbnail(button, input, key))
  input.addEventListener("change", () => void refreshStyleReferenceThumbnail(button, input, key))
  void refreshStyleReferenceThumbnail(button, input, key)
  wrapper.append(button)
  if (soundStyle) void refreshStyleReferenceThumbnail(button, input, key)
  // 按键可以叠多层前景、粒子可以用多张图片：标签行尾部「+ 添加」选一个样式追加为新的一张卡片。
  const caption = input.dataset.keyField === "FORE_STYLE" || key === "PARTICLE_IMAGE" ? input.closest(".ui-field")?.querySelector(":scope > span:first-child") : null
  if (caption) {
    const add = document.createElement("button")
    add.type = "button"
    add.className = "style-reference-add"
    add.append(createIcon("plus", 12), "添加")
    add.addEventListener("click", (event) => {
      event.preventDefault()
      const target = input.cloneNode(false) as HTMLInputElement
      target.value = ""
      target.dataset.styleReferenceAppend = "true"
      target.addEventListener("change", () => {
        if (!target.value.trim()) return
        input.value = [...input.value.split(",").map((value) => value.trim()).filter(Boolean), target.value.trim()].join(",")
        input.dispatchEvent(new Event("input", { bubbles: true }))
        input.dispatchEvent(new Event("change", { bubbles: true }))
      })
      openStylePicker(target)
    })
    caption.append(add)
  }
}

export function renderStyleReferenceRows(button: HTMLElement, input: HTMLInputElement, key: string): string[] {
  const styleIDs = input.value.split(",").map((value) => value.trim()).filter(Boolean)
  // 每次编辑都会重建这些行；复用旧画布（保留已按卡片量好的位图尺寸），不再每次新建。
  const spare = Array.from(button.querySelectorAll("canvas")).reverse()
  for (const canvas of spare) styleStateCanvasObserver.unobserve(canvas)
  button.replaceChildren()
  const styles = styleConfigDocument()
  for (const [styleIndex, styleID] of (styleIDs.length ? styleIDs : [""]).entries()) {
    const rowInput = () => {
      const target = input.cloneNode(false) as HTMLInputElement
      target.value = styleID
      target.dataset.styleReferenceIndex = String(styleIndex)
      target.addEventListener("change", () => {
        const values = input.value.split(",").map((value) => value.trim()).filter(Boolean)
        values[styleIndex] = target.value.trim()
        // An emptied card drops its layer instead of leaving ",205" behind.
        input.value = values.filter(Boolean).join(",")
        input.dispatchEvent(new Event("input", { bubbles: true }))
        input.dispatchEvent(new Event("change", { bubbles: true }))
      })
      return target
    }
    const wrapper = document.createElement("div")
    wrapper.className = "style-reference-row"
    const numberInput = rowInput()
    numberInput.className = "style-reference-number"
    numberInput.removeAttribute("id")
    numberInput.setAttribute("aria-label", `样式 ${styleIndex + 1} 编号`)
    const previews = document.createElement("span")
    previews.className = "style-picker-states"
    for (let index = 0; index < 2; index += 1) {
      const item = document.createElement("button")
      const highlighted = index === 1
      item.type = "button"
      item.className = "style-picker-state"
      item.dataset.styleState = highlighted ? "highlighted" : "normal"
      item.dataset.stateLabel = highlighted ? "按下" : "正常"
      // 预览图就是该状态引用的图片，点击它进入这张图片的切片选择器；
      // 更换引用的样式挪到 Alt 点击，编号框仍可直接输入。
      item.title = `点击选择${highlighted ? "按下" : "正常"}图片切片；Alt 点击更换样式；Command/Ctrl 点击编辑样式`
      item.setAttribute("aria-label", item.title)
      const canvas = spare.pop() ?? retinaThumbnail(document.createElement("canvas"), 152, 76)
      styleStateCanvases.add(canvas)
      canvas.setAttribute("aria-hidden", "true")
      item.append(canvas)
      item.addEventListener("click", (event) => {
        if (event.metaKey || event.ctrlKey) openStyleReferenceEditor(styleID)
        else if (event.altKey) openStylePicker(rowInput(), highlighted)
        else void openStyleReferenceStateImage(rowInput(), key, highlighted)
      })
      previews.append(item)
    }
    // 卡片左侧：编号在上、样式类型在下；右侧并排两个状态预览（DESIGN.md §10）。
    const meta = document.createElement("span")
    meta.className = "style-reference-meta"
    meta.append(numberInput)
    if (styleID) meta.append(styleKindBadge(styleKind(styleID, styles)))
    wrapper.append(meta, previews)
    button.append(wrapper)
  }
  return styleIDs
}

export function styleReferenceForeground(key: string): boolean {
  return /FORE|INPUT_STYLE|SCAND_STYLE|CELL_STYLE/.test(key)
}

export async function refreshStyleReferenceThumbnail(
  button: HTMLElement,
  input: HTMLInputElement,
  key: string,
  resolver = visualResolver(),
): Promise<void> {
  const drawID = (styleReferenceDrawIDs.get(button) ?? 0) + 1
  styleReferenceDrawIDs.set(button, drawID)
  if (key === "SOUND_STYLE") {
    const styleID = input.value.split(",")[0]?.trim() ?? ""
    const path = soundPathForStyle(styleID)
    const main = button.parentElement?.querySelector<HTMLElement>(".sound-style-main")
    const title = main?.querySelector<HTMLElement>(".sound-style-name")
    const file = main?.querySelector<HTMLElement>(".sound-style-file")
    if (title) title.textContent = path?.split("/").pop() || "选择音效"
    if (file) file.textContent = path ? `STYLE${styleID}` : ""
    if (main) {
      main.classList.toggle("has-sound", Boolean(path))
      main.title = path ? "点击试听" : ""
      main.setAttribute("aria-label", path ? "播放按键音效" : "选择音效")
    }
    button.hidden = !path
    return
  }
  const styleIDs = renderStyleReferenceRows(button, input, key)
  const canvases = Array.from(button.querySelectorAll<HTMLCanvasElement>("canvas"))
  if (canvases.length < 2 || !resolver || !styleIDs.length) {
    for (const canvas of canvases) {
      const context = canvas.getContext("2d")
      context?.clearRect(0, 0, canvas.width, canvas.height)
    }
    return
  }
  const visuals = await Promise.all(styleIDs.flatMap((styleID) =>
    [false, true].map((highlighted) => resolver.resolve(styleID, highlighted).catch(() => undefined)),
  ))
  if (drawID !== styleReferenceDrawIDs.get(button)) return
  // Unresolved visuals may resolve later; let the next refresh retry them.
  if (visuals.some((visual) => !visual)) styleReferenceThumbnailInputs.delete(button)
  const foreground = styleReferenceForeground(key)
  visuals.forEach((visual, index) => {
    const canvas = canvases[index]
    styleStateVisuals.set(canvas, { visual, foreground })
    scheduleStyleStateSizing(canvas)
    styleStateCanvasObserver.observe(canvas)
  })
}

const pendingStyleStateCanvases = new Set<HTMLCanvasElement>()
const styleStateCanvases = new Set<HTMLCanvasElement>()

/** WebKit 的 GC 不计入画布位图，检查器反复重建后旧位图越积越多、越用越卡；丢弃时立即释放。 */
function releaseStyleStateCanvas(canvas: HTMLCanvasElement): void {
  styleStateCanvases.delete(canvas)
  styleStateCanvasObserver.unobserve(canvas)
  styleStateVisuals.delete(canvas)
  styleStateCanvasSizes.delete(canvas)
  canvas.width = 0
  canvas.height = 0
}
let styleStateSizingFrame = 0

/*
 * 一次检查器重建会刷新几十个样式按钮，各自量尺寸再改位图，每个按钮都会触发一次强制布局，
 * WebKit 下切换文件、点选按键明显卡顿。改为下一帧统一先量完、再改位图，只排版一次。
 */
function scheduleStyleStateSizing(canvas: HTMLCanvasElement): void {
  pendingStyleStateCanvases.add(canvas)
  styleStateSizingFrame ||= requestAnimationFrame(() => {
    styleStateSizingFrame = 0
    // 检查器重建在这一帧之前已同步完成，此时还不在文档里的就是被丢弃的旧画布。
    for (const canvas of styleStateCanvases) if (!canvas.isConnected) releaseStyleStateCanvas(canvas)
    const canvases = Array.from(pendingStyleStateCanvases).filter((canvas) => canvas.isConnected)
    pendingStyleStateCanvases.clear()
    const rects = canvases.map((canvas) => canvas.getBoundingClientRect())
    canvases.forEach((canvas, index) => {
      const meta = styleStateVisuals.get(canvas)
      // 量不到尺寸（所在分组隐藏）或尺寸未变时用现有位图绘制，保证切回该分组时不出现空白预览。
      if (!sizeStyleStateCanvas(canvas, rects[index]) && meta) drawVisualPreview(canvas, [meta.visual], meta.foreground)
    })
  })
}

export const styleStateVisuals = new WeakMap<HTMLCanvasElement, { visual: Visual | undefined; foreground: boolean }>()

const styleStateCanvasSizes = new WeakMap<HTMLCanvasElement, string>()

/*
 * 缩略图按卡片的实际尺寸绘制：固定 152×76 的宽扁画布经过 object-fit: contain 后只剩卡片
 * 一半高度，图案显得又小又扁。改用卡片内容盒尺寸作为位图尺寸，样式图才能铺满卡片高度。
 */
function sizeStyleStateCanvas(canvas: HTMLCanvasElement, { width, height } = canvas.getBoundingClientRect()): boolean {
  if (width < 1 || height < 1) return false
  const size = `${Math.round(width)}x${Math.round(height)}`
  if (styleStateCanvasSizes.get(canvas) === size) return false
  styleStateCanvasSizes.set(canvas, size)
  retinaThumbnail(canvas, width, height)
  const meta = styleStateVisuals.get(canvas)
  if (meta) drawVisualPreview(canvas, [meta.visual], meta.foreground)
  return true
}

/** 分组切换后为之前量不到尺寸的缩略图补一次按尺寸重绘。 */
export function redrawStyleStateCanvases(): void {
  const canvases = Array.from(document.querySelectorAll<HTMLCanvasElement>(".style-reference-row canvas"))
  const rects = canvases.map((canvas) => canvas.getBoundingClientRect())
  canvases.forEach((canvas, index) => sizeStyleStateCanvas(canvas, rects[index]))
}

const resizedStyleStateCanvases = new Set<HTMLCanvasElement>()
let styleStateResizeTimer: ReturnType<typeof setTimeout> | undefined

/** 面板宽度变化（选中态切换、窗口缩放）后按新尺寸重绘，避免位图与卡片比例不符。
 *  拖动调宽时每帧都会触发，几百张缩略图逐帧重绘会卡顿，所以等宽度停稳后再统一重绘。 */
export const styleStateCanvasObserver = new ResizeObserver((entries) => {
  for (const entry of entries) {
    if (entry.target instanceof HTMLCanvasElement) resizedStyleStateCanvases.add(entry.target)
  }
  clearTimeout(styleStateResizeTimer)
  styleStateResizeTimer = setTimeout(() => {
    const connected: HTMLCanvasElement[] = []
    for (const canvas of resizedStyleStateCanvases) {
      // 被重建替换掉的画布不再需要重绘，及时解绑，避免观察器长期持有已分离的位图。
      if (canvas.isConnected) connected.push(canvas)
      else releaseStyleStateCanvas(canvas)
    }
    resizedStyleStateCanvases.clear()
    const rects = connected.map((canvas) => canvas.getBoundingClientRect())
    connected.forEach((canvas, index) => sizeStyleStateCanvas(canvas, rects[index]))
  }, 120)
})

export function styleWriteTarget(
  source: "BACK_STYLE" | "FORE_STYLE",
  property: "NM_IMG" | "HL_IMG",
  styleIDs: string[],
): StyleImagePickerTarget {
  if (appState.archive?.format === "bda") return { source, property }
  const path = styleConfigPath()
  // A Palm style is written in skin.json (image-pickers.ts) by its id.
  if (appState.archive?.format === "sxi") {
    const ids = new Set(availableStyleIDs())
    const sections = [...new Set(styleIDs.map((token) => token.trim()).filter((id) => ids.has(id)).map((id) => `STYLE${id}`))]
    return sections.length ? { source, property, path, sections } : { source, property }
  }
  if (!appState.archive?.isText(path)) return { source, property }
  const document = IniDocument.parse(appState.archive.getText(path))
  // Images are read from STYLE<id> only (atlas.ts resolveVisualSpec); STYLE<id/100> is a text fallback
  // and is often another key's text style, so an image must never be written there.
  const sections = [...new Set(styleIDs.map((token) => `STYLE${token.trim()}`).filter((section) => document.sections().includes(section)))]
  return sections.length ? { source, property, document, path, sections } : { source, property }
}

function pairedBackgroundStyleID(input: HTMLInputElement, key: string): string | undefined {
  const backgroundKey = key.replace(/FORE_STYLE$/, "BACK_STYLE").replace(/FIRST_FORE$/, "FIRST_BACK")
  if (backgroundKey === key) return
  const fields = input.dataset.keyField !== undefined
    ? keyFields
    : input.dataset.toolbarField !== undefined
      ? toolbarFields
      : input.dataset.keyboardField !== undefined
        ? keyboardFields
        : []
  return fields.find((field) => styleReferenceKey(field) === backgroundKey)?.value.split(",")[0]?.trim()
}

export async function openStyleReferenceStateImage(
  input: HTMLInputElement,
  key: string,
  highlighted: boolean,
): Promise<void> {
  if (input.disabled) return
  const resolver = visualResolver()
  if (!resolver) return
  const foreground = styleReferenceForeground(key)
  const source: "BACK_STYLE" | "FORE_STYLE" = foreground ? "FORE_STYLE" : "BACK_STYLE"
  const property = highlighted ? "HL_IMG" : "NM_IMG"
  let styleIDs = input.value.split(",").map((value) => value.trim()).filter(Boolean)
  let targetSource = source
  let visual = (await Promise.all(styleIDs.map((styleID) => resolver.resolve(styleID, highlighted).catch(() => undefined))))
    .find((item) => item?.imagePath)
  // 颜色 / 动画样式没有图片可切，改为在样式库里更换引用的样式；不能回退去改背景图片。
  if (!visual && styleIDs.some((styleID) => ["color", "anim"].includes(styleKind(styleID)))) return openStylePicker(input, highlighted)
  if (!visual && foreground && appState.archive?.format !== "sxi") {
    const backgroundID = pairedBackgroundStyleID(input, key)
    if (backgroundID) {
      styleIDs = [backgroundID]
      targetSource = "BACK_STYLE"
      visual = await resolver.resolve(backgroundID, highlighted).catch(() => undefined)
    }
  }
  const target = styleWriteTarget(targetSource, property, styleIDs)
  appState.stylePickerTarget = input
  appState.styleLibraryHighlighted = highlighted
  if (visual?.imagePath) openImageSlicePicker(visual.imagePath, target, visual.source)
  else openStyleImageResourceChooser(target)
}

export function openStyleReferenceEditor(styleID: string): void {
  if (!styleID || !availableStyleIDs().includes(styleID) || !appState.archive) return
  const returnPath = appState.selectedPath
  const returnSelection = [...appState.selectedKeySections]
  const returnCandidate = appState.selectedCandidate
  const returnScrollTop = quickInspector.scrollTop
  const returnInspectorGroup = quickInspector.dataset.mobileInspectorGroup ?? ""
  if (appState.archive.format === "bda") {
    const ref = bdaStyleRef(styleID)
    if (!ref) return
    const group = `${ref.type}Styles` as BdaAppearanceStyleGroup
    const path = bdaAppearanceStylePath(group)
    selectFile(path, "overview", "style")
    appState.styleReturnPath = returnPath === path ? "" : returnPath
    appState.styleReturnSelection = returnSelection
    appState.styleReturnCandidate = returnCandidate
    appState.styleReturnScrollTop = returnScrollTop
    appState.styleReturnInspectorGroup = returnInspectorGroup
    selectStyleResource(String(ref.key))
    return
  }
  const path = styleConfigPath()
  if (!appState.archive.isText(path) && !sxiPointer(path)) return
  selectFile(path, "overview", "style")
  appState.styleReturnPath = returnPath === path ? "" : returnPath
  appState.styleReturnSelection = returnSelection
  appState.styleReturnScrollTop = returnScrollTop
  appState.styleReturnInspectorGroup = returnInspectorGroup
  selectStyleResource(styleID)
}

export function openBdaStyleReferencePicker(paths: string[][], ref: BdaStyleRef, field: string, owner: HTMLElement): void {
  const input = document.createElement("input")
  // A reference the skin does not set yet (key -1) opens the picker with nothing chosen.
  input.value = ref.key >= 0 ? bdaStyleID(ref) : ""
  input.dataset.documentStyleKey = field
  // A new foreground layer can be any kind of style: an image, a text or a colour.
  if (field !== NEW_FORE_LAYER) input.dataset.bdaStyleType = ref.type
  input.addEventListener("change", () => {
    const next = bdaStyleRef(input.value)
    if (next) updateBdaAppearanceStyleRef(paths, next, owner)
  })
  openStylePicker(input)
}
