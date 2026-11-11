// Minimal PNG codec for skin conversion: Sogou foregrounds need transparent padding and Baidu atlas
// slices need cropping into standalone files. Conversion also runs in Node tests, so it cannot rely on
// canvas. Encoding keeps an exact palette when possible, otherwise RGBA8; no colour quantisation.

import { unzlibSync, zlibSync } from "fflate"

export type RgbaImage = { width: number; height: number; data: Uint8Array }

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]
/** Largest image decoded or built: 4096 × 4096, far above any keyboard skin image. */
export const MAX_PIXELS = 4096 * 4096
const ADAM7 = [
  [0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4],
  [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2],
] as const

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 24 && SIGNATURE.every((byte, index) => bytes[index] === byte)
}

export function pngSize(bytes: Uint8Array): [number, number] | undefined {
  if (!isPng(bytes)) return
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return [view.getUint32(16), view.getUint32(20)]
}

function channels(colorType: number): number {
  const count = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType]
  if (!count) throw new Error(`不支持的 PNG 颜色类型：${colorType}`)
  return count
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/** Reverses the scanline filters of one (sub)image in place and returns its raw rows. */
function unfilter(data: Uint8Array, offset: number, width: number, height: number, bitsPerPixel: number): { rows: Uint8Array; end: number } {
  const stride = Math.ceil(width * bitsPerPixel / 8)
  const bpp = Math.max(1, bitsPerPixel >> 3)
  const rows = new Uint8Array(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = data[offset++]
    if (offset + stride > data.length) throw new Error("PNG 数据不完整")
    const row = y * stride
    const previous = row - stride
    for (let x = 0; x < stride; x++) {
      const raw = data[offset + x]
      const left = x >= bpp ? rows[row + x - bpp] : 0
      const up = y ? rows[previous + x] : 0
      const upLeft = y && x >= bpp ? rows[previous + x - bpp] : 0
      const predictor = filter === 0 ? 0
        : filter === 1 ? left
          : filter === 2 ? up
            : filter === 3 ? (left + up) >> 1
              : filter === 4 ? paeth(left, up, upLeft)
                : -1
      if (predictor < 0) throw new Error(`PNG 滤波类型无效：${filter}`)
      rows[row + x] = (raw + predictor) & 0xff
    }
    offset += stride
  }
  return { rows, end: offset }
}

