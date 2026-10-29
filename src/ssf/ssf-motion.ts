// A Sogou skin's key animations and popups, read from its own anim.ini and phoneSkin.ini with the
// semantics of the Sogou app (com.sogou.theme.data.animation in the APK):
// - a key plays the `Anim_Style_*` its section names with ANIM_STYLE, else `Anim_Style_Key`;
//   BG_ANIM / FG_ANIM animate its background / foreground, DECO_ANIM throws decorations
//   (DECO_ANIM_NUMBER of them at random, -1 all); each names an `Animation_*` whose DOWN_ANIM_OBJ
//   objects play on press, an object without IMG animating the key layer itself;
// - an animation (`ANIM`) is a set (ANIM_SET, PLAY_METHOD 0 together / 1 in turn) or one ObjectAnimator:
//   TYPE 1 moves (VELOCITY / ACCELERATION from START_VALUE, else two KEYFRAME tracks), 2 scales, 3 rotates,
//   4 fades (0–255), with DURATION, START_DELAY, INTERPOLATOR, REPEAT_COUNT (extra plays, -1 forever) and
//   REPEAT_MODE (2 reverses); values up to 1 are shares of the keyboard;
// - a decoration's size is RATE_KEY_W/H of the key (keeping the image's ratio) or RATE_W/H of the
//   keyboard, else the image's own; it sits at POS_X/POS_Y, or with POS_ANCHOR at NEW_POS_X/Y from that
//   anchor of the key (ranges pick at random; shares of the key with RELATETO 1, else of the keyboard);
// - a tap pops the key's label (and nine-key digit) on PopupBG_Phone / PopupBG, placed by
//   FGStyle_Phone_Popup / FGStyle_Popup_Qwerty in TextStyle_Popup_*.

import type { Visual } from "../atlas.ts"
import type { IniDocument } from "../ini.ts"
import { androidInterpolation, motionAt, seededShare, trackEnd, type KeyMotion, type Pair, type SceneEffects, type SceneSprite, type Track } from "../native-motion.ts"
import type { NativeScene, SceneKey, SceneLayer } from "../native-scene.ts"
import { parseRect, type Rect } from "../preview-items.ts"
import { ssfBoard, ssfKeyBinding, ssfQwerty, type SsfKeyBinding } from "./ssf-keymap.ts"
import { firstValue, ssfAnimStyle } from "./ssf-parts.ts"
import { NINE_KEY_DIGITS, box, centre, fitText, type SsfStyles } from "./ssf-scene.ts"

type Size = { width: number; height: number }
type Part = { image?: Visual; object: string; tracks: Track[] }

// AnimationTarget's anchors, as shares of the target: 0 (and none) the centre, 1–4 the left, top,
// right and bottom middles, 5–8 the corners.
const ANCHORS: Record<number, Pair> = { 1: [0, 0.5], 2: [0.5, 0], 3: [1, 0.5], 4: [0.5, 1], 5: [0, 0], 6: [1, 0], 7: [0, 1], 8: [1, 1] }

function numbers(value: string | undefined): number[] {
  return (value ?? "").split(",").map((part) => Number(part.trim())).filter(Number.isFinite)
}

function list(value: string | undefined): string[] {
  return (value ?? "").split(",").map((part) => part.trim()).filter(Boolean)
}

/** A value of a POS / NEW_POS range, picked by `share`; up to 1 it is a share of `reference`. */
function ranged(range: number[], share: number, reference: number, unit: number): number {
  if (!range.length) return 0
  const [low, high] = range.length === 2 ? [Math.min(...range), Math.max(...range)] : [range[0], range[0]]
  const value = low + (high - low) * share
  return Math.abs(value) <= 1 ? value * reference : value * unit
}

class SsfMotion {
  private readonly anim: IniDocument
  private readonly styles: SsfStyles
  private readonly images = new Map<string, Visual>()
  /** Layout units per Sogou pixel, and the keyboard the shares refer to. */
  private readonly unit: number
  private readonly board: Size

