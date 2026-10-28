import { IniDocument } from "./ini.ts"
import type { BdaAnimation, BdaAnimationEffect, BdaNumberRange } from "./bda.ts"
import { animationEasing, bdaParticleEmitter, numberRange, parseLegacyParticleEmitter, type LegacyParticleEmitter } from "./preview-animation.ts"
import { trackEnd, type Pair, type Track } from "./native-motion.ts"

/** One row of the player's timeline: where a track, emitter or frame clip plays, in ms. */
export type PreviewLane = { label: string; start: number; duration: number; passes: number; unbounded?: boolean }

export type PreviewClip = {
  tracks: Track[]
  particles: Array<{ emitter: LegacyParticleEmitter; start: number; duration: number }>
  images: Array<{ file?: string; resources?: Array<{ id: string; duration: number }>; start: number; duration: number; passes: number; offset: Pair }>
  lanes: PreviewLane[]
  duration: number
  notes: string[]
}

const empty = (): PreviewClip => ({ tracks: [], particles: [], images: [], lanes: [], duration: 0, notes: [] })
const finite = (value: string | undefined, fallback = 0): number => value?.trim() && Number.isFinite(Number(value)) ? Number(value) : fallback
const pair = (value: string | undefined, fallback: Pair): Pair => {
  const values = value?.split(",").map(Number)
  return values?.length === 2 && values.every(Number.isFinite) ? [values[0], values[1]] : fallback
}
/** The sample key's size in device pixels: pixel pivots, translations and particle speeds are measured against it. */
export const PREVIEW_KEY_SIZE = 108
/** Window a looping clip is watched for: one pass (two when it runs back and forth). */
const LOOP_PASSES = 1

function merge(target: PreviewClip, child: PreviewClip, offset: number): void {
  target.tracks.push(...child.tracks.map((track) => ({ ...track, start: track.start + offset })))
  target.particles.push(...child.particles.map((item) => ({ ...item, start: item.start + offset })))
  target.images.push(...child.images.map((item) => ({ ...item, start: item.start + offset })))
  target.lanes.push(...child.lanes.map((lane) => ({ ...lane, start: lane.start + offset })))
  target.duration = Math.max(target.duration, offset + child.duration)
  target.notes.push(...child.notes)
}

/** Passes the preview plays; a looping clip is cut to a finite observation window and says so. */
function passes(count: number, reverse: boolean, clip: PreviewClip): { passes: number; unbounded: boolean } {
  if (count < 0 || count >= 2 ** 31 - 1 || !Number.isFinite(count)) {
    clip.notes.push("循环动画：预览一个观察周期")
    return { passes: LOOP_PASSES * (reverse ? 2 : 1), unbounded: true }
  }
  return { passes: Math.max(1, count) * (reverse ? 2 : 1), unbounded: false }
}

/** `REPEAT_CNT=inf` (Baidu) and Palm's INT_MAX both mean "until removed". */
function repeatCount(value: string | undefined): number {
  return value?.trim().toLowerCase() === "inf" ? -1 : finite(value, 1)
}

const TRANSFORM_LABELS = ["透明度", "旋转", "位移", "缩放", "缩放", "3D 旋转"]

/** The lane label of `ANIM12`: the inspector calls every entry 动画 N. */
function sectionTitle(section: string): string {
  const index = /^ANIM(\d+)$/i.exec(section)?.[1]
  return index ? `动画 ${index}` : section
}

/**
 * The inspector previews a clip directly; it does not need a style binding to trigger it. Reads the
 * anim.ini dialect shared by Baidu skins and Palm's projection: basic transforms (TYPE 0–5),
 * combinations, frame clips (`SOURCE_FILE` webp, `ANIM_PATH` gif) and particle emitters. Baidu plays
 * transforms with `fillBefore`: a delayed or later combination child shows its start value meanwhile.
 */
