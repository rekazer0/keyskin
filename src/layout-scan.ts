import type { TileRect } from "./tiles.ts"

// 替换键盘样式用的图像分析：把 PNG 像素按 alpha 通道转成墨迹掩码，
// 再按“空白行/空白列”切出按键网格单元。纯函数，node 可直接测试。

export function alphaMask(pixels: Uint8ClampedArray, width: number, height: number, threshold = 8): Uint8Array {
  const mask = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      mask[y * width + x] = pixels[(y * width + x) * 4 + 3] > threshold ? 1 : 0
    }
  }
  return mask
}

function bandSpans(values: Uint8Array, length: number, minSpan: number): Array<[number, number]> {
  const spans: Array<[number, number]> = []
  let start = -1
  for (let i = 0; i <= length; i += 1) {
    const filled = i < length && values[i] > 0
    if (filled && start < 0) start = i
    if (!filled && start >= 0) {
      if (i - start >= minSpan) spans.push([start, i])
      start = -1
    }
  }
  return spans
}

export function detectGridCells(mask: Uint8Array, width: number, height: number, minSpan = 3): TileRect[] {
  if (!mask.length || width <= 0 || height <= 0) return []
  // 水平投影：某一行有墨迹记为 1，无墨迹（整行透明）即为行间空白
  const rowFilled = new Uint8Array(height)
  for (let y = 0; y < height; y += 1) {
    let filled = 0
    for (let x = 0; x < width; x += 1) {
      if (mask[y * width + x]) { filled = 1; break }
    }
    rowFilled[y] = filled
  }
  const rows = bandSpans(rowFilled, height, minSpan)
  const cells: TileRect[] = []
  for (const [top, bottom] of rows) {
    // 带内垂直投影：列有墨迹为 1，列间空白分开按键
    const colFilled = new Uint8Array(width)
    for (let x = 0; x < width; x += 1) {
      let filled = 0
      for (let y = top; y < bottom; y += 1) {
        if (mask[y * width + x]) { filled = 1; break }
      }
      colFilled[x] = filled
    }
    for (const [left, right] of bandSpans(colFilled, width, minSpan)) {
      cells.push([left, top, right - left, bottom - top])
    }
  }
  return cells
}

// 不透明图集（没有透明间隔、靠 1px 分隔线隔开）：按分隔线递归 XY 切分。
// 某行/列在当前区域内 90% 以上是“与两侧颜色都不同”的细线像素即算切口，容忍线条在端点被其他色块截断。
export function detectLineCells(pixels: Uint8ClampedArray, width: number, height: number, minSpan = 3): TileRect[] {
  const differs = (a: number, b: number) => {
    const i = a * 4
    const j = b * 4
    return Math.abs(pixels[i] - pixels[j]) + Math.abs(pixels[i + 1] - pixels[j + 1]) +
      Math.abs(pixels[i + 2] - pixels[j + 2]) + Math.abs(pixels[i + 3] - pixels[j + 3]) > 24
  }
  const linePixel = (x: number, y: number, horizontal: boolean) => {
    const i = y * width + x
    const before = horizontal ? (y > 0 ? i - width : -1) : (x > 0 ? i - 1 : -1)
    const after = horizontal ? (y < height - 1 ? i + width : -1) : (x < width - 1 ? i + 1 : -1)
    return (before >= 0 || after >= 0) && (before < 0 || differs(i, before)) && (after < 0 || differs(i, after))
  }
  // 返回区域内沿 horizontal 方向（按行）或按列的非分隔线条带，坐标为绝对值
  const bands = (x: number, y: number, w: number, h: number, horizontal: boolean): Array<[number, number]> => {
    const length = horizontal ? h : w
    const span = horizontal ? w : h
    const filled = new Uint8Array(length)
    for (let i = 0; i < length; i += 1) {
      let lines = 0
      for (let j = 0; j < span; j += 1) {
        if (horizontal ? linePixel(x + j, y + i, true) : linePixel(x + i, y + j, false)) lines += 1
      }
      filled[i] = lines >= span * 0.9 ? 0 : 1
    }
    const origin = horizontal ? y : x
    return bandSpans(filled, length, minSpan).map(([start, end]) => [origin + start, origin + end])
  }
  const cut = (x: number, y: number, w: number, h: number): TileRect[] => {
    const rows = bands(x, y, w, h, true)
    if (rows.length > 1) return rows.flatMap(([top, bottom]) => cut(x, top, w, bottom - top))
    const cols = bands(x, y, w, h, false)
    if (cols.length > 1) return cols.flatMap(([left, right]) => cut(left, y, right - left, h))
    if (!rows.length || !cols.length) return []
    const [[top, bottom]] = rows
    const [[left, right]] = cols
    return [[left, top, right - left, bottom - top]]
  }
  return width > 0 && height > 0 && pixels.length >= width * height * 4 ? cut(0, 0, width, height) : []
}
