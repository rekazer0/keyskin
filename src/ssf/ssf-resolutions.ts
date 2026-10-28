// A Sogou skin keeps one copy of its look per screen width (`1080/status1/phoneSkin.ini`,
// `720/status1/phoneSkin.ini`, `480/phoneSkin.ini`…) and the phone installs only the one closest to
// its width (theme/install/checker/e.java). An edit made in one copy is repeated in the others for
// every other copy: pixel sizes are scaled to that copy's width, and image references stay as they are
// because each copy names its own files, drawn at its own size.

import { IniDocument } from "../ini.ts"
import { parseSsfImage } from "./ssf-package.ts"

const LOOK_FILES = /^(\d+)\/(?:([^/]+)\/)?(phoneSkin|keys|anim)\.ini$/

// Values in pixels of the copy's screen width.
const PIXEL_KEYS = new Set(["MARGINS", "PADDINGS", "LABEL_FONT_SIZE", "MINOR_FONT_SIZE", "MIDDLE_FONT_SIZE", "POPUP_OFFSET_VERTICAL", "H_GAP", "W", "H"])

/** How the copy being written differs: its width over the edited one's, and which images both share. */
type SsfTwin = { scale: number; sharedImage: (file: string) => boolean }

/** `value` as the copy needs it; undefined when it cannot be carried over. */
function twinValue(key: string, value: string, { scale, sharedImage }: SsfTwin): string | undefined {
  // An image in the copy's own folder is drawn at its size; one in default/ is the same file for both.
  const image = parseSsfImage(value)
  if (image) return sharedImage(image.file) ? value : undefined
  // TEXT_SIZE up to 1 is a fraction of the screen width; above 1 it is pixels.
  const pixels = PIXEL_KEYS.has(key) || (key === "TEXT_SIZE" && Number(value) > 1)
  if (!pixels || scale === 1) return value
  const parts = value.split(",").map((part) => part.trim())
  if (parts.some((part) => !/^-?\d+(?:\.\d+)?$/.test(part))) return
  return parts.map((part) => String(Math.max(key === "TEXT_SIZE" ? 2 : -Infinity, Math.round(Number(part) * scale)))).join(",")
}

/** The screen width a look file is drawn for, from its folder (`720/status1/keys.ini` → 720). */
export function ssfResolutionOf(path: string): number | undefined {
  const match = LOOK_FILES.exec(path)
  return match ? Number(match[1]) : undefined
}

/**
 * The same look file in the skin's other resolution folders. A folder without day/night statuses
 * (an old `480/phoneSkin.ini`) is the day look, so it follows edits of `dayStatus`.
 */
export function ssfResolutionTwins(names: readonly string[], path: string, dayStatus?: string): string[] {
  const match = LOOK_FILES.exec(path)
  if (!match) return []
  const [, resolution, status, file] = match
  const existing = new Set(names)
  const resolutions = [...new Set(names.flatMap((name) => LOOK_FILES.exec(name)?.[1] ?? []))].filter((other) => other !== resolution)
  return resolutions.flatMap((other) => {
    const same = `${other}/${status ? `${status}/` : ""}${file}.ini`
    if (existing.has(same)) return [same]
    const flat = `${other}/${file}.ini`
    return status && status === dayStatus && existing.has(flat) ? [flat] : []
  })
}

/** `twin` with every change between `before` and `after` applied to it. */
export function mirrorSsfEdit(before: string, after: string, twin: string, copy: SsfTwin): string {
  const previous = IniDocument.parse(before)
  const next = IniDocument.parse(after)
  const document = IniDocument.parse(twin)
  const has = (ini: IniDocument, section: string) => section === "" || ini.sections().includes(section)
  const values = (ini: IniDocument, section: string) => new Map(ini.entries(section).map((entry) => [entry.key, entry.value]))
  for (const section of new Set([...previous.sections(), ...next.sections(), ""])) {
    const edited = values(next, section)
    let old = values(previous, section)
    if (!has(document, section)) {
      if (!edited.size) continue
      // A section copied from another one ("单独设置") starts from the twin's own copy of that section,
      // so it keeps this resolution's images.
      const source = has(previous, section) ? undefined : copySource(previous, document, edited)
      old = source ? values(previous, source) : new Map()
      document.appendSection(section, source ? document.entries(source) : [])
    }
    for (const key of new Set([...old.keys(), ...edited.keys()])) {
      const value = edited.get(key)
      if (value === old.get(key)) continue
      if (value === undefined) {
        const image = parseSsfImage(old.get(key))
        if (!image || copy.sharedImage(image.file)) document.remove(section, key)
        continue
      }
      const carried = twinValue(key, value, copy)
      if (carried !== undefined) document.set(section, key, carried)
    }
  }
  return document.toString()
}

/** The section `entries` were copied from: the one sharing the most values, every image among them. */
function copySource(previous: IniDocument, twin: IniDocument, entries: Map<string, string>): string | undefined {
  let best: { section: string; shared: number } | undefined
  for (const section of previous.sections()) {
    if (!twin.sections().includes(section)) continue
    const source = previous.entries(section)
    if (source.some((entry) => parseSsfImage(entry.value) && entries.get(entry.key) !== entry.value)) continue
    const shared = source.filter((entry) => entries.get(entry.key) === entry.value).length
    if (shared && shared > (best?.shared ?? 0)) best = { section, shared }
  }
  return best?.section
}

/**
 * A look file drawn for another screen size (面板复制 with scaling): stretch bands follow the resized
 * images, pixel values the width, as they do between resolution folders.
 */
export function scaleSsfLook(text: string, xRatio: number, yRatio: number): string {
  const document = IniDocument.parse(text)
  for (const { section, key, value } of document.entries()) {
    const image = parseSsfImage(value)
    if (image?.stretch) {
      const [left, right, top, bottom] = image.stretch
      const x = [Math.round(left * xRatio), Math.round(right * xRatio)]
      const y = [Math.round(top * yRatio), Math.round(bottom * yRatio)]
      const rest = value.split(",").slice(5)
      document.set(section, key, [image.file, x[0], Math.max(x[1], x[0] + 1), y[0], Math.max(y[1], y[0] + 1), ...rest].join(","))
    } else if (!image) {
      const carried = twinValue(key, value, { scale: xRatio, sharedImage: () => true })
      if (carried !== undefined) document.set(section, key, carried)
    }
  }
  return document.toString()
}
