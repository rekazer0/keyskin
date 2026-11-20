// 手心皮肤的样式表 ↔ IR 样式。
//
// `ss_1` 的每条样式由 `s_1`~`s_5` 五个槽组成，五个槽各管一类：文字、图片、尺寸/颜色、音效、
// 动画引用。IR 里一个槽拆成一个 `Style`，样式名带上主题与槽名，回读时按同一规则还原。
import type { JsonObject } from "@/palm/sxi-ini.ts"
import { asObject } from "@/palm/sxi-ini.ts"
import type { SkinLayer, SkinStyle, SkinStyles } from "@/skin-model/style.ts"
import type { SoundBinding } from "@/skin-model/sound.ts"
import type { Theme } from "@/skin-model/types.ts"
import { colorJson, colorOf, numberOf, textOf } from "./json.ts"

/** 手心样式名：`sxi:<主题>:<编号>:<槽>`，与 `ss_1` 的键一一对应。 */
const STYLE_PREFIX = "sxi:"

export type SxiSlot = "s_1" | "s_2" | "s_3" | "s_4" | "s_5"

const SLOTS: readonly SxiSlot[] = ["s_1", "s_2", "s_3", "s_4", "s_5"]

export function slotRef(theme: Theme, key: string, slot: SxiSlot): string {
  return `${STYLE_PREFIX}${theme}:${key}:${slot}`
}

function parseSlotRef(ref: string): { theme: Theme; key: string; slot: SxiSlot } | undefined {
  const match = /^sxi:(light|dark):(\d+):(s_[1-5])$/.exec(ref)
  if (!match) return
  return { theme: match[1] as Theme, key: match[2], slot: match[3] as SxiSlot }
}

/** 样式条目里实际出现的槽；`s_2` 优先，其余按槽号。 */
export function slotOf(record: JsonObject): SxiSlot | undefined {
  for (const slot of SLOTS) if (record[slot] !== undefined) return slot
  return
}

/** 图片引用 `文件,序号` 的序号部分。 */
function sliceRefOf(image: string): { name: string; slice: string } | undefined {
  const [name, slice] = image.split(",")
  return name && slice ? { name: name.trim(), slice: slice.trim() } : undefined
}

/** 图片图层引用的切片 → `s_2` 的写法；组名原样带回来，不能换成文件名。 */
function imageRefOf(image: string): string | undefined {
  const match = /^sxi:(?:light|dark):(.+)#IMG(\d+)$/.exec(image)
  return match ? `${match[1]},${match[2]}` : undefined
}

/** 音效样式里的 `path_N` 指同目录下的文件；另一扩展名的同名文件是同一音效的另一版。 */
export type SxiAudioLookup = (file: string) => { path: string; variants: Array<{ format: string; path: string }> } | undefined

function textStyleOf(part: JsonObject): SkinStyle | undefined {
  const normal: SkinLayer[] = []
  const color = colorOf(part.c_normal)
  const fontSize = numberOf(part.f_s)
  const weight = numberOf(part.f_w)
  const content = textOf(part.text)
  if (color || fontSize !== undefined || content !== undefined) {
    normal.push({
      kind: "text",
      ...(content !== undefined ? { text: content } : {}),
      style: {
        ...(color ? { color } : {}),
        ...(fontSize !== undefined ? { fontSize } : {}),
        ...(weight !== undefined ? { weight } : {}),
      },
    })
  }
  const pressedColor = colorOf(part.c_hl)
  if (!normal.length && !pressedColor) return
  return {
    normal,
    ...(pressedColor ? { pressed: [{ kind: "text", style: { color: pressedColor } }] } : {}),
  }
}

function imageStyleOf(part: JsonObject, lookup: (name: string, slice: string) => string | undefined): SkinStyle | undefined {
  const normal: SkinLayer[] = []
  const pressed: SkinLayer[] = []
  for (const [field, target] of [["normal", normal], ["hl", pressed]] as const) {
    const reference = textOf(part[field])
    const parsed = reference ? sliceRefOf(reference) : undefined
    const image = parsed ? lookup(parsed.name, parsed.slice) : undefined
    if (image) target.push({ kind: "image", image })
  }
  if (!normal.length && !pressed.length) return
  return { normal, ...(pressed.length ? { pressed } : {}) }
}

function colorStyleOf(part: JsonObject): SkinStyle | undefined {
  const color = colorOf(part.color)
  if (!color) return
  return { normal: [{ kind: "color", value: color }] }
}

function soundStyleOf(part: JsonObject, subject: string, audio: SxiAudioLookup): SkinStyle | undefined {
  const layers: SkinLayer[] = []
  for (const [field, file] of Object.entries(part)) {
    if (!/^path_\d+$/.test(field)) continue
    const name = textOf(file)?.trim()
    const resolved = name ? audio(name) : undefined
    if (!resolved) continue
    const binding: SoundBinding = { subject, sound: resolved.path, ...(resolved.variants.length ? { variants: resolved.variants } : {}) }
    layers.push({ kind: "sound", binding })
  }
  return layers.length ? { normal: layers } : undefined
}