  private constructor(anim: IniDocument, styles: SsfStyles, board: Size) {
    this.anim = anim
    this.styles = styles
    this.board = board
    this.unit = board.width / styles.sogouWidth
  }

  /** The theme's anim.ini with every decoration image decoded; none without the file. */
  static async load(styles: SsfStyles, board: Size): Promise<SsfMotion | undefined> {
    const path = styles.pkg.path(styles.theme, "anim.ini")
    if (!path) return
    const motion = new SsfMotion(styles.pkg.ini(path), styles, board)
    const files = new Set(motion.anim.sections().map((section) => firstValue(motion.anim.get(section, "IMG"))).filter((file): file is string => Boolean(file)))
    await Promise.all([...files].map(async (file) => {
      const visual = await styles.file(file)
      if (visual) motion.images.set(file, visual)
    }))
    return motion
  }

  private value(section: string, key: string): string | undefined {
    return this.anim.get(section, key)?.trim()
  }

  /** The keyframe tracks of KEYFRAME sections: TIME shares of the pass, VALUE, each segment eased by its end's INTERPOLATOR. */
  private keyframes(name: string | undefined, scale: (value: number) => number): ((progress: number) => number) | undefined {
    if (!name) return
    const times = numbers(this.value(name, "TIME"))
    const values = numbers(this.value(name, "VALUE")).map(scale)
    const easings = numbers(this.value(name, "INTERPOLATOR"))
    if (times.length < 2 || values.length !== times.length) return
    return (progress) => {
      if (progress <= times[0]) return values[0]
      for (let index = 1; index < times.length; index++) {
        if (progress > times[index] && index < times.length - 1) continue
        const span = times[index] - times[index - 1]
        const local = span > 0 ? Math.min(1, (progress - times[index - 1]) / span) : 1
        const eased = androidInterpolation(easings[index] ?? 0, local)
        return values[index - 1] + (values[index] - values[index - 1]) * eased
      }
      return values[values.length - 1]
    }
  }

  /** The tracks of an `Anim_*` section, from `start` ms on. */
  private tracks(name: string | undefined, pivot: Pair | undefined, start = 0, depth = 0): Track[] {
    if (!name || depth > 8 || !this.anim.sections().includes(name)) return []
    const delay = start + (Number(this.value(name, "START_DELAY")) || 0)
    const set = list(this.value(name, "ANIM_SET"))
    if (set.length) {
      const sequential = this.value(name, "PLAY_METHOD") === "1"
      let at = delay
      return set.flatMap((child) => {
        const tracks = this.tracks(child, pivot, at, depth + 1)
        if (sequential) at = Math.max(at, ...tracks.map(trackEnd))
        return tracks
      })
    }
    const type = Number(this.value(name, "TYPE"))
    const duration = Number(this.value(name, "DURATION")) || 0
    const repeat = Number(this.value(name, "REPEAT_COUNT"))
    const easing = Number(this.value(name, "INTERPOLATOR")) || 0
    const base = {
      start: delay,
      duration,
      passes: repeat < 0 ? Infinity : 1 + (repeat > 0 ? repeat : 0),
      alternate: this.value(name, "REPEAT_MODE") === "2",
      hold: false,
      ...pivot ? { pivot } : {},
    }
    const frames = list(this.value(name, "KEYFRAME"))
    const eased = (curve: (progress: number) => number) => (progress: number) => curve(androidInterpolation(easing, progress))
    if (type === 1) {
      const velocity = numbers(this.value(name, "VELOCITY"))
      const acceleration = numbers(this.value(name, "ACCELERATION"))
      const origin = numbers(this.value(name, "START_VALUE"))
      if (velocity.length === 2 && acceleration.length === 2) {
        // Sogou's evaluator: start + v·t + a·t²/2, t in seconds of the eased pass.
        const seconds = duration / 1000
        const axis = (index: 0 | 1) => (progress: number) => {
          const time = progress * seconds
          return ((origin[index] ?? 0) + velocity[index] * time + acceleration[index] * time * time / 2) * this.unit
        }
        const [x, y] = [eased(axis(0)), eased(axis(1))]
        return [{ ...base, kind: "translate", value: (progress) => [x(progress), y(progress)] }]
      }
      const [x, y] = [0, 1].map((index) => this.keyframes(frames[index], (value) => Math.abs(value) <= 1 ? value * (index ? this.board.height : this.board.width) : value * this.unit))
      return x && y ? [{ ...base, kind: "translate", value: (progress) => [eased(x)(progress), eased(y)(progress)] }] : []
    }
    if (type === 2) {
      const [x, y] = [this.keyframes(frames[0], (value) => value), this.keyframes(frames[1] ?? frames[0], (value) => value)]
      return x && y ? [{ ...base, kind: "scale", value: (progress) => [eased(x)(progress), eased(y)(progress)] }] : []
    }
    const single = this.keyframes(frames[0], type === 4 ? (value) => value / 255 : (value) => value)
    if (!single || (type !== 3 && type !== 4)) return []
    const curve = eased(single)
    return [{ ...base, kind: type === 3 ? "rotate" : "opacity", value: (progress) => [curve(progress), curve(progress)] }]
  }

