// Press and panel animations of a native scene (Palm `ss_2`, Sogou `anim.ini`), as plain tracks the
// painter samples at any time: a track animates one property of a key layer or a sprite, and a sprite
// is an image the animation adds (Sogou's flying decorations, Palm's frame clips). Builders decode every
// image up front, so sampling is synchronous.

import type { Visual } from "./atlas.ts"
import { drawVisual, withTransform } from "./preview-draw.ts"
import type { Rect } from "./preview-items.ts"

export type Pair = readonly [number, number]

/**
 * One property over time. A pass lasts `duration` ms and maps its progress (0..1, already eased by
 * the builder) to the value; `alternate` runs every other pass backwards. Outside its passes a track
 * does nothing unless `hold` keeps its last value.
 */
export type Track = {
  kind: "opacity" | "rotate" | "translate" | "scale"
  start: number
  duration: number
  passes: number
  alternate: boolean
  hold: boolean
  value(progress: number): Pair
  /** Translation in shares of the target's size. */
  relative?: boolean
  /** Scale and rotation origin, as a share of the target's size (the centre without one). */
  pivot?: Pair
  /** Show the starting value before `start` (Android's fillBefore, as Baidu's anim.ini plays). */
  fillBefore?: boolean
}

/** Opacity 0..1, rotation in degrees, translation in scene units, pivot as a share of the target. */
type Motion = { scale?: Pair; translation?: Pair; rotation?: number; opacity?: number; pivot?: Pair }

/** An image an animation draws over the keys, with its own motion. `slot` pairs a press clip with the show clip it replaces. */
export type SceneSprite = { visual: Visual; rect: Rect; motion?: Motion; slot?: number }

/** A key's motion `elapsed` ms into its press: its background, each foreground group, the sprites it throws. */
export type KeyMotion = { back?: Motion; fore: Array<Motion | undefined>; sprites: SceneSprite[] }

type PressState = { section: string; elapsed: number; seed: number }

export type SceneEffects = {
  /** How long pressing `section` animates, in ms (0: not at all). */
  pressDuration(section: string, seed: number): number
  press(section: string, elapsed: number, seed: number): KeyMotion
  /** Sprites over the panel `elapsed` ms after it showed, with `press` running; none without it. */
  panel?(elapsed: number, press?: PressState): SceneSprite[]
}

export function trackEnd(track: Track): number {
  return track.start + track.duration * track.passes
}

function trackValue(track: Track, elapsed: number): Pair | undefined {
  const local = elapsed - track.start
  if (local < 0) return track.fillBefore ? track.value(0) : undefined
  if (local >= track.duration * track.passes) {
    if (!track.hold) return
    return track.value(track.alternate && track.passes % 2 === 0 ? 0 : 1)
  }
  if (track.duration <= 0) return track.value(1)
  const pass = Math.floor(local / track.duration)
  const progress = (local - pass * track.duration) / track.duration
  return track.value(track.alternate && pass % 2 === 1 ? 1 - progress : progress)
}

/** All running tracks combined: scales and opacities multiply, translations and rotations add. */
export function motionAt(tracks: readonly Track[], elapsed: number, size: { width: number; height: number }): Motion | undefined {
  let motion: Motion | undefined
  for (const track of tracks) {
    const value = trackValue(track, elapsed)
    if (!value) continue
    motion ??= {}
    if (track.kind === "scale") motion.scale = [(motion.scale?.[0] ?? 1) * value[0], (motion.scale?.[1] ?? 1) * value[1]]
    else if (track.kind === "opacity") motion.opacity = (motion.opacity ?? 1) * value[0]
    else if (track.kind === "rotate") motion.rotation = (motion.rotation ?? 0) + value[0]
    else {
      const [x, y] = track.relative ? [value[0] * size.width, value[1] * size.height] : value
      motion.translation = [(motion.translation?.[0] ?? 0) + x, (motion.translation?.[1] ?? 0) + y]
    }
    if (track.pivot && (track.kind === "scale" || track.kind === "rotate")) motion.pivot ??= track.pivot
  }
  return motion
}

/** Draws `draw` moved by `motion` around `rect` (its pivot a share of `rect`). */
export function withMotion(context: CanvasRenderingContext2D, rect: Rect, motion: Motion | undefined, draw: () => void): void {
  const pivot = motion?.pivot && [rect.x + motion.pivot[0] * rect.width, rect.y + motion.pivot[1] * rect.height] as const
  withTransform(context, rect, motion?.scale, motion?.translation, motion?.rotation, motion?.opacity, draw, pivot)
}

