// Sogou key animations (anim.ini) as a Baidu BDS/BDI anim.ini. The Sogou side reads as ssf-motion.ts
// previews it; the Baidu side is legacy-animation.ts (manual pp. 169–185):
// - the key layer's BG_ANIM / FG_ANIM objects (no IMG) become basic animations (TYPE 0 alpha, 1 rotate,
//   2 move, 4 scale) that a style carrying PRESS_ANIM plays, named by the key's BACK_ANIM_STYLE /
//   FORE_ANIM_STYLE; a keyframe track with several points becomes FROM→TO segments played in turn;
// - each decoration (an object with IMG) becomes a one-particle emitter over the key: its throw
//   (VELOCITY / ACCELERATION, or the keyframes' straight path) and its rotate / fade / scale keyframes as
//   constant speeds from the first value to the last, placed where the object's position range puts it.

import type { IniDocument } from "../ini.ts"
import { legacyMotionIni } from "../bda-motion.ts"
import type { SsfKeyBinding } from "./ssf-keymap.ts"
import type { LookImage, SsfLook } from "./ssf-look.ts"
import { firstValue, ssfAnimStyle } from "./ssf-parts.ts"
import type { SsfPackage, SsfTheme } from "./ssf-package.ts"

type Size = { width: number; height: number }
type Section = Record<string, string>
/** A keyframe track as [time share, x, y] points, values in Baidu units. */
type Points = Array<[number, number, number]>

// AnimationTarget's anchors as shares of the target (see ssf-motion.ts).
const ANCHORS: Record<number, [number, number]> = { 1: [0, 0.5], 2: [0.5, 0], 3: [1, 0.5], 4: [0.5, 1], 5: [0, 0], 6: [1, 0], 7: [0, 1], 8: [1, 1] }
// Sogou's Android interpolator codes → Baidu INTPOL (0 linear, 1 accelerate, 2 decelerate, 3 both, 4 bounce).
const EASINGS: Record<number, string> = { 1: "1", 2: "2", 3: "3", 6: "4" }

function numbers(value: string | undefined): number[] {
  return (value ?? "").split(",").map((part) => Number(part.trim())).filter(Number.isFinite)
}

function list(value: string | undefined): string[] {
  return (value ?? "").split(",").map((part) => part.trim()).filter(Boolean)
}

const round = (value: number) => String(Math.round(value * 100) / 100)

export class SsfBaiduMotion {
  private readonly anim: IniDocument
  private readonly skin: IniDocument
  private readonly keys: IniDocument
  private readonly look: SsfLook
  /** Layout units per Sogou pixel. */
  private readonly unit: number
  private readonly imageStyle: (image: LookImage) => string
  private readonly sections = new Map<number, Section>()
  /** Section text → id, so boards and keys that animate alike share one animation. */
  private readonly ids = new Map<string, number>()
  private readonly imageStyles = new Map<string, string>()
  private readonly layers = new Map<string, number | undefined>()
  private readonly presses = new Map<string, { back?: number; fore?: number }>()

  private constructor(anim: IniDocument, pkg: SsfPackage, theme: SsfTheme, look: SsfLook, unit: number, imageStyle: (image: LookImage) => string) {
    this.anim = anim
    this.skin = pkg.skin(theme)
    this.keys = pkg.keys(theme)
    this.look = look
    this.unit = unit
    this.imageStyle = imageStyle
  }

  /** The theme's converter; none without an anim.ini. */
  static of(pkg: SsfPackage, theme: SsfTheme, look: SsfLook, unit: number, imageStyle: (image: LookImage) => string): SsfBaiduMotion | undefined {
    const path = pkg.path(theme, "anim.ini")
    return path ? new SsfBaiduMotion(pkg.ini(path), pkg, theme, look, unit, imageStyle) : undefined
  }

  private value(section: string, key: string): string | undefined {
    return this.anim.get(section, key)?.trim()
  }

  private add(section: Section): number {
    const text = JSON.stringify(section)
    let id = this.ids.get(text)
    if (id === undefined) {
      id = this.sections.size + 1
      this.sections.set(id, section)
      this.ids.set(text, id)
    }
    return id
  }

  private together(ids: number[], method = "0", extra: Section = {}): number | undefined {
    if (ids.length < 2 && !Object.keys(extra).length) return ids[0]
    return ids.length ? this.add({ BUILD_NUM: String(ids.length), BUILD_LIST: ids.join(","), BUILD_METHOD: method, ...extra }) : undefined
  }

  /** TIME / VALUE of a KEYFRAME section as [time, value] pairs. */
  private keyframes(name: string | undefined): Array<[number, number]> | undefined {
    if (!name) return
    const times = numbers(this.value(name, "TIME"))
    const values = numbers(this.value(name, "VALUE"))
    return times.length >= 2 && values.length === times.length ? times.map((time, index) => [time, values[index]]) : undefined
  }

