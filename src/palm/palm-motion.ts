// A Palm board's press and panel animations, read from `skin.json`: styles (`ss_1`) name their press
// (`s_5` "1") and show (`s_5` "3") animation, `ss_2` holds them. `a1` animates one property of a key
// layer, `a3` combines animations (at once, one after another, or one at random), `af2` plays an
// animated image over the panel. A key's background follows `base_ba`, each foreground its `base_fa`
// entry (`asi` stands in for both), and `base_pa` names the panel animation a press plays; the board's
// own `base_pa` shows with it and plays on presses of keys without one.

import { animationEasing } from "../preview-animation.ts"
import { decodeFrames, frameAt, motionAt, seededShare, trackEnd, type Frame, type KeyMotion, type Pair, type SceneEffects, type SceneSprite, type Track } from "../native-motion.ts"
import type { Rect } from "../preview-items.ts"
import { list, type PalmBoard, type PalmKey, type PalmOrientation, type PalmTheme } from "./palm-board.ts"
import type { PalmStyles } from "./palm-styles.ts"
import { asObject, type Json, type JsonObject } from "./sxi-ini.ts"

type FrameClip = { start: number; frames: Frame[]; passes: number; offset: Pair; slot?: number }
type Clip = { tracks: Track[]; frames: FrameClip[] }

const PRESS = "1"
const SHOW = "3"

// Palm writes "forever" as Int64.max.
function passes(base: JsonObject): number {
  const count = typeof base.count === "number" ? base.count : 1
  return (count >= 2 ** 31 ? Infinity : Math.max(1, count)) * (base.back === true ? 2 : 1)
}

function pair(value: Json | undefined, scale = 1): Pair | undefined {
  if (Array.isArray(value) && typeof value[0] === "number" && typeof value[1] === "number") return [value[0] * scale, value[1] * scale]
  if (typeof value === "number") return [value * scale, value * scale]
}

function clipEnd(clip: Clip): number {
  const frames = clip.frames.map((frame) => frame.start + frame.frames.reduce((sum, item) => sum + item.duration, 0) * frame.passes)
  return Math.max(0, ...clip.tracks.map(trackEnd), ...frames)
}

function shifted(clip: Clip, by: number, slot?: number): Clip {
  return {
    tracks: clip.tracks.map((track) => ({ ...track, start: track.start + by })),
    frames: clip.frames.map((frame) => ({ ...frame, start: frame.start + by, slot: slot ?? frame.slot })),
  }
}

const EMPTY: Clip = { tracks: [], frames: [] }

export class PalmMotion {
  private readonly board: PalmBoard
  private readonly animations: JsonObject
  private readonly styles: JsonObject
  private readonly images = new Map<string, Frame[]>()

  private constructor(skin: JsonObject, theme: PalmTheme, orientation: PalmOrientation, board: PalmBoard) {
    this.board = board
    const struct = asObject(skin[theme]) ?? {}
    const merged = (field: string) => ({
      ...asObject(asObject(struct.s_info)?.[field] ?? null),
      ...asObject(asObject(struct[orientation === "port" ? "s_port" : "s_land"])?.[field] ?? null),
    })
    this.styles = merged("ss_1")
    this.animations = merged("ss_2")
  }

  /** Reads the animations and decodes every frame clip they play. */
  static async load(skin: JsonObject, theme: PalmTheme, orientation: PalmOrientation, board: PalmBoard, styles: PalmStyles): Promise<PalmMotion> {
    const motion = new PalmMotion(skin, theme, orientation, board)
    const files = new Set(Object.values(motion.animations).flatMap((entry) => {
      const file = asObject(asObject(entry)?.af2 ?? null)?.file
      return typeof file === "string" ? [file] : []
    }))
    await Promise.all([...files].map(async (file) => {
      const bytes = styles.bytes(file)
      const type = /\.gif$/i.test(file) ? "image/gif" : /\.png$/i.test(file) ? "image/png" : "image/webp"
      if (bytes) motion.images.set(file, await decodeFrames(bytes, type))
    }))
    return motion
  }

  private styleAnimation(style: Json | undefined, event: string): Json | undefined {
    if (typeof style !== "number" && typeof style !== "string") return
    return asObject(asObject(this.styles[String(style).trim()])?.s_5 ?? null)?.[event]
  }

