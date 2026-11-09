// Inspector capabilities come from the same models used to export Palm skins, including absent fields.
import {
  additionModel, baseModel, bubbleIconModel, bubbleModel, buttonFixModel, buttonModel,
  candidateIconModel, candidateModel, candidateSwitchModel, composeModel, constModel,
  emoticonModel, helpCandModel, motiveModel, posFixModel, boardDrawModel, tableModel,
} from "./palm-models.ts"
import { asObject, type JsonObject } from "./sxi-ini.ts"

/** A model's supported fields; undefined values describe optional fields without adding defaults. */
export function palmInspectorModel(pointer: readonly (string | number)[]): JsonObject {
  const part = String(pointer.at(-1))
  const owner = String(pointer.at(-2))
  if (pointer.length === 1 && part === "info") return {
    name: undefined, description: undefined, author: undefined, dark_mode: undefined,
    core_ability: undefined, platform: undefined, layoutSupport: undefined, splitImage: undefined, tool_version: undefined,
  }
  if (owner === "keys") {
    const { id: _id, hasU: _hasU, f: _f, h_style: _h, offset: _offset, fix_b: _fix, ...key } = asObject(buttonModel({}, ""))!
    return key
  }
  if (owner === "key_fix" || owner === "fix") return asObject(buttonFixModel({}))!
  if (owner === "icon_list") return asObject(candidateIconModel({}))!
  if (owner === "icon_info") return asObject(bubbleIconModel({}))!
  if (owner === "offset") return asObject(posFixModel({ POS: "0,0" }))!
  if (owner === "force") return asObject(motiveModel({}))!
  if (pointer[2] === "b" && pointer.length === 4) return {
    comm: constModel({}), board: boardDrawModel({}), input: composeModel({}), cand: candidateModel({}),
    hint: bubbleModel({}), emoji: emoticonModel({}), more: additionModel({}), list: tableModel({}),
    seg: tableModel({}), top_cand: helpCandModel({}), logo: { b: baseModel({}), b_b: undefined, b_f: undefined, b_t: undefined },
    key_fix: {}, offset: {}, force: [],
  }
  if (pointer[2] === "c" && pointer.length === 4) return { ...candidateModel({}), switch: candidateSwitchModel({}), icon_list: [], fix: {} }
  if (pointer[2] === "h" && pointer.length === 4) return { info: undefined, i_cell: undefined, icon_info: {} }
  const builders: Record<string, () => JsonObject> = {
    b: () => asObject(baseModel({}))!, comm: () => asObject(constModel({}))!,
    board: () => ({ ...asObject(boardDrawModel({})), bd: { b: { a: undefined, r: undefined } } }),
    bd: () => ({ b: { a: undefined, r: undefined } }), input: () => asObject(composeModel({}))!,
    cand: () => ({ ...candidateModel({}), switch: candidateSwitchModel({}), icon_list: [], fix: {} }), hint: () => ({ ...asObject(bubbleModel({})), icon_info: {} }),
    logo: () => ({ b: baseModel({}), b_b: undefined, b_f: undefined, b_t: undefined }),
    emoji: () => asObject(emoticonModel({}))!, more: () => asObject(additionModel({}))!,
    list: () => asObject(tableModel({}))!, seg: () => asObject(tableModel({}))!,
    top_cand: () => asObject(helpCandModel({}))!, switch: () => asObject(candidateSwitchModel({}))!,
    t_icon: () => ({ b: baseModel({}), i_text: undefined }),
    p_icon: () => ({ b: baseModel({}), i_text: undefined }),
    s_1: () => ({ text: undefined, f_s: undefined, f_n: undefined, c_type: undefined, c_normal: undefined, c_hl: undefined, file: undefined, for_back: undefined }),
    s_2: () => ({ normal: undefined, hl: undefined }),
    s_3: () => ({ size: undefined, color: undefined }),
    s_4: () => ({ path_1: undefined, path_2: undefined, path_3: undefined }),
    s_5: () => ({ 1: undefined, 2: undefined, 3: undefined, 4: undefined, 5: undefined }),
  }
  if (owner === "ss_1") return Object.fromEntries(["s_1", "s_2", "s_3", "s_4", "s_5"].map((key) => [key, builders[key]()]))
  return builders[part]?.() ?? {}
}

export function palmInspectorCollection(pointer: readonly (string | number)[], key: string): "array" | "dictionary" | undefined {
  const board = pointer[2] === "b" && pointer.length === 4
  const candidate = pointer.at(-1) === "cand" || pointer[2] === "c" && pointer.length === 4
  const bubble = pointer.at(-1) === "hint" || pointer[2] === "h" && pointer.length === 4
  if (board && key === "force" || candidate && key === "icon_list") return "array"
  if (board && ["key_fix", "offset"].includes(key) || candidate && key === "fix" || bubble && key === "icon_info") return "dictionary"
}

export function palmInspectorKind(pointer: readonly (string | number)[], key: string): "number" | "point" | "insets" | "switch" | "list" | "strings" | undefined {
  if (pointer.at(-1) === "s_3" && key === "size" || pointer.at(-1) === "s_5" && /^[1-5]$/.test(key)) return "number"
  if (["size", "f_size", "c_size", "pos", "p", "s", "offset"].includes(key)) return "point"
  if (key === "insets" && pointer.at(-1) === "switch") return "number"
  if (["insets", "a_insets"].includes(key)) return "insets"
  if (["s_full", "exact", "right", "c_rect", "order", "side", "hot_fix", "for_back", "dark_mode", "layoutSupport", "splitImage"].includes(key)) return "switch"
  if (["fix_a", "base_o", "base_fa", "info", "t", "v"].includes(key)) return key === "t" && ["list", "seg"].includes(String(pointer.at(-1))) ? "number" : "list"
  if (["titles", "values"].includes(key)) return "strings"
  if (["f_s", "f_w", "c_type", "type", "gap", "f_gap", "more_width", "anchor", "hint", "bar_a", "b_line", "row", "col", "count", "keep", "start", "finish", "value", "extend", "level", "asi", "base_ba", "base_pa", "base_a", "core_ability", "tool_version"].includes(key)) return "number"
}
