import { type ProtoField, type BdaResource, type BdaStyleRef, type BdaScaledOffset, type BdaRect, type BdaImageAtom, type BdaImageStyle, type BdaTextStyle, type BdaColorStyle, type BdaKey, type BdaBar, type BdaTab, type BdaCorpusList, type BdaGamePanel, type BdaSwitch, type BdaCand, type BdaList, type BdaHint, type BdaInputTile, type BdaGrid, type BdaPanel, type BdaColorPalette, type BdaAppearance, type BdaAnimation, type BdaNumberRange, type BdaVectorRange, type BdaAnimationEffect, type BdaAnimationKind, type BdaTransformAnimation, type BdaGroupAnimation, type BdaResourceAnimation, type BdaAnimationSequence, type BdaImageAnimation, type BdaEmitterAnimation, type BdaAnimationBinding, type BdaSoundConfig } from "./bda.ts"

export const decoder = new TextDecoder("utf-8", { fatal: true })

export function fields(bytes: Uint8Array): ProtoField[] {
  const result: ProtoField[] = []
  let offset = 0
  const varint = () => {
    let value = 0n
    let shift = 0n
    for (let count = 0; offset < bytes.length && count < 10; count++) {
      const byte = bytes[offset++]
      value |= BigInt(byte & 0x7f) << shift
      if (!(byte & 0x80)) {
        return value <= BigInt(Number.MAX_SAFE_INTEGER)
          ? Number(value)
          : Number(BigInt.asIntN(32, value))
      }
      shift += 7n
    }
    throw new Error("无效的 protobuf varint")
  }
  while (offset < bytes.length) {
    const tag = varint()
    const number = Math.floor(tag / 8)
    const wire = tag & 7
    if (!number) throw new Error("无效的 protobuf 字段")
    if (wire === 0) result.push({ number, wire, varint: varint() })
    else if (wire === 1) {
      offset += 8
      result.push({ number, wire })
    } else if (wire === 2) {
      const length = varint()
      if (offset + length > bytes.length) throw new Error("不完整的 protobuf 字段")
      result.push({ number, wire, bytes: bytes.slice(offset, offset + length) })
      offset += length
    } else if (wire === 5) {
      if (offset + 4 > bytes.length) throw new Error("不完整的 protobuf 字段")
      result.push({ number, wire, fixed32: new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getFloat32(0, true) })
      offset += 4
    } else throw new Error(`不支持的 protobuf wire type：${wire}`)
    if (offset > bytes.length) throw new Error("不完整的 protobuf 字段")
  }
  return result
}

export function message(field: ProtoField | undefined): ProtoField[] {
  return field?.bytes ? fields(field.bytes) : []
}

export function string(field: ProtoField | undefined): string {
  if (!field?.bytes) return ""
  try {
    return decoder.decode(field.bytes)
  } catch {
    return ""
  }
}

export function first(items: ProtoField[], number: number): ProtoField | undefined {
  return items.find((field) => field.number === number)
}

export function mapEntries(items: ProtoField[], number: number): ProtoField[][] {
  return items
    .filter((field) => field.number === number && field.wire === 2)
    .map(message)
}

export function resource(field: ProtoField | undefined): BdaResource | undefined {
  const value = message(field)
  if (!value.length) return
  return {
    type: first(value, 1)?.varint ?? 0,
    resourceID: string(first(value, 2)),
  }
}

export function styleRef(field: ProtoField | undefined): BdaStyleRef | undefined {
  const value = message(field)
  if (!value.length) return
  const types = ["image", "color", "text"] as const
  return { type: types[first(value, 1)?.varint ?? 0] ?? "image", key: first(value, 2)?.varint ?? 0 }
}

export function styleRefs(value: ProtoField[], number: number): BdaStyleRef[] {
  return value.filter((item) => item.number === number).flatMap((item) => {
    const style = styleRef(item)
    return style ? [style] : []
  })
}

export function float(value: ProtoField[], number: number): number {
  return first(value, number)?.fixed32 ?? 0
}

export function scaledOffset(field: ProtoField | undefined): BdaScaledOffset | undefined {
  if (!field) return
  const value = message(field)
  return { x: float(value, 1), y: float(value, 2) }
}

