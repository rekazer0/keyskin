import { type ProtoField, type BdaResource, type BdaStyleRef } from "./bda.ts"
import { decoder } from "./bda-decode.ts"

export type RawField = ProtoField & { start: number; end: number; payloadStart: number; payloadEnd: number }

export function rawFields(bytes: Uint8Array): RawField[] {
  const result: RawField[] = []
  let offset = 0
  const varint = () => {
    let value = 0n
    let shift = 0n
    for (let count = 0; offset < bytes.length && count < 10; count++) {
      const byte = bytes[offset++]
      value |= BigInt(byte & 0x7f) << shift
      if (!(byte & 0x80)) return Number(value)
      shift += 7n
    }
    throw new Error("无效的 protobuf varint")
  }
  while (offset < bytes.length) {
    const start = offset
    const tag = varint()
    const number = Math.floor(tag / 8)
    const wire = tag & 7
    let payloadStart = offset
    let payloadEnd = offset
    let value: Pick<ProtoField, "varint" | "fixed32" | "bytes"> = {}
    if (wire === 0) {
      const varintValue = varint()
      payloadEnd = offset
      value.varint = varintValue
    } else if (wire === 1) payloadEnd = offset += 8
    else if (wire === 2) {
      const length = varint()
      payloadStart = offset
      payloadEnd = offset += length
      value.bytes = bytes.slice(payloadStart, payloadEnd)
    } else if (wire === 5) payloadEnd = offset += 4
    else throw new Error(`不支持的 protobuf wire type：${wire}`)
    if (offset > bytes.length) throw new Error("不完整的 protobuf 字段")
    result.push({ number, wire, start, end: offset, payloadStart, payloadEnd, ...value })
  }
  return result
}

export function encodeVarint(value: number): Uint8Array {
  let current = BigInt(value >>> 0)
  const output: number[] = []
  do {
    let byte = Number(current & 0x7fn)
    current >>= 7n
    if (current) byte |= 0x80
    output.push(byte)
  } while (current)
  return Uint8Array.from(output)
}

export function join(parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}

export function encodedField(number: number, wire: 0 | 1 | 2 | 5, payload: Uint8Array): Uint8Array {
  return join([encodeVarint(number * 8 + wire), ...(wire === 2 ? [encodeVarint(payload.length)] : []), payload])
}


export function replaceField(bytes: Uint8Array, number: number, wire: 0 | 1 | 2 | 5, payload: Uint8Array): Uint8Array {
  const field = rawFields(bytes).find((item) => item.number === number)
  const replacement = encodedField(number, wire, payload)
  return field
    ? join([bytes.slice(0, field.start), replacement, bytes.slice(field.end)])
    : join([bytes, replacement])
}

export function removeFields(bytes: Uint8Array, numbers: Set<number>): Uint8Array {
  const fields = rawFields(bytes)
  return join(fields.filter((field) => !numbers.has(field.number)).map((field) => bytes.slice(field.start, field.end)))
}

export function convertBdaPanelPlatform(bytes: Uint8Array, platform: "ios" | "android"): Uint8Array {
  const source = rawFields(bytes)
  const from = platform === "ios" ? 10 : 7
  const to = platform === "ios" ? 7 : 10
  const style = source.find((field) => field.number === to && field.bytes?.length) ??
    source.find((field) => field.number === from && field.bytes?.length)
  return join([
    ...source.filter((field) => field.number !== 7 && field.number !== 10)
      .map((field) => bytes.slice(field.start, field.end)),
    ...(style?.bytes ? [encodedField(to, 2, style.bytes)] : []),
  ])
}

export const IOS_BDA_PANELS = new Set([
  "bh", "def_9", "def_26", "email", "en_26", "en_26s", "hw_grid", "num_9", "num_26",
  "py_9", "py_26", "sel_ch", "sel_en", "sym_26_cn", "sym_26_en", "symbol", "url",
])