  /** Two tracks on the times of both, each linear between its own keyframes. */
  private merged(x: Array<[number, number]>, y: Array<[number, number]>): Points {
    const at = (track: Array<[number, number]>, time: number) => {
      const next = track.findIndex(([own]) => own >= time)
      if (next <= 0) return track[next < 0 ? track.length - 1 : 0][1]
      const [[t0, v0], [t1, v1]] = [track[next - 1], track[next]]
      return t1 > t0 ? v0 + (v1 - v0) * (time - t0) / (t1 - t0) : v1
    }
    return [...new Set([...x, ...y].map(([time]) => time))].sort((left, right) => left - right).map((time) => [time, at(x, time), at(y, time)])
  }

  /** A share of the keyboard up to 1, else Sogou pixels, as layout units. */
  private length(value: number, reference: number): number {
    return Math.abs(value) <= 1 ? value * reference : value * this.unit
  }

  /** The points of one Sogou ObjectAnimator in Baidu units (moves in layout units, scales in %). */
  private points(name: string, board: Size): Points | undefined {
    const type = Number(this.value(name, "TYPE"))
    const frames = list(this.value(name, "KEYFRAME"))
    if (type === 1) {
      const velocity = numbers(this.value(name, "VELOCITY"))
      const acceleration = numbers(this.value(name, "ACCELERATION"))
      if (velocity.length === 2 && acceleration.length === 2) {
        // Sogou's evaluator, start + v·t + a·t²/2, sampled into straight segments.
        const origin = numbers(this.value(name, "START_VALUE"))
        const seconds = (Number(this.value(name, "DURATION")) || 0) / 1000
        const axis = (index: number, share: number) => {
          const time = share * seconds
          return ((origin[index] ?? 0) + velocity[index] * time + acceleration[index] * time * time / 2) * this.unit
        }
        return [0, 0.25, 0.5, 0.75, 1].map((share) => [share, axis(0, share), axis(1, share)])
      }
      const [x, y] = [this.keyframes(frames[0]), this.keyframes(frames[1])]
      return x && y ? this.merged(x.map(([time, value]) => [time, this.length(value, board.width)]), y.map(([time, value]) => [time, this.length(value, board.height)])) : undefined
    }
    if (type === 2) {
      const [x, y] = [this.keyframes(frames[0]), this.keyframes(frames[1] ?? frames[0])]
      return x && y ? this.merged(x, y).map(([time, scaleX, scaleY]) => [time, scaleX * 100, scaleY * 100]) : undefined
    }
    const single = type === 3 || type === 4 ? this.keyframes(frames[0]) : undefined
    return single?.map(([time, value]) => [time, value, value])
  }

  /** One Sogou ObjectAnimator or set animating the key layer itself, as a Baidu animation. */
  private layer(name: string | undefined, board: Size, pivot: string, depth = 0): number | undefined {
    if (!name || depth > 8 || !this.anim.sections().includes(name)) return
    const cacheKey = `${name}|${board.width}x${board.height}|${pivot}`
    if (this.layers.has(cacheKey)) return this.layers.get(cacheKey)
    const timing: Section = {}
    const delay = Number(this.value(name, "START_DELAY")) || 0
    if (delay > 0) timing.DELAY = String(Math.round(delay))
    // Sogou counts extra plays; an endless one plays once, as a press animation should end.
    const repeat = Number(this.value(name, "REPEAT_COUNT"))
    if (repeat > 0) timing.REPEAT_CNT = String(repeat + 1)
    if (this.value(name, "REPEAT_MODE") === "2") timing.REPEAT_MODE = "1"
    let id: number | undefined
    const set = list(this.value(name, "ANIM_SET"))
    if (set.length) {
      const children = set.flatMap((child) => this.layer(child, board, pivot, depth + 1) ?? [])
      id = this.together(children, this.value(name, "PLAY_METHOD") === "1" ? "1" : "0", children.length ? timing : {})
    } else {
      const type = Number(this.value(name, "TYPE"))
      const points = this.points(name, board)
      const duration = Number(this.value(name, "DURATION")) || 0
      const baiduType = ({ 1: "2", 2: "4", 3: "1", 4: "0" } as Record<number, string>)[type]
      if (points && baiduType) {
        const easing = EASINGS[Number(this.value(name, "INTERPOLATOR"))]
        const pair = (point: [number, number, number]) => `${round(point[1])},${round(point[2])}`
        const single = points.length === 2
        const segments = points.slice(1).map((point, index) => {
          const from = points[index]
          return this.add({
            TYPE: baiduType,
            ...baiduType === "2" ? { FROM_PX: pair(from), TO_PX: pair(point) } : baiduType === "4" ? { FROM: pair(from), TO: pair(point) } : { FROM: round(from[1]), TO: round(point[1]) },
            ...baiduType === "1" || baiduType === "4" ? { PIVOT: pivot } : {},
            DURATION: String(Math.round(duration * (point[0] - from[0]))),
            ...easing ? { INTPOL: easing } : {},
            REMOVE: "1",
            ...single ? timing : {},
          })
        })
        id = single ? segments[0] : this.together(segments, "1", timing)
      }
    }
    this.layers.set(cacheKey, id)
    return id
  }

