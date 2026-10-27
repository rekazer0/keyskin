import { drawVisualText, type Visual, type VisualResolver } from "./atlas.ts"
import { bdaStyleID, type BdaAppearance, type BdaKey, type BdaStyleRef } from "./bda.ts"
import { bdaColorHex } from "./bda-resolver.ts"
import { decodeBdaAnimation, decodeBdaAppearance, decodeBdaSoundConfig } from "./bda-decode.ts"
import { renderBdaAnimationEditor } from "./bda-animation-editor.ts"
import { bdaLayoutStyleGroups, type BdaLayoutStyleItem } from "./bda-layout-styles.ts"
import { element } from "./dom-element.ts"

type BdaStyleChange = (ref: BdaStyleRef, property: string, value: string) => void
export type BdaLayoutScope = "panel" | "candidate"

type LayoutEditorOptions = {
  appearance: BdaAppearance
  panelName: string
  keys: Array<{ name: string; key: BdaKey }>
  scope?: BdaLayoutScope
  resolver?: VisualResolver
  editable: boolean
  onStyleChange: BdaStyleChange
  onPanelPropertyChange: (property: "shouldBgBlur" | "shouldKeySlotting" | "trackColor", value: boolean | string) => void
  onStyleRefChange?: (paths: string[][], ref: BdaStyleRef, field: HTMLElement) => void
  onStyleRefAction?: (
    paths: string[][],
    ref: BdaStyleRef,
    field: string,
    action: "replace" | "edit",
    owner: HTMLElement,
  ) => void
}

type StyleEditorOptions = {
  appearance: BdaAppearance
  ref: BdaStyleRef
  resolver?: VisualResolver
  editable: boolean
  onStyleChange: BdaStyleChange
  onImageAction?: (ref: BdaStyleRef, highlighted: boolean, action: "replace" | "slice") => void
}

type ConfigEditorOptions = {
  path: string
  bytes: Uint8Array
  resolver?: VisualResolver
  editable: boolean
  onDesignWidth: (value: number) => void
  onAnimationFrame: (sequence: string, frame: number, property: "resourceID" | "duration", value: string | number) => void
  onAnimationEffect: (key: string, property: string, value: string | number | boolean) => void
  onPickAnimationResource: (sequence: string, frame: number) => void
}

type MetadataEditorOptions = {
  entries: Array<{ key: string; value: string }>
  editable: boolean
  onChange: (key: string, value: string) => void
}

const bdaEntryNames: Record<string, string> = { short: "短按", long: "长按", port: "竖屏", land: "横屏" }

/** BDA 提示 / 列表条目用内部键名（short、port…），界面上显示对应的中文。 */
export function bdaEntryLabel(key: string): string {
  return bdaEntryNames[key] ?? key
}

function inspectorSection<T extends HTMLElement>(node: T, label: string): T {
  node.classList.add("bda-inspector-section")
  node.dataset.inspectorGroupLabel = label
  return node
}

function heading(title: string, detail?: string): HTMLElement {
  const header = element("header", "bda-card-heading")
  const strong = element("strong")
  strong.textContent = title
  header.append(strong)
  if (detail) {
    const small = element("small")
    small.textContent = detail
    header.append(small)
  }
  return header
}

// 每个缩略图在各自的 Promise 回调里“读尺寸→改画布尺寸”会逐个强制整页重排；
// 合并到下一帧统一先读全部尺寸再绘制，只重排一次。
const pendingVisuals = new Map<HTMLCanvasElement, Visual | undefined>()
let visualFrame = 0

function drawVisual(canvas: HTMLCanvasElement, visual: Visual | undefined): void {
  pendingVisuals.set(canvas, visual)
  visualFrame ||= requestAnimationFrame(flushVisuals)
}

function flushVisuals(): void {
  visualFrame = 0
  const batch = [...pendingVisuals].filter(([canvas]) => canvas.isConnected)
  pendingVisuals.clear()
  const bounds = batch.map(([canvas]) => canvas.getBoundingClientRect())
  batch.forEach(([canvas, visual], index) => paintVisual(canvas, visual, bounds[index]))
}

