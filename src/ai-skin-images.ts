import type { TileRect, TileSlice } from "./tiles.ts"

export type AiSkinImageFile = {
  path: string
  bytes: Uint8Array
  /** The image's slices, as the skin keeps them (a Baidu .til, a Palm tile map in skin.json). */
  slices?: readonly TileSlice[]
}

export type AiSkinImageDraft = { path: string; syntax: "png"; before: Uint8Array; after: Uint8Array }

type Rgb = [number, number, number]

const MAX_VIEW_SIDE = 512
const NEUTRAL_SATURATION = 0.15

export function parseHexColor(value: string): Rgb {
  const match = value.trim().replace(/^#/, "").match(/^(?:[0-9a-f]{2})?([0-9a-f]{6})$/i)
  if (!match) throw new Error("颜色必须是 RRGGBB 或 AARRGGBB")
  const hex = match[1]
  return [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)) as Rgb
}

function toHsl([r, g, b]: Rgb): Rgb {
  const [red, green, blue] = [r / 255, g / 255, b / 255]
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === red ? (green - blue) / d + (green < blue ? 6 : 0) : max === green ? (blue - red) / d + 2 : (red - green) / d + 4
  return [h / 6, s, l]
}

function fromHsl([h, s, l]: Rgb): Rgb {
  if (!s) return [l * 255, l * 255, l * 255]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t: number) => {
    t = (t + 1) % 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return [channel(h + 1 / 3) * 255, channel(h) * 255, channel(h - 1 / 3) * 255]
}

/**
 * Recolours RGBA pixels in place: hue and saturation become the target's, lightness is
 * scaled so the region's average matches the target, keeping gloss, shading and alpha.
 * With preserveNeutral, grey/white/black pixels (glyphs, shadows) are left untouched.
 */
export function tintPixels(data: Uint8ClampedArray, color: Rgb, preserveNeutral = true): number {
  const [hue, saturation, lightness] = toHsl(color)
  const picked: number[] = []
  let total = 0
  for (let index = 0; index < data.length; index += 4) {
    if (!data[index + 3]) continue
    const hsl = toHsl([data[index], data[index + 1], data[index + 2]])
    if (preserveNeutral && hsl[1] < NEUTRAL_SATURATION) continue
    picked.push(index)
    total += hsl[2]
  }
  if (!picked.length) return 0
  const average = total / picked.length || 1
  for (const index of picked) {
    const l = toHsl([data[index], data[index + 1], data[index + 2]])[2]
    const rgb = fromHsl([hue, saturation, Math.min(1, Math.max(0, l * lightness / average))])
    data[index] = rgb[0]
    data[index + 1] = rgb[1]
    data[index + 2] = rgb[2]
  }
  return picked.length
}

export function base64(bytes: Uint8Array): string {
  let binary = ""
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(binary)
}

async function decode(bytes: Uint8Array): Promise<ImageBitmap> {
  return createImageBitmap(new Blob([bytes as BlobPart], { type: "image/png" }))
}

async function encode(canvas: OffscreenCanvas): Promise<Uint8Array> {
  return new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer())
}

function canvas2d(width: number, height: number): [OffscreenCanvas, OffscreenCanvasRenderingContext2D] {
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext("2d", { willReadFrequently: true })
  if (!context) throw new Error("无法创建图片画布")
  return [canvas, context]
}

/** PNG assets the AI may view and redraw; edits stay in memory as drafts. */
export class AiSkinImages {
  private readonly files = new Map<string, AiSkinImageFile>()
  private readonly current = new Map<string, Uint8Array>()

  constructor(files: readonly AiSkinImageFile[]) {
    for (const file of files) this.files.set(file.path, file)
  }

  paths(): string[] {
    return [...this.files.keys()].sort()
  }

  bytes(path: string): Uint8Array {
    const file = this.files.get(path)
    if (!file) throw new Error(`不允许访问未授权图片：${path}`)
    return this.current.get(path) ?? file.bytes
  }

