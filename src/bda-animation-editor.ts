/*
 * BDA animationConfig 的动画检查器（DESIGN.md §10「动画资源」）：资源配置的「动效设计」列出变换、组合、帧、
 * Lottie 与视频效果，「粒子设计」列出粒子发射器。列表选中一个效果，下面是播放器、参数分组和触发它的目标绑定。
 * 每个字段经 onAnimationEffect / onAnimationFrame 定点写回 protobuf（bda-encode.ts），一次编辑一步撤销。
 */
import { type VisualResolver } from "./atlas.ts"
import type {
  BdaAnimation,
  BdaAnimationEffect,
  BdaAnimationFrame,
  BdaAnimationKind,
  BdaAnimationSequence,
  BdaEmitterAnimation,
  BdaNumberRange,
  BdaTransformAnimation,
} from "./bda.ts"
import { element } from "./dom-element.ts"
import { bdaPreviewClip } from "./animation-preview-model.ts"
import type { KeyboardPlayback } from "./animation-player.ts"
import {
  animationSection, comboList, imageCard, renderAnimationResource, sliderField,
  type AnimationKeyFilter, type AnimationListItem, type AnimationMode, type AnimationUse,
} from "./animation-inspector.ts"

/** Which effects the inspector lists, and the remembered selection (kept by the caller). */
export type BdaAnimationView = {
  mode: AnimationMode
  select(items: readonly AnimationListItem[]): string | undefined
  /** Narrows the list to the effects the key picked on the canvas plays. */
  filter(items: AnimationListItem[]): { items: AnimationListItem[]; keyFilter?: AnimationKeyFilter }
  /** The keys on the canvas that play the effect, ahead of its bindings in 引用. */
  keyUses(id: string): AnimationUse[]
  onSelect(id: string): void
}

type BdaAnimationEditorOptions = {
  animation: BdaAnimation
  path: string
  view: BdaAnimationView
  resolver?: VisualResolver
  editable: boolean
  onDesignWidth: (value: number) => void
  onAnimationFrame: (sequence: string, frame: number, property: "resourceID" | "duration", value: string | number) => void
  onAnimationEffect: (key: string, property: string, value: string | number | boolean) => void
  onPickAnimationResource: (sequence: string, frame: number) => void
  /** The player's keyboard for an effect: plays it on a keyboard key bound to it. */
  keyboardPlayback?: (effectID: string) => KeyboardPlayback
}

type EffectValue = string | number | boolean
type EffectUpdate = (property: string, value: EffectValue) => void
/** `slider` puts a slider beside the number for values with a natural range. */
type FieldOption = { step?: number; min?: number; slider?: { min: number; max: number; step?: number } }

const SECTION = "bda-inspector-section"

const KIND_LABELS: Record<BdaAnimationKind, string> = {
  group: "组合",
  alpha: "透明度",
  scale: "缩放",
  shift: "位移",
  rotate: "旋转",
  frame: "GIF 帧动画",
  image: "图片序列",
  emitter: "粒子",
  lottie: "Lottie",
  video: "视频",
}

const KIND_ICONS: Record<BdaAnimationKind, string> = {
  group: "layers",
  alpha: "blend",
  scale: "scaling",
  shift: "move",
  rotate: "rotate-cw",
  frame: "list-video",
  image: "list-video",
  emitter: "sparkles",
  lottie: "clapperboard",
  video: "clapperboard",
}

const KIND_ORDER: readonly BdaAnimationKind[] = [
  "group", "alpha", "scale", "shift", "rotate", "frame", "image", "emitter", "lottie", "video",
]

// EventType / AnimationScopeType / IntpolType，字段号见 APK animation.proto。
const EVENT_LABELS = ["键盘将显示", "按键按下", "按键抬起", "元素显示", "元素隐藏", "空闲进入", "空闲退出", "按键长按", "插入文字", "皮肤切换"]
const SCOPE_LABELS = ["前景", "背景", "前景与背景"]
const LOCATION_LABELS = ["顶部", "底部"]
const REPEAT_MODE_LABELS = ["正向", "往返"]
const BUILD_MODE_LABELS = ["同时", "接续"]
const INTERPOLATION_LABELS = ["线性", "缓入", "缓出", "缓入缓出", "回弹"]
const FINISH_LABELS = ["发射完所有粒子", "粒子全部消失"]

type EmitterRangeKey =
  | "life" | "rotation" | "spin" | "scale" | "scaleSpeed" | "alpha" | "alphaSpeed"
  | "velocity" | "velocityDirection" | "acceleration" | "accelerationDirection"