function paintVisual(canvas: HTMLCanvasElement, visual: Visual | undefined, bounds: DOMRect): void {
  const scale = Math.max(1, window.devicePixelRatio || 1)
  const width = Math.max(1, Math.round(bounds.width || 128))
  const height = Math.max(1, Math.round(bounds.height || 76))
  canvas.width = width * scale
  canvas.height = height * scale
  const context = canvas.getContext("2d")!
  context.setTransform(scale, 0, 0, scale, 0, 0)
  context.clearRect(0, 0, width, height)
  if (visual?.color) {
    context.fillStyle = visual.color
    context.fillRect(0, 0, width, height)
  }
  if (visual?.image) {
    const source = visual.source ?? [0, 0, visual.image.width, visual.image.height]
    const ratio = Math.min(width / source[2], height / source[3])
    const imageWidth = source[2] * ratio
    const imageHeight = source[3] * ratio
    context.drawImage(
      visual.image,
      source[0], source[1], source[2], source[3],
      (width - imageWidth) / 2, (height - imageHeight) / 2, imageWidth, imageHeight,
    )
  }
  if (visual) drawVisualText(context, visual, { x: 0, y: 0, width, height })
}


function stylePreview(
  ref: BdaStyleRef,
  resolver: VisualResolver | undefined,
  editable = false,
  onImageAction?: StyleEditorOptions["onImageAction"],
  imageResourceNames?: readonly [string | undefined, string | undefined],
): HTMLElement {
  const preview = element("div", "bda-style-preview")
  for (const [index, [highlighted, label]] of ([[false, "正常"], [true, "按下"]] as const).entries()) {
    const state = ref.type === "image" && onImageAction ? element("button") : element("figure")
    if (state instanceof HTMLButtonElement) {
      state.type = "button"
      state.disabled = !editable
      state.title = "点击更换图片；Command/Ctrl 点击进入切片工具"
      state.setAttribute("aria-label", `${label}状态图片：点击更换图片，Command/Ctrl 点击进入切片工具`)
      state.addEventListener("click", (event) => {
        onImageAction?.(ref, highlighted, event.metaKey || event.ctrlKey ? "slice" : "replace")
      })
    }
    const canvas = element("canvas")
    const resourceName = imageResourceNames?.[index]
    if (resourceName) {
      const name = element("span", "bda-style-resource-name")
      name.textContent = resourceName
      name.title = resourceName
      state.append(name)
    }
    state.append(canvas)
    preview.append(state)
    void resolver?.resolve(bdaStyleID(ref), highlighted)
      .then((visual) => { if (canvas.isConnected) drawVisual(canvas, visual) })
      .catch(() => {})
  }
  return preview
}

function colorField(
  label: string,
  value: number,
  disabled: boolean,
  onChange: (value: string) => void,
): HTMLElement {
  const field = element("label", "bda-color-field")
  const caption = element("span")
  caption.textContent = label
  const controls = element("span", "bda-color-controls")
  const hex = bdaColorHex(value)
  const picker = element("input")
  picker.type = "color"
  picker.value = `#${hex.slice(2)}`
  picker.disabled = disabled
  const alpha = element("input")
  alpha.type = "range"
  alpha.min = "0"
  alpha.max = "255"
  alpha.value = String(Number.parseInt(hex.slice(0, 2), 16))
  alpha.disabled = disabled
  const output = element("output")
  const commit = () => {
    const next = `${Number(alpha.value).toString(16).padStart(2, "0")}${picker.value.slice(1)}`.toUpperCase()
    output.value = next
    onChange(next)
  }
  output.value = hex
  picker.addEventListener("change", commit)
  alpha.addEventListener("change", commit)
  controls.append(picker, alpha, output)
  field.append(caption, controls)
  return field
}

function rangeField(
  label: string,
  value: number,
  min: number,
  max: number,
  disabled: boolean,
  onChange: (value: number) => void,
): HTMLElement {
  const field = element("label", "bda-range-field")
  const caption = element("span")
  caption.textContent = label
  const row = element("span")
  const range = element("input")
  range.type = "range"
  range.min = String(min)
  range.max = String(Math.max(max, value))
  range.value = String(value)
  range.disabled = disabled
  const output = element("output")
  output.value = String(value)
  range.addEventListener("input", () => { output.value = range.value })
  range.addEventListener("change", () => onChange(Number(range.value)))
  row.append(range, output)
  field.append(caption, row)
  return field
}

function textField(
  label: string,
  value: string,
  disabled: boolean,
  onChange: (value: string) => void,
): HTMLElement {
  const field = element("label", "bda-text-field")
  const caption = element("span")
  caption.textContent = label
  const input = element("input")
  input.value = value
  input.disabled = disabled
  input.addEventListener("change", () => onChange(input.value))
  field.append(caption, input)
  return field
}

