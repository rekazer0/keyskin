import { IniDocument } from "./ini.ts"
import { conversionKeyText, conversionLetterForeground, scaledConversionRect, type ConversionMatch, type ConversionLayout } from "./layout-conversion.ts"
import { BUTTON_KEYS } from "./palm/sxi-layout.ts"

/** Keep current resources, gestures and state bindings; only the template's key arrangement is used. */
export function convertIniLayout(current: ConversionLayout, template: ConversionLayout, matches: ConversionMatch[], textStyle: (text: string) => string, listSource?: ConversionLayout): string {
  const output = IniDocument.parse(current.document!.toString())
  const defaults = current.defaults!
  const ids = new Map<string, string>()
  const occupied = [output, defaults].flatMap(doc => [...doc.sections().flatMap(section => {
    const match = /^(?:TIP|OFFSET)(\d+)$/.exec(section)
    return match ? [Number(match[1])] : []
  }), ...doc.entries().flatMap(({ key, value }) => key === "STAT_STYLE"
    ? [...value.matchAll(/S\d+_(\d+)/g)].map(match => Number(match[1]))
    : key === "POS_TYPE" ? value.split(",").map(Number) : [])])
  let next = occupied.reduce((max, id) => Number.isSafeInteger(id) ? Math.max(max, id) : max, 0) + 1
  const sectionEntries = (layout: ConversionLayout, section: string) => {
    const doc = layout.document!.hasSection(section) ? layout.document! : layout.defaults!
    return doc.entries(section).map(({ key, value }) => ({ key, value }))
  }
  const reference = (layout: ConversionLayout, prefix: string, id: string): string => {
    if (layout.path === current.path) return id
    const token = `${layout.path}/${prefix}${id}`
    const cached = ids.get(token)
    if (cached) return cached
    const allocated = String(next++)
    ids.set(token, allocated)
    const entries = sectionEntries(layout, `${prefix}${id}`)
    if (entries.length) output.appendSection(`${prefix}${allocated}`, remap(layout, entries))
    return allocated
  }
  const remap = (layout: ConversionLayout, entries: { key: string; value: string }[]) => entries.map(({ key, value }) => {
    if (key === "POS_TYPE") value = value.split(",").map(id => /^\d+$/.test(id.trim()) ? reference(layout, "OFFSET", id.trim()) : id).join(",")
    if (key === "STAT_STYLE") value = value.replace(/(S\d+_)(\d+)/g, (_, state, id) => `${state}${reference(layout, "TIP", id)}`)
    return { key, value }
  })
  output.removeSections(output.sections().filter(section => /^KEY\d+$/.test(section)))
  if (!output.hasSection("PANEL")) output.appendSection("PANEL", [])
  output.set("PANEL", "KEY_NUM", String(template.keys.length))
  for (const [index, match] of matches.entries()) {
    const { layout, key, letters, glyph, fallback } = match
    const geometry = template.keys[index]
    const rect = scaledConversionRect(geometry.rect, current, template, true)
    let entries = sectionEntries(layout, key.section).filter(entry => entry.key !== "VIEW_RECT" && entry.key !== "TOUCH_RECT")
    if (fallback) {
      entries = entries.filter(({ key }) => !BUTTON_KEYS.includes(key) && !["FORE_STYLE", "FORE_OFFSET", "FORE_ANIM_STYLE", "POS_TYPE", "STAT_STYLE", "CONVERSION_LETTERS"].includes(key))
      entries.push(...Object.entries(geometry.actions).map(([key, value]) => ({ key, value })),
        { key: "FORE_STYLE", value: textStyle(conversionKeyText(geometry, template.path)) })
    }
    if (letters || glyph !== undefined) {
      const layers = (letters ?? [match]).map((letter, i) => conversionLetterForeground(letter) ?? { style: textStyle(geometry.letters?.[i] ?? geometry.actions.CENTER), animation: "" })
      entries = entries.filter(({ key }) => !["FORE_STYLE", "FORE_OFFSET", "POS_TYPE", "STAT_STYLE", "FORE_ANIM_STYLE", "LEFT", "RIGHT", "SHOW"].includes(key))
      entries.push({ key: "FORE_STYLE", value: layers.map(layer => layer.style).join(",") },
        { key: "FORE_OFFSET", value: letters ? `${-Math.round(rect[2] / 6)},0;${Math.round(rect[2] / 6)},0` : "0,0" },
        { key: "FORE_ANIM_STYLE", value: layers.map(layer => layer.animation || "0").join(",") })
      if (letters) entries.push({ key: geometry.actions.CENTER === geometry.letters![0] ? "RIGHT" : "LEFT", value: geometry.letters!.replace(geometry.actions.CENTER, "") },
        { key: "SHOW", value: geometry.letters!.toUpperCase() })
      else entries = entries.map(entry => entry.key === "CENTER" ? { ...entry, value: geometry.actions.CENTER } : entry)
    }
    entries.push({ key: "VIEW_RECT", value: rect.join(",") })
    if (geometry.touch) entries.push({ key: "TOUCH_RECT", value: scaledConversionRect(geometry.touch, current, template, true).join(",") })
    output.appendSection(`KEY${index + 1}`, remap(layout, entries))
  }
  if (!output.hasSection("LIST")) output.appendSection("LIST", [])
  const list = template.list
  output.set("LIST", "LIST_NUM", String(list?.count ?? 0))
  if (list) {
    if (listSource && listSource.path !== current.path) {
      const entries = new Map([...listSource.defaults!.entries("LIST"), ...listSource.document!.entries("LIST")].map(({ key, value }) => [key, value]))
      output.removeSections(["LIST"])
      output.appendSection("LIST", remap(listSource, [...entries].map(([key, value]) => ({ key, value }))))
    }
    if (!listSource) {
      output.set("LIST", "NAMES", list.titles.join(" "))
      output.set("LIST", "VALUES", list.values.join(" "))
      output.set("LIST", "FORE_STYLE", textStyle(""))
    }
    const geometry = scaledConversionRect([...list.pos, ...list.size], current, template, true)
    output.set("LIST", "LIST_NUM", String(list.count))
    output.set("LIST", "POS", geometry.slice(0, 2).join(","))
    output.set("LIST", "CELL_SIZE", geometry.slice(2).join(","))
    output.set("LIST", "VIEW_RECT", scaledConversionRect(list.rect, current, template, true).join(","))
    output.set("LIST", "LIST_ORDER", list.horizontal ? "1" : "0")
  }
  return output.toString()
}
