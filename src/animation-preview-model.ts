import { IniDocument } from "./ini.ts"
import { animationEasing, parseLegacyParticleEmitter, type LegacyParticleEmitter } from "./preview-animation.ts"
import { trackEnd, type Pair, type Track } from "./native-motion.ts"

export type PreviewClip = {
  tracks: Track[]
  particles: Array<{ emitter: LegacyParticleEmitter; start: number; duration: number }>
  images: Array<{ file?: string; resources?: Array<{ id: string; duration: number }>; start: number; duration: number; passes: number; offset: Pair }>
  duration: number
  notes: string[]
}

export const emptyClip = (): PreviewClip => ({ tracks: [], particles: [], images: [], duration: 0, notes: [] })
const finite = (value: string | undefined, fallback = 0): number => value?.trim() && Number.isFinite(Number(value)) ? Number(value) : fallback
const pair = (value: string | undefined, fallback: Pair): Pair => {
  const values = value?.split(",").map(Number)
  return values?.length === 2 && values.every(Number.isFinite) ? [values[0], values[1]] : fallback
}

export function mergeClip(target: PreviewClip, child: PreviewClip, offset: number): void {
  target.tracks.push(...child.tracks.map((track) => ({ ...track, start: track.start + offset })))
  target.particles.push(...child.particles.map((item) => ({ ...item, start: item.start + offset })))
  target.images.push(...child.images.map((item) => ({ ...item, start: item.start + offset })))
  target.duration = Math.max(target.duration, offset + child.duration)
  target.notes.push(...child.notes)
}

/** How often a clip plays (twice per pass when it reverses); a looping one is previewed for one period. */
export function clipPasses(count: number, reverse: boolean, clip: PreviewClip): number {
  if (count < 0 || count >= 2 ** 31 || !Number.isFinite(count)) {
    clip.notes.push("循环动画：预览一个观察周期")
    return reverse ? 2 : 1
  }
  return Math.max(1, count) * (reverse ? 2 : 1)
}

/** The inspector previews a clip directly; it does not need a style binding to trigger it. */
export function iniPreviewClip(document: IniDocument, section: string, ancestors: string[] = []): PreviewClip {
  const clip = emptyClip()
  if (ancestors.includes(section) || ancestors.length >= 16) {
    clip.notes.push("组合引用循环或层级过深，已跳过")
    return clip
  }
  if (!document.sections().includes(section)) {
    clip.notes.push(`${section} 不存在`)
    return clip
  }
  const get = (key: string) => document.get(section, key)
  const kind = finite(get("CATEGORY"), get("BUILD_LIST") !== undefined ? 1 : get("PARTICLE_IMAGE") !== undefined ? 3 : 0)
  const delay = Math.max(0, finite(get("DELAY")))
  const duration = Math.max(0, finite(get("DURATION")))
  const reverse = get("REPEAT_MODE") === "1"
  const repeats = clipPasses(finite(get("REPEAT_CNT"), 1), reverse, clip)
  if (kind === 1) {
    const ids = (get("BUILD_LIST") ?? "").split(",").map((id) => id.trim()).filter(Boolean)
    const method = get("BUILD_METHOD") ?? "0"
    const selected = method === "2" ? ids.slice(0, 1) : ids
    if (method === "2") clip.notes.push("随机组合：本次预览第一个子动画")
    for (const id of selected) {
      const child = iniPreviewClip(document, `ANIM${id}`, [...ancestors, section])
      mergeClip(clip, child, method === "1" ? clip.duration : 0)
    }
    if (!ids.length) clip.notes.push("请先添加子动画")
  } else if (kind === 3) {
    const emitter = parseLegacyParticleEmitter(document, section)
    if (emitter) {
      clip.duration = delay + Math.max(duration, emitter.totalNumber / emitter.birthRate * 1000 + Math.max(...emitter.life))
      clip.particles.push({ emitter, start: delay, duration: clip.duration - delay })
      clip.notes.push("粒子弹道预览；触摸和发射模式以真机为准")
    } else clip.notes.push("请先配置粒子图片")
  } else if (kind === 2) {
    clip.images.push({ file: get("SOURCE_FILE"), start: delay, duration, passes: repeats, offset: pair(get("OFFSET"), [0, 0]) })
    clip.duration = delay + duration * repeats
    if (reverse || get("PLAY_SPEED_RATE")) clip.notes.push("帧序列按正向均匀速率预览，往返与三段速率请在真机验证")
  } else if (kind === 0) {
    const type = finite(get("TYPE"))
    const scalar = type === 0 || type === 1
    if (![0, 1, 2, 3, 4].includes(type)) {
      clip.notes.push("当前变化属性不支持预览，原始参数保留")
      return clip
    }
    const pixels = type === 2 && (get("FROM_PX") !== undefined || get("TO_PX") !== undefined)
    const scale = type === 0 ? 1 / 255 : !scalar && !pixels ? 1 / 100 : 1
    const ends = (key: string): Pair => {
      const fallback: Pair = type === 3 || type === 4 ? [100, 100] : [0, 0]
      const value = scalar ? finite(get(key), type === 0 ? 255 : 0) : undefined
      const values = value === undefined ? pair(get(pixels ? `${key}_PX` : key), fallback) : [value, value]
      return [values[0] * scale, values[1] * scale]
    }
    const from = ends("FROM"), to = ends("TO")
    const curves = pair(get("INTPOL"), [finite(get("INTPOL")), finite(get("INTPOL"))])
    const pivotPoint = get("PIVOT") !== undefined ? pair(get("PIVOT"), [50, 50]) : undefined
    const pivot: Pair | undefined = pivotPoint ? [pivotPoint[0] / 100, pivotPoint[1] / 100] : undefined
    const track: Track = {
      kind: type === 0 ? "opacity" : type === 1 ? "rotate" : type === 2 ? "translate" : "scale",
      start: delay, duration, passes: repeats, alternate: reverse, hold: get("REMOVE") !== "1",
      relative: type === 2 && !pixels, pivot,
      value: (progress) => [from[0] + (to[0] - from[0]) * animationEasing(curves[0], progress), from[1] + (to[1] - from[1]) * animationEasing(curves[1], progress)],
    }
    clip.tracks.push(track)
    clip.duration = trackEnd(track)
    if (get("PIVOT_PX") !== undefined && !pivot) {
      const point = pair(get("PIVOT_PX"), [32, 32])
      track.pivot = [point[0] / 64, point[1] / 64]
    }
  } else clip.notes.push("此特殊动效暂不支持桌面播放，请在真机验证；参数仍可完整编辑")
  return clip
}
