import { type ProtoField, type BdaAnimationKind, type BdaResource, type BdaStyleRef } from "./bda.ts"
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
    } else if (wire === 5) {
      const fixedStart = offset
      payloadEnd = offset += 4
      value.fixed32 = new DataView(bytes.buffer, bytes.byteOffset + fixedStart, 4).getFloat32(0, true)
    } else throw new Error(`不支持的 protobuf wire type：${wire}`)
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


export function replaceField(bytes: Uint8Array, number: number, wire: 0 | 2, payload: Uint8Array): Uint8Array {
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
  const entryField = rawFields(bytes).filter((field) => {
    if (field.number !== 9 || !field.bytes) return false
    return rawString(rawFields(field.bytes).find((item) => item.number === 1)) === sequenceName
  }).at(-1)
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
type AnimationScalar = { field: number; wire: 0 | 5; boolean?: boolean; nested?: number }

const ANIMATION_EFFECT_FIELDS: Record<BdaAnimationKind, number> = {
  group: 3, alpha: 4, scale: 5, shift: 6, rotate: 7, frame: 8, image: 9, emitter: 10, lottie: 11, video: 13,
}

function transformAnimationScalars(): Record<string, AnimationScalar> {
  return {
    repeatCount: { field: 1, wire: 0 }, repeatMode: { field: 2, wire: 0 }, delay: { field: 3, wire: 0 },
    removeOnFinish: { field: 4, wire: 0, boolean: true }, duration: { field: 7, wire: 0 }, interpolation: { field: 8, wire: 0 },
  }
}

function mediaAnimationScalars(): Record<string, AnimationScalar> {
  return {
    repeatCount: { field: 1, wire: 0 }, removeOnFinish: { field: 2, wire: 0, boolean: true }, startRepeatFrame: { field: 4, wire: 0 },
  }
}

const ANIMATION_SCALARS: Record<BdaAnimationKind, Record<string, AnimationScalar>> = {
  group: {
    buildMode: { field: 1, wire: 0 },
    repeatCount: { field: 2, wire: 0 },
    repeatMode: { field: 3, wire: 0 },
    removeOnFinish: { field: 4, wire: 0, boolean: true },
    delay: { field: 5, wire: 0 },
  },
  alpha: transformAnimationScalars(),
  scale: {
    ...transformAnimationScalars(),
    pivotPxX: { field: 9, wire: 0, nested: 1 },
    pivotPxY: { field: 9, wire: 0, nested: 2 },
    pivotX: { field: 10, wire: 0, nested: 1 },
    pivotY: { field: 10, wire: 0, nested: 2 },
    interpolationXYX: { field: 11, wire: 0, nested: 1 },
    interpolationXYY: { field: 11, wire: 0, nested: 2 },
  },
  shift: {
    ...transformAnimationScalars(),
    interpolationXYX: { field: 11, wire: 0, nested: 1 },
    interpolationXYY: { field: 11, wire: 0, nested: 2 },
  },
  rotate: {
    ...transformAnimationScalars(),
    pivotPxX: { field: 9, wire: 0, nested: 1 },
    pivotPxY: { field: 9, wire: 0, nested: 2 },
    pivotX: { field: 10, wire: 0, nested: 1 },
    pivotY: { field: 10, wire: 0, nested: 2 },
  },
  frame: mediaAnimationScalars(),
  image: {
    repeatCount: { field: 1, wire: 0 },
    repeatMode: { field: 2, wire: 0 },
    removeOnFinish: { field: 4, wire: 0, boolean: true },
    loopForever: { field: 6, wire: 0, boolean: true },
    startRepeatFrame: { field: 7, wire: 0 },
  },
  emitter: {
    repeatCount: { field: 3, wire: 0 },
    repeatMode: { field: 4, wire: 0 },
    removeOnFinish: { field: 5, wire: 0, boolean: true },
    duration: { field: 6, wire: 5 },
    birthRate: { field: 7, wire: 0 },
    totalNumber: { field: 8, wire: 0 },
    finishAfterPractices: { field: 9, wire: 0 },
    keepParticlesOnRemove: { field: 10, wire: 0 },
    mirrorUp: { field: 11, wire: 0 },
    emitterType: { field: 26, wire: 0 },
  },
  lottie: mediaAnimationScalars(),
  video: mediaAnimationScalars(),
}

type TransformKind = "alpha" | "scale" | "shift" | "rotate"

const TRANSFORM_RANGE_FIELDS: Record<TransformKind, readonly [number, number]> = {
  alpha: [5, 6], scale: [5, 6], shift: [5, 6], rotate: [5, 6],
}

/** EmitterAnimation 里 14–24 号字段都是 Range（location / length，浮点）。 */
const EMITTER_RANGE_FIELDS: Record<string, number> = {
  life: 14, rotation: 15, spin: 16, scale: 17, scaleSpeed: 18, alpha: 19, alphaSpeed: 20,
  velocity: 21, velocityDirection: 22, acceleration: 23, accelerationDirection: 24,
}

/** EdgeInsets（EmitterAnimation.emitterRegion）的边号：top 1 / left 2 / bottom 3 / right 4。 */
const EMITTER_REGION_EDGES: Record<string, number> = { emitRegionLeft: 2, emitRegionTop: 1, emitRegionRight: 4, emitRegionBottom: 3 }

function animationEffectKind(effectID: string): BdaAnimationKind {
  const kind = effectID.slice(0, effectID.indexOf(":"))
  if (kind in ANIMATION_EFFECT_FIELDS) return kind as BdaAnimationKind
  throw new Error(`BDA 动画效果类型不支持：${effectID}`)
}

function animationMessage(bytes: Uint8Array, fieldNumber: number): Uint8Array {
  return rawFields(bytes).find((field) => field.number === fieldNumber)?.bytes ?? new Uint8Array()
}

function animationNumber(value: string | number | boolean, property: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`BDA 动画数值无效：${property}`)
  return value
}

