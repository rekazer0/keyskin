// BDA 外观配置的 protobuf 编码：把解码出的结构原样写回去。
//
// 字段号与 `bda-decode.ts` 一一对应：解码读第 N 号字段，这里就写第 N 号。
// 数值用 varint，浮点用 fixed32（小端 IEEE754），嵌套消息与字符串用长度前缀。
import { type BdaAnimation, type BdaAnimationBinding, type BdaAppearance, type BdaBar, type BdaCand, type BdaColorPalette, type BdaColorStyle, type BdaEmitterAnimation, type BdaGamePanel, type BdaGrid, type BdaGroupAnimation, type BdaHint, type BdaImageAnimation, type BdaImageAtom, type BdaImageStyle, type BdaInputTile, type BdaKey, type BdaList, type BdaNumberRange, type BdaPanel, type BdaRect, type BdaResource, type BdaResourceAnimation, type BdaScaledOffset, type BdaSoundConfig, type BdaStyleRef, type BdaTab, type BdaTextStyle, type BdaTransformAnimation, type BdaVectorRange, type ProtoField } from "@/bda.ts"
import { encodeVarint, encodedField, join } from "@/bda-encode.ts"

/* —— 基础编码 —— */

function varintField(number: number, value: number | undefined): ProtoField[] {
  return value === undefined ? [] : [{ number, wire: 0, varint: value >>> 0 }]
}

function fixed32Field(number: number, value: number | undefined): ProtoField[] {
  if (value === undefined) return []
  const buffer = new ArrayBuffer(4)
  new DataView(buffer).setFloat32(0, value, true)
  return [{ number, wire: 5, fixed32: new DataView(buffer).getUint32(0, true) }]
}

function messageField(number: number, fields: ProtoField[]): ProtoField[] {
  return fields.length ? [{ number, wire: 2, bytes: encodeFields(fields) }] : []
}

/**
 * 只要对象存在就写出消息，哪怕内容为空。
 * 解码器对这类字段按「有没有这个字段」判断存在，省略一个空消息会改变语义。
 */
function presenceField(number: number, fields: ProtoField[], present: boolean): ProtoField[] {
  return present ? [{ number, wire: 2, bytes: encodeFields(fields) }] : []
}

function stringField(number: number, value: string | undefined): ProtoField[] {
  if (value === undefined) return []
  return [{ number, wire: 2, bytes: new TextEncoder().encode(value) }]
}

/** 把字段列表序列化成字节；wire 决定载荷编码方式。 */
export function encodeFields(fields: readonly ProtoField[]): Uint8Array {
  return join(fields.map((field) => {
    if (field.wire === 0) return encodedField(field.number, 0, encodeVarint(field.varint ?? 0))
    if (field.wire === 5) {
      const buffer = new Uint8Array(4)
      new DataView(buffer.buffer).setUint32(0, field.fixed32 ?? 0, true)
      return encodedField(field.number, 5, buffer)
    }
    return encodedField(field.number, 2, field.bytes ?? new Uint8Array())
  }))
}

/* —— 标量消息 —— */

function encodeResource(resource: BdaResource | undefined): ProtoField[] {
  if (!resource) return []
  return [...varintField(1, resource.type), ...stringField(2, resource.resourceID)]
}

/** 样式引用：类型 0/1/2 分别是图片、颜色、文字。 */
function encodeStyleRef(ref: BdaStyleRef | undefined): ProtoField[] {
  if (!ref) return []
  const type = ref.type === "image" ? 0 : ref.type === "color" ? 1 : 2
  return [...varintField(1, type), ...varintField(2, ref.key)]
}

function encodeScaledOffset(offset: BdaScaledOffset | undefined): ProtoField[] {
  if (!offset) return []
  return [...fixed32Field(1, offset.x), ...fixed32Field(2, offset.y)]
}

function encodeRect(rect: BdaRect | undefined): ProtoField[] {
  if (!rect) return []
  return [
    ...messageField(1, [...varintField(1, rect.x), ...varintField(2, rect.y)]),
    ...messageField(2, [...varintField(1, rect.width), ...varintField(2, rect.height)]),
  ]
}

/* —— 样式表 —— */

