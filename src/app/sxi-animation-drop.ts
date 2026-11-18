import { addPalmStyle } from "../palm/palm-style-edit.ts"
import { PALM_ANIMATION_EVENTS } from "../palm/sxi-animation.ts"
import { asObject, type JsonObject } from "../palm/sxi-ini.ts"
import { openPalmSkin, palmTheme, PALM_SHARED_BOARD, sxiPointer } from "./sxi-documents"
import { palmKeyPointer, palmStyle, palmValue, type PalmPointer } from "./sxi-styles"
import { editSxi } from "./sxi-fields"
import { appState } from "./state"

/** Resolve canvas objects to skin.json, never to a generated INI preview. */
export function palmDropBinding(id: string, path: string, sections: string[]) {
  const skin = openPalmSkin(), board = sxiPointer(appState.layoutPath), table = sxiPointer(appState.selectedPath), part = sxiPointer(path)
  if (!skin || !board || !table || !part || !asObject(palmValue(skin, [...table, id]))) return
  const targets: Array<{ pointer: PalmPointer; field: string; original: JsonObject | undefined }> = []
  for (const section of sections) {
    let pointer: PalmPointer | undefined, inherited: PalmPointer | undefined
    const field = section === "PANEL" ? "base_pa" : "asi"
    if (section === "PANEL") { pointer = [...board, "board"]; inherited = [...board.slice(0, 3), PALM_SHARED_BOARD, "board"] }
    else if (section === "SWITCH") pointer = [...part, "switch"]
    else if (section === "CAND") pointer = part
    else if (section === "LIST") pointer = [...board, "list"]
    else pointer = palmKeyPointer(skin, section)
    if (!pointer) return
    const base = asObject(palmValue(skin, [...pointer, "b"])), fallback = inherited && asObject(palmValue(skin, [...inherited, "b"]))
    const source = base?.[field] ?? base?.asi ?? fallback?.[field] ?? fallback?.asi
    targets.push({ pointer, field, original: source === undefined ? undefined : palmStyle(String(source), skin) })
  }
  const existing = (model: JsonObject | undefined, event: string) => String(asObject(model?.s_5)?.[event] ?? "0")
  return {
    options: PALM_ANIMATION_EVENTS.map(([event, label]) => ({ event, label, replacing: targets.filter(t => !["0", id].includes(existing(t.original, event))).length })),
    apply(event: string) {
      editSxi(current => {
        const copies = new Map<JsonObject | undefined, number>()
        for (const { pointer, field, original } of targets) {
          if (existing(original, event) === id) continue
          const parent = asObject(palmValue(current, pointer.slice(0, -1))), last = pointer.at(-1)!
          let owner = asObject(palmValue(current, pointer))
          if (!owner && parent) owner = parent[last] = {}
          if (!owner) throw new Error("找不到选中的动画目标")
          let style = copies.get(original)
          if (style === undefined) {
            const model = { ...original, s_5: { ...asObject(original?.s_5), [event]: Number(id) } } as JsonObject
            delete model.id
            style = Number(addPalmStyle(current, palmTheme(), model)); copies.set(original, style)
          }
          owner.b = { ...asObject(owner.b), [field]: style }
        }
      })
    },
  }
}