function readonlyField(label: string, value: string | number): HTMLElement {
  const field = element("label", "bda-readonly-field")
  const caption = element("span")
  caption.textContent = label
  const output = element("output")
  output.value = String(value)
  field.append(caption, output)
  return field
}

function booleanField(
  label: string,
  value: boolean,
  disabled: boolean,
  onChange: (value: boolean) => void,
  _technicalName?: string,
): HTMLElement {
  const field = element("label", "document-property-field wide inspector-switch bda-boolean-field")
  const caption = element("span")
  const accessibleLabel = label
  caption.textContent = label
  caption.title = accessibleLabel
  const input = element("input")
  input.type = "checkbox"
  input.setAttribute("aria-label", accessibleLabel)
  input.setAttribute("role", "switch")
  input.checked = value
  input.disabled = disabled
  input.addEventListener("change", () => onChange(input.checked))
  field.append(caption, input)
  return field
}

function styleCard(
  ref: BdaStyleRef,
  label: string,
  appearance: BdaAppearance,
  resolver: VisualResolver | undefined,
  editable: boolean,
  onChange: BdaStyleChange,
  onImageAction?: StyleEditorOptions["onImageAction"],
): HTMLElement | undefined {
  const imageStyle = ref.type === "image" ? appearance.imageStyles.get(ref.key) : undefined
  if (ref.type === "image" && !imageStyle) return
  const imageResourceNames = imageStyle
    ? [imageStyle.normalImage?.resource?.resourceID, imageStyle.highlightImage?.resource?.resourceID] as const
    : undefined
  const card = element("article", "bda-style-card")
  card.append(
    heading(label, `${ref.type} · ${ref.key}`),
    stylePreview(ref, resolver, editable, onImageAction, imageResourceNames),
  )
  const controls = element("div", "bda-style-controls")
  if (ref.type === "image") {
    const style = imageStyle!
    const advanced = element("div", "bda-style-controls bda-advanced-fields")
    const atomFields = (prefix: string, atom: typeof style.normalImage) => {
      if (!atom) return
      if (atom.innerRect) advanced.append(readonlyField(`${prefix}切片区域`, `${atom.innerRect.x}, ${atom.innerRect.y}, ${atom.innerRect.width}, ${atom.innerRect.height}`))
      if (atom.contentInset) advanced.append(readonlyField(`${prefix}内容边距`, `${atom.contentInset.top}, ${atom.contentInset.left}, ${atom.contentInset.bottom}, ${atom.contentInset.right}`))
      if (atom.alpha !== undefined) advanced.append(readonlyField(`${prefix}透明度`, atom.alpha))
      if (atom.filterColor !== undefined) advanced.append(readonlyField(`${prefix}滤色`, bdaColorHex(atom.filterColor)))
    }
    atomFields("正常", style.normalImage)
    atomFields("按下", style.highlightImage)
    if (style.fontInfo) {
      const font = style.fontInfo
      if (font.contentText !== undefined) advanced.append(readonlyField("图片内文字", font.contentText))
      if (font.fontSize !== undefined) advanced.append(readonlyField("图片内字号", font.fontSize))
      if (font.normalColor !== undefined) advanced.append(readonlyField("图片内正常文字色", bdaColorHex(font.normalColor)))
      if (font.highlightColor !== undefined) advanced.append(readonlyField("图片内按下文字色", bdaColorHex(font.highlightColor)))
      if (font.scaledOffset) advanced.append(readonlyField("图片内文字偏移", `${font.scaledOffset.x}, ${font.scaledOffset.y}`))
      if (font.drawType !== undefined) advanced.append(readonlyField("图片内文字绘制方式", font.drawType))
    }
    if (advanced.childElementCount) {
      const note = element("p", "bda-advanced-note")
      note.textContent = "高级图片字段（只读）"
      card.append(note, advanced)
    }
  } else if (ref.type === "color") {
    const style = appearance.colorStyles.get(ref.key)
    if (!style) return
    // An absent proto3 colour reads as 0 (transparent); every field is offered so it can be set.
    controls.append(colorField("正常颜色", style.normalColor ?? 0, !editable, (value) => onChange(ref, "NM_COLOR", value)))
    controls.append(colorField("按下颜色", style.highlightColor ?? 0, !editable, (value) => onChange(ref, "HL_COLOR", value)))
  } else {
    const style = appearance.textStyles.get(ref.key)
    if (!style) return
    controls.append(textField("字体", style.fontName ?? "", !editable, (value) => onChange(ref, "FONT_NAME", value)))
    controls.append(rangeField("字号", style.fontSize ?? 0, 1, 160, !editable, (value) => onChange(ref, "FONT_SIZE", String(value))))
    controls.append(colorField("正常文字", style.normalColor ?? 0, !editable, (value) => onChange(ref, "NM_COLOR", value)))
    controls.append(colorField("按下文字", style.highlightColor ?? 0, !editable, (value) => onChange(ref, "HL_COLOR", value)))
    if (style.resource) controls.append(readonlyField("字体资源", `${style.resource.type}:${style.resource.resourceID}`))
    controls.append(textField("显示文字", style.contentText ?? "", !editable, (value) => onChange(ref, "CONTENT_TEXT", value)))
  }
  if (controls.childElementCount) card.append(controls)
  return card
}

