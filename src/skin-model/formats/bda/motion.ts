// BDA 动画与音效 ↔ IR 动效、音效的双向转换。
//
// BDA 的动画配置按效果编号组织：effects 存效果参数，targetBindings 存「目标 → 绑定」，
// sequences 存帧序列。IR 把它们拆成独立的动效：帧序列、属性轨道、组合与不透明节点。
import type { BdaAnimation, BdaAnimationBinding, BdaAnimationEffect, BdaAnimationFrame, BdaAnimationSequence, BdaEmitterAnimation, BdaNumberRange, BdaResource, BdaSoundConfig, BdaTransformAnimation } from "@/bda.ts"
import type { Point } from "taffy-layout"
import type { Easing, MotionBinding, MotionEmitter, MotionNode, MotionProperty, MotionRange, MotionTimeline, MotionTrack, SkinMotions } from "@/skin-model/motion.ts"
import { motionPropertyOf } from "@/skin-model/motion.ts"
import type { SoundBinding } from "@/skin-model/sound.ts"
import type { MotionSlot } from "@/skin-model/types.ts"

/** BDA 的触发时机编号：1 按下、2 抬起、0 显示、4 隐藏、7 长按。 */
const EVENT_SLOTS: Record<number, MotionSlot> = {
  0: "show",
  1: "press",
  2: "release",
  3: "show",
  4: "hide",
  7: "hold",
}

const PROPERTIES: Record<BdaTransformAnimation["kind"], MotionProperty> = {
  alpha: "alpha",
  scale: "scale",
  shift: "translate",
  rotate: "rotate",
}

const PROPERTY_KINDS: Record<MotionProperty, BdaTransformAnimation["kind"]> = {
  alpha: "alpha",
  scale: "scale",
  translate: "shift",
  rotate: "rotate",
  rotate3d: "rotate",
}

const DEFAULT_TIMELINE: MotionTimeline = { delay: 0, duration: 0, repeat: 1, reverse: false, clear: false }

/** 旧版插值器的取值：0 线性、1 先快后慢、2 先慢后快、3 两端平滑。 */
function easingOf(interpolation: number): Easing {
  if (interpolation === 1) return { kind: "ease-out" }
  if (interpolation === 2) return { kind: "ease-in" }
  if (interpolation === 3) return { kind: "ease-in-out" }
  return { kind: "linear" }
}

function interpolationOf(easing: Easing): number {
  switch (easing.kind) {
    case "ease-out":
      return 1
    case "ease-in":
      return 2
    case "ease-in-out":
      return 3
    default:
      return 0
  }
}

function rangeOf(value: BdaNumberRange | MotionRange): MotionRange {
  return [value[0], value[1]]
}

/** IR 的只读区间换成 BDA 的可变二元组。 */
function pairOf(value: MotionRange): BdaNumberRange {
  return [value[0], value[1]]
}

/** 目标名与作用层：BDA 的 key 形如 `key.back` 或纯面板名。 */
function bindingOf(target: string, binding: BdaAnimationBinding): MotionBinding {
  const slot = EVENT_SLOTS[binding.event] ?? "press"
  return {
    target,
    slot,
    scope: binding.key.includes("fore") ? "fore" : binding.key.includes("back") ? "back" : "both",
    ...(binding.condition ? { condition: binding.condition } : {}),
    ...(binding.isolated ? { isolated: true } : {}),
  }
}