  /** The DOWN_ANIM_OBJ objects of an `Animation_*`; `count` of them at random (-1 all). */
  private parts(animation: string | undefined, seed: number, count = -1): Part[] {
    if (!animation) return []
    const pivot = ANCHORS[Number(this.value(animation, "ANCHOR"))] ?? undefined
    let objects = list(this.value(animation, "DOWN_ANIM_OBJ"))
    if (count >= 0 && count < objects.length) {
      objects = objects.map((object, index) => ({ object, order: seededShare(seed, index) })).sort((left, right) => left.order - right.order).slice(0, count).map(({ object }) => object)
    }
    return objects.map((object) => {
      const file = firstValue(this.value(object, "IMG"))
      return { object, image: file ? this.images.get(file) : undefined, tracks: this.tracks(this.value(object, "ANIM"), pivot) }
    })
  }

  /** A decoration's rect over `key`, as the object's size and position fields place it. */
  private placed(part: Part & { image: Visual }, key: Rect, seed: number, salt: number): Rect {
    const [, , imageWidth, imageHeight] = part.image.source!
    const field = (name: string) => Number(this.value(part.object, name)) || 0
    let [width, height] = [imageWidth * this.unit, imageHeight * this.unit]
    const [keyWidth, keyHeight] = [field("RATE_KEY_W"), field("RATE_KEY_H")]
    const [boardWidth, boardHeight] = [field("RATE_W"), field("RATE_H")]
    if (keyWidth > 0 || keyHeight > 0) {
      const box = { width: keyWidth > 0 ? key.width * keyWidth : key.width, height: keyHeight > 0 ? key.height * keyHeight : key.height }
      const fit = Math.min(box.width / imageWidth, box.height / imageHeight)
      ;[width, height] = [imageWidth * fit, imageHeight * fit]
    } else if (boardWidth > 0 && boardHeight > 0) [width, height] = [boardWidth * this.board.width, boardHeight * this.board.height]
    else if (boardWidth > 0) [width, height] = [boardWidth * this.board.width, imageHeight * boardWidth * this.board.width / imageWidth]
    else if (boardHeight > 0) [width, height] = [imageWidth * boardHeight * this.board.height / imageHeight, boardHeight * this.board.height]
    const anchor = this.value(part.object, "POS_ANCHOR")
    const anchored = anchor !== undefined && anchor !== "-1"
    const relate = numbers(this.value(part.object, "RELATETO"))
    const x = ranged(numbers(this.value(part.object, anchored ? "NEW_POS_X" : "POS_X")), seededShare(seed, salt * 2), relate[0] === 1 ? key.width : this.board.width, this.unit)
    const y = ranged(numbers(this.value(part.object, anchored ? "NEW_POS_Y" : "POS_Y")), seededShare(seed, salt * 2 + 1), relate[1] === 1 ? key.height : this.board.height, this.unit)
    const [shareX, shareY] = anchored ? ANCHORS[Number(anchor)] ?? [0.5, 0.5] : [0, 0]
    return { x: key.x + (key.width - width) * shareX + x, y: key.y + (key.height - height) * shareY + y, width, height }
  }

