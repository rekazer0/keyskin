// 手心皮肤的图集：`skin.json` 的 `info` 记录每张图集的切片，图集本身是同名 PNG。
//
// 切片表只描述位置与内边距，图片在包里；IR 把每片切出来单独存，
// 导出时再重新打包，和百度皮肤的图集处理保持一致。
import type { Json, JsonObject } from "@/palm/sxi-ini.ts"
import { asObject } from "@/palm/sxi-ini.ts"
import { cutTiles, type TileSlice, type SkinImage } from "@/skin-model/image.ts"
import { decodePng } from "@/raster.ts"

/** 切片表里一片的矩形与内边距。 */
function rectOf(value: Json): readonly [number, number, number, number] | undefined {
  if (!Array.isArray(value) || value.length < 4) return
  const parts = value.slice(0, 4).map(Number)
  return parts.every(Number.isFinite) ? [parts[0], parts[1], parts[2], parts[3]] : undefined
}

/** 一个图集的切片列表 → 切图描述；没有矩形信息的切片跳过。 */
function slicesOf(tiles: Json): TileSlice[] {
  if (!Array.isArray(tiles)) return []
  return tiles.flatMap((tile, index) => {
    const record = asObject(tile)
    const source = record ? rectOf(record.rect1) : undefined
    if (!record || !source) return []
    return [{ index, source }]
  })
}

/** 图集文件名：切片表的键是不带扩展名的包内路径。 */
function imagePathOf(files: ReadonlyMap<string, Uint8Array>, name: string): string | undefined {
  const wanted = `${name}.png`
  const direct = [...files.keys()].find((path) => path === wanted)
  if (direct) return direct
  const suffix = [...files.keys()].find((path) => path.endsWith(`/${wanted}`))
  if (suffix) return suffix
  return [...files.keys()].find((path) => (path.split("/").pop() ?? "").toLowerCase() === wanted.toLowerCase())
}

/**
 * 把 `info` 里的图集切成独立图片。
 * 返回的键是 `图集名#序号`，与百度皮肤的切片命名一致。
 */
export function atlasImagesOf(
  skin: JsonObject,
  files: ReadonlyMap<string, Uint8Array>,
  theme: string,
  orientation: string,
): { images: Map<string, SkinImage>; atlases: string[]; missing: string[] } {
  const root = asObject(skin.default) ?? skin
  const struct = asObject(root[theme]) ?? {}
  const shared = asObject(struct.s_info) ?? {}
  const own = asObject(struct[orientation === "land" ? "s_land" : "s_port"]) ?? {}
  const table = { ...asObject(shared.info), ...asObject(own.info) }
  const images = new Map<string, SkinImage>()
  const atlases: string[] = []
  const missing: string[] = []
  for (const [name, tiles] of Object.entries(table)) {
    const path = imagePathOf(files, name)
    if (!path) {
      missing.push(name)
      continue
    }
    const bytes = files.get(path)
    if (!bytes) {
      missing.push(name)
      continue
    }
    let atlas: SkinImage
    try {
      atlas = decodePng(bytes)
    } catch {
      missing.push(name)
      continue
    }
    atlases.push(name)
    for (const [id, image] of cutTiles(atlas, slicesOf(tiles), name)) images.set(id, image)
  }
  return { images, atlases, missing }
}