/** 单个 BDA 效果 → IR 节点；不认识的类型保留为不透明节点，参数原样带上。 */
function nodeOf(effect: BdaAnimationEffect, sequences: Map<string, BdaAnimationSequence>): MotionNode {
  const timeline = timelineOf(effect)
  if (effect.kind === "group") {
    // 组合的子项是别的效果编号；IR 用引用节点保住编号，写回时按前缀还原类型。
    return {
      kind: "group",
      method: effect.buildMode === 1 ? "sequential" : "simultaneous",
      children: effect.items.map((item) => ({ kind: "reference" as const, id: item.key })),
      timeline,
    }
  }
  if (effect.kind === "frame") {
    const sequence = effect.resource ? sequences.get(effect.resource.resourceID) : undefined
    const frames = (sequence?.frames ?? []).flatMap((frame) => (frame.resourceID
      ? [{ image: frame.resourceID, ...(frame.duration !== undefined ? { duration: frame.duration / 1000 } : {}) }]
      : []))
    return { kind: "frames", frames, timeline }
  }
  if (effect.kind === "lottie" || effect.kind === "video") {
    // 逐帧之外的媒体由外部驱动，语义没吃透，原样保留。
    return { kind: "opaque", format: `bda.${effect.kind}`, blob: effect, timeline }
  }
  if (effect.kind === "emitter") {
    return { kind: "opaque", format: "bda.emitter", blob: emitterOf(effect as BdaEmitterAnimation), timeline }
  }
  if (effect.kind === "image") {
    // 帧序列没有对应概念，但编号、播放设置与帧清单都要留住，否则写回时整条效果会消失。
    const values = new Map<string, number | string | boolean>([
      ["key", effect.key],
      ["repeatCount", effect.repeatCount],
      ["repeatMode", effect.repeatMode],
      ["removeOnFinish", effect.removeOnFinish],
      ["loopForever", effect.loopForever],
      ["startRepeatFrame", effect.startRepeatFrame],
    ])
    effect.sequence.frames.forEach((frame, index) => {
      if (frame.resourceID !== undefined) values.set(`frame.${index}.id`, frame.resourceID)
      if (frame.duration !== undefined) values.set(`frame.${index}.duration`, frame.duration)
    })
    return { kind: "opaque", format: "bda.image", blob: values, timeline }
  }
  const transform = effect as BdaTransformAnimation
  const track: MotionTrack = {
    property: PROPERTIES[transform.kind],
    from: [rangeOf(transform.from[0]), rangeOf(transform.from[1])],
    to: [rangeOf(transform.to[0]), rangeOf(transform.to[1])],
    relative: transform.relative,
    easing: easingOf(transform.interpolation),
    ...(transform.pivot ? { pivot: { x: transform.pivot[0], y: transform.pivot[1] } as Point<number> } : {}),
  }
  return {
    kind: "track",
    target: { subject: "unknown", property: motionPropertyOf(track.property) },
    keyframes: [
      { time: 0, value: track.from[0][0] },
      { time: timeline.duration, value: track.to[0][0] },
    ],
    easing: track.easing,
    ...(track.pivot ? { pivot: track.pivot } : {}),
    vector: { from: track.from, to: track.to, relative: track.relative },
    timeline,
  }
}

function emitterOf(effect: BdaEmitterAnimation): MotionEmitter {
  return {
    images: effect.resources.map((resource: BdaResource) => resource.resourceID),
    type: effect.emitterType === 1 ? "complex" : "simple",
    life: rangeOf(effect.life),
    count: effect.totalNumber,
    birthRate: effect.birthRate,
    region: {
      position: { x: effect.emitRegion[0], y: effect.emitRegion[1] },
      size: { width: effect.emitRegion[2], height: effect.emitRegion[3] },
    },
    velocity: rangeOf(effect.velocity),
    velocityDirection: rangeOf(effect.velocityDirection),
    acceleration: rangeOf(effect.acceleration),
    accelerationDirection: rangeOf(effect.accelerationDirection),
    scale: rangeOf(effect.scale),
    scaleSpeed: rangeOf(effect.scaleSpeed),
    rotation: rangeOf(effect.rotation),
    rotationSpeed: rangeOf(effect.spin),
    alpha: rangeOf(effect.alpha),
    alphaSpeed: rangeOf(effect.alphaSpeed),
    finish: effect.finishAfterPractices === 1 ? "gone" : "emitted",
    removeWithParticles: effect.keepParticlesOnRemove === 1,
    mirror: effect.mirrorUp,
    ...(effect.paths.length
      ? { path: effect.paths.flatMap((path) => path.elements.flatMap((element) => (element.point3 ? [{ x: element.point3[0], y: element.point3[1] }] : []))) }
      : {}),
  }
}

function timelineOf(effect: BdaAnimationEffect): MotionTimeline {
  if (effect.kind === "group") {
    return { delay: effect.delay / 1000, duration: 0, repeat: effect.repeatCount, reverse: effect.repeatMode === 2, clear: effect.removeOnFinish }
  }
  if (effect.kind === "frame" || effect.kind === "lottie" || effect.kind === "video") {
    return { delay: 0, duration: 0, repeat: effect.repeatCount, reverse: false, clear: effect.removeOnFinish }
  }
  if (effect.kind === "emitter") {
    return { delay: 0, duration: effect.duration / 1000, repeat: effect.repeatCount, reverse: effect.repeatMode === 2, clear: effect.removeOnFinish }
  }
  if (effect.kind === "image") {
    return { delay: 0, duration: 0, repeat: 0, reverse: false, clear: false }
  }
  const transform = effect as BdaTransformAnimation
  return {
    delay: transform.delay / 1000,
    duration: transform.duration / 1000,
    repeat: transform.repeatCount,
    reverse: transform.repeatMode === 2,
    clear: transform.removeOnFinish,
  }
}