  /** The press animations of a board's `keys`. */
  effects(keys: Array<{ section: string; rect: Rect; binding: SsfKeyBinding }>): SceneEffects | undefined {
    const styleOf = (binding: SsfKeyBinding) => ssfAnimStyle(this.anim, this.styles.skin, this.styles.keys, binding)
    const bySection = new Map(keys.map((key) => [key.section, key]))
    const press = (section: string, seed: number) => {
      const key = bySection.get(section)
      const style = key && styleOf(key.binding)
      if (!key || !style) return
      const deco = Number(this.value(style, "DECO_ANIM_NUMBER"))
      return {
        key,
        back: this.parts(this.value(style, "BG_ANIM"), seed),
        fore: this.parts(this.value(style, "FG_ANIM"), seed),
        deco: this.parts(this.value(style, "DECO_ANIM"), seed, Number.isFinite(deco) ? deco : -1),
      }
    }
    if (!keys.some((key) => styleOf(key.binding))) return
    return {
      pressDuration: (section, seed) => {
        const found = press(section, seed)
        return found ? Math.max(0, ...[...found.back, ...found.fore, ...found.deco].flatMap((part) => part.tracks.map(trackEnd))) : 0
      },
      press: (section, elapsed, seed): KeyMotion => {
        const found = press(section, seed)
        if (!found) return { fore: [], sprites: [] }
        const own = (parts: Part[]) => motionAt(parts.filter((part) => !part.image).flatMap((part) => part.tracks), elapsed, found.key.rect)
        const sprites = [...found.back, ...found.fore, ...found.deco].flatMap((part, index): SceneSprite[] => {
          if (!part.image || !part.tracks.length || elapsed >= Math.max(...part.tracks.map(trackEnd))) return []
          const rect = this.placed({ ...part, image: part.image }, found.key.rect, seed, index + 1)
          const motion = motionAt(part.tracks, elapsed, rect)
          const alpha = Number(this.value(part.object, "ALPHA"))
          return [{ visual: part.image, rect, motion: { ...motion, opacity: motion?.opacity ?? (Number.isFinite(alpha) && this.value(part.object, "ALPHA") ? alpha / 255 : 1) } }]
        })
        return { back: own(found.back), fore: [own(found.fore)], sprites }
      },
    }
  }
}

// The popup boxes skins made with Sogou's skin maker write (both sample skins), for skins without them.
const POPUP_BOXES = {
  phone: { LABEL_POSITION: [0.217, 0.465, 0.783, 0.741], MINOR_LABEL_POSITION: [0.46, 0.195, 0.54, 0.457] },
  qwerty: { LABEL_POSITION: [0.34, 0.34, 0.66, 0.66], MINOR_LABEL_POSITION: undefined },
}

