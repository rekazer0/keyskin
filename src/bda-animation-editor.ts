import type { BdaAnimation, BdaAnimationEffect, BdaEmitterAnimation } from "./bda.ts"
import { type VisualResolver } from "./atlas.ts"
import { element } from "./dom-element.ts"
import { animationPlayer } from "./animation-player.ts"
import { bdaPreviewClip } from "./animation-preview-model.ts"

export type BdaAnimationEditorOptions = {
  animation: BdaAnimation
  resolver?: VisualResolver
  editable: boolean
  designMode?: "all" | "motion" | "particle"
  onDesignWidth: (value: number) => void
  onAnimationFrame: (sequence: string, frame: number, property: "resourceID" | "duration", value: string | number) => void
  onAnimationEffect: (key: string, property: string, value: string | number | boolean) => void
  onPickAnimationResource: (sequence: string, frame: number) => void
}

type Value = string | number | boolean
const kindLabels = { group: "组合", alpha: "透明度", scale: "缩放", shift: "位移", rotate: "旋转", frame: "资源帧", image: "序列帧", emitter: "粒子", lottie: "Lottie", video: "视频" }
const repeatModes = ["重新开始", "往返播放"]
const curves = ["匀速", "加速", "减速", "加速后减速", "弹跳"]

function section(label: string, detail?: string): HTMLElement {
  const node = element("section", "ui-section bda-inspector-section bda-animation-section")
  node.dataset.inspectorGroupLabel = label
  const heading = element("h3", "document-section-heading")
  const title = element("span", "document-section-title")
  title.textContent = label
  heading.append(title)
  if (detail) {
    const code = element("span", "document-section-code")
    code.textContent = detail
    heading.append(code)
  }
  node.append(heading)
  return node
}

function note(text: string): HTMLElement {
  const node = element("p", "bda-editor-summary")
  node.textContent = text
  return node
}

function subsection(parent: HTMLElement, title: string): HTMLElement {
  const block = element("div", "ui-subsection")
  const heading = element("h4")
  heading.textContent = title
  block.append(heading)
  parent.append(block)
  return block
}

function row(label: string, key: string, value: Value | readonly number[], change: (value: Value | number[]) => void): HTMLElement {
  const node = element("label", "ui-field document-property-field")
  node.dataset.inspectorRowKey = `bda-animation:${key}`
  node.dataset.documentKey = key
  node.dataset.inspectorValue = JSON.stringify(value)
  const caption = element("span", "document-field-caption")
  caption.textContent = label
  caption.title = key
  node.append(caption)
  node.addEventListener("inspector-reset", (event) => {
    event.preventDefault()
    change(JSON.parse((event as CustomEvent<string>).detail))
  })
  return node
}

function numberInput(label: string, value: number, editable: boolean, change: (value: number) => void, float = false): HTMLInputElement {
  const input = element("input")
  input.type = "number"
  input.step = float ? "any" : "1"
  if (!float) { input.min = "0"; input.max = "4294967295" }
  input.value = String(value)
  input.disabled = !editable
  input.setAttribute("aria-label", label)
  input.addEventListener("change", () => {
    if (input.value.trim() && input.validity.valid && Number.isFinite(Number(input.value))) change(Number(input.value))
    else input.value = String(value)
  })
  return input
}

function numberField(label: string, key: string, value: number, editable: boolean, change: (value: number) => void, unit = "", float = false): HTMLElement {
  const node = row(label, key, value, (next) => change(Number(next)))
  const box = element("span", "ui-input")
  box.append(numberInput(label, value, editable, change, float))
  if (unit) {
    const suffix = element("span", "ui-input-affix")
    suffix.textContent = unit
    box.append(suffix)
  }
  node.append(box)
  return node
}

function textField(label: string, key: string, value: string, editable: boolean, change: (value: string) => void): HTMLElement {
  const node = row(label, key, value, (next) => change(String(next)))
  const box = element("span", "ui-input")
  const input = element("input")
  input.value = value
  input.disabled = !editable
  input.setAttribute("aria-label", label)
  input.addEventListener("change", () => change(input.value))
  box.append(input)
  node.append(box)
  return node
}

function switchField(label: string, key: string, value: boolean, editable: boolean, change: (value: boolean) => void): HTMLElement {
  const node = row(label, key, value, (next) => change(Boolean(next)))
  const input = element("input", "ui-switch")
  input.type = "checkbox"
  input.role = "switch"
  input.checked = value
  input.disabled = !editable
  input.setAttribute("aria-label", label)
  input.addEventListener("change", () => change(input.checked))
  node.append(input)
  return node
}

