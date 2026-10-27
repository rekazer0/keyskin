import { type BdaAppearance, type BdaStyleRef, type BdaImageAtom, type BdaKey, type BdaHint, type BdaList, type BdaCand, type BdaPanel, type BdaAppearancePart } from "./bda.ts"
import { bdaColorHex } from "./bda-resolver.ts"
import { rawFields, rawString, replaceField, encodeVarint, join, encodedField, updateStringMapValue, colorValue, updateBdaDesignWidth, updateBdaStyle, updateBdaAnimationFrame, applyBdaAnimationEffects, updateBdaKeySound } from "./bda-encode.ts"
import { decodeBdaAppearance, decodeBdaAnimation, decodeBdaSoundConfig } from "./bda-decode.ts"

export function mapObject<K extends string | number, V>(
  values: Map<K, V>,
  encode: (value: V) => unknown = (value) => value,
): Record<string, unknown> {
  return Object.fromEntries([...values].map(([key, value]) => [String(key), encode(value)]))
}

export function decodedAppearanceSource(appearance: BdaAppearance, panelName?: string): Record<string, unknown> {
  const styleRef = (value: BdaStyleRef | undefined) => value && { type: value.type, key: value.key }
  const imageAtomSource = (value: BdaImageAtom | undefined) => value && {
    resource: value.resource,
    innerRect: value.innerRect,
    contentInset: value.contentInset,
    alpha: value.alpha,
    filterColor: value.filterColor === undefined ? undefined : bdaColorHex(value.filterColor),
  }
  const keySource = (value: BdaKey) => ({
    backStyle: styleRef(value.backStyle),
    foreStyles: value.foreStyles.length ? value.foreStyles.map(styleRef) : undefined,
    foreStyleOffsets: value.foreStyleOffsets.length ? value.foreStyleOffsets : undefined,
    backStyleState: styleRef(value.backStyleState),
  })
  const hintSource = (value: BdaHint) => ({
    offset: value.offset,
    backStyle: styleRef(value.backStyle),
    barStyle: styleRef(value.barStyle),
    barOffset: value.barOffset,
    foreStyle: styleRef(value.foreStyle),
    cellStyle: styleRef(value.cellStyle),
  })
  const listSource = (value: BdaList) => ({
    backStyle: styleRef(value.backStyle),
    cellBackStyle: styleRef(value.cellBackStyle),
    cellForeStyle: styleRef(value.cellForeStyle),
    foreStyles: value.foreStyles.length ? value.foreStyles.map(styleRef) : undefined,
    foreStyleOffsets: value.foreStyleOffsets.length ? value.foreStyleOffsets : undefined,
  })
  const candSource = (value: BdaCand | undefined) => value && ({
    candBarStyle: styleRef(value.candBarStyle),
    candOnBarStyle: styleRef(value.candOnBarStyle),
    cellBackStyle: styleRef(value.cellBackStyle),
    cellForeStyle: styleRef(value.cellForeStyle),
    firstCellForeStyle: styleRef(value.firstCellForeStyle),
    firstCellBackStyle: styleRef(value.firstCellBackStyle),
    subCandCellForeStyle: styleRef(value.subCandCellForeStyle),
    subCandCellBackStyle: styleRef(value.subCandCellBackStyle),
    switch: value.switch && {
      normalBack: styleRef(value.switch.normalBack), selectBack: styleRef(value.switch.selectBack),
      normalFore: styleRef(value.switch.normalFore), selectFore: styleRef(value.switch.selectFore),
    },
    candKeys: mapObject(value.candKeys, keySource),
    subCandBackStyle: styleRef(value.subCandBackStyle),
    menuKeys: mapObject(value.menuKeys, keySource),
    aiIcon: value.aiIcon && keySource(value.aiIcon),
    accessoryBackStyle: styleRef(value.accessoryBackStyle),
    gridLeftForeStyle: styleRef(value.gridLeftForeStyle),
    gridRightForeStyle: styleRef(value.gridRightForeStyle),
  })
  const panelSource = (value: BdaPanel) => ({
    hints: mapObject(value.hints, hintSource),
    lists: mapObject(value.lists, listSource),
    backStyle: styleRef(value.backStyle),
    wholeBackStyle: styleRef(value.wholeBackStyle),
    inputRegionBackStyle: styleRef(value.inputRegionBackStyle),
    shouldBgBlur: value.shouldBgBlur,
    shouldKeySlotting: value.shouldKeySlotting,
    trackColor: value.trackColor === undefined ? undefined : bdaColorHex(value.trackColor),
    keys: mapObject(value.keys, keySource),
    cand: candSource(value.cand),
    input: value.input && { backStyle: styleRef(value.input.backStyle), textStyle: styleRef(value.input.textStyle) },
    more: value.more && {
      backStyle: styleRef(value.more.backStyle),
      cellForeStyle: styleRef(value.more.cellForeStyle),
      cellBackStyle: styleRef(value.more.cellBackStyle),
    },
  })
  if (panelName) {
    const panel = appearance.panels.get(panelName.replace(/\.ini$/i, ""))
    return panel ? { panel: panelName.replace(/\.ini$/i, ""), ...panelSource(panel) } : { panel: panelName }
  }
  return {
    designWidth: appearance.designWidth,
    imageStyles: mapObject(appearance.imageStyles, (style) => ({
      normalImage: imageAtomSource(style.normalImage),
      highlightImage: imageAtomSource(style.highlightImage),
      fontInfo: style.fontInfo && {
        ...style.fontInfo,
        normalColor: style.fontInfo.normalColor === undefined ? undefined : bdaColorHex(style.fontInfo.normalColor),
        highlightColor: style.fontInfo.highlightColor === undefined ? undefined : bdaColorHex(style.fontInfo.highlightColor),
      },
    })),
    textStyles: mapObject(appearance.textStyles, (style) => ({
      resource: style.resource,
      fontName: style.fontName,
      fontSize: style.fontSize,
      normalColor: style.normalColor === undefined ? undefined : bdaColorHex(style.normalColor),
      highlightColor: style.highlightColor === undefined ? undefined : bdaColorHex(style.highlightColor),
      contentText: style.contentText,
    })),
    colorStyles: mapObject(appearance.colorStyles, (style) => ({
      normalColor: style.normalColor === undefined ? undefined : bdaColorHex(style.normalColor),
      highlightColor: style.highlightColor === undefined ? undefined : bdaColorHex(style.highlightColor),
    })),
    panels: mapObject(appearance.panels, panelSource),
    colorPalette: appearance.colorPalette && Object.fromEntries(Object.entries(appearance.colorPalette)
      .map(([name, color]) => [name, bdaColorHex(color)])),
    gamePanel: appearance.gamePanel && {
      backStyle: styleRef(appearance.gamePanel.backStyle),
      corpusFirstTab: appearance.gamePanel.corpusFirstTab,
      corpusList: appearance.gamePanel.corpusList,
      functionBar: appearance.gamePanel.functionBar,
      keys: mapObject(appearance.gamePanel.keys, keySource),
    },
    dragBar: appearance.dragBar && { backStyle: styleRef(appearance.dragBar.backStyle) },
  }
}