function animationInteger(value: string | number | boolean, property: string): number {
  const number = animationNumber(value, property)
  if (!Number.isInteger(number)) throw new Error(`BDA 动画数值无效：${property}`)
  return number
}

/** 计数、时长、延迟等字段不接受负数；坐标 / 角度范围用 animationInteger。 */
function animationCount(value: string | number | boolean, property: string): number {
  const number = animationInteger(value, property)
  if (number < 0) throw new Error(`BDA 动画数值无效：${property}`)
  return number
}

function replaceAnimationScalar(
  bytes: Uint8Array,
  spec: AnimationScalar,
  property: string,
  value: string | number | boolean,
): Uint8Array {
  if (spec.boolean) {
    if (typeof value !== "boolean") throw new Error(`BDA 动画布尔值无效：${property}`)
    return replaceAnimationVarint(bytes, spec.field, value ? 1 : 0)
  }
  if (spec.wire === 5) return replaceAnimationFloat(bytes, spec.field, animationNumber(value, property))
  if (spec.nested !== undefined) {
    const message = animationMessage(bytes, spec.field)
    return replaceField(bytes, spec.field, 2, replaceAnimationVarint(message, spec.nested, animationInteger(value, property)))
  }
  return replaceAnimationVarint(bytes, spec.field, animationCount(value, property))
}

function replaceAnimationVarint(bytes: Uint8Array, fieldNumber: number, value: number): Uint8Array {
  const current = rawFields(bytes).find((field) => field.number === fieldNumber)
  const replacement = encodedField(fieldNumber, 0, encodeVarint(value))
  return current
    ? join([bytes.slice(0, current.start), replacement, bytes.slice(current.end)])
    : join([bytes, replacement])
}

function replaceAnimationFloat(bytes: Uint8Array, fieldNumber: number, value: number): Uint8Array {
  const payload = new Uint8Array(4)
  new DataView(payload.buffer).setFloat32(0, value, true)
  const current = rawFields(bytes).find((field) => field.number === fieldNumber)
  const replacement = encodedField(fieldNumber, 5, payload)
  return current
    ? join([bytes.slice(0, current.start), replacement, bytes.slice(current.end)])
    : join([bytes, replacement])
}

/** RandomValue：min 1 / max 2，int32。 */
function animationIntRange(bytes: Uint8Array): [number, number] {
  const items = rawFields(bytes)
  const min = items.find((field) => field.number === 1)?.varint ?? 0
  return [min, items.find((field) => field.number === 2)?.varint ?? min]
}

function patchAnimationIntRange(bytes: Uint8Array, min: number, max: number, property: string): Uint8Array {
  if (![min, max].every((value) => Number.isInteger(value))) throw new Error(`BDA 动画范围无效：${property}`)
  return replaceAnimationVarint(replaceAnimationVarint(bytes, 1, min), 2, max)
}

/** Range：location 1 / length 2，都是浮点。 */
function animationFloatRange(bytes: Uint8Array): [number, number] {
  const items = rawFields(bytes)
  const location = items.find((field) => field.number === 1)?.fixed32 ?? 0
  const length = items.find((field) => field.number === 2)?.fixed32 ?? 0
  return [location, location + length]
}

