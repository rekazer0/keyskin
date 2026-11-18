// 统一图片资源：IR 只持有像素与尺寸，不持有文件路径，也不依赖原包。
//
// 导入时把图集按切片裁成独立图片，导出时把用到的图片重新排进一张雪碧图；
// 这样任何格式都能在不看源包的情况下重建全部图片。
import type { Point, Size } from "taffy-layout"
import { cropImage, type RgbaImage } from "@/raster.ts"

export type SkinImage = RgbaImage
export type SkinImages = ReadonlyMap<string, SkinImage>

/** 图集里一条切片的源区域，与 `.til` 的 `SOURCE_RECT` 同义。 */
export type AtlasSlice = { index: number; source: readonly [number, number, number, number] }

/** 一张图集里所有可用的切片，键为 `<前缀>#<序号>`。 */
export function cutTiles(atlas: SkinImage, slices: readonly AtlasSlice[], prefix: string): Array<[string, SkinImage]> {
  return slices.flatMap((slice) => {
    const [x, y, width, height] = slice.source
    if (width <= 0 || height <= 0 || x < 0 || y < 0 || x + width > atlas.width || y + height > atlas.height) return []
    return [[`${prefix}#${slice.index}`, cropImage(atlas, x, y, width, height)] as [string, SkinImage]]
  })
}

/** 打包后每张图片在雪碧图里的位置。 */
export type AtlasPlacement = { id: string; position: Point<number>; size: Size<number> }
export type PackedAtlas = { image: SkinImage; placements: AtlasPlacement[] }

const GAP = 1

/** 行式打包：按高度降序逐行排布，宽度超过上限就换行。 */
export function packAtlas(images: SkinImages, maxWidth = 2048): PackedAtlas {
  const entries = [...images].sort((left, right) => right[1].height - left[1].height || left[0].localeCompare(right[0]))
  const placements: AtlasPlacement[] = []
  const rows: Array<{ y: number; height: number; used: number }> = []
  let cursorX = 0
  let cursorY = 0
  let rowHeight = 0
  let width = 0
  for (const [id, image] of entries) {
    if (cursorX > 0 && cursorX + image.width > maxWidth) {
      cursorY += rowHeight + GAP
      cursorX = 0
      rowHeight = 0
    }
    placements.push({ id, position: { x: cursorX, y: cursorY }, size: { width: image.width, height: image.height } })
    cursorX += image.width + GAP
    rowHeight = Math.max(rowHeight, image.height)
    width = Math.max(width, cursorX - GAP)
  }
  const height = cursorY + rowHeight
  void rows
  const data = new Uint8Array(Math.max(1, width) * Math.max(1, height) * 4)
  for (const placement of placements) {
    const image = images.get(placement.id)
    if (!image) continue
    for (let row = 0; row < image.height; row++) {
      const from = row * image.width * 4
      const to = ((placement.position.y + row) * width + placement.position.x) * 4
      data.set(image.data.subarray(from, from + image.width * 4), to)
    }
  }
  return {
    image: { width: Math.max(1, width), height: Math.max(1, height), data },
    placements,
  }
}

/** 雪碧图的 `.til` 文本：一条切片一个 `[IMGn]`。 */
export function tileDocument(atlas: PackedAtlas, inner: ReadonlyMap<string, readonly [number, number, number, number]>): string {
  const lines = ["[GLOBAL]", `TILE_NUM=${atlas.placements.length}`, ""]
  for (const [index, placement] of atlas.placements.entries()) {
    lines.push(`[IMG${index}]`, `SOURCE_RECT=${placement.position.x},${placement.position.y},${placement.size.width},${placement.size.height}`)
    const insets = inner.get(placement.id)
    if (insets) {
      const [left, top, right, bottom] = insets
      lines.push(`INNER_RECT=${left},${top},${placement.size.width - left - right},${placement.size.height - top - bottom}`)
    }
    lines.push("")
  }
  return `${lines.join("\n")}\n`
}