export function genericBdaSource(bytes: Uint8Array, compact = false): unknown[] {
  const hex = (value: Uint8Array) => Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("")
  const decode = (value: Uint8Array, depth: number): unknown[] => rawFields(value).map((field) => {
    const source: Record<string, unknown> = {
      field: field.number,
      wire: field.wire,
    }
    if (depth === 0) source.encodedHex = hex(value.slice(field.start, field.end))
    if (field.wire === 0) source.value = field.varint
    else if (field.wire === 1) source.valueHex = hex(value.slice(field.payloadStart, field.payloadEnd))
    else if (field.wire === 5) source.value = new DataView(
      value.buffer,
      value.byteOffset + field.payloadStart,
      4,
    ).getFloat32(0, true)
    else if (field.bytes) {
      source.byteLength = field.bytes.length
      if (compact) return source
      const text = rawString(field)
      if (text && !/[\u0000-\u0008\u000e-\u001f]/.test(text)) source.text = text
      if (depth < 16 && !source.text && field.bytes.length) {
        try {
          const children = decode(field.bytes, depth + 1)
          if (children.length) source.fields = children
        } catch {
          // Arbitrary resources can use the same length-delimited wire type as nested messages.
        }
      }
      if (!source.text && !source.fields) source.payloadHex = hex(field.bytes)
    }
    return source
  })
  return decode(bytes, 0)
}

