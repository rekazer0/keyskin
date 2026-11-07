// A keyboard as the skin's own input method draws it, resolved straight from its native files
// (Palm `skin.json`, Sogou `phoneSkin.ini`). Builders decode every image up front, so painting
// is synchronous; the canvas keeps the layout's key list for selection and touch.

import { type Visual, canvasFontFamily } from "./atlas.ts"
import { drawListText, drawVisual } from "./preview-draw.ts"
import type { SceneEffects } from "./native-motion.ts"
import type { Rect } from "./preview-items.ts"

export type SceneText = {
  text: string
  x: number
  y: number
  size: number
  color: string
  weight?: number
  font?: string
  /** Centred on the glyph's ink rather than its em box, as list cells draw punctuation. */
  ink?: boolean
}

export type SceneLayer =
  | { kind: "fill"; rect: Rect; color: string }
  | { kind: "border"; rect: Rect; color: string; width: number }
  /** Drawn to fill `rect`, nine-sliced when the visual has an inner rect. */
  | { kind: "image"; rect: Rect; visual: Visual }
  | { kind: "text"; text: SceneText }

/**
 * A key's background and foreground, which press animations move separately; `groups` gives each
 * foreground layer the index of the foreground (and so the animation) it belongs to, 0 without it.
 */
export type SceneLayers = { back: SceneLayer[]; fore: SceneLayer[]; groups?: number[] }

export type SceneKey = {
  section: string
  rect: Rect
  layers(pressed: boolean): SceneLayers
  /** The bubble a tap on the key pops, in scene units. */
  popup?: SceneLayer[]
}

export type NativeScene = {
  background: SceneLayer[]
  keys: SceneKey[]
  /** Native controls can replace just part of a legacy toolbar. */
  partial?: boolean
  effects?: SceneEffects
}

function textFont(text: SceneText): string {
  return `${text.weight ?? 400} ${text.size}px ${canvasFontFamily(text.font)}`
}

export function drawSceneLayer(context: CanvasRenderingContext2D, layer: SceneLayer): void {
  if (layer.kind === "fill") {
    context.fillStyle = layer.color
    context.fillRect(layer.rect.x, layer.rect.y, layer.rect.width, layer.rect.height)
  } else if (layer.kind === "border") {
    const inset = layer.width / 2
    context.strokeStyle = layer.color
    context.lineWidth = layer.width
    context.strokeRect(layer.rect.x + inset, layer.rect.y + inset, layer.rect.width - layer.width, layer.rect.height - layer.width)
  } else if (layer.kind === "image") {
    drawVisual(context, layer.visual, layer.rect, true)
  } else {
    context.fillStyle = layer.text.color
    context.font = textFont(layer.text)
    if (layer.text.ink) return drawListText(context, layer.text.text, layer.text.x, layer.text.y)
    context.textAlign = "center"
    context.textBaseline = "middle"
    context.fillText(layer.text.text, layer.text.x, layer.text.y)
  }
}

/** Builds a key's normal and pressed layers up front, so painting never waits. */
export async function sceneKey(section: string, rect: Rect, build: (pressed: boolean) => Promise<SceneLayers>): Promise<SceneKey> {
  const [normal, pressed] = await Promise.all([build(false), build(true)])
  return { section, rect, layers: (down) => down ? pressed : normal }
}

/** An image drawn at its own size, centred on `point`. */
export function imageAt(visual: Visual, x: number, y: number): SceneLayer | undefined {
  if (!visual.source) return
  const [, , width, height] = visual.source
  return { kind: "image", visual, rect: { x: x - width / 2, y: y - height / 2, width, height } }
}

/** `AARRGGBB` or `RRGGBB` (optionally `0x`/`#` prefixed) as a canvas colour. */
export function argbColor(value: unknown): string | undefined {
  if (typeof value !== "string") return
  const hex = value.trim().replace(/^(?:0x|#)/i, "")
  if (/^[0-9a-f]{6}$/i.test(hex)) return `#${hex}`
  if (!/^[0-9a-f]{8}$/i.test(hex)) return
  const alpha = Number.parseInt(hex.slice(0, 2), 16) / 255
  const [red, green, blue] = [2, 4, 6].map((at) => Number.parseInt(hex.slice(at, at + 2), 16))
  return `rgba(${red}, ${green}, ${blue}, ${Number(alpha.toFixed(3))})`
}

/** The visual's slice recoloured to `color`, keeping its alpha (Sogou recolours built-in glyphs this way). */
export async function tintedVisual(visual: Visual, color: string): Promise<Visual> {
  if (!visual.image || !visual.source || typeof OffscreenCanvas === "undefined") return visual
  const [x, y, width, height] = visual.source
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext("2d")
  if (!context) return visual
  context.drawImage(visual.image, x, y, width, height, 0, 0, width, height)
  context.globalCompositeOperation = "source-in"
  context.fillStyle = color
  context.fillRect(0, 0, width, height)
  return { ...visual, image: await createImageBitmap(canvas), source: [0, 0, width, height] }
}
