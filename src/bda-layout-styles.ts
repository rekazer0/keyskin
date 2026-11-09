import { type BdaStyleRef, type BdaKey, type BdaPanel } from "./bda.ts"

const entryNames: Record<string, string> = { short: "短按", long: "长按", port: "竖屏", land: "横屏" }

function bdaEntryLabel(key: string): string {
  return entryNames[key] ?? key
}

// label 是中文说明，field 是 BDA appearanceConfig 解码源码里的真实字段名，
// path 指向单个样式引用；多选时 paths 汇总所有同步写回位置。
export type BdaLayoutStyleItem = {
  /** Absent when the skin does not set this reference yet; picking or typing a style creates it. */
  ref?: BdaStyleRef
  /** The style kind a typed number refers to. */
  type: BdaStyleRef["type"]
  label: string
  field: string
  path: string[]
  paths?: string[][]
  owner?: string
  /** Selected keys reference different styles here. */
  mixed?: boolean
}

function slot(ref: BdaStyleRef | undefined, label: string, field: string, path: string[], type: BdaStyleRef["type"] = "image"): BdaLayoutStyleItem {
  return { ref, type: ref?.type ?? type, label, field, path }
}

type BdaLayoutStyleGroup = { key: string; title: string; items: BdaLayoutStyleItem[] }

function uniqueStyleItems(items: BdaLayoutStyleItem[]): BdaLayoutStyleItem[] {
  return [...new Map(items.map((item) => [item.path.join("."), item])).values()]
}

/** The slot after a key's last foreground layer: picking a style there adds a layer (`foreStyles[+]`). */
export const NEW_FORE_LAYER = "foreStyles[+]"

function keyStyleItems(name: string, key: BdaKey | undefined, path: string[]): BdaLayoutStyleItem[] {
  return [
    { ...slot(key?.backStyle, "背景样式", "backStyle", [...path, "backStyle"]), owner: name },
    ...(key?.foreStyles ?? []).map((ref, index) => ({ ...slot(ref, `前景样式 ${index + 1}`, `foreStyles[${index}]`, [...path, "foreStyles", String(index)]), owner: name })),
    { ...slot(undefined, "添加前景层", NEW_FORE_LAYER, [...path, "foreStyles", String(key?.foreStyles.length ?? 0)]), owner: name },
    { ...slot(key?.backStyleState, "状态背景样式", "backStyleState", [...path, "backStyleState"]), owner: name },
  ]
}

const refID = (ref: BdaStyleRef | undefined) => ref ? `${ref.type}:${ref.key}` : ""