export function convertBdaAppearancePlatform(bytes: Uint8Array, platform: "ios" | "android"): Uint8Array {
  let output = updateBdaDesignWidth(bytes, platform === "ios" ? 1242 : 1080)
  const fields = rawFields(output)
  return join(fields.flatMap((field) => {
    if (field.number !== 4 || !field.bytes) return [output.slice(field.start, field.end)]
    const entry = rawFields(field.bytes)
    const keyField = entry.find((item) => item.number === 1)
    const key = rawString(keyField)
    if (platform === "ios" && !IOS_BDA_PANELS.has(key) && key !== "net") return []
    const value = entry.find((item) => item.number === 2)
    if (!value?.bytes) return [output.slice(field.start, field.end)]
    const renamed = platform === "ios" && key === "net" && keyField?.bytes
      ? encodedField(1, 2, new TextEncoder().encode("url"))
      : keyField ? field.bytes!.slice(keyField.start, keyField.end) : undefined
    return [encodedField(4, 2, join([
      ...entry.filter((item) => item.number !== 1 && item.number !== 2).map((item) => field.bytes!.slice(item.start, item.end)),
      ...(renamed ? [renamed] : []),
      encodedField(2, 2, convertBdaPanelPlatform(value.bytes, platform)),
    ]))]
  }))
}

export function convertBdaSoundPlatform(bytes: Uint8Array, platform: "ios" | "android"): Uint8Array {
  const target = platform === "ios" ? 3 : 1
  const maps = rawFields(bytes).filter((field) => (field.number === 1 || field.number === 3) && field.bytes)
  const entries = new Map<string, Uint8Array>()
  for (const field of maps) {
    const key = rawString(rawFields(field.bytes!).find((entry) => entry.number === 1))
    if (key && (!entries.has(key) || field.number === target)) entries.set(key, field.bytes!)
  }
  return join([
    removeFields(bytes, new Set([1, 3])),
    ...[...entries.values()].map((entry) => encodedField(target, 2, entry)),
  ])
}

export function updateBdaDesignWidth(bytes: Uint8Array, width: number): Uint8Array {
  if (!Number.isFinite(width) || width <= 0) throw new Error("BDA 设计宽度必须是正数")
  return replaceField(bytes, 6, 0, encodeVarint(Math.round(width)))
}

export function bdaSoundResourceType(filename: string): number {
  if (/\.wav$/i.test(filename)) return 4
  if (/\.ogg$/i.test(filename)) return 5
  if (/\.aiff?$/i.test(filename)) return 10
  throw new Error("BDA 按键音仅支持 OGG、WAV 或 AIFF")
}

export function updateBdaKeySound(
  bytes: Uint8Array,
  key: string,
  sound: BdaResource,
  ios = false,
): Uint8Array {
  const fieldNumber = ios ? 3 : 1
  const existing = rawFields(bytes).find((field) => {
    if (field.number !== fieldNumber || !field.bytes) return false
    return rawString(rawFields(field.bytes).find((item) => item.number === 1)) === key
  })
  const encodeResource = (original: Uint8Array = new Uint8Array()) => replaceField(
    replaceField(original, 1, 0, encodeVarint(sound.type)),
    2,
    2,
    new TextEncoder().encode(sound.resourceID),
  )
  if (existing?.bytes) {
    const original = rawFields(existing.bytes).find((field) => field.number === 2)?.bytes
    const entry = replaceField(existing.bytes, 2, 2, encodeResource(original))
    return join([
      bytes.slice(0, existing.start),
      encodedField(fieldNumber, 2, entry),
      bytes.slice(existing.end),
    ])
  }
  const entry = join([
    encodedField(1, 2, new TextEncoder().encode(key)),
    encodedField(2, 2, encodeResource()),
  ])
  return join([bytes, encodedField(fieldNumber, 2, entry)])
}

export function updateMapValue(
  bytes: Uint8Array,
  fieldNumber: number,
  key: number,
  update: (value: Uint8Array) => Uint8Array,
): Uint8Array {
  const field = rawFields(bytes).find((item) => {
    if (item.number !== fieldNumber || !item.bytes) return false
    return rawFields(item.bytes).find((entry) => entry.number === 1)?.varint === key
  })
  if (!field?.bytes) throw new Error(`BDA 样式不存在：${key}`)
  const entryValue = rawFields(field.bytes).find((item) => item.number === 2)?.bytes
  if (!entryValue) throw new Error(`BDA 样式缺少值：${key}`)
  const entry = replaceField(field.bytes, 2, 2, update(entryValue))
  return join([bytes.slice(0, field.start), encodedField(fieldNumber, 2, entry), bytes.slice(field.end)])
}

