// BDA 动画与音效 ↔ IR 动效、音效的双向转换。
//
// BDA 的动画配置按效果编号组织：effects 存效果参数，targetBindings 存「目标 → 绑定」，
// sequences 存帧序列。IR 把它们拆成独立的动效，每个动效一棵节点树加一份时间轴。
import type { BdaAnimation, BdaAnimationBinding, BdaAnimationEffect, BdaAnimationFrame, BdaAnimationSequence, BdaEmitterAnimation, BdaNumberRange, BdaResource, BdaSoundConfig, BdaTransformAnimation } from "@/bda.ts"
import type { Point } from "taffy-layout"
import type { Easing, MotionBinding, MotionEmitter, MotionFrame, MotionNode, MotionProperty, MotionRange, MotionTimeline, MotionTrack, SkinMotion, SkinMotions } from "@/skin-model/motion.ts"
import type { SkinSound, SkinSounds } from "@/skin-model/sound.ts"
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

/** 单个 BDA 效果 → IR 节点；不认识的类型保留为自定义节点，参数原样带上。 */
function nodeOf(effect: BdaAnimationEffect, sequences: Map<string, BdaAnimationSequence>): MotionNode {
  void sequences
  if (effect.kind === "group") {
    // 组合的子项是别的效果编号；IR 里用引用节点保住编号与类型，写回时按它还原。
    return {
      kind: "sequence",
      method: effect.buildMode === 1 ? "sequential" : "parallel",
      children: effect.items.map((item) => ({
        kind: "custom" as const,
        family: "bda.ref",
        values: new Map<string, number | string | boolean>([["id", item.key], ["kind", item.kind]]),
      })),
      delay: effect.delay / 1000,
      duration: 0,
    }
  }
  if (effect.kind === "frame" || effect.kind === "lottie" || effect.kind === "video") {
    const sequence = effect.resource ? sequences.get(effect.resource.resourceID) : undefined
    const frames: MotionFrame[] = (sequence?.frames ?? []).flatMap((frame) => (frame.resourceID ? [{ file: frame.resourceID, ...(frame.duration !== undefined ? { duration: frame.duration / 1000 } : {}) }] : []))
    // 三种效果在 IR 里都是帧序列，媒体类型要留住，否则写回会一律变成普通帧图。
    return { kind: "frames", frames, loop: effect.repeatCount, delay: 0, duration: 0, media: effect.kind }
  }
  if (effect.kind === "emitter") {
    const emitter = effect as BdaEmitterAnimation
    return {
      kind: "particles",
      emitter: emitterOf(emitter),
      delay: 0,
      duration: emitter.duration / 1000,
    }
  }
  if (effect.kind === "image") {
    // 帧序列没有对应概念，但编号、播放设置与帧清单都要留住，否则写回时整条效果会消失或变成空动画。
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
    return { kind: "custom", family: "bda.image", values }
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
  return { kind: "track", track, delay: transform.delay / 1000, duration: transform.duration / 1000 }
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
  const motions = new Map<string, SkinMotion>()
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
    motions.set(key, {
      id: key,
      root: nodeOf(effect, animation.sequences),
      timeline: timelineOf(effect),
      bindings,
    })
  }
  return motions
}

