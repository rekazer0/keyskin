// The property inspector for a Palm skin. It shows the skin.json model behind the selection in Palm's own
// terms (a board's parts; a key's place, styles, text and gestures; a candidate bar or bubble; the skin
// info) and writes every edit straight into skin.json.

import { isListCell } from "../layout.ts"
import { palmBoardLabel, palmPartLabel } from "../palm/palm-labels.ts"
import { asObject, type Json, type JsonObject } from "../palm/sxi-ini.ts"
import { SXI_SKIN_PATH } from "../palm/sxi-json.ts"
import { element } from "../dom-element.ts"
import { appState } from "./state"
import { gestureRows, renderSxiGroup, sxiSkin, sxiValue, type SxiBlock, type SxiPointer } from "./sxi-fields"
import { sxiPointer } from "./sxi-documents"
import { palmStylePointer } from "./sxi-styles"
import { populateSxiAnimationInspector, sxiAnimationInspectorTitle } from "./sxi-animation-inspector"

// Board parts a canvas selection can stand for, by the section the renderer gives them.
const PART_SECTIONS: Record<string, string> = {
  PANEL: "board", GLOBAL: "comm", INPUT: "input", CAND: "cand", HINT: "hint", LOGO: "logo", EMOJI: "emoji",
  MORE: "more", LIST: "list", SEGMENT: "seg", SCAND: "top_cand",
}
const LAYOUT_FIELDS = ["rect", "hit_rect", "b.base_o"]
const STYLE_FIELDS = ["b.base_b", "b.base_f", "b.base_s", "b.asi", "b.base_a", "b.base_ba", "b.base_fa", "b.base_pa"]
const TEXT_FIELDS = ["text", "f_s", "f_n", "f_w", "c_normal", "c_hl"]

type Selection =
  | { kind: "keys"; board: SxiPointer; models: SxiPointer[] }
  | { kind: "board"; board: SxiPointer }
  | { kind: "part"; pointer: SxiPointer }

/** Where a canvas section's model lives under its board: a key, a state key (TIP) or a board part. */
function sectionPointer(skin: JsonObject, board: SxiPointer, section: string): SxiPointer | undefined {
  const key = /^KEY(.+)$/.exec(section)?.[1]
  if (key !== undefined) {
    const keys = sxiValue(skin, [...board, "keys"])
    const index = Array.isArray(keys) ? keys.findIndex((item) => String(asObject(item)?.id) === key) : -1
    return index >= 0 ? [...board, "keys", index] : undefined
  }
  const tip = /^TIP(.+)$/.exec(section)?.[1]
  if (tip !== undefined) return [...board, "key_fix", tip]
  const part = isListCell(section) ? "list" : PART_SECTIONS[section]
  return part ? [...board, part] : undefined
}

function palmSelection(skin: JsonObject): Selection | undefined {
  const pointer = sxiPointer(appState.selectedPath)
  if (!pointer) return
  if (pointer[2] === "b") {
    if (appState.selectedPath !== appState.layoutPath || !appState.selectedKeySections.length) return { kind: "board", board: pointer }
    const models = [...new Map(appState.selectedKeySections.flatMap((section) => {
      const model = sectionPointer(skin, pointer, section)
      return model ? [[model.join("\u0000"), model] as const] : []
    })).values()]
    return models.length ? { kind: "keys", board: pointer, models } : { kind: "board", board: pointer }
  }
  // Styles and tiles are edited in the style and resource views.
  return pointer.length === 1 || pointer[2] === "c" || pointer[2] === "h" ? { kind: "part", pointer } : undefined
}

// Numbered models (`key_fix`, `icon_info`): {"1": {…}, "2": {…}}.
const isDictionary = (value: Json): boolean => {
  const object = asObject(value)
  return Boolean(object && Object.keys(object).length && Object.entries(object).every(([key, item]) => /^\d+$/.test(key) && asObject(item)))
}
const isModelList = (value: Json): boolean => Array.isArray(value) && value.length > 0 && value.every((item) => asObject(item))
// Insets look like a model but are one value.
const isModel = (value: Json): boolean => Boolean(asObject(value)) && !["top", "left", "bottom", "right"].every((side) => side in asObject(value)!)

/**
 * A model as groups: its own values in the first (under `label`), then one group per part it holds;
 * a dictionary or list of models gets one subsection per entry.
 */
function modelGroups(pointer: SxiPointer, model: JsonObject, label: string, omit: string[] = []): Array<HTMLElement | undefined> {
  const parts = Object.keys(model).filter((key) => key !== "b" && !omit.includes(key) && (isModel(model[key]) || isModelList(model[key])))
  const groups = [renderSxiGroup(label, [{ targets: [pointer], omit: [...omit, ...parts] }], { code: pointer.slice(1).join(".") || String(pointer[0]) })]
  for (const part of parts) {
    const value = model[part]
    const name = palmPartLabel(part)
    const entries = isDictionary(value) ? Object.keys(asObject(value)!) : Array.isArray(value) ? value.map((_, index) => index) : undefined
    const blocks: SxiBlock[] = entries
      ? entries.map((entry) => ({ targets: [[...pointer, part, entry]], title: `${name} ${typeof entry === "number" ? entry + 1 : entry}`, code: `${part}.${entry}` }))
      : [{ targets: [[...pointer, part]] }]
    groups.push(renderSxiGroup(name, blocks, { code: part }))
  }
  return groups
}