function encodeImageAtom(atom: BdaImageAtom | undefined): ProtoField[] {
  if (!atom) return []
  const inset = atom.contentInset
  return [
    ...messageField(1, encodeResource(atom.resource)),
    ...messageField(2, encodeRect(atom.innerRect)),
    ...messageField(3, inset
      ? [
        ...fixed32Field(1, inset.top),
        ...fixed32Field(2, inset.left),
        ...fixed32Field(3, inset.bottom),
        ...fixed32Field(4, inset.right),
      ]
      : []),
    ...fixed32Field(4, atom.alpha),
    ...varintField(5, atom.filterColor),
  ]
}

function encodeImageStyle(style: BdaImageStyle): ProtoField[] {
  const font = style.fontInfo
  return [
    ...messageField(1, encodeImageAtom(style.normalImage)),
    ...messageField(2, encodeImageAtom(style.highlightImage)),
    ...messageField(3, font
      ? [
        ...varintField(1, font.fontSize),
        ...varintField(2, font.normalColor),
        ...varintField(3, font.highlightColor),
        ...stringField(4, font.contentText),
        ...messageField(5, encodeScaledOffset(font.scaledOffset)),
        ...varintField(6, font.drawType),
      ]
      : []),
  ]
}

function encodeTextStyle(style: BdaTextStyle): ProtoField[] {
  return [
    ...messageField(1, encodeResource(style.resource)),
    ...stringField(2, style.fontName),
    ...varintField(3, style.fontSize),
    ...varintField(4, style.normalColor),
    ...varintField(5, style.highlightColor),
    ...stringField(6, style.contentText),
  ]
}

function encodeColorStyle(style: BdaColorStyle): ProtoField[] {
  return [...varintField(1, style.normalColor), ...varintField(2, style.highlightColor)]
}

/* —— 按键与面板 —— */

function encodeStyleRefs(number: number, refs: readonly BdaStyleRef[]): ProtoField[] {
  return refs.flatMap((ref) => messageField(number, encodeStyleRef(ref)))
}

function encodeOffsets(number: number, offsets: readonly BdaScaledOffset[]): ProtoField[] {
  return offsets.flatMap((offset) => messageField(number, encodeScaledOffset(offset)))
}

function encodeKey(key: BdaKey): ProtoField[] {
  return [
    ...messageField(1, encodeStyleRef(key.backStyle)),
    ...encodeStyleRefs(2, key.foreStyles),
    ...encodeOffsets(3, key.foreStyleOffsets),
    ...messageField(4, encodeStyleRef(key.backStyleState)),
  ]
}

function encodeBar(bar: BdaBar | undefined): ProtoField[] {
  if (!bar) return []
  return messageField(1, encodeStyleRef(bar.backStyle))
}

function encodeTab(tab: BdaTab | undefined): ProtoField[] {
  if (!tab) return []
  return [
    ...messageField(1, encodeStyleRef(tab.backStyle)),
    ...messageField(2, encodeStyleRef(tab.cellForeStyle)),
    ...messageField(3, encodeStyleRef(tab.cellBackStyle)),
    ...messageField(4, encodeStyleRef(tab.decoratorBackStyle)),
  ]
}

function encodeHint(hint: BdaHint): ProtoField[] {
  return [
    ...messageField(1, encodeScaledOffset(hint.offset)),
    ...messageField(2, encodeStyleRef(hint.backStyle)),
    ...messageField(3, encodeStyleRef(hint.barStyle)),
    ...messageField(4, encodeScaledOffset(hint.barOffset)),
    ...messageField(5, encodeStyleRef(hint.foreStyle)),
    ...messageField(6, encodeStyleRef(hint.cellStyle)),
  ]
}

function encodeList(list: BdaList): ProtoField[] {
  return [
    ...messageField(1, encodeStyleRef(list.backStyle)),
    ...messageField(2, encodeStyleRef(list.cellBackStyle)),
    ...messageField(3, encodeStyleRef(list.cellForeStyle)),
    ...encodeStyleRefs(4, list.foreStyles),
    ...encodeOffsets(5, list.foreStyleOffsets),
  ]
}