export function iniPreviewClip(document: IniDocument, section: string, options: { fillBefore?: boolean } = {}, ancestors: string[] = []): PreviewClip {
  const clip = empty()
  if (ancestors.includes(section) || ancestors.length >= 16) {
    clip.notes.push("组合引用循环或层级过深，已跳过")
    return clip
  }
  if (!document.sections().includes(section)) {
    clip.notes.push(`${sectionTitle(section)} 不存在`)
    return clip
  }
  const get = (key: string) => document.get(section, key)
  const kind = finite(get("CATEGORY"), get("BUILD_LIST") !== undefined ? 1 : get("PARTICLE_IMAGE") !== undefined ? 3 : get("ANIM_PATH") !== undefined ? 2 : 0)
  const delay = Math.max(0, finite(get("DELAY")))
  const duration = Math.max(0, finite(get("DURATION")))
  const reverse = get("REPEAT_MODE") === "1"
  const prefix = ancestors.length ? `${sectionTitle(section)} · ` : ""
  if (kind === 1) {
    const ids = (get("BUILD_LIST") ?? "").split(",").map((id) => id.trim()).filter(Boolean)
    const method = get("BUILD_METHOD") ?? "0"
    const selected = method === "2" ? ids.slice(0, 1) : ids
    if (method === "2") clip.notes.push("随机组合：本次预览第一个子动画")
    for (const id of selected) {
      const child = iniPreviewClip(document, `ANIM${Number(id)}`, options, [...ancestors, section])
      merge(clip, child, delay + (method === "1" ? Math.max(0, clip.duration - delay) : 0))
    }
    if (!ids.length) clip.notes.push("请先添加子动画")
    if (repeatCount(get("REPEAT_CNT")) !== 1 || reverse) clip.notes.push("组合按一次播放预览，整体重复与往返以真机为准")
  } else if (kind === 3) {
    const emitter = parseLegacyParticleEmitter(document, section)
    if (emitter) {
      const emitting = emitter.totalNumber / emitter.birthRate * 1000
      clip.duration = delay + Math.max(duration, emitting + Math.max(...emitter.life))
      clip.particles.push({ emitter, start: delay, duration: clip.duration - delay })
      clip.lanes.push({ label: `${prefix}发射 ${emitter.totalNumber} 个粒子`, start: delay, duration: emitting, passes: 1 })
      clip.notes.push("粒子按弹道预览；触摸跟随与发射模式以真机为准")
    } else clip.notes.push("请先配置粒子图片")
  } else if (kind === 2) {
    const file = get("SOURCE_FILE") ?? get("ANIM_PATH")
    const repeat = passes(repeatCount(get("REPEAT_CNT")), reverse, clip)
    clip.images.push({ file, start: delay, duration, passes: repeat.passes, offset: pair(get("OFFSET"), [0, 0]) })
    clip.duration = delay + duration * repeat.passes
    clip.lanes.push({ label: `${prefix}帧序列`, start: delay, duration, passes: repeat.passes, unbounded: repeat.unbounded })
    if (reverse || get("PLAY_SPEED_RATE")) clip.notes.push("帧序列按正向均匀速率预览，往返与三段速率以真机为准")
  } else if (kind === 0) {
    const type = finite(get("TYPE"))
    if (![0, 1, 2, 3, 4, 5].includes(type)) {
      clip.notes.push("当前变化属性不支持预览，原始参数保留")
      return clip
    }
    const repeat = passes(repeatCount(get("REPEAT_CNT")), reverse, clip)
    if ([get("FROM"), get("TO"), get("FROM_PX"), get("TO_PX")].some((value) => /rand\(/i.test(value ?? ""))) clip.notes.push("随机值 rand(a,b) 按区间中点预览")
    const pixels = type === 2 && (get("FROM_PX") !== undefined || get("TO_PX") !== undefined)
    const curves = numberRange(get("INTPOL"), [0, 0])
    const pivotPoint = get("PIVOT") !== undefined ? pair(get("PIVOT"), [50, 50]) : undefined
    const pivotPixels = get("PIVOT_PX") !== undefined ? pair(get("PIVOT_PX"), [PREVIEW_KEY_SIZE / 2, PREVIEW_KEY_SIZE / 2]) : undefined
    const pivot: Pair | undefined = pivotPoint ? [pivotPoint[0] / 100, pivotPoint[1] / 100]
      : pivotPixels ? [pivotPixels[0] / PREVIEW_KEY_SIZE, pivotPixels[1] / PREVIEW_KEY_SIZE] : undefined
    const timing = { start: delay, duration, passes: repeat.passes, alternate: reverse, hold: get("REMOVE") !== "1", pivot, fillBefore: options.fillBefore }
    const ease = (from: number, to: number, axis: 0 | 1) => (progress: number) => from + (to - from) * animationEasing(curves[axis], progress)
    if (type === 5) {
      const parts = (key: string) => (get(key) ?? "0,0,0").split(",").map((part) => numberRange(part, [0, 0])[0])
      const [from, to] = [parts("FROM"), parts("TO")]
      const [x, y, z] = [0, 1, 2].map((axis) => ease(from[axis] ?? 0, to[axis] ?? 0, 0))
      // An orthographic projection of the X/Y turns; the device adds perspective.
      clip.tracks.push(
        { ...timing, kind: "scale", value: (progress) => [Math.cos(y(progress) * Math.PI / 180), Math.cos(x(progress) * Math.PI / 180)] },
        { ...timing, kind: "rotate", value: (progress) => [z(progress), z(progress)] },
      )
      clip.notes.push("3D 旋转按正交投影预览，透视效果以真机为准")
    } else {
      const scalar = type === 0 || type === 1
      const scale = type === 0 ? 1 / 255 : !scalar && !pixels ? 1 / 100 : 1
      const ends = (key: string): Pair => {
        const fallback: Pair = type === 3 || type === 4 ? [100, 100] : type === 0 ? [255, 255] : [0, 0]
        const values = numberRange(get(pixels ? `${key}_PX` : key), fallback)
        return scalar ? [values[0] * scale, values[0] * scale] : [values[0] * scale, values[1] * scale]
      }
      const from = ends("FROM"), to = ends("TO")
      const x = ease(from[0], to[0], 0), y = ease(from[1], to[1], scalar ? 0 : 1)
      clip.tracks.push({
        ...timing,
        kind: type === 0 ? "opacity" : type === 1 ? "rotate" : type === 2 ? "translate" : "scale",
        relative: type === 2 && !pixels,
        value: (progress) => [x(progress), y(progress)],
      })
    }
    clip.duration = trackEnd(clip.tracks[clip.tracks.length - 1])
    clip.lanes.push({ label: `${prefix}${TRANSFORM_LABELS[type]}`, start: delay, duration, passes: repeat.passes, unbounded: repeat.unbounded })
  } else clip.notes.push("这种特殊动效暂不支持桌面预览，请在真机验证；参数仍可完整编辑")
  return clip
}

const BDA_LABELS: Record<BdaAnimationEffect["kind"], string> = {
  group: "组合", alpha: "透明度", scale: "缩放", shift: "位移", rotate: "旋转",
  frame: "GIF 帧动画", image: "图片序列", emitter: "粒子", lottie: "Lottie", video: "视频",
}

const midpoint = (range: BdaNumberRange) => (range[0] + range[1]) / 2

/** A BDA effect by its `kind:key` id, as the inspector previews it; random ranges play their midpoint. */
export function bdaPreviewClip(animation: BdaAnimation, id: string, ancestors: string[] = []): PreviewClip {
  const clip = empty()
  const effect = animation.effects.get(id)
  if (ancestors.includes(id) || ancestors.length >= 16) {
    clip.notes.push("组合引用循环或层级过深，已跳过")
    return clip
  }
  if (!effect) {
    clip.notes.push(`${id} 不存在`)
    return clip
  }
  const prefix = ancestors.length ? `${effect.key} · ` : ""
  if (effect.kind === "group") {
    for (const item of effect.items) {
      const child = bdaPreviewClip(animation, `${item.kind}:${item.key}`, [...ancestors, id])
      merge(clip, child, effect.delay + (effect.buildMode === 1 ? Math.max(0, clip.duration - effect.delay) : 0))
    }
    if (!effect.items.length) clip.notes.push("组合里没有子效果")
    if (effect.repeatCount > 1) clip.notes.push("组合按一次播放预览，整体重复以真机为准")
  } else if (effect.kind === "emitter") {
    const emitter = bdaParticleEmitter(effect)
    const emitting = emitter.totalNumber / emitter.birthRate * 1000
    clip.duration = Math.max(effect.duration * 1000, emitting + Math.max(...emitter.life))
    clip.particles.push({ emitter, start: 0, duration: clip.duration })
    clip.lanes.push({ label: `${prefix}发射 ${emitter.totalNumber} 个粒子`, start: 0, duration: emitting, passes: 1 })
    if (!emitter.images.length) clip.notes.push("请先配置粒子资源")
    if (effect.paths.length) clip.notes.push("粒子路径以真机为准，预览按弹道发射")
  } else if (effect.kind === "image") {
    const resources = effect.sequence.frames.map((frame) => ({ id: frame.resourceID ?? "", duration: Math.max(16, frame.duration ?? 100) }))
    const total = resources.reduce((sum, frame) => sum + frame.duration, 0)
    const repeat = passes(effect.loopForever ? -1 : effect.repeatCount, effect.repeatMode === 1, clip)
    clip.images.push({ resources, start: 0, duration: total, passes: repeat.passes, offset: [0, 0] })
    clip.duration = total * repeat.passes
    clip.lanes.push({ label: `${prefix}图片序列`, start: 0, duration: total, passes: repeat.passes, unbounded: repeat.unbounded })
    if (!resources.length) clip.notes.push("图片序列还没有帧")
    if (effect.repeatMode === 1) clip.notes.push("往返播放按正向预览")
  } else if (!("from" in effect)) {
    clip.notes.push(`${BDA_LABELS[effect.kind]}暂不支持桌面预览，请在真机验证；参数仍可编辑`)
  } else {
    const repeat = passes(effect.repeatCount, effect.repeatMode === 1, clip)
    if ([...effect.from, ...effect.to].some((range) => range[0] !== range[1])) clip.notes.push("随机范围按中点预览")
    const curves = effect.interpolationXY ?? [effect.interpolation, effect.interpolation]
    const scale = effect.kind === "alpha" ? 1 / 255 : effect.kind === "scale" || effect.kind === "shift" && effect.relative ? 1 / 100 : 1
    const axis = (index: 0 | 1) => {
      const from = midpoint(effect.from[index] ?? effect.from[0]) * scale
      const to = midpoint(effect.to[index] ?? effect.to[0]) * scale
      return (progress: number) => from + (to - from) * animationEasing(curves[index], progress)
    }
    const scalar = effect.kind === "alpha" || effect.kind === "rotate"
    const x = axis(0), y = scalar ? x : axis(1)
    const pivot: Pair | undefined = effect.pivotPx ? [effect.pivotPx[0] / PREVIEW_KEY_SIZE, effect.pivotPx[1] / PREVIEW_KEY_SIZE]
      : effect.pivot ? [effect.pivot[0] / 100, effect.pivot[1] / 100] : undefined
    const track: Track = {
      kind: effect.kind === "alpha" ? "opacity" : effect.kind === "rotate" ? "rotate" : effect.kind === "shift" ? "translate" : "scale",
      start: effect.delay, duration: effect.duration, passes: repeat.passes, alternate: effect.repeatMode === 1,
      hold: !effect.removeOnFinish, relative: effect.kind === "shift" && effect.relative, pivot,
      value: (progress) => [x(progress), y(progress)],
    }
    clip.tracks.push(track)
    clip.duration = trackEnd(track)
    clip.lanes.push({ label: `${prefix}${BDA_LABELS[effect.kind]}`, start: effect.delay, duration: effect.duration, passes: repeat.passes, unbounded: repeat.unbounded })
  }
  return clip
}