export function decodePng(bytes: Uint8Array): RgbaImage {
  if (!isPng(bytes)) throw new Error("不是有效的 PNG")
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let width = 0
  let height = 0
  let depth = 0
  let colorType = 0
  let interlace = 0
  let palette: Uint8Array = new Uint8Array()
  let transparency: Uint8Array = new Uint8Array()
  const idat: Uint8Array[] = []
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = view.getUint32(offset)
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    const body = bytes.subarray(offset + 8, offset + 8 + length)
    if (body.length !== length) throw new Error("PNG 数据不完整")
    if (type === "IHDR") {
      width = view.getUint32(offset + 8)
      height = view.getUint32(offset + 12)
      depth = body[8]
      colorType = body[9]
      interlace = body[12]
    } else if (type === "PLTE") palette = body
    else if (type === "tRNS") transparency = body
    else if (type === "IDAT") idat.push(body)
    else if (type === "IEND") break
    offset += 12 + length
  }
  if (!width || !height || width * height > MAX_PIXELS) throw new Error("PNG 尺寸无效")
  const sampleCount = channels(colorType)
  const bitsPerPixel = sampleCount * depth
  const compressed = new Uint8Array(idat.reduce((total, part) => total + part.length, 0))
  idat.reduce((offset, part) => (compressed.set(part, offset), offset + part.length), 0)
  const inflated = unzlibSync(compressed)
  const output = new Uint8Array(width * height * 4)
  const maxSample = (1 << Math.min(depth, 8)) - 1
  const transparentKey = transparency.length >= 2 && colorType !== 3
    ? Array.from({ length: colorType === 2 ? 3 : 1 }, (_, index) => (transparency[index * 2] << 8) | transparency[index * 2 + 1])
    : undefined

  const sample = (rows: Uint8Array, rowStart: number, index: number): number => {
    if (depth === 16) return (rows[rowStart + index * 2] << 8) | rows[rowStart + index * 2 + 1]
    if (depth === 8) return rows[rowStart + index]
    const bit = index * depth
    return (rows[rowStart + (bit >> 3)] >> (8 - depth - (bit & 7))) & maxSample
  }
  const to8 = (value: number) => depth === 16 ? value >> 8 : depth === 8 ? value : Math.round(value * 255 / maxSample)

  const writePixel = (rows: Uint8Array, rowStart: number, x: number, target: number) => {
    const first = x * sampleCount
    const v0 = sample(rows, rowStart, first)
    if (colorType === 3) {
      output[target] = palette[v0 * 3] ?? 0
      output[target + 1] = palette[v0 * 3 + 1] ?? 0
      output[target + 2] = palette[v0 * 3 + 2] ?? 0
      output[target + 3] = transparency[v0] ?? 255
    } else if (colorType === 0 || colorType === 4) {
      output[target] = output[target + 1] = output[target + 2] = to8(v0)
      output[target + 3] = colorType === 4 ? to8(sample(rows, rowStart, first + 1)) : transparentKey?.[0] === v0 ? 0 : 255
    } else {
      const v1 = sample(rows, rowStart, first + 1)
      const v2 = sample(rows, rowStart, first + 2)
      output[target] = to8(v0)
      output[target + 1] = to8(v1)
      output[target + 2] = to8(v2)
      output[target + 3] = colorType === 6 ? to8(sample(rows, rowStart, first + 3))
        : transparentKey && transparentKey[0] === v0 && transparentKey[1] === v1 && transparentKey[2] === v2 ? 0 : 255
    }
  }

  if (interlace === 1) {
    let offset = 0
    for (const [startX, startY, stepX, stepY] of ADAM7) {
      const passWidth = Math.ceil((width - startX) / stepX)
      const passHeight = Math.ceil((height - startY) / stepY)
      if (passWidth <= 0 || passHeight <= 0) continue
      const pass = unfilter(inflated, offset, passWidth, passHeight, bitsPerPixel)
      offset = pass.end
      const stride = Math.ceil(passWidth * bitsPerPixel / 8)
      for (let y = 0; y < passHeight; y++) {
        for (let x = 0; x < passWidth; x++) {
          writePixel(pass.rows, y * stride, x, ((startY + y * stepY) * width + startX + x * stepX) * 4)
        }
      }
    }
  } else {
    const { rows } = unfilter(inflated, 0, width, height, bitsPerPixel)
    const stride = Math.ceil(width * bitsPerPixel / 8)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) writePixel(rows, y * stride, x, (y * width + x) * 4)
    }
  }
  return { width, height, data: output }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const output = new Uint8Array(12 + body.length)
  const view = new DataView(output.buffer)
  view.setUint32(0, body.length)
  for (let index = 0; index < 4; index++) output[4 + index] = type.charCodeAt(index)
  output.set(body, 8)
  view.setUint32(8 + body.length, crc32(output.subarray(4, 8 + body.length)))
  return output
}

export function encodePng(image: RgbaImage): Uint8Array {
  const { width, height, data } = image
  if (data.length !== width * height * 4) throw new Error("RGBA 数据长度与尺寸不一致")
  const colors = new Map<number, number>()
  const pixels = new DataView(data.buffer, data.byteOffset, data.byteLength)
  for (let offset = 0; offset < data.length && colors.size <= 256; offset += 4) {
    const color = pixels.getUint32(offset)
    if (!colors.has(color)) colors.set(color, colors.size)
  }
  const indexed = colors.size <= 256
  const samples = indexed ? new Uint8Array(width * height) : data
  const palette = new Uint8Array(indexed ? colors.size * 3 : 0)
  const alpha = new Uint8Array(indexed ? colors.size : 0)
  if (indexed) {
    for (const [color, index] of colors) {
      palette.set([color >>> 24, (color >>> 16) & 255, (color >>> 8) & 255], index * 3)
      alpha[index] = color & 255
    }
    for (let offset = 0; offset < data.length; offset += 4) samples[offset / 4] = colors.get(pixels.getUint32(offset))!
  }
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header.set([8, indexed ? 3 : 6, 0, 0, 0], 8)
  const bpp = indexed ? 1 : 4
  const stride = width * bpp
  const raw = new Uint8Array((stride + 1) * height)
  // Sub, Up and Paeth residuals of a row are worked out in one pass; the row keeps whichever sums smallest.
  const sub = new Uint8Array(stride)
  const up = new Uint8Array(stride)
  const paethRow = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const row = y * stride
    const above = row - stride
    let subScore = 0
    let upScore = 0
    let paethScore = 0
    for (let x = 0; x < stride; x++) {
      const value = samples[row + x]
      const left = x >= bpp ? samples[row + x - bpp] : 0
      const top = y ? samples[above + x] : 0
      const topLeft = y && x >= bpp ? samples[above + x - bpp] : 0
      const fromLeft = (value - left) & 255
      const fromTop = (value - top) & 255
      const fromPaeth = (value - paeth(left, top, topLeft)) & 255
      sub[x] = fromLeft
      up[x] = fromTop
      paethRow[x] = fromPaeth
      subScore += fromLeft < 128 ? fromLeft : 256 - fromLeft
      upScore += fromTop < 128 ? fromTop : 256 - fromTop
      paethScore += fromPaeth < 128 ? fromPaeth : 256 - fromPaeth
    }
    const target = y * (stride + 1)
    const best = subScore <= upScore && subScore <= paethScore ? 0 : upScore <= paethScore ? 1 : 2
    raw[target] = best === 0 ? 1 : best === 1 ? 2 : 4
    raw.set(best === 0 ? sub : best === 1 ? up : paethRow, target + 1)
  }
  const parts = [new Uint8Array(SIGNATURE), chunk("IHDR", header),
    ...indexed ? [chunk("PLTE", palette), chunk("tRNS", alpha)] : [],
    chunk("IDAT", zlibSync(raw, { level: 6 })), chunk("IEND", new Uint8Array())]
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  parts.reduce((offset, part) => (output.set(part, offset), offset + part.length), 0)
  return output
}

