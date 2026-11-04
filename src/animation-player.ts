import type { Visual, VisualResolver } from "./atlas.ts"
import { PREVIEW_KEY_SIZE, iniPreviewClip, type PreviewClip } from "./animation-preview-model.ts"
import { IniDocument } from "./ini.ts"
import { animationDirectControls, type AnimationDirectEdit } from "./animation-direct-controls.ts"
import { element, iconButton } from "./dom-element.ts"
import { createIcon } from "./icons.ts"
import { decodeFrames, frameAt, motionAt, withMotion, type Frame, type Track } from "./native-motion.ts"
import { legacyParticleFrames } from "./preview-animation.ts"
import { drawVisual } from "./preview-draw.ts"
import type { Rect } from "./preview-items.ts"
import { releaseOnRemove } from "./dom-lifecycle.ts"

export type AnimationPlayerOptions = {
  clip: PreviewClip
  /** Names the animation across re-renders: an edit rebuilds the player under the same key. */
  key: string
  resolver?: VisualResolver
  /** Particle images are resource IDs (BDA) rather than style IDs. */
  resourceParticles?: boolean
  readFile?: (path: string) => Uint8Array | undefined
  keyboard?: KeyboardPlayback
  /** A card-sized player: no transport, loops while visible, one frame every 30 ms. */ thumbnail?: boolean | "slow"
  direct?: AnimationDirectEdit
  sample?: () => Promise<{ width: number; height: number; trial: boolean; layers: Array<{ visual: Visual; animate: boolean }> } | undefined>
}

/** The keyboard canvas beside the player. */
export type KeyboardPlayback = {
  /** Called whenever playback starts from the beginning, to play the same animation on a key. */
  play(): void
  /** Called on every draw at the player's time: particles also go on the keyboard. */
  particles(particles: PreviewClip["particles"], elapsed: number): void
}

/**
 * Preview preferences shared by every player, and the animation that keeps looping while its
 * parameters are edited. Never part of the skin document or the undo history.
 */
const session = { loop: false, slow: false, looping: "" }
const SLOW_RATE = 0.25
const MAX_DURATION = 60_000
// Stage units: the canvas is drawn at RESOLUTION times this size, sharp on the large canvas-area stage too.
const STAGE = { width: 320, height: 160 }
const RESOLUTION = 4
const KEY: Rect = { x: 128, y: 48, width: 64, height: 64 }
/** Device pixels (pixel translations, particle speeds and images) to stage units. */
const PIXEL = KEY.width / PREVIEW_KEY_SIZE
const SAMPLES = 48

/** Pixel translations are in device pixels; relative ones already scale with the sample key. */
function stageTracks(tracks: readonly Track[]): Track[] {
  return tracks.map((track) => track.kind === "translate" && !track.relative
    ? { ...track, value: (progress) => { const [x, y] = track.value(progress); return [x * PIXEL, y * PIXEL] } }
    : track)
}