function patchAnimationFloatRange(bytes: Uint8Array, min: number, max: number, property: string): Uint8Array {
  if (!Number.isFinite(min) || !Number.isFinite(max)) throw new Error(`BDA 动画范围无效：${property}`)
  return replaceAnimationFloat(replaceAnimationFloat(bytes, 1, min), 2, max - min)
}

function patchTransformRange(effect: Uint8Array, kind: TransformKind, property: string, value: string | number | boolean): Uint8Array {
  const match = /^(from|to)([XY])?(Min|Max)$/.exec(property)
  if (!match) throw new Error(`BDA 动画效果不支持：${property}`)
  const bounds = TRANSFORM_RANGE_FIELDS[kind]
  // 位移的像素模式用 fromPx 9 / toPx 10；两个字段都在时解码器会优先读它们。
  const pixelShift = kind === "shift" &&
    rawFields(effect).some((field) => field.number === 9) && rawFields(effect).some((field) => field.number === 10)
  const fieldNumber = pixelShift ? (match[1] === "from" ? 9 : 10) : (match[1] === "from" ? bounds[0] : bounds[1])
  const number = animationInteger(value, property)
  const original = animationMessage(effect, fieldNumber)
  if (kind === "alpha" || kind === "rotate") {
    if (match[2]) throw new Error(`BDA 动画效果不支持：${property}`)
    const [min, max] = animationIntRange(original)
    const next = patchAnimationIntRange(original, match[3] === "Min" ? number : min, match[3] === "Max" ? number : max, property)
    return replaceField(effect, fieldNumber, 2, next)
  }
  if (!match[2]) throw new Error(`BDA 动画效果不支持：${property}`)
  const axis = match[2] === "X" ? 1 : 2
  const vector = animationMessage(original, axis)
  const [min, max] = animationIntRange(vector)
  const nextVector = patchAnimationIntRange(vector, match[3] === "Min" ? number : min, match[3] === "Max" ? number : max, property)
  return replaceField(effect, fieldNumber, 2, replaceField(original, axis, 2, nextVector))
}

function patchEmitterRange(effect: Uint8Array, property: string, value: string | number | boolean): Uint8Array {
  const match = /^(\w+)(Min|Max)$/.exec(property)
  const fieldNumber = match ? EMITTER_RANGE_FIELDS[match[1]] : undefined
  if (!match || fieldNumber === undefined) throw new Error(`BDA 动画效果不支持：${property}`)
  const number = animationNumber(value, property)
  const original = animationMessage(effect, fieldNumber)
  const [min, max] = animationFloatRange(original)
  const next = patchAnimationFloatRange(original, match[2] === "Min" ? number : min, match[2] === "Max" ? number : max, property)
  return replaceField(effect, fieldNumber, 2, next)
}

function patchAnimationResource(bytes: Uint8Array, fieldNumber: number, property: string, value: string | number | boolean): Uint8Array {
  if (typeof value !== "string") throw new Error(`BDA 动画资源编号无效：${property}`)
  const resource = animationMessage(bytes, fieldNumber)
  return replaceField(bytes, fieldNumber, 2, replaceField(resource, 2, 2, new TextEncoder().encode(value)))
}

function animationEffectEntry(bytes: Uint8Array, effectID: string): { entry: RawField; effect: RawField } {
  const kind = animationEffectKind(effectID)
  const key = effectID.slice(effectID.indexOf(":") + 1)
  // 解码器把 map 读成 Map：同一个 key 出现多次时后者覆盖前者，patch 也必须命中最后一条。
  const entry = rawFields(bytes).filter((item) => item.number === ANIMATION_EFFECT_FIELDS[kind] && item.bytes &&
    rawString(rawFields(item.bytes).find((child) => child.number === 1)) === key).at(-1)
  const effect = entry?.bytes ? rawFields(entry.bytes).find((child) => child.number === 2) : undefined
  if (!entry?.bytes || !effect?.bytes) throw new Error(`BDA 动画效果不存在：${effectID}`)
  return { entry, effect }
}

function updateAnimationEffectMessage(bytes: Uint8Array, effectID: string, update: (value: Uint8Array) => Uint8Array): Uint8Array {
  const { entry, effect } = animationEffectEntry(bytes, effectID)
  // map entry = {1: key, 2: effect}；只替换 2 号值，entry 里的未知字段原样保留。
  const nextEntry = replaceField(entry.bytes!, 2, 2, update(effect.bytes!))
  return join([bytes.slice(0, entry.start), encodedField(entry.number, 2, nextEntry), bytes.slice(entry.end)])
}