/** Places `image` on a transparent canvas of the given size, clipping anything outside it. */
export function placeImage(image: RgbaImage, width: number, height: number, x: number, y: number): RgbaImage {
  const data = new Uint8Array(width * height * 4)
  for (let row = 0; row < image.height; row++) {
    const targetY = row + y
    if (targetY < 0 || targetY >= height) continue
    const startX = Math.max(0, x)
    const endX = Math.min(width, x + image.width)
    if (startX >= endX) continue
    const source = (row * image.width + (startX - x)) * 4
    data.set(image.data.subarray(source, source + (endX - startX) * 4), (targetY * width + startX) * 4)
  }
  return { width, height, data }
}

export function cropImage(image: RgbaImage, x: number, y: number, width: number, height: number): RgbaImage {
  return placeImage(image, width, height, -x, -y)
}

/** Bilinear resize on premultiplied alpha, so transparent edges do not bleed dark fringes. */
export function resizeImage(image: RgbaImage, width: number, height: number): RgbaImage {
  if (width === image.width && height === image.height) return image
  // Bilinear at exactly half size averages 2×2 blocks; halving first keeps big shrinks from aliasing.
  if (image.width > width * 2 && image.height > height * 2) {
    return resizeImage(resizeImage(image, Math.round(image.width / 2), Math.round(image.height / 2)), width, height)
  }
  const data = new Uint8Array(width * height * 4)
  const source = image.data
  // Column offsets and weights are the same on every row; working them out once keeps the loop allocation-free.
  const x0s = new Int32Array(width)
  const x1s = new Int32Array(width)
  const fxs = new Float64Array(width)
  for (let x = 0; x < width; x++) {
    const sx = Math.min(image.width - 1, Math.max(0, (x + 0.5) * image.width / width - 0.5))
    const x0 = Math.floor(sx)
    x0s[x] = x0 * 4
    x1s[x] = Math.min(image.width - 1, x0 + 1) * 4
    fxs[x] = sx - x0
  }
  for (let y = 0; y < height; y++) {
    const sy = Math.min(image.height - 1, Math.max(0, (y + 0.5) * image.height / height - 0.5))
    const y0 = Math.floor(sy)
    const row0 = y0 * image.width * 4
    const row1 = Math.min(image.height - 1, y0 + 1) * image.width * 4
    const fy = sy - y0
    for (let x = 0; x < width; x++) {
      const fx = fxs[x]
      const a00 = row0 + x0s[x]
      const a01 = row0 + x1s[x]
      const a10 = row1 + x0s[x]
      const a11 = row1 + x1s[x]
      const w00 = source[a00 + 3] * ((1 - fx) * (1 - fy))
      const w01 = source[a01 + 3] * (fx * (1 - fy))
      const w10 = source[a10 + 3] * ((1 - fx) * fy)
      const w11 = source[a11 + 3] * (fx * fy)
      const alpha = w00 + w01 + w10 + w11
      const red = source[a00] * w00 + source[a01] * w01 + source[a10] * w10 + source[a11] * w11
      const green = source[a00 + 1] * w00 + source[a01 + 1] * w01 + source[a10 + 1] * w10 + source[a11 + 1] * w11
      const blue = source[a00 + 2] * w00 + source[a01 + 2] * w01 + source[a10 + 2] * w10 + source[a11 + 2] * w11
      const target = (y * width + x) * 4
      if (alpha > 0) {
        data[target] = Math.round(red / alpha)
        data[target + 1] = Math.round(green / alpha)
        data[target + 2] = Math.round(blue / alpha)
      }
      data[target + 3] = Math.round(alpha)
    }
  }
  return { width, height, data }
}