export function stringMap<T>(value: ProtoField[], number: number, decode: (field: ProtoField | undefined) => T): Map<string, T> {
  return new Map(mapEntries(value, number).map((entry) => [
    string(first(entry, 1)),
    decode(first(entry, 2)),
  ]))
}

export function rect(field: ProtoField | undefined): BdaRect | undefined {
  const value = message(field)
  if (!value.length) return
  const original = message(first(value, 1))
  const size = message(first(value, 2))
  return {
    x: first(original, 1)?.varint ?? float(original, 3),
    y: first(original, 2)?.varint ?? float(original, 4),
    width: first(size, 1)?.varint ?? float(size, 3),
    height: first(size, 2)?.varint ?? float(size, 4),
  }
}

export function imageAtom(field: ProtoField | undefined): BdaImageAtom | undefined {
  const value = message(field)
  if (!value.length) return
  const inset = message(first(value, 3))
  return {
    resource: resource(first(value, 1)),
    innerRect: rect(first(value, 2)),
    contentInset: inset.length ? {
      top: float(inset, 1),
      left: float(inset, 2),
      bottom: float(inset, 3),
      right: float(inset, 4),
    } : undefined,
    alpha: first(value, 4)?.fixed32,
    filterColor: first(value, 5)?.varint,
  }
}

export function imageStyle(field: ProtoField | undefined): BdaImageStyle {
  const value = message(field)
  const font = message(first(value, 3))
  return {
    normalImage: imageAtom(first(value, 1)),
    highlightImage: imageAtom(first(value, 2)),
    fontInfo: font.length ? {
      fontSize: first(font, 1)?.varint,
      normalColor: first(font, 2)?.varint,
      highlightColor: first(font, 3)?.varint,
      contentText: first(font, 4) ? string(first(font, 4)) : undefined,
      scaledOffset: scaledOffset(first(font, 5)),
      drawType: first(font, 6)?.varint,
    } : undefined,
  }
}

export function textStyle(field: ProtoField | undefined): BdaTextStyle {
  const value = message(field)
  return {
    resource: resource(first(value, 1)),
    fontName: first(value, 2) ? string(first(value, 2)) : undefined,
    fontSize: first(value, 3)?.varint,
    normalColor: first(value, 4)?.varint,
    highlightColor: first(value, 5)?.varint,
    contentText: first(value, 6) ? string(first(value, 6)) : undefined,
  }
}

export function colorStyle(field: ProtoField | undefined): BdaColorStyle {
  const value = message(field)
  return {
    normalColor: first(value, 1)?.varint,
    highlightColor: first(value, 2)?.varint,
  }
}

export function key(field: ProtoField | undefined): BdaKey {
  const value = message(field)
  return {
    backStyle: styleRef(first(value, 1)),
    foreStyles: styleRefs(value, 2),
    foreStyleOffsets: value.filter((item) => item.number === 3).flatMap((item) => {
      const offset = scaledOffset(item)
      return offset ? [offset] : []
    }),
    backStyleState: styleRef(first(value, 4)),
  }
}

export function bar(field: ProtoField | undefined): BdaBar | undefined {
  const value = message(field)
  return value.length ? { backStyle: styleRef(first(value, 1)) } : undefined
}

export function tab(field: ProtoField | undefined): BdaTab | undefined {
  const value = message(field)
  return value.length ? {
    backStyle: styleRef(first(value, 1)),
    cellForeStyle: styleRef(first(value, 2)),
    cellBackStyle: styleRef(first(value, 3)),
    decoratorBackStyle: styleRef(first(value, 4)),
  } : undefined
}

export function corpusList(field: ProtoField | undefined): BdaCorpusList | undefined {
  const value = message(field)
  return value.length ? {
    backStyle: styleRef(first(value, 1)),
    cellForeStyle: styleRef(first(value, 2)),
    cellBackStyle: styleRef(first(value, 3)),
    corpusSecondTab: tab(first(value, 4)),
  } : undefined
}

export function gamePanel(field: ProtoField | undefined): BdaGamePanel | undefined {
  const value = message(field)
  return value.length ? {
    backStyle: styleRef(first(value, 1)),
    corpusFirstTab: tab(first(value, 2)),
    corpusList: corpusList(first(value, 3)),
    functionBar: bar(first(value, 4)),
    keys: stringMap(value, 5, key),
  } : undefined
}

