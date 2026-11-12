// Which Sogou sections draw a key. The converters (ssf-look.ts) and the editor's inspector both read a
// key through these, so the sections the inspector edits are exactly the ones the canvas shows.

import type { IniDocument } from "../ini.ts"
import { ssfBoard, ssfQwerty, type SsfKeyBinding } from "./ssf-keymap.ts"
import { parseSsfImage, ssfColor, type SsfImageRef } from "./ssf-package.ts"

/** Accepts an image reference; converters also require the file to exist. */
type SsfImageCheck = (ref: SsfImageRef) => boolean

type SsfBackground = {
  /** Key section whose BG_IMAGES names the background; absent when a shared default class draws it. */
  owner?: string
  /** Section holding the NORMAL / PRESSED images. */
  images: string
}

type SsfForeground =
  /** keys.ini: `[owner] FG_IMAGES=images`, `[images] NORMAL=…`, placed by FG_RECT. */
  | { kind: "keys"; owner: string; images: string; rect?: number[] }
  /** phoneSkin.ini: `[owner] ICON=…`, centred on the key. */
  | { kind: "icon"; owner: string }

export function firstValue(value: string | undefined): string | undefined {
  return value?.split(",")[0].trim() || undefined
}

/** The space glyph has its own normal/pressed colours, independent of its text labels. */
export function ssfSpaceIconColor(skin: IniDocument, pressed: boolean): string | undefined {
  const colors = skin.get("General", "SPACE_ICON_COLOR")?.split(",")
  return ssfColor(colors?.[pressed ? 1 : 0]) ?? ssfColor(colors?.[0])
}

/** ICON overrides the first selectable ICONS entry; entries can be files or state-image sections. */
export function ssfIconPair(skin: IniDocument, owner: string): { normal: string; pressed: string; images?: string } | undefined {
  const name = firstValue(skin.get(owner, "ICON")) ?? firstValue(skin.get(owner, "ICONS"))
  if (!name) return
  const images = parseSsfImage(name) ? undefined : name
  const normal = images ? firstValue(skin.get(images, "NORMAL")) : name
  if (!normal) return
  const pressed = firstValue(skin.get(owner, "ICON_PRESSED")) ?? (images && firstValue(skin.get(images, "PRESSED"))) ?? normal
  return { normal, pressed, ...images ? { images } : {} }
}

const anyImage: SsfImageCheck = () => true

/** The `Anim_Style_*` a key plays on press: keys.ini names it (phoneSkin.ini in older skins), else `Anim_Style_Key`. */
export function ssfAnimStyle(anim: IniDocument, skin: IniDocument, keys: IniDocument, binding: SsfKeyBinding): string | undefined {
  const named = binding.sections.map((section) => firstValue(keys.get(section, "ANIM_STYLE")) ?? firstValue(skin.get(section, "ANIM_STYLE"))).find(Boolean)
  return named ?? (anim.sections().includes("Anim_Style_Key") ? "Anim_Style_Key" : undefined)
}

/** A section name not used in `document`, derived from `base`. */
export function freeSectionName(document: IniDocument, base: string): string {
  const taken = new Set(document.sections())
  for (let index = 1; ; index += 1) {
    const name = index === 1 ? base : `${base}_${index}`
    if (!taken.has(name)) return name
  }
}

/** The key section a per-key override is written to: one that already exists, else the portrait class. */
export function ownSection(document: IniDocument, binding: SsfKeyBinding): string {
  const sections = document.sections()
  return binding.sections.find((section) => sections.includes(section))
    ?? binding.sections.find((section) => !/_Land/.test(section))
    ?? binding.sections[0]
}

export function ssfBackground(skin: IniDocument, binding: SsfKeyBinding, usable = anyImage): SsfBackground | undefined {
  for (const owner of binding.sections) {
    const images = firstValue(skin.get(owner, "BG_IMAGES"))
    const ref = images && parseSsfImage(skin.get(images, "NORMAL"))
    if (images && ref && usable(ref)) return { owner, images }
  }
  for (const images of binding.defaults) {
    const ref = parseSsfImage(skin.get(images, "NORMAL"))
    if (ref && usable(ref)) return { images }
  }
}