/** BDA 动画配置 → IR 动效表：每个效果一个动效，绑定按目标聚合。 */
export function motionsOfAnimation(animation: BdaAnimation): SkinMotions {
  const motions = new Map<string, MotionNode>()
  for (const [key, effect] of animation.effects) {
    const bindings: MotionBinding[] = []
    // 效果的键带 `<类型>:` 前缀，绑定的键是裸名，比较前要还原，否则绑定全部丢掉。
    const bare = bareKeyOf(key, effect.kind)
    for (const [target, entries] of animation.targetBindings) {
      for (const entry of entries) {
        if (entry.key !== bare && entry.key !== key) continue
        bindings.push(bindingOf(target, entry))
      }
    }
    motions.set(key, { ...nodeOf(effect, animation.sequences), bindings })
  }
  return motions
}

/** IR 动效 → BDA 效果；只处理能表达的类型，其它类型由调用方报告损失。 */
function effectOf(motion: MotionNode, id: string): BdaAnimationEffect | undefined {
  const timeline = motion.timeline ?? DEFAULT_TIMELINE
  if (motion.kind === "opaque" && motion.format === "bda.image") {
    const values = motion.blob as ReadonlyMap<string, number | string | boolean>
    // 图片序列：编号、播放设置与帧清单照原样写回，避免整条效果被丢掉。
    const key = values.get("key")
    const number = (name: string): number => {
      const value = values.get(name)
      return typeof value === "number" ? value : 0
    }
    const frames: BdaAnimationFrame[] = []
    for (let index = 0; ; index += 1) {
      const resourceID = values.get(`frame.${index}.id`)
      if (resourceID === undefined) break
      const duration = values.get(`frame.${index}.duration`)
      frames.push({
        resourceID: String(resourceID),
        ...(typeof duration === "number" ? { duration } : {}),
      })
    }
    return {
      kind: "image",
      key: typeof key === "string" ? key : id,
      repeatCount: number("repeatCount"),
      repeatMode: number("repeatMode"),
      removeOnFinish: values.get("removeOnFinish") === true,
      loopForever: values.get("loopForever") === true,
      startRepeatFrame: number("startRepeatFrame"),
      sequence: { name: typeof key === "string" ? key : id, frames },
    }
  }
  if (motion.kind === "opaque" && (motion.format === "bda.lottie" || motion.format === "bda.video")) {
    return motion.blob as BdaAnimationEffect
  }
  if (motion.kind === "frames") {
    return {
      kind: "frame",
      key: id,
      repeatCount: timeline.repeat,
      repeatMode: timeline.reverse ? 2 : 0,
      removeOnFinish: timeline.clear,
      loopForever: false,
      startRepeatFrame: 0,
      resource: { type: 0, resourceID: id },
      placeholder: { type: 0, resourceID: "" },
    } as BdaAnimationEffect
  }
  if (motion.kind === "opaque" && motion.format === "bda.emitter") {
    const emitter = motion.blob as MotionEmitter
    return {
      kind: "emitter",
      key: id,
      repeatCount: timeline.repeat,
      repeatMode: timeline.reverse ? 2 : 0,
      removeOnFinish: timeline.clear,
      duration: Math.round(timeline.duration * 1000),
      birthRate: emitter.birthRate,
      totalNumber: emitter.count,
      emitRegion: [emitter.region.position.x, emitter.region.position.y, emitter.region.size.width, emitter.region.size.height],
      resources: emitter.images.map((image) => ({ type: 0, resourceID: image })),
      life: pairOf(emitter.life),
      rotation: pairOf(emitter.rotation),
      spin: pairOf(emitter.rotationSpeed),
      scale: pairOf(emitter.scale),
      scaleSpeed: pairOf(emitter.scaleSpeed),
      alpha: pairOf(emitter.alpha),
      alphaSpeed: pairOf(emitter.alphaSpeed),
      velocity: pairOf(emitter.velocity),
      velocityDirection: pairOf(emitter.velocityDirection),
      acceleration: pairOf(emitter.acceleration),
      accelerationDirection: pairOf(emitter.accelerationDirection),
      finishAfterPractices: emitter.finish === "gone" ? 1 : 0,
      keepParticlesOnRemove: emitter.removeWithParticles ? 1 : 0,
      mirrorUp: emitter.mirror,
      paths: [],
      emitterType: emitter.type === "complex" ? 1 : 0,
    }
  }
  if (motion.kind === "group") {
    // 引用节点还原成组合的子项；类型跟在前缀里，不是引用节点就写不出来。
    const items = motion.children.flatMap((child) => {
      if (child.kind !== "reference") return []
      const prefix = child.id.includes(":") ? child.id.slice(0, child.id.indexOf(":")) : ""
      const key = prefix ? child.id.slice(prefix.length + 1) : child.id
      const types = ["group", "alpha", "scale", "shift", "rotate", "frame", "image", "emitter", "lottie", "video"] as const
      const resolved = types.find((type) => type === prefix) ?? "alpha"
      return [{ kind: resolved, key }]
    })
    return {
      kind: "group",
      key: id,
      buildMode: motion.method === "sequential" ? 1 : 0,
      repeatCount: timeline.repeat,
      repeatMode: timeline.reverse ? 2 : 0,
      removeOnFinish: timeline.clear,
      delay: Math.round(timeline.delay * 1000),
      items,
    }
  }
  if (motion.kind !== "track") return
  const vector = motion.vector
  const from = vector?.from ?? [[motion.keyframes[0]?.value ?? 0, motion.keyframes[0]?.value ?? 0], [0, 0]] as const
  const to = vector?.to ?? [[motion.keyframes[motion.keyframes.length - 1]?.value ?? 0, motion.keyframes[motion.keyframes.length - 1]?.value ?? 0], [0, 0]] as const
  const property: MotionProperty = motion.target.property === "alpha" ? "alpha"
    : motion.target.property === "scale" ? "scale"
      : motion.target.property === "rotation" ? "rotate"
        : "translate"
  const kind = PROPERTY_KINDS[property]
  return {
    kind,
    key: id,
    repeatCount: timeline.repeat,
    repeatMode: timeline.reverse ? 2 : 0,
    delay: Math.round(timeline.delay * 1000),
    removeOnFinish: timeline.clear,
    duration: Math.round(timeline.duration * 1000),
    interpolation: interpolationOf(motion.easing ?? { kind: "linear" }),
    ...(motion.pivot ? { pivot: [motion.pivot.x, motion.pivot.y] as [number, number] } : {}),
    from: [pairOf(from[0]), pairOf(from[1])],
    to: [pairOf(to[0]), pairOf(to[1])],
    relative: vector?.relative ?? false,
  }
}

