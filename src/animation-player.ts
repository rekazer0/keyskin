import type { Visual, VisualResolver } from "./atlas.ts"
import type { PreviewClip } from "./animation-preview-model.ts"
import { element } from "./dom-element.ts"
import { createIcon } from "./icons.ts"
import { decodeFrames, frameAt, motionAt, withMotion, type Frame } from "./native-motion.ts"
import { legacyParticleFrames } from "./preview-animation.ts"
import { drawVisual } from "./preview-draw.ts"

export type AnimationPlayerOptions = {
  clip: PreviewClip
  resolver?: VisualResolver
  resourceParticles?: boolean
  readFile?: (path: string) => Uint8Array | undefined
}

/** Local playback state belongs to the generated component, never to the skin document. */
export function animationPlayer({ clip, resolver, resourceParticles, readFile }: AnimationPlayerOptions): HTMLElement {
  const root = element("div", "ui-animation-player")
  const stage = element("div", "ui-animation-stage")
  const canvas = element("canvas")
  canvas.width = 640
  canvas.height = 320
  canvas.setAttribute("aria-label", "动画播放预览")
  stage.append(canvas)
  const transport = element("div", "ui-animation-transport")
  const play = element("button", "ui-icon-button")
  const replay = element("button", "ui-icon-button")
  for (const button of [play, replay]) button.type = "button"
  replay.setAttribute("aria-label", "重新播放")
  replay.title = "重新播放"
  replay.append(createIcon("rotate-cw", 14))
  const scrub = element("input", "ui-slider")
  scrub.type = "range"
  scrub.min = "0"
  scrub.step = "1"
  scrub.value = "0"
  scrub.setAttribute("aria-label", "预览时间")
  const time = element("output", "ui-animation-time")
  const note = element("p", "ui-animation-note")
  transport.append(play, replay, scrub, time)
  root.append(stage, transport, note)
  const context = canvas.getContext("2d")!
  const visuals = new Map<string, Visual | undefined>()
  const images = new Map<PreviewClip["images"][number], Frame[]>()
  const notes = [...clip.notes]
  let duration = Math.max(0, Math.min(clip.duration, 60_000))
  let elapsed = 0
  let startedAt = 0
  let timer = 0
  let loading = true
  const hasContent = clip.tracks.length + clip.particles.length + clip.images.length > 0
  if (clip.duration > 60_000) notes.push("长动画仅预览前 60 秒")
  if (clip.tracks.length) notes.push("示例按键 · 按当前参数播放")
  const update = () => {
    const playing = !!timer
    root.dataset.playing = String(playing)
    const label = playing ? "暂停预览" : "播放预览"
    if (play.getAttribute("aria-label") !== label) {
      play.setAttribute("aria-label", label)
      play.title = label
      play.replaceChildren(createIcon(playing ? "pause" : "play", 14))
    }
    play.disabled = replay.disabled = scrub.disabled = loading || !hasContent || duration <= 0
    scrub.max = String(Math.max(1, Math.ceil(duration)))
    scrub.value = String(Math.round(elapsed))
    time.value = `${Math.round(elapsed)} / ${Math.round(duration)} ms`
    note.textContent = loading ? "正在加载预览资源…" : [...new Set(notes)].join(" · ") || (hasContent ? "拖动时间轴查看任意时刻" : "暂无可播放内容")
  }
  const rect = { x: 128, y: 48, width: 64, height: 64 }
  const draw = () => {
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.save()
    context.scale(2, 2)
    const style = getComputedStyle(root)
    const color = style.getPropertyValue("--secondary").trim()
    if (clip.tracks.length) withMotion(context, rect, motionAt(clip.tracks, elapsed, rect), () => {
      context.fillStyle = style.getPropertyValue("--control").trim()
      context.strokeStyle = color
      context.lineWidth = 1
      context.beginPath()
      context.roundRect(rect.x, rect.y, rect.width, rect.height, parseFloat(style.getPropertyValue("--radius-md")) || 0)
      context.fill()
      context.stroke()
      context.fillStyle = color
      context.font = `${style.getPropertyValue("--font-size-lg")} ${style.getPropertyValue("--font-ui")}`
      context.textAlign = "center"
      context.textBaseline = "middle"
      context.fillText("A", rect.x + rect.width / 2, rect.y + rect.height / 2)
    })
    for (const item of clip.particles) {
      if (elapsed < item.start || elapsed > item.start + item.duration) continue
      for (const particle of legacyParticleFrames(item.emitter, elapsed - item.start, 280, 120)) {
        const target = { x: 20 + particle.x - 8, y: 20 + particle.y - 8, width: 16, height: 16 }
        withMotion(context, target, { scale: [particle.scale, particle.scale], rotation: particle.rotation, opacity: particle.opacity }, () => {
          const visual = visuals.get(particle.styleID)
          if (visual) drawVisual(context, visual, target, true)
          else { context.fillStyle = color; context.fillRect(target.x, target.y, target.width, target.height) }
        })
      }
    }
    for (const item of clip.images) {
      const visual = frameAt(images.get(item) ?? [], elapsed - item.start, item.passes)
      if (!visual) continue
      const source = visual.source ?? [0, 0, visual.image?.width ?? 1, visual.image?.height ?? 1]
      const scale = Math.min(280 / source[2], 136 / source[3])
      const width = source[2] * scale, height = source[3] * scale
      drawVisual(context, visual, { x: (320 - width) / 2 + item.offset[0], y: (160 - height) / 2 + item.offset[1], width, height }, true)
    }
    context.restore()
  }
  const stop = () => {
    cancelAnimationFrame(timer)
    timer = 0
    update()
  }
  const tick = (now: number) => {
    if (!root.isConnected || !root.checkVisibility() || document.hidden) return stop()
    elapsed = Math.min(duration, now - startedAt)
    draw()
    if (elapsed >= duration) stop()
    else timer = requestAnimationFrame(tick)
    update()
  }
  const start = () => {
    if (loading || !hasContent || duration <= 0) return
    if (elapsed >= duration) elapsed = 0
    startedAt = performance.now() - elapsed
    timer = requestAnimationFrame(tick)
    update()
  }
  play.addEventListener("click", () => { if (timer) stop(); else start() })
  replay.addEventListener("click", () => { stop(); elapsed = 0; draw(); start() })
  scrub.addEventListener("input", () => { const value = Number(scrub.value); stop(); elapsed = value; draw(); update() })
  update()
  queueMicrotask(() => { if (root.isConnected) draw() })
  const load = async () => {
    const ids = [...new Set(clip.particles.flatMap(({ emitter }) => emitter.images))]
    await Promise.all(ids.map(async (id) => {
      const visual = await (resourceParticles ? resolver?.resolveResource?.(id) : resolver?.resolve(id, false))?.catch(() => undefined)
      visuals.set(id, visual)
      if (!visual) notes.push(`图片 ${id} 未找到，使用占位方块`)
    }))
    await Promise.all(clip.images.map(async (item) => {
      let frames: Frame[] = []
      if (item.resources) {
        for (const resource of item.resources) {
          const visual = await resolver?.resolveResource?.(resource.id).catch(() => undefined)
          if (visual) frames.push({ visual, duration: resource.duration })
          else notes.push(`帧资源 ${resource.id || "（空）"} 未找到`)
        }
      } else {
        const bytes = item.file && readFile?.(item.file)
        if (bytes) frames = await decodeFrames(bytes, /\.gif$/i.test(item.file!) ? "image/gif" : /\.png$/i.test(item.file!) ? "image/png" : "image/webp")
        if (!frames.length) notes.push(`图片序列 ${item.file || "（未配置）"} 无法加载`)
      }
      const total = frames.reduce((sum, frame) => sum + frame.duration, 0)
      if (item.duration > 0 && total > 0) frames = frames.map((frame) => ({ ...frame, duration: frame.duration * item.duration / total }))
      images.set(item, frames)
      if (!item.duration) duration = Math.max(duration, Math.min(60_000, item.start + total * item.passes))
    }))
    loading = false
    if (root.isConnected) { draw(); update() }
  }
  void load().catch(() => {
    loading = false
    notes.push("预览资源加载失败，请检查资源引用")
    if (root.isConnected) update()
  })
  return root
}