export function renderBdaStyleEditor(
  container: HTMLElement,
  options: StyleEditorOptions,
): void {
  container.replaceChildren()
  const card = styleCard(
    options.ref,
    `STYLE ${options.ref.key}`,
    options.appearance,
    options.resolver,
    options.editable,
    options.onStyleChange,
    options.onImageAction,
  )
  if (card) container.append(inspectorSection(card, "样式"))
}

export function renderBdaLayoutEditor(container: HTMLElement, options: LayoutEditorOptions): void {
  container.replaceChildren()
  const panel = options.appearance.panels.get(options.panelName.replace(/\.ini$/i, ""))
  if (!panel) return
  const scope = options.scope ?? "panel"
  container.dataset.bdaScope = options.keys.length ? "key" : scope
  container.classList.toggle("bda-key-inspector", options.keys.length > 0)
  container.classList.toggle("bda-panel-inspector", options.keys.length === 0 && scope === "panel")
  container.classList.toggle("bda-candidate-inspector", options.keys.length === 0 && scope === "candidate")
  const context = element("div", "bda-inspector-context")
  const badge = element("span", "bda-inspector-context-badge")
  badge.textContent = options.keys.length ? "按键" : scope === "candidate" ? "候选栏" : "面板"
  const name = element("strong")
  name.textContent = options.panelName
  context.append(badge, name)
  container.append(context)
  const groups = bdaLayoutStyleGroups(panel, options.keys, scope)

  const styleReferenceField = (item: BdaLayoutStyleItem): HTMLElement => {
    const isForeStyle = /^foreStyles\[\d+\]$/.test(item.field)
    const field = element("div", `document-property-field wide style-reference-field${isForeStyle ? " fore-style-reference-field" : ""}`)
    field.dataset.bdaStylePath = item.path.join(".")
    const caption = element("span")
    caption.className = "bda-style-reference-label"
    caption.textContent = item.label
    // 说明与源码字段对应，避免展示 INI 字段名造成误导。
    caption.title = item.label
    const control = element("span", "style-reference-input bda-style-reference-input")
    const keyInput = element("input")
    keyInput.className = "document-property-input"
    keyInput.value = item.ref && !item.mixed ? String(item.ref.key) : ""
    keyInput.placeholder = item.mixed ? "混合" : "未设置"
    // Mixed keys may reference different kinds of style: only the picker (which names the kind) changes them.
    keyInput.disabled = !options.editable || Boolean(item.mixed)
    keyInput.setAttribute("aria-label", `${item.label}编号`)
    const styles = { image: options.appearance.imageStyles, text: options.appearance.textStyles, color: options.appearance.colorStyles }[item.type]
    const currentRef = (): BdaStyleRef | undefined => {
      const key = Number(keyInput.value)
      return keyInput.value.trim() && Number.isInteger(key) ? { type: item.type, key } : undefined
    }
    const commit = () => {
      const ref = currentRef()
      // A number naming no style of this kind would leave a dangling reference.
      if (!ref || !styles.has(ref.key)) {
        keyInput.value = item.ref && !item.mixed ? String(item.ref.key) : ""
        return
      }
      options.onStyleRefChange?.(item.paths ?? [item.path], ref, field)
    }
    keyInput.addEventListener("change", commit)
    const preview = element("button", "style-picker-trigger bda-style-reference-preview")
    preview.type = "button"
    preview.disabled = !options.editable
    preview.title = "点击更换样式；Command/Ctrl 点击编辑样式"
    preview.setAttribute("aria-label", `${item.label}：点击更换样式，Command/Ctrl 点击编辑样式`)
    const states = element("span", "style-picker-states")
    for (const [highlighted, label] of [[false, "正常"], [true, "按下"]] as const) {
      const state = element("span", "style-picker-state")
      state.dataset.stateLabel = label
      const canvas = element("canvas")
      canvas.setAttribute("aria-label", `${label}状态`)
      state.append(canvas)
      states.append(state)
      if (item.ref && !item.mixed) void options.resolver?.resolve(bdaStyleID(item.ref), highlighted)
        .then((visual) => { if (canvas.isConnected) drawVisual(canvas, visual) })
        .catch(() => {})
    }
    preview.append(states)
    preview.addEventListener("click", (event) => {
      const edit = event.metaKey || event.ctrlKey
      const ref = currentRef()
      if (edit && !ref) return
      options.onStyleRefAction?.(
        item.paths ?? [item.path],
        ref ?? { type: item.type, key: -1 },
        item.field,
        edit ? "edit" : "replace",
        field,
      )
    })
    const meta = element("span", "style-reference-meta")
    meta.append(keyInput)
    control.append(meta, preview)
    field.append(caption, control)
    return field
  }

  const appendStyleReferences = (grid: HTMLElement, items: BdaLayoutStyleItem[]) => {
    const appendItems = (container: HTMLElement, ownedItems: BdaLayoutStyleItem[]) => {
      for (let index = 0; index < ownedItems.length;) {
        const item = ownedItems[index]
        if (!/^foreStyles\[\d+\]$/.test(item.field)) {
          container.append(styleReferenceField(item))
          index += 1
          continue
        }
        const collectionPath = item.path.slice(0, -2).join(".")
        const collection: BdaLayoutStyleItem[] = []
        while (index < ownedItems.length) {
          const next = ownedItems[index]
          if (!/^foreStyles\[\d+\]$/.test(next.field) || next.path.slice(0, -2).join(".") !== collectionPath) break
          collection.push(next)
          index += 1
        }
        const field = element("div", "document-property-field wide style-reference-field fore-styles-reference-field")
        const strip = element("div", "bda-fore-styles-grid")
        strip.append(...collection.map((entry, itemIndex) => {
          const row = styleReferenceField(entry)
          const rowCaption = row.querySelector<HTMLElement>(".bda-style-reference-label")
          if (rowCaption) {
            rowCaption.replaceChildren()
            rowCaption.append(document.createTextNode(
              itemIndex === 0 ? "前景样式 · 主" : itemIndex === 1 ? "前景样式 · 辅" : `前景样式 · 辅 ${itemIndex}`,
            ))
          }
          return row
        }))
        field.append(strip)
        container.append(field)
      }
    }
    for (let index = 0; index < items.length;) {
      const owner = items[index].owner
      if (!owner) {
        const unowned: BdaLayoutStyleItem[] = []
        while (index < items.length && !items[index].owner) {
          unowned.push(items[index])
          index += 1
        }
        appendItems(grid, unowned)
        continue
      }
      const block = element("section", "bda-key-style-block")
      const title = element("h4")
      title.textContent = owner
      block.append(title)
      const owned: BdaLayoutStyleItem[] = []
      while (index < items.length && items[index].owner === owner) {
        owned.push(items[index])
        index += 1
      }
      appendItems(block, owned)
      grid.append(block)
    }
  }

  for (const group of groups) {
    const section = inspectorSection(element("section", "document-property-section bda-panel-property-section"), group.title)
    const title = element("h3")
    title.textContent = group.title
    const grid = element("div", "document-property-grid")
    // Panel switches and the swipe trail colour are proto3 values: absent means off / transparent.
    if (scope === "panel" && !options.keys.length && group.key === "panel") {
      grid.append(booleanField("背景模糊", panel.shouldBgBlur ?? false, !options.editable, (value) => options.onPanelPropertyChange("shouldBgBlur", value), "shouldBgBlur"))
      grid.append(booleanField("按键开槽", panel.shouldKeySlotting ?? false, !options.editable, (value) => options.onPanelPropertyChange("shouldKeySlotting", value), "shouldKeySlotting"))
      const field = colorField("滑动轨迹颜色", panel.trackColor ?? 0, !options.editable, (value) => options.onPanelPropertyChange("trackColor", value))
      field.classList.add("document-property-field", "wide")
      grid.append(field)
    }
    appendStyleReferences(grid, group.items)
    section.append(title, grid)
    container.append(section)
  }
  if (!groups.length) {
    const empty = element("p", "bda-editor-empty")
    empty.textContent = scope === "candidate"
      ? "当前面板的 appearanceConfig 里没有候选栏样式。"
      : "当前对象没有可编辑的 BDA 面板属性。"
    container.append(empty)
  }
}

