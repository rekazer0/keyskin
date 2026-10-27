import { type Visual, type VisualResolver } from "./atlas.ts"
import type {
  BdaAnimation,
  BdaAnimationBinding,
  BdaAnimationEffect,
  BdaAnimationFrame,
  BdaAnimationKind,
  BdaAnimationSequence,
  BdaEmitterAnimation,
  BdaNumberRange,
  BdaTransformAnimation,
} from "./bda.ts"
import { element } from "./dom-element.ts"
import { createIcon } from "./icons.ts"

type BdaAnimationEditorOptions = {
  animation: BdaAnimation
  resolver?: VisualResolver
  editable: boolean
  onDesignWidth: (value: number) => void
  onAnimationFrame: (sequence: string, frame: number, property: "resourceID" | "duration", value: string | number) => void
  onAnimationEffect: (key: string, property: string, value: string | number | boolean) => void
  onPickAnimationResource: (sequence: string, frame: number) => void
}

type EffectValue = string | number | boolean
type EffectUpdate = (property: string, value: EffectValue) => void
type FieldOption = { step?: number; min?: number }

const KIND_LABELS: Record<BdaAnimationKind, string> = {
  group: "组合",
  alpha: "透明度",
  scale: "缩放",
  shift: "位移",
  rotate: "旋转",
  frame: "帧动画",
  image: "图片序列",
  emitter: "粒子",
  lottie: "Lottie",
  video: "视频",
}

const KIND_ICONS: Record<BdaAnimationKind, string> = {
  group: "layers",
  alpha: "circle-dot",
  scale: "maximize",
  shift: "move",
  rotate: "rotate-cw",
  frame: "film",
  image: "images",
  emitter: "sparkles",
  lottie: "clapperboard",
  video: "clapperboard",
}

const KIND_ORDER: readonly BdaAnimationKind[] = [
  "group", "alpha", "scale", "shift", "rotate", "frame", "image", "emitter", "lottie", "video",
]

// EventType / AnimationScopeType / IntpolType，字段号见 APK animation.proto。
const EVENT_LABELS = ["键盘将显示", "按键按下", "按键抬起", "元素显示", "元素隐藏", "空闲进入", "空闲退出", "按键长按", "插入文字", "皮肤切换"]
const SCOPE_LABELS = ["前景", "背景", "混合"]
const LOCATION_LABELS = ["顶部", "底部"]
const REPEAT_MODE_LABELS = ["正向", "往返"]
const INTERPOLATION_LABELS = ["线性", "缓入", "缓出", "缓入缓出", "回弹"]
const FINISH_LABELS = ["发射完所有粒子", "粒子全部消失"]

type EmitterRangeKey =
  | "life" | "rotation" | "spin" | "scale" | "scaleSpeed" | "alpha" | "alphaSpeed"
  | "velocity" | "velocityDirection" | "acceleration" | "accelerationDirection"

const EMITTER_RANGES: ReadonlyArray<readonly [EmitterRangeKey, string]> = [
  ["life", "生命周期"],
  ["rotation", "初始角度"],
  ["spin", "自旋速度"],
  ["scale", "开局缩放"],
  ["scaleSpeed", "缩放速度"],
  ["alpha", "开局透明度"],
  ["alphaSpeed", "透明度速度"],
  ["velocity", "初速度"],
  ["velocityDirection", "速度方向"],
  ["acceleration", "加速度"],
  ["accelerationDirection", "加速度方向"],
]

/* —— 通用 DOM —— */

function section(title: string): HTMLElement {
  const node = element("section", "ui-section bda-inspector-section bda-animation-section")
  node.dataset.inspectorGroupLabel = title
  const heading = element("h3")
  heading.textContent = title
  node.append(heading)
  return node
}

function body(...children: HTMLElement[]): HTMLElement {
  const node = element("div", "bda-animation-body")
  node.append(...children)
  return node
}

function card(key: string, detail: string): HTMLElement {
  const node = element("article", "bda-animation-card")
  const header = element("header", "bda-card-heading")
  const strong = element("strong")
  strong.textContent = key
  const small = element("small")
  small.textContent = detail
  header.append(strong, small)
  node.append(header)
  return node
}

function note(text: string): HTMLElement {
  const node = element("p", "ui-field-note")
  node.textContent = text
  return node
}

