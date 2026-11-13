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
// - only a long press shows the character bar; tapping keeps the key's press animation and decorations.

import type { Visual } from "../atlas.ts"
import type { IniDocument } from "../ini.ts"
import { androidInterpolation, motionAt, seededShare, trackEnd, type KeyMotion, type Pair, type SceneEffects, type SceneSprite, type Track } from "../native-motion.ts"
import type { NativeScene, SceneKey, SceneLayer } from "../native-scene.ts"
import { parseRect, type Rect } from "../preview-items.ts"
import { legacyHintCandidates, legacyHintSelectedIndex } from "../preview-hints.ts"
import { argbColor } from "../native-scene.ts"
import { ssfKeyActions, ssfKeyBinding, ssfQwerty, type SsfKeyBinding } from "./ssf-keymap.ts"
import { firstValue, ssfAnimStyle } from "./ssf-parts.ts"
import { ssfColor } from "./ssf-package.ts"
import type { SsfStyles } from "./ssf-scene.ts"

type Size = { width: number; height: number }
type Part = { image?: Visual; object: string; tracks: Track[] }
type MotionStyles = Pick<SsfStyles, "sogouWidth" | "skin" | "keys" | "file">

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

export class SsfMotion {
  private readonly anim: IniDocument
  private readonly styles: MotionStyles
  private readonly images = new Map<string, Visual>()
  /** Layout units per Sogou pixel, and the keyboard the shares refer to. */
  private readonly unit: number
  private readonly board: Size
  private readonly pixelUnit: number

  private constructor(anim: IniDocument, styles: MotionStyles, board: Size, screenWidth: number) {
    this.anim = anim
    this.styles = styles
    this.board = board
    this.unit = board.width / styles.sogouWidth
    this.pixelUnit = board.width / screenWidth
  }

  /** The theme's anim.ini with every decoration image decoded; none without the file. */
  static async load(styles: SsfStyles, board: Size, document?: IniDocument, screenWidth = 2160): Promise<SsfMotion | undefined> {
    const path = styles.pkg.path(styles.theme, "anim.ini")
    if (!path && !document) return
    return SsfMotion.fromDocument(styles, board, document ?? styles.pkg.ini(path!), screenWidth)
  }

  /** 原生预览与独立选择窗口共用解析，只需文档和已解析的图片。 */
  static async fromDocument(styles: MotionStyles, board: Size, document: IniDocument, screenWidth: number): Promise<SsfMotion> {
    const motion = new SsfMotion(document, styles, board, screenWidth)
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
    // Unspecified sizes stay in physical pixels in Sogou (AnimationTarget component intrinsic size).
    let [width, height] = [imageWidth * this.pixelUnit, imageHeight * this.pixelUnit]
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
  effects(keys: Array<{ section: string; rect: Rect; binding: SsfKeyBinding }>, override?: { section: string; field?: string }): SceneEffects | undefined {
    const styleOf = (binding: SsfKeyBinding) => override?.section ?? ssfAnimStyle(this.anim, this.styles.skin, this.styles.keys, binding)
    const animation = (style: string, field: string) => override?.field ? field === override.field ? override.section : undefined : this.value(style, field)
    const bySection = new Map(keys.map((key) => [key.section, key]))
    const press = (section: string, seed: number) => {
      const key = bySection.get(section)
      const style = key && styleOf(key.binding)
      if (!key || !style) return
      const deco = override?.field ? -1 : Number(this.value(style, "DECO_ANIM_NUMBER"))
      return {
        key,
        back: this.parts(animation(style, "BG_ANIM"), seed),
        fore: this.parts(animation(style, "FG_ANIM"), seed),
        deco: this.parts(animation(style, "DECO_ANIM"), seed, Number.isFinite(deco) ? deco : -1),
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
          return [{ visual: part.image, rect, overlay: found.deco.includes(part), motion: { ...motion, opacity: motion?.opacity ?? (Number.isFinite(alpha) && this.value(part.object, "ALPHA") ? alpha / 255 : 1) } }]
        })
        return { back: own(found.back), fore: [own(found.fore)], sprites }
      },
    }
  }
}

