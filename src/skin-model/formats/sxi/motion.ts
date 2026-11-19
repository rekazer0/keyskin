// 手心皮肤的动画 ↔ IR 动效。
//
// `skin.json` 的 `ss_2` 按编号存动画包装对象，每个包装对象里是 `a1`（属性变化）、`af2`（帧序列）、
// `a4`（粒子）、`a3`（组合）等家族之一；`ss_1` 的 `s_5` 把动画绑到样式的按下、显示等时机。
import type { Json, JsonObject } from "@/palm/sxi-ini.ts"
import { asObject } from "@/palm/sxi-ini.ts"
import { a1IsScale, a1Variant, animationModel } from "@/palm/sxi-animation.ts"
import type { Point } from "taffy-layout"
import type { Easing, MotionBinding, MotionEmitter, MotionNode, MotionProperty, MotionRange, MotionTimeline, MotionTrack, MotionVector, SkinMotions } from "@/skin-model/motion.ts"
import { keyframesOf, motionPropertyOf } from "@/skin-model/motion.ts"
import type { SoundBinding } from "@/skin-model/sound.ts"
import type { MotionSlot } from "@/skin-model/types.ts"

/** 手心的时机编号：1 按下、2 抬起、3 显示、4 隐藏。 */
const SLOT_OF: Record<string, MotionSlot> = { "1": "press", "2": "release", "3": "show", "4": "hide" }
const EVENT_OF: Record<MotionSlot, string> = { press: "1", release: "2", show: "3", hide: "4", hold: "3" }

const DEFAULT_TIMELINE: MotionTimeline = { delay: 0, duration: 0, repeat: 1, reverse: false, clear: false }

/** 手心插值器编号：0 线性、1 先快后慢、2 先慢后快、3 两端平滑。 */
function easingOf(style: Json): Easing {
  const value = Number(style ?? 0)
  if (value === 1) return { kind: "ease-out" }
  if (value === 2) return { kind: "ease-in" }
  if (value === 3) return { kind: "ease-in-out" }
  return { kind: "linear" }
}

function interpolationOf(easing: Easing): number {
  switch (easing.kind) {
    case "ease-out": return 1
    case "ease-in": return 2
    case "ease-in-out": return 3
    default: return 0
  }
}

function rangeOf(value: Json, fallback: MotionRange = [0, 0]): MotionRange {
  if (!Array.isArray(value) || value.length < 2) return fallback
  const min = Number(value[0])
  const max = Number(value[1])
  return Number.isFinite(min) && Number.isFinite(max) ? [min, max] : fallback
}

function pointOf(value: Json): Point<number> | undefined {
  if (!Array.isArray(value) || value.length < 2) return
  const x = Number(value[0])
  const y = Number(value[1])
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined
}