function encodeSwitch(switchStyle: BdaCand["switch"]): ProtoField[] {
  if (!switchStyle) return []
  return [
    ...messageField(1, encodeStyleRef(switchStyle.normalBack)),
    ...messageField(2, encodeStyleRef(switchStyle.selectBack)),
    ...messageField(3, encodeStyleRef(switchStyle.normalFore)),
    ...messageField(4, encodeStyleRef(switchStyle.selectFore)),
  ]
}

function encodeCand(cand: BdaCand): ProtoField[] {
  return [
    ...messageField(1, encodeStyleRef(cand.candBarStyle)),
    ...messageField(2, encodeStyleRef(cand.candOnBarStyle)),
    ...messageField(3, encodeStyleRef(cand.cellBackStyle)),
    ...messageField(4, encodeStyleRef(cand.cellForeStyle)),
    ...messageField(5, encodeStyleRef(cand.firstCellForeStyle)),
    ...messageField(6, encodeStyleRef(cand.firstCellBackStyle)),
    ...messageField(7, encodeStyleRef(cand.subCandCellForeStyle)),
    ...messageField(8, encodeStyleRef(cand.subCandCellBackStyle)),
    ...presenceField(9, encodeSwitch(cand.switch), cand.switch !== undefined),
    ...stringMapField(10, cand.candKeys, encodeKey),
    ...messageField(11, encodeStyleRef(cand.subCandBackStyle)),
    ...stringMapField(12, cand.menuKeys, encodeKey),
    ...messageField(13, cand.aiIcon ? encodeKey(cand.aiIcon) : []),
    ...messageField(14, encodeStyleRef(cand.accessoryBackStyle)),
    ...messageField(15, encodeStyleRef(cand.gridLeftForeStyle)),
    ...messageField(16, encodeStyleRef(cand.gridRightForeStyle)),
  ]
}

function encodeInputTile(input: BdaInputTile): ProtoField[] {
  return [
    ...messageField(1, encodeStyleRef(input.backStyle)),
    ...messageField(2, encodeStyleRef(input.textStyle)),
  ]
}

function encodeGrid(grid: BdaGrid): ProtoField[] {
  return [
    ...messageField(1, encodeStyleRef(grid.backStyle)),
    ...messageField(2, encodeStyleRef(grid.cellForeStyle)),
    ...messageField(3, encodeStyleRef(grid.cellBackStyle)),
  ]
}

function encodePanel(panel: BdaPanel): ProtoField[] {
  return [
    ...stringMapField(1, panel.hints, encodeHint),
    ...stringMapField(2, panel.lists, encodeList),
    ...stringMapField(3, panel.keys, encodeKey),
    ...presenceField(4, panel.cand ? encodeCand(panel.cand) : [], panel.cand !== undefined),
    ...presenceField(5, panel.input ? encodeInputTile(panel.input) : [], panel.input !== undefined),
    ...presenceField(6, panel.more ? encodeGrid(panel.more) : [], panel.more !== undefined),
    ...messageField(7, encodeStyleRef(panel.backStyle)),
    ...varintField(8, panel.shouldBgBlur === undefined ? undefined : panel.shouldBgBlur ? 1 : 0),
    ...varintField(9, panel.trackColor),
    ...messageField(10, encodeStyleRef(panel.wholeBackStyle)),
    ...varintField(11, panel.shouldKeySlotting === undefined ? undefined : panel.shouldKeySlotting ? 1 : 0),
    ...messageField(12, encodeStyleRef(panel.inputRegionBackStyle)),
  ]
}

function encodeGamePanel(panel: BdaGamePanel | undefined): ProtoField[] {
  if (!panel) return []
  return [
    ...messageField(1, encodeStyleRef(panel.backStyle)),
    ...messageField(2, encodeTab(panel.corpusFirstTab)),
    ...messageField(3, panel.corpusList
      ? [
        ...messageField(1, encodeStyleRef(panel.corpusList.backStyle)),
        ...messageField(2, encodeStyleRef(panel.corpusList.cellForeStyle)),
        ...messageField(3, encodeStyleRef(panel.corpusList.cellBackStyle)),
        ...messageField(4, encodeTab(panel.corpusList.corpusSecondTab)),
      ]
      : []),
    ...messageField(4, encodeBar(panel.functionBar)),
    ...stringMapField(5, panel.keys, encodeKey),
  ]
}