function selectField(label: string, key: string, value: number, names: string[], editable: boolean, change: (value: number) => void): HTMLElement {
  const node = row(label, key, value, (next) => change(Number(next)))
  const box = element("span", "ui-input ui-select")
  const select = element("select")
  names.forEach((name, index) => select.append(new Option(name, String(index))))
  if (!names[value]) select.append(new Option(`${value}（当前值）`, String(value)))
  select.value = String(value)
  select.disabled = !editable
  select.setAttribute("aria-label", label)
  select.addEventListener("change", () => change(Number(select.value)))
  box.append(select)
  node.append(box)
  return node
}

function rangeField(label: string, key: string, values: readonly [number, number], editable: boolean, change: (index: 0 | 1, value: number) => void, float = false): HTMLElement {
  const node = row(label, key, values, (next) => {
    const values = next as number[]
    change(0, values[0])
    change(1, values[1])
  })
  const pair = element("span", "ui-field-pair")
  for (const index of [0, 1] as const) {
    const box = element("span", "ui-input")
    const affix = element("span", "ui-input-affix")
    affix.textContent = index ? "大" : "小"
    affix.title = index ? "最大值" : "最小值"
    box.append(affix, numberInput(`${label}${index ? "最大" : "最小"}`, values[index], editable, (value) => change(index, value), float))
    pair.append(box)
  }
  node.append(pair)
  return node
}


function emitterFields(node: HTMLElement, effect: BdaEmitterAnimation, options: BdaAnimationEditorOptions): void {
  const id = `emitter:${effect.key}`
  const update = (property: string, value: number) => options.onAnimationEffect(id, property, value)
  const emission = subsection(node, "粒子发射")
  for (const [property, label] of [["birthRate", "发射速率"], ["totalNumber", "粒子总数"]] as const) {
    emission.append(numberField(label, `${id}.${property}`, effect[property], options.editable, (value) => update(property, value)))
  }
  emission.append(note(`粒子资源：${effect.resources.map((resource) => resource.resourceID).join("、") || "未配置"}`))
  for (const [index, label, property] of [[0, "发射区域左", "emitLeft"], [1, "发射区域上", "emitTop"], [2, "发射区域右", "emitRight"], [3, "发射区域下", "emitBottom"]] as const) {
    emission.append(numberField(label, `${id}.${property}`, effect.emitRegion[index], options.editable, (value) => update(property, value), "", true))
  }
  emission.append(rangeField("寿命", `${id}.life`, effect.life, options.editable, (index, value) => update(`life${index ? "Max" : "Min"}`, value), true))
  const movement = subsection(node, "粒子运动")
  const appearance = subsection(node, "粒子外观")
  for (const [property, label] of [["rotation", "初始旋转"], ["spin", "旋转速度"], ["scale", "初始缩放"], ["scaleSpeed", "缩放速度"], ["alpha", "初始透明度"], ["alphaSpeed", "透明度速度"], ["velocity", "初速度"], ["velocityDirection", "速度方向"], ["acceleration", "加速度"], ["accelerationDirection", "加速度方向"]] as const) {
    const group = /velocity|acceleration/.test(property) ? movement : appearance
    group.append(rangeField(label, `${id}.${property}`, effect[property], options.editable, (index, value) => update(`${property}${index ? "Max" : "Min"}`, value), true))
  }
}