export function updateStringMapValue(
  bytes: Uint8Array,
  fieldNumber: number,
  key: string,
  update: (value: Uint8Array) => Uint8Array,
): Uint8Array {
  const field = rawFields(bytes).find((item) => {
    if (item.number !== fieldNumber || !item.bytes) return false
    return rawString(rawFields(item.bytes).find((entry) => entry.number === 1)) === key
  })
  if (!field?.bytes) throw new Error(`BDA 配置项不存在：${key}`)
  const entryValue = rawFields(field.bytes).find((item) => item.number === 2)?.bytes
  if (!entryValue) throw new Error(`BDA 配置项缺少值：${key}`)
  const entry = replaceField(field.bytes, 2, 2, update(entryValue))
  return join([bytes.slice(0, field.start), encodedField(fieldNumber, 2, entry), bytes.slice(field.end)])
}

export function rawString(field: RawField | undefined): string {
  if (!field?.bytes) return ""
  try {
    return decoder.decode(field.bytes)
  } catch {
    return ""
  }
}

export function updateBdaAnimationFrame(
  bytes: Uint8Array,
  sequenceName: string,
  frameIndex: number,
  property: "resourceID" | "duration",
  value: string | number,
): Uint8Array {
  const entryField = rawFields(bytes).find((field) => {
    if (field.number !== 9 || !field.bytes) return false
    return rawString(rawFields(field.bytes).find((item) => item.number === 1)) === sequenceName
  })
  if (!entryField?.bytes) throw new Error(`BDA 动画序列不存在：${sequenceName}`)
  const entryFields = rawFields(entryField.bytes)
  const sequenceField = entryFields.find((field) => field.number === 2)
  if (!sequenceField?.bytes) throw new Error(`BDA 动画序列缺少值：${sequenceName}`)
  const frames = rawFields(sequenceField.bytes).filter((field) => field.number === 5)
  const frameField = frames[frameIndex]
  if (!frameField?.bytes) throw new Error(`BDA 动画帧不存在：${frameIndex}`)

  let frame = frameField.bytes
  if (property === "resourceID") {
    const resource = rawFields(frame).find((field) => field.number === 1)?.bytes ?? new Uint8Array()
    frame = replaceField(frame, 1, 2, replaceField(resource, 2, 2, new TextEncoder().encode(String(value))))
  } else {
    const duration = Number(value)
    if (!Number.isInteger(duration) || duration < 0) throw new Error("BDA 动画帧时长无效")
    frame = replaceField(frame, 2, 0, encodeVarint(duration))
  }

  const sequence = join([
    sequenceField.bytes.slice(0, frameField.start),
    encodedField(5, 2, frame),
    sequenceField.bytes.slice(frameField.end),
  ])
  const entry = replaceField(entryField.bytes, 2, 2, sequence)
  return join([
    bytes.slice(0, entryField.start),
    encodedField(9, 2, entry),
    bytes.slice(entryField.end),
  ])
}

export function colorValue(value: string): number {
  const hex = value.trim().replace(/^#/, "")
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(hex)) throw new Error("颜色应为 RRGGBB 或 AARRGGBB")
  return Number.parseInt(hex.length === 6 ? `FF${hex}` : hex, 16) >>> 0
}

/**
 * Appends a style of `type` under the next free key of its map; `from` copies that existing style of
 * the same type (a 首选 style starting from the candidate words). Returns the new reference.
 */
export function addBdaStyle(bytes: Uint8Array, type: BdaStyleRef["type"], from?: number): { bytes: Uint8Array; ref: BdaStyleRef } {
  const rootField = { image: 1, text: 2, color: 3 }[type]
  const entries = rawFields(bytes).filter((field) => field.number === rootField && field.bytes)
  const keyOf = (field: RawField) => rawFields(field.bytes!).find((item) => item.number === 1)?.varint
  const key = Math.max(0, ...entries.map((field) => keyOf(field) ?? 0)) + 1
  const source = from === undefined ? undefined : entries.find((field) => keyOf(field) === from)
  const value = source ? rawFields(source.bytes!).find((item) => item.number === 2)?.bytes ?? new Uint8Array() : new Uint8Array()
  const entry = join([encodedField(1, 0, encodeVarint(key)), encodedField(2, 2, value)])
  return { bytes: join([bytes, encodedField(rootField, 2, entry)]), ref: { type, key } }
}