export function bdaDecodedSourceEditable(path: string): boolean {
  const name = path.split("/").pop() ?? path
  return /^\d*appearanceConfig$/i.test(name) ||
    /animationConfig$/i.test(name) ||
    /^\d*soundConfig$/i.test(name)
}

export function decodedBdaValue(path: string, bytes: Uint8Array, panelName?: string): unknown {
  const name = path.split("/").pop() ?? path
  if (/^\d*appearanceConfig$/i.test(name)) {
    return decodedAppearanceSource(decodeBdaAppearance(bytes), panelName)
  }
  if (/animationConfig$/i.test(name)) {
    const animation = decodeBdaAnimation(bytes)
    return {
      designWidth: animation.designWidth,
      targets: animation.targets.length ? animation.targets : undefined,
      bindings: animation.bindings.size ? mapObject(animation.bindings) : undefined,
      targetBindings: animation.targetBindings.size ? mapObject(animation.targetBindings) : undefined,
      effects: animation.effects.size ? mapObject(animation.effects) : undefined,
      sequences: mapObject(animation.sequences, (sequence) => ({ frames: sequence.frames })),
    }
  }
  if (/^\d*soundConfig$/i.test(name)) {
    const sound = decodeBdaSoundConfig(bytes)
    return {
      keySounds: mapObject(sound.keySounds),
      iosKeySounds: sound.iosKeySounds.size ? mapObject(sound.iosKeySounds) : undefined,
    }
  }
  return { fields: genericBdaSource(bytes) }
}

export function decodedBdaEditorSource(path: string, bytes: Uint8Array, panelName?: string): string {
  return JSON.stringify(decodedBdaValue(path, bytes, panelName), null, 2)
}

export function normalizedDecodedBdaObject(path: string, bytes: Uint8Array): JsonObject {
  return JSON.parse(decodedBdaEditorSource(path, bytes)) as JsonObject
}

export function decodedBdaSource(path: string, bytes: Uint8Array, panelName?: string): string {
  const value = decodedBdaValue(path, bytes, panelName)
  const object = jsonObject(value)
  if (!panelName && object && !("fields" in object)) object.$protobuf = genericBdaSource(bytes, true)
  return JSON.stringify(value, null, 2)
}

export function decodedBdaAppearancePart(bytes: Uint8Array, part: BdaAppearancePart): string {
  if (part.kind === "panel") return JSON.stringify(decodedAppearanceSource(decodeBdaAppearance(bytes), part.name), null, 2)
  const source = decodedAppearanceSource(decodeBdaAppearance(bytes))
  return JSON.stringify({ [part.group]: source[part.group] }, null, 2)
}

export type JsonObject = Record<string, unknown>

export function jsonObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : undefined
}

export function sameJson(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((value, index) => sameJson(value, right[index]))
  }
  const leftObject = jsonObject(left)
  const rightObject = jsonObject(right)
  if (!leftObject || !rightObject) return false
  const leftKeys = Object.keys(leftObject).sort()
  const rightKeys = Object.keys(rightObject).sort()
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) =>
    key === rightKeys[index] && sameJson(leftObject[key], rightObject[key]))
}

export type PanelPatchKind = "style" | "styleList" | "message" | "stringMap" | "boolean" | "number" | "color"

export type PanelPatchField = { field: number; kind: PanelPatchKind; schema?: PanelPatchSchema }

export type PanelPatchSchema = Record<string, PanelPatchField>

export const keyPatchSchema: PanelPatchSchema = {
  backStyle: { field: 1, kind: "style" },
  foreStyles: { field: 2, kind: "styleList" },
  backStyleState: { field: 4, kind: "style" },
}

