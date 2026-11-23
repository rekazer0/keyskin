import { IniDocument } from "./ini.ts"

export type TileRect = [number, number, number, number]

export type TileSlice = {
  index: number
  source: TileRect
  inner?: TileRect
}

export type TilePoint = { x: number; y: number }

export function tilePreviewDestination(sourceWidth: number, sourceHeight: number, canvasSize: number) {
  const scale = Math.min(canvasSize / sourceWidth, canvasSize / sourceHeight) * 0.8
  const width = sourceWidth * scale
  const height = sourceHeight * scale
  return { x: (canvasSize - width) / 2, y: (canvasSize - height) / 2, width, height }
}

export function tilePreviewInnerRect(
  source: readonly [number, number, number, number],
  inner: readonly [number, number, number, number],
  destination: { x: number; y: number; width: number; height: number },
) {
  const [sourceX, sourceY, sourceWidth, sourceHeight] = source
  const [innerX, innerY, innerWidth, innerHeight] = inner
  if (
    sourceWidth <= 0 || sourceHeight <= 0 || innerWidth <= 0 || innerHeight <= 0 ||
    innerX + innerWidth <= sourceX || innerY + innerHeight <= sourceY ||
    innerX >= sourceX + sourceWidth || innerY >= sourceY + sourceHeight
  ) return
  return {
    x: destination.x + ((innerX - sourceX) / sourceWidth) * destination.width,
    y: destination.y + ((innerY - sourceY) / sourceHeight) * destination.height,
    width: (innerWidth / sourceWidth) * destination.width,
    height: (innerHeight / sourceHeight) * destination.height,
  }
}

function rect(value: string | undefined): TileRect | undefined {
  const values = value?.split(",").map(Number)
  if (!values || values.length !== 4 || values.some((item) => !Number.isFinite(item))) return
  return values as TileRect
}

export function tileSlices(document: IniDocument): TileSlice[] {
  return document.sections().flatMap((section) => {
    const match = section.match(/^IMG(\d+)$/i)
    const source = rect(document.get(section, "SOURCE_RECT"))
    if (!match || !source) return []
    const inner = rect(document.get(section, "INNER_RECT"))
    return [{ index: Number(match[1]), source, ...(inner ? { inner } : {}) }]
  }).sort((a, b) => a.index - b.index)
}

export function nextTileIndex(document: IniDocument): number {
  const used = new Set(document.sections().map(tileSectionIndex))
  let index = 1
  while (used.has(index)) index++
  return index
}

const defaultTileScale = "1,1,1,1,1"

export function updateTileSlice(document: IniDocument, slice: TileSlice): void {
  const section = document.sections().find((name) => tileSectionIndex(name) === slice.index) ?? `IMG${slice.index}`
  if (!document.sections().includes(section)) {
    document.appendSection(section, [
      { key: "SOURCE_RECT", value: slice.source.join(",") },
      ...(slice.inner ? [
        { key: "SCALE", value: defaultTileScale },
        { key: "INNER_RECT", value: slice.inner.join(",") },
      ] : []),
    ])
    syncTileCount(document)
    return
  }
  document.set(section, "SOURCE_RECT", slice.source.join(","))
  if (slice.inner) {
    if (document.get(section, "SCALE") === undefined) document.set(section, "SCALE", defaultTileScale)
    document.set(section, "INNER_RECT", slice.inner.join(","))
  } else {
    document.remove(section, "INNER_RECT")
    // 工具书 V6 p44：有 SCALE 无 INNER_RECT 属于错误写法。
    document.remove(section, "SCALE")
  }
}

// 工具书 V6 p43：[GLOBAL] TILE_NUM 必须与切片数量一致。
function syncTileCount(document: IniDocument): void {
  if (document.get("GLOBAL", "TILE_NUM") === undefined) return
  document.set("GLOBAL", "TILE_NUM", String(document.sections().filter((name) => tileSectionIndex(name) !== undefined).length))
}

export function boundedTileRect(
  start: TilePoint,
  end: TilePoint,
  width: number,
  height: number,
): TileRect | undefined {
  const left = Math.round(Math.max(0, Math.min(start.x, end.x, width)))
  const top = Math.round(Math.max(0, Math.min(start.y, end.y, height)))
  const right = Math.round(Math.max(0, Math.min(Math.max(start.x, end.x), width)))
  const bottom = Math.round(Math.max(0, Math.min(Math.max(start.y, end.y), height)))
  if (right <= left || bottom <= top) return
  return [left, top, right - left, bottom - top]
}

export function tileSliceAt(slices: readonly TileSlice[], point: TilePoint): TileSlice | undefined {
  return [...slices].reverse().find(({ source: [x, y, width, height] }) =>
    point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height)
}

export function removeTileSlice(document: IniDocument, index: number): boolean {
  const removed = document.removeSections(document.sections().filter((name) => tileSectionIndex(name) === index))
  if (removed) syncTileCount(document)
  return removed
}

function tileSectionIndex(section: string): number | undefined {
  const match = section.match(/^IMG(\d+)$/i)
  return match ? Number(match[1]) : undefined
}

export function moveTileRect(
  source: TileRect,
  deltaX: number,
  deltaY: number,
  imageWidth: number,
  imageHeight: number,
): TileRect {
  const [x, y, width, height] = source
  return [
    Math.max(0, Math.min(x + deltaX, imageWidth - width)),
    Math.max(0, Math.min(y + deltaY, imageHeight - height)),
    width,
    height,
  ].map(Math.round) as TileRect
}

export function resizeTileSlice(slice: TileSlice, corner: number, point: TilePoint, imageWidth: number, imageHeight: number): TileSlice {
  const [x, y, width, height] = slice.source
  const right = Boolean(corner % 2)
  const bottom = corner >= 2
  const px = Math.round(Math.max(right ? x + 1 : 0, Math.min(point.x, right ? imageWidth : x + width - 1)))
  const py = Math.round(Math.max(bottom ? y + 1 : 0, Math.min(point.y, bottom ? imageHeight : y + height - 1)))
  const source: TileRect = [right ? x : px, bottom ? y : py, right ? px - x : x + width - px, bottom ? py - y : y + height - py]
  const result: TileSlice = { index: slice.index, source }
  if (slice.inner) {
    const ix = Math.max(source[0], slice.inner[0])
    const iy = Math.max(source[1], slice.inner[1])
    const iw = Math.min(source[0] + source[2], slice.inner[0] + slice.inner[2]) - ix
    const ih = Math.min(source[1] + source[3], slice.inner[1] + slice.inner[3]) - iy
    if (iw > 0 && ih > 0) result.inner = [ix, iy, iw, ih]
  }
  return result
}

export function duplicateTileSlice(
  slice: { source: readonly [number, number, number, number]; inner?: readonly [number, number, number, number] },
  index: number,
): TileSlice {
  return {
    index,
    source: [...slice.source],
    ...(slice.inner ? { inner: [...slice.inner] as TileRect } : {}),
  }
}