export function updateBdaStyle(
  bytes: Uint8Array,
  ref: BdaStyleRef,
  property: string,
  value: string,
): Uint8Array {
  const rootField = { image: 1, text: 2, color: 3 }[ref.type]
  return updateMapValue(bytes, rootField, ref.key, (style) => {
    if (ref.type === "image") {
      const state = property === "HL_IMG" ? 2 : property === "NM_IMG" ? 1 : 0
      if (!state) throw new Error(`BDA 图片样式不支持：${property}`)
      const atom = rawFields(style).find((item) => item.number === state)?.bytes ?? new Uint8Array()
      const resource = rawFields(atom).find((item) => item.number === 1)?.bytes ?? new Uint8Array()
      const nextResource = replaceField(resource, 2, 2, new TextEncoder().encode(value.split(",")[0].trim()))
      return replaceField(style, state, 2, replaceField(atom, 1, 2, nextResource))
    }
    if (ref.type === "color") {
      const field = property === "HL_COLOR" ? 2 : property === "NM_COLOR" ? 1 : 0
      if (!field) throw new Error(`BDA 颜色样式不支持：${property}`)
      return replaceField(style, field, 0, encodeVarint(colorValue(value)))
    }
    const field = { FONT_NAME: 2, FONT_SIZE: 3, NM_COLOR: 4, HL_COLOR: 5, CONTENT_TEXT: 6 }[property]
    if (!field) throw new Error(`BDA 文字样式不支持：${property}`)
    // The text a key draws is the style's own (contentText): the keys of the official skins all set it.
    if (property === "CONTENT_TEXT") {
      return value ? replaceField(style, field, 2, new TextEncoder().encode(value)) : removeFields(style, new Set([field]))
    }
    if (property === "FONT_NAME") {
      return value.trim() ? replaceField(style, field, 2, new TextEncoder().encode(value.trim())) : removeFields(style, new Set([field]))
    }
    const numeric = property === "FONT_SIZE" ? Number(value) : colorValue(value)
    if (property === "FONT_SIZE" && (!Number.isInteger(numeric) || numeric < 1)) throw new Error("字号应为正整数")
    return replaceField(style, field, 0, encodeVarint(numeric))
  })
}

export function updateBdaImageInnerRect(
  bytes: Uint8Array,
  ref: BdaStyleRef,
  highlighted: boolean,
  rect: readonly [number, number, number, number],
): Uint8Array {
  if (ref.type !== "image") throw new Error("BDA 切片区域只能写入图片样式")
  if (rect.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new Error("BDA 切片区域必须是非负整数")
  }
  return updateMapValue(bytes, 1, ref.key, (style) => {
    const state = highlighted ? 2 : 1
    const atom = rawFields(style).find((item) => item.number === state)?.bytes
    if (!atom) throw new Error(`BDA 图片样式缺少${highlighted ? "按下" : "正常"}状态：${ref.key}`)
    const originalRect = rawFields(atom).find((item) => item.number === 2)?.bytes ?? new Uint8Array()
    const originalPoint = rawFields(originalRect).find((item) => item.number === 1)?.bytes ?? new Uint8Array()
    const originalSize = rawFields(originalRect).find((item) => item.number === 2)?.bytes ?? new Uint8Array()
    const point = replaceField(
      replaceField(originalPoint, 1, 0, encodeVarint(rect[0])),
      2,
      0,
      encodeVarint(rect[1]),
    )
    const size = replaceField(
      replaceField(originalSize, 1, 0, encodeVarint(rect[2])),
      2,
      0,
      encodeVarint(rect[3]),
    )
    const nextRect = replaceField(replaceField(originalRect, 1, 2, point), 2, 2, size)
    return replaceField(style, state, 2, replaceField(atom, 2, 2, nextRect))
  })
}

function animationScalar(bytes: Uint8Array, field: number, value: string | number | boolean, fixed = false): Uint8Array {
  const number = Number(value)
  if (!Number.isFinite(number) || (fixed ? !Number.isFinite(Math.fround(number)) : !Number.isInteger(number) || number < 0 || number > 0xffffffff)) {
    throw new Error("BDA 动画数值无效")
  }
  if (!fixed) return replaceField(bytes, field, 0, encodeVarint(number))
  const payload = new Uint8Array(4)
  new DataView(payload.buffer).setFloat32(0, number, true)
  return replaceField(bytes, field, 5, payload)
}

export function updateBdaAnimationWidth(bytes: Uint8Array, width: number): Uint8Array {
  if (width <= 0) throw new Error("BDA 设计宽度必须是正整数")
  return animationScalar(bytes, 12, width)
}