export function switchStyle(field: ProtoField | undefined): BdaSwitch | undefined {
  const value = message(field)
  return value.length ? {
    normalBack: styleRef(first(value, 1)),
    selectBack: styleRef(first(value, 2)),
    normalFore: styleRef(first(value, 3)),
    selectFore: styleRef(first(value, 4)),
  } : undefined
}

export function cand(field: ProtoField | undefined): BdaCand | undefined {
  const value = message(field)
  return value.length ? {
    candBarStyle: styleRef(first(value, 1)),
    candOnBarStyle: styleRef(first(value, 2)),
    cellBackStyle: styleRef(first(value, 3)),
    cellForeStyle: styleRef(first(value, 4)),
    firstCellForeStyle: styleRef(first(value, 5)),
    firstCellBackStyle: styleRef(first(value, 6)),
    subCandCellForeStyle: styleRef(first(value, 7)),
    subCandCellBackStyle: styleRef(first(value, 8)),
    switch: switchStyle(first(value, 9)),
    candKeys: stringMap(value, 10, key),
    subCandBackStyle: styleRef(first(value, 11)),
    menuKeys: stringMap(value, 12, key),
    aiIcon: first(value, 13) ? key(first(value, 13)) : undefined,
    accessoryBackStyle: styleRef(first(value, 14)),
    gridLeftForeStyle: styleRef(first(value, 15)),
    gridRightForeStyle: styleRef(first(value, 16)),
  } : undefined
}

export function list(field: ProtoField | undefined): BdaList {
  const value = message(field)
  return {
    backStyle: styleRef(first(value, 1)),
    cellBackStyle: styleRef(first(value, 2)),
    cellForeStyle: styleRef(first(value, 3)),
    foreStyles: styleRefs(value, 4),
    foreStyleOffsets: value.filter((item) => item.number === 5).flatMap((item) => {
      const offset = scaledOffset(item)
      return offset ? [offset] : []
    }),
  }
}

export function hint(field: ProtoField | undefined): BdaHint {
  const value = message(field)
  return {
    offset: scaledOffset(first(value, 1)),
    backStyle: styleRef(first(value, 2)),
    barStyle: styleRef(first(value, 3)),
    barOffset: scaledOffset(first(value, 4)),
    foreStyle: styleRef(first(value, 5)),
    cellStyle: styleRef(first(value, 6)),
  }
}

export function inputTile(field: ProtoField | undefined): BdaInputTile | undefined {
  const value = message(field)
  return value.length ? {
    backStyle: styleRef(first(value, 1)),
    textStyle: styleRef(first(value, 2)),
  } : undefined
}

export function grid(field: ProtoField | undefined): BdaGrid | undefined {
  const value = message(field)
  return value.length ? {
    backStyle: styleRef(first(value, 1)),
    cellForeStyle: styleRef(first(value, 2)),
    cellBackStyle: styleRef(first(value, 3)),
  } : undefined
}

export function panel(field: ProtoField | undefined): BdaPanel {
  const value = message(field)
  return {
    hints: stringMap(value, 1, hint),
    lists: stringMap(value, 2, list),
    keys: stringMap(value, 3, key),
    cand: cand(first(value, 4)),
    input: inputTile(first(value, 5)),
    more: grid(first(value, 6)),
    backStyle: styleRef(first(value, 7)),
    shouldBgBlur: first(value, 8) ? first(value, 8)?.varint !== 0 : undefined,
    trackColor: first(value, 9)?.varint,
    wholeBackStyle: styleRef(first(value, 10)),
    shouldKeySlotting: first(value, 11) ? first(value, 11)?.varint !== 0 : undefined,
    inputRegionBackStyle: styleRef(first(value, 12)),
  }
}

export const paletteFields = [
  "labelColor", "secondaryLabelColor", "tertiaryLabelColor", "quaternaryLabelColor", "brandColor",
  "systemBackgroundColor", "secondarySystemBackgroundColor", "tertiarySystemBackgroundColor",
  "elevatedSystemBackgroundColor", "secondaryElevatedSystemBackgroundColor", "tertiaryElevatedSystemBackgroundColor",
  "systemGroupedBackgroundColor", "secondarySystemGroupedBackgroundColor", "tertiarySystemGroupedBackgroundColor",
  "separatorColor", "opaqueSeparatorColor", "systemFillColor", "secondarySystemFillColor", "tertiarySystemFillColor",
  "quaternarySystemFillColor", "maskColor", "maskBlurColor", "bulletWindowColor", "opaqueBulletWindowColor",
  "editBlueColor", "editDeepBlueColor", "editRedColor",
] as const satisfies readonly (keyof BdaColorPalette)[]