function eventOf(slot: MotionSlot): number {
  switch (slot) {
    case "press":
      return 1
    case "release":
      return 2
    case "hide":
      return 4
    case "hold":
      return 7
    default:
      return 0
  }
}

/** 效果裸键：解码给键拼过 `<类型>:`，写回时剥掉，保证往返后 id 不变。 */
function bareKeyOf(id: string, kind: string): string {
  const prefix = `${kind}:`
  return id.startsWith(prefix) ? id.slice(prefix.length) : id
}

export function animationOfMotions(motions: SkinMotions, designWidth?: number): { animation: BdaAnimation; warnings: string[] } {
  const effects = new Map<string, BdaAnimationEffect>()
  const targetBindings = new Map<string, BdaAnimationBinding[]>()
  const warnings: string[] = []
  for (const [id, motion] of motions) {
    const effect = effectOf(motion, id)
    if (!effect) {
      warnings.push(`${id}：动效类型 ${motion.kind} 无法写成 BDA 效果`)
      continue
    }
    // 解码时效果键会被拼成 `<类型>:<裸键>`；写回要还原成裸键，否则每往返一次多一层前缀。
    const key = bareKeyOf(id, effect.kind)
    const written = { ...effect, key } as BdaAnimationEffect
    effects.set(key, written)
    for (const binding of motion.bindings ?? []) {
      const entries = targetBindings.get(binding.target) ?? []
      entries.push({
        kind: written.kind,
        key,
        scope: 0,
        event: eventOf(binding.slot),
        isolated: binding.isolated === true,
        ...(binding.condition ? { condition: binding.condition } : {}),
      })
      targetBindings.set(binding.target, entries)
    }
  }
  return {
    animation: {
      ...(designWidth !== undefined ? { designWidth } : {}),
      targets: [...targetBindings.keys()],
      sequences: new Map(),
      bindings: new Map(),
      targetBindings,
      effects,
    },
    warnings,
  }
}

/** BDA 音效配置 → IR 音效表：双表分别标平台，主体是按键动作名。 */
export function soundsOfConfig(config: BdaSoundConfig): SoundBinding[] {
  const sounds: SoundBinding[] = []
  for (const [subject, resource] of config.keySounds) {
    sounds.push({ subject, sound: resource.resourceID, platform: "android" })
  }
  for (const [subject, resource] of config.iosKeySounds) {
    sounds.push({ subject, sound: resource.resourceID, platform: "ios" })
  }
  return sounds
}

/** IR 音效表 → BDA 音效配置；平台决定进哪张表。 */
export function soundConfigOf(sounds: readonly SoundBinding[], type = 0): BdaSoundConfig {
  const keySounds = new Map<string, BdaResource>()
  const iosKeySounds = new Map<string, BdaResource>()
  for (const sound of sounds) {
    const resource = { type, resourceID: sound.sound }
    if (sound.platform === "ios") iosKeySounds.set(sound.subject, resource)
    else keySounds.set(sound.subject, resource)
  }
  return { keySounds, iosKeySounds }
}