export const hintPatchSchema: PanelPatchSchema = {
  backStyle: { field: 2, kind: "style" },
  barStyle: { field: 3, kind: "style" },
  foreStyle: { field: 5, kind: "style" },
  cellStyle: { field: 6, kind: "style" },
}

export const listPatchSchema: PanelPatchSchema = {
  backStyle: { field: 1, kind: "style" },
  cellBackStyle: { field: 2, kind: "style" },
  cellForeStyle: { field: 3, kind: "style" },
  foreStyles: { field: 4, kind: "styleList" },
}

export const inputPatchSchema: PanelPatchSchema = {
  backStyle: { field: 1, kind: "style" },
  textStyle: { field: 2, kind: "style" },
}

export const gridPatchSchema: PanelPatchSchema = {
  backStyle: { field: 1, kind: "style" },
  cellForeStyle: { field: 2, kind: "style" },
  cellBackStyle: { field: 3, kind: "style" },
}

export const switchPatchSchema: PanelPatchSchema = {
  normalBack: { field: 1, kind: "style" },
  selectBack: { field: 2, kind: "style" },
  normalFore: { field: 3, kind: "style" },
  selectFore: { field: 4, kind: "style" },
}

export const candPatchSchema: PanelPatchSchema = {
  candBarStyle: { field: 1, kind: "style" },
  candOnBarStyle: { field: 2, kind: "style" },
  cellBackStyle: { field: 3, kind: "style" },
  cellForeStyle: { field: 4, kind: "style" },
  firstCellForeStyle: { field: 5, kind: "style" },
  firstCellBackStyle: { field: 6, kind: "style" },
  subCandCellForeStyle: { field: 7, kind: "style" },
  subCandCellBackStyle: { field: 8, kind: "style" },
  switch: { field: 9, kind: "message", schema: switchPatchSchema },
  candKeys: { field: 10, kind: "stringMap", schema: keyPatchSchema },
  subCandBackStyle: { field: 11, kind: "style" },
  menuKeys: { field: 12, kind: "stringMap", schema: keyPatchSchema },
  aiIcon: { field: 13, kind: "message", schema: keyPatchSchema },
  accessoryBackStyle: { field: 14, kind: "style" },
  gridLeftForeStyle: { field: 15, kind: "style" },
  gridRightForeStyle: { field: 16, kind: "style" },
}

export const panelPatchSchema: PanelPatchSchema = {
  hints: { field: 1, kind: "stringMap", schema: hintPatchSchema },
  lists: { field: 2, kind: "stringMap", schema: listPatchSchema },
  keys: { field: 3, kind: "stringMap", schema: keyPatchSchema },
  cand: { field: 4, kind: "message", schema: candPatchSchema },
  input: { field: 5, kind: "message", schema: inputPatchSchema },
  more: { field: 6, kind: "message", schema: gridPatchSchema },
  backStyle: { field: 7, kind: "style" },
  shouldBgBlur: { field: 8, kind: "boolean" },
  trackColor: { field: 9, kind: "color" },
  wholeBackStyle: { field: 10, kind: "style" },
  shouldKeySlotting: { field: 11, kind: "boolean" },
  inputRegionBackStyle: { field: 12, kind: "style" },
}

export function patchStyleRef(bytes: Uint8Array, value: unknown): Uint8Array {
  const ref = jsonObject(value)
  const types = { image: 0, color: 1, text: 2 } as const
  const type = typeof ref?.type === "string" ? types[ref.type as keyof typeof types] : undefined
  if (type === undefined || typeof ref?.key !== "number" || !Number.isInteger(ref.key) || ref.key < 0) {
    throw new Error("BDA 样式引用无效")
  }
  return replaceField(replaceField(bytes, 1, 0, encodeVarint(type)), 2, 0, encodeVarint(ref.key))
}

export function replaceRepeatedMessage(bytes: Uint8Array, fieldNumber: number, index: number, payload: Uint8Array): Uint8Array {
  const field = rawFields(bytes).filter((item) => item.number === fieldNumber)[index]
  if (!field) throw new Error(`BDA 重复字段不存在：${fieldNumber}[${index}]`)
  return join([bytes.slice(0, field.start), encodedField(fieldNumber, 2, payload), bytes.slice(field.end)])
}

