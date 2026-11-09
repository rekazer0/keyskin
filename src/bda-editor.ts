import { drawVisualText, type Visual, type VisualResolver } from "./atlas.ts"
import { bdaStyleID, type BdaAppearance, type BdaKey, type BdaStyleRef } from "./bda.ts"
import { bdaColorHex } from "./bda-resolver.ts"
import { decodeBdaAnimation, decodeBdaAppearance, decodeBdaSoundConfig } from "./bda-decode.ts"
import { renderBdaAnimationEditor, type BdaAnimationView } from "./bda-animation-editor.ts"
import type { KeyboardPlayback } from "./animation-player.ts"
import { bdaLayoutStyleGroups, NEW_FORE_LAYER, type BdaLayoutStyleItem } from "./bda-layout-styles.ts"
import { element, emptyState, iconButton, shortcutLabel } from "./dom-element.ts"
import { field, section } from "./app/property-rows.ts"
import { configField } from "./app/config-value-control.ts"
import { styleKindIcon, styleReferenceCard, type StyleReferenceState } from "./style-card.ts"

type BdaStyleChange = (ref: BdaStyleRef, property: string, value: string) => void
type BdaLayoutScope = "panel" | "candidate"

type LayoutEditorOptions = {
  appearance: BdaAppearance
  panelName: string
  keys: Array<{ name: string; key: BdaKey }>
  scope?: BdaLayoutScope
  resolver?: VisualResolver
  editable: boolean
  onStyleChange: BdaStyleChange
  onPanelPropertyChange: (property: "shouldBgBlur" | "shouldKeySlotting" | "trackColor", value: boolean | string) => void
  /** `ref` undefined removes the reference (a foreground layer leaves its list). */
  onStyleRefChange?: (paths: string[][], ref: BdaStyleRef | undefined, field: HTMLElement) => void
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
  keyboardPlayback?: (effectID: string) => KeyboardPlayback
  animationView: BdaAnimationView
}

type MetadataEditorOptions = {
  entries: Array<{ key: string; value: string }>
  editable: boolean
  /** 与百度文档检查器共用的中文标签。 */
  label: (key: string) => string
  onChange: (key: string, value: string) => void
}

