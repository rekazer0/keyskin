// The open Palm board's keys on the canvas, edited in skin.json: their rects for the layout tools
// (move, align, distribute, gaps, swap, merge), copies and deletions. Each edit is one undo step.

import { mergeLayoutRects, type LayoutRect } from "../layout.ts"
import { asObject, rectParts, type Json, type JsonObject } from "../palm/sxi-ini.ts"
import { SXI_SKIN_PATH, encodeSkinJson, parseSkinJson, sxiFragment } from "../palm/sxi-json.ts"
import { commitText } from "./edit-history"
import { showError } from "./file-operations"
import { appState } from "./state"
import { openPalmSkin, refreshSxiDocument, sxiPointer } from "./sxi-documents"

function boardKeys(skin: JsonObject): Json[] | undefined {
  const board = sxiPointer(appState.layoutPath)
  const model = board?.[2] === "b" ? asObject(sxiFragment(skin, board)) : undefined
  return Array.isArray(model?.keys) ? model.keys : undefined
}

function keyOf(keys: readonly Json[], section: string): JsonObject | undefined {
  return keys.map(asObject).find((key) => key && `KEY${key.id ?? ""}` === section)
}

const rectValue = (x: number, y: number, width: number, height: number): Json => [[Math.round(x), Math.round(y)], [Math.round(width), Math.round(height)]]

/** The keys' rects, in the canvas's sections (`KEY<id>`). */
export function palmKeyRects(sections: readonly string[]): LayoutRect[] {
  const skin = openPalmSkin()
  const keys = skin ? boardKeys(skin) : undefined
  return keys ? sections.flatMap((section) => {
    const rect = rectParts(keyOf(keys, section)?.rect ?? null)
    return rect ? [{ section, x: rect[0], y: rect[1], width: rect[2], height: rect[3] }] : []
  }) : []
}

/** Applies `change` to the open board's keys as one undo step; `coalesce` joins the steps of one drag. */
function editPalmKeys(change: (keys: Json[]) => void, coalesce = false): void {
  const archive = appState.archive
  if (archive?.format !== "sxi") return
  const before = archive.getText(SXI_SKIN_PATH)
  try {
    const skin = parseSkinJson(before)
    const keys = boardKeys(skin)
    if (!keys) return
    change(keys)
    commitText(SXI_SKIN_PATH, before, encodeSkinJson(skin), coalesce)
  } catch (error) {
    showError(error, "修改手心按键")
  }
  refreshSxiDocument()
}

/** Writes the keys' rects; a touch area equal to its key moves with it. */
export function writePalmKeyRects(rects: readonly LayoutRect[], coalesce = false): void {
  editPalmKeys((keys) => {
    for (const { section, x, y, width, height } of rects) {
      const key = keyOf(keys, section)
      if (!key) continue
      const value = rectValue(x, y, width, height)
      if (key.hit_rect !== undefined && JSON.stringify(key.hit_rect) === JSON.stringify(key.rect)) key.hit_rect = value
      key.rect = value
    }
  }, coalesce)
}

/** Copies the keys beside themselves under new ids; returns the copies' sections. */
export function copyPalmKeys(sections: readonly string[]): string[] {
  const copies: string[] = []
  editPalmKeys((keys) => {
    const ids = new Set(keys.map((key) => String(asObject(key)?.id ?? "")))
    let next = Math.max(0, ...[...ids].map(Number).filter(Number.isFinite)) + 1
    for (const section of sections) {
      const key = keyOf(keys, section)
      if (!key) continue
      while (ids.has(String(next))) next += 1
      const copy = structuredClone(key)
      copy.id = typeof key.id === "number" ? next : String(next)
      ids.add(String(next))
      for (const field of ["rect", "hit_rect"]) {
        const rect = rectParts(copy[field] ?? null)
        if (rect) copy[field] = rectValue(rect[0] + 18, rect[1], rect[2], rect[3])
      }
      keys.push(copy)
      copies.push(`KEY${copy.id}`)
    }
  })
  return copies
}

export function deletePalmKeys(sections: readonly string[]): void {
  editPalmKeys((keys) => {
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      if (sections.includes(`KEY${asObject(keys[index])?.id ?? ""}`)) keys.splice(index, 1)
    }
  })
}

/** Merges the second key into the first: the first covers both, the second is removed. */
export function mergePalmKeys(first: LayoutRect, second: LayoutRect): string {
  const merged = mergeLayoutRects(first, second)
  editPalmKeys((keys) => {
    const key = keyOf(keys, merged.section)
    if (!key) return
    key.rect = rectValue(merged.x, merged.y, merged.width, merged.height)
    if (key.hit_rect !== undefined) key.hit_rect = key.rect
    const removed = keys.findIndex((item) => `KEY${asObject(item)?.id ?? ""}` === second.section)
    if (removed >= 0) keys.splice(removed, 1)
  })
  return merged.section
}