function row(label: string, control: HTMLElement): HTMLElement {
  const node = element("label", "ui-field bda-animation-field")
  const caption = element("span")
  caption.textContent = label
  node.append(caption, control)
  return node
}

function valueRow(label: string, value: string): HTMLElement {
  const node = element("div", "ui-field bda-animation-field")
  const caption = element("span")
  caption.textContent = label
  const output = element("span", "bda-animation-value")
  output.textContent = value
  output.title = value
  node.append(caption, output)
  return node
}

function fieldsBox(...children: HTMLElement[]): HTMLElement {
  const node = element("div", "bda-animation-fields")
  node.append(...children)
  return node
}

function numberControl(label: string, value: number, editable: boolean, onChange: (value: number) => void, options: FieldOption = {}): HTMLInputElement {
  const input = element("input", "ui-input")
  input.type = "number"
  input.step = String(options.step ?? 1)
  if (options.min !== undefined) input.min = String(options.min)
  input.value = String(value)
  input.disabled = !editable
  input.setAttribute("aria-label", label)
  input.addEventListener("change", () => {
    const next = Number(input.value)
    if (Number.isFinite(next)) onChange(next)
  })
  return input
}

function numberRow(label: string, value: number, editable: boolean, onChange: (value: number) => void, options: FieldOption = {}): HTMLElement {
  return row(label, numberControl(label, value, editable, onChange, options))
}

function affixedNumber(label: string, affix: string, value: number, editable: boolean, onChange: (value: number) => void, options: FieldOption = {}): HTMLElement {
  const wrapper = element("span", "ui-input")
  const prefix = element("span", "ui-input-affix")
  prefix.textContent = affix
  wrapper.append(prefix, numberControl(label, value, editable, onChange, options))
  return wrapper
}

function pairRow(
  label: string,
  values: readonly [number, number],
  editable: boolean,
  onChange: (index: 0 | 1, value: number) => void,
  affixes: readonly [string, string] = ["最小", "最大"],
  options: FieldOption = {},
): HTMLElement {
  const pair = element("span", "ui-field-pair")
  pair.dataset.columns = "2"
  pair.append(
    affixedNumber(`${label}${affixes[0]}`, affixes[0], values[0], editable, (value) => onChange(0, value), options),
    affixedNumber(`${label}${affixes[1]}`, affixes[1], values[1], editable, (value) => onChange(1, value), options),
  )
  return row(label, pair)
}

function quadRow(
  label: string,
  values: readonly number[],
  editable: boolean,
  onChange: (index: number, value: number) => void,
  affixes: readonly string[],
): HTMLElement {
  const pair = element("span", "ui-field-pair")
  pair.dataset.columns = String(values.length)
  pair.append(...values.map((value, index) => affixedNumber(
    `${label}${affixes[index]}`,
    affixes[index],
    value,
    editable,
    (next) => onChange(index, next),
    { step: 0.5, min: 0 },
  )))
  return row(label, pair)
}

function selectControl(label: string, values: readonly string[], value: number, editable: boolean, onChange: (value: number) => void): HTMLElement {
  const wrapper = element("span", "ui-select")
  const select = element("select", "ui-input")
  values.forEach((text, index) => {
    const option = element("option")
    option.value = String(index)
    option.textContent = text
    select.append(option)
  })
  select.value = String(value)
  select.disabled = !editable
  select.setAttribute("aria-label", label)
  select.addEventListener("change", () => onChange(Number(select.value)))
  wrapper.append(select)
  return wrapper
}

function selectRow(label: string, values: readonly string[], value: number, editable: boolean, onChange: (value: number) => void): HTMLElement {
  return row(label, selectControl(label, values, value, editable, onChange))
}

function selectPairRow(
  label: string,
  values: readonly string[],
  current: readonly [number, number],
  editable: boolean,
  onChange: (index: 0 | 1, value: number) => void,
): HTMLElement {
  const pair = element("span", "ui-field-pair")
  pair.dataset.columns = "2"
  pair.append(
    selectControl(`${label} X`, values, current[0], editable, (value) => onChange(0, value)),
    selectControl(`${label} Y`, values, current[1], editable, (value) => onChange(1, value)),
  )
  return row(label, pair)
}

