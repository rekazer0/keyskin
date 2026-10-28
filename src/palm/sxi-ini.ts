// Palm JSON values: reading them (objects, rects, action and state lists) and writing them in the INI
// spellings `palm-export.ts` parses them from, for the Baidu files a Palm skin is exported as
// (sxi-to-baidu.ts).

import { ACTION_CODES } from "./palm-ini.ts"
import { PALM_INT_MAX, type PalmJSONValue } from "./palm-json.ts"

export type Json = PalmJSONValue
export type JsonObject = Record<string, Json>

export function asObject(value: Json): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined
}

export function numberText(value: Json): string | undefined {
  if (typeof value !== "number") return
  return value === PALM_INT_MAX || value === Infinity ? "inf" : String(value)
}

function pair(value: Json): [Json, Json] | undefined {
  return Array.isArray(value) && value.length === 2 ? [value[0], value[1]] : undefined
}

function pointText(value: Json): string | undefined {
  const point = pair(value)
  const x = point && numberText(point[0])
  const y = point && numberText(point[1])
  return x !== undefined && y !== undefined ? `${x},${y}` : undefined
}

export function rectParts(value: Json): [number, number, number, number] | undefined {
  const [origin, size] = pair(value) ?? []
  const [x, y] = pair(origin ?? null) ?? []
  const [width, height] = pair(size ?? null) ?? []
  const parts = [x, y, width, height]
  return parts.every((part) => typeof part === "number") ? parts as [number, number, number, number] : undefined
}

export function rectText(value: Json): string | undefined {
  return rectParts(value)?.map((part) => numberText(part)).join(",")
}

// `toInsets` reads "left,top,right,bottom".
function insetsText(value: Json): string | undefined {
  const insets = asObject(value)
  const parts = insets && [insets.left, insets.top, insets.right, insets.bottom].map(numberText)
  return parts?.every((part) => part !== undefined) ? parts.join(",") : undefined
}

function boolText(value: Json): string | undefined {
  return typeof value === "boolean" ? (value ? "1" : "0") : undefined
}

export function listText(value: Json): string | undefined {
  return Array.isArray(value) ? value.map((item) => numberText(item) ?? String(item)).join(",") : undefined
}

function stringText(value: Json): string | undefined {
  return typeof value === "string" ? value : undefined
}

const ACTION_KEYS = new Map(Object.entries(ACTION_CODES).map(([code, name]) => [name, code]))

// `actionCode` maps "F38" to "space"; a Baidu file needs the code back.
export function actionText(value: Json): string | undefined {
  return typeof value === "string" ? ACTION_KEYS.get(value) ?? value : undefined
}

/** The inverse of `actionText`: an INI action code back to the Palm action name. */
export function actionValue(text: string): string {
  return ACTION_CODES[text.trim()] ?? text.trim()
}

// `toTipsMap` reads a flat `[state, tips, ...]` array from "S<state>_<tips>|...".
export function tipsText(value: Json): string | undefined {
  if (!Array.isArray(value)) return
  const items: string[] = []
  for (let index = 0; index + 1 < value.length; index += 2) items.push(`S${value[index]}_${value[index + 1]}`)
  // An empty state list must leave the key without `STAT_STYLE`, not override it with a blank value.
  return items.length ? items.join("|") : undefined
}

export class IniWriter {
  private readonly sections: Array<{ name: string; entries: Map<string, string> }> = []

  /** A section; the unnamed one ("") is written without a header, for key=value files like Info.txt. */
  section(name: string): Map<string, string> {
    const entries = new Map<string, string>()
    this.sections.push({ name, entries })
    return entries
  }

  toString(): string {
    return this.sections
      .map(({ name, entries }) => [...name ? [`[${name}]`] : [], ...[...entries].map(([key, value]) => `${key}=${value}`)].join("\n"))
      .join("\n\n") + "\n"
  }
}

// The first writer of a key wins, so a section-specific alias never overrides the base model.
export function put(entries: Map<string, string>, key: string, value: string | undefined): void {
  if (value !== undefined && !entries.has(key)) entries.set(key, value)
}

export type FieldKind = "number" | "point" | "rect" | "bool" | "string" | "list" | "insets"

const WRITERS: Record<FieldKind, (value: Json) => string | undefined> = {
  number: numberText,
  point: pointText,
  rect: rectText,
  bool: boolText,
  string: stringText,
  list: listText,
  insets: insetsText,
}

/** A number typed into the Palm inspector; "inf" is Palm's Int.max. */
export function numberValue(text: string): number {
  const value = text.trim() === "inf" ? PALM_INT_MAX : Number(text)
  if (!text.trim() || !Number.isFinite(value)) throw new Error(`“${text}”不是数字`)
  return value
}

// Table-driven fields: `[json key, ini key, kind]`.
export function putFields(entries: Map<string, string>, model: JsonObject, fields: Array<[string, string, FieldKind]>): void {
  for (const [jsonKey, iniKey, kind] of fields) put(entries, iniKey, WRITERS[kind](model[jsonKey]))
}

// `SkinBaseModel` (`b`) of `owner`.
export function putBase(entries: Map<string, string>, owner: JsonObject): void {
  putFields(entries, asObject(owner.b) ?? {}, [
    ["base_b", "BACK_STYLE", "number"],
    ["base_f", "FORE_STYLE", "list"],
    ["base_s", "SOUND_STYLE", "number"],
    ["asi", "ANIM_STYLE", "number"],
    ["base_ba", "BACK_ANIM_STYLE", "number"],
    ["base_o", "POS_TYPE", "list"],
    ["base_pa", "PANEL_ANIM_STYLE", "number"],
    ["base_fa", "FORE_ANIM_STYLE", "list"],
    ["base_a", "FORE_ANIM_STYLE", "number"],
  ])
}
