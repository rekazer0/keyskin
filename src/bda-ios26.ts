import { type BdaStyleRef } from "./bda.ts"
import { decodeBdaAppearance } from "./bda-decode.ts"
import { addBdaStyle, updateBdaStyle, updateStringMapValue, rawFields, replaceField, encodeVarint } from "./bda-encode.ts"
import { IOS26_RGB, isIos26KeyboardLayout } from "./ios26.ts"

function setBack(bytes: Uint8Array, field: number, ref: BdaStyleRef): Uint8Array {
  const original = rawFields(bytes).find((item) => item.number === field)?.bytes ?? new Uint8Array()
  const style = replaceField(replaceField(original, 1, 0, encodeVarint(1)), 2, 0, encodeVarint(ref.key))
  return replaceField(bytes, field, 2, style)
}

/** Adapt one native appearance, preserving unknown protobuf fields and all key / text styles. */
export function adaptBdaForIos26(bytes: Uint8Array): Uint8Array {
  const appearance = decodeBdaAppearance(bytes)
  if (!appearance.panels.size) throw new Error("没有找到可适配的 BDA 键盘布局。")
  let output = bytes
  const colorStyle = (alpha: "00" | "01"): BdaStyleRef => {
    const hex = `${alpha}${IOS26_RGB}`
    const color = Number.parseInt(hex, 16)
    const existing = [...appearance.colorStyles].find(([, style]) => style.normalColor === color && style.highlightColor === color)
    if (existing) return { type: "color", key: existing[0] }
    const added = addBdaStyle(output, "color")
    output = updateBdaStyle(updateBdaStyle(added.bytes, added.ref, "NM_COLOR", hex), added.ref, "HL_COLOR", hex)
    return added.ref
  }
  const candidate = colorStyle("00")
  const panel = colorStyle("01")
  for (const [name, value] of appearance.panels) {
    output = updateStringMapValue(output, 4, name, (original) => {
      let next = original
      const keyboard = isIos26KeyboardLayout(`${name.replace(/\.ini$/i, "")}.ini`) || /^(email|url|net|sym_26_cn|sym_26_en)$/i.test(name)
      if (keyboard) {
        next = setBack(next, 7, panel)
        if (value.wholeBackStyle) next = setBack(next, 10, panel)
        if (value.inputRegionBackStyle) next = setBack(next, 12, candidate)
        if (value.shouldBgBlur) next = replaceField(next, 8, 0, encodeVarint(0))
      }
      if (keyboard || value.input?.backStyle) {
        const input = rawFields(next).find((field) => field.number === 5)?.bytes ?? new Uint8Array()
        next = replaceField(next, 5, 2, setBack(input, 1, candidate))
      }
      if (keyboard || value.cand) {
        let cand = rawFields(next).find((field) => field.number === 4)?.bytes ?? new Uint8Array()
        for (const field of [1, 2, 11, 14]) {
          if (field === 1 || rawFields(cand).some((item) => item.number === field)) cand = setBack(cand, field, candidate)
        }
        next = replaceField(next, 4, 2, cand)
      }
      return next
    })
  }
  // A second invocation must not create a history entry just by rebuilding identical messages.
  return output.length === bytes.length && output.every((byte, index) => byte === bytes[index]) ? bytes : output
}