/** 字符串键的 map 项：1 号是键，2 号是值。 */
function stringMapField<T>(number: number, values: ReadonlyMap<string, T>, encode: (value: T) => ProtoField[]): ProtoField[] {
  return [...values].flatMap(([key, value]) => messageField(number, [
    ...stringField(1, key),
    ...messageField(2, encode(value)),
  ]))
}

/** 数字键的 map 项：1 号是键（varint），2 号是值。 */
function numberMapField<T>(number: number, values: ReadonlyMap<number, T>, encode: (value: T) => ProtoField[]): ProtoField[] {
  return [...values].flatMap(([key, value]) => messageField(number, [
    ...varintField(1, key),
    ...messageField(2, encode(value)),
  ]))
}

const PALETTE_FIELDS = [
  "labelColor", "secondaryLabelColor", "tertiaryLabelColor", "quaternaryLabelColor", "brandColor",
  "systemBackgroundColor", "secondarySystemBackgroundColor", "tertiarySystemBackgroundColor",
  "elevatedSystemBackgroundColor", "secondaryElevatedSystemBackgroundColor", "tertiaryElevatedSystemBackgroundColor",
  "systemGroupedBackgroundColor", "secondarySystemGroupedBackgroundColor", "tertiarySystemGroupedBackgroundColor",
  "separatorColor", "opaqueSeparatorColor", "systemFillColor", "secondarySystemFillColor", "tertiarySystemFillColor",
  "quaternarySystemFillColor", "maskColor", "maskBlurColor", "bulletWindowColor", "opaqueBulletWindowColor",
  "editBlueColor", "editDeepBlueColor", "editRedColor",
] as const satisfies readonly (keyof BdaColorPalette)[]

function encodePalette(palette: BdaColorPalette | undefined): ProtoField[] {
  if (!palette) return []
  return PALETTE_FIELDS.flatMap((name, index) => varintField(index + 1, palette[name]))
}

/** 整个外观配置：1/2/3 是三类样式，4 是面板，5 是配色板，6 是设计宽度，7/8 是游戏面板与拖动条。 */
export function encodeAppearance(appearance: BdaAppearance): Uint8Array {
  return encodeFields([
    ...numberMapField(1, appearance.imageStyles, encodeImageStyle),
    ...numberMapField(2, appearance.textStyles, encodeTextStyle),
    ...numberMapField(3, appearance.colorStyles, encodeColorStyle),
    ...stringMapField(4, appearance.panels, encodePanel),
    ...messageField(5, encodePalette(appearance.colorPalette)),
    ...varintField(6, appearance.designWidth),
    ...messageField(7, encodeGamePanel(appearance.gamePanel)),
    ...messageField(8, encodeBar(appearance.dragBar)),
  ])
}

/** 音效配置：1 号是按键音，3 号是 iOS 按键音，键名到资源的映射。 */
export function encodeSoundConfig(config: BdaSoundConfig): Uint8Array {
  const resourceMap = (number: number, values: ReadonlyMap<string, BdaResource>): ProtoField[] =>
    [...values].flatMap(([key, resource]) => messageField(number, [
      ...stringField(1, key),
      ...messageField(2, encodeResource(resource)),
    ]))
  return encodeFields([
    ...resourceMap(1, config.keySounds),
    ...resourceMap(3, config.iosKeySounds),
  ])
}

/* —— 动画配置 —— */

/** 区间写成 `{ location, delta }`：解码时用 location 与 location + delta 还原。 */
function encodeRange(number: number, value: BdaNumberRange | undefined): ProtoField[] {
  if (!value) return []
  return messageField(number, [
    ...fixed32Field(1, value[0]),
    ...fixed32Field(2, value[1] - value[0]),
  ])
}

function encodeIntVectorRange(number: number, value: BdaVectorRange | undefined): ProtoField[] {
  if (!value) return []
  return messageField(number, [
    ...encodeIntRange(1, value[0]),
    ...encodeIntRange(2, value[1]),
  ])
}

/** 变换类动效的区间是 varint（可为负），与粒子效果的浮点区间不是同一套编码。 */
function encodeIntRange(number: number, value: BdaNumberRange | undefined): ProtoField[] {
  if (!value) return []
  return messageField(number, [
    ...varintField(1, value[0]),
    ...(value[1] !== value[0] ? varintField(2, value[1]) : []),
  ])
}