function removeRepeatedMessage(bytes: Uint8Array, fieldNumber: number, index: number): Uint8Array {
  const field = rawFields(bytes).filter((item) => item.number === fieldNumber)[index]
  if (!field) throw new Error(`BDA 重复字段不存在：${fieldNumber}[${index}]`)
  return join([bytes.slice(0, field.start), bytes.slice(field.end)])
}

/** Adds one more `fieldNumber` entry right after the existing ones, keeping the message's field order. */
function appendRepeatedMessage(bytes: Uint8Array, fieldNumber: number, payload: Uint8Array): Uint8Array {
  const fields = rawFields(bytes)
  const last = fields.filter((item) => item.number === fieldNumber).at(-1)
  const at = last?.end ?? fields.find((item) => item.number > fieldNumber)?.start ?? bytes.length
  return join([bytes.slice(0, at), encodedField(fieldNumber, 2, payload), bytes.slice(at)])
}

export function patchPanelMessage(bytes: Uint8Array, desired: JsonObject, current: JsonObject, schema: PanelPatchSchema): Uint8Array {
  let output = bytes
  for (const [property, spec] of Object.entries(schema)) {
    const wanted = desired[property]
    const old = current[property]
    if (sameJson(wanted, old)) continue
    if (wanted === undefined && spec.kind !== "styleList") throw new Error(`暂不支持删除 BDA 面板字段：${property}`)
    if (spec.kind === "style") {
      const original = rawFields(output).find((field) => field.number === spec.field)?.bytes ?? new Uint8Array()
      output = replaceField(output, spec.field, 2, patchStyleRef(original, wanted))
      continue
    }
    if (spec.kind === "styleList") {
      // The decoded source leaves an empty list out.
      const wantedList = wanted ?? []
      const oldList = old ?? []
      if (!Array.isArray(wantedList) || !Array.isArray(oldList)) throw new Error(`BDA 样式引用列表无效：${property}`)
      for (let index = oldList.length - 1; index >= wantedList.length; index--) output = removeRepeatedMessage(output, spec.field, index)
      wantedList.forEach((value, index) => {
        if (index >= oldList.length) {
          output = appendRepeatedMessage(output, spec.field, patchStyleRef(new Uint8Array(), value))
          return
        }
        if (sameJson(value, oldList[index])) return
        const original = rawFields(output).filter((field) => field.number === spec.field)[index]?.bytes ?? new Uint8Array()
        output = replaceRepeatedMessage(output, spec.field, index, patchStyleRef(original, value))
      })
      continue
    }
    if (spec.kind === "message") {
      const wantedObject = jsonObject(wanted)
      const oldObject = jsonObject(old) ?? {}
      if (!wantedObject || !spec.schema) throw new Error(`BDA 面板对象无效：${property}`)
      const original = rawFields(output).find((field) => field.number === spec.field)?.bytes ?? new Uint8Array()
      output = replaceField(output, spec.field, 2, patchPanelMessage(original, wantedObject, oldObject, spec.schema))
      continue
    }
    if (spec.kind === "stringMap") {
      const wantedMap = jsonObject(wanted)
      const oldMap = jsonObject(old)
      if (!wantedMap || !oldMap || !spec.schema) throw new Error(`BDA 面板映射无效：${property}`)
      for (const [key, wantedValue] of Object.entries(wantedMap)) {
        const oldValue = oldMap[key]
        if (sameJson(wantedValue, oldValue)) continue
        const wantedObject = jsonObject(wantedValue)
        const oldObject = jsonObject(oldValue)
        if (!wantedObject || !oldObject) throw new Error(`暂不支持增删 BDA 面板项：${key}`)
        output = updateStringMapValue(output, spec.field, key, (value) =>
          patchPanelMessage(value, wantedObject, oldObject, spec.schema!))
      }
      continue
    }
    if (spec.kind === "boolean") {
      if (typeof wanted !== "boolean") throw new Error(`BDA 布尔值无效：${property}`)
      output = replaceField(output, spec.field, 0, encodeVarint(wanted ? 1 : 0))
      continue
    }
    const numeric = spec.kind === "color"
      ? typeof wanted === "string" ? colorValue(wanted) : NaN
      : wanted
    if (typeof numeric !== "number" || !Number.isInteger(numeric) || numeric < 0) {
      throw new Error(`BDA 数值无效：${property}`)
    }
    output = replaceField(output, spec.field, 0, encodeVarint(numeric))
  }
  return output
}

