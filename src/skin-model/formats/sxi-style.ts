// 手心皮肤的样式表 ↔ IR 样式。
//
// `ss_1` 按编号存样式，每个样式分成 `s_1`（文字）、`s_2`（图片）、`s_3`（边框）、`s_4`（音效）、`s_5`（动画）。
// IR 里把图片切进资源表、文字与颜色进图层，编号保留在样式名里。
import type { Json, JsonObject } from "@/palm/sxi-ini.ts"
import { asObject } from "@/palm/sxi-ini.ts"
import { decodePng } from "@/raster.ts"
import type { SkinImage } from "@/skin-model/image.ts"
import type { SkinLayer, SkinStyle, SkinStyles } from "@/skin-model/style.ts"

/** 手心样式名：`sxi:<编号>`，与 `ss_1` 的键一一对应。 */
const STYLE_PREFIX = "sxi:"

export function sxiStyleName(key: string): string {
  return `${STYLE_PREFIX}${key}`
}

/** 样式名的编号部分。 */
export function sxiStyleKey(name: string): string | undefined {
  return name.startsWith(STYLE_PREFIX) ? name.slice(STYLE_PREFIX.length) : undefined
}

/** 图片文件在皮肤包里找出来；手心把资源路径写在样式里，相对包根。 */
function imagePathOf(files: ReadonlyMap<string, Uint8Array>, file: string): string | undefined {
  const leaf = file.replace(/^\.?\//, "")
  const direct = [...files.keys()].find((path) => path === leaf)
  if (direct) return direct
  const suffix = [...files.keys()].find((path) => path.endsWith(`/${leaf}`))
  if (suffix) return suffix
  return [...files.keys()].find((path) => (path.split("/").pop() ?? "") === (leaf.split("/").pop() ?? ""))
}

function imageLayer(files: ReadonlyMap<string, Uint8Array>, images: Map<string, SkinImage>, file: Json): SkinLayer | undefined {
  if (typeof file !== "string" || !file.trim()) return
  const path = imagePathOf(files, file.trim())
  if (!path) return
  if (!images.has(path)) {
    const bytes = files.get(path)
    if (!bytes) return
    try {
      images.set(path, decodePng(bytes))
    } catch {
      return
    }
  }
  return { kind: "image", image: path }
}

function textLayer(part: JsonObject): SkinLayer | undefined {
  const color = typeof part.c_normal === "string" ? part.c_normal.trim() : undefined
  const size = Number(part.f_s)
  const content = typeof part.text === "string" ? part.text : undefined
  if (!color && !(Number.isFinite(size) && size > 0) && content === undefined) return
  return {
    kind: "text",
    ...(content !== undefined ? { text: content } : {}),
    style: {
      ...(color ? { color } : {}),
      ...(Number.isFinite(size) && size > 0 ? { fontSize: size } : {}),
      ...(typeof part.f_n === "string" && part.f_n.trim() ? { fontFamily: part.f_n.trim() } : {}),
    },
  }
}

/** 一个 `ss_1` 条目 → IR 样式。 */
function styleOf(files: ReadonlyMap<string, Uint8Array>, images: Map<string, SkinImage>, record: JsonObject): SkinStyle | undefined {
  const normal: SkinLayer[] = []
  const pressed: SkinLayer[] = []
  const text = textLayer(asObject(record.s_1) ?? {})
  if (text) normal.push(text)
  const image = asObject(record.s_2) ?? {}
  const back = imageLayer(files, images, image.normal)
  if (back) normal.push(back)
  const highlighted = imageLayer(files, images, image.hl)
  if (highlighted) pressed.push(highlighted)
  if (!normal.length && !pressed.length) return
  return { normal, ...(pressed.length ? { pressed } : {}) }
}

/** `ss_1` → IR 样式表；同时把图片切进资源表。 */
export function stylesOfSkin(
  skin: JsonObject,
  files: ReadonlyMap<string, Uint8Array>,
  theme: string,
  orientation: string,
): { styles: Map<string, SkinStyle>; images: Map<string, SkinImage> } {
  const root = asObject(skin.default) ?? skin
  const struct = asObject(root[theme]) ?? {}
  const shared = asObject(struct.s_info) ?? {}
  const own = asObject(struct[orientation === "land" ? "s_land" : "s_port"]) ?? {}
  const table = { ...asObject(shared.ss_1), ...asObject(own.ss_1) }
  const styles = new Map<string, SkinStyle>()
  const images = new Map<string, SkinImage>()
  for (const [key, value] of Object.entries(table)) {
    const record = asObject(value)
    if (!record) continue
    const style = styleOf(files, images, record)
    if (style) styles.set(sxiStyleName(key), style)
  }
  return { styles, images }
}

/** IR 样式表 → `ss_1` 条目；只写能表达的部分。 */
/**
 * 样式表与名表。
 * 手心样式键是它自己的编号；其它格式转来的样式名（如 `bda:image:10039`）不能直接当键，
 * 先分配一个合法键再写出，按键引用与样式表用同一张名表。
 */
export function skinStylesOf(styles: SkinStyles): { table: JsonObject; names: Map<string, string>; warnings: string[] } {
  const table: JsonObject = {}
  const names = new Map<string, string>()
  const warnings: string[] = []
  // 手心样式键是数字，先收住已有的编号，再从空位补，避免撞号。
  const used = new Set<number>()
  for (const name of styles.keys()) {
    const existing = sxiStyleKey(name)
    if (existing && /^\d+$/.test(existing)) used.add(Number(existing))
  }
  let next = 1
  const allocate = (): string => {
    while (used.has(next)) next += 1
    used.add(next)
    return String(next)
  }
  for (const [name, style] of styles) {
    const key = sxiStyleKey(name) ?? allocate()
    names.set(name, key)
    const image = style.normal.find((layer): layer is Extract<SkinLayer, { kind: "image" }> => layer.kind === "image")
    const pressed = (style.pressed ?? []).find((layer): layer is Extract<SkinLayer, { kind: "image" }> => layer.kind === "image")
    const text = style.normal.find((layer): layer is Extract<SkinLayer, { kind: "text" }> => layer.kind === "text")
    const color = style.normal.find((layer): layer is Extract<SkinLayer, { kind: "color" }> => layer.kind === "color")
    if (!image && !text && !color && !pressed) {
      warnings.push(`${name}：没有可写进手心样式的图层`)
      continue
    }
    table[key] = {
      ...(text
        ? {
          s_1: {
            ...(text.text !== undefined ? { text: text.text } : {}),
            ...(text.style.fontSize !== undefined ? { f_s: text.style.fontSize } : {}),
            ...(text.style.color ? { c_normal: text.style.color } : {}),
            ...(color ? { c_normal: color.value } : {}),
          },
        }
        : color ? { s_1: { c_normal: color.value } } : {}),
      ...(image || pressed
        ? {
          s_2: {
            ...(image ? { normal: basename(image.image) } : {}),
            ...(pressed ? { hl: basename(pressed.image) } : {}),
          },
        }
        : {}),
    }
  }
  return { table, names, warnings }
}

function basename(path: string): string {
  return path.split("/").pop() ?? path
}