/** 整数对（轴向或像素中心）。 */
function encodeIntPair(number: number, value: [number, number] | undefined): ProtoField[] {
  if (!value) return []
  return messageField(number, [...varintField(1, value[0]), ...varintField(2, value[1])])
}

/** 一条绑定；列表元素用哪个字段号由调用方按 `isolated` 决定。 */
function encodeBinding(item: BdaAnimationBinding): ProtoField[] {
  const simple = ["group", "alpha", "scale", "shift", "rotate"] as const
  const complex = ["frame", "image", "emitter", "lottie", "video"] as const
  const isSimple = (simple as readonly string[]).includes(item.kind)
  if (item.isolated) {
    // 随交互移除的复杂绑定：位置、类型、键、事件、条件、移除开关。
    return [
      ...varintField(1, item.location ?? 0),
      ...varintField(2, complex.indexOf(item.kind as typeof complex[number])),
      ...stringField(3, item.key),
      ...varintField(4, item.event),
      ...stringField(5, item.condition),
      ...varintField(6, item.removeOnInteraction ? 1 : 0),
    ]
  }
  return [
    ...varintField(1, item.scope),
    ...(isSimple ? varintField(2, simple.indexOf(item.kind as typeof simple[number])) : varintField(3, complex.indexOf(item.kind as typeof complex[number]))),
    ...stringField(4, item.key),
    ...varintField(5, item.event),
    ...stringField(6, item.condition),
  ]
}

function encodeTransform(effect: BdaTransformAnimation): ProtoField[] {
  // alpha 与 rotate 是单值区间，scale 与 shift 才是双轴向量。
  const scalar = effect.kind === "alpha" || effect.kind === "rotate"
  return [
    ...varintField(1, effect.repeatCount),
    ...varintField(2, effect.repeatMode),
    ...varintField(3, effect.delay),
    ...varintField(4, effect.removeOnFinish ? 1 : 0),
    ...(scalar ? encodeIntRange(5, effect.from[0]) : encodeIntVectorRange(5, effect.from)),
    ...(scalar ? encodeIntRange(6, effect.to[0]) : encodeIntVectorRange(6, effect.to)),
    ...varintField(7, effect.duration),
    ...varintField(8, effect.interpolation),
    ...encodeIntPair(9, effect.pivotPx),
    ...encodeIntPair(10, effect.pivot),
    ...(effect.interpolationXY
      ? messageField(11, [...varintField(1, effect.interpolationXY[0]), ...varintField(2, effect.interpolationXY[1])])
      : []),
  ]
}

function encodeGroup(effect: BdaGroupAnimation): ProtoField[] {
  const simple = ["group", "alpha", "scale", "shift", "rotate"] as const
  return [
    ...varintField(1, effect.buildMode),
    ...varintField(2, effect.repeatCount),
    ...varintField(3, effect.repeatMode),
    ...varintField(4, effect.removeOnFinish ? 1 : 0),
    ...varintField(5, effect.delay),
    ...effect.items.flatMap((item) => messageField(6, [
      ...varintField(1, Math.max(0, (simple as readonly string[]).indexOf(item.kind))),
      ...stringField(2, item.key),
    ])),
  ]
}