  /** The leaf ObjectAnimators under an `Anim_*`, sets flattened. */
  private leaves(name: string | undefined, depth = 0): string[] {
    if (!name || depth > 8 || !this.anim.sections().includes(name)) return []
    const set = list(this.value(name, "ANIM_SET"))
    return set.length ? set.flatMap((child) => this.leaves(child, depth + 1)) : [name]
  }

  /** A decoration as a one-particle emitter over a `key`-sized key, or none without its image. */
  private particle(object: string, key: Size, board: Size): number | undefined {
    const file = firstValue(this.value(object, "IMG"))
    const size = file ? this.look.imageSize(file) : undefined
    if (!file || !size) return
    const [imageWidth, imageHeight] = size
    const field = (name: string) => Number(this.value(object, name)) || 0
    let [width, height] = [imageWidth * this.unit, imageHeight * this.unit]
    const [keyWidth, keyHeight, boardWidth, boardHeight] = [field("RATE_KEY_W"), field("RATE_KEY_H"), field("RATE_W"), field("RATE_H")]
    if (keyWidth > 0 || keyHeight > 0) {
      const fit = Math.min((keyWidth > 0 ? key.width * keyWidth : key.width) / imageWidth, (keyHeight > 0 ? key.height * keyHeight : key.height) / imageHeight)
      ;[width, height] = [imageWidth * fit, imageHeight * fit]
    } else if (boardWidth > 0 && boardHeight > 0) [width, height] = [boardWidth * board.width, boardHeight * board.height]
    else if (boardWidth > 0) [width, height] = [boardWidth * board.width, imageHeight * boardWidth * board.width / imageWidth]
    else if (boardHeight > 0) [width, height] = [imageWidth * boardHeight * board.height / imageHeight, boardHeight * board.height]
    // One image per decoration at its own size; the fit to this key is the particle's scale.
    const image = this.look.sized(file, imageWidth * this.unit, imageHeight * this.unit)
    if (!image) return
    const fit = width / (imageWidth * this.unit)

    const anchor = this.value(object, "POS_ANCHOR")
    const anchored = anchor !== undefined && anchor !== "-1"
    const [shareX, shareY] = anchored ? ANCHORS[Number(anchor)] ?? [0.5, 0.5] : [0, 0]
    const relate = numbers(this.value(object, "RELATETO"))
    const range = (field: string, reference: number) => {
      const values = numbers(this.value(object, field)).map((value) => Math.abs(value) <= 1 ? value * reference : value * this.unit)
      return values.length ? [Math.min(...values), Math.max(...values)] : [0, 0]
    }
    const xs = range(anchored ? "NEW_POS_X" : "POS_X", relate[0] === 1 ? key.width : board.width)
    const ys = range(anchored ? "NEW_POS_Y" : "POS_Y", relate[1] === 1 ? key.height : board.height)
    // Particles are placed by their centre.
    let [left, top] = [(key.width - width) * shareX + width / 2, (key.height - height) * shareY + height / 2]

    let imageStyle = this.imageStyles.get(image.id)
    if (!imageStyle) this.imageStyles.set(image.id, imageStyle = this.imageStyle(image))
    const entries: Section = { CATEGORY: "3", TYPE: "0", TOTAL_NUMBER: "1", BIRTH_RATE: "1000", EMIT_TYPE: "1", PARTICLE_IMAGE: imageStyle, INIT_SCALE: `${round(fit)},${round(fit)}` }
    let life = 0
    const vector = (prefix: "VELOCITY" | "ACCELERATION", x: number, y: number) => {
      const magnitude = round(Math.hypot(x, y))
      const direction = round(Math.atan2(y, x) * 180 / Math.PI)
      entries[prefix] = `${magnitude},${magnitude}`
      entries[`${prefix}_DIRECTION`] = `${direction},${direction}`
    }
    const speed = (initial: string, rate: string, from: number, to: number, seconds: number) => {
      entries[initial] = `${round(from)},${round(from)}`
      if (seconds > 0 && to !== from) entries[rate] = `${round((to - from) / seconds)},${round((to - from) / seconds)}`
    }
    for (const leaf of this.leaves(this.value(object, "ANIM"))) {
      const type = Number(this.value(leaf, "TYPE"))
      const duration = Number(this.value(leaf, "DURATION")) || 0
      const seconds = duration / 1000
      life = Math.max(life, (Number(this.value(leaf, "START_DELAY")) || 0) + duration)
      const velocity = numbers(this.value(leaf, "VELOCITY"))
      const acceleration = numbers(this.value(leaf, "ACCELERATION"))
      if (type === 1 && velocity.length === 2 && acceleration.length === 2) {
        const origin = numbers(this.value(leaf, "START_VALUE"))
        left += (origin[0] ?? 0) * this.unit
        top += (origin[1] ?? 0) * this.unit
        vector("VELOCITY", velocity[0] * this.unit, velocity[1] * this.unit)
        vector("ACCELERATION", acceleration[0] * this.unit, acceleration[1] * this.unit)
        continue
      }
      const points = this.points(leaf, board)
      if (!points) continue
      const [first, last] = [points[0], points[points.length - 1]]
      if (type === 1) {
        left += first[1]
        top += first[2]
        if (seconds > 0) vector("VELOCITY", (last[1] - first[1]) / seconds, (last[2] - first[2]) / seconds)
      } else if (type === 2) speed("INIT_SCALE", "SCALE_SPEED", first[1] / 100 * fit, last[1] / 100 * fit, seconds)
      else if (type === 3) speed("INIT_ROTATE", "ROTATE_SPEED", first[1], last[1], seconds)
      else if (type === 4) speed("INIT_ALPHA", "ALPHA_SPEED", first[1], last[1], seconds)
    }
    if (!life) return
    const alpha = this.value(object, "ALPHA")
    if (!entries.INIT_ALPHA && alpha && Number.isFinite(Number(alpha))) entries.INIT_ALPHA = `${alpha},${alpha}`
    entries.LIFE = `${life},${life}`
    entries.DURATION = String(life)
    entries.EMIT_REGION = [
      (left + xs[0]) / key.width,
      (top + ys[0]) / key.height,
      (xs[1] - xs[0]) / key.width,
      (ys[1] - ys[0]) / key.height,
    ].map(round).join(",")
    return this.add(entries)
  }

