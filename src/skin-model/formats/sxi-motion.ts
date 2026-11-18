// 手心皮肤的动画 ↔ IR 动效。
//
// `skin.json` 的 `ss_2` 按编号存动画包装对象，每个包装对象里是 `a1`（属性变化）、`af2`（帧序列）、
// `a4`（粒子）、`a3`（组合）等家族之一；`ss_1` 的 `s_5` 把动画绑到样式的按下、显示等时机。
import type { Json, JsonObject } from "@/palm/sxi-ini.ts"
import { asObject } from "@/palm/sxi-ini.ts"
import { a1IsScale, a1Variant, animationModel } from "@/palm/sxi-animation.ts"
import type { Point } from "taffy-layout"
import type { Easing, MotionBinding, MotionEmitter, MotionFrame, MotionNode, MotionProperty, MotionRange, MotionTimeline, MotionTrack, MotionVector, SkinMotion, SkinMotions } from "@/skin-model/motion.ts"
import type { SkinSound, SkinSounds } from "@/skin-model/sound.ts"
import type { MotionSlot } from "@/skin-model/types.ts"

/** 手心的时机编号：1 按下、2 抬起、3 显示、4 隐藏。 */
const SLOT_OF: Record<string, MotionSlot> = { "1": "press", "2": "release", "3": "show", "4": "hide" }
const EVENT_OF: Record<MotionSlot, string> = { press: "1", release: "2", show: "3", hide: "4", hold: "3" }

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
function framesOf(model: JsonObject): MotionFrame[] {
  const file = typeof model.file === "string" ? model.file : undefined
  const durations = Array.isArray(model.psr) ? model.psr : []
  if (!file) return []
  if (!durations.length) return [{ file }]
  return durations.map((entry) => ({
    file,
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

/** 一个动画包装对象 → IR 节点；不认识的家族保留为自定义节点，字段原样带上。 */
function nodeOf(kind: string, model: JsonObject, animations: JsonObject): MotionNode {
  if (kind === "a1") {
    const duration = number(model.duration)
    return { kind: "track", track: trackOf(model), delay: number(model.delay) / 1000, duration: duration / 1000 }
  }
  if (kind === "af2") {
    return { kind: "frames", frames: framesOf(model), loop: number(model.r), delay: number(model.delay) / 1000, duration: number(model.d) / 1000 }
  }
  if (kind === "a4") {
    return { kind: "particles", emitter: emitterOf(model), delay: number(model.delay) / 1000, duration: number(model.duration) / 1000 }
  }
  if (kind === "a3") {
    // 组合动画的子项是别的动画编号，按出现顺序并成序列。
    const ids = Array.isArray(model.animations) ? model.animations.map(String) : []
    const children = ids.flatMap((id) => {
      const wrap = asObject(animations[id])
      const nested = wrap ? animationModel(wrap) : undefined
      return nested ? [nodeOf(nested.kind, nested.model, animations)] : []
    })
    return {
      kind: "sequence",
      method: model.method === 1 ? "sequential" : model.method === 2 ? "random" : "parallel",
      children,
      delay: 0,
      duration: 0,
    }
  }
  const values = new Map<string, number | string | boolean>()
  for (const [key, value] of Object.entries(model)) {
    if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") values.set(key, value)
  }
  return { kind: "custom", family: `sxi.${kind}`, values }
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
  const motions = new Map<string, SkinMotion>()
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
    motions.set(id, {
      id,
      root: nodeOf(parsed.kind, parsed.model, animations),
      timeline: timelineOf(parsed.model, durationOf(parsed.kind, parsed.model)),
      bindings,
    })
  }
  return motions
}

/* —— 写回 —— */

function modelOf(motion: SkinMotion, kind: string): JsonObject {
  const { root, timeline } = motion
  const common = {
    duration: String(Math.round(timeline.duration * 1000)),
    delay: String(Math.round(timeline.delay * 1000)),
    ...(timeline.repeat ? { repeat: String(timeline.repeat) } : {}),
    ...(timeline.reverse ? { reverse: true } : {}),
    ...(timeline.clear ? { clean: true } : {}),
  }
  if (root.kind === "track" && kind === "a1") {
    const track = root.track
    const scalar = track.property === "alpha" || track.property === "rotate"
    const type = track.property === "alpha" ? 0 : track.property === "rotate" ? 1 : track.property === "translate" ? 2 : 3
    return {
      b: { ...(asObject(undefined) ?? {}), c: 0, t: type },
      ...(scalar
        ? { from: String(Math.round(track.from[0][0])), to: String(Math.round(track.to[0][0])) }
        : track.property === "translate"
          ? { from_px: pair(track.from, 0), to_px: pair(track.to, 0) }
          : { from_p: pair(track.from, 0), to_p: pair(track.to, 0) }),
      style: String(interpolationOf(track.easing)),
      ...(track.pivot ? { pp: [track.pivot.x, track.pivot.y] } : {}),
      ...common,
    }
  }
  if (root.kind === "frames" && kind === "af2") {
    return {
      type: "0",
      file: root.frames[0]?.file ?? "",
      psr: root.frames.map((frame) => Math.round((frame.duration ?? 0) * 1000)),
      d: common.duration,
      delay: common.delay,
    }
  }
  return {}
}

function pair(vector: MotionVector, axis: 0 | 1): [number, number] {
  const range = vector[axis]
  return [range[0], range[1]]
}

/** IR 动效表 → 手心的 `ss_2` 与样式绑定；写不出精确模型的家族进 warnings。 */
export function skinAnimationsOf(motions: SkinMotions): { animations: JsonObject; bindings: Map<string, Record<string, string>>; warnings: string[] } {
  const animations: JsonObject = {}
  const bindings = new Map<string, Record<string, string>>()
  const warnings: string[] = []
  for (const [id, motion] of motions) {
    const kind = motion.root.kind === "track" ? "a1" : motion.root.kind === "frames" ? "af2" : "a4"
    if (motion.root.kind !== "track" && motion.root.kind !== "frames") {
      warnings.push(`${id}：动效类型 ${motion.root.kind} 无法写成手心动画`)
      continue
    }
    animations[id] = { [kind]: modelOf(motion, kind) }
    for (const binding of motion.bindings) {
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

/** 样式表 → IR 音效表；键是样式编号加时机的组合。 */
export function soundsOfSkin(skin: JsonObject, theme: string, orientation: string): SkinSounds {
  const { styles } = mergedStruct(skin, theme, orientation)
  const sounds = new Map<string, SkinSound>()
  for (const [styleId, style] of Object.entries(styles)) {
    const entry = asObject(asObject(style)?.s_4)
    if (!entry) continue
    for (const [slot, field] of Object.entries(SOUND_FIELDS) as Array<[MotionSlot, string]>) {
      const file = entry[field]
      if (typeof file !== "string" || !file.trim()) continue
      sounds.set(`${styleId}:${slot}`, { slot: slot === "press" ? "key" : slot === "release" ? "key" : "other", resource: file.trim() })
    }
  }
  return sounds
}

/** IR 音效表 → 手心的 `s_4`；键形如 `7:press`。 */
export function skinSoundsOf(sounds: SkinSounds): { styles: Map<string, Record<string, string>>; warnings: string[] } {
  const styles = new Map<string, Record<string, string>>()
  const warnings: string[] = []
  for (const [key, sound] of sounds) {
    const separator = key.lastIndexOf(":")
    if (separator < 0) {
      warnings.push(`${key}：音效键缺少时机，写不进手心样式`)
      continue
    }
    const styleId = key.slice(0, separator)
    const slot = key.slice(separator + 1) as MotionSlot
    const field = SOUND_FIELDS[slot]
    if (!field) {
      warnings.push(`${key}：手心没有对应时机的音效字段`)
      continue
    }
    styles.set(styleId, { ...styles.get(styleId), [field]: sound.resource })
  }
  return { styles, warnings }
}