export function colorPalette(field: ProtoField | undefined): BdaColorPalette | undefined {
  const value = message(field)
  if (!value.length) return
  const result: BdaColorPalette = {}
  paletteFields.forEach((name, index) => {
    const color = first(value, index + 1)?.varint
    if (color !== undefined) result[name] = color
  })
  return result
}

export function numericMap<T>(root: ProtoField[], number: number, decode: (field: ProtoField | undefined) => T): Map<number, T> {
  return new Map(mapEntries(root, number).map((entry) => [
    first(entry, 1)?.varint ?? 0,
    decode(first(entry, 2)),
  ]))
}

// SkinArchive 未修改的文件返回同一个 Uint8Array，按实例缓存；结果是共享对象，调用方不得修改。
export const decodedAppearances = new WeakMap<Uint8Array, BdaAppearance>()

export function decodeBdaAppearance(bytes: Uint8Array): BdaAppearance {
  let appearance = decodedAppearances.get(bytes)
  if (!appearance) decodedAppearances.set(bytes, appearance = decodeBdaAppearanceUncached(bytes))
  return appearance
}

export function decodeBdaAppearanceUncached(bytes: Uint8Array): BdaAppearance {
  const root = fields(bytes)
  return {
    designWidth: first(root, 6)?.varint,
    imageStyles: numericMap(root, 1, imageStyle),
    textStyles: numericMap(root, 2, textStyle),
    colorStyles: numericMap(root, 3, colorStyle),
    panels: new Map(mapEntries(root, 4).map((entry) => [
      string(first(entry, 1)),
      panel(first(entry, 2)),
    ])),
    colorPalette: colorPalette(first(root, 5)),
    gamePanel: gamePanel(first(root, 7)),
    dragBar: bar(first(root, 8)),
  }
}