export function bdaLayoutStyleGroups(
  panel: BdaPanel,
  keys: Array<{ name: string; key: BdaKey }>,
  scope: "panel" | "candidate" = "panel",
): BdaLayoutStyleGroup[] {
  const group = (key: string, title: string, items: BdaLayoutStyleItem[]): BdaLayoutStyleGroup | undefined => {
    const unique = uniqueStyleItems(items)
    return unique.length ? { key, title, items: unique } : undefined
  }
  if (keys.length) {
    const items = keys.flatMap(({ name, key }) => keyStyleItems(name, key, ["keys", name]))
    const merged = keys.length === 1 ? items : [...items.reduce((result, item) => {
      const current = result.get(item.field)
      if (current) {
        current.paths!.push(item.path)
        current.mixed ||= refID(current.ref) !== refID(item.ref)
      } else result.set(item.field, { ...item, owner: undefined, paths: [item.path] })
      return result
    }, new Map<string, BdaLayoutStyleItem>()).values()]
    const selection = group("selection", `已选按键（${keys.length}）`, merged)
    return selection ? [selection] : []
  }

  // 候选栏样式属于候选栏对象，不混入面板整体设置。
  if (scope === "candidate") {
    const candidate: BdaLayoutStyleItem[] = []
    const cand = panel.cand
    for (const [ref, label, field] of [
      [cand?.candBarStyle, "候选栏背景", "candBarStyle"], [cand?.candOnBarStyle, "候选上屏状态", "candOnBarStyle"],
      [cand?.cellBackStyle, "候选单元背景", "cellBackStyle"], [cand?.cellForeStyle, "候选文字", "cellForeStyle"],
      [cand?.firstCellBackStyle, "首候选背景", "firstCellBackStyle"], [cand?.firstCellForeStyle, "首候选文字", "firstCellForeStyle"],
      [cand?.subCandBackStyle, "子候选栏背景", "subCandBackStyle"], [cand?.subCandCellBackStyle, "子候选单元背景", "subCandCellBackStyle"],
      [cand?.subCandCellForeStyle, "子候选文字", "subCandCellForeStyle"], [cand?.accessoryBackStyle, "候选附件背景", "accessoryBackStyle"],
      [cand?.gridLeftForeStyle, "候选网格左图标", "gridLeftForeStyle"], [cand?.gridRightForeStyle, "候选网格右图标", "gridRightForeStyle"],
    ] as const) candidate.push(slot(ref, label, field, ["cand", field], /CellForeStyle$/i.test(field) ? "text" : "image"))
    const switchItems: BdaLayoutStyleItem[] = []
    for (const [ref, label, field] of [
      [cand?.switch?.normalBack, "候选切换 · 正常背景", "normalBack"], [cand?.switch?.selectBack, "候选切换 · 选中背景", "selectBack"],
      [cand?.switch?.normalFore, "候选切换 · 正常前景", "normalFore"], [cand?.switch?.selectFore, "候选切换 · 选中前景", "selectFore"],
    ] as const) switchItems.push(slot(ref, label, `switch.${field}`, ["cand", "switch", field]))
    const candKeys = [...new Set(["CAND_F14", "CAND_F31", "CAND_F8", "CAND_F9", ...cand?.candKeys.keys() ?? []])].flatMap((name) =>
      keyStyleItems(`候选键 ${name}`, cand?.candKeys.get(name), ["cand", "candKeys", name]))
    const menuKeys = [...new Set(["MENU_EMOJI", "MENU_MODE", "MENU_AUDIO", "MENU_SEARCH", "MENU_MOVE", "MENU_PASTE", ...cand?.menuKeys.keys() ?? []])].flatMap((name) =>
      keyStyleItems(`候选菜单 ${name}`, cand?.menuKeys.get(name), ["cand", "menuKeys", name]))
    const aiIcon = keyStyleItems("AI 图标", cand?.aiIcon, ["cand", "aiIcon"])
    return [
      group("candidate", "候选栏", candidate),
      group("candidateSwitch", "候选切换", switchItems),
      group("candidateKeys", "候选键", candKeys),
      group("candidateMenu", "候选菜单", [...menuKeys, ...aiIcon]),
    ].filter((value): value is BdaLayoutStyleGroup => Boolean(value))
  }

  // Built-in hint/list names remain available before their first style is assigned.
  const groups = [
    { key: "panel", title: "面板", items: [
      slot(panel.wholeBackStyle, "面板整体背景", "wholeBackStyle", ["wholeBackStyle"]),
      slot(panel.backStyle, "面板背景", "backStyle", ["backStyle"]),
      slot(panel.inputRegionBackStyle, "输入区整体背景", "inputRegionBackStyle", ["inputRegionBackStyle"]),
    ] },
    { key: "input", title: "输入区", items: [
      slot(panel.input?.backStyle, "输入区背景", "input.backStyle", ["input", "backStyle"]),
      slot(panel.input?.textStyle, "输入区文字", "input.textStyle", ["input", "textStyle"], "text"),
    ] },
    { key: "more", title: "更多面板", items: [
      slot(panel.more?.backStyle, "更多面板背景", "more.backStyle", ["more", "backStyle"]),
      slot(panel.more?.cellBackStyle, "更多面板单元背景", "more.cellBackStyle", ["more", "cellBackStyle"]),
      slot(panel.more?.cellForeStyle, "更多面板单元前景", "more.cellForeStyle", ["more", "cellForeStyle"]),
    ] },
    group("hints", "按键提示", [...new Set(["short", "long", ...panel.hints.keys()])].flatMap((key) => { const name = bdaEntryLabel(key), hint = panel.hints.get(key); return [
      slot(hint?.backStyle, `${name} · 背景`, "backStyle", ["hints", key, "backStyle"]),
      slot(hint?.barStyle, `${name} · 提示条`, "barStyle", ["hints", key, "barStyle"]),
      slot(hint?.foreStyle, `${name} · 前景`, "foreStyle", ["hints", key, "foreStyle"]),
      slot(hint?.cellStyle, `${name} · 单元背景`, "cellStyle", ["hints", key, "cellStyle"]),
    ] })),
    group("lists", "列表", [...new Set(["port", ...panel.lists.keys()])].flatMap((key) => { const name = bdaEntryLabel(key), list = panel.lists.get(key); return [
      slot(list?.backStyle, `${name} · 背景`, "backStyle", ["lists", key, "backStyle"]),
      slot(list?.cellBackStyle, `${name} · 单元背景`, "cellBackStyle", ["lists", key, "cellBackStyle"]),
      slot(list?.cellForeStyle, `${name} · 单元文字`, "cellForeStyle", ["lists", key, "cellForeStyle"], "text"),
      ...(list?.foreStyles ?? []).map((ref, index) => slot(ref, `${name} · 前景 ${index + 1}`, `foreStyles[${index}]`, ["lists", key, "foreStyles", String(index)])),
      slot(undefined, "添加前景层", NEW_FORE_LAYER, ["lists", key, "foreStyles", String(list?.foreStyles.length ?? 0)]),
    ] })),
  ]
  return groups.filter((value): value is BdaLayoutStyleGroup => Boolean(value))
}