/** The text styles (`ss_1.<id>.s_1`) the selected keys' foregrounds draw, each where the orientation looks it up. */
function textBlocks(skin: JsonObject, models: SxiPointer[]): SxiBlock[] {
  const ids = [...new Set(models.flatMap((model) => {
    const layers = sxiValue(skin, [...model, "b", "base_f"])
    return Array.isArray(layers) ? layers.map(String) : []
  }))]
  return ids.flatMap((id) => {
    const style = palmStylePointer(id, skin)
    return style && asObject(sxiValue(skin, [...style, "s_1"])) ? [{
      targets: [[...style, "s_1"]],
      title: `前景样式 ${id}`,
      code: `${style.slice(1).join(".")}.s_1`,
      only: TEXT_FIELDS,
      expect: ["text", "f_s", "c_normal", "c_hl"],
    }] : []
  })
}

function palmKeyGroups(skin: JsonObject, models: SxiPointer[]): Array<HTMLElement | undefined> {
  if (!models.every((model) => model[model.length - 2] === "keys")) {
    return models.flatMap((model) => modelGroups(model, asObject(sxiValue(skin, model)) ?? {}, palmPartLabel(String(model[model.length - 2] === "key_fix" ? "key_fix" : model[model.length - 1]))))
  }
  const text = textBlocks(skin, models)
  const note = models.length > 1 ? "修改会作用于所有选中按键。" : undefined
  const gestures = models.map((model) => sxiValue(skin, [...model, "values"]))
  const gestureBlock: SxiBlock = { targets: models, only: [] }
  // The shell counts the configured gestures into this title badge (inspector-shell.ts).
  const count = element("small", "inspector-gesture-count")
  const gestureGroup = renderSxiGroup("手势", [], { extra: gestureRows(gestureBlock, ["values"], gestures) })
  gestureGroup?.querySelector("h3")?.append(count)
  return [
    renderSxiGroup("布局", [{ targets: models, only: LAYOUT_FIELDS, expect: ["rect", "hit_rect"], note }]),
    renderSxiGroup("样式", [{ targets: models, only: STYLE_FIELDS, expect: ["b.base_b", "b.base_f"], keyForeground: true }]),
    text.length
      ? renderSxiGroup("文字", text.map((block, index) => index ? block : { ...block, note: "前景样式可能被多个按键共用，修改会一起生效。" }))
      : renderSxiGroup("文字", [{ targets: models, only: [], note: "前景没有文字样式：可以在「样式」里添加一个文字样式。" }]),
    gestureGroup,
    renderSxiGroup("状态", [{ targets: models, only: ["fix_a"] }]),
    renderSxiGroup("其他", [{ targets: models, omit: ["id", "values", "b", ...LAYOUT_FIELDS, "fix_a"] }]),
  ]
}

/**
 * Fills `container` for the current Palm selection and returns whether there was anything to show.
 * Several selected keys show the values they share and write to every one of them.
 */
export function populateSxiInspector(container: HTMLElement): boolean {
  container.replaceChildren()
  if (populateSxiAnimationInspector(container)) return true
  const skin = sxiSkin()
  const selected = skin && palmSelection(skin)
  if (!skin || !selected) return false
  const groups = selected.kind === "keys"
    ? palmKeyGroups(skin, selected.models)
    : selected.kind === "board"
      ? modelGroups(selected.board, asObject(sxiValue(skin, selected.board)) ?? {}, "键盘", ["keys", "type"])
      : modelGroups(selected.pointer, asObject(sxiValue(skin, selected.pointer)) ?? {}, partTitle(selected.pointer))
  container.append(...groups.filter((group): group is HTMLElement => Boolean(group)))
  container.dataset.path = appState.selectedPath
  return container.childElementCount > 0
}

function partTitle(pointer: SxiPointer): string {
  if (pointer.length === 1) return palmPartLabel(String(pointer[0]))
  return `${pointer[2] === "c" ? "候选栏" : "气泡"} ${pointer[3]}`
}

/** Inspector header for a Palm selection: the board, key or part, and where it sits in skin.json. */
export function sxiInspectorTitle(): { name: string; context: string } | undefined {
  const animation = sxiAnimationInspectorTitle()
  if (animation) return animation
  const skin = sxiSkin()
  const selected = skin && palmSelection(skin)
  if (!skin || !selected) return
  if (selected.kind === "part") return { name: partTitle(selected.pointer), context: `${SXI_SKIN_PATH} · ${selected.pointer.join(".")}` }
  const type = String(selected.board[3])
  if (selected.kind === "board") return { name: palmBoardLabel(type), context: `${SXI_SKIN_PATH} · ${selected.board.slice(1).join(".")}` }
  if (selected.models.length > 1) return { name: `已选 ${selected.models.length} 个按键`, context: `${type} · 共同属性` }
  const model = selected.models[0]
  const owner = String(model[model.length - 2])
  const key = owner === "keys" ? `按键 ${String(asObject(sxiValue(skin, model))?.id ?? "")}`.trim()
    : owner === "key_fix" ? `状态按键 ${model[model.length - 1]}` : palmPartLabel(String(model[model.length - 1]))
  return { name: key, context: `${type} · ${model.slice(4).join(".")}` }
}