/** Local playback state belongs to the generated component, never to the skin document. */
export function animationPlayer({ clip, key, resolver, resourceParticles, readFile, keyboard, thumbnail = false, direct, sample }: AnimationPlayerOptions): HTMLElement {
  const root = element("div", "ui-animation-player")
  if (thumbnail) root.dataset.variant = "thumbnail"
  const stage = element("div", "ui-animation-stage")
  const canvas = element("canvas")
  const resolution = thumbnail ? 1 : RESOLUTION
  canvas.width = STAGE.width * resolution
  canvas.height = STAGE.height * resolution
  canvas.setAttribute("aria-label", "动画播放预览")
  const emptyState = element("p", "ui-empty")
  stage.append(canvas, emptyState)
  const timeline = element("div", "ui-animation-timeline")
  const lanes = element("div", "ui-animation-lanes")
  const playhead = element("span", "ui-animation-playhead")
  const scrub = element("input", "ui-slider")
  scrub.type = "range"
  scrub.min = "0"
  scrub.step = "1"
  scrub.value = "0"
  scrub.setAttribute("aria-label", "预览时间")
  timeline.append(lanes, scrub)
  const transport = element("div", "ui-animation-transport")
  const play = iconButton("play", "播放预览")
  const replay = iconButton("skip-back", "重新播放")
  const time = element("output", "ui-animation-time")
  const loop = iconButton("repeat", "循环预览")
  const slow = iconButton("snail", "慢放 ¼×")
  transport.append(play, replay, time, loop, slow)
  const note = element("p", "ui-animation-note")
  // 时间轴、走带与说明作为一组，横排时整组在舞台旁边纵向居中
  const panel = element("div", "ui-animation-controls")
  panel.append(timeline, transport, note)
  root.append(stage, panel)

  const context = canvas.getContext("2d")!
  let tracks = stageTracks(clip.tracks)
  let sampleLayers: Array<{ visual: Visual; animate: boolean }> = []
  const keyRect = { ...KEY }
  const visuals = new Map<string, Visual | undefined>()
  const images = new Map<string, Frame[]>()
  const imageKey = (item: PreviewClip["images"][number]) => item.file ?? JSON.stringify(item.resources)
  const notes = [...clip.notes]
  let duration = Math.max(0, Math.min(clip.duration, MAX_DURATION))
  let elapsed = 0
  let startedAt = 0
  let timer = 0
  let lastFrame = -Infinity
  let thumbnailVisible = false
  let disposed = false
  let thumbnailObserver: IntersectionObserver | undefined
  let thumbnailResize: ResizeObserver | undefined
  const thumbnailEvents = new AbortController()
  let loading = true
  let fit = 1
  const hasContent = tracks.length + clip.particles.length + clip.images.length > 0
  let controls: ReturnType<typeof animationDirectControls> | undefined
  const timelineExtent = direct ? Math.max(400, duration * 1.5) : duration
  /** Every particle position sampled over the whole clip: the stage shows the trajectories even while paused. */
  const trails: [number, number][] = []
  const resume = !thumbnail && session.loop && session.looping === key
  if (!thumbnail && session.looping !== key) session.looping = ""
  if (clip.duration > MAX_DURATION) notes.push("长动画只预览前 60 秒")
  if (tracks.length && !sample) notes.push("示例按键")
  // Every surface plays a clip at real speed; only a full player's 慢放 switches slows playback down.
  const rate = () => !thumbnail && session.slow ? SLOW_RATE : 1

  /* —— timeline —— */
  const renderLanes = () => {
    for (const child of [...lanes.children]) if (child !== playhead && !child.classList.contains("ui-animation-handle")) child.remove()
    lanes.hidden = !clip.lanes.length || duration <= 0
    for (const lane of clip.lanes) {
      const row = element("div", "ui-animation-lane")
      row.toggleAttribute("data-unbounded", Boolean(lane.unbounded))
      const bar = element("span", "ui-animation-bar")
      const extent = direct ? timelineExtent : duration
      const start = Math.min(1, lane.start / extent)
      bar.style.left = `${start * 100}%`
      bar.style.width = `${Math.max(0, Math.min(1 - start, lane.duration * lane.passes / extent)) * 100}%`
      if (lane.passes > 1 && lane.passes <= 24) bar.append(...Array.from({ length: lane.passes }, () => element("i")))
      const label = element("span")
      label.textContent = lane.unbounded ? `${lane.label} · 循环` : lane.label
      bar.append(label)
      bar.title = `${lane.label} · ${Math.round(lane.start)} ms 起，${Math.round(lane.duration)} ms${lane.passes > 1 ? ` × ${lane.passes}` : ""}`
      row.append(bar)
      lanes.append(row)
    }
    lanes.append(playhead)
  }

  const update = () => {
    const playing = Boolean(timer)
    root.dataset.playing = String(playing)
    const label = playing ? "暂停预览" : "播放预览"
    if (play.getAttribute("aria-label") !== label) {
      play.setAttribute("aria-label", label)
      play.title = label
      play.replaceChildren(createIcon(playing ? "pause" : "play", 14))
    }
    loop.setAttribute("aria-pressed", String(session.loop))
    slow.setAttribute("aria-pressed", String(session.slow))
    play.disabled = replay.disabled = scrub.disabled = loading || !hasContent || duration <= 0
    scrub.max = String(Math.max(1, Math.ceil(duration)))
    scrub.value = String(Math.round(elapsed))
    playhead.style.left = `${duration > 0 ? Math.min(1, elapsed / (direct ? timelineExtent : duration)) * 100 : 0}%`
    time.value = `${Math.round(elapsed)} / ${Math.round(duration)} ms`
    const text = [...new Set(notes)]
    emptyState.hidden = hasContent
    emptyState.textContent = loading ? "" : text[0] ?? "暂无可播放的内容"
    emptyState.setAttribute("aria-busy", String(loading))
    const noteText = loading ? "" : hasContent ? text.join(" · ") : text.slice(1).join(" · ")
    note.hidden = !noteText
    note.replaceChildren(createIcon("info", 14), noteText)
  }

  /* —— stage —— */
  /** A particle at its image's own size in device pixels; missing images get a small dot. */
  const particleSize = (styleID: string, scale: number): [number, number] => {
    const source = visuals.get(styleID)?.source ?? [0, 0, 24, 24]
    return [Math.max(2, source[2] * PIXEL * scale), Math.max(2, source[3] * PIXEL * scale)]
  }
  const particleFrames = (item: PreviewClip["particles"][number], at: number) =>
    legacyParticleFrames(item.emitter, at - item.start, PREVIEW_KEY_SIZE, PREVIEW_KEY_SIZE)
  const imageRect = (item: PreviewClip["images"][number], visual: Visual): Rect => {
    const source = visual.source ?? [0, 0, visual.image?.width ?? 1, visual.image?.height ?? 1]
    const scale = Math.min((STAGE.width - 40) / source[2], (STAGE.height - 24) / source[3])
    const width = source[2] * scale, height = source[3] * scale
    return { x: (STAGE.width - width) / 2 + item.offset[0] * PIXEL, y: (STAGE.height - height) / 2 + item.offset[1] * PIXEL, width, height }
  }
  /** Zooms out until the key's whole path and every particle stay on the stage. */
  const measure = () => {
    trails.length = 0
    let [left, top, right, bottom] = [keyRect.x, keyRect.y, keyRect.x + keyRect.width, keyRect.y + keyRect.height]
    const include = (x: number, y: number) => {
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y)
    }
    for (let step = 0; step <= SAMPLES; step++) {
      const at = duration * step / SAMPLES
      const motion = tracks.length ? motionAt(tracks, at, keyRect) : undefined
      if (motion) {
        const [cx, cy] = motion.pivot ? [keyRect.x + motion.pivot[0] * keyRect.width, keyRect.y + motion.pivot[1] * keyRect.height] : [keyRect.x + keyRect.width / 2, keyRect.y + keyRect.height / 2]
        const matrix = new DOMMatrix()
          .translate(motion.translation?.[0] ?? 0, motion.translation?.[1] ?? 0)
          .translate(cx, cy).rotate(motion.rotation ?? 0).scale(motion.scale?.[0] ?? 1, motion.scale?.[1] ?? 1).translate(-cx, -cy)
        for (const [x, y] of [[keyRect.x, keyRect.y], [keyRect.x + keyRect.width, keyRect.y], [keyRect.x, keyRect.y + keyRect.height], [keyRect.x + keyRect.width, keyRect.y + keyRect.height]]) {
          const point = matrix.transformPoint(new DOMPoint(x, y))
          include(point.x, point.y)
        }
      }
      for (const item of clip.particles) {
        for (const particle of particleFrames(item, at)) {
          const [width, height] = particleSize(particle.styleID, particle.scale)
          trails.push([KEY.x + particle.x * PIXEL, KEY.y + particle.y * PIXEL])
          include(KEY.x + particle.x * PIXEL - width / 2, KEY.y + particle.y * PIXEL - height / 2)
          include(KEY.x + particle.x * PIXEL + width / 2, KEY.y + particle.y * PIXEL + height / 2)
        }
      }
    }
    const margin = 12
    const reach = Math.max(
      (STAGE.width / 2 - left) / (STAGE.width / 2 - margin), (right - STAGE.width / 2) / (STAGE.width / 2 - margin),
      (STAGE.height / 2 - top) / (STAGE.height / 2 - margin), (bottom - STAGE.height / 2) / (STAGE.height / 2 - margin),
    )
    // Only thumbnails zoom in: retain real sampling coordinates and the full editor's handle geometry.
    const maxFit = thumbnail && !clip.images.length ? 1.75 : 1
    fit = Number.isFinite(reach) && reach > 0 ? Math.min(maxFit, 1 / reach) : 1
    if (fit < 1) notes.push(`舞台缩放 ${Math.round(fit * 100)}%`)
  }

  const draw = () => {
    const style = getComputedStyle(root)
    const token = (name: string) => style.getPropertyValue(name).trim()
    context.setTransform(resolution, 0, 0, resolution, 0, 0)
    context.clearRect(0, 0, STAGE.width, STAGE.height)
    context.translate(STAGE.width / 2, STAGE.height / 2)
    context.scale(fit, fit)
    context.translate(-STAGE.width / 2, -STAGE.height / 2)
    const radius = parseFloat(token("--radius-md")) || 0
    const outline = (rect: Rect, color: string) => {
      context.save()
      context.setLineDash([3, 3])
      context.strokeStyle = color
      context.lineWidth = 1 / fit
      context.beginPath()
      context.roundRect(rect.x, rect.y, rect.width, rect.height, radius)
      context.stroke()
      context.restore()
    }
    if (tracks.length || clip.particles.length) outline(keyRect, token("--line-strong"))
    if (trails.length) {
      context.save()
      context.fillStyle = token("--accent")
      context.globalAlpha = 0.3
      context.beginPath()
      for (const [x, y] of trails) {
        context.moveTo(x + 1 / fit, y)
        context.arc(x, y, 1 / fit, 0, Math.PI * 2)
      }
      context.fill()
      context.restore()
    }
    if (sampleLayers.length) {
      for (const layer of sampleLayers) withMotion(context, keyRect, layer.animate ? motionAt(tracks, elapsed, keyRect) : undefined, () => drawVisual(context, layer.visual, keyRect, true))
    } else if (tracks.length) withMotion(context, keyRect, motionAt(tracks, elapsed, keyRect), () => {
      context.fillStyle = token("--control")
      context.strokeStyle = token("--line-strong")
      context.lineWidth = 1
      context.beginPath()
      context.roundRect(KEY.x, KEY.y, KEY.width, KEY.height, radius)
      context.fill()
      context.stroke()
      context.fillStyle = token("--text")
      context.font = `${token("--font-size-lg")} ${token("--font-ui")}`
      context.textAlign = "center"
      context.textBaseline = "middle"
      context.fillText("A", KEY.x + KEY.width / 2, KEY.y + KEY.height / 2)
    })
    if (keyboard && clip.particles.length) keyboard.particles(clip.particles, elapsed)
    if (direct && clip.particles.length) {
      const directions = clip.particles[0].emitter.velocityDirection
      if (directions) {
        context.save(); context.strokeStyle = token("--accent"); context.fillStyle = token("--accent-soft")
        context.beginPath(); context.moveTo(160, 80)
        context.arc(160, 80, 60, directions[0] * Math.PI / 180, directions[1] * Math.PI / 180)
        context.closePath(); context.fill(); context.stroke(); context.restore()
      }
    }
    for (const item of clip.particles) {
      // EMIT_REGION's coordinate basis varies by platform; never draw it as a validated width/height box here.
      if (elapsed < item.start || elapsed > item.start + item.duration) continue
      for (const particle of particleFrames(item, elapsed)) {
        const [width, height] = particleSize(particle.styleID, particle.scale)
        const target = { x: KEY.x + particle.x * PIXEL - width / 2, y: KEY.y + particle.y * PIXEL - height / 2, width, height }
        withMotion(context, target, { rotation: particle.rotation, opacity: particle.opacity }, () => {
          const visual = visuals.get(particle.styleID)
          if (visual) drawVisual(context, visual, target, true)
          else {
            context.fillStyle = token("--tertiary")
            context.beginPath()
            context.arc(target.x + width / 2, target.y + height / 2, Math.min(width, height) / 4, 0, Math.PI * 2)
            context.fill()
          }
        })
      }
    }
    for (const item of clip.images) {
      const frames = images.get(imageKey(item)) ?? []
      const total = frames.reduce((sum, frame) => sum + frame.duration, 0)
      const at = (elapsed - item.start) * (item.duration > 0 && total > 0 ? total / item.duration : 1)
      const visual = frameAt(frames, at, item.passes)
      if (visual) drawVisual(context, visual, imageRect(item, visual), true)
    }
  }

  /* —— transport —— */
  const stop = (keepLooping = false) => {
    cancelAnimationFrame(timer)
    timer = 0
    if (!thumbnail && !keepLooping && session.looping === key) session.looping = ""
    update()
  }
  const tick = (now: number) => {
    // An edit rebuilds the inspector: the replacement player under the same key keeps looping.
    if (!root.isConnected) return stop(true)
    if (!root.checkVisibility() || document.hidden || thumbnail && !thumbnailVisible) return stop()
    // A card draws 30 times a second; a full player draws every frame.
    if (thumbnail && now - lastFrame < 1000 / 30) { timer = requestAnimationFrame(tick); return }
    lastFrame = now
    elapsed = (now - startedAt) * rate()
    if (elapsed >= duration && (thumbnail || session.loop)) {
      // Carry the overshoot into the next round: a clip shorter than one drawn frame keeps its own period.
      elapsed = duration > 0 ? elapsed % duration : 0
      startedAt = now - elapsed / rate()
      keyboard?.play()
    }
    elapsed = Math.min(duration, elapsed)
    draw()
    if (elapsed >= duration) stop()
    else {
      timer = requestAnimationFrame(tick)
      if (!thumbnail) update()
    }
  }
  const start = () => {
    if (disposed || loading || !hasContent || duration <= 0) return
    if (elapsed >= duration) elapsed = 0
    if (elapsed === 0) keyboard?.play()
    startedAt = performance.now() - elapsed / rate()
    cancelAnimationFrame(timer)
    timer = requestAnimationFrame(tick)
    if (!thumbnail && session.loop) session.looping = key
    update()
  }
  const seek = (value: number) => {
    stop()
    elapsed = Math.max(0, Math.min(duration, value))
    draw()
    update()
  }
  play.addEventListener("click", () => { if (timer) stop(); else start() })
  replay.addEventListener("click", () => { stop(); elapsed = 0; draw(); start() })
  loop.addEventListener("click", () => {
    session.loop = !session.loop
    session.looping = session.loop && timer ? key : ""
    update()
  })
  slow.addEventListener("click", () => {
    session.slow = !session.slow
    // Keep the playhead where it is; only the speed after it changes.
    startedAt = performance.now() - elapsed / rate()
    update()
  })
  scrub.addEventListener("input", () => seek(Number(scrub.value)))
  // The lanes scrub too: press anywhere on the timeline and drag.
  const scrubTo = (event: PointerEvent) => {
    const box = lanes.getBoundingClientRect()
    if (box.width > 0) seek((event.clientX - box.left) / box.width * (direct ? timelineExtent : duration))
  }
  lanes.addEventListener("pointerdown", (event) => {
    if (scrub.disabled) return
    lanes.setPointerCapture(event.pointerId)
    scrubTo(event)
  })
  lanes.addEventListener("pointermove", (event) => { if (lanes.hasPointerCapture(event.pointerId)) scrubTo(event) })

  if (thumbnail) {
    const syncThumbnail = () => {
      if (disposed || !root.isConnected) return
      if (thumbnailVisible && !document.hidden) { ensureLoaded(); start() }
      else stop()
    }
    thumbnailObserver = new IntersectionObserver(entries => {
      thumbnailVisible = Boolean(entries[0]?.isIntersecting)
      syncThumbnail()
    })
    requestAnimationFrame(() => {
      if (disposed || !root.isConnected) return
      thumbnailObserver?.observe(root)
      // 样式卡片是 content-visibility: auto：卡片滚进视口、内容重新布局时 Chromium 不补发相交通知，
      // 尺寸一变就重新观察，拿一次新的初始通知（与 style-card.ts 的 lazyDraw 同一做法）。
      thumbnailResize = new ResizeObserver(() => { thumbnailObserver?.unobserve(root); thumbnailObserver?.observe(root) })
      thumbnailResize.observe(root)
    })
    document.addEventListener("visibilitychange", syncThumbnail, { signal: thumbnailEvents.signal })
    timeline.inert = transport.inert = true
  }
  releaseOnRemove(root, () => {
    disposed = true
    stop(true)
    thumbnailObserver?.disconnect()
    thumbnailResize?.disconnect()
    thumbnailEvents.abort()
    visuals.clear()
    images.clear()
    sampleLayers = []
    for (const bitmap of root.querySelectorAll("canvas")) bitmap.width = bitmap.height = 0
  })
  if (direct && !thumbnail) controls = animationDirectControls(direct, {
    stage, timeline, lanes, key: keyRect, fit: () => fit, duration: () => duration, stop: () => stop(true),
    preview(text, at) {
      clip = iniPreviewClip(IniDocument.parse(text), direct.section, { fillBefore: true })
      tracks = stageTracks(clip.tracks)
      duration = Math.max(0, Math.min(clip.duration, MAX_DURATION))
      elapsed = Math.max(0, Math.min(duration, at))
      const originalFit = fit
      measure(); fit = originalFit
      renderLanes(); draw(); update()
    },
  })
  renderLanes()
  update()
  queueMicrotask(() => { if (root.isConnected) draw() })
  const load = async () => {
    const artwork = await sample?.()
    if (disposed) return
    if (artwork) {
      sampleLayers = artwork.layers
      const ratio = Math.min(64 / artwork.width, 88 / artwork.height)
      keyRect.width = artwork.width * ratio; keyRect.height = artwork.height * ratio
      keyRect.x = 160 - keyRect.width / 2; keyRect.y = 80 - keyRect.height / 2
      root.dataset.sample = "skin"
      if (artwork.trial) notes.push("当前按键未绑定此动画，舞台为临时试放")
    }
    const ids = [...new Set(clip.particles.flatMap(({ emitter }) => emitter.images))]
    await Promise.all(ids.map(async (id) => {
      const visual = await (resourceParticles ? resolver?.resolveResource?.(id) : resolver?.resolve(id, false))?.catch(() => undefined)
      if (disposed) return
      visuals.set(id, visual)
      if (!visual) notes.push(`粒子图片 ${id} 未找到，用圆点标出轨迹`)
    }))
    await Promise.all(clip.images.map(async (item) => {
      let frames: Frame[] = []
      if (item.resources) {
        for (const resource of item.resources) {
          const visual = resource.id ? await resolver?.resolveResource?.(resource.id).catch(() => undefined) : undefined
          if (visual) frames.push({ visual, duration: resource.duration })
          else notes.push(`帧资源 ${resource.id || "（空）"} 未找到`)
        }
      } else {
        const bytes = item.file ? readFile?.(item.file) : undefined
        if (bytes) frames = await decodeFrames(bytes, /\.gif$/i.test(item.file!) ? "image/gif" : /\.png$/i.test(item.file!) ? "image/png" : "image/webp")
        if (!frames.length) notes.push(`图片序列 ${item.file || "未设置"} 无法加载`)
      }
      const total = frames.reduce((sum, frame) => sum + frame.duration, 0)
      if (disposed) return
      images.set(imageKey(item), frames)
      // GIF frame clips play at the file's own timing; the lane learns its length here.
      if (!item.duration && total > 0) {
        duration = Math.max(duration, Math.min(MAX_DURATION, item.start + total * item.passes))
        for (const lane of clip.lanes) if (lane.start === item.start && !lane.duration) lane.duration = total
      }
    }))
    if (disposed) return
    measure()
    loading = false
    if (!root.isConnected) return
    renderLanes()
    draw()
    update()
    controls?.sync()
    if (resume || thumbnail && thumbnailVisible && !document.hidden) start()
  }
  let loadStarted = false
  const ensureLoaded = () => {
    if (loadStarted) return
    loadStarted = true
    void load().catch(() => {
      loading = false
      notes.push("预览资源加载失败，请检查资源引用")
      if (root.isConnected) update()
    })
  }
  if (!thumbnail) ensureLoaded()
  return root
}
