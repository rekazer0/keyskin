// 替换键盘样式 for Sogou skins. Sogou has no atlas: every slice of the chosen picture is a PNG of its
// own in the look folder, and the key classes the canvas draws a key with get their own image section
// (as 单独设置 in the inspector does), so keys sharing a default class keep their look. The keyboard
// background is RootView's image, the candidate bar CandidateView's.

import type { IniDocument } from "../ini.ts"
import type { SsfKeyBinding } from "./ssf-keymap.ts"
import { firstValue, freeSectionName, ownSection, ssfBackground, ssfForeground } from "./ssf-parts.ts"

/** Images that follow NORMAL / PRESSED when those are replaced and still showed the same file. */
const LINKED_STATES: Record<string, string[]> = { NORMAL: ["DISABLED", "NORMAL_ON"], PRESSED: ["PRESSED_ON"] }

type SsfImageTarget = "key-normal" | "key-highlight" | "fore-normal" | "fore-highlight"

function setValue(document: IniDocument, section: string, key: string, value: string): void {
  if (document.sections().includes(section)) document.set(section, key, value)
  else document.appendSection(section, [{ key, value }])
}

/** One value per key of a section, the first definition winning as IniDocument.get reads it. */
function entries(document: IniDocument, section: string): Array<{ key: string; value: string }> {
  const seen = new Set<string>()
  return document.entries(section).flatMap(({ key, value }) => seen.has(key) ? [] : (seen.add(key), [{ key, value }]))
}

/** A new image section from `from`'s images with `state` showing `file`. */
function imageSection(document: IniDocument, base: string, from: Array<{ key: string; value: string }>, state: string, file: string): string {
  const old = from.find((entry) => entry.key === state)?.value
  const linked = LINKED_STATES[state] ?? []
  const images = from.map((entry) => entry.key === state || linked.includes(entry.key) && entry.value === old ? { ...entry, value: file } : entry)
  if (!images.some((entry) => entry.key === state)) images.push({ key: state, value: file })
  const section = freeSectionName(document, base)
  document.appendSection(section, images)
  return section
}

/** Shows `file` as one key's background or foreground in `skin` (phoneSkin.ini) and `keys` (keys.ini). */
export function applySsfKeyImage(skin: IniDocument, keys: IniDocument, binding: SsfKeyBinding, target: SsfImageTarget, file: string): void {
  const state = target.endsWith("normal") ? "NORMAL" : "PRESSED"
  if (target.startsWith("key")) {
    const background = ssfBackground(skin, binding)
    const owner = ownSection(skin, binding)
    setValue(skin, owner, "BG_IMAGES", imageSection(skin, `SMA_${owner}`, background ? entries(skin, background.images) : [], state, file))
    return
  }
  // Sogou keys have one foreground: the picture replaces it, keeping the other state's image.
  const foreground = ssfForeground(skin, keys, binding)
  const owner = ownSection(keys, binding)
  const current = foreground?.kind === "keys"
    ? entries(keys, foreground.images)
    : foreground ? [{ key: "NORMAL", value: firstValue(skin.get(foreground.owner, "ICON"))! }] : []
  if (state === "PRESSED" && !current.some((entry) => entry.key === "NORMAL")) current.push({ key: "NORMAL", value: "transparent.png" })
  setValue(keys, owner, "FG_IMAGES", imageSection(keys, `Foground_${owner}`, current, state, file))
  // The slice is cut to the key, so it fills the key.
  setValue(keys, owner, "FG_RECT", "0,0,1,1")
}

/** Shows `file` as the keyboard background (RootView) or, in its own image section, the candidate bar. */
export function applySsfBackgroundImage(skin: IniDocument, target: "panel" | "candidate", file: string, landscape: boolean): void {
  if (target === "panel") {
    setValue(skin, "RootView", "BG_STYLE", "1")
    setValue(skin, "RootView", "BG_IMAGE", file)
    return
  }
  const view = landscape && skin.sections().includes("CandidateViewLand") ? "CandidateViewLand" : "CandidateView"
  const bar = freeSectionName(skin, "BgCandidate")
  skin.appendSection(bar, [{ key: "NORMAL", value: file }])
  setValue(skin, view, "BG_STYLE", "1")
  setValue(skin, view, "BG_IMAGE", bar)
}