  /** Animation `id` as tracks and frame clips; `seed` makes the random picks of one press. */
  private clip(id: Json | undefined, seed: number, size: { width: number; height: number }, depth = 0): Clip {
    const entry = (typeof id === "number" || typeof id === "string") && depth < 8 ? asObject(this.animations[String(id)]) : undefined
    if (!entry) return EMPTY
    const group = asObject(entry.a3 ?? null)
    if (group) {
      const ids = list(group.animations ?? null)
      if (group.a_method === "random") {
        const index = Math.floor(seededShare(seed, Number(id) || 0) * ids.length)
        return ids.length ? shifted(this.clip(ids[index], seed, size, depth + 1), 0, index) : EMPTY
      }
      let start = 0
      const clips = ids.map((child, index) => {
        const clip = shifted(this.clip(child, seed, size, depth + 1), start, index)
        if (group.a_method === "sequential") start = clipEnd(clip)
        return clip
      })
      return { tracks: clips.flatMap((clip) => clip.tracks), frames: clips.flatMap((clip) => clip.frames) }
    }
    const frames = asObject(entry.af2 ?? null)
    if (frames) {
      const images = typeof frames.file === "string" ? this.images.get(frames.file) : undefined
      if (!images?.length) return EMPTY
      // `d` is the whole clip's length; without it the image's own frame durations play.
      const total = images.reduce((sum, frame) => sum + frame.duration, 0)
      const scale = typeof frames.d === "number" && frames.d > 0 && total > 0 ? frames.d / total : 1
      return { tracks: [], frames: [{
        start: typeof frames.delay === "number" ? frames.delay : 0,
        frames: scale === 1 ? images : images.map((frame) => ({ ...frame, duration: frame.duration * scale })),
        passes: passes(asObject(frames.b ?? null) ?? {}),
        offset: pair(frames.pos) ?? [0, 0],
      }] }
    }
    const model = asObject(entry.a1 ?? null)
    if (!model) return EMPTY
    const base = asObject(model.b ?? null) ?? {}
    const type = base.t
    const pixels = type === 2 && (model.from_px !== undefined || model.to_px !== undefined)
    const ends = (field: "from" | "to"): Pair => type === 0
      ? pair(model[field], 1 / 255) ?? [1, 1]
      : type === 1
        ? pair(model[field]) ?? [0, 0]
        : type === 2
          ? (pixels ? pair(model[`${field}_px`]) : pair(model[`${field}_p`], 1 / 100)) ?? [0, 0]
          : pair(model[`${field}_p`], 1 / 100) ?? [1, 1]
    const [from, to] = [ends("from"), ends("to")]
    const easing = typeof model.style === "number" ? model.style : 0
    const pivotPixels = pair(model.pxp)
    const pivot = pair(model.pp, 1 / 100) ?? (pivotPixels && [pivotPixels[0] / size.width, pivotPixels[1] / size.height] as const)
    const number = (value: Json | undefined) => typeof value === "number" ? value : 0
    return { frames: [], tracks: [{
      kind: type === 0 ? "opacity" : type === 1 ? "rotate" : type === 2 ? "translate" : "scale",
      start: number(model.delay) + number(model.c_delay),
      duration: number(model.duration),
      passes: passes(base),
      alternate: base.back === true,
      // `clear` defaults to false (SkinAnimationModel): the key keeps the end value unless told to clear.
      hold: base.clear !== true,
      relative: type === 2 && !pixels,
      ...pivot ? { pivot } : {},
      value: (progress) => {
        const eased = animationEasing(easing, progress)
        return [from[0] + (to[0] - from[0]) * eased, from[1] + (to[1] - from[1]) * eased]
      },
    }] }
  }

  /** The frame clips of `clip` `elapsed` ms in, filling `region` across, bottom-aligned. */
  private sprites(clip: Clip, elapsed: number, region: Rect): SceneSprite[] {
    return clip.frames.flatMap((frame) => {
      const visual = frameAt(frame.frames, elapsed - frame.start, frame.passes)
      const [, , width, height] = visual?.source ?? [0, 0, 0, 0]
      if (!visual || !width) return []
      const scaled = height * region.width / width
      const rect = { x: region.x + frame.offset[0], y: region.y + region.height - scaled + frame.offset[1], width: region.width, height: scaled }
      return [{ visual, rect, ...frame.slot === undefined ? {} : { slot: frame.slot } }]
    })
  }

  /** The animations of `keys` (one keyboard state). */
  effects(keys: Array<PalmKey & { item: { animStyle?: string; backAnimStyle?: string; foreAnimStyles: string[] } }>): SceneEffects | undefined {
    const bySection = new Map(keys.map((key) => [key.section, key]))
    const { style: panelStyle, region } = this.board.panelClip
    const clips = (section: string, seed: number) => {
      const key = bySection.get(section)
      if (!key) return
      const size = { width: key.rect.width, height: key.rect.height }
      const { animStyle, backAnimStyle, foreAnimStyles } = key.item
      const back = this.clip(this.styleAnimation(backAnimStyle || animStyle, PRESS), seed, size)
      const fores = key.base.fores.map((_, index) => this.clip(this.styleAnimation(foreAnimStyles[index] || foreAnimStyles[0] || animStyle, PRESS), seed, size))
      // A key's own panel animation replaces the board's.
      const panel = [this.clip(this.styleAnimation(key.panelAnimation ?? panelStyle, PRESS), seed, size)]
      return { key, back, fores, panel }
    }
    const show = this.clip(this.styleAnimation(panelStyle, SHOW), 0, region)
    const pressing = keys.some((key) => this.styleAnimation(key.panelAnimation, PRESS) !== undefined)
      || this.styleAnimation(panelStyle, PRESS) !== undefined
      || Object.keys(this.styles).some((style) => this.styleAnimation(style, PRESS) !== undefined)
    if (!show.frames.length && !pressing) return
    return {
      pressDuration: (section, seed) => {
        const found = clips(section, seed)
        return found ? Math.max(0, ...[found.back, ...found.fores, ...found.panel].map(clipEnd)) : 0
      },
      press: (section, elapsed, seed): KeyMotion => {
        const found = clips(section, seed)
        if (!found) return { fore: [], sprites: [] }
        const size = { width: found.key.rect.width, height: found.key.rect.height }
        return {
          back: motionAt(found.back.tracks, elapsed, size),
          fore: found.fores.map((clip) => motionAt(clip.tracks, elapsed, size)),
          sprites: found.panel.flatMap((clip) => this.sprites(clip, elapsed, region)),
        }
      },
      // A press clip takes the place of the show clip in its slot while it plays.
      ...show.frames.length ? {
        panel: (elapsed, press) => {
          const playing = press ? clips(press.section, press.seed)?.panel.flatMap((clip) => this.sprites(clip, press.elapsed, region)) ?? [] : []
          const taken = new Set(playing.map((sprite) => sprite.slot))
          return this.sprites(show, elapsed, region).filter((sprite) => !taken.has(sprite.slot))
        },
      } : {},
    }
  }
}