export function updateBdaPanel(bytes: Uint8Array, name: string, desired: JsonObject, current: JsonObject): Uint8Array {
  return updateStringMapValue(bytes, 4, name, (value) => patchPanelMessage(value, desired, current, panelPatchSchema))
}

export function applyDecodedBdaSource(path: string, bytes: Uint8Array, text: string): Uint8Array {
  const desired = jsonObject(JSON.parse(text))
  if (!desired) throw new Error("BDA 解码源码必须是 JSON 对象")
  delete desired.$bdiEditorRaw
  delete desired.$protobuf
  const current = normalizedDecodedBdaObject(path, bytes)
  const name = path.split("/").pop() ?? path
  let output = bytes
  const changedSequences = new Set<string>()

  if (/^\d*appearanceConfig$/i.test(name)) {
    if (!sameJson(desired.designWidth, current.designWidth)) {
      if (typeof desired.designWidth !== "number") throw new Error("BDA 设计宽度必须是数字")
      output = updateBdaDesignWidth(output, desired.designWidth)
    }
    const styles = [
      ["imageStyles", "image", [["normalImage", "NM_IMG"], ["highlightImage", "HL_IMG"]]],
      ["colorStyles", "color", [["normalColor", "NM_COLOR"], ["highlightColor", "HL_COLOR"]]],
      ["textStyles", "text", [["fontName", "FONT_NAME"], ["fontSize", "FONT_SIZE"], ["normalColor", "NM_COLOR"], ["highlightColor", "HL_COLOR"]]],
    ] as const
    for (const [group, type, properties] of styles) {
      const wantedStyles = jsonObject(desired[group]) ?? {}
      const oldStyles = jsonObject(current[group]) ?? {}
      for (const [key, wantedValue] of Object.entries(wantedStyles)) {
        const wantedStyle = jsonObject(wantedValue)
        const oldStyle = jsonObject(oldStyles[key])
        if (!wantedStyle) continue
        for (const [property, editorProperty] of properties) {
          const wanted = type === "image"
            ? jsonObject(jsonObject(wantedStyle[property])?.resource)?.resourceID
            : wantedStyle[property]
          const old = type === "image"
            ? jsonObject(jsonObject(oldStyle?.[property])?.resource)?.resourceID
            : oldStyle?.[property]
          if (sameJson(wanted, old)) continue
          if (typeof wanted !== "string" && typeof wanted !== "number") continue
          output = updateBdaStyle(output, { type, key: Number(key) }, editorProperty, String(wanted))
        }
      }
    }
    const wantedPanels = jsonObject(desired.panels) ?? {}
    const oldPanels = jsonObject(current.panels) ?? {}
    for (const [panelName, wantedValue] of Object.entries(wantedPanels)) {
      const wantedPanel = jsonObject(wantedValue)
      const oldPanel = jsonObject(oldPanels[panelName])
      if (!wantedPanel || !oldPanel || sameJson(wantedPanel, oldPanel)) continue
      output = updateBdaPanel(output, panelName, wantedPanel, oldPanel)
    }
  } else if (/animationConfig$/i.test(name)) {
    if (!sameJson(desired.designWidth, current.designWidth)) {
      if (typeof desired.designWidth !== "number" || desired.designWidth <= 0) {
        throw new Error("BDA 设计宽度必须是正数")
      }
      output = replaceField(output, 12, 0, encodeVarint(Math.round(desired.designWidth)))
    }
    const wantedSequences = jsonObject(desired.sequences) ?? {}
    const oldSequences = jsonObject(current.sequences) ?? {}
    for (const [sequence, wantedValue] of Object.entries(wantedSequences)) {
      const wantedFrames = jsonObject(wantedValue)?.frames
      const oldFrames = jsonObject(oldSequences[sequence])?.frames
      if (!Array.isArray(wantedFrames) || !Array.isArray(oldFrames)) continue
      wantedFrames.forEach((wantedValue, frame) => {
        const wantedFrame = jsonObject(wantedValue)
        const oldFrame = jsonObject(oldFrames[frame])
        if (!wantedFrame || !oldFrame) return
        for (const property of ["resourceID", "duration"] as const) {
          const wanted = wantedFrame[property]
          if (sameJson(wanted, oldFrame[property])) continue
          if (property === "resourceID" && typeof wanted !== "string") continue
          if (property === "duration" && typeof wanted !== "number") continue
          output = updateBdaAnimationFrame(output, sequence, frame, property, wanted as string | number)
          changedSequences.add(sequence)
        }
      })
    }
    // 效果定义走 protobuf 定点 patch：只改变化的字段，未知字段保持原样。
    for (const key of ["targets", "bindings", "targetBindings"] as const) {
      if (sameJson(desired[key], current[key])) continue
      throw new Error(`暂不支持修改 BDA 动画${key === "targets" ? "目标" : key === "bindings" ? "绑定" : "目标绑定"}；可在效果定义里改参数`)
    }
    const wantedEffects = jsonObject(desired.effects) ?? {}
    const oldEffects = jsonObject(current.effects) ?? {}
    if (!sameJson(wantedEffects, oldEffects)) output = applyBdaAnimationEffects(output, wantedEffects, oldEffects)
  } else if (/^\d*soundConfig$/i.test(name)) {
    for (const [group, ios] of [["keySounds", false], ["iosKeySounds", true]] as const) {
      const wantedSounds = jsonObject(desired[group]) ?? {}
      const oldSounds = jsonObject(current[group]) ?? {}
      for (const [key, wantedValue] of Object.entries(wantedSounds)) {
        if (sameJson(wantedValue, oldSounds[key])) continue
        const wanted = jsonObject(wantedValue)
        if (typeof wanted?.type !== "number" || typeof wanted.resourceID !== "string") continue
        output = updateBdaKeySound(output, key, { type: wanted.type, resourceID: wanted.resourceID }, ios)
      }
    }
  }

  const actual = normalizedDecodedBdaObject(path, output)
  for (const sequence of changedSequences) {
    const wantedEffect = jsonObject(jsonObject(desired.effects)?.[`image:${sequence}`])
    const actualEffect = jsonObject(jsonObject(actual.effects)?.[`image:${sequence}`])
    if (wantedEffect && actualEffect) wantedEffect.sequence = actualEffect.sequence
  }
  if (!sameJson(actual, desired)) {
    throw new Error("该 BDA JSON 改动暂不支持；可修改设计宽度、样式资源/字体/颜色、动画帧、动画效果参数和按键音")
  }
  return output
}

export function applyDecodedBdaAppearancePart(
  path: string,
  bytes: Uint8Array,
  text: string,
  part: BdaAppearancePart,
): Uint8Array {
  const desiredPart = jsonObject(JSON.parse(text))
  if (!desiredPart) throw new Error("BDA appearanceConfig 片段必须是 JSON 对象")
  const full = normalizedDecodedBdaObject(path, bytes)
  if (part.kind === "styles") {
    const styles = jsonObject(desiredPart[part.group])
    if (!styles || Object.keys(desiredPart).some((key) => key !== part.group)) {
      throw new Error(`源码必须只包含 ${part.group}`)
    }
    full[part.group] = styles
  } else {
    if (desiredPart.panel !== part.name) throw new Error(`面板源码标识必须是 ${part.name}`)
    const panels = jsonObject(full.panels)
    if (!panels) throw new Error("appearanceConfig 缺少 panels")
    const panel = { ...desiredPart }
    delete panel.panel
    panels[part.name] = panel
  }
  return applyDecodedBdaSource(path, bytes, JSON.stringify(full))
}
