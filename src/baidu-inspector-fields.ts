import type { IniDocument } from "./ini.ts"

const BASE = ["BACK_STYLE", "FORE_STYLE", "SOUND_STYLE", "ANIM_STYLE", "BACK_ANIM_STYLE", "FORE_ANIM_STYLE", "PRESS_STYLE"]
const LAYOUT_SECTIONS = ["PANEL", "INPUT", "CAND", "SCAND", "HINT", "MORE", "LIST", "LOGO", "EMOJI", "GLOBAL"]
const SECTION_KEYS: Record<string, readonly string[]> = {
  PANEL: [...BASE, "SIZE", "FIX_SIZE", "NO_BLUR", "NON_SPLIT_PANEL_REGION", "ANIM_LEVEL"],
  INPUT: [...BASE, "TYPE", "POS", "SIZE", "FIX_SIZE", "PADDING"],
  CAND: [...BASE, "TYPE", "LAYOUT_NAME", "ICON_NUM", "VIEW_RECT", "FIX_SIZE", "CELL_STYLE", "MASK_STYLE", "FIRST_FORE", "FIRST_BACK", "PADDING", "CELL_W", "FIRST_GAP", "MORE_W", "INPUT_STYLE"],
  SCAND: [...BASE, "VIEW_RECT", "PADDING", "INPUT_STYLE", "SCAND_STYLE"],
  LIST: [...BASE, "TYPE", "POS", "SIZE", "VIEW_RECT", "CELL_SIZE", "CELL_STYLE", "SCROLL_STYLE", "LIST_NUM", "LIST_ORDER", "LIST_LEVEL", "SCROLL_SIDE", "NAMES", "VALUES", "PADDING", "HLINE_STYLE", "VLINE_STYLE"],
  TAB: [...BASE, "PADDING", "CELL_STYLE", "CELL_W", "FIRST_GAP"],
  SWITCH: ["NML_BACK_STYLE", "SEL_BACK_STYLE", "NML_FONT_STYLE", "SEL_FONT_STYLE", "PADDING"],
  HINT: [...BASE, "LAYOUT_NAME", "TYPE", "ANCHOR_TYPE", "BACK_ICON"],
  MORE: [...BASE, "LAYOUT_NAME", "SYM_LAYOUT", "GRID", "CELL_STYLE", "LINE_COLOR"],
  LOGO: [...BASE, "LAYOUT_NAME"],
  EMOJI: [...BASE, "LAYOUT_NAME", "PANEL_BACK_STYLE_INDEX", "TAB_BACK_STYLE_INDEX", "TEXT_STYLE_INDEX", "BOTTOM_LINE"],
  GLOBAL: ["VERSION", "SYMBOL_FULL_SCREEN"],
  BAR: [...BASE, "TYPE", "ANCHOR_TYPE", "BACK_ICON", "ARROW_ICON", "CELL_STYLE", "POS", "SIZE", "CELL_SIZE", "PADDING"],
  ICON: [...BASE, "TEXT_STYLE", "POS", "SIZE", "FIX_SIZE", "KEY", "PERSIST", "ANCHOR_TYPE", "PADDING", "STAT_STYLE"],
}

/** 候选栏文件的检查器顺序：输入区（输入码）紧跟候选栏，工具栏与工具按钮排在后面。 */
const CANDIDATE_SECTION_ORDER = ["CAND", "INPUT", "SWITCH"]

const sectionKind = (section: string) => section.replace(/\d+$/i, "").toUpperCase()

/** 候选栏与输入区属于候选栏文件：选中候选栏/输入码区域时才编辑，整体布局里不展开。 */
const CANDIDATE_AREA_SECTIONS = new Set(["CAND", "INPUT"])

/** 整体布局不重复列出候选栏与输入区；其他配置仍由调用方决定是否展示。 */
function overallLayoutEntries(document: IniDocument) {
  const entries = document.entries().filter(({ section }) => !CANDIDATE_AREA_SECTIONS.has(sectionKind(section)))
  for (const section of document.sections()) {
    if (CANDIDATE_AREA_SECTIONS.has(sectionKind(section))) continue
    for (const key of SECTION_KEYS[sectionKind(section)] ?? []) {
      if (document.get(section, key) === undefined) entries.push({ section, key, value: "" })
    }
  }
  return entries
}

/** Capabilities create inspector rows, never source entries. Unknown source keys stay editable. */
export function baiduInspectorEntries(document: IniDocument, path: string, overallLayout = false) {
  if (overallLayout) return overallLayoutEntries(document)
  const sections = new Set(document.sections())
  if (/\.ini$/i.test(path) && !/(^|\/)anim\.ini$/i.test(path)) {
    for (const section of LAYOUT_SECTIONS) sections.add(section)
  } else if (/\.cnd$/i.test(path)) {
    // 候选栏文件里的输入区（输入码）与候选栏一起，在画布上选中候选栏/输入码区域时出现。
    for (const section of CANDIDATE_SECTION_ORDER) sections.add(section)
  } else if (/\.pop$/i.test(path)) {
    for (const section of ["HINT", "BAR"]) sections.add(section)
  }
  const entries = document.entries()
  for (const section of sections) {
    for (const key of SECTION_KEYS[sectionKind(section)] ?? []) {
      if (document.get(section, key) === undefined) entries.push({ section, key, value: "" })
    }
  }
  if (!/\.cnd$/i.test(path)) return entries
  const rank = (section: string) => {
    const index = CANDIDATE_SECTION_ORDER.indexOf(section)
    return index < 0 ? CANDIDATE_SECTION_ORDER.length : index
  }
  return entries.sort((a, b) => rank(a.section) - rank(b.section))
}

/** A partially filled new tuple uses zero for its other coordinates; all-empty means unset. */
export function baiduInspectorTuple(values: readonly string[]): string {
  return values.some((value) => value.trim()) ? values.map((value) => value.trim() || "0").join(",") : ""
}
