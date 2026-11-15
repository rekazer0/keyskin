import { conversionKeyText, conversionLetterForeground, scaledConversionRect, type ConversionMatch, type ConversionLayout, type LayoutRect } from "../layout-conversion.ts"
import { actionValue, asObject, type Json, type JsonObject } from "./sxi-ini.ts"
import { encodeSkinJson, parseSkinJson, setSxiFragment, sxiAddressPointer } from "./sxi-json.ts"
import { sxiConversionText } from "../layout-conversion-text.ts"
import { BUTTON_KEYS } from "./sxi-layout.ts"

const jsonRect = (rect: LayoutRect): Json => [rect.slice(0, 2), rect.slice(2)]

/** Edit the chosen board only; style, animation, candidate and other board tables stay intact. */
export function convertSxiLayout(text: string, current: ConversionLayout, template: ConversionLayout, matches: ConversionMatch[], listSource?: ConversionLayout): string {
  const skin = parseSkinJson(text)
  const textStyle = sxiConversionText(skin, current)
  const board = structuredClone(current.board!)
  const offsets: JsonObject = { ...asObject(board.offset) }
  const fixes: JsonObject = { ...asObject(board.key_fix) }
  const ids = new Map<string, string>()
  const referenced = [board.list, ...board.keys as Json[], ...Object.values(fixes)].flatMap(value => {
    const object = asObject(value)
    const offset = asObject(object?.b)?.base_o
    return [...(Array.isArray(offset) ? offset : [offset]), ...(Array.isArray(object?.fix_a) ? object.fix_a.filter((_, index) => index % 2) : [])]
  })
  const occupied = [...Object.keys({ ...asObject(current.global?.offset), ...offsets, ...fixes }), ...referenced].map(Number)
  let next = occupied.reduce((max, id) => Number.isSafeInteger(id) ? Math.max(max, id) : max, 0) + 1
  const reference = (layout: ConversionLayout, field: "offset" | "key_fix", id: Json): Json => {
    if (layout.path === current.path) return id
    const token = `${layout.path}/${field}/${id}`
    const cached = ids.get(token)
    if (cached) return Number(cached)
    const allocated = String(next++)
    ids.set(token, allocated)
    const table = field === "offset" ? { ...asObject(layout.global?.offset), ...asObject(layout.board?.offset) } : asObject(layout.board?.key_fix) ?? {}
    const value = table[String(id)]
    if (value !== undefined) {
      const copy = structuredClone(value)
      if (field === "key_fix") remap(layout, asObject(copy)!)
      ;(field === "offset" ? offsets : fixes)[allocated] = copy
    }
    return Number(allocated)
  }
  const remap = (layout: ConversionLayout, key: JsonObject): void => {
    const base = asObject(key.b)
    if (base?.base_o !== undefined) base.base_o = Array.isArray(base.base_o) ? base.base_o.map(id => reference(layout, "offset", id)) : reference(layout, "offset", base.base_o)
    if (Array.isArray(key.fix_a)) key.fix_a = key.fix_a.map((value, index) => index % 2 ? reference(layout, "key_fix", value) : value)
  }
  board.keys = matches.map((match, index) => {
    const { layout, key, letters, glyph, fallback } = match
    const keys = layout.board!.keys as Json[]
    const copy = structuredClone(asObject(keys[Number(key.section)])!)
    if (!fallback && !letters && glyph === undefined) remap(layout, copy)
    copy.id = String(index + 1)
    const geometry = template.keys[index]
    const rect = scaledConversionRect(geometry.rect, current, template)
    copy.rect = jsonRect(rect)
    if (fallback) {
      const base = asObject(copy.b) ?? {}
      base.base_f = [Number(textStyle(conversionKeyText(geometry, template.path)))]
      for (const field of ["base_a", "base_fa", "base_o"]) delete base[field]
      copy.b = base
      delete copy.fix_a
      copy.values = Object.entries(geometry.actions).flatMap(([button, value]) => [BUTTON_KEYS.indexOf(button), button === "SHOW" ? value : actionValue(value)])
    }
    if (letters || glyph !== undefined) {
      const layers = (letters ?? [match]).map((letter, i) => conversionLetterForeground(letter) ?? { style: textStyle(geometry.letters?.[i] ?? geometry.actions.CENTER), animation: "" })
      const base = asObject(copy.b) ?? {}
      base.base_f = layers.map(layer => Number(layer.style))
      base.base_fa = layers.map(layer => Number(layer.animation || 0))
      delete base.base_a
      base.base_o = layers.map((_, i) => {
        const x = letters ? Math.round(rect[2] / 6 * (i ? 1 : -1)) : 0
        const existing = Object.entries({ ...asObject(current.global?.offset), ...offsets }).find(([id, value]) => {
          const point = asObject(value)?.p
          return Number.isSafeInteger(Number(id)) && Array.isArray(point) && point[0] === x && point[1] === 0
        })
        if (existing) return Number(existing[0])
        const id = next++
        offsets[id] = { p: [x, 0] }
        return id
      })
      copy.b = base
      delete copy.fix_a
      const values = Array.isArray(copy.values) ? copy.values : []
      copy.values = values.filter((_, i) => ![2, 3, 4, 5].includes(Number(values[i - i % 2])))
      copy.values.push(4, actionValue(geometry.actions.CENTER))
      if (letters) {
        const gesture = geometry.actions.CENTER === geometry.letters![0] ? 3 : 2
        copy.values.push(gesture, actionValue(geometry.letters!.replace(geometry.actions.CENTER, "")), 5, geometry.letters!.toUpperCase())
      }
    }
    delete copy.hit_rect
    if (geometry.touch) copy.hit_rect = jsonRect(scaledConversionRect(geometry.touch, current, template))
    return copy
  })
  const list = template.list
  const source = listSource ?? current
  const ownList = structuredClone(asObject(source.board?.list) ?? asObject(source.global?.list) ?? {})
  remap(source, ownList)
  ownList.count = list?.count ?? 0
  if (list) {
    if (!listSource) {
      ownList.titles = list.titles
      ownList.values = list.values
      ownList.b = { ...asObject(ownList.b), base_f: [Number(textStyle(""))] }
    }
    const geometry = scaledConversionRect([...list.pos, ...list.size], current, template)
    ownList.pos = geometry.slice(0, 2)
    ownList.size = geometry.slice(2)
    ownList.order = list.horizontal
    ownList.rect = jsonRect(scaledConversionRect(list.rect, current, template))
  }
  board.list = ownList
  if (Object.keys(offsets).length) board.offset = offsets
  if (Object.keys(fixes).length) board.key_fix = fixes
  setSxiFragment(skin, sxiAddressPointer(current.path)!, board)
  return encodeSkinJson(skin)
}