/**
 * 定点写入一个动画效果字段：只替换命中的那一个 protobuf 字段，同层的未知字段和其他字段原样保留。
 * `effectID` 形如 `alpha:press1`，`property` 见 `ANIMATION_SCALARS`、transform 的 `fromXMin` 等、
 * emitter 的 `lifeMin` / `emitRegionLeft` 以及 `resourceID` / `placeholderID`。
 */
export function updateBdaAnimationEffect(
  bytes: Uint8Array,
  effectID: string,
  property: string,
  value: string | number | boolean,
): Uint8Array {
  const kind = animationEffectKind(effectID)
  return updateAnimationEffectMessage(bytes, effectID, (effect) => {
    const scalar = ANIMATION_SCALARS[kind][property]
    if (scalar) return replaceAnimationScalar(effect, scalar, property, value)
    if (kind in TRANSFORM_RANGE_FIELDS) {
      const transform = kind as TransformKind
      if (property === "from" || property === "to") throw new Error(`BDA 动画效果不支持：${property}`)
      const range = /^(from|to)([XY])?(Min|Max)$/.test(property)
      if (range) return patchTransformRange(effect, transform, property, value)
    }
    if (kind === "emitter" && EMITTER_REGION_EDGES[property] !== undefined) {
      const edge = EMITTER_REGION_EDGES[property]
      return replaceField(effect, 12, 2, replaceAnimationFloat(animationMessage(effect, 12), edge, animationNumber(value, property)))
    }
    if (kind === "emitter" && /^(life|rotation|spin|scale|scaleSpeed|alpha|alphaSpeed|velocity|velocityDirection|acceleration|accelerationDirection)(Min|Max)$/.test(property)) {
      return patchEmitterRange(effect, property, value)
    }
    if (property === "resourceID" && (kind === "frame" || kind === "lottie" || kind === "video")) {
      return patchAnimationResource(effect, 3, property, value)
    }
    if (property === "placeholderID" && kind === "video") return patchAnimationResource(effect, 5, property, value)
    throw new Error(`BDA 动画效果不支持：${effectID} ${property}`)
  })
}

function animationObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function normalizedAnimationEffects(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

function animationEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((item, index) => animationEqual(item, right[index]))
  }
  const leftObject = animationObject(left)
  const rightObject = animationObject(right)
  if (!leftObject || !rightObject) return false
  const keys = Object.keys(leftObject)
  return keys.length === Object.keys(rightObject).length &&
    keys.every((key) => key in rightObject && animationEqual(leftObject[key], rightObject[key]))
}

function animationNumberList(value: unknown, length: number, name: string): number[] {
  if (!Array.isArray(value) || value.length !== length ||
    value.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
    throw new Error(`BDA ${name}无效`)
  }
  return value as number[]
}

function animationIntPair(value: unknown, name: string): [number, number] {
  const pair = animationNumberList(value, 2, name)
  if (!pair.every((item) => Number.isInteger(item))) throw new Error(`BDA ${name}无效`)
  return pair as [number, number]
}

