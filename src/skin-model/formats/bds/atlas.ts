// BDS 图集：`.til` 切片描述与同名 PNG。
//
// 切片编号 `[IMG<n>]` 是 BDS 的打包细节，不是 IR 的切片标识——`AtlasSlice.id` 是跨格式的
// 稳定标识（BDS 的 `图集#12`、SXI 的 `sxi:default:anjian#IMG1`）。所以读进来时把编号记在
// 切片 `extra.tilIndex`，写回时由 `tilIndexOf` 取回；别的格式转来的切片没有这个字段，
// 按它在数组里的位置从 1 编号。
import type { Atlas, AtlasSlice } from "@/skin-model/atlas.ts"
import type { DocumentAccess } from "@/skin-model/formats/public/access.ts"
import type { SkinImage } from "@/skin-model/image.ts"
import type { IniDocument } from "@/ini.ts"
import { decodePng } from "@/raster.ts"
import { tileSlices } from "@/tiles.ts"

/** `.til` 的 `[IMGn]` 里按结构化字段读出的字段名；其余字段原样保留。 */
const TILE_MODELED = new Set(["SOURCE_RECT", "INNER_RECT", "SCALE"])

/** `.til` 里除切片之外的原值：`[GLOBAL]` 段还没有 IR 语义，按段原样带回。 */
type AtlasGlobal = Record<string, string>

/** 文件路径或图集引用的最后一段，去掉扩展名：`light/skin/res/fore1.til` → `fore1`，`sxi:default:anjian` → `anjian`。 */
export function leafName(reference: string): string {
  const match = /[^/:]+$/.exec(reference)
  return (match?.[0] ?? reference).replace(/\.[^.]+$/, "")
}

/**
 * 切片在 `.til` 里的 `[IMG<n>]` 编号。BDS 读进来时记在 `extra.tilIndex`，写回优先用它；
 * 别的格式转来的切片没有这个字段，按它在数组里的位置从 1 编号。
 */
export function tilIndexOf(slice: AtlasSlice, position: number): number {
  const recorded = slice.extra?.get("tilIndex")
  if (recorded === undefined) return position + 1
  if (typeof recorded !== "number" || !Number.isInteger(recorded) || recorded < 0) {
    throw new Error(`切片 ${slice.id} 的 tilIndex 不是非负整数：${String(recorded)}`)
  }
  return recorded
}

/** 图集段号 → `SCALE` 原值；未定字段，进切片的 `extra`。 */
function scaleOf(document: IniDocument): Map<number, string> {
  const scales = new Map<number, string>()
  for (const section of document.sections()) {
    const match = /^IMG(\d+)$/i.exec(section)
    const value = document.get(section, "SCALE")?.trim()
    if (match && value) scales.set(Number(match[1]), value)
  }
  return scales
}

/**
 * 每个 `.til` 一个图集：切片矩形进 `Atlas.slices`，`INNER_RECT`/`SCALE` 进切片 `extra`，
 * `[GLOBAL]` 原样带回。切片的像素同时进图片表，写回时按原像素重建同名 png。
 */
export function atlasesOf(
  access: DocumentAccess,
  images: Map<string, SkinImage>,
): { atlases: Atlas[]; globals: Map<string, AtlasGlobal> } {
  const atlases: Atlas[] = []
  const globals = new Map<string, AtlasGlobal>()
  for (const path of access.paths()) {
    if (!path.toLowerCase().endsWith(".til")) continue
    const document = access.text(path)
    if (!document) continue
    const global: AtlasGlobal = {}
    for (const entry of document.entries("GLOBAL")) global[entry.key] = entry.value
    if (Object.keys(global).length) globals.set(path, global)
    const scales = scaleOf(document)
    const slices = tileSlices(document).map((tile): AtlasSlice => {
      const extra = new Map<string, unknown>()
      if (tile.inner) extra.set("innerRect", tile.inner)
      const scale = scales.get(tile.index)
      if (scale) extra.set("scale", scale)
      // 切片段里还有 `INFO` 这类没建模的字段：原样保留，写回时逐行还原。
      for (const entry of document.entries(`IMG${tile.index}`)) {
        if (TILE_MODELED.has(entry.key.toUpperCase())) continue
        extra.set(entry.key, entry.value)
      }
      // `[IMG<n>]` 编号是 BDS 的打包细节：记下来，写回时才能原样还原。
      extra.set("tilIndex", tile.index)
      return {
        id: `${path}#${tile.index}`,
        rect: { x: tile.source[0], y: tile.source[1], width: tile.source[2], height: tile.source[3] },
        extra,
      }
    })
    if (!slices.length) continue
    const source = path.replace(/\.til$/i, ".png")
    const bytes = access.bytes(source)
    if (bytes && !images.has(source)) {
      try {
        images.set(source, decodePng(bytes))
      } catch {
        // 源图不是能解码的 PNG；切片已经切出来了，整图外的东西不凭空造。
      }
    }
    atlases.push({ name: path, source, slices })
  }
  return { atlases, globals }
}