const EMITTER_GROUPS: ReadonlyArray<readonly [string, ReadonlyArray<readonly [EmitterRangeKey, string]>]> = [
  ["运动", [["life", "生命周期（ms）"], ["velocity", "初速度"], ["velocityDirection", "速度方向（°）"], ["acceleration", "加速度"], ["accelerationDirection", "加速度方向（°）"]]],
  ["外观", [["rotation", "初始角度（°）"], ["spin", "自旋速度"], ["scale", "开局缩放"], ["scaleSpeed", "缩放速度"], ["alpha", "开局透明度"], ["alphaSpeed", "透明度速度"]]],
]

/* —— 属性行 —— */

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

function numberInput(label: string, value: number, editable: boolean, onChange: (value: number) => void, options: FieldOption = {}): HTMLInputElement {
  const input = element("input")
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
  const wrapper = element("span", "ui-input")
  const input = numberInput(label, value, editable, onChange, options)
  wrapper.append(input)
  return row(label, options.slider ? sliderField(wrapper, input, options.slider) : wrapper)
}

function affixedNumber(label: string, affix: string, value: number, editable: boolean, onChange: (value: number) => void, options: FieldOption = {}): HTMLElement {
  const wrapper = element("span", "ui-input")
  const prefix = element("span", "ui-input-affix")
  prefix.textContent = affix
  wrapper.append(prefix, numberInput(label, value, editable, onChange, options))
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
  const wrapper = element("span", "ui-input ui-select")
  const select = element("select")
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

function textRow(label: string, value: string, editable: boolean, onChange: (value: string) => void): HTMLElement {
  const wrapper = element("span", "ui-input")
  const input = element("input")
  input.type = "text"
  input.value = value
  input.disabled = !editable
  input.setAttribute("aria-label", label)
  input.addEventListener("change", () => onChange(input.value))
  wrapper.append(input)
  return row(label, wrapper)
}

/* —— 帧序列 —— */

function resourceCard(label: string, resourceID: string | undefined, options: BdaAnimationEditorOptions, edit?: { onChange(value: string): void; pick(): void }): HTMLElement {
  const node = element("div", "ui-field bda-animation-field style-reference-field")
  const caption = element("span")
  caption.textContent = label
  node.append(caption, imageCard({
    label,
    value: resourceID ?? "",
    editable: options.editable && Boolean(edit),
    placeholder: "未设置资源",
    load: () => resourceID ? options.resolver?.resolveResource?.(resourceID) : undefined,
    onChange: (value) => edit?.onChange(value),
    pick: edit?.pick,
  }))
  return node
}

function frameCard(sequence: BdaAnimationSequence, frame: BdaAnimationFrame, index: number, options: BdaAnimationEditorOptions): HTMLElement {
  const node = element("article", "bda-animation-frame-card")
  node.append(resourceCard(`第 ${index + 1} 帧`, frame.resourceID, options, {
    onChange: (value) => options.onAnimationFrame(sequence.name, index, "resourceID", value),
    pick: () => options.onPickAnimationResource(sequence.name, index),
  }))
  if (frame.duration !== undefined) {
    node.append(numberRow("时长（毫秒）", frame.duration, options.editable, (value) => options.onAnimationFrame(sequence.name, index, "duration", value), { min: 0 }))
  }
  return node
}


function frameSequence(effect: Extract<BdaAnimationEffect, { kind: "image" }>, options: BdaAnimationEditorOptions): HTMLElement {
  const strip = element("div", "bda-animation-frames")
  strip.append(...effect.sequence.frames.map((frame, index) => frameCard(effect.sequence, frame, index, options)))
  if (!effect.sequence.frames.length) strip.append(note("这个序列还没有帧。"))
  return strip
}

/* —— 摘要与引用 —— */

function effectID(effect: BdaAnimationEffect): string {
  return `${effect.kind}:${effect.key}`
}

function timingText(effect: BdaAnimationEffect): string {
  const repeat = effect.repeatCount > 1 ? `× ${effect.repeatCount}` : ""
  const reverse = "repeatMode" in effect && effect.repeatMode === 1 ? "往返" : ""
  switch (effect.kind) {
    case "group":
      return [`${BUILD_MODE_LABELS[effect.buildMode] ?? `方式 ${effect.buildMode}`}`, `${effect.items.length} 个子效果`, repeat].filter(Boolean).join(" · ")
    case "alpha":
    case "scale":
    case "shift":
    case "rotate":
      return [effect.delay ? `延迟 ${effect.delay}` : "", `${effect.duration} ms ${repeat}`.trim(), reverse].filter(Boolean).join(" · ")
    case "emitter":
      return [`${effect.totalNumber} 个粒子`, `${effect.duration} s ${repeat}`.trim(), reverse].filter(Boolean).join(" · ")
    case "image":
      return [`${effect.sequence.frames.length} 帧`, effect.loopForever ? "循环" : repeat, reverse].filter(Boolean).join(" · ")
    case "frame":
    case "lottie":
    case "video":
      return [effect.resource?.resourceID ?? "未设置资源", repeat].filter(Boolean).join(" · ")
  }
}

function problem(effect: BdaAnimationEffect, animation: BdaAnimation): string | undefined {
  if (effect.kind === "group" && effect.items.some((item) => !animation.effects.has(`${item.kind}:${item.key}`))) return "组合里有找不到的子效果"
  if (effect.kind === "image" && !effect.sequence.frames.length) return "图片序列还没有帧"
  if (effect.kind === "emitter" && !effect.resources.length) return "粒子还没有资源"
}

/** Targets that trigger the effect, directly or through a group holding it. */
function effectUses(animation: BdaAnimation, effect: BdaAnimationEffect): AnimationUse[] {
  const id = effectID(effect)
  const groups = [...animation.effects.values()].filter((candidate) => candidate.kind === "group" && candidate.items.some((item) => `${item.kind}:${item.key}` === id))
  const uses: AnimationUse[] = []
  for (const [target, bindings] of animation.targetBindings) {
    for (const binding of bindings) {
      const bound = `${binding.kind}:${binding.key}`
      const via = groups.find((group) => effectID(group) === bound)
      if (bound !== id && !via) continue
      const parts = [SCOPE_LABELS[binding.scope] ?? `范围 ${binding.scope}`]
      if (via) parts.unshift(`经组合 ${via.key}`)
      if (binding.condition) parts.push(`条件 ${binding.condition}`)
      if (binding.isolated) parts.push(binding.location !== undefined ? `独立 · ${LOCATION_LABELS[binding.location] ?? `位置 ${binding.location}`}` : "独立")
      if (binding.removeOnInteraction) parts.push("交互后移除")
      uses.push({ icon: "key-round", title: `${target} · ${EVENT_LABELS[binding.event] ?? `事件 ${binding.event}`}`, detail: parts.join(" · ") })
    }
  }
  for (const group of groups) uses.push({ icon: "layers", title: `组合 ${group.key}`, detail: "作为组合的子效果播放" })
  return uses
}

/* —— 参数分组 —— */

function timingSection(effect: BdaAnimationEffect, editable: boolean, update: EffectUpdate): HTMLElement {
  const section = animationSection("时间与循环", SECTION)
  if (effect.kind === "alpha" || effect.kind === "scale" || effect.kind === "shift" || effect.kind === "rotate") {
    section.append(
      numberRow("时长（毫秒）", effect.duration, editable, (value) => update("duration", value), { min: 0, slider: { min: 0, max: 2000, step: 10 } }),
      numberRow("延迟（毫秒）", effect.delay, editable, (value) => update("delay", value), { min: 0, slider: { min: 0, max: 2000, step: 10 } }),
      selectRow("插值方式", INTERPOLATION_LABELS, effect.interpolation, editable, (value) => update("interpolation", value)),
    )
    if ((effect.kind === "scale" || effect.kind === "shift") && effect.interpolationXY) {
      section.append(selectPairRow("XY 插值", INTERPOLATION_LABELS, effect.interpolationXY, editable, (index, value) => update(index ? "interpolationXYY" : "interpolationXYX", value)))
    }
  } else if (effect.kind === "group") {
    section.append(numberRow("延迟（毫秒）", effect.delay, editable, (value) => update("delay", value), { min: 0 }))
  } else if (effect.kind === "emitter") {
    section.append(numberRow("时长（秒）", effect.duration, editable, (value) => update("duration", value), { min: 0, step: 0.5 }))
  }
  section.append(numberRow("重复次数", effect.repeatCount, editable, (value) => update("repeatCount", value), { min: 0 }))
  if ("repeatMode" in effect) section.append(selectRow("重复模式", REPEAT_MODE_LABELS, effect.repeatMode, editable, (value) => update("repeatMode", value)))
  if (effect.kind === "emitter") {
    section.append(
      selectRow("结束时机", FINISH_LABELS, effect.finishAfterPractices, editable, (value) => update("finishAfterPractices", value)),
      numberRow("移除时保留粒子", effect.keepParticlesOnRemove, editable, (value) => update("keepParticlesOnRemove", value), { min: 0 }),
      numberRow("镜像层级", effect.mirrorUp, editable, (value) => update("mirrorUp", value), { min: 0 }),
    )
  }
  section.append(switchRow("结束后移除", effect.removeOnFinish, editable, (value) => update("removeOnFinish", value)))
  return section
}

function transformSections(effect: BdaTransformAnimation, editable: boolean, update: EffectUpdate): HTMLElement[] {
  const change = animationSection("变化", SECTION)
  const unit = effect.kind === "alpha" ? "（0–255）" : effect.kind === "rotate" ? "（°）" : effect.kind === "scale" || effect.relative ? "（%）" : "（px）"
  if (effect.kind === "alpha" || effect.kind === "rotate") {
    change.append(
      pairRow(`起始值${unit}`, effect.from[0], editable, (index, value) => update(index ? "fromMax" : "fromMin", value)),
      pairRow(`结束值${unit}`, effect.to[0], editable, (index, value) => update(index ? "toMax" : "toMin", value)),
    )
  } else {
    for (const [axis, index] of [["X", 0], ["Y", 1]] as const) {
      change.append(
        pairRow(`起始 ${axis}${unit}`, effect.from[index], editable, (bound, value) => update(`from${axis}${bound ? "Max" : "Min"}`, value)),
        pairRow(`结束 ${axis}${unit}`, effect.to[index], editable, (bound, value) => update(`to${axis}${bound ? "Max" : "Min"}`, value)),
      )
    }
    if (effect.kind === "shift") change.append(valueRow("位移方式", effect.relative ? "相对按键（百分比）" : "像素"))
  }
  change.append(note("每个值是一个随机范围：最小与最大相同时就是固定值，预览取中点。"))
  const sections = [change, timingSection(effect, editable, update)]
  if ((effect.kind === "scale" || effect.kind === "rotate") && (effect.pivotPx || effect.pivot)) {
    const pivot = animationSection("变换中心", SECTION)
    pivot.append(
      pairRow("中心（像素）", effect.pivotPx ?? [0, 0], editable, (index, value) => update(index ? "pivotPxY" : "pivotPxX", value), ["X", "Y"]),
      pairRow("中心（%）", effect.pivot ?? [0, 0], editable, (index, value) => update(index ? "pivotY" : "pivotX", value), ["X", "Y"]),
    )
    sections.push(pivot)
  }
  return sections
}

function emitterSections(effect: BdaEmitterAnimation, options: BdaAnimationEditorOptions, update: EffectUpdate): HTMLElement[] {
  const editable = options.editable
  const emit = animationSection("发射", SECTION)
  emit.append(
    numberRow("出生率（个/秒）", effect.birthRate, editable, (value) => update("birthRate", value), { min: 0, step: 0.5, slider: { min: 0, max: 50, step: 0.5 } }),
    numberRow("粒子总数", effect.totalNumber, editable, (value) => update("totalNumber", value), { min: 0, slider: { min: 0, max: 200 } }),
    quadRow("发射区域", effect.emitRegion, editable, (index, value) => update(["emitRegionLeft", "emitRegionTop", "emitRegionRight", "emitRegionBottom"][index], value), ["左", "上", "右", "下"]),
    numberRow("发射器类型", effect.emitterType, editable, (value) => update("emitterType", value), { min: 0 }),
    // 粒子资源只能查看：BDA 只定点写回已有字段，不增删资源。
    ...effect.resources.length
      ? effect.resources.map((item, index) => resourceCard(effect.resources.length > 1 ? `粒子资源 ${index + 1}` : "粒子资源", item.resourceID, options))
      : [valueRow("粒子资源", "无")],
    valueRow("运动路径", effect.paths.length ? `${effect.paths.length} 条（只读）` : "无"),
  )
  const groups = EMITTER_GROUPS.map(([title, ranges]) => {
    const section = animationSection(title, SECTION)
    for (const [key, label] of ranges) {
      const values: BdaNumberRange = effect[key]
      section.append(pairRow(label, values, editable, (index, value) => update(`${key}${index ? "Max" : "Min"}`, value), ["最小", "最大"], { step: 0.5 }))
    }
    return section
  })
  return [emit, ...groups, timingSection(effect, editable, update)]
}

function effectSections(effect: BdaAnimationEffect, animation: BdaAnimation, options: BdaAnimationEditorOptions): HTMLElement[] {
  const editable = options.editable
  const update: EffectUpdate = (property, value) => options.onAnimationEffect(effectID(effect), property, value)
  switch (effect.kind) {
    case "alpha":
    case "scale":
    case "shift":
    case "rotate":
      return transformSections(effect, editable, update)
    case "emitter":
      return emitterSections(effect, options, update)
    case "group": {
      const group = animationSection("组合", SECTION)
      group.append(
        selectRow("组合方式", BUILD_MODE_LABELS, effect.buildMode, editable, (value) => update("buildMode", value)),
        comboList({
          editable,
          empty: "组合里没有子效果。",
          children: effect.items.map((item) => {
            const child = animation.effects.get(`${item.kind}:${item.key}`)
            return child
              ? { title: `${item.key} · ${KIND_LABELS[item.kind]}`, detail: timingText(child) }
              : { title: `${item.key} · ${KIND_LABELS[item.kind]}`, detail: "animationConfig 里没有这个效果", missing: true }
          }),
        }),
        note("BDA 组合的子效果暂不支持在检查器中增删或排序。"),
      )
      return [group, timingSection(effect, editable, update)]
    }
    case "image": {
      const sequence = animationSection("帧序列", SECTION, `${effect.sequence.frames.length} 帧`)
      sequence.append(
        switchRow("循环播放", effect.loopForever, editable, (value) => update("loopForever", value)),
        numberRow("起始帧", effect.startRepeatFrame, editable, (value) => update("startRepeatFrame", value), { min: 0 }),
        frameSequence(effect, options),
      )
      return [sequence, timingSection(effect, editable, update)]
    }
    case "frame":
    case "lottie":
    case "video": {
      const resource = animationSection("资源", SECTION)
      resource.append(
        textRow("资源编号", effect.resource?.resourceID ?? "", editable, (value) => update("resourceID", value)),
        numberRow("起始帧", effect.startRepeatFrame ?? 0, editable, (value) => update("startRepeatFrame", value), { min: 0 }),
      )
      if (effect.kind === "video") resource.append(textRow("占位资源", effect.placeholder?.resourceID ?? "", editable, (value) => update("placeholderID", value)))
      return [resource, timingSection(effect, editable, update)]
    }
  }
}

/** Rows are rebuilt after every edit; a stable key per effect and label keeps their change marks. */
function keyRows(sections: readonly HTMLElement[], id: string): void {
  const seen = new Map<string, number>()
  for (const field of sections.flatMap((section) => Array.from(section.querySelectorAll<HTMLElement>(".ui-field")))) {
    const label = field.firstElementChild?.textContent ?? ""
    const count = seen.get(label) ?? 0
    seen.set(label, count + 1)
    field.dataset.inspectorRowKey = JSON.stringify(["bda-animation", id, label, count])
  }
}

/* —— 入口 —— */

export function renderBdaAnimationEditor(container: HTMLElement, options: BdaAnimationEditorOptions): void {
  const { animation, view } = options
  const effects = KIND_ORDER.flatMap((kind) => [...animation.effects.values()].filter((effect) => effect.kind === kind))
    .filter((effect) => view.mode === "all" || (effect.kind === "emitter") === (view.mode === "particle"))
  const { items, keyFilter } = view.filter(effects.map((effect): AnimationListItem => ({
    id: effectID(effect),
    title: effect.key,
    kind: KIND_LABELS[effect.kind],
    icon: KIND_ICONS[effect.kind],
    detail: timingText(effect),
    uses: effectUses(animation, effect).length,
    problem: problem(effect, animation),
  })))
  const selected = view.select(items)
  const effect = effects.find((candidate) => effectID(candidate) === selected)
  const sections = effect ? effectSections(effect, animation, options) : []
  if (effect) keyRows(sections, effectID(effect))
  const width = animation.designWidth !== undefined
    ? numberRow("设计宽度", animation.designWidth, options.editable, options.onDesignWidth, { min: 1 })
    : valueRow("设计宽度", "未设置")
  width.dataset.inspectorRowKey = JSON.stringify(["bda-animation", "designWidth"])
  renderAnimationResource(container, {
    mode: view.mode,
    sectionClass: SECTION,
    items,
    selected,
    keyFilter,
    editable: options.editable,
    onSelect: view.onSelect,
    listRows: [width],
    player: effect && {
      clip: bdaPreviewClip(animation, effectID(effect)),
      key: `${options.path}|${effectID(effect)}`,
      resolver: options.resolver,
      resourceParticles: true,
      keyboard: options.keyboardPlayback?.(effectID(effect)),
    },
    sections,
    uses: effect ? [...view.keyUses(effectID(effect)), ...effectUses(animation, effect)] : [],
  })
}