export function decodeBdaAnimation(bytes: Uint8Array): BdaAnimation {
  const root = fields(bytes)
  // proto int32 的负数是二进制补码 varint，按 32 位有符号还原。
  const int32 = (field: ProtoField | undefined): number => {
    const value = field?.varint ?? 0
    return value > 0x7fffffff ? value - 0x1_0000_0000 : value
  }
  const numberRange = (field: ProtoField | undefined): BdaNumberRange => {
    const value = message(field)
    const min = int32(first(value, 1))
    const max = first(value, 2)
    return [min, max ? int32(max) : min]
  }
  const vectorRange = (field: ProtoField | undefined): BdaVectorRange => {
    const value = message(field)
    return [numberRange(first(value, 1)), numberRange(first(value, 2))]
  }
  const range = (field: ProtoField | undefined): BdaNumberRange => {
    const value = message(field)
    const location = float(value, 1)
    return [location, location + float(value, 2)]
  }
  const common = (value: ProtoField[]) => ({
    repeatCount: first(value, 1)?.varint ?? 0,
    repeatMode: first(value, 2)?.varint ?? 0,
    delay: first(value, 3)?.varint ?? 0,
    removeOnFinish: (first(value, 4)?.varint ?? 0) !== 0,
    duration: first(value, 7)?.varint ?? 0,
    interpolation: first(value, 8)?.varint ?? 0,
  })
  const effects = new Map<string, BdaAnimationEffect>()
  const addMap = (fieldNumber: number, kind: BdaAnimationKind, decode: (key: string, value: ProtoField[]) => BdaAnimationEffect) => {
    for (const entry of mapEntries(root, fieldNumber)) {
      const key = string(first(entry, 1))
      if (key) effects.set(`${kind}:${key}`, decode(key, message(first(entry, 2))))
    }
  }
  const intPair = (field: ProtoField | undefined): [number, number] | undefined => {
    const value = message(field)
    if (!value.length) return
    return [int32(first(value, 1)), int32(first(value, 2))]
  }
  const intpolXY = (field: ProtoField | undefined): [number, number] | undefined => {
    const value = message(field)
    if (!value.length) return
    return [first(value, 1)?.varint ?? 0, first(value, 2)?.varint ?? 0]
  }
  const transform = (kind: BdaTransformAnimation["kind"]) => (key: string, value: ProtoField[]): BdaTransformAnimation => {
    const scalar = kind === "alpha" || kind === "rotate"
    const pixel = kind === "shift" && first(value, 9) !== undefined && first(value, 10) !== undefined
    const pivot = kind === "scale" || kind === "rotate"
    const from = pixel ? vectorRange(first(value, 9)) : scalar
      ? [numberRange(first(value, 5)), numberRange(first(value, 5))] as BdaVectorRange
      : vectorRange(first(value, 5))
    const to = pixel ? vectorRange(first(value, 10)) : scalar
      ? [numberRange(first(value, 6)), numberRange(first(value, 6))] as BdaVectorRange
      : vectorRange(first(value, 6))
    return {
      kind, key, ...common(value), from, to,
      relative: kind === "scale" || kind === "shift" && !pixel,
      ...(kind === "scale" || kind === "shift" ? { interpolationXY: intpolXY(first(value, 11)) } : {}),
      ...(pivot ? { pivotPx: intPair(first(value, 9)), pivot: intPair(first(value, 10)) } : {}),
    }
  }
  const simpleKinds = ["group", "alpha", "scale", "shift", "rotate"] as const
  const complexKinds = ["frame", "image", "emitter", "lottie", "video"] as const
  addMap(3, "group", (key, value): BdaGroupAnimation => ({
    kind: "group", key,
    buildMode: first(value, 1)?.varint ?? 0,
    repeatCount: first(value, 2)?.varint ?? 0,
    repeatMode: first(value, 3)?.varint ?? 0,
    removeOnFinish: (first(value, 4)?.varint ?? 0) !== 0,
    delay: first(value, 5)?.varint ?? 0,
    items: value.filter((field) => field.number === 6).map(message).map((item) => ({
      kind: simpleKinds[first(item, 1)?.varint ?? 0] ?? "group",
      key: string(first(item, 2)),
    })).filter((item) => Boolean(item.key)),
  }))
  addMap(4, "alpha", transform("alpha"))
  addMap(5, "scale", transform("scale"))
  addMap(6, "shift", transform("shift"))
  addMap(7, "rotate", transform("rotate"))

  const media = (kind: BdaResourceAnimation["kind"]) => (key: string, value: ProtoField[]): BdaResourceAnimation => ({
    kind, key,
    repeatCount: first(value, 1)?.varint ?? 0,
    removeOnFinish: (first(value, 2)?.varint ?? 0) !== 0,
    resource: resource(first(value, 3)),
    startRepeatFrame: first(value, 4)?.varint,
    placeholder: kind === "video" ? resource(first(value, 5)) : undefined,
  })
  addMap(8, "frame", media("frame"))

  const sequences = new Map<string, BdaAnimationSequence>()
  addMap(9, "image", (key, value): BdaImageAnimation => {
    const sequence = {
      name: key,
      frames: value.filter((field) => field.number === 5).map((field) => {
        const frame = message(field)
        return { resourceID: resource(first(frame, 1))?.resourceID, duration: first(frame, 2)?.varint }
      }),
    }
    sequences.set(key, sequence)
    return {
      kind: "image", key, sequence,
      repeatCount: first(value, 1)?.varint ?? 0,
      repeatMode: first(value, 2)?.varint ?? 0,
      removeOnFinish: (first(value, 4)?.varint ?? 0) !== 0,
      loopForever: (first(value, 6)?.varint ?? 0) !== 0,
      startRepeatFrame: first(value, 7)?.varint ?? 0,
    }
  })
  addMap(10, "emitter", (key, value): BdaEmitterAnimation => {
    const edge = message(first(value, 12))
    return {
      kind: "emitter", key,
      repeatCount: first(value, 3)?.varint ?? 0,
      repeatMode: first(value, 4)?.varint ?? 0,
      removeOnFinish: (first(value, 5)?.varint ?? 0) !== 0,
      duration: float(value, 6),
      birthRate: first(value, 7)?.varint ?? 0,
      totalNumber: first(value, 8)?.varint ?? 0,
      emitRegion: [float(edge, 2), float(edge, 1), float(edge, 4), float(edge, 3)],
      resources: value.filter((field) => field.number === 13).flatMap((field) => {
        const item = resource(field)
        return item ? [item] : []
      }),
      life: range(first(value, 14)), rotation: range(first(value, 15)), spin: range(first(value, 16)),
      scale: range(first(value, 17)), scaleSpeed: range(first(value, 18)), alpha: range(first(value, 19)),
      alphaSpeed: range(first(value, 20)), velocity: range(first(value, 21)),
      velocityDirection: range(first(value, 22)), acceleration: range(first(value, 23)),
      accelerationDirection: range(first(value, 24)),
      finishAfterPractices: first(value, 9)?.varint ?? 0,
      keepParticlesOnRemove: first(value, 10)?.varint ?? 0,
      mirrorUp: first(value, 11)?.varint ?? 0,
      paths: value.filter((field) => field.number === 25).map((field) => ({
        elements: message(field).filter((element) => element.number === 1).map((element) => {
          const item = message(element)
          return {
            type: first(item, 1)?.varint ?? 0,
            point1: intPair(first(item, 2)),
            point2: intPair(first(item, 3)),
            point3: intPair(first(item, 4)),
          }
        }),
      })),
      emitterType: first(value, 26)?.varint ?? 0,
    }
  })
  addMap(11, "lottie", media("lottie"))
  addMap(13, "video", media("video"))

  const animationMap = mapEntries(root, 1).map((entry) => {
    const target = string(first(entry, 1))
    const list = message(first(entry, 2))
    const bindings: BdaAnimationBinding[] = list.flatMap((field): BdaAnimationBinding[] => {
      const item = message(field)
      if (field.number === 1) {
        const simple = first(item, 2)?.varint
        const complex = first(item, 3)?.varint
        const kind = simple !== undefined ? simpleKinds[simple] : complex !== undefined ? complexKinds[complex] : undefined
        const key = string(first(item, 4))
        return kind && key ? [{
          kind, key, scope: first(item, 1)?.varint ?? 0, event: first(item, 5)?.varint ?? 0,
          isolated: false, condition: string(first(item, 6)) || undefined,
        }] : []
      }
      if (field.number === 2) {
        const kind = complexKinds[first(item, 2)?.varint ?? 0]
        const key = string(first(item, 3))
        return kind && key ? [{
          kind, key, scope: 0, event: first(item, 4)?.varint ?? 0, isolated: true,
          location: first(item, 1)?.varint ?? 0, condition: string(first(item, 5)) || undefined,
          removeOnInteraction: (first(item, 6)?.varint ?? 0) !== 0,
        }] : []
      }
      return []
    })
    return {
      target,
      bindings,
      delegate: string(first(list, 3)),
    }
  }).filter(({ target }) => Boolean(target))
  const direct = new Map(animationMap.map(({ target, bindings }) => [target, bindings] as const))
  const delegates = new Map(animationMap.flatMap(({ target, delegate }) => delegate ? [[target, delegate] as const] : []))
  const targetBinding = (target: string, seen = new Set<string>()): BdaAnimationBinding[] => {
    if (seen.has(target)) return []
    const own = direct.get(target) ?? []
    seen.add(target)
    const delegate = delegates.get(target)
    return [...own, ...(delegate ? targetBinding(delegate, seen) : [])]
  }
  const targetBindings = new Map(animationMap.map(({ target }) => [target, targetBinding(target)]))
  return {
    designWidth: first(root, 12)?.varint,
    targets: animationMap.map(({ target }) => target),
    sequences,
    targetBindings,
    effects,
    bindings: new Map(animationMap.flatMap(({ target }) => {
      const image = targetBinding(target).find((binding) => binding.kind === "image")
      return image ? [[target, image.key] as const] : []
    })),
  }
}

export function decodeBdaSoundConfig(bytes: Uint8Array): BdaSoundConfig {
  const root = fields(bytes)
  const soundMap = (fieldNumber: number) => new Map(mapEntries(root, fieldNumber).flatMap((entry) => {
    const key = string(first(entry, 1))
    const value = resource(first(entry, 2))
    return key && value ? [[key, value] as const] : []
  }))
  return {
    keySounds: soundMap(1),
    iosKeySounds: soundMap(3),
  }
}