/** `INNER_RECT` 的四个数；写下的值不是四个有限数说明模型被改坏了。 */
function innerRectOf(value: unknown, slice: AtlasSlice): [number, number, number, number] {
  if (!Array.isArray(value) || value.length !== 4 || !value.every((item) => typeof item === "number" && Number.isFinite(item))) {
    throw new Error(`切片 ${slice.id} 的内切矩形不合法：${JSON.stringify(value)}`)
  }
  return [value[0], value[1], value[2], value[3]]
}

/** `.til` 文本：`[GLOBAL]` 原值加每个切片一条 `[IMGn]`，编号由调用方按图集分配。 */
export function atlasText(atlas: Atlas, global: AtlasGlobal | undefined, indexes: ReadonlyMap<AtlasSlice, number>): string {
  const lines = ["[GLOBAL]"]
  for (const [key, value] of Object.entries(global ?? {})) {
    if (key.toUpperCase() === "TILE_NUM") continue
    lines.push(`${key}=${value}`)
  }
  // 工具书 V6 p43：`TILE_NUM` 必须与切片数一致，所以它从切片重算而不沿用原值。
  lines.push(`TILE_NUM=${atlas.slices.length}`, "")
  for (const slice of atlas.slices) {
    const index = indexes.get(slice)
    if (index === undefined) throw new Error(`切片没有分配 .til 编号：${slice.id}`)
    lines.push(`[IMG${index}]`, `SOURCE_RECT=${slice.rect.x},${slice.rect.y},${slice.rect.width},${slice.rect.height}`)
    const inner = slice.extra?.get("innerRect")
    if (inner !== undefined) lines.push(`INNER_RECT=${innerRectOf(inner, slice).join(",")}`)
    const scale = slice.extra?.get("scale")
    if (scale !== undefined) {
      if (typeof scale !== "string") throw new Error(`切片 ${slice.id} 的 SCALE 不是字符串`)
      lines.push(`SCALE=${scale}`)
    }
    // 切片段里没建模的字段（`INFO` 这类）原样写回；`tilIndex` 是 BDS 自己的编号，已经在段头上。
    // 别的格式的 `extra`（SXI 的 `rect2`/`scales`）不是 `.til` 的行，BDS 也不认识，跳过。
    for (const [key, value] of slice.extra ?? []) {
      if (key === "innerRect" || key === "scale" || key === "tilIndex") continue
      if (typeof value !== "string") continue
      lines.push(`${key}=${value}`)
    }
    lines.push("")
  }
  return `${lines.join("\n")}\n`
}

/**
 * 图集源图：整图在图片表里就用它，否则把切片按原位置贴回去。
 * 一个切片都没有像素时返回 undefined——原包只有 `.til` 声明，不凭空造图；
 * 只缺一部分说明模型不一致，直接报错，不拿半张图冒充整张。
 */
export function atlasImage(atlas: Atlas, images: ReadonlyMap<string, SkinImage>): SkinImage | undefined {
  const whole = images.get(atlas.source)
  if (whole) return whole
  if (!atlas.slices.length) return
  const present = atlas.slices.flatMap((slice) => {
    const image = images.get(slice.id)
    return image ? [{ slice, image }] : []
  })
  if (!present.length) return
  if (present.length !== atlas.slices.length) {
    const missing = atlas.slices.filter((slice) => !images.has(slice.id)).map((slice) => slice.id)
    throw new Error(`图集只有部分切片有像素，无法重建 ${atlas.source}：${missing.join("、")}`)
  }
  const width = Math.max(...atlas.slices.map((slice) => slice.rect.x + slice.rect.width))
  const height = Math.max(...atlas.slices.map((slice) => slice.rect.y + slice.rect.height))
  const data = new Uint8Array(width * height * 4)
  for (const { slice, image } of present) {
    if (image.width !== slice.rect.width || image.height !== slice.rect.height) {
      throw new Error(`切片 ${slice.id} 的像素 ${image.width}x${image.height} 与矩形 ${slice.rect.width}x${slice.rect.height} 不符`)
    }
    for (let row = 0; row < image.height; row++) {
      const from = row * image.width * 4
      const to = ((slice.rect.y + row) * width + slice.rect.x) * 4
      data.set(image.data.subarray(from, from + image.width * 4), to)
    }
  }
  return { width, height, data }
}

/** `opaque` 里的 `[GLOBAL]` 原值；不是记录就当作没有声明。 */
export function atlasGlobalOf(value: unknown): AtlasGlobal | undefined {
  if (typeof value !== "object" || value === null || !("global" in value)) return
  const global = (value as { global: unknown }).global
  if (typeof global !== "object" || global === null) return
  const fields: AtlasGlobal = {}
  for (const [key, item] of Object.entries(global)) {
    if (typeof item === "string") fields[key] = item
  }
  return fields
}