function inspectorSection<T extends HTMLElement>(node: T, label: string): T {
  node.classList.add("ui-section", "bda-inspector-section")
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
  const preview = element("div", "bda-style-preview ui-checker")
  for (const [index, [highlighted, label]] of ([[false, "正常"], [true, "按下"]] as const).entries()) {
    const state = ref.type === "image" && onImageAction ? element("button") : element("figure")
    if (state instanceof HTMLButtonElement) {
      state.type = "button"
      state.disabled = !editable
      state.title = `单击更换图片，${shortcutLabel("单击")}进入切片工具`
      state.setAttribute("aria-label", `${label}状态图片：${state.title}`)
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

function colorField(label: string, value: number, disabled: boolean, onChange: (value: string) => void): HTMLElement {
  return field({ key: label, label, editable: !disabled, spec: { kind: "color", value: bdaColorHex(value), codec: "argb" }, commit: (next) => { if (next) onChange(next) } })
}

/** 正常 | 按下两个色块一行（DESIGN.md §10）。 */
function colorPairField(label: string, values: [number | undefined, number | undefined], disabled: boolean, onChange: (property: "NM_COLOR" | "HL_COLOR", value: string) => void): HTMLElement {
  return field({ key: "NM_COLOR HL_COLOR", label, editable: !disabled, spec: { kind: "colorPair", values: [bdaColorHex(values[0] ?? 0), bdaColorHex(values[1] ?? 0)], codec: "argb" },
    commit: (next, { index = 0 }) => { if (next[index]) onChange(index ? "HL_COLOR" : "NM_COLOR", next[index]) } })
}

function numberField(label: string, value: number, disabled: boolean, onChange: (value: number) => void, range?: "fontSize"): HTMLElement {
  return field({ key: label, label, editable: !disabled, spec: { kind: "number", value: String(value), min: 1, step: 1, range },
    commit: (next) => { if (next !== "" && Number.isFinite(Number(next))) onChange(Number(next)) } })
}

function textField(label: string, value: string, disabled: boolean, onChange: (value: string) => void): HTMLElement {
  return field({ key: label, label, editable: !disabled, spec: { kind: "text", value }, commit: onChange })
}

function readonlyField(label: string, value: string | number): HTMLElement {
  return field({ key: label, label, spec: { kind: "readonly", value: String(value) } })
}

function booleanField(label: string, value: boolean, disabled: boolean, onChange: (value: boolean) => void): HTMLElement {
  return field({ key: label, label, editable: !disabled, spec: { kind: "switch", checked: value }, commit: onChange })
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
    controls.append(colorPairField("颜色", [style.normalColor, style.highlightColor], !editable, (property, value) => onChange(ref, property, value)))
  } else {
    const style = appearance.textStyles.get(ref.key)
    if (!style) return
    controls.append(textField("字体", style.fontName ?? "", !editable, (value) => onChange(ref, "FONT_NAME", value)))
    controls.append(numberField("字号", style.fontSize ?? 0, !editable, (value) => onChange(ref, "FONT_SIZE", String(value)), "fontSize"))
    controls.append(colorPairField("文字颜色", [style.normalColor, style.highlightColor], !editable, (property, value) => onChange(ref, property, value)))
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
  const badge = element("span", "ui-badge")
  badge.textContent = options.keys.length ? "按键" : scope === "candidate" ? "候选栏" : "面板"
  const name = element("strong")
  name.textContent = options.panelName
  context.append(badge, name)
  container.append(context)
  const groups = bdaLayoutStyleGroups(panel, options.keys, scope)

  const styleReferenceField = (item: BdaLayoutStyleItem): HTMLElement => {
    const isForeStyle = /^foreStyles\[\d+\]$/.test(item.field)
    const field = element("div", `ui-field style-reference-field${isForeStyle ? " fore-style-reference-field" : ""}`)
    field.dataset.bdaStylePath = item.path.join(".")
    const caption = element("span")
    caption.className = "bda-style-reference-label"
    caption.textContent = item.label
    // 说明与源码字段对应，避免展示 INI 字段名造成误导。
    caption.title = item.label
    const keyInput = element("input")
    keyInput.className = "ui-style-ref-name"
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
    // 单击换样式，⌘ 单击编辑样式；没有引用时只画一张紧凑虚线卡。
    const act = (edit: boolean) => {
      const ref = currentRef()
      if (edit && !ref) return
      options.onStyleRefAction?.(item.paths ?? [item.path], ref ?? { type: item.type, key: -1 }, item.field, edit ? "edit" : "replace", field)
    }
    const onClick = options.editable ? act : undefined
    const ref = item.ref
    const states: StyleReferenceState[] = item.mixed ? [{ label: "混合", content: "混合", onClick }]
      : ref ? [false, true].map((highlighted) => ({
        label: highlighted ? "按下" : "正常",
        draw: async (canvas: HTMLCanvasElement) => drawVisual(canvas, await options.resolver?.resolve(bdaStyleID(ref), highlighted).catch(() => undefined)),
        onClick,
      })) : []
    // 追加前景层：只有一行「前景」标签，右端 plus（排在前景层之前）。
    if (item.field === NEW_FORE_LAYER) {
      field.classList.add("bda-fore-style-add")
      caption.textContent = "前景"
      field.append(caption)
      if (options.editable) {
        const add = iconButton("plus", "添加前景", () => act(false))
        add.classList.add("ui-style-ref-append")
        add.dataset.size = "sm"
        caption.append(add)
      }
      return field
    }
    field.append(caption, styleReferenceCard({
      name: keyInput,
      kind: ref || item.mixed ? styleKindIcon(item.type) : undefined,
      states,
      empty: { icon: "plus", label: "选择样式", onClick: () => act(false) },
      remove: ref || item.mixed ? { label: "移除", run: () => options.onStyleRefChange?.(item.paths ?? [item.path], undefined, field) } : undefined,
      disabled: !options.editable,
    }))
    return field
  }

  const appendStyleReferences = (grid: HTMLElement, items: BdaLayoutStyleItem[]) => {
    const appendItems = (container: HTMLElement, ownedItems: BdaLayoutStyleItem[]) => {
      for (let index = 0; index < ownedItems.length;) {
        const item = ownedItems[index]
        if (!/^foreStyles\[(\d+|\+)\]$/.test(item.field)) {
          container.append(styleReferenceField(item))
          index += 1
          continue
        }
        const collectionPath = item.path.slice(0, -2).join(".")
        const collection: BdaLayoutStyleItem[] = []
        while (index < ownedItems.length) {
          const next = ownedItems[index]
          if (!/^foreStyles\[(\d+|\+)\]$/.test(next.field) || next.path.slice(0, -2).join(".") !== collectionPath) break
          collection.push(next)
          index += 1
        }
        const strip = element("div", "bda-fore-styles-grid")
        const adder = collection.find((entry) => entry.field === NEW_FORE_LAYER)
        if (adder) strip.append(styleReferenceField(adder))
        strip.append(...collection.filter((entry) => entry !== adder).map((entry, itemIndex) => {
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
        container.append(strip)
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
    const grid = section(group.title, [], { className: "bda-inspector-section bda-panel-property-section" })
    // Panel switches and the swipe trail colour are proto3 values: absent means off / transparent.
    if (scope === "panel" && !options.keys.length && group.key === "panel") {
      grid.append(booleanField("背景模糊", panel.shouldBgBlur ?? false, !options.editable, (value) => options.onPanelPropertyChange("shouldBgBlur", value)))
      grid.append(booleanField("按键开槽", panel.shouldKeySlotting ?? false, !options.editable, (value) => options.onPanelPropertyChange("shouldKeySlotting", value)))
      grid.append(colorField("滑动轨迹颜色", panel.trackColor ?? 0, !options.editable, (value) => options.onPanelPropertyChange("trackColor", value)))
    }
    appendStyleReferences(grid, group.items)
    container.append(grid)
  }
  if (!groups.length) {
    container.append(emptyState("sliders-horizontal", scope === "candidate" ? "没有候选栏样式" : "没有可编辑的属性"))
  }
}

export async function refreshBdaStyleReferenceField(
  field: HTMLElement,
  ref: BdaStyleRef,
  resolver?: VisualResolver,
): Promise<void> {
  const input = field.querySelector<HTMLInputElement>(".ui-style-ref-name")
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
      summary.append(numberField("设计宽度", appearance.designWidth, !options.editable, options.onDesignWidth))
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
      path: options.path,
      view: options.animationView,
      resolver: options.resolver,
      editable: options.editable,
      onDesignWidth: options.onDesignWidth,
      onAnimationFrame: options.onAnimationFrame,
      onAnimationEffect: options.onAnimationEffect,
      onPickAnimationResource: options.onPickAnimationResource,
      keyboardPlayback: options.keyboardPlayback,
    })
    return
  }
  if (/^\d*soundConfig$/i.test(name)) {
    const sound = decodeBdaSoundConfig(options.bytes)
    const list = inspectorSection(element("div", "bda-sound-list"), "音效")
    for (const [key, resource] of [...sound.keySounds, ...sound.iosKeySounds]) {
      const card = element("article")
      card.append(heading(key, resource.resourceID))
      list.append(card)
    }
    container.append(list)
    return
  }
  container.append(emptyState("sliders-horizontal", "没有可编辑的属性"))
}

export function renderBdaMetadataEditor(container: HTMLElement, options: MetadataEditorOptions): void {
  container.replaceChildren()
  const card = inspectorSection(element("article", "bda-metadata-card"), "皮肤")
  card.append(heading("皮肤信息"))
  for (const { key, value } of options.entries) {
    const label = options.label(key)
    const commit = (next: string) => options.onChange(key, next)
    card.append(configField("", key, label, value, options.editable, commit)
      ?? field({ key, label, editable: options.editable, spec: { kind: "text", value }, commit }))
  }
  container.append(card)
}
