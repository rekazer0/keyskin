/*
 * 旧版 anim.ini 检查器顶部的示意预览：用 canvas 按动画的时间轴画一个几何示意（不接键盘画布）。
 * 纯前端渲染，几何计算在 src/legacy-animation.ts；键盘画布上的粒子预览仍由检查器里的按钮驱动。
 */
import { element } from "./dom-element.ts"
import { legacyParticleFrames, parseLegacyParticleEmitter } from "./preview-animation.ts"
import {
  legacyAnimationKindLabel,
  legacyAnimationPreviewState,
  legacyAnimationTimeline,
  parseLegacyAnimationFile,
  type LegacyAnimationDocument,
  type LegacyAnimationEntry,
} from "./legacy-animation.ts"
import { appState } from "./app/state"

/* —— 顶部示意预览：canvas 画几何变换，不接键盘画布 —— */
function entryIndex(model: LegacyAnimationDocument): Map<string, LegacyAnimationEntry> {
  return new Map(model.entries.flatMap((entry) => entry.index === undefined ? [] : [[String(entry.index), entry] as const]))
}

const PREVIEW_WIDTH = 320
const PREVIEW_HEIGHT = 128

function tokenColor(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  context.beginPath()
  context.moveTo(x + radius, y)
  context.arcTo(x + width, y, x + width, y + height, radius)
  context.arcTo(x + width, y + height, x, y + height, radius)
  context.arcTo(x, y + height, x, y, radius)
  context.arcTo(x, y, x + width, y, radius)
  context.closePath()
}