function encodeEmitter(effect: BdaEmitterAnimation): ProtoField[] {
  return [
    ...varintField(3, effect.repeatCount),
    ...varintField(4, effect.repeatMode),
    ...varintField(5, effect.removeOnFinish ? 1 : 0),
    ...fixed32Field(6, effect.duration),
    ...varintField(7, effect.birthRate),
    ...varintField(8, effect.totalNumber),
    ...varintField(9, effect.finishAfterPractices),
    ...varintField(10, effect.keepParticlesOnRemove),
    ...varintField(11, effect.mirrorUp),
    ...messageField(12, [
      ...fixed32Field(1, effect.emitRegion[1]),
      ...fixed32Field(2, effect.emitRegion[0]),
      ...fixed32Field(3, effect.emitRegion[3]),
      ...fixed32Field(4, effect.emitRegion[2]),
    ]),
    ...effect.resources.flatMap((resource) => messageField(13, encodeResource(resource))),
    ...encodeRange(14, effect.life),
    ...encodeRange(15, effect.rotation),
    ...encodeRange(16, effect.spin),
    ...encodeRange(17, effect.scale),
    ...encodeRange(18, effect.scaleSpeed),
    ...encodeRange(19, effect.alpha),
    ...encodeRange(20, effect.alphaSpeed),
    ...encodeRange(21, effect.velocity),
    ...encodeRange(22, effect.velocityDirection),
    ...encodeRange(23, effect.acceleration),
    ...encodeRange(24, effect.accelerationDirection),
    ...effect.paths.flatMap((path) => messageField(25, path.elements.flatMap((element) => messageField(1, [
      ...varintField(1, element.type),
      ...encodeIntPair(2, element.point1 ? [element.point1[0], element.point1[1]] : undefined),
      ...encodeIntPair(3, element.point2 ? [element.point2[0], element.point2[1]] : undefined),
      ...encodeIntPair(4, element.point3 ? [element.point3[0], element.point3[1]] : undefined),
    ])))),
    ...varintField(26, effect.emitterType),
  ]
}

function encodeResourceEffect(effect: BdaResourceAnimation): ProtoField[] {
  return [
    ...varintField(1, effect.repeatCount),
    ...varintField(2, effect.removeOnFinish ? 1 : 0),
    ...messageField(3, encodeResource(effect.resource)),
    ...varintField(4, effect.startRepeatFrame),
    ...messageField(5, encodeResource(effect.placeholder)),
  ]
}

/** 图片序列：1 重复次数、2 重复模式、4 播完移除、5 帧清单、6 循环、7 起始帧。 */
function encodeImageEffect(effect: BdaImageAnimation): ProtoField[] {
  return [
    ...varintField(1, effect.repeatCount),
    ...varintField(2, effect.repeatMode),
    ...varintField(4, effect.removeOnFinish ? 1 : 0),
    // 每帧是一个独立的 `#5` 消息；把字段摊平会写成只有一帧。
    ...effect.sequence.frames.flatMap((frame) => messageField(5, [
      ...(frame.resourceID !== undefined ? messageField(1, encodeResource({ type: 0, resourceID: frame.resourceID })) : []),
      ...(frame.duration !== undefined ? varintField(2, frame.duration) : []),
    ])),
    ...varintField(6, effect.loopForever ? 1 : 0),
    ...varintField(7, effect.startRepeatFrame),
  ]
}

/** 动画配置：1 号是目标绑定，3–13 号是各类效果，12 号是设计宽度。 */
export function encodeAnimation(animation: BdaAnimation): Uint8Array {
  const effectFields: ProtoField[] = []
  for (const [id, effect] of animation.effects) {
    const key = effect.key || id.split(":").slice(1).join(":")
    const push = (number: number, fields: ProtoField[]) => effectFields.push(...messageField(number, [...stringField(1, key), ...messageField(2, fields)]))
    if (effect.kind === "group") push(3, encodeGroup(effect))
    else if (effect.kind === "alpha" || effect.kind === "scale" || effect.kind === "shift" || effect.kind === "rotate") {
      push({ alpha: 4, scale: 5, shift: 6, rotate: 7 }[effect.kind], encodeTransform(effect))
    }
    else if (effect.kind === "frame") push(8, encodeResourceEffect(effect))
    else if (effect.kind === "image") push(9, encodeImageEffect(effect))
    else if (effect.kind === "emitter") push(10, encodeEmitter(effect))
    else if (effect.kind === "lottie") push(11, encodeResourceEffect(effect))
    else if (effect.kind === "video") push(13, encodeResourceEffect(effect))
  }
  const targets: ProtoField[] = []
  for (const [target, bindings] of animation.targetBindings) {
    targets.push(...messageField(1, [
      ...stringField(1, target),
      // 普通绑定是列表里的 `#1`，随交互移除的复杂绑定是 `#2`。
      ...messageField(2, bindings.flatMap((item) => messageField(item.isolated ? 2 : 1, encodeBinding(item)))),
    ]))
  }
  return encodeFields([
    ...targets,
    ...effectFields,
    ...varintField(12, animation.designWidth),
  ])
}
