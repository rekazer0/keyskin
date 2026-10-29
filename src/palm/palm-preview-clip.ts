// The animation inspector's player clip for a Palm animation, read straight from skin.json's `ss_2` the
// way PalmSkin and the canvas (palm-motion.ts) play it: `a1` animates one property, `a3` combines
// animations, `af2` plays an animated image, `a4` emits particles. The family key decides the kind, not
// the base model's category, which a hand-edited skin may get wrong. Other families are named as not
// previewable rather than shown with a stand-in.

import { PREVIEW_KEY_SIZE, clipPasses, emptyClip, mergeClip, type PreviewClip } from "../animation-preview-model.ts"
import { animationEasing, type LegacyParticleEmitter } from "../preview-animation.ts"
import { trackEnd, type Pair, type Track } from "../native-motion.ts"
import { asObject, rectParts, type Json, type JsonObject } from "./sxi-ini.ts"

const number = (value: Json | undefined, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback
/** A `[x, y]` point; a lone number stands for both. */
const pair = (value: Json | undefined, fallback: Pair): Pair => typeof value === "number"
  ? [value, value]
  : Array.isArray(value) && typeof value[0] === "number" && typeof value[1] === "number" ? [value[0], value[1]] : fallback
/** Palm writes "forever" as Int64.max; anything from 2³¹ up loops. */
const repeatCount = (base: JsonObject) => number(base.count, 1) >= 2 ** 31 ? -1 : number(base.count, 1)

function particles(model: JsonObject): LegacyParticleEmitter | undefined {
  const images = (Array.isArray(model.i_p) ? model.i_p : [model.i_p]).filter((item) => item !== undefined && item !== null && item !== "").map(String)
  if (!images.length) return
  return {
    images,
    life: pair(model.life, [1000, 1000]),
    emitRegion: rectParts(model.aera ?? null) ?? [0, 0, 1, 1],
    totalNumber: Math.max(1, number(model.count) || 1),
    birthRate: Math.max(0.1, number(model.rate) || 1),
    velocity: pair(model.velocity, [0, 0]),
    velocityDirection: pair(model.v_direction, [0, 0]),
    acceleration: pair(model.acceleration, [0, 0]),
    accelerationDirection: pair(model.a_direction, [90, 90]),
    initialScale: pair(model.scale, [1, 1]),
    scaleSpeed: pair(model.s_scale, [0, 0]),
    initialRotation: pair(model.rotation, [0, 0]),
    rotationSpeed: pair(model.spin, [0, 0]),
    initialAlpha: pair(model.alpha, [255, 255]),
    alphaSpeed: pair(model.s_alpha, [0, 0]),
  }
}

/** Animation `id` of `table` (an `ss_2`) as a player clip; the inspector plays it without a style binding. */
export function palmPreviewClip(table: JsonObject, id: string, ancestors: string[] = []): PreviewClip {
  const clip = emptyClip()
  if (ancestors.includes(id) || ancestors.length >= 16) {
    clip.notes.push("组合引用循环或层级过深，已跳过")
    return clip
  }
  const wrap = asObject(table[id] ?? null)
  if (!wrap) {
    clip.notes.push(`动画 ${id} 不存在`)
    return clip
  }
  const prefix = ancestors.length ? `动画 ${id} · ` : ""
  const group = asObject(wrap.a3 ?? null)
  if (group) {
    const ids = (Array.isArray(group.animations) ? group.animations : []).map(String)
    const random = group.a_method === "random"
    if (random) clip.notes.push("随机组合：本次预览第一个子动画")
    for (const child of random ? ids.slice(0, 1) : ids) {
      mergeClip(clip, palmPreviewClip(table, child, [...ancestors, id]), group.a_method === "sequential" ? clip.duration : 0)
    }
    if (!ids.length) clip.notes.push("请先添加子动画")
    return clip
  }
  const kind = ["a1", "af2", "a4"].find((key) => asObject(wrap[key] ?? null))
  const model = kind ? asObject(wrap[kind] ?? null)! : undefined
  if (!kind || !model) {
    clip.notes.push("这种特殊动效暂不支持桌面预览，请在真机验证；参数仍可完整编辑")
    return clip
  }
  const base = asObject(model.b ?? null) ?? {}
  const reverse = base.back === true
  const delay = Math.max(0, number(model.delay))
  if (kind === "a4") {
    const emitter = particles(model)
    if (!emitter) {
      clip.notes.push("请先配置粒子图片")
      return clip
    }
    const emitting = emitter.totalNumber / emitter.birthRate * 1000
    clip.duration = delay + Math.max(Math.max(0, number(model.duration)), emitting + Math.max(...emitter.life))
    clip.particles.push({ emitter, start: delay, duration: clip.duration - delay })
    clip.lanes.push({ label: `${prefix}发射 ${emitter.totalNumber} 个粒子`, start: delay, duration: emitting, passes: 1 })
    clip.notes.push("粒子按弹道预览；触摸跟随与发射模式以真机为准")
    return clip
  }
  const repeat = clipPasses(repeatCount(base), reverse, clip)
  if (kind === "af2") {
    const duration = Math.max(0, number(model.d))
    clip.images.push({ file: typeof model.file === "string" ? model.file : undefined, start: delay, duration, passes: repeat.passes, offset: pair(model.pos, [0, 0]) })
    clip.duration = delay + duration * repeat.passes
    clip.lanes.push({ label: `${prefix}帧序列`, start: delay, duration, passes: repeat.passes, unbounded: repeat.unbounded })
    if (reverse || model.psr !== undefined) clip.notes.push("帧序列按正向均匀速率预览，往返与三段速率以真机为准")
    return clip
  }
  // a1: 透明度 (0–255), 旋转 (degrees), 位移 (percent `_p` or pixel `_px`), 缩放 (percent).
  const type = number(base.t)
  if (![0, 1, 2, 3, 4].includes(type)) {
    clip.notes.push("当前变化属性不支持预览，原始参数保留")
    return clip
  }
  const scalar = type === 0 || type === 1
  const pixels = type === 2 && (model.from_px !== undefined || model.to_px !== undefined)
  const ends = (field: "from" | "to"): Pair => {
    if (scalar) {
      const value = number(model[field], type === 0 ? 255 : 0) * (type === 0 ? 1 / 255 : 1)
      return [value, value]
    }
    const [x, y] = pair(model[pixels ? `${field}_px` : `${field}_p`], type === 2 ? [0, 0] : [100, 100])
    return pixels ? [x, y] : [x / 100, y / 100]
  }
  const [from, to] = [ends("from"), ends("to")]
  const curves = pair(model.style, [0, 0])
  const pivotPoint = model.pp !== undefined ? pair(model.pp, [50, 50]) : undefined
  const pivotPixels = model.pxp !== undefined ? pair(model.pxp, [PREVIEW_KEY_SIZE / 2, PREVIEW_KEY_SIZE / 2]) : undefined
  const ease = (axis: 0 | 1) => (progress: number) => from[axis] + (to[axis] - from[axis]) * animationEasing(curves[scalar ? 0 : axis], progress)
  const x = ease(0), y = scalar ? x : ease(1)
  const track: Track = {
    kind: type === 0 ? "opacity" : type === 1 ? "rotate" : type === 2 ? "translate" : "scale",
    // `c_delay` (the combination delay) adds to the animation's own, as on the canvas.
    start: delay + Math.max(0, number(model.c_delay)),
    duration: Math.max(0, number(model.duration)),
    passes: repeat.passes,
    alternate: reverse,
    // `clear` defaults to false (SkinAnimationModel): the key keeps the end value.
    hold: base.clear !== true,
    relative: type === 2 && !pixels,
    pivot: pivotPoint ? [pivotPoint[0] / 100, pivotPoint[1] / 100]
      : pivotPixels && [pivotPixels[0] / PREVIEW_KEY_SIZE, pivotPixels[1] / PREVIEW_KEY_SIZE],
    value: (progress) => [x(progress), y(progress)],
  }
  clip.tracks.push(track)
  clip.duration = trackEnd(track)
  clip.lanes.push({ label: `${prefix}${["透明度", "旋转", "位移", "缩放", "缩放"][type]}`, start: track.start, duration: track.duration, passes: repeat.passes, unbounded: repeat.unbounded })
  return clip
}