/** The bubble a tap on a character key pops: its label (and nine-key digit) enlarged above it. */
async function popup(styles: SsfStyles, key: SceneKey, binding: SsfKeyBinding, action: string, caps: boolean, qwerty: boolean, unit: number, panelWidth: number): Promise<SceneLayer[] | undefined> {
  const skin = styles.skin
  const background = [qwerty ? "PopupBG_Qwerty" : "PopupBG_Phone", "PopupBG"].map((section) => firstValue(skin.get(section, "BG_IMAGE"))).find(Boolean)
  const visual = background ? await styles.image(skin.get(background, "NORMAL")) : undefined
  // The key's own label texts; a key drawn with an image pops its label as text all the same.
  const fore = key.layers(false).fore.flatMap((layer) => layer.kind === "text" ? [layer.text] : [])
  const group = binding.sections.find((section) => NINE_KEY_DIGITS[section])
  const labels = fore.length ? fore.map(({ text }) => text) : group ? [group.slice(4), NINE_KEY_DIGITS[group]] : [caps ? action.toUpperCase() : action]
  const texts = labels.map((text, index) => ({ ...fore[index], text }))
  if (!visual) return
  const [, , imageWidth, imageHeight] = visual.source!
  const width = Math.max(key.rect.width, imageWidth * unit)
  const height = Math.max(key.rect.height, imageHeight * unit)
  const rect = { x: Math.max(0, Math.min(panelWidth - width, key.rect.x + (key.rect.width - width) / 2)), y: key.rect.y - height, width, height }
  const fg = [qwerty ? "FGStyle_Popup_Qwerty" : "FGStyle_Phone_Popup", "FGStyle_Popup"].find((section) => skin.get(section, "LABEL_POSITION"))
  const position = (field: "LABEL_POSITION" | "MINOR_LABEL_POSITION") => fg && skin.get(fg, field) ? numbers(skin.get(fg, field)) : POPUP_BOXES[qwerty ? "qwerty" : "phone"][field]
  const labelBox = box(rect, position("LABEL_POSITION")) ?? rect
  const layers: SceneLayer[] = [{ kind: "image", rect, visual }]
  const styleChain = (minor: boolean) => minor
    ? ["TextStyle_Popup_Phone_Minor", "TextStyle_Popup"]
    : [qwerty ? "TextStyle_Popup_Qwerty" : "TextStyle_Popup_Phone", "TextStyle_Popup"]
  texts.slice(0, 2).forEach((text, index) => {
    const area = index ? box(rect, position("MINOR_LABEL_POSITION")) : labelBox
    if (!area) return
    const chain = styleChain(index > 0)
    const look = styles.text(chain, unit)
    const weight = look.weight ?? text.weight ?? 700
    const font = look.font ?? text.font
    const [x, y] = centre(area)
    const color = chain.map((section) => styles.color(section)).find(Boolean) ?? text.color ?? "#373737"
    layers.push({ kind: "text", text: { text: text.text, x, y, weight, color, size: look.size ?? fitText(text.text, area, font, weight), ...font ? { font } : {} } })
  })
  return layers
}

/** Adds a board's press animations and character-key popups (when `popups`) to its scene. */
export async function animateSsfScene(scene: NativeScene, styles: SsfStyles, layout: IniDocument, layoutName: string, landscape: boolean, popups: boolean): Promise<NativeScene> {
  const panel = numbers(layout.get("PANEL", "SIZE"))
  const board = { width: panel[0] || styles.sogouWidth, height: panel[1] || styles.sogouWidth / 2 }
  const unit = board.width / styles.sogouWidth
  const qwerty = ssfQwerty(layoutName)
  const keys = scene.keys.flatMap((key) => {
    const action = layout.get(key.section, "CENTER")?.trim()
    const rect = parseRect(layout.get(key.section, "VIEW_RECT"))
    return action && rect ? [{ key, action, section: key.section, rect, binding: ssfKeyBinding(layoutName, action, landscape, layout.get(key.section, "SSF_SECTION"), layout.get(key.section, "SSF_BG")) }] : []
  })
  if (popups) {
    const caps = ["py9", "py26"].includes(ssfBoard(layoutName))
    await Promise.all(keys.filter(({ binding }) => binding.keyClass === "char").map(async ({ key, binding, action }) => {
      const layers = await popup(styles, key, binding, action, caps, qwerty, unit, board.width)
      if (layers) key.popup = layers
    }))
  }
  const effects = (await SsfMotion.load(styles, board))?.effects(keys)
  await styles.ready()
  return effects ? { ...scene, effects } : scene
}
