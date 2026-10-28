// `.sxi` packages are edited natively: `skin.json` is the only source of truth, read and written as
// JSON and saved back verbatim. Parts of it are addressed by their pointer ("skin.json/default/…").

import { compactPalmJSON, encodePalmJSON, PALM_INT_MAX } from "./palm-json.ts"
import { asObject, type Json, type JsonObject } from "./sxi-ini.ts"

export const SXI_SKIN_PATH = "skin.json"
export const SXI_INFO_PATH = "info.json"

// Swift writes `Int.max` as 9223372036854775807, which a double rounds to 2^63.
export function parseSkinJsonValue(text: string): Json {
  return JSON.parse(text, (_key, item) => item === 9223372036854775807 ? PALM_INT_MAX : item) as Json
}

export function parseSkinJson(text: string): JsonObject {
  const skin = asObject(parseSkinJsonValue(text))
  if (!skin) throw new Error("skin.json 顶层必须是对象")
  return skin
}

// Re-encoding an unmodified skin.json reproduces it byte for byte (sorted keys, Foundation
// number formatting), so a fragment edit only changes that fragment.
export function encodeSkinJson(value: Json): string {
  return encodePalmJSON(value)
}

export function sxiFragment(skin: JsonObject, pointer: string[]): Json {
  let current: Json = skin
  for (const key of pointer) current = asObject(current)?.[key]
  return current
}

export function setSxiFragment(skin: JsonObject, pointer: string[], value: Json): void {
  let current = skin
  for (const key of pointer.slice(0, -1)) {
    const next = asObject(current[key])
    if (!next) throw new Error(`skin.json 中缺少 ${pointer.join(".")}`)
    current = next
  }
  current[pointer[pointer.length - 1]] = value
}

export function same(left: Json, right: Json): boolean {
  return compactPalmJSON(left) === compactPalmJSON(right)
}

// The editor (selections, the AI's fragments, panel copy) addresses a skin.json part as "skin.json/<key>/<key>/…".
export function sxiFragmentPath(pointer: readonly string[]): string {
  return `${SXI_SKIN_PATH}/${pointer.join("/")}`
}

/** The pointer an address names ("skin.json/default/" is the whole `default` part); undefined for other paths. */
export function sxiAddressPointer(path: string): string[] | undefined {
  if (!path.startsWith(`${SXI_SKIN_PATH}/`)) return
  const pointer = path.slice(SXI_SKIN_PATH.length + 1).replace(/\/+$/, "").split("/")
  return pointer[0] ? pointer : undefined
}

export function applySxiFragments(skinText: string, fragments: ReadonlyArray<{ path: string; text: string }>): string {
  const skin = parseSkinJson(skinText)
  for (const { path, text } of fragments) setSxiFragment(skin, path.split("/").slice(1), parseSkinJsonValue(text))
  return encodeSkinJson(skin)
}