/** KeyPopupViewLayout: 90px cells, 27px end padding and a 78×117px selected cell at 1080. */
function holdPopup(styles: SsfStyles, key: SceneKey, layout: IniDocument, layoutName: string, qwerty: boolean, unit: number, panelWidth: number): SceneKey["holdPopup"] {
  const defaults = ssfKeyActions(layoutName, layout.get(key.section, "CENTER") ?? "", layout.get(key.section, "SSF_SECTION"))
  const action = (name: string) => layout.get(key.section, name) ?? defaults[name] ?? ""
  const actions = { center: action("CENTER"), up: action("UP"), down: action("DOWN"), left: action("LEFT"), right: action("RIGHT"), hold: action("HOLD"), holdSymbols: action("HOLDSYM") }
  const candidates = legacyHintCandidates(actions, "hold", true)
  if (!candidates.length) return
  const width = Math.min(panelWidth, (candidates.length * 90 + 54) * unit)
  const cellWidth = (width - 54 * unit) / candidates.length
  const height = 171 * unit
  const rect = { x: Math.max(0, Math.min(panelWidth - width, key.rect.x + (key.rect.width - width) / 2)), y: key.rect.y - height + (Number(styles.skin.get("General", "POPUP_OFFSET_VERTICAL")) || 0) * unit, width, height }
  const fg = qwerty ? "FGStyle_Popup_LongPress" : "FGStyle_Phone_Popup_LongPress"
  const chain = (minor: boolean) => [firstValue(styles.skin.get(fg, minor ? "MINOR_LABEL_STYLE" : "LABEL_STYLE")) ?? "", minor ? "TextStyle_Popup_Phone_Minor_LongPress" : "TextStyle_Popup_Phone_LongPress", "TextStyle_Popup"]
  const looks = [false, true].map((minor) => {
    const sections = chain(minor)
    return { ...styles.text(sections, unit, "DROIDSANSFALLBACK.ttf"), color: sections.map((section) => styles.color(section)).find(Boolean) ?? "#373737" }
  })
  const selectedColor = looks[0].color
  // Sogou keeps the selected text's RGB and sets its background alpha to 0x1d.
  const color = chain(false).map((section) => ssfColor(styles.skin.get(section, "TEXT_COLOR"))).find(Boolean) ?? "FF373737"
  const highlight = argbColor(`1d${color.slice(-6)}`)!
  return { candidates, selected: legacyHintSelectedIndex(actions, candidates), cellWidth, layers: (selected) => [
    { kind: "fill", rect, color: styles.color("General", "POPUP_BG_COLOR") ?? "#ffffff" },
    { kind: "fill", rect: { x: rect.x + 27 * unit + selected * cellWidth + (cellWidth - 78 * unit) / 2, y: rect.y + 27 * unit, width: 78 * unit, height: 117 * unit }, color: highlight, radius: 18 * unit },
    ...candidates.map((text, index): SceneLayer => {
      const look = looks[index === selected ? 0 : 1]
      return { kind: "text", text: { text, x: rect.x + 27 * unit + (index + 0.5) * cellWidth, y: rect.y + height / 2 + 3 * unit, size: look.size ?? 0.061 * panelWidth, weight: look.weight ?? 400, font: look.font, color: index === selected ? selectedColor : look.color } }
    }),
  ] }
}

/** Adds native press animations and long-press character bars (when `popups`) to the scene. */
export async function animateSsfScene(scene: NativeScene, styles: SsfStyles, layout: IniDocument, layoutName: string, landscape: boolean, popups: boolean, screenWidth = 2160): Promise<NativeScene> {
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
    for (const { key, binding } of keys) {
      if (binding.keyClass === "char") key.holdPopup = holdPopup(styles, key, layout, layoutName, qwerty, unit, board.width)
    }
  }
  const effects = (await SsfMotion.load(styles, board, undefined, screenWidth))?.effects(keys)
  await styles.ready()
  return effects ? { ...scene, effects } : scene
}