export function legacyAnimationPreviewBlock(model: LegacyAnimationDocument, byIndex: ReadonlyMap<string, LegacyAnimationEntry>): {
  element: HTMLElement
  refresh: () => void
} {
  const root = element("div", "legacy-animation-preview")
  const canvas = element("canvas", "legacy-animation-preview-canvas")
  canvas.width = PREVIEW_WIDTH
  canvas.height = PREVIEW_HEIGHT
  const controls = element("div", "legacy-animation-preview-controls")
  const selectWrap = element("span", "ui-input ui-select")
  const select = element("select")
  select.setAttribute("aria-label", "选择要预览的动效")
  const playButton = element("button", "ui-button")
  playButton.type = "button"
  playButton.dataset.variant = "quiet"
  playButton.dataset.size = "sm"
  const time = element("span", "legacy-animation-preview-time")
  controls.append(selectWrap, playButton, time)
  selectWrap.append(select)
  root.append(canvas, controls)

  let currentModel = model
  let currentIndex = byIndex
  let entry: LegacyAnimationEntry | undefined = currentModel.entries[0]
  let emitter = particleEmitterFor(entry)
  let playing = false
  let started = 0
  let request = 0

  const colors = {
    shape: tokenColor("--accent-soft"),
    stroke: tokenColor("--accent"),
    text: tokenColor("--tertiary"),
    track: tokenColor("--line-soft"),
  }
  const context = canvas.getContext("2d")

  const fillOptions = () => {
    select.replaceChildren(...currentModel.entries.map((item) => new Option(
      `${item.section} · ${legacyAnimationKindLabel(item.kind)}`,
      item.section,
    )))
    select.value = entry?.section ?? ""
  }

  const drawLabel = (text: string) => {
    if (!context) return
    context.fillStyle = colors.text
    context.font = `${tokenColor("--font-size-xs") || "11px"} ${tokenColor("--font-ui") || "sans-serif"}`
    context.textAlign = "center"
    context.textBaseline = "middle"
    context.fillText(text, canvas.width / 2, canvas.height / 2)
  }

  const drawSource = (opacity: number, scale: readonly [number, number], translate: readonly [number, number], rotation: number) => {
    if (!context) return
    context.save()
    context.globalAlpha = Math.max(0, Math.min(1, opacity))
    context.translate(canvas.width / 2 + translate[0] * 0.8, canvas.height / 2 + translate[1] * 0.8)
    context.rotate(rotation * Math.PI / 180)
    context.scale(Math.max(0.001, scale[0]), Math.max(0.001, scale[1]))
    roundedRect(context, -48, -28, 96, 56, tokenNumber("--radius-md", 8))
    context.fillStyle = colors.shape
    context.fill()
    context.lineWidth = 1.5
    context.strokeStyle = colors.stroke
    context.stroke()
    context.restore()
  }

  const drawParticles = (elapsed: number) => {
    if (!context || !emitter) return
    for (const particle of legacyParticleFrames(emitter, elapsed, canvas.width, canvas.height)) {
      context.globalAlpha = particle.opacity
      context.fillStyle = colors.stroke
      context.beginPath()
      context.arc(particle.x, particle.y, Math.max(1, 3 * particle.scale), 0, Math.PI * 2)
      context.fill()
    }
    context.globalAlpha = 1
  }

  const drawProgress = (elapsed: number, total: number | undefined) => {
    if (!context) return
    const barWidth = canvas.width - 24
    context.fillStyle = colors.track
    context.fillRect(12, canvas.height - 10, barWidth, 2)
    if (!total) return
    context.fillStyle = colors.stroke
    context.fillRect(12, canvas.height - 10, barWidth * Math.max(0, Math.min(1, elapsed / total)), 2)
  }

  const draw = (elapsed: number, total: number | undefined) => {
    if (!context) return
    context.clearRect(0, 0, canvas.width, canvas.height)
    if (!entry) {
      drawLabel("这个 anim.ini 还没有动效")
      return
    }
    if (entry.kind === "frame") {
      drawLabel("帧动效：按 gif 自身时长播放")
      return
    }
    if (entry.kind === "particle") {
      drawParticles(elapsed)
    } else {
      const state = legacyAnimationPreviewState(entry, currentIndex, elapsed)
      drawSource(state.opacity, state.scale, state.translate, state.rotation)
    }
    drawProgress(elapsed, total)
  }

  const tick = () => {
    if (!canvas.isConnected) {
      playing = false
      return
    }
    if (!entry) return
    const timeline = legacyAnimationTimeline(entry, currentIndex)
    const elapsed = performance.now() - started
    const total = Number.isFinite(timeline.total) ? timeline.total : undefined
    const shown = total === undefined
      ? elapsed % Math.max(1, timeline.duration * (timeline.reverse ? 2 : 1))
      : Math.min(elapsed, total)
    draw(shown, total)
    time.textContent = total === undefined ? `${Math.round(shown)} ms · 循环` : `${Math.round(shown)} / ${Math.round(total)} ms`
    if (total !== undefined && elapsed >= total) playing = false
    playButton.textContent = playing ? "暂停" : total !== undefined && elapsed >= total ? "再播一次" : "播放"
    if (playing) request = requestAnimationFrame(tick)
  }

  const stop = () => {
    playing = false
    cancelAnimationFrame(request)
    playButton.textContent = "播放"
  }

  const start = () => {
    cancelAnimationFrame(request)
    started = performance.now()
    playing = true
    // 预览块在 append 到检查器之前就创建，先等下一帧再画，避免 isConnected 还是 false 时直接停住。
    request = requestAnimationFrame(tick)
  }

  playButton.addEventListener("click", () => {
    if (playing) stop()
    else start()
  })
  select.addEventListener("change", () => {
    entry = currentModel.entries.find((item) => item.section === select.value) ?? currentModel.entries[0]
    emitter = particleEmitterFor(entry)
    stop()
    time.textContent = ""
    start()
  })

  fillOptions()
  draw(0, entry ? legacyAnimationTimeline(entry, currentIndex).total : undefined)
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches && entry) start()

  const refresh = () => {
    if (!appState.selectedDocument) return
    currentModel = parseLegacyAnimationFile(appState.selectedDocument.toString())
    currentIndex = entryIndex(currentModel)
    entry = currentModel.entries.find((item) => item.section === entry?.section) ?? currentModel.entries[0]
    emitter = particleEmitterFor(entry)
    fillOptions()
    const timeline = entry ? legacyAnimationTimeline(entry, currentIndex) : undefined
    stop()
    draw(0, timeline && Number.isFinite(timeline.total) ? timeline.total : undefined)
  }

  return { element: root, refresh }
}

function tokenNumber(name: string, fallback: number): number {
  const value = Number.parseFloat(tokenColor(name))
  return Number.isFinite(value) ? value : fallback
}

function particleEmitterFor(entry: LegacyAnimationEntry | undefined) {
  return entry?.kind === "particle" && appState.selectedDocument
    ? parseLegacyParticleEmitter(appState.selectedDocument, entry.section) : undefined
}

