// 手心皮肤的图集：`s_info.info` 按组名存切片，`a_i` 是第二张无组名的切片表。
//
// 切片表只描述区域；图片是主题目录下的同名文件。IR 把整图与切片都放进图片表，
// 图层引用切片（`<图片路径>#IMG27`），整图留着供导出重新打包。
import type { Json, JsonObject } from "@/palm/sxi-ini.ts"
import { cropImage, decodePng } from "@/raster.ts"
import type { Atlas, AtlasSlice } from "@/skin-model/atlas.ts"
import type { SkinImage } from "@/skin-model/image.ts"
import type { Theme } from "@/skin-model/types.ts"
import { arrayOf, boxOf, boxJson, numberOf, objectOf, textOf } from "./json.ts"

/** 图集读取结果：切出来的图片、图集表，以及「图集名 + 切片编号」到图片 id 的查找。 */
export type SxiAtlasRead = {
  atlases: Atlas[]
  images: Map<string, SkinImage>
  /** `s_2` 的引用是「图集名,序号」；序号拼成切片 id（`IMG27`）。 */
  lookup: (name: string, slice: string) => string | undefined
}

const EXTENSIONS = ["png", "webp", "jpg", "jpeg"]

/** 图集图片在包里的路径；主题目录优先，其次按文件名放宽。 */
function imagePathOf(files: ReadonlyMap<string, Uint8Array>, theme: Theme, name: string): string | undefined {
  const directories = [`${theme}/skin/res/`, `${theme}/res/`, `${theme}/land/res/`, `${theme}/port/res/`]
  for (const extension of EXTENSIONS) {
    for (const directory of directories) {
      const path = `${directory}${name}.${extension}`
      if (files.has(path)) return path
    }
  }
  return [...files.keys()].find((path) => {
    const leaf = path.split("/").pop() ?? ""
    const stem = leaf.replace(/\.[^.]+$/, "")
    return stem === name && /\.(?:png|webp|jpe?g)$/i.test(leaf)
  })
}

/** 切片编号：`IMG27`；`s_2` 里写成 `27`。 */
function sliceIdOf(slice: string): string {
  return /^IMG/i.test(slice) ? slice : `IMG${slice.trim()}`
}

function sliceOf(record: JsonObject): AtlasSlice | undefined {
  const rect = boxOf(record.rect1)
  const id = textOf(record.id)
  if (!rect || !id) return
  const extra = new Map<string, unknown>()
  if (record.rect2 !== undefined) extra.set("rect2", record.rect2)
  if (record.scales !== undefined) extra.set("scales", record.scales)
  if (record.alpha !== undefined) extra.set("alpha", record.alpha)
  return { id, rect, ...(extra.size ? { extra } : {}) }
}

/** 切片图片 id：带主题与图集名，`s_2` 的组名（可能带路径）才能原样反解。 */
function imageIdOf(theme: Theme, name: string, slice: string): string {
  return `sxi:${theme}:${name}#${slice}`
}

/** 一个图集组：切片表 + 源图；能切出来的切片同时进图片表。 */
function atlasOf(
  images: Map<string, SkinImage>,
  files: ReadonlyMap<string, Uint8Array>,
  theme: Theme,
  name: string,
  records: Json[],
): Atlas | undefined {
  const slices = records.flatMap((record) => {
    const parsed = objectOf(record)
    const slice = parsed ? sliceOf(parsed) : undefined
    return slice ? [slice] : []
  })
  if (!slices.length) return
  const source = imagePathOf(files, theme, name)
  if (!source) return { name, source: "", slices }
  const bytes = files.get(source)
  if (!bytes) return { name, source: "", slices }
  try {
    const image = decodePng(bytes)
    images.set(source, image)
    for (const slice of slices) {
      const rect = slice.rect
      if (rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.height <= 0) continue
      if (rect.x + rect.width > image.width || rect.y + rect.height > image.height) continue
      images.set(imageIdOf(theme, name, slice.id), cropImage(image, rect.x, rect.y, rect.width, rect.height))
    }
  } catch {
    // 解不出来的不是图片；切片表仍然保留，导出时按原值写回。
  }
  return { name, source, slices }
}

/**
 * 读一个主题方向的图集。
 * `info` 来自 `s_info.info`（横屏时再叠 `s_land.info`）；`extra` 是 `a_i` 这种无组名的切片表。
 */
export function atlasesOfTheme(
  info: JsonObject,
  extra: Json[],
  theme: Theme,
  files: ReadonlyMap<string, Uint8Array>,
): SxiAtlasRead {
  const images = new Map<string, SkinImage>()
  const atlases: Atlas[] = []
  for (const [name, value] of Object.entries(info)) {
    const atlas = atlasOf(images, files, theme, name, arrayOf(value))
    if (atlas) atlases.push(atlas)
  }
  for (const value of extra) {
    const parsed = objectOf(value)
    const slice = parsed ? sliceOf(parsed) : undefined
    if (!slice) continue
    const existing = atlases.find((entry) => entry.name === "a_i")
    if (existing) existing.slices.push(slice)
    else atlases.push({ name: "a_i", source: "", slices: [slice] })
  }
  const lookup = (name: string, slice: string): string | undefined => {
    const atlas = atlases.find((entry) => entry.name === name)
    if (!atlas?.source) return
    const id = sliceIdOf(slice)
    if (!atlas.slices.some((entry) => entry.id === id)) return
    const image = imageIdOf(theme, atlas.name, id)
    return images.has(image) ? image : undefined
  }
  return { atlases, images, lookup }
}

/** 切片表写回：`info` 与 `a_i` 分成两张表，`rect2`/`scales`/`alpha` 按原值写。 */
export function atlasesJson(atlases: readonly Atlas[]): { info: JsonObject; a_i: Json[] } {
  const info: JsonObject = {}
  const a_i: Json[] = []
  for (const atlas of atlases) {
    const records = atlas.slices.map((slice) => {
      const record: JsonObject = { id: slice.id, rect1: boxJson(slice.rect) }
      const rect2 = slice.extra?.get("rect2")
      if (rect2 !== undefined) record.rect2 = rect2 as Json
      const alpha = slice.extra?.get("alpha")
      record.alpha = numberOf(alpha as Json | undefined) ?? 1
      const scales = slice.extra?.get("scales")
      record.scales = Array.isArray(scales) ? scales as Json[] : []
      return record
    })
    if (atlas.name === "a_i") a_i.push(...records)
    // 源图缺失的图集（实测有 `migration/joined/plate0` 这种）只丢了图片，切片表仍要写回。
    else info[atlas.name] = records
  }
  return { info, a_i }
}