  slices(path: string): Array<{ index: number; rect: TileRect }> {
    this.bytes(path)
    return (this.files.get(path)!.slices ?? []).map((slice) => ({ index: slice.index, rect: slice.source }))
  }

  private rect(path: string, image: ImageBitmap, slice?: number): TileRect {
    if (slice === undefined) return [0, 0, image.width, image.height]
    const found = this.slices(path).find((entry) => entry.index === slice)
    if (!found) throw new Error(`图片 ${path} 没有切片 IMG${slice}`)
    const [x, y, width, height] = found.rect
    if (width <= 0 || height <= 0 || x < 0 || y < 0 || x + width > image.width || y + height > image.height) {
      throw new Error(`切片 IMG${slice} 超出图片范围`)
    }
    return found.rect
  }

  /** Returns a downscaled PNG of the image or one slice, plus its average colour for text-only models. */
  async view(path: string, slice?: number) {
    const image = await decode(this.bytes(path))
    const [x, y, width, height] = this.rect(path, image, slice)
    const scale = Math.min(1, MAX_VIEW_SIDE / Math.max(width, height))
    const [canvas, context] = canvas2d(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)))
    context.drawImage(image, x, y, width, height, 0, 0, canvas.width, canvas.height)
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    const sum = [0, 0, 0, 0]
    for (let index = 0; index < pixels.length; index += 4) {
      const alpha = pixels[index + 3]
      for (let channel = 0; channel < 3; channel++) sum[channel] += pixels[index + channel] * alpha
      sum[3] += alpha
    }
    const averageColor = sum[3]
      ? sum.slice(0, 3).map((value) => Math.round(value / sum[3]).toString(16).padStart(2, "0")).join("").toUpperCase()
      : "透明"
    return {
      info: { path, imageSize: [image.width, image.height], rect: [x, y, width, height], averageColor, slices: slice === undefined ? this.slices(path) : undefined },
      png: base64(await encode(canvas)),
    }
  }

  async recolor(path: string, color: string, slice?: number, preserveNeutral = true): Promise<number> {
    const rgb = parseHexColor(color)
    const image = await decode(this.bytes(path))
    const [x, y, width, height] = this.rect(path, image, slice)
    const [canvas, context] = canvas2d(image.width, image.height)
    context.drawImage(image, 0, 0)
    const region = context.getImageData(x, y, width, height)
    const changed = tintPixels(region.data, rgb, preserveNeutral)
    if (!changed) return 0
    context.putImageData(region, x, y)
    this.current.set(path, await encode(canvas))
    return changed
  }

  /** Draws a generated picture over the image or slice (cover fit); keepShape clips it to the original alpha. */
  async paint(path: string, picture: Uint8Array, slice?: number, keepShape = true): Promise<void> {
    const image = await decode(this.bytes(path))
    const source = await createImageBitmap(new Blob([picture as BlobPart]))
    const [x, y, width, height] = this.rect(path, image, slice)
    const [patch, patchContext] = canvas2d(width, height)
    const scale = Math.max(width / source.width, height / source.height)
    patchContext.drawImage(source, (width - source.width * scale) / 2, (height - source.height * scale) / 2, source.width * scale, source.height * scale)
    if (keepShape) {
      patchContext.globalCompositeOperation = "destination-in"
      patchContext.drawImage(image, x, y, width, height, 0, 0, width, height)
    }
    const [canvas, context] = canvas2d(image.width, image.height)
    context.drawImage(image, 0, 0)
    context.clearRect(x, y, width, height)
    context.drawImage(patch, x, y)
    this.current.set(path, await encode(canvas))
  }

  changes(): AiSkinImageDraft[] {
    return [...this.current].map(([path, after]) => ({ path, syntax: "png" as const, before: this.files.get(path)!.bytes, after }))
  }
}
