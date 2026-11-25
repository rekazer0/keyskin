// The animation inspector's player clip for a Palm animation, read straight from skin.json's `ss_2` the
// way PalmSkin and the canvas (palm-motion.ts) play it: `a1` animates one property, `a3` combines
// animations, `af2` plays an animated image, `a4` emits particles. `a11` samples a collision sprite
// without emulating Palm's runtime; `a10` reports unavailable path data rather than inventing a path.
// The family key decides the kind, not the base model's category, which a hand-edited skin may get wrong.

import { PREVIEW_KEY_SIZE, clipPasses, emptyClip, mergeClip, type PreviewClip } from "../animation-preview-model.ts"
import { animationEasing, type LegacyParticleEmitter } from "../preview-animation.ts"
import { trackEnd, type Pair, type Track } from "../native-motion.ts"
import { asObject, rectParts, type Json, type JsonObject } from "./sxi-ini.ts"

const number = (value: Json | undefined, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback
const point = (value: Json | undefined): Pair | undefined => Array.isArray(value)
  && typeof value[0] === "number" && Number.isFinite(value[0])
  && typeof value[1] === "number" && Number.isFinite(value[1]) ? [value[0], value[1]] : undefined
/** A `[x, y]` point; a lone number stands for both. */
const pair = (value: Json | undefined, fallback: Pair): Pair => typeof value === "number" && Number.isFinite(value)
  ? [value, value] : point(value) ?? fallback
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

type PreviewOptions = { readFile?: (file: string) => Uint8Array | undefined }
const sourceFile = (model: JsonObject) => typeof model.file === "string" && model.file.trim() ? model.file : undefined
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

function pathUnavailable(model: JsonObject, readFile: PreviewOptions["readFile"]): string {
  const file = sourceFile(model)
  if (!file) return "路径跟踪：路径文件未设置"
  if (readFile && !readFile(file)) return `路径跟踪：找不到路径文件「${file}」`
  // SOURCE_FILE is an opaque reference in the codec. START_POINT and RESTORE_POINT are not path vertices.
  return `路径跟踪：暂不支持桌面解析路径文件「${file}」；路径与触摸跟随请在真机验证`
}

function collisionClip(clip: PreviewClip, model: JsonObject, base: JsonObject, prefix: string, readFile: PreviewOptions["readFile"]): PreviewClip {
  const file = sourceFile(model)
  const requestedDuration = number(model.duration)
  const bounds = rectParts(model.collision_rect ?? null)
  if (!file) clip.notes.push("碰撞物理：图片未设置")
  else if (!readFile) clip.notes.push(`碰撞物理：无法检查图片「${file}」是否存在`)
  else if (!readFile(file)) clip.notes.push(`碰撞物理：找不到图片「${file}」`)
  else if (requestedDuration <= 0) clip.notes.push("碰撞物理：请设置大于零的时长")
  else if (!bounds || !bounds.every(Number.isFinite) || bounds[2] <= 0 || bounds[3] <= 0
    || !Number.isFinite(bounds[0] + bounds[2]) || !Number.isFinite(bounds[1] + bounds[3])) {
    clip.notes.push("碰撞物理：请设置有效的碰撞区域")
  } else {
    const [left, top, width, height] = bounds
    const right = left + width, bottom = top + height
    const center: Pair = [left + width / 2, top + height / 2]
    const launch = point(model.launch_point)
    let x = clamp(launch?.[0] ?? center[0], left, right), y = clamp(launch?.[1] ?? center[1], top, bottom)
    let [vx, vy] = point(model.v) ?? [0, 0]
    const [dx, dy] = point(model.dir) ?? [0, 1]
    const magnitude = Math.hypot(dx, dy) || 1
    const gravity = number(model.g, 980)
    const ax = dx / magnitude * gravity, ay = dy / magnitude * gravity
    const rest = clamp(number(model.rest, 0.6), 0, 1)
    const grip = 1 - clamp(number(model.fric, 0.1), 0, 1)
    let angle = 0, spin = number(model.a_vel)
    const duration = Math.min(requestedDuration, 60_000)
    const steps = Math.max(1, Math.ceil(duration * 120 / 1000))
    const dt = duration / steps / 1000
    const drag = Math.exp(-Math.max(0, number(model.resist)) * dt)
    const angularDrag = Math.exp(-Math.max(0, number(model.a_resist)) * dt)
    // ponytail: sample a point against the authored rectangle, not the bitmap's contact shape.
    const samples = [[x - center[0], y - center[1], angle]]
    for (let i = 0; i < steps; i++) {
      vx = (vx + ax * dt) * drag
      vy = (vy + ay * dt) * drag
      x += vx * dt
      y += vy * dt
      if (x < left || x > right) { x = clamp(x, left, right); vx *= -rest; vy *= grip }
      if (y < top || y > bottom) { y = clamp(y, top, bottom); vy *= -rest; vx *= grip }
      spin *= angularDrag
      angle += spin * dt
      if (![x, y, vx, vy, angle].every(Number.isFinite)) {
        clip.notes.push("碰撞物理：数值超出桌面预览范围")
        return clip
      }
      samples.push([x - center[0], y - center[1], angle])
    }
    const sample = (progress: number, axis: number) => {
      const at = clamp(progress, 0, 1) * steps
      const index = Math.floor(at)
      const value = samples[index][axis]
      return index === steps ? value : value + (samples[index + 1][axis] - value) * (at - index)
    }
    const start = Math.max(0, number(model.delay))
    const alternate = base.back === true
    const { passes, unbounded } = clipPasses(repeatCount(base), alternate, clip)
    // Image tracks run in the image's local time, so mergeClip only shifts the image and its lane.
    const timing = { start: 0, duration, passes, alternate, hold: base.clear !== true }
    const tracks: Track[] = [
      { ...timing, kind: "translate", value: (progress) => [sample(progress, 0), sample(progress, 1)] },
      { ...timing, kind: "rotate", value: (progress) => [sample(progress, 2), sample(progress, 2)] },
    ]
    const image = { file, start, duration, passes, offset: [0, 0] as Pair, tracks }
    clip.images.push(image)
    clip.duration = start + duration * passes
    clip.lanes.push({ label: `${prefix}碰撞物理`, start, duration, passes, unbounded })
    clip.notes.push("碰撞物理为近似预览：以图片中心碰撞矩形，方向用于重力；键盘区域与显示层级以真机为准")
    if (model.use_touch === true) clip.notes.push("桌面不跟随触摸，按预览发射位置播放")
    if (!launch) clip.notes.push("发射位置未设置，预览从碰撞区域中心开始")
    else if (launch[0] < left || launch[0] > right || launch[1] < top || launch[1] > bottom) {
      clip.notes.push("发射位置超出碰撞区域，预览从最近的边界开始")
    }
    if (duration !== requestedDuration) clip.notes.push("碰撞预览单程最多采样 60 秒")
  }
  return clip
}

/** Animation `id` of `table` (an `ss_2`) as a player clip; the inspector plays it without a style binding. */
export function palmPreviewClip(table: JsonObject, id: string, options: PreviewOptions = {}): PreviewClip {
  return buildClip(table, id, options, [])
}

function buildClip(table: JsonObject, id: string, options: PreviewOptions, ancestors: string[]): PreviewClip {
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
      mergeClip(clip, buildClip(table, child, options, [...ancestors, id]), group.a_method === "sequential" ? clip.duration : 0)
    }
    if (!ids.length) clip.notes.push("请先添加子动画")
    return clip
  }
  const kind = ["a1", "af2", "a4", "a10", "a11"].find((key) => asObject(wrap[key] ?? null))
  const model = kind ? asObject(wrap[kind] ?? null)! : undefined
  if (!kind || !model) {
    clip.notes.push("这种特殊动效暂不支持桌面预览，请在真机验证；参数仍可完整编辑")
    return clip
  }
  const base = asObject(model.b ?? null) ?? {}
  if (kind === "a10") {
    clip.notes.push(pathUnavailable(model, options.readFile))
    return clip
  }
  if (kind === "a11") return collisionClip(clip, model, base, prefix, options.readFile)
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