export function updateBdaAnimationEffect(bytes: Uint8Array, effectID: string, property: string, value: string | number | boolean): Uint8Array {
  const separator = effectID.indexOf(":")
  const kind = effectID.slice(0, separator)
  const key = effectID.slice(separator + 1)
  const fieldNumber = ({ group: 3, alpha: 4, scale: 5, shift: 6, rotate: 7, frame: 8, image: 9, emitter: 10, lottie: 11, video: 13 } as Record<string, number>)[kind]
  if (separator < 0 || fieldNumber === undefined) throw new Error(`BDA 动画效果不存在：${effectID}`)
  // An effect is the map entry's value (field 2), never the entry containing its key.
  return updateStringMapValue(bytes, fieldNumber, key, (effect) => {
    const transform = ["alpha", "scale", "shift", "rotate"].includes(kind)
    const media = ["frame", "lottie", "video"].includes(kind)
    const fields: Record<string, number> = {
      repeatCount: kind === "group" ? 2 : kind === "emitter" ? 3 : 1,
      removeOnFinish: kind === "emitter" ? 5 : media ? 2 : 4,
      ...(!media ? { repeatMode: kind === "group" ? 3 : kind === "emitter" ? 4 : 2 } : {}),
      ...(transform ? { delay: 3, duration: 7, interpolation: 8 } : {}),
      ...(kind === "group" ? { buildMode: 1, delay: 5 } : {}),
      ...(kind === "emitter" ? { duration: 6, birthRate: 7, totalNumber: 8 } : {}),
      ...(kind === "image" ? { loopForever: 6, startRepeatFrame: 7 } : {}),
      ...(media ? { startRepeatFrame: 4 } : {}),
    }
    const field = fields[property]
    if (field !== undefined) return animationScalar(effect, field, value, kind === "emitter" && property === "duration")
    if (media && property === "resourceID") {
      const resource = rawFields(effect).find((item) => item.number === 3)?.bytes ?? new Uint8Array()
      return replaceField(effect, 3, 2, replaceField(resource, 2, 2, new TextEncoder().encode(String(value))))
    }
    if (transform) {
      const scalar = kind === "alpha" || kind === "rotate"
      const match = (scalar ? /^(from|to)(Min|Max)$/ : /^(from|to)(X|Y)(Min|Max)$/).exec(property)
      if (match) {
        const pixel = kind === "shift" && [9, 10].every((number) => rawFields(effect).some((item) => item.number === number))
        const number = (match[1] === "from" ? 5 : 6) + (pixel ? 4 : 0)
        const vector = rawFields(effect).find((item) => item.number === number)?.bytes ?? new Uint8Array()
        const axis = match[2] === "X" ? 1 : 2
        const range = scalar ? vector : rawFields(vector).find((item) => item.number === axis)?.bytes ?? new Uint8Array()
        // A missing upper bound defaults to the lower bound; preserve it when changing min.
        const min = rawFields(range).find((item) => item.number === 1)?.varint ?? 0
        const bounded = rawFields(range).some((item) => item.number === 2) ? range : animationScalar(range, 2, min)
        const next = animationScalar(bounded, match.at(-1) === "Min" ? 1 : 2, value)
        return replaceField(effect, number, 2, scalar ? next : replaceField(vector, axis, 2, next))
      }
    }
    if (kind === "emitter") {
      const ranges = ["life", "rotation", "spin", "scale", "scaleSpeed", "alpha", "alphaSpeed", "velocity", "velocityDirection", "acceleration", "accelerationDirection"]
      const match = /^(\w+)(Min|Max)$/.exec(property)
      const index = match ? ranges.indexOf(match[1]) : -1
      if (match && index >= 0) {
        const number = index + 14
        const range = rawFields(effect).find((item) => item.number === number)?.bytes ?? new Uint8Array()
        const read = (field: number) => {
          const item = rawFields(range).find((item) => item.number === field)
          return item?.wire === 5 ? new DataView(range.buffer, range.byteOffset + item.payloadStart, 4).getFloat32(0, true) : 0
        }
        const min = match[2] === "Min" ? Number(value) : read(1)
        const max = match[2] === "Max" ? Number(value) : read(1) + read(2)
        const next = animationScalar(animationScalar(range, 1, min, true), 2, max - min, true)
        return replaceField(effect, number, 2, next)
      }
      const edge = ["emitTop", "emitLeft", "emitBottom", "emitRight"].indexOf(property)
      if (edge >= 0) {
        const region = rawFields(effect).find((item) => item.number === 12)?.bytes ?? new Uint8Array()
        return replaceField(effect, 12, 2, animationScalar(region, edge + 1, value, true))
      }
    }
    throw new Error(`BDA 动画效果不支持：${property}`)
  })
}
