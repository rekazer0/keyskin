import { IniDocument } from "./ini.ts"
import type { SkinArchive } from "./skin.ts"
import type { ConversionLayout } from "./layout-conversion.ts"
import { freeStyleId, textStyleSections } from "./style-properties.ts"
import { addPalmStyle, palmStyleIDList, palmStyleLocation } from "./palm/palm-style-edit.ts"
import { asObject, type JsonObject } from "./palm/sxi-ini.ts"
import { sxiAddressPointer, sxiFragment } from "./palm/sxi-json.ts"

function label(text: string): string {
  return ({ F1: "符", F6: "123", F7: "☺", F10: "⇧", F11: "⇧", F15: "中", F16: "英", F36: "⌫", F38: "空格", F39: "换行", F75: "换行" } as Record<string, string>)[text] ?? text
}

/** Missing keys use the skin's typography; template artwork is never imported. */
export function iniConversionText(archive: SkinArchive, current: ConversionLayout) {
  const root = current.path.split("/").slice(0, 2).join("/")
  const directory = current.path.replace(/[^/]+$/, "")
  const path = [`${directory}res/default.css`, `${root}/res/default.css`].find(path => archive.isText(path)) ?? `${root}/res/default.css`
  const before = archive.isText(path) ? archive.getText(path) : undefined
  const styles = IniDocument.parse(before ?? "")
  const source = current.keys.flatMap(key => textStyleSections(styles, current.document!.get(key.section, "FORE_STYLE") ?? ""))[0]
    ?? styles.sections().find(section => /^STYLE\d+$/.test(section) && styles.get(section, "FONT_SIZE") && !styles.get(section, "NM_IMG") && !styles.get(section, "HL_IMG"))
  const font = ["FONT_SIZE", "FONT_NAME", "FONT_PATH", "FONT_CLEARTYPE", "NM_COLOR", "HL_COLOR"].flatMap(key => {
    const value = source ? styles.get(source, key) : undefined
    return value === undefined ? [] : [{ key, value }]
  })
  if (!font.some(entry => entry.key === "FONT_SIZE")) font.push({ key: "FONT_SIZE", value: String(Math.round(Math.min(...current.keys[0].rect.slice(2)) * 0.4)) })
  if (!font.some(entry => entry.key === "NM_COLOR")) font.push({ key: "NM_COLOR", value: current.path.startsWith("dark/") ? "FFFFFFFF" : "FF000000" })
  let changed = false
  const foreground = (text: string) => {
    const show = label(text)
    const existing = styles.sections().find(section => /^STYLE\d+$/.test(section) && styles.get(section, "SHOW") === show && !styles.get(section, "NM_IMG") && !styles.get(section, "HL_IMG"))
    if (existing) return existing.slice(5)
    const id = String(freeStyleId(styles))
    styles.appendSection(`STYLE${id}`, [...font, { key: "SHOW", value: show }])
    if (!styles.hasSection("GLOBAL")) styles.appendSection("GLOBAL", [])
    styles.set("GLOBAL", "STYLE_NUM", String(Math.max(Number(styles.get("GLOBAL", "STYLE_NUM")) || 0, Number(id))))
    changed = true
    return id
  }
  return { foreground, change: () => changed ? { path, before, after: styles.toString() } : undefined }
}

export function sxiConversionText(skin: JsonObject, current: ConversionLayout): (text: string) => string {
  const pointer = sxiAddressPointer(current.path)!
  const theme = pointer[0] === "night" ? "night" : "default"
  const orientation = pointer[1] === "land_layout" ? "land" : "port"
  const models = () => palmStyleIDList(skin, theme, orientation).map(id => ({ id, model: asObject(sxiFragment(skin, palmStyleLocation(skin, theme, orientation, id)!)) }))
  const available = models()
  const preferred = current.keys.filter(key => /^[a-z]$/i.test(key.actions.CENTER ?? "")).flatMap(key => {
    const value = asObject((current.board!.keys as JsonObject[])[Number(key.section)].b)?.base_f
    return (Array.isArray(value) ? value : [value]).flatMap(id => available.find(style => style.id === String(id)) ?? [])
  })
  const font = structuredClone([...preferred, ...available].map(({ model }) => asObject(model?.s_1)).find(text => text && text.for_back !== true) ?? {})
  delete font.text
  font.f_s ??= Math.round(Math.min(...current.keys[0].rect.slice(2)) * 0.4)
  font.c_normal ??= theme === "night" ? "FFFFFFFF" : "FF000000"
  return text => {
    const show = label(text)
    const existing = models().find(({ model }) => {
      const text = asObject(model?.s_1)
      return text && text.for_back !== true && (text.text ?? "") === show && !asObject(model?.s_2)
    })
    return existing?.id ?? addPalmStyle(skin, theme, { s_1: { ...font, ...show ? { text: show } : {} } })
  }
}