function number(value: Json, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function timelineOf(model: JsonObject, duration: number): MotionTimeline {
  return {
    delay: number(model.delay) / 1000,
    duration: duration / 1000,
    repeat: number(model.repeat),
    reverse: model.reverse === true,
    clear: model.clean === true || model.remove === true,
  }
}

/** `a1` 是属性变化：按 TYPE 分成透明度、旋转、位移、缩放四种轨道。 */
function trackOf(model: JsonObject): MotionTrack {
  const type = number(asObject(model.b)?.t)
  const property: MotionProperty = type === 0 ? "alpha" : type === 1 ? "rotate" : type === 2 ? "translate" : "scale"
  const variant = a1Variant(model)
  const scalar = variant === "scalar"
  const from = scalar ? rangeOf([model.from, model.from]) : rangeOf(model.from_p ?? model.from_px)
  const to = scalar ? rangeOf([model.to, model.to]) : rangeOf(model.to_p ?? model.to_px)
  // 位移与缩放是增量，透明度与旋转是绝对值。
  const relative = property === "translate" || (property === "scale" && !a1IsScale(model))
  const pivot = pointOf(model.pp) ?? pointOf(model.pxp)
  return {
    property,
    from: [from, from],
    to: [to, to],
    relative,
    easing: easingOf(model.style),
    ...(pivot ? { pivot } : {}),
  }
}

/** `af2` 是帧序列：一个文件加每帧时长。 */
function framesOf(model: JsonObject): Array<{ image: string; duration?: number }> {
  const file = typeof model.file === "string" ? model.file : undefined
  const durations = Array.isArray(model.psr) ? model.psr : []
  if (!file) return []
  if (!durations.length) return [{ image: file }]
  return durations.map((entry) => ({
    image: file,
    ...(Number.isFinite(Number(entry)) ? { duration: Number(entry) / 1000 } : {}),
  }))
}

/** `a4` 是粒子发射。 */
function emitterOf(model: JsonObject): MotionEmitter {
  const area = Array.isArray(model.aera) ? model.aera.map(Number) : []
  return {
    images: Array.isArray(model.i_p) ? model.i_p.filter((item): item is string => typeof item === "string") : [],
    type: number(model.emit_type) === 1 ? "complex" : "simple",
    life: rangeOf(model.life),
    count: number(model.count),
    birthRate: number(model.rate),
    region: {
      position: { x: area[0] ?? 0, y: area[1] ?? 0 },
      size: { width: area[2] ?? 0, height: area[3] ?? 0 },
    },
    velocity: rangeOf(model.velocity),
    velocityDirection: rangeOf(model.v_direction),
    acceleration: rangeOf(model.acceleration),
    accelerationDirection: rangeOf(model.a_direction),
    scale: rangeOf(model.scale),
    scaleSpeed: rangeOf(model.s_scale),
    rotation: rangeOf(model.rotation),
    rotationSpeed: rangeOf(model.spin),
    alpha: rangeOf(model.alpha),
    alphaSpeed: rangeOf(model.s_alpha),
    finish: model.clean === true ? "gone" : "emitted",
    removeWithParticles: model.remove === true,
    mirror: number(model.m_up),
  }
}

/** 一个动画包装对象 → IR 节点；不认识的家族保留为不透明节点，字段原样带上。 */
function nodeOf(kind: string, model: JsonObject, animations: JsonObject): MotionNode {
  void animations
  const timeline = timelineOf(model, durationOf(kind, model))
  if (kind === "a1") {
    const track = trackOf(model)
    return {
      kind: "track",
      target: { subject: "unknown", property: motionPropertyOf(track.property) },
      keyframes: keyframesOf(track, timeline.duration),
      easing: track.easing,
      ...(track.pivot ? { pivot: track.pivot } : {}),
      vector: { from: track.from, to: track.to, relative: track.relative },
      timeline,
    }
  }
  if (kind === "af2") {
    return { kind: "frames", frames: framesOf(model), timeline }
  }
  if (kind === "a4") {
    return { kind: "opaque", format: "sxi.a4", blob: emitterOf(model), timeline }
  }
  if (kind === "a11") {
    // 碰撞物理：重力向下、阻力与摩擦力分别对应 drag 与 bounce。
    return {
      kind: "opaque",
      format: "sxi.a11",
      blob: {
        gravity: { x: 0, y: number(model.g) },
        drag: number(model.resist ?? model.fric),
        bounce: number(model.rest),
      },
      timeline,
    }
  }
  if (kind === "a3") {
    // 组合动画的子项是别的动画编号；用引用节点保住编号，不展开。
    const ids = Array.isArray(model.animations) ? model.animations.map(String) : []
    return {
      kind: "group",
      method: model.method === 1 ? "sequential" : model.method === 2 ? "random" : "simultaneous",
      children: ids.map((id) => ({ kind: "reference" as const, id })),
      timeline,
    }
  }
  // 不认识的家族保留成不透明节点：嵌套字段摊平成点路径，数组用下标，值一律转成可读标量。
  const values = new Map<string, number | string | boolean>()
  flatten(model, "", values)
  return { kind: "opaque", format: `sxi.${kind}`, blob: values, timeline }
}

/** 把嵌套对象摊平成 `a.b.0` 这样的键，只收标量。 */
function flatten(value: Json, prefix: string, out: Map<string, number | string | boolean>): void {
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
    if (prefix) out.set(prefix, value)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => flatten(item, prefix ? `${prefix}.${index}` : String(index), out))
    return
  }
  const object = asObject(value)
  if (!object) return
  for (const [key, item] of Object.entries(object)) flatten(item, prefix ? `${prefix}.${key}` : key, out)
}

/** 动画的时长：不同家族的时长字段不同。 */
function durationOf(kind: string, model: JsonObject): number {
  if (kind === "a1") return number(model.duration)
  if (kind === "af2") return number(model.d)
  if (kind === "a4") return number(model.duration)
  return 0
}