  /** The DOWN_ANIM_OBJ objects of an `Animation_*`; `count` of them (-1 all). */
  private objects(animation: string | undefined, count = -1): string[] {
    const objects = list(animation && this.value(animation, "DOWN_ANIM_OBJ"))
    return count >= 0 ? objects.slice(0, count) : objects
  }

  private pivot(animation: string | undefined): string {
    const [x, y] = ANCHORS[Number(animation && this.value(animation, "ANCHOR"))] ?? [0.5, 0.5]
    return `${x * 100},${y * 100}`
  }

  /**
   * What a key plays on press: `back` animates its background and throws its decorations, `fore` its
   * foreground. Sizes are the key's and the keyboard's in layout units.
   */
  press(binding: SsfKeyBinding, key: Size, board: Size): { back?: number; fore?: number } {
    const style = ssfAnimStyle(this.anim, this.skin, this.keys, binding)
    if (!style) return {}
    const cacheKey = `${style}|${Math.round(key.width)}x${Math.round(key.height)}|${board.width}x${board.height}`
    let found = this.presses.get(cacheKey)
    if (found) return found
    const own = (animation: string | undefined) => this.objects(animation).filter((object) => !this.value(object, "IMG"))
      .flatMap((object) => this.layer(this.value(object, "ANIM"), board, this.pivot(animation)) ?? [])
    const [back, fore, deco] = ["BG_ANIM", "FG_ANIM", "DECO_ANIM"].map((field) => this.value(style, field))
    const decoCount = Number(this.value(style, "DECO_ANIM_NUMBER"))
    const thrown = [...this.objects(back), ...this.objects(fore), ...this.objects(deco, Number.isFinite(decoCount) ? decoCount : -1)]
      .filter((object) => this.value(object, "IMG"))
      .flatMap((object) => this.particle(object, key, board) ?? [])
    found = { back: this.together([...own(back), ...thrown]), fore: this.together(own(fore)) }
    this.presses.set(cacheKey, found)
    return found
  }

  /** Whether any decoration became a particle, whose random placement Baidu approximates. */
  get throwsDecorations(): boolean {
    return [...this.sections.values()].some((section) => section.CATEGORY === "3")
  }

  ini(): string | undefined {
    return legacyMotionIni({ sections: this.sections, bindings: [], warnings: [] })
  }
}