/** IR 动效 → BDA 效果；只处理能表达的类型，其它类型由调用方报告损失。 */
function effectOf(motion: SkinMotion): BdaAnimationEffect | undefined {
  const { root, timeline } = motion
  if (root.kind === "custom" && root.family === "bda.image") {
    // 图片序列：编号、播放设置与帧清单照原样写回，避免整条效果被丢掉。
    const key = root.values.get("key")
    const number = (name: string): number => {
      const value = root.values.get(name)
      return typeof value === "number" ? value : 0
    }
    const frames: BdaAnimationFrame[] = []
    for (let index = 0; ; index += 1) {
      const resourceID = root.values.get(`frame.${index}.id`)
      if (resourceID === undefined) break
      const duration = root.values.get(`frame.${index}.duration`)
      frames.push({
        resourceID: String(resourceID),
        ...(typeof duration === "number" ? { duration } : {}),
      })
    }
    return {
      kind: "image",
      key: typeof key === "string" ? key : motion.id,
      repeatCount: number("repeatCount"),
      repeatMode: number("repeatMode"),
      removeOnFinish: root.values.get("removeOnFinish") === true,
      loopForever: root.values.get("loopForever") === true,
      startRepeatFrame: number("startRepeatFrame"),
      sequence: { name: typeof key === "string" ? key : motion.id, frames },
    }
  }
  if (root.kind === "frames") {
    // 媒体类型由读取时记下；没有记录时按普通帧图处理，与旧行为一致。
    const media = root.media ?? "frame"
    return {
      kind: media,
      key: motion.id,
      repeatCount: timeline.repeat,
      repeatMode: timeline.reverse ? 2 : 0,
      removeOnFinish: timeline.clear,
      loopForever: false,
      startRepeatFrame: 0,
      resource: { type: 0, resourceID: motion.id },
      placeholder: { type: 0, resourceID: "" },
    } as BdaAnimationEffect
  }
  if (root.kind === "particles") {
    const emitter = root.emitter
    return {
      kind: "emitter",
      key: motion.id,
      repeatCount: timeline.repeat,
      repeatMode: timeline.reverse ? 2 : 0,
      removeOnFinish: timeline.clear,
      duration: Math.round(timeline.duration * 1000),
      birthRate: emitter.birthRate,
      totalNumber: emitter.count,
      emitRegion: [emitter.region.position.x, emitter.region.position.y, emitter.region.size.width, emitter.region.size.height],
      resources: emitter.images.map((id) => ({ type: 0, resourceID: id })),
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
  if (root.kind === "sequence") {
    // 引用节点还原成组合的子项；类型跟着节点一起回来，不是引用节点就写不出来。
    const items = root.children.flatMap((child) => {
      if (child.kind !== "custom" || child.family !== "bda.ref") return []
      const key = child.values.get("id")
      const kind = child.values.get("kind")
      if (typeof key !== "string") return []
      const types = ["group", "alpha", "scale", "shift", "rotate", "frame", "image", "emitter", "lottie", "video"] as const
      const resolved = types.find((type) => type === kind) ?? "alpha"
      return [{ kind: resolved, key }]
    })
    return {
      kind: "group",
      key: motion.id,
      buildMode: root.method === "sequential" ? 1 : 0,
      repeatCount: timeline.repeat,
      repeatMode: timeline.reverse ? 2 : 0,
      removeOnFinish: timeline.clear,
      delay: Math.round(timeline.delay * 1000),
      items,
    }
  }
  if (root.kind !== "track") return
  const kind = PROPERTY_KINDS[root.track.property]
  return {
    kind,
    key: motion.id,
    repeatCount: timeline.repeat,
    repeatMode: timeline.reverse ? 2 : 0,
    delay: Math.round(timeline.delay * 1000),
    removeOnFinish: timeline.clear,
    duration: Math.round(timeline.duration * 1000),
    interpolation: interpolationOf(root.track.easing),
    ...(root.track.pivot ? { pivot: [root.track.pivot.x, root.track.pivot.y] as [number, number] } : {}),
    from: [pairOf(root.track.from[0]), pairOf(root.track.from[1])],
    to: [pairOf(root.track.to[0]), pairOf(root.track.to[1])],
    relative: root.track.relative,
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

/** IR 动效表 → BDA 动画配置；无法表达的类型进 warnings。 */
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
    const effect = effectOf(motion)
    if (!effect) {
      warnings.push(`${id}：动效类型 ${motion.root.kind} 无法写成 BDA 效果`)
      continue
    }
    // 解码时效果键会被拼成 `<类型>:<裸键>`；写回要还原成裸键，否则每往返一次多一层前缀。
    const key = bareKeyOf(id, effect.kind)
    const written = { ...effect, key } as BdaAnimationEffect
    effects.set(key, written)
    for (const binding of motion.bindings) {
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

/** BDA 音效配置 → IR 音效表；键名是按键动作名，槽位按动作归类。 */
export function soundsOfConfig(config: BdaSoundConfig): SkinSounds {
  const sounds = new Map<string, SkinSound>()
  const slotOf = (key: string): SkinSound["slot"] => {
    const name = key.toUpperCase()
    if (name.includes("BACKSPACE") || name.includes("DELETE")) return "backspace"
    if (name.includes("ENTER")) return "enter"
    if (name.includes("SPACE")) return "space"
    return "key"
  }
  for (const [key, resource] of config.keySounds) {
    sounds.set(key, { slot: slotOf(key), resource: resource.resourceID })
  }
  for (const [key, resource] of config.iosKeySounds) {
    if (sounds.has(key)) continue
    sounds.set(key, { slot: slotOf(key), resource: resource.resourceID })
  }
  return sounds
}

/** IR 音效表 → BDA 音效配置。 */
export function soundConfigOf(sounds: SkinSounds, type = 0): BdaSoundConfig {
  const keySounds = new Map<string, BdaResource>()
  for (const [key, sound] of sounds) {
    keySounds.set(key, { type, resourceID: sound.resource })
  }
  return { keySounds, iosKeySounds: new Map() }
}