/** 皮肤里合并后的动画与样式表；主题结构的 `s_info` 是共享层，`s_port`/`s_land` 覆盖它。 */
function mergedStruct(skin: JsonObject, theme: string, orientation: string): { animations: JsonObject; styles: JsonObject } {
  // skin.json 顶层是 `{ default: … }`，也允许直接传 `default` 那一层。
  const root = asObject(skin.default) ?? skin
  const struct = asObject(root[theme]) ?? {}
  const shared = asObject(struct.s_info) ?? {}
  const own = asObject(struct[orientation === "land" ? "s_land" : "s_port"]) ?? {}
  return {
    animations: { ...asObject(shared.ss_2), ...asObject(own.ss_2) },
    styles: { ...asObject(shared.ss_1), ...asObject(own.ss_1) },
  }
}

/** 手心皮肤 → IR 动效表：每个动画一个动效，样式里绑定的时机记成绑定。 */
export function motionsOfSkin(skin: JsonObject, theme: string, orientation: string): SkinMotions {
  const { animations, styles } = mergedStruct(skin, theme, orientation)
  const motions = new Map<string, MotionNode>()
  for (const [id, wrap] of Object.entries(animations)) {
    const parsed = animationModel(asObject(wrap) ?? {})
    if (!parsed) continue
    const bindings: MotionBinding[] = []
    for (const [styleId, style] of Object.entries(styles)) {
      const events = asObject(asObject(style)?.s_5)
      if (!events) continue
      for (const [event, target] of Object.entries(events)) {
        if (String(target).trim() !== id) continue
        const slot = SLOT_OF[event]
        if (!slot) continue
        bindings.push({ target: `style:${styleId}`, slot, scope: "both" })
      }
    }
    motions.set(id, { ...nodeOf(parsed.kind, parsed.model, animations), bindings })
  }
  return motions
}

/* —— 写回 —— */

function modelOf(motion: MotionNode, kind: string): JsonObject {
  const timeline = motion.timeline ?? DEFAULT_TIMELINE
  const common = {
    duration: String(Math.round(timeline.duration * 1000)),
    delay: String(Math.round(timeline.delay * 1000)),
    ...(timeline.repeat ? { repeat: String(timeline.repeat) } : {}),
    ...(timeline.reverse ? { reverse: true } : {}),
    ...(timeline.clear ? { clean: true } : {}),
  }
  if (motion.kind === "track" && kind === "a1") {
    const vector = motion.vector
    const from = vector?.from ?? [[motion.keyframes[0]?.value ?? 0, motion.keyframes[0]?.value ?? 0], [0, 0]]
    const to = vector?.to ?? [[motion.keyframes[motion.keyframes.length - 1]?.value ?? 0, motion.keyframes[motion.keyframes.length - 1]?.value ?? 0], [0, 0]]
    const property: MotionProperty = motion.target.property === "alpha" ? "alpha"
      : motion.target.property === "rotation" ? "rotate"
        : motion.target.property === "x" || motion.target.property === "y" ? "translate"
          : "scale"
    const scalar = property === "alpha" || property === "rotate"
    const type = property === "alpha" ? 0 : property === "rotate" ? 1 : property === "translate" ? 2 : 3
    return {
      b: { c: 0, t: type },
      ...(scalar
        ? { from: String(Math.round(from[0][0])), to: String(Math.round(to[0][0])) }
        : property === "translate"
          ? { from_px: pair(from, 0), to_px: pair(to, 0) }
          : { from_p: pair(from, 0), to_p: pair(to, 0) }),
      style: String(interpolationOf(motion.easing ?? { kind: "linear" })),
      ...(motion.pivot ? { pp: [motion.pivot.x, motion.pivot.y] } : {}),
      ...common,
    }
  }
  if (motion.kind === "opaque" && motion.format === "sxi.a11") {
    const blob = motion.blob as { gravity: Point<number>; drag: number; bounce: number }
    return {
      g: String(blob.gravity.y),
      rest: String(blob.bounce),
      resist: String(blob.drag),
      fric: String(blob.drag),
      duration: common.duration,
      delay: common.delay,
    }
  }
  if (motion.kind === "frames" && kind === "af2") {
    return {
      type: "0",
      file: motion.frames[0]?.image ?? "",
      psr: motion.frames.map((frame) => Math.round((frame.duration ?? 0) * 1000)),
      d: common.duration,
      delay: common.delay,
    }
  }
  if (motion.kind === "opaque" && motion.format === "sxi.a4") {
    const emitter = motion.blob as MotionEmitter
    return {
      aera: [emitter.region.position.x, emitter.region.position.y, emitter.region.size.width, emitter.region.size.height],
      i_p: emitter.images,
      emit_type: emitter.type === "complex" ? 1 : 0,
      life: pair2(emitter.life),
      count: emitter.count,
      rate: emitter.birthRate,
      ...common,
    }
  }
  return {}
}