function effectEditor(effect: BdaAnimationEffect, options: BdaAnimationEditorOptions): HTMLElement {
  const id = `${effect.kind}:${effect.key}`
  const node = section(effect.key, kindLabels[effect.kind])
  node.dataset.animationEffect = id
  const update = (property: string, value: Value) => options.onAnimationEffect(id, property, value)
  const num = (label: string, property: string, value: number, unit = "", float = false) => numberField(label, `${id}.${property}`, value, options.editable, (next) => update(property, next), unit, float)
  const select = (label: string, property: string, value: number, names: string[]) => selectField(label, `${id}.${property}`, value, names, options.editable, (next) => update(property, next))
  const toggle = (label: string, property: string, value: boolean) => switchField(label, `${id}.${property}`, value, options.editable, (next) => update(property, next))
  const references = [...options.animation.targetBindings].flatMap(([target, bindings]) => bindings.filter((binding) => `${binding.kind}:${binding.key}` === id).map((binding) => `${target} · 事件 ${binding.event}${binding.isolated ? " · 独立" : ""}`))
  node.append(note(references.length ? `触发：${references.join("；")}` : "未直接绑定目标（可由组合动画引用）"))
  node.append(animationPlayer({ clip: bdaPreviewClip(options.animation, effect), resolver: options.resolver, resourceParticles: true }))
  const timing = subsection(node, "时间与循环")
  timing.append(num("重复次数", "repeatCount", effect.repeatCount))
  if ("repeatMode" in effect) timing.append(select("重复方式", "repeatMode", effect.repeatMode, repeatModes))
  if ("delay" in effect) timing.append(num("延迟时间", "delay", effect.delay, "ms"))
  if ("duration" in effect) timing.append(num("持续时间", "duration", effect.duration, effect.kind === "emitter" ? "s" : "ms", effect.kind === "emitter"))
  timing.append(toggle("结束后移除", "removeOnFinish", effect.removeOnFinish))
  if (effect.kind === "alpha" || effect.kind === "scale" || effect.kind === "shift" || effect.kind === "rotate") {
    const range = subsection(node, "变化范围与曲线")
    range.append(select("插值方式", "interpolation", effect.interpolation, curves))
    const scalar = effect.kind === "alpha" || effect.kind === "rotate"
    const unit = effect.kind === "shift" ? effect.relative ? "比例" : "px" : effect.kind === "scale" ? "%" : effect.kind === "rotate" ? "°" : "0–255"
    for (const [property, label] of [["from", "起始"], ["to", "结束"]] as const) {
      for (const [axis, index] of (scalar ? [["", 0]] : [["X", 0], ["Y", 1]]) as Array<[string, 0 | 1]>) {
        const name = `${property}${axis}`
        range.append(rangeField(`${label}${axis}（${unit}）`, `${id}.${name}`, effect[property][index], options.editable, (bound, value) => update(`${name}${bound ? "Max" : "Min"}`, value)))
      }
    }
  } else if (effect.kind === "group") {
    node.append(select("组合方式", "buildMode", effect.buildMode, ["同时播放", "顺序播放"]))
    for (const item of effect.items) node.append(note(`子效果：${kindLabels[item.kind]} · ${item.key}`))
  } else if (effect.kind === "image") {
    node.append(toggle("持续循环", "loopForever", effect.loopForever), num("起始重复帧", "startRepeatFrame", effect.startRepeatFrame))
    effect.sequence.frames.forEach((frame, index) => {
      const prefix = `${id}.frames.${index}`
      node.append(textField(`第 ${index + 1} 帧图片`, `${prefix}.resourceID`, frame.resourceID ?? "", options.editable, (value) => options.onAnimationFrame(effect.key, index, "resourceID", value)))
      node.append(numberField(`第 ${index + 1} 帧时长`, `${prefix}.duration`, frame.duration ?? 100, options.editable, (value) => options.onAnimationFrame(effect.key, index, "duration", value), "ms"))
      const pick = element("button", "ui-button")
      pick.type = "button"
      pick.textContent = `选择第 ${index + 1} 帧图片`
      pick.disabled = !options.editable
      pick.addEventListener("click", () => options.onPickAnimationResource(effect.key, index))
      node.append(pick)
    })
  } else if (effect.kind === "emitter") emitterFields(node, effect, options)
  else if (effect.kind === "frame" || effect.kind === "lottie" || effect.kind === "video") {
    node.append(textField("图片 / 媒体资源", `${id}.resourceID`, effect.resource?.resourceID ?? "", options.editable, (value) => update("resourceID", value)))
    if (effect.startRepeatFrame !== undefined) node.append(num("起始重复帧", "startRepeatFrame", effect.startRepeatFrame))
    if (effect.placeholder) node.append(note(`占位资源：${effect.placeholder.resourceID}`))
    if (effect.kind !== "frame") node.append(note("保留原始媒体资源；此处不模拟该格式的播放。"))
  }
  return node
}

export function renderBdaAnimationEditor(container: HTMLElement, options: BdaAnimationEditorOptions): void {
  container.replaceChildren()
  const { animation } = options
  const effects = [...animation.effects.values()].filter((effect) => !options.designMode || options.designMode === "all"
    || (effect.kind === "emitter") === (options.designMode === "particle"))
  const summary = section(options.designMode === "particle" ? "粒子设计" : "动效设计", `${effects.length} 个效果`)
  summary.append(numberField("设计宽度", "designWidth", animation.designWidth ?? 1080, options.editable, options.onDesignWidth, "px"))
  if (!effects.length) summary.append(note("当前分类没有动画效果。原始字段会在保存时保留。"))
  container.append(summary)
  for (const effect of effects) container.append(effectEditor(effect, options))
  if (animation.targets.length) {
    const targets = section("触发目标")
    for (const target of animation.targets) {
      targets.append(note(`${target} → ${(animation.targetBindings.get(target) ?? []).map((binding) => `${kindLabels[binding.kind]} ${binding.key}（事件 ${binding.event}）`).join("、") || "未绑定"}`))
    }
    container.append(targets)
  }
}