/** `ss_1` → IR 样式表；每个槽一个 `Style`，`s_5` 是动画引用，不是可绘制样式。 */
export function stylesOfTheme(
  ss1: JsonObject,
  theme: Theme,
  lookup: (name: string, slice: string) => string | undefined,
  audio: SxiAudioLookup,
): Map<string, SkinStyle> {
  const styles = new Map<string, SkinStyle>()
  for (const [key, value] of Object.entries(ss1)) {
    const record = asObject(value)
    if (!record) continue
    const text = asObject(record.s_1)
    const textStyle = text ? textStyleOf(text) : undefined
    if (textStyle) styles.set(slotRef(theme, key, "s_1"), textStyle)
    const image = asObject(record.s_2)
    const imageStyle = image ? imageStyleOf(image, lookup) : undefined
    if (imageStyle) styles.set(slotRef(theme, key, "s_2"), imageStyle)
    const size = asObject(record.s_3)
    const colorStyle = size ? colorStyleOf(size) : undefined
    if (colorStyle) styles.set(slotRef(theme, key, "s_3"), colorStyle)
    const sound = asObject(record.s_4)
    const soundStyle = sound ? soundStyleOf(sound, slotRef(theme, key, "s_4"), audio) : undefined
    if (soundStyle) styles.set(slotRef(theme, key, "s_4"), soundStyle)
  }
  return styles
}

/** 一个样式拆回槽字段：按图层类型落进对应的槽。 */
function slotJsonOf(style: SkinStyle, original: JsonObject): Partial<Record<SxiSlot, JsonObject>> {
  const text = style.normal.find((layer): layer is Extract<SkinLayer, { kind: "text" }> => layer.kind === "text")
  const image = style.normal.find((layer): layer is Extract<SkinLayer, { kind: "image" }> => layer.kind === "image")
  const pressedImage = (style.pressed ?? []).find((layer): layer is Extract<SkinLayer, { kind: "image" }> => layer.kind === "image")
  const color = style.normal.find((layer): layer is Extract<SkinLayer, { kind: "color" }> => layer.kind === "color")
  const sounds = style.normal.filter((layer): layer is Extract<SkinLayer, { kind: "sound" }> => layer.kind === "sound")
  const result: Partial<Record<SxiSlot, JsonObject>> = {}
  if (text) {
    const before = asObject(original.s_1) ?? {}
    result.s_1 = {
      ...before,
      ...(text.text !== undefined ? { text: text.text } : {}),
      ...(text.style.fontSize !== undefined ? { f_s: text.style.fontSize } : {}),
      ...(text.style.weight !== undefined ? { f_w: text.style.weight } : {}),
      ...(text.style.color ? { c_normal: colorJson(text.style.color, before.c_normal) } : {}),
    }
    const pressedColor = pressedTextColor(style)
    if (pressedColor) result.s_1.c_hl = colorJson(pressedColor, before.c_hl)
  }
  if (image || pressedImage) {
    const before = asObject(original.s_2) ?? {}
    result.s_2 = {
      ...before,
      ...(image ? { normal: imageRefOf(image.image) ?? before.normal } : {}),
      ...(pressedImage ? { hl: imageRefOf(pressedImage.image) ?? before.hl } : {}),
    }
  }
  if (color) {
    const before = asObject(original.s_3) ?? {}
    result.s_3 = { ...before, color: colorJson(color.value, before.color) }
  }
  if (sounds.length) {
    const before = asObject(original.s_4) ?? {}
    const next: JsonObject = { ...before }
    const keys = Object.keys(before).filter((field) => /^path_\d+$/.test(field))
    sounds.forEach((layer, index) => {
      const field = keys[index] ?? `path_${index + 1}`
      next[field] = layer.binding.sound.split("/").pop() ?? layer.binding.sound
    })
    result.s_4 = next
  }
  return result
}

function pressedTextColor(style: SkinStyle): string | undefined {
  for (const layer of style.pressed ?? []) {
    if (layer.kind === "text" && layer.style.color) return layer.style.color
  }
  return
}

/**
 * 样式表写回 `ss_1`。
 * 原表里的槽先铺底，IR 里有的槽覆盖它；IR 没建模的槽（`s_5`）与未识别字段原样保留。
 */
export function stylesJson(theme: Theme, styles: SkinStyles, original: JsonObject): JsonObject {
  const table: JsonObject = {}
  const seen = new Set<string>()
  for (const [key, value] of Object.entries(original)) {
    const record = asObject(value)
    if (!record) continue
    const next: JsonObject = { ...record }
    for (const slot of SLOTS) {
      const style = styles.get(slotRef(theme, key, slot))
      if (!style) continue
      const rebuilt = slotJsonOf(style, record)[slot]
      if (!rebuilt) continue
      next[slot] = rebuilt
      seen.add(slotRef(theme, key, slot))
    }
    table[key] = next
  }
  // IR 里新增的样式（其它格式转来）按空位补编号。
  const used = new Set(Object.keys(table).map(Number))
  let next = 1
  for (const [name, style] of styles) {
    const parsed = parseSlotRef(name)
    if (!parsed || parsed.theme !== theme || seen.has(name)) continue
    const slots = slotJsonOf(style, {})
    if (!Object.keys(slots).length) continue
    while (used.has(next)) next += 1
    used.add(next)
    const key = parsed.key && !table[parsed.key] ? parsed.key : String(next)
    table[key] = {
      ...asObject(table[key]) ?? {},
      ...(slots.s_1 ? { s_1: slots.s_1 } : {}),
      ...(slots.s_2 ? { s_2: slots.s_2 } : {}),
      ...(slots.s_3 ? { s_3: slots.s_3 } : {}),
      ...(slots.s_4 ? { s_4: slots.s_4 } : {}),
      f: 0,
      id: `STYLE${key}`,
    }
  }
  return table
}