function pair(vector: MotionVector, axis: 0 | 1): [number, number] {
  const range = vector[axis]
  return [range[0], range[1]]
}

function pair2(range: MotionRange): [number, number] {
  return [range[0], range[1]]
}

/** IR 动效表 → 手心的 `ss_2` 与样式绑定；写不出精确模型的家族进 warnings。 */
export function skinAnimationsOf(motions: SkinMotions): { animations: JsonObject; bindings: Map<string, Record<string, string>>; warnings: string[] } {
  const animations: JsonObject = {}
  const bindings = new Map<string, Record<string, string>>()
  const warnings: string[] = []
  for (const [id, motion] of motions) {
    const kind = motion.kind === "track" ? "a1"
      : motion.kind === "frames" ? "af2"
        : motion.kind === "group" ? "a3"
          : motion.kind === "opaque" && motion.format === "sxi.a11" ? "a11"
            : motion.kind === "opaque" && motion.format === "sxi.a4" ? "a4"
              : ""
    if (!kind) {
      warnings.push(`${id}：动效类型 ${motion.kind} 无法写成手心动画`)
      continue
    }
    animations[id] = { [kind]: modelOf(motion, kind) }
    for (const binding of motion.bindings ?? []) {
      if (!binding.target.startsWith("style:")) continue
      const styleId = binding.target.slice(6)
      const events = bindings.get(styleId) ?? {}
      events[EVENT_OF[binding.slot]] = id
      bindings.set(styleId, events)
    }
  }
  return { animations, bindings, warnings }
}

/* —— 音效 —— */

/** 手心的音效放在样式的 `s_4` 里：`path_1` 按下、`path_2` 抬起、`path_3` 长按。 */
const SOUND_FIELDS: Record<MotionSlot, string> = { press: "path_1", release: "path_2", show: "path_3", hide: "path_3", hold: "path_3" }

/** 样式表 → IR 音效表；主体是「样式编号:时机」。 */
export function soundsOfSkin(skin: JsonObject, theme: string, orientation: string): SoundBinding[] {
  const { styles } = mergedStruct(skin, theme, orientation)
  const sounds: SoundBinding[] = []
  for (const [styleId, style] of Object.entries(styles)) {
    const entry = asObject(asObject(style)?.s_4)
    if (!entry) continue
    for (const [slot, field] of Object.entries(SOUND_FIELDS) as Array<[MotionSlot, string]>) {
      const file = entry[field]
      if (typeof file !== "string" || !file.trim()) continue
      sounds.push({ subject: `${styleId}:${slot}`, sound: file.trim() })
    }
  }
  return sounds
}

/** IR 音效表 → 手心的 `s_4`；主体形如 `7:press`。 */
export function skinSoundsOf(sounds: readonly SoundBinding[]): { styles: Map<string, Record<string, string>>; warnings: string[] } {
  const styles = new Map<string, Record<string, string>>()
  const warnings: string[] = []
  for (const sound of sounds) {
    const separator = sound.subject.lastIndexOf(":")
    if (separator < 0) {
      warnings.push(`${sound.subject}：音效主体缺少时机，写不进手心样式`)
      continue
    }
    const styleId = sound.subject.slice(0, separator)
    const slot = sound.subject.slice(separator + 1) as MotionSlot
    const field = SOUND_FIELDS[slot]
    if (!field) {
      warnings.push(`${sound.subject}：手心没有对应时机的音效字段`)
      continue
    }
    styles.set(styleId, { ...styles.get(styleId), [field]: sound.sound })
  }
  return { styles, warnings }
}