function applyAnimationEffectField(
  bytes: Uint8Array,
  effectID: string,
  kind: BdaAnimationKind,
  property: string,
  value: unknown,
): Uint8Array {
  if (ANIMATION_SCALARS[kind][property]) {
    return updateBdaAnimationEffect(bytes, effectID, property, value as string | number | boolean)
  }
  if (property === "kind" || property === "key") throw new Error(`BDA 动画效果标识不能修改：${effectID}`)
  // 图片序列的帧由 updateBdaAnimationFrame 单独写回，这里只跳过序列对象本身。
  if (kind === "image" && property === "sequence") return bytes
  if (kind === "group" && property === "items") throw new Error(`暂不支持增删 BDA 组合动画子效果：${effectID}`)
  if (kind === "emitter" && property === "resources") throw new Error(`暂不支持修改 BDA 粒子资源：${effectID}`)
  if (kind === "emitter" && property === "paths") throw new Error(`暂不支持修改 BDA 粒子路径：${effectID}`)
  if (kind === "emitter" && property === "emitRegion") {
    const [left, top, right, bottom] = animationNumberList(value, 4, "粒子发射区域")
    let output = bytes
    for (const [name, number] of [["emitRegionLeft", left], ["emitRegionTop", top], ["emitRegionRight", right], ["emitRegionBottom", bottom]] as const) {
      output = updateBdaAnimationEffect(output, effectID, name, number)
    }
    return output
  }
  if (kind === "emitter" && EMITTER_RANGE_FIELDS[property] !== undefined) {
    const [min, max] = animationNumberList(value, 2, "粒子参数范围")
    return updateBdaAnimationEffect(
      updateBdaAnimationEffect(bytes, effectID, `${property}Min`, min),
      effectID,
      `${property}Max`,
      max,
    )
  }
  if ((property === "from" || property === "to") && kind in TRANSFORM_RANGE_FIELDS) {
    if (!Array.isArray(value) || value.length !== 2) throw new Error(`BDA 动画范围无效：${effectID}.${property}`)
    let output = bytes
    if (kind === "alpha" || kind === "rotate") {
      const [min, max] = animationIntPair(value[0], "动画范围")
      return updateBdaAnimationEffect(
        updateBdaAnimationEffect(bytes, effectID, `${property}Min`, min),
        effectID,
        `${property}Max`,
        max,
      )
    }
    for (const [axis, index] of [["X", 0], ["Y", 1]] as const) {
      const [min, max] = animationIntPair(value[index], "动画范围")
      output = updateBdaAnimationEffect(output, effectID, `${property}${axis}Min`, min)
      output = updateBdaAnimationEffect(output, effectID, `${property}${axis}Max`, max)
    }
    return output
  }
  const nestedPairs: Record<string, [string, string]> = {
    pivotPx: ["pivotPxX", "pivotPxY"],
    pivot: ["pivotX", "pivotY"],
    interpolationXY: ["interpolationXYX", "interpolationXYY"],
  }
  if (property in nestedPairs) {
    const [x, y] = animationIntPair(value, "动画中心")
    const [xProperty, yProperty] = nestedPairs[property]
    return updateBdaAnimationEffect(
      updateBdaAnimationEffect(bytes, effectID, xProperty, x),
      effectID,
      yProperty,
      y,
    )
  }
  if (property === "resource" || property === "placeholder") {
    if (property === "placeholder" && kind !== "video") throw new Error(`BDA 动画效果字段不支持：${effectID}.${property}`)
    const resource = animationObject(value)
    if (typeof resource?.resourceID !== "string") throw new Error(`BDA 动画资源无效：${effectID}.${property}`)
    return updateBdaAnimationEffect(bytes, effectID, property === "resource" ? "resourceID" : "placeholderID", resource.resourceID)
  }
  if (property === "relative") throw new Error(`暂不支持切换 BDA 动画相对模式：${effectID}`)
  throw new Error(`BDA 动画效果字段不支持：${effectID}.${property}`)
}

function applyAnimationEffectFields(
  bytes: Uint8Array,
  effectID: string,
  wanted: Record<string, unknown>,
  current: Record<string, unknown>,
): Uint8Array {
  const kind = animationEffectKind(effectID)
  let output = bytes
  for (const [property, value] of Object.entries(wanted)) {
    if (animationEqual(value, current[property])) continue
    output = applyAnimationEffectField(output, effectID, kind, property, value)
  }
  for (const property of Object.keys(current)) {
    // 解码出来的可选字段可能显式为 undefined；JSON 回写会丢掉这种键，不算删除。
    if (current[property] === undefined || property in wanted) continue
    throw new Error(`暂不支持删除 BDA 动画字段：${effectID}.${property}`)
  }
  return output
}

/**
 * 源码面板 JSON 回写：按 key 对比 `desired` / `current` 的效果对象，只对变化的字段做定点 patch。
 * 两个参数都可以直接传 effects 对象，也可以传带 `effects` 的整份源码对象。
 */
export function applyBdaAnimationEffects(
  bytes: Uint8Array,
  desired: Record<string, unknown>,
  current: Record<string, unknown>,
): Uint8Array {
  // 与源码面板一致按 JSON 语义比较：显式为 undefined 的可选字段视为不存在。
  const wanted = normalizedAnimationEffects(animationObject(desired.effects) ?? desired)
  const actual = normalizedAnimationEffects(animationObject(current.effects) ?? current)
  let output = bytes
  for (const [effectID, wantedValue] of Object.entries(wanted)) {
    const wantedEffect = animationObject(wantedValue)
    const currentEffect = animationObject(actual[effectID])
    if (!wantedEffect) throw new Error(`BDA 动画效果无效：${effectID}`)
    if (!currentEffect) throw new Error(`暂不支持新增 BDA 动画效果：${effectID}`)
    if (animationEqual(wantedEffect, currentEffect)) continue
    output = applyAnimationEffectFields(output, effectID, wantedEffect, currentEffect)
  }
  for (const effectID of Object.keys(actual)) {
    if (!(effectID in wanted)) throw new Error(`暂不支持删除 BDA 动画效果：${effectID}`)
  }
  return output
}