/** Source-over composite of `top` onto `bottom`; both must have the same size. */
export function compositeImage(bottom: RgbaImage, top: RgbaImage): RgbaImage {
  if (bottom.width !== top.width || bottom.height !== top.height) throw new Error("合成图片尺寸不一致")
  const data = new Uint8Array(bottom.data.length)
  for (let offset = 0; offset < data.length; offset += 4) {
    const topAlpha = top.data[offset + 3] / 255
    const bottomAlpha = bottom.data[offset + 3] / 255
    const alpha = topAlpha + bottomAlpha * (1 - topAlpha)
    for (let channel = 0; channel < 3; channel++) {
      data[offset + channel] = alpha
        ? Math.round((top.data[offset + channel] * topAlpha + bottom.data[offset + channel] * bottomAlpha * (1 - topAlpha)) / alpha)
        : 0
    }
    data[offset + 3] = Math.round(alpha * 255)
  }
  return { width: bottom.width, height: bottom.height, data }
}

/** Recolours every pixel to `argb` (AARRGGBB hex), keeping the image's own alpha as the glyph mask. */
export function tintImage(image: RgbaImage, argb: string): RgbaImage {
  const value = Number.parseInt(argb, 16) >>> 0
  const alpha = (value >>> 24) / 255
  const data = new Uint8Array(image.data.length)
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = (value >>> 16) & 0xff
    data[offset + 1] = (value >>> 8) & 0xff
    data[offset + 2] = value & 0xff
    data[offset + 3] = Math.round(image.data[offset + 3] * alpha)
  }
  return { width: image.width, height: image.height, data }
}

/** Keeps only the white parts of a mark (Sogou's logo is a white S on a translucent orange tile), fully opaque. */
export function whiteMask(image: RgbaImage): RgbaImage {
  const data = new Uint8Array(image.data)
  for (let offset = 0; offset < data.length; offset += 4) {
    // The tile's palest orange still has a channel near 64; only lighter pixels belong to the mark.
    const light = Math.min(data[offset], data[offset + 1], data[offset + 2])
    data[offset + 3] = data[offset + 3] ? Math.max(0, Math.round((light - 64) * 255 / 191)) : 0
  }
  return { width: image.width, height: image.height, data }
}

/** Paints the atlas borders at their design size and stretches only the inner band. */
function axis(size: number, leading: number, trailing: number): [number, number, number, number] {
  const scale = leading + trailing > size ? size / (leading + trailing) : 1
  const first = Math.round(leading * scale)
  return [0, first, Math.max(first, Math.round(size - trailing * scale)), size]
}

export function nineSliceImage(image: RgbaImage, source: readonly number[], inner: readonly number[], width: number, height: number): RgbaImage {
  const [x, y, sw, sh] = source
  const [ix, iy, iw, ih] = inner
  const xs = [0, ix - x, ix - x + iw, sw]
  const ys = [0, iy - y, iy - y + ih, sh]
  const dx = axis(width, xs[1], sw - xs[2])
  const dy = axis(height, ys[1], sh - ys[2])
  const data = new Uint8Array(width * height * 4)
  for (let row = 0; row < 3; row++) for (let column = 0; column < 3; column++) {
    const sourceWidth = xs[column + 1] - xs[column]
    const sourceHeight = ys[row + 1] - ys[row]
    const targetWidth = dx[column + 1] - dx[column]
    const targetHeight = dy[row + 1] - dy[row]
    if (Math.min(sourceWidth, sourceHeight, targetWidth, targetHeight) <= 0) continue
    const tile = resizeImage(cropImage(image, x + xs[column], y + ys[row], sourceWidth, sourceHeight), targetWidth, targetHeight)
    for (let yy = 0; yy < targetHeight; yy++) {
      data.set(tile.data.subarray(yy * targetWidth * 4, (yy + 1) * targetWidth * 4),
        ((dy[row] + yy) * width + dx[column]) * 4)
    }
  }
  return { width, height, data }
}