function switchRow(label: string, value: boolean, editable: boolean, onChange: (value: boolean) => void): HTMLElement {
  const input = element("input", "ui-switch")
  input.type = "checkbox"
  input.setAttribute("role", "switch")
  input.checked = value
  input.disabled = !editable
  input.setAttribute("aria-label", label)
  input.addEventListener("change", () => onChange(input.checked))
  return row(label, input)
}

function textControl(label: string, value: string, editable: boolean, onChange: (value: string) => void): HTMLInputElement {
  const input = element("input", "ui-input")
  input.type = "text"
  input.value = value
  input.disabled = !editable
  input.setAttribute("aria-label", label)
  input.addEventListener("change", () => onChange(input.value))
  return input
}

function textRow(label: string, value: string, editable: boolean, onChange: (value: string) => void): HTMLElement {
  return row(label, textControl(label, value, editable, onChange))
}

/* —— 预览 —— */

function drawVisual(canvas: HTMLCanvasElement, visual: Visual | undefined): void {
  if (!visual) return
  const bounds = canvas.getBoundingClientRect()
  const width = Math.max(1, Math.round(bounds.width || 128))
  const height = Math.max(1, Math.round(bounds.height || 76))
  const scale = Math.max(1, window.devicePixelRatio || 1)
  canvas.width = width * scale
  canvas.height = height * scale
  const context = canvas.getContext("2d")
  if (!context) return
  context.setTransform(scale, 0, 0, scale, 0, 0)
  context.clearRect(0, 0, width, height)
  if (visual.color) {
    context.fillStyle = visual.color
    context.fillRect(0, 0, width, height)
  }
  if (visual.image) {
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
}

function frameDurations(frames: readonly BdaAnimationFrame[]): number[] {
  return frames.map((frame) => Math.max(16, frame.duration ?? 100))
}

function animationPlayer(frames: readonly BdaAnimationFrame[], resolver: VisualResolver | undefined): HTMLElement {
  const player = element("section", "bda-animation-player")
  const canvas = element("canvas", "bda-animation-player-canvas")
  const controls = element("div", "bda-animation-player-controls")
  const play = element("button", "ui-button")
  play.type = "button"
  const label = element("span")
  label.textContent = "播放预览"
  play.append(createIcon("play", 14), label)
  play.disabled = !frames.length
  const status = element("output", "bda-animation-player-status")
  const durations = frameDurations(frames)
  let timer: number | undefined
  let run = 0
  const show = (index: number) => {
    status.value = frames.length ? `第 ${index + 1} / ${frames.length} 帧` : "没有动画帧"
    const resourceID = frames[index]?.resourceID
    if (!resourceID) return
    void resolver?.resolveResource?.(resourceID)
      .then((visual) => { if (canvas.isConnected) drawVisual(canvas, visual) })
      .catch(() => {})
  }
  const stop = (text: string) => {
    run += 1
    if (timer !== undefined) window.clearTimeout(timer)
    timer = undefined
    label.textContent = text
  }
  play.addEventListener("click", () => {
    if (!frames.length) return
    if (timer !== undefined) return stop("播放预览")
    const currentRun = ++run
    let index = 0
    label.textContent = "停止"
    const advance = () => {
      if (currentRun !== run || !player.isConnected) return
      show(index)
      timer = window.setTimeout(() => {
        index += 1
        if (index < frames.length) advance()
        else stop("重新播放")
      }, durations[index])
    }
    advance()
  })
  show(0)
  controls.append(play, status)
  player.append(canvas, controls)
  return player
}

function frameCard(sequence: BdaAnimationSequence, frame: BdaAnimationFrame, index: number, options: BdaAnimationEditorOptions): HTMLElement {
  const node = element("article", "bda-animation-frame-card")
  const header = element("header", "bda-card-heading")
  const strong = element("strong")
  strong.textContent = `第 ${index + 1} 帧`
  const small = element("small")
  small.textContent = frame.resourceID ?? "未设置资源"
  header.append(strong, small)
  const content = element("div", "bda-animation-frame")
  if (frame.resourceID !== undefined) {
    const preview = element("button", "bda-animation-frame-preview")
    preview.type = "button"
    preview.disabled = !options.editable
    preview.setAttribute("aria-label", `更换第 ${index + 1} 帧图片资源`)
    const canvas = element("canvas", "bda-animation-frame-canvas")
    preview.append(canvas)
    preview.addEventListener("click", () => options.onPickAnimationResource(sequence.name, index))
    if (options.resolver) {
      void options.resolver.resolveResource?.(frame.resourceID)
        .then((visual) => { if (canvas.isConnected) drawVisual(canvas, visual) })
        .catch(() => {})
    }
    content.append(preview)
  }
  const fields = fieldsBox(
    textRow("图片资源", frame.resourceID ?? "", options.editable, (value) => options.onAnimationFrame(sequence.name, index, "resourceID", value)),
  )
  if (frame.duration !== undefined) {
    fields.append(numberRow("时长（毫秒）", frame.duration, options.editable, (value) => options.onAnimationFrame(sequence.name, index, "duration", value), { min: 0 }))
  }
  content.append(fields)
  node.append(header, content)
  return node
}

function sequenceEditor(effect: Extract<BdaAnimationEffect, { kind: "image" }>, options: BdaAnimationEditorOptions): HTMLElement {
  const block = element("div", "bda-animation-sequence")
  const strip = element("div", "bda-animation-frames")
  strip.append(...effect.sequence.frames.map((frame, index) => frameCard(effect.sequence, frame, index, options)))
  block.append(animationPlayer(effect.sequence.frames, options.resolver), strip)
  return block
}

/* —— 效果字段 —— */

function eventLabel(event: number): string {
  return EVENT_LABELS[event] ?? `事件 ${event}`
}

function scopeLabel(scope: number): string {
  return SCOPE_LABELS[scope] ?? `范围 ${scope}`
}

function repeatModeLabel(mode: number): string {
  return REPEAT_MODE_LABELS[mode] ?? `模式 ${mode}`
}

function timelineSummary(effect: BdaAnimationEffect): string {
  switch (effect.kind) {
    case "group":
      return `延迟 ${effect.delay} ms × ${effect.repeatCount} 次`
    case "alpha":
    case "scale":
    case "shift":
    case "rotate":
      return `延迟 ${effect.delay} ms + 时长 ${effect.duration} ms × ${effect.repeatCount} 次 · ${repeatModeLabel(effect.repeatMode)}`
    case "emitter":
      return `时长 ${effect.duration} ms × ${effect.repeatCount} 次 · ${repeatModeLabel(effect.repeatMode)}`
    case "image":
      return `${effect.sequence.frames.length} 帧 × ${effect.repeatCount} 次 · ${repeatModeLabel(effect.repeatMode)}${effect.loopForever ? " · 循环播放" : ""}`
    case "frame":
    case "lottie":
    case "video":
      return `重复 ${effect.repeatCount} 次${effect.startRepeatFrame !== undefined ? ` · 起始帧 ${effect.startRepeatFrame}` : ""}`
  }
}

function commonEffectRows(effect: BdaAnimationEffect, editable: boolean, update: EffectUpdate): HTMLElement[] {
  const rows: HTMLElement[] = [numberRow("重复次数", effect.repeatCount, editable, (value) => update("repeatCount", value), { min: 0 })]
  if ("repeatMode" in effect) {
    rows.push(selectRow("重复模式", REPEAT_MODE_LABELS, effect.repeatMode, editable, (value) => update("repeatMode", value)))
  }
  if ("delay" in effect) rows.push(numberRow("延迟（毫秒）", effect.delay, editable, (value) => update("delay", value), { min: 0 }))
  if ("duration" in effect) {
    rows.push(numberRow("时长（毫秒）", effect.duration, editable, (value) => update("duration", value), { min: 0, step: effect.kind === "emitter" ? 0.5 : 1 }))
  }
  if ("interpolation" in effect) {
    rows.push(selectRow("插值方式", INTERPOLATION_LABELS, effect.interpolation, editable, (value) => update("interpolation", value)))
  }
  rows.push(switchRow("结束后移除", effect.removeOnFinish, editable, (value) => update("removeOnFinish", value)))
  return rows
}

function transformRows(effect: BdaTransformAnimation, editable: boolean, update: EffectUpdate): HTMLElement[] {
  const rows: HTMLElement[] = []
  if (effect.kind === "alpha" || effect.kind === "rotate") {
    rows.push(
      pairRow("起始值", effect.from[0], editable, (index, value) => update(index ? "fromMax" : "fromMin", value), ["最小", "最大"]),
      pairRow("结束值", effect.to[0], editable, (index, value) => update(index ? "toMax" : "toMin", value), ["最小", "最大"]),
    )
  } else {
    for (const [axis, index] of [["X", 0], ["Y", 1]] as const) {
      rows.push(
        pairRow(`起始 ${axis}`, effect.from[index], editable, (bound, value) => update(`from${axis}${bound ? "Max" : "Min"}`, value), ["最小", "最大"]),
        pairRow(`结束 ${axis}`, effect.to[index], editable, (bound, value) => update(`to${axis}${bound ? "Max" : "Min"}`, value), ["最小", "最大"]),
      )
    }
    rows.push(valueRow("位移方式", effect.relative ? "相对位移（百分比）" : "像素位移"))
  }
  if ((effect.kind === "scale" || effect.kind === "rotate") && (effect.pivotPx || effect.pivot)) {
    rows.push(
      pairRow("中心（像素）", effect.pivotPx ?? [0, 0], editable, (index, value) => update(index ? "pivotPxY" : "pivotPxX", value), ["X", "Y"]),
      pairRow("中心（百分比）", effect.pivot ?? [0, 0], editable, (index, value) => update(index ? "pivotY" : "pivotX", value), ["X", "Y"]),
    )
  }
  if ((effect.kind === "scale" || effect.kind === "shift") && effect.interpolationXY) {
    rows.push(selectPairRow("XY 插值", INTERPOLATION_LABELS, effect.interpolationXY, editable, (index, value) => update(index ? "interpolationXYY" : "interpolationXYX", value)))
  }
  return rows
}

function mediaRows(effect: Extract<BdaAnimationEffect, { kind: "frame" | "lottie" | "video" }>, editable: boolean, update: EffectUpdate): HTMLElement[] {
  const rows = [
    textRow("资源编号", effect.resource?.resourceID ?? "", editable, (value) => update("resourceID", value)),
    numberRow("起始帧", effect.startRepeatFrame ?? 0, editable, (value) => update("startRepeatFrame", value), { min: 0 }),
  ]
  if (effect.kind === "video") {
    rows.push(textRow("占位资源", effect.placeholder?.resourceID ?? "", editable, (value) => update("placeholderID", value)))
  }
  return rows
}

function emitterRows(effect: BdaEmitterAnimation, editable: boolean, update: EffectUpdate): HTMLElement[] {
  const rows: HTMLElement[] = [
    numberRow("出生率", effect.birthRate, editable, (value) => update("birthRate", value), { min: 0, step: 0.5 }),
    numberRow("粒子总数", effect.totalNumber, editable, (value) => update("totalNumber", value), { min: 0 }),
    quadRow("发射区域", effect.emitRegion, editable, (index, value) => update(["emitRegionLeft", "emitRegionTop", "emitRegionRight", "emitRegionBottom"][index], value), ["左", "上", "右", "下"]),
    selectRow("结束时机", FINISH_LABELS, effect.finishAfterPractices, editable, (value) => update("finishAfterPractices", value)),
    numberRow("移除时保留粒子", effect.keepParticlesOnRemove, editable, (value) => update("keepParticlesOnRemove", value), { min: 0 }),
    numberRow("镜像层级", effect.mirrorUp, editable, (value) => update("mirrorUp", value), { min: 0 }),
    numberRow("发射器类型", effect.emitterType, editable, (value) => update("emitterType", value), { min: 0 }),
  ]
  for (const [key, label] of EMITTER_RANGES) {
    const values: BdaNumberRange = effect[key]
    rows.push(pairRow(label, values, editable, (index, value) => update(`${key}${index ? "Max" : "Min"}`, value), ["最小", "最大"], { step: 0.5 }))
  }
  rows.push(valueRow("粒子资源", effect.resources.length ? effect.resources.map((item) => item.resourceID).join("；") : "无"))
  rows.push(valueRow("运动路径", effect.paths.length ? `${effect.paths.length} 条（只读）` : "无"))
  return rows
}

function typeRows(effect: BdaAnimationEffect, editable: boolean, update: EffectUpdate, options: BdaAnimationEditorOptions): HTMLElement[] {
  switch (effect.kind) {
    case "group":
      return [
        numberRow("构建方式", effect.buildMode, editable, (value) => update("buildMode", value), { min: 0 }),
        valueRow("子效果", effect.items.length
          ? effect.items.map((item) => `${KIND_LABELS[item.kind]} · ${item.key}`).join("；")
          : "无"),
      ]
    case "alpha":
    case "scale":
    case "shift":
    case "rotate":
      return transformRows(effect, editable, update)
    case "frame":
    case "lottie":
    case "video":
      return mediaRows(effect, editable, update)
    case "image":
      return [
        switchRow("循环播放", effect.loopForever, editable, (value) => update("loopForever", value)),
        numberRow("起始帧", effect.startRepeatFrame, editable, (value) => update("startRepeatFrame", value), { min: 0 }),
        sequenceEditor(effect, options),
      ]
    case "emitter":
      return emitterRows(effect, editable, update)
  }
}

function effectCard(effect: BdaAnimationEffect, options: BdaAnimationEditorOptions): HTMLElement {
  const node = card(effect.key, KIND_LABELS[effect.kind])
  const update: EffectUpdate = (property, value) => options.onAnimationEffect(`${effect.kind}:${effect.key}`, property, value)
  node.append(
    valueRow("时间轴", timelineSummary(effect)),
    fieldsBox(...commonEffectRows(effect, options.editable, update)),
    fieldsBox(...typeRows(effect, options.editable, update, options)),
  )
  return node
}

/* —— 目标绑定 —— */

function bindingItem(binding: BdaAnimationBinding): HTMLElement {
  const item = element("article", "ui-list-item bda-animation-binding")
  item.append(createIcon(KIND_ICONS[binding.kind], 14))
  const text = element("span", "ui-list-item-text")
  const strong = element("strong")
  strong.textContent = `${KIND_LABELS[binding.kind]} · ${eventLabel(binding.event)}`
  const detail = element("small")
  const parts = [scopeLabel(binding.scope)]
  if (binding.condition) parts.push(`条件 ${binding.condition}`)
  if (binding.isolated) parts.push(binding.location !== undefined ? `独立 · ${LOCATION_LABELS[binding.location] ?? `位置 ${binding.location}`}` : "独立")
  if (binding.removeOnInteraction) parts.push("交互后移除")
  detail.textContent = parts.join(" · ")
  text.append(strong, detail)
  item.append(text)
  return item
}

function targetBlock(target: string, bindings: BdaAnimationBinding[]): HTMLElement {
  const block = element("div", "bda-animation-target")
  const heading = element("h4", "bda-animation-target-heading")
  const name = element("span")
  name.textContent = target
  const count = element("small")
  count.textContent = `${bindings.length} 个绑定`
  heading.append(name, count)
  block.append(heading)
  block.append(bindings.length ? fieldsBox(...bindings.map(bindingItem)) : note("没有绑定动效"))
  return block
}

function targetsSection(animation: BdaAnimation): HTMLElement {
  const node = section("目标绑定")
  node.append(body(...animation.targets.map((target) => targetBlock(target, animation.targetBindings.get(target) ?? []))))
  return node
}

/* —— 概览与入口 —— */

function overviewSection(animation: BdaAnimation, options: BdaAnimationEditorOptions): HTMLElement {
  const node = section("概览")
  const fields = fieldsBox(
    valueRow("触发目标", `${animation.targets.length} 个`),
    valueRow("效果定义", `${animation.effects.size} 个`),
    valueRow("动画序列", `${animation.sequences.size} 个`),
  )
  fields.append(animation.designWidth !== undefined
    ? numberRow("设计宽度", animation.designWidth, options.editable, options.onDesignWidth, { min: 1 })
    : valueRow("设计宽度", "未设置"))
  node.append(body(fields))
  return node
}

function effectSections(animation: BdaAnimation, options: BdaAnimationEditorOptions): HTMLElement[] {
  return KIND_ORDER.flatMap((kind) => {
    const effects = [...animation.effects.values()].filter((effect) => effect.kind === kind)
    if (!effects.length) return []
    const node = section(KIND_LABELS[kind])
    node.append(body(...effects.map((effect) => effectCard(effect, options))))
    return [node]
  })
}

export function renderBdaAnimationEditor(container: HTMLElement, options: BdaAnimationEditorOptions): void {
  const { animation } = options
  container.replaceChildren()
  container.append(overviewSection(animation, options))
  if (animation.targets.length) container.append(targetsSection(animation))
  container.append(...effectSections(animation, options))
  if (!animation.targets.length && !animation.effects.size) container.append(note("这个 animationConfig 没有动画目标或效果。"))
}