export function ssfForeground(skin: IniDocument, keys: IniDocument, binding: SsfKeyBinding): SsfForeground | undefined {
  for (const owner of binding.sections) {
    const images = firstValue(keys.get(owner, "FG_IMAGES"))
    if (!images || !firstValue(keys.get(images, "NORMAL"))) continue
    const rect = keys.get(owner, "FG_RECT")?.split(",").map(Number)
    return { kind: "keys", owner, images, rect: rect?.length === 4 && rect.every(Number.isFinite) ? rect : undefined }
  }
  for (const owner of binding.sections) {
    if (ssfIconPair(skin, owner)) return { kind: "icon", owner }
  }
}

/** The key's `FG_STYLE` section and the TextStyle its `LABEL_STYLE` names (Sogou reads key text only this way). */
export function ssfLabelStyle(skin: IniDocument, binding: SsfKeyBinding): { fgStyle: string; owner: string; style?: string } | undefined {
  for (const owner of binding.sections) {
    const fgStyle = firstValue(skin.get(owner, "FG_STYLE"))
    if (fgStyle) return { fgStyle, owner, style: firstValue(skin.get(fgStyle, "LABEL_STYLE")) }
  }
}

/** The explicit foreground style, or the style used by Sogou's built-in key definition. */
export function ssfForegroundLayout(skin: IniDocument, binding: SsfKeyBinding, layout: string, landscape: boolean): { fgStyle: string; label?: string; minor?: string } | undefined {
  const own = ssfLabelStyle(skin, binding)
  if (own) return { fgStyle: own.fgStyle }
  const suffix = landscape ? "_Land" : ""
  if (binding.keyClass === "char") return { fgStyle: `${ssfQwerty(layout) ? "FGStyle_Qwerty" : "FGStyle_Phone"}${suffix}` }
  const board = ssfBoard(layout)
  if (board !== "py9" && board !== "en9") return
  if (binding.sections.includes("Key_SymbolTable")) return { fgStyle: `FGStyle_SymbolTable_${board === "py9" ? "Py9" : "En9"}${suffix}` }
  if (binding.sections.includes("Key_SwitchToEN")) return { fgStyle: `FGStyle_Switch_Py9${suffix}`, label: "TextStyle_Switch", minor: "TextStyle_MinorLabel_Switch" }
  if (binding.sections.includes("Key_EnSwitchToCH")) return { fgStyle: `FGStyle_SwitchToCh_En9${suffix}`, label: "TextStyle_Switch", minor: "TextStyle_MinorLabel_Switch" }
}

/**
 * Sections a key's label is drawn with, most specific first: the FG_STYLE label style, then the
 * board's default style for the key's class (what Sogou's built-in FG_STYLE of the key names).
 */
export function ssfTextSections(binding: SsfKeyBinding, qwerty: boolean, skin?: IniDocument): string[] {
  const label = skin && ssfLabelStyle(skin, binding)?.style
  return [...new Set([...label ? [label] : [], ...ssfClassTextStyles(binding, qwerty)])]
}

/** The board's default text styles for a key's class, most specific first. */
export function ssfClassTextStyles(binding: SsfKeyBinding, qwerty: boolean): string[] {
  return binding.keyClass === "function"
    ? [qwerty ? "TextStyle_FuncKey_26char" : "TextStyle_FuncKey_T9", "TextStyle"]
    : binding.keyClass === "space" ? ["TextStyle_Space_Label", "TextStyle"]
      : [qwerty ? "TextStyle_Qwerty" : "TextStyle_Phone_Label", "TextStyle"]
}

/** sound_android.ini section that gives a key (or, without a binding, every key) its sound. */
export function ssfSoundSection(sounds: IniDocument, binding: SsfKeyBinding | undefined): string | undefined {
  return (binding ? binding.sections : ["Key"]).find((section) => sounds.get(section, "sound")?.trim())
}
