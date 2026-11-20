// 统一图片资源：IR 只持有像素与尺寸，不持有文件路径，也不依赖原包。
//
// 导入时把图集按切片裁成独立图片，导出时把用到的图片重新排进一张雪碧图；
// 这样任何格式都能在不看源包的情况下重建全部图片。
import type { Point, Size } from "taffy-layout"
import { cropImage, type RgbaImage } from "@/raster.ts"

export type SkinImage = RgbaImage
export type SkinImages = ReadonlyMap<string, SkinImage>

/** 图集里一条切片的源区域，与 `.til` 的 `SOURCE_RECT` 同义；与模型的 `Atlas` 切片是不同概念。 */
export type TileSlice = { index: number; source: readonly [number, number, number, number] }

/** 一张图集里所有可用的切片，键为 `<前缀>#<序号>`。 */
export function cutTiles(atlas: SkinImage, slices: readonly TileSlice[], prefix: string): Array<[string, SkinImage]> {
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

/** 一页图集：像素与页内切片。 */
export type AtlasPage = { image: SkinImage; placements: AtlasPlacement[] }

/**
 * 行式打包：按高度降序逐行排布，超过页宽换行、超过页高换页。
 * 图片比整页还大时单独占一页并裁到页尺寸，避免无限放大。
 */
export function packAtlasPages(images: SkinImages, maxWidth = 2048, maxHeight = 2048): AtlasPage[] {
  const entries = [...images].sort((left, right) => right[1].height - left[1].height || left[0].localeCompare(right[0]))
  const pages: AtlasPage[] = []
  let placements: AtlasPlacement[] = []
  let cursorX = 0
  let cursorY = 0
  let rowHeight = 0
  let width = 0
  const flush = () => {
    if (!placements.length) return
    const height = cursorY + rowHeight
    const data = new Uint8Array(Math.max(1, width) * Math.max(1, height) * 4)
    for (const placement of placements) {
      const image = images.get(placement.id)
      if (!image) continue
      for (let row = 0; row < placement.size.height; row++) {
        const from = row * image.width * 4
        const to = ((placement.position.y + row) * width + placement.position.x) * 4
        data.set(image.data.subarray(from, from + image.width * 4), to)
      }
    }
    pages.push({ image: { width: Math.max(1, width), height: Math.max(1, height), data }, placements })
    placements = []
    cursorX = 0
    cursorY = 0
    rowHeight = 0
    width = 0
  }
  for (const [id, image] of entries) {
    const fitWidth = Math.min(image.width, maxWidth)
    const fitHeight = Math.min(image.height, maxHeight)
    // 比整页还大的图独占一页并裁到页尺寸，不把其它切片挤到下一页。
    if (image.width > maxWidth || image.height > maxHeight) {
      flush()
      placements.push({ id, position: { x: 0, y: 0 }, size: { width: fitWidth, height: fitHeight } })
      cursorX = fitWidth
      rowHeight = fitHeight
      width = fitWidth
      flush()
      continue
    }
    if (cursorX > 0 && cursorX + fitWidth > maxWidth) {
      cursorY += rowHeight + GAP
      cursorX = 0
      rowHeight = 0
    }
    if (cursorY + fitHeight > maxHeight) flush()
    placements.push({ id, position: { x: cursorX, y: cursorY }, size: { width: fitWidth, height: fitHeight } })
    cursorX += fitWidth + GAP
    rowHeight = Math.max(rowHeight, fitHeight)
    width = Math.max(width, cursorX - GAP)
  }
  flush()
  return pages.length ? pages : [{ image: { width: 1, height: 1, data: new Uint8Array(4) }, placements: [] }]
}

/** 单页打包，供只放得下一页的调用方使用。 */
export function packAtlas(images: SkinImages, maxWidth = 2048, maxHeight = 2048): PackedAtlas {
  const [page] = packAtlasPages(images, maxWidth, maxHeight)
  return { image: page.image, placements: page.placements }
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

const bitmaps = new WeakMap<SkinImage, Promise<ImageBitmap | undefined>>()

/** IR 的像素转位图；按图片对象缓存，同一张图只解一次。非浏览器环境没有位图。 */
export function bitmapOf(image: SkinImage): Promise<ImageBitmap | undefined> {
  let result = bitmaps.get(image)
  if (!result) {
    result = typeof createImageBitmap === "function"
      ? createImageBitmap(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height)).catch(() => undefined)
      : Promise.resolve(undefined)
    bitmaps.set(image, result)
  }
  return result
}
