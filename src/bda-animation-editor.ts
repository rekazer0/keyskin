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
  comboList, renderAnimationResource,
  type AnimationKeyFilter, type AnimationListItem, type AnimationMode,
} from "./animation-inspector.ts"
import { field, section } from "./app/property-rows.ts"
import { BDA_EVENT_LABELS } from "./bda-motion.ts"
import { styleCard } from "./style-card.ts"
import { animationPlayer } from "./animation-player.ts"

/** Which effects the inspector lists, and the remembered selection (kept by the caller). */
export type BdaAnimationView = {
  mode: AnimationMode
  source?: object
  select(items: readonly AnimationListItem[]): string | undefined
  /** Narrows the list to the effects the key picked on the canvas plays. */
  filter(items: AnimationListItem[]): { items: AnimationListItem[]; keyFilter?: AnimationKeyFilter }
  onSelect(id: string): void
  /** BDA 没有样式上的动效指针，绑定动效的是目标：第二个列表按目标筛选，选中状态由调用方记住。 */
  targets?: { selected?: string; onSelect(id: string | undefined): void }
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
/** `range` puts a slider beside the number for values with a natural range (property-rows.ts). */
type NumberOptions = { step?: number; min?: number; unit?: string; range?: "duration" | "count" | "rate" }

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
const BUILD_MODE_LABELS = ["同时", "接续"]
const INTERPOLATION_LABELS = ["线性", "缓入", "缓出", "缓入缓出", "回弹"]
const FINISH_LABELS = ["发射完", "粒子消失"]

type EmitterRangeKey =
  | "life" | "rotation" | "spin" | "scale" | "scaleSpeed" | "alpha" | "alphaSpeed"
  | "velocity" | "velocityDirection" | "acceleration" | "accelerationDirection"

const EMITTER_GROUPS: ReadonlyArray<readonly [string, ReadonlyArray<readonly [EmitterRangeKey, string, string?]>]> = [
  ["运动", [["life", "生命周期", "ms"], ["velocity", "初速度"], ["velocityDirection", "速度方向", "°"], ["acceleration", "加速度"], ["accelerationDirection", "加速度方向", "°"]]],
  ["外观", [["rotation", "初始角度", "°"], ["spin", "自旋速度"], ["scale", "初始缩放"], ["scaleSpeed", "缩放速度"], ["alpha", "初始透明度"], ["alphaSpeed", "透明度速度"]]],
]

/* —— 属性行（property-rows.ts field()） —— */

function note(text: string): HTMLElement {
  const node = element("p", "ui-field-note")
  node.textContent = text
  return node
}

const finite = (text: string) => text !== "" && Number.isFinite(Number(text))

function valueRow(label: string, value: string): HTMLElement {
  return field({ key: label, label, spec: { kind: "readonly", value } })
}

function numberRow(label: string, value: number, editable: boolean, onChange: (value: number) => void, options: NumberOptions = {}): HTMLElement {
  return field({ key: label, label, editable, spec: { kind: "number", value: String(value), ...options },
    commit: (text) => { if (finite(text)) onChange(Number(text)) } })
}

function pairRow(label: string, values: readonly number[], editable: boolean, onChange: (index: number, value: number) => void,
  affixes: readonly string[] = ["最小", "最大"], options: { step?: number; unit?: string } = {}): HTMLElement {
  return field({ key: label, label, editable, spec: { kind: "parts", affixes, values: values.map(String), columns: affixes.length, ...options },
    commit: (next, { index = 0 }) => { if (finite(next[index])) onChange(index, Number(next[index])) } })
}

function choiceRow(label: string, labels: readonly string[], value: number, editable: boolean, onChange: (value: number) => void): HTMLElement {
  return field({ key: label, label, editable, spec: { kind: "choice", value: String(value), options: labels.map((text, index) => [String(index), text]) },
    commit: (next) => onChange(Number(next)) })
}

function switchRow(label: string, value: boolean, editable: boolean, onChange: (value: boolean) => void): HTMLElement {
  return field({ key: label, label, editable, spec: { kind: "switch", checked: value }, commit: onChange })
}

function textRow(label: string, value: string, editable: boolean, onChange: (value: string) => void): HTMLElement {
  return field({ key: label, label, editable, spec: { kind: "text", value }, commit: onChange })
}

/* —— 帧序列 —— */

function resourceCard(label: string, resourceID: string | undefined, options: BdaAnimationEditorOptions, edit?: { onChange(value: string): void; pick(): void }): HTMLElement {
  return field({
    key: label, label, editable: options.editable,
    spec: { kind: "image", value: resourceID ?? "", load: () => resourceID ? options.resolver?.resolveResource?.(resourceID) : undefined, pick: edit?.pick },
    commit: edit && ((value: string) => edit.onChange(value)),
  })
}

function frameCard(sequence: BdaAnimationSequence, frame: BdaAnimationFrame, index: number, options: BdaAnimationEditorOptions): HTMLElement {
  const node = element("article", "bda-animation-frame-card")
  node.append(resourceCard(`第 ${index + 1} 帧`, frame.resourceID, options, {
    onChange: (value) => options.onAnimationFrame(sequence.name, index, "resourceID", value),
    pick: () => options.onPickAnimationResource(sequence.name, index),
  }))
  if (frame.duration !== undefined) {
    node.append(numberRow("时长", frame.duration, options.editable, (value) => options.onAnimationFrame(sequence.name, index, "duration", value), { min: 0, unit: "ms" }))
  }
  return node
}


function frameSequence(effect: Extract<BdaAnimationEffect, { kind: "image" }>, options: BdaAnimationEditorOptions): HTMLElement {
  const strip = element("div", "bda-animation-frames")
  strip.append(...effect.sequence.frames.map((frame, index) => frameCard(effect.sequence, frame, index, options)))
  if (!effect.sequence.frames.length) strip.append(note("没有帧"))
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

/** How many targets trigger the effect, directly or through a group holding it. */
function bindingCount(animation: BdaAnimation, effect: BdaAnimationEffect): number {
  const id = effectID(effect)
  const groups = [...animation.effects.values()].filter((candidate) => candidate.kind === "group" && candidate.items.some((item) => `${item.kind}:${item.key}` === id))
  let count = groups.length
  for (const bindings of animation.targetBindings.values()) {
    count += bindings.filter((binding) => `${binding.kind}:${binding.key}` === id || groups.some((group) => effectID(group) === `${binding.kind}:${binding.key}`)).length
  }
  return count
}

/* —— 参数分组 —— */

function timingSection(effect: BdaAnimationEffect, editable: boolean, update: EffectUpdate): HTMLElement {
  const rows: HTMLElement[] = []
  if (effect.kind === "alpha" || effect.kind === "scale" || effect.kind === "shift" || effect.kind === "rotate") {
    rows.push(
      numberRow("时长", effect.duration, editable, (value) => update("duration", value), { min: 0, unit: "ms", range: "duration" }),
      numberRow("延迟", effect.delay, editable, (value) => update("delay", value), { min: 0, unit: "ms", range: "duration" }),
      choiceRow("插值方式", INTERPOLATION_LABELS, effect.interpolation, editable, (value) => update("interpolation", value)),
    )
    if ((effect.kind === "scale" || effect.kind === "shift") && effect.interpolationXY) {
      rows.push(field({ key: "XY 插值", label: "XY 插值", editable,
        spec: { kind: "parts", affixes: ["X", "Y"], values: effect.interpolationXY.map(String), options: INTERPOLATION_LABELS.map((text, index) => [String(index), text]) },
        commit: (next, { index = 0 }) => update(index ? "interpolationXYY" : "interpolationXYX", Number(next[index])) }))
    }
  } else if (effect.kind === "group") {
    rows.push(numberRow("延迟", effect.delay, editable, (value) => update("delay", value), { min: 0, unit: "ms" }))
  } else if (effect.kind === "emitter") {
    rows.push(numberRow("时长", effect.duration, editable, (value) => update("duration", value), { min: 0, step: 0.5, unit: "s" }))
  }
  rows.push(numberRow("重复次数", effect.repeatCount, editable, (value) => update("repeatCount", value), { min: 0 }))
  if ("repeatMode" in effect) rows.push(switchRow("往返", effect.repeatMode === 1, editable, (value) => update("repeatMode", value ? 1 : 0)))
  if (effect.kind === "emitter") {
    rows.push(
      choiceRow("结束时机", FINISH_LABELS, effect.finishAfterPractices, editable, (value) => update("finishAfterPractices", value)),
      numberRow("移除时保留粒子", effect.keepParticlesOnRemove, editable, (value) => update("keepParticlesOnRemove", value), { min: 0 }),
      numberRow("镜像层级", effect.mirrorUp, editable, (value) => update("mirrorUp", value), { min: 0 }),
    )
  }
  rows.push(switchRow("结束后移除", effect.removeOnFinish, editable, (value) => update("removeOnFinish", value)))
  return section("时间与循环", rows, { className: SECTION })
}

function transformSections(effect: BdaTransformAnimation, editable: boolean, update: EffectUpdate): HTMLElement[] {
  const unit = effect.kind === "alpha" ? undefined : effect.kind === "rotate" ? "°" : effect.kind === "scale" || effect.relative ? "%" : "px"
  const rows: HTMLElement[] = []
  if (effect.kind === "alpha" || effect.kind === "rotate") {
    rows.push(
      pairRow("起始值", effect.from[0], editable, (index, value) => update(index ? "fromMax" : "fromMin", value), undefined, { unit }),
      pairRow("结束值", effect.to[0], editable, (index, value) => update(index ? "toMax" : "toMin", value), undefined, { unit }),
    )
  } else {
    for (const [axis, index] of [["X", 0], ["Y", 1]] as const) {
      rows.push(
        pairRow(`起始 ${axis}`, effect.from[index], editable, (bound, value) => update(`from${axis}${bound ? "Max" : "Min"}`, value), undefined, { unit }),
        pairRow(`结束 ${axis}`, effect.to[index], editable, (bound, value) => update(`to${axis}${bound ? "Max" : "Min"}`, value), undefined, { unit }),
      )
    }
    if (effect.kind === "shift") rows.push(valueRow("位移方式", effect.relative ? "相对按键（百分比）" : "像素"))
  }
  rows.push(note("每个值是随机范围，最小与最大相同即固定值"))
  const sections = [section("变化", rows, { className: SECTION }), timingSection(effect, editable, update)]
  if ((effect.kind === "scale" || effect.kind === "rotate") && (effect.pivotPx || effect.pivot)) {
    sections.push(section("变换中心", [
      pairRow("像素", effect.pivotPx ?? [0, 0], editable, (index, value) => update(index ? "pivotPxY" : "pivotPxX", value), ["X", "Y"], { unit: "px" }),
      pairRow("比例", effect.pivot ?? [0, 0], editable, (index, value) => update(index ? "pivotY" : "pivotX", value), ["X", "Y"], { unit: "%" }),
    ], { className: SECTION }))
  }
  return sections
}

function emitterSections(effect: BdaEmitterAnimation, options: BdaAnimationEditorOptions, update: EffectUpdate): HTMLElement[] {
  const editable = options.editable
  const emit = section("发射", [
    numberRow("发射速率", effect.birthRate, editable, (value) => update("birthRate", value), { min: 0, step: 0.5, unit: "个/s", range: "rate" }),
    numberRow("粒子总数", effect.totalNumber, editable, (value) => update("totalNumber", value), { min: 0, range: "count" }),
    pairRow("发射区域", effect.emitRegion, editable, (index, value) => update(["emitRegionLeft", "emitRegionTop", "emitRegionRight", "emitRegionBottom"][index], value), ["←", "↑", "→", "↓"], { step: 0.5 }),
    numberRow("发射器类型", effect.emitterType, editable, (value) => update("emitterType", value), { min: 0 }),
    // 粒子资源只能查看：BDA 只定点写回已有字段，不增删资源。
    ...effect.resources.length
      ? effect.resources.map((item, index) => resourceCard(effect.resources.length > 1 ? `粒子资源 ${index + 1}` : "粒子资源", item.resourceID, options))
      : [valueRow("粒子资源", "无")],
    valueRow("运动路径", effect.paths.length ? `${effect.paths.length} 条（只读）` : "无"),
  ], { className: SECTION })
  const groups = EMITTER_GROUPS.map(([title, ranges]) => section(title, ranges.map(([key, label, unit]) => {
    const values: BdaNumberRange = effect[key]
    return pairRow(label, values, editable, (index, value) => update(`${key}${index ? "Max" : "Min"}`, value), ["最小", "最大"], { step: 0.5, unit })
  }), { className: SECTION }))
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
      const group = section("组合", [], { className: SECTION, count: String(effect.items.length) })
      group.append(
        choiceRow("组合方式", BUILD_MODE_LABELS, effect.buildMode, editable, (value) => update("buildMode", value)),
        comboList({
          editable,
          empty: "没有子效果",
          children: effect.items.map((item) => {
            const child = animation.effects.get(`${item.kind}:${item.key}`)
            return child
              ? { title: `${item.key} · ${KIND_LABELS[item.kind]}`, detail: timingText(child) }
              : { title: `${item.key} · ${KIND_LABELS[item.kind]}`, detail: "animationConfig 里没有这个效果", missing: true }
          }),
        }),
        note("子效果暂不支持增删或排序"),
      )
      return [group, timingSection(effect, editable, update)]
    }
    case "image": {
      const sequence = section("帧序列", [], { className: SECTION, count: String(effect.sequence.frames.length) })
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
      const resource = section("资源", [], { className: SECTION })
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

/** 每个绑定了动效的目标：触发时机与它播放的效果（组合连同子效果）。 */
function animationTargets(animation: BdaAnimation): Array<{ id: string; events: string[]; effects: string[] }> {
  return [...animation.targetBindings].flatMap(([target, bindings]) => {
    const effects = new Set<string>()
    for (const binding of bindings) {
      const id = `${binding.kind}:${binding.key}`
      effects.add(id)
      const effect = animation.effects.get(id)
      if (effect?.kind === "group") for (const item of effect.items) effects.add(`${item.kind}:${item.key}`)
    }
    if (!bindings.length) return []
    const events = [...new Set(bindings.map((binding) => BDA_EVENT_LABELS[binding.event] ?? `事件 ${binding.event}`))]
    return [{ id: target, events, effects: [...effects] }]
  })
}

/* —— 入口 —— */

export function renderBdaAnimationEditor(container: HTMLElement, options: BdaAnimationEditorOptions): void {
  const { animation, view } = options
  const effects = KIND_ORDER.flatMap((kind) => [...animation.effects.values()].filter((effect) => effect.kind === kind))
    .filter((effect) => view.mode === "all" || (effect.kind === "emitter") === (view.mode === "particle"))
  const { items: keyItems, keyFilter } = view.filter(effects.map((effect): AnimationListItem => ({
    id: effectID(effect),
    title: effect.key,
    kind: KIND_LABELS[effect.kind],
    icon: KIND_ICONS[effect.kind],
    detail: timingText(effect),
    uses: bindingCount(animation, effect),
    problem: problem(effect, animation),
  })))
  // 目标列表只列绑定了当前入口效果的目标；点一个就把效果列表筛成它播放的那些。
  const targets = animationTargets(animation)
  const targetItems = targets.flatMap((target) => {
    const included = target.effects.filter((id) => keyItems.some((item) => item.id === id))
    return included.length ? [{ id: target.id, title: target.id, detail: target.events.join(" · "), count: included.length }] : []
  })
  const targetEffects = new Map(targets.map((target) => [target.id, new Set(target.effects)]))
  const target = targetItems.find((item) => item.id === view.targets?.selected)
  // 选中目标时只列它播放的效果，并给出可清除的说明；调用方记住的旧目标不再有绑定时当作没筛。
  const items = target ? keyItems.filter((item) => targetEffects.get(target.id)?.has(item.id)) : keyItems
  const styleFilter = target && { label: target.title, clear: () => view.targets!.onSelect(undefined) }
  const selected = view.select(items)
  const effect = effects.find((candidate) => effectID(candidate) === selected)
  const sections = effect ? effectSections(effect, animation, options) : []
  if (effect) keyRows(sections, effectID(effect))
  const width = animation.designWidth !== undefined
    ? numberRow("设计宽度", animation.designWidth, options.editable, options.onDesignWidth, { min: 1 })
    : valueRow("设计宽度", "未设置")
  width.dataset.inspectorRowKey = JSON.stringify(["bda-animation", "designWidth"])
  renderAnimationResource(container, {
    listSource: view.source,
    mode: view.mode,
    sectionClass: SECTION,
    items,
    selected,
    keyFilter,
    styles: view.targets && { noun: "目标", icon: "crosshair", items: targetItems, selected: view.targets.selected, onSelect: view.targets.onSelect,
      card: item => styleCard({ id: item.id, label: item.title, kind: "anim", kindLabel: "目标", kindIcon: "crosshair", summary: item.detail,
        animation: () => [...targetEffects.get(item.id) ?? []].map(id => animationPlayer({
          clip: bdaPreviewClip(animation, id), key: `${options.path}|${id}`, resolver: options.resolver, resourceParticles: true, thumbnail: true,
        })),
      }),
    },
    thumbnail: id => ({ clip: bdaPreviewClip(animation, id), key: `${options.path}|${id}`, resolver: options.resolver, resourceParticles: true }),
    styleFilter,
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
  })
}