export async function refreshBdaStyleReferenceField(
  field: HTMLElement,
  ref: BdaStyleRef,
  resolver?: VisualResolver,
): Promise<void> {
  const input = field.querySelector<HTMLInputElement>(".document-property-input")
  if (input) input.value = String(ref.key)
  if (!resolver) return
  const canvases = [...field.querySelectorAll<HTMLCanvasElement>("canvas")]
  const highlighted = canvases.length > 1 ? [false, true] : [false]
  await Promise.all(canvases.map(async (canvas, index) => {
    const visual = await resolver.resolve(bdaStyleID(ref), highlighted[index] ?? false).catch(() => undefined)
    if (canvas.isConnected) drawVisual(canvas, visual)
  }))
}

export function renderBdaConfigEditor(container: HTMLElement, options: ConfigEditorOptions): void {
  container.replaceChildren()
  const name = options.path.split("/").pop() ?? options.path
  if (/^\d*appearanceConfig$/i.test(name)) {
    const appearance = decodeBdaAppearance(options.bytes)
    const summary = inspectorSection(element("div", "bda-editor-summary"), "外观")
    summary.append(heading("外观配置", `${appearance.panels.size} 个布局 · ${appearance.imageStyles.size + appearance.textStyles.size + appearance.colorStyles.size} 个样式`))
    if (appearance.designWidth !== undefined) {
      summary.append(rangeField("设计宽度", appearance.designWidth, 320, 2160, !options.editable, options.onDesignWidth))
    }
    const panels = inspectorSection(element("div", "bda-panel-list"), "布局")
    for (const [panelName, panel] of appearance.panels) {
      const card = element("article")
      card.append(heading(panelName, `${panel.keys.size} 个按键`))
      panels.append(card)
    }
    container.append(summary, panels)
    return
  }
  if (/animationConfig$/i.test(name)) {
    renderBdaAnimationEditor(container, {
      animation: decodeBdaAnimation(options.bytes),
      resolver: options.resolver,
      editable: options.editable,
      onDesignWidth: options.onDesignWidth,
      onAnimationFrame: options.onAnimationFrame,
      onAnimationEffect: options.onAnimationEffect,
      onPickAnimationResource: options.onPickAnimationResource,
    })
    return
  }
  if (/^\d*soundConfig$/i.test(name)) {
    const sound = decodeBdaSoundConfig(options.bytes)
    const list = inspectorSection(element("div", "bda-sound-list"), "声音")
    for (const [key, resource] of [...sound.keySounds, ...sound.iosKeySounds]) {
      const card = element("article")
      card.append(heading(key, resource.resourceID))
      list.append(card)
    }
    container.append(list)
    return
  }
  const empty = element("p", "bda-editor-empty")
  empty.textContent = "这个源文件已解码，但当前没有受支持的可视化编辑项。"
  container.append(empty)
}

export function renderBdaMetadataEditor(container: HTMLElement, options: MetadataEditorOptions): void {
  container.replaceChildren()
  const labels: Record<string, string> = {
    Name: "皮肤名称",
    Description: "描述",
    Author: "作者",
    VersionCode: "版本号",
    MinImeCode: "最低输入法版本",
    SupportPlatform: "支持平台",
    SupportDarkMode: "支持深色模式",
    Style: "皮肤风格",
    SkinType: "加载主题",
    SkinFlags: "半屏手写高度",
    Abilities: "功能标识",
    AtomSkinName: "主题目录",
  }
  const card = inspectorSection(element("article", "bda-metadata-card"), "皮肤")
  card.append(heading("皮肤信息", `${options.entries.length} 个实际字段`))
  const controls = element("div", "bda-style-controls")
  for (const entry of options.entries) {
    controls.append(textField(labels[entry.key] ?? entry.key, entry.value, !options.editable, (value) => options.onChange(entry.key, value)))
  }
  card.append(controls)
  container.append(card)
}