export function drawSprite(context: CanvasRenderingContext2D, sprite: SceneSprite): void {
  withMotion(context, sprite.rect, sprite.motion, () => drawVisual(context, sprite.visual, sprite.rect, true))
}

/** Android's interpolators by Sogou's INTERPOLATOR code (`f0`: 1 accelerate … 8 its own cubic Bézier). */
export function androidInterpolation(code: number, progress: number): number {
  const p = progress
  if (code === 1) return p * p
  if (code === 2) return 1 - (1 - p) * (1 - p)
  if (code === 3) return Math.cos((p + 1) * Math.PI) / 2 + 0.5
  if (code === 4) return p * p * (3 * p - 2)
  if (code === 5) {
    const tension = 3
    return p < 0.5
      ? 0.5 * (2 * p) ** 2 * ((tension + 1) * 2 * p - tension)
      : 0.5 * ((2 * p - 2) ** 2 * ((tension + 1) * (2 * p - 2) + tension) + 2)
  }
  if (code === 6) {
    const bounce = (value: number) => value * value * 8
    const value = p * 1.1226
    if (value < 0.3535) return bounce(value)
    if (value < 0.7408) return bounce(value - 0.54719) + 0.7
    if (value < 0.9644) return bounce(value - 0.8526) + 0.9
    return bounce(value - 1.0435) + 0.95
  }
  if (code === 7) return (p - 1) ** 2 * (3 * (p - 1) + 2) + 1
  if (code === 8) return cubicBezier(0.32, 0.61, 0.6, 1, p)
  return p
}

function cubicBezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  const curve = (t: number, a: number, b: number) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3
  let low = 0
  let high = 1
  for (let step = 0; step < 24; step++) {
    const middle = (low + high) / 2
    if (curve(middle, x1, x2) < x) low = middle
    else high = middle
  }
  return curve((low + high) / 2, y1, y2)
}

/** A seeded share in 0..1, so one press always picks the same random choices. */
export function seededShare(seed: number, salt: number): number {
  const value = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453
  return value - Math.floor(value)
}

export type Frame = { visual: Visual; duration: number }

// Decoded once per file: a press refreshes the preview, which must not decode its clips again.
const decoded = new WeakMap<Uint8Array, Promise<Frame[]>>()

/** The frames of an animated image (WebP, GIF); a still image, or a browser without ImageDecoder, gives one. */
export function decodeFrames(bytes: Uint8Array, type: string): Promise<Frame[]> {
  let frames = decoded.get(bytes)
  if (!frames) decoded.set(bytes, frames = decode(bytes, type))
  return frames
}

async function decode(bytes: Uint8Array, type: string): Promise<Frame[]> {
  if (typeof ImageDecoder !== "undefined") {
    try {
      const decoder = new ImageDecoder({ data: bytes, type })
      await decoder.tracks.ready
      const count = decoder.tracks.selectedTrack?.frameCount ?? 1
      const frames: Frame[] = []
      for (let index = 0; index < count; index++) {
        const { image } = await decoder.decode({ frameIndex: index })
        const bitmap = await createImageBitmap(image)
        frames.push({ visual: { image: bitmap, source: [0, 0, bitmap.width, bitmap.height] }, duration: Math.max(1, (image.duration ?? 100_000) / 1000) })
        image.close()
      }
      decoder.close()
      if (frames.length) return frames
    } catch {
      // Fall back to the first frame below.
    }
  }
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type })).catch(() => undefined)
  return bitmap ? [{ visual: { image: bitmap, source: [0, 0, bitmap.width, bitmap.height] }, duration: 100 }] : []
}

/** The frame showing `elapsed` ms into `passes` plays of `frames`; none before or after them. */
export function frameAt(frames: readonly Frame[], elapsed: number, passes: number): Visual | undefined {
  const total = frames.reduce((sum, frame) => sum + frame.duration, 0)
  if (elapsed < 0 || !frames.length) return
  if (elapsed >= total * passes) return
  let local = total > 0 ? elapsed % total : 0
  for (const frame of frames) {
    if (local < frame.duration) return frame.visual
    local -= frame.duration
  }
  return frames[frames.length - 1].visual
}
