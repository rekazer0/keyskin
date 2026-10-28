// The animation inspector's player clip for a Palm animation, read from skin.json's `ss_2` the way the
// Palm canvas plays it (palm-motion.ts): `a1` animates one property, `a3` combines animations, `af2`
// plays an animated image, `a4` emits particles. The other families are listed as not previewable.

import { clipPasses, emptyClip, mergeClip, type PreviewClip } from "../animation-preview-model.ts"
import { animationEasing, type LegacyParticleEmitter } from "../preview-animation.ts"
import type { Pair, Track } from "../native-motion.ts"
import { trackEnd } from "../native-motion.ts"
import { asObject, rectParts, type Json, type JsonObject } from "./sxi-ini.ts"

const number = (value: Json | undefined, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback
const pair = (value: Json | undefined, fallback: Pair): Pair =>
  Array.isArray(value) && typeof value[0] === "number" && typeof value[1] === "number" ? [value[0], value[1]] : fallback

function particles(model: JsonObject): LegacyParticleEmitter | undefined {
  const images = (Array.isArray(model.i_p) ? model.i_p : []).map(String).filter(Boolean)
  if (!images.length) return
  const region = rectParts(model.aera ?? null)
  return {
    images,
    life: pair(model.life, [1000, 1000]),
    emitRegion: region ?? [0, 0, 1, 1],
    totalNumber: Math.max(1, number(model.count, 1)),
    birthRate: Math.max(0.1, number(model.rate, 1)),
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
  const wrap = asObject(table[id])
  if (!wrap) {
    clip.notes.push(`动画 ${id} 不存在`)
    return clip
  }
  const group = asObject(wrap.a3)
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
  const kind = ["a1", "af2", "a4"].find((key) => asObject(wrap[key]))
  const model = kind ? asObject(wrap[kind])! : undefined
  if (!kind || !model) {
    clip.notes.push("此特殊动效暂不支持桌面播放，请在真机验证；参数仍可完整编辑")
    return clip
  }
  const base = asObject(model.b) ?? {}
  const reverse = base.back === true
  const repeats = clipPasses(number(base.count, 1), reverse, clip)
  if (kind === "a4") {
    const delay = Math.max(0, number(model.delay))
    const emitter = particles(model)
    if (emitter) {
      clip.duration = delay + Math.max(Math.max(0, number(model.duration)), emitter.totalNumber / emitter.birthRate * 1000 + Math.max(...emitter.life))
      clip.particles.push({ emitter, start: delay, duration: clip.duration - delay })
      clip.notes.push("粒子弹道预览；触摸和发射模式以真机为准")
    } else clip.notes.push("请先配置粒子图片")
    return clip
  }
  if (kind === "af2") {
    const delay = Math.max(0, number(model.delay))
    const duration = Math.max(0, number(model.d))
    clip.images.push({ file: typeof model.file === "string" ? model.file : undefined, start: delay, duration, passes: repeats, offset: pair(model.pos, [0, 0]) })
    clip.duration = delay + duration * repeats
    if (reverse || model.psr !== undefined) clip.notes.push("帧序列按正向均匀速率预览，往返与三段速率请在真机验证")
    return clip
  }
  const type = number(base.t)
  if (![0, 1, 2, 3, 4].includes(type)) {
    clip.notes.push("当前变化属性不支持预览，原始参数保留")
    return clip
  }
  const scalar = type === 0 || type === 1
  const pixels = type === 2 && (model.from_px !== undefined || model.to_px !== undefined)
  const scale = type === 0 ? 1 / 255 : !scalar && !pixels ? 1 / 100 : 1
  const ends = (field: "from" | "to"): Pair => {
    const values = scalar
      ? [number(model[field], type === 0 ? 255 : 0), number(model[field], type === 0 ? 255 : 0)]
      : pair(model[pixels ? `${field}_px` : `${field}_p`], type === 3 || type === 4 ? [100, 100] : [0, 0])
    return [values[0] * scale, values[1] * scale]
  }
  const [from, to] = [ends("from"), ends("to")]
  const curves = pair(model.style, [number(model.style), number(model.style)])
  const pivotPoint = model.pp !== undefined ? pair(model.pp, [50, 50]) : undefined
  const pivotPixels = model.pxp !== undefined ? pair(model.pxp, [32, 32]) : undefined
  const track: Track = {
    kind: type === 0 ? "opacity" : type === 1 ? "rotate" : type === 2 ? "translate" : "scale",
    start: Math.max(0, number(model.delay)), duration: Math.max(0, number(model.duration)), passes: repeats, alternate: reverse,
    hold: base.clear !== true, relative: type === 2 && !pixels,
    pivot: pivotPoint ? [pivotPoint[0] / 100, pivotPoint[1] / 100] : pivotPixels && [pivotPixels[0] / 64, pivotPixels[1] / 64],
    value: (progress) => [from[0] + (to[0] - from[0]) * animationEasing(curves[0], progress), from[1] + (to[1] - from[1]) * animationEasing(curves[1], progress)],
  }
  clip.tracks.push(track)
  clip.duration = trackEnd(track)
  return clip
}
