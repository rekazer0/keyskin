import { type BdaStyleRef, type BdaKey } from "./bda.ts"
import { decodeBdaAppearance } from "./bda-decode.ts"
import { rawFields, encodedField, encodeVarint, join, replaceField, removeFields } from "./bda-encode.ts"
import { decodedBdaAppearancePart, applyDecodedBdaAppearancePart } from "./bda-source.ts"
import { type LayoutImagePlan } from "./layout-image.ts"
import { encodePng } from "./ssf/ssf-png.ts"

const integer = (field: number, value: number) => encodedField(field, 0, encodeVarint(value))
const message = (field: number, value: Uint8Array) => encodedField(field, 2, value)
const imageAtom = (id: string) => message(1, join([integer(1, 0), message(2, new TextEncoder().encode(id))]))

type PanelSource = {
  backStyle?: BdaStyleRef
  wholeBackStyle?: BdaStyleRef
  keys: Record<string, Partial<BdaKey>>
  cand?: { candBarStyle?: BdaStyleRef }
}

/** Each slice is its own PNG in BDA; innerRect is a stretch region, never an atlas crop. */
export function applyBdaLayoutImage(
  path: string,
  bytes: Uint8Array,
  panelName: string,
  plan: LayoutImagePlan,
  keyNames: ReadonlyMap<string, string>,
  base: string,
): { bytes: Uint8Array; resources: Map<string, Uint8Array> } {
  const appearance = decodeBdaAppearance(bytes)
  if (!appearance.panels.has(panelName)) throw new Error("当前布局没有 BDA 外观配置。")
  const resources = new Map<string, Uint8Array>()
  const resourceID = (index: number) => `${base}_${index}`
  let output = bytes
  let nextID = Math.max(0, ...appearance.imageStyles.keys()) + 1
  const originalStyle = (ref: BdaStyleRef | undefined, highlighted?: boolean): Uint8Array => {
    if (!ref) return new Uint8Array()
    if (ref.type === "image") {
      const entry = rawFields(output).filter((field) => field.number === 1 && field.bytes &&
        rawFields(field.bytes).some((item) => item.number === 1 && item.varint === ref.key)).at(-1)
      return entry?.bytes ? rawFields(entry.bytes).find((field) => field.number === 2)?.bytes ?? new Uint8Array() : new Uint8Array()
    }
    if (ref.type !== "color") return new Uint8Array()
    const style = appearance.colorStyles.get(ref.key)
    const atom = (color: number) => {
      const id = `${base}_color_${(color >>> 0).toString(16).padStart(8, "0")}`
      resources.set(id, encodePng({ width: 1, height: 1, data: Uint8Array.of(color >>> 16 & 255, color >>> 8 & 255, color & 255, color >>> 24) }))
      return imageAtom(id)
    }
    const normal = style?.normalColor ?? style?.highlightColor ?? 0
    return highlighted ? message(1, atom(normal)) : message(2, atom(style?.highlightColor ?? normal))
  }
  const addImage = (index: number, from?: BdaStyleRef, highlighted?: boolean): BdaStyleRef => {
    let style = originalStyle(from, highlighted)
    // Keep an implicit pressed fallback before replacing the normal image.
    const normal = rawFields(style).find((field) => field.number === 1)?.bytes
    if (highlighted === false && normal && !rawFields(style).some((field) => field.number === 2)) style = replaceField(style, 2, 2, normal)
    const setAtom = (field: number, atom: Uint8Array) => {
      const old = rawFields(style).find((item) => item.number === field)?.bytes ?? new Uint8Array()
      // Old stretch, inset, opacity and tint must not distort the new slice; unknown fields survive.
      style = replaceField(style, field, 2, join([removeFields(old, new Set([1, 2, 3, 4, 5])), atom]))
    }
    if (highlighted === true && !normal) {
      const id = `${base}_transparent`
      resources.set(id, encodePng({ width: 1, height: 1, data: new Uint8Array(4) }))
      setAtom(1, imageAtom(id))
    }
    if (highlighted !== true) setAtom(1, imageAtom(resourceID(index)))
    if (highlighted !== false) setAtom(2, imageAtom(resourceID(index)))
    const ref = { type: "image" as const, key: nextID++ }
    output = join([output, message(1, join([integer(1, ref.key), message(2, style)]))])
    return ref
  }
  const target = plan.target
  const part = { kind: "panel" as const, name: panelName }
  const source = JSON.parse(decodedBdaAppearancePart(bytes, part)) as PanelSource
  if (target === "panel") {
    const ref = addImage(plan.panelIndex!)
    source.backStyle = ref
    if (source.wholeBackStyle) source.wholeBackStyle = ref
  } else if (target === "candidate") {
    // A legacy candidate file is shared by every layout of this appearance; keep that scope in BDA.
    const ref = addImage(plan.panelIndex!)
    for (const name of appearance.panels.keys()) {
      const candidatePart = { kind: "panel" as const, name }
      const panel = JSON.parse(decodedBdaAppearancePart(output, candidatePart)) as PanelSource
      panel.cand = { ...panel.cand, candBarStyle: ref }
      output = applyDecodedBdaAppearancePart(path, output, JSON.stringify(panel), candidatePart)
    }
    return { bytes: output, resources }
  } else {
    for (const key of plan.keys) {
      const name = keyNames.get(key.section)
      const index = plan.indices.get(key.section)
      if (!name || index === undefined) throw new Error(`无法找到 ${key.section} 对应的 BDA 按键。`)
      const owner = source.keys[name] ?? (source.keys[name] = {})
      if (target.startsWith("key")) {
        const field = target === "key-highlight" && owner.backStyleState ? "backStyleState" : "backStyle"
        owner[field] = addImage(index, owner[field], target === "key-highlight")
      } else {
        const ref = addImage(index, undefined, target === "fore-highlight")
        // The new layer fills the key; prior offsets keep their layer indices.
        owner.foreStyleOffsets ??= []
        while (owner.foreStyleOffsets.length < (owner.foreStyles?.length ?? 0)) owner.foreStyleOffsets.push({ x: 0, y: 0 })
        owner.foreStyles ??= []
        owner.foreStyleOffsets[owner.foreStyles.length] = { x: 0, y: 0 }
        owner.foreStyles.push(ref)
      }
    }
  }
  output = applyDecodedBdaAppearancePart(path, output, JSON.stringify(source), part)
  return { bytes: output, resources }
}
