// The 文字 group of a Palm board or candidate bar: the text styles (`ss_1.<id>.s_1`) its keys or bar
// draw, read and written in skin.json. A bar without a style of its own gets one on its first edit.

import { PalmBoard } from "../palm/palm-board.ts"
import { asObject, type Json, type JsonObject } from "../palm/sxi-ini.ts"
import { sxiFragment } from "../palm/sxi-json.ts"
import { currentSkinState } from "./config-context"
import { appState } from "./state"
import { editSxi } from "./sxi-fields"
import { isSxiBoardAddress, openPalmSkin, PALM_SHARED_BOARD, palmTheme, sxiPointer } from "./sxi-documents"
import { palmKeyForegrounds, palmStyle, palmStylePointer, palmValue, type PalmPointer } from "./sxi-styles"
import { addPalmStyle } from "../palm/palm-style-edit.ts"

type PalmTextProperty = "FONT_NAME" | "FONT_SIZE" | "NM_COLOR" | "HL_COLOR"

/** Styles a text target writes; `create` is where a missing style is referenced from, and what it starts as. */
export type PalmText = { ids: string[]; create?: { owner: PalmPointer; field: string; list?: boolean; copyFrom?: string } }

const FIELDS: Record<PalmTextProperty, string> = { FONT_NAME: "f_n", FONT_SIZE: "f_s", NM_COLOR: "c_normal", HL_COLOR: "c_hl" }

/** A text style is an `s_1` that is not a fill (`for_back`). */
function textStyle(id: Json): string | undefined {
  const text = id === undefined || id === null ? undefined : asObject(palmStyle(String(id))?.s_1)
  return text && text.for_back !== true ? String(id) : undefined
}

/**
 * Labels (each key's first text layer) and hints (its further text layers) of a board's keys; the open
 * board's keys as the current keyboard state swaps them.
 */
function keyTexts(skin: JsonObject, board: readonly string[], open = false): { label: string[]; hint: string[] } {
  const model = asObject(sxiFragment(skin, [...board]))
  const label = new Set<string>()
  const hint = new Set<string>()
  for (const key of Array.isArray(model?.keys) ? model.keys : []) {
    const section = `KEY${asObject(key)?.id ?? ""}`
    const texts = (open ? palmKeyForegrounds(skin, section, currentSkinState()) : [asObject(asObject(key)?.b)?.base_f].flat())
      .flatMap((id) => textStyle(id) ?? [])
    if (texts[0]) label.add(texts[0])
    for (const id of texts.slice(1)) hint.add(id)
  }
  return { label: [...label], hint: [...hint] }
}

/** How many of `ids` other boards of the theme and orientation also draw, so a board-wide edit can say so. */
export function palmSharedTextCount(ids: readonly string[]): number {
  const skin = openPalmSkin()
  const board = sxiPointer(appState.layoutPath)
  if (!skin || !board) return 0
  const others = new Set(Object.keys(asObject(sxiFragment(skin, board.slice(0, 3))) ?? {})
    .filter((type) => type !== board[3] && type !== PALM_SHARED_BOARD)
    .flatMap((type) => { const texts = keyTexts(skin, [...board.slice(0, 3), type]); return [...texts.label, ...texts.hint] }))
  return ids.filter((id) => others.has(id)).length
}

/** The open board's key texts, or the selected candidate bar's words, first candidate and input code. */
export function palmTextTargets(): { scope: "candidate" | "layout"; label?: PalmText; hint?: PalmText; words?: PalmText; first?: PalmText; input?: PalmText } | undefined {
  const skin = openPalmSkin()
  const pointer = sxiPointer(appState.selectedPath)
  const board = sxiPointer(appState.layoutPath)
  if (!skin || !pointer) return
  if (pointer[2] === "c") {
    const layout = pointer.slice(0, 2)
    const styles = new PalmBoard(skin, layout[0] === "night" ? "night" : "default", layout[1] === "land_layout" ? "land" : "port", board?.[3] ?? PALM_SHARED_BOARD).candidateTextStyles
    const words = textStyle(styles.words)
    const input = [textStyle(styles.input), textStyle(styles.inputSize)].flatMap((id) => id ?? [])
    return {
      scope: "candidate",
      words: { ids: words ? [words] : [], create: { owner: pointer, field: "i_cand" } },
      first: { ids: [textStyle(styles.first)].flatMap((id) => id ?? []), create: { owner: pointer, field: "i_f_f", copyFrom: words } },
      input: { ids: [...new Set(input)], create: { owner: [...layout, "b", PALM_SHARED_BOARD, "input", "b"], field: "base_f", list: true } },
    }
  }
  if (!isSxiBoardAddress(appState.selectedPath) || appState.selectedPath !== appState.layoutPath) return
  const texts = keyTexts(skin, pointer, true)
  return { scope: "layout", label: { ids: texts.label }, hint: { ids: texts.hint } }
}

export function palmTextValues(text: PalmText, property: PalmTextProperty): string[] {
  return text.ids.map((id) => {
    const value = asObject(palmStyle(id)?.s_1)?.[FIELDS[property]]
    return value === undefined || value === null ? "" : String(value)
  })
}

/** Writes `property` into every style of `text`, creating its style first when it has none: one undo step. */
export function writePalmText(text: PalmText, property: PalmTextProperty, value: string): void {
  editSxi((skin) => {
    let ids = text.ids
    if (!ids.length && text.create) {
      const { owner, field, list, copyFrom } = text.create
      const seed = copyFrom ? asObject(palmStyle(copyFrom, skin)?.s_1) : undefined
      const id = addPalmStyle(skin, palmTheme(), { s_1: seed ? structuredClone(seed) : {} })
      let model = skin as JsonObject
      for (const step of owner) {
        const next = asObject(palmValue(model, [step])) ?? {}
        model[String(step)] = next
        model = next
      }
      model[field] = list ? [Number(id)] : Number(id)
      ids = [id]
    }
    for (const id of ids) {
      const pointer = palmStylePointer(id, skin)
      const style = pointer && asObject(sxiFragment(skin, pointer))
      if (!style) throw new Error(`skin.json 中没有样式 ${id}`)
      const textModel = asObject(style.s_1) ?? (style.s_1 = {}) as JsonObject
      const key = FIELDS[property]
      if (!value) delete textModel[key]
      else textModel[key] = property === "FONT_SIZE" ? Number(value) : value
    }
  })
}
