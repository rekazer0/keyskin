// 百度教程 V6：同名字段按所属分区解释，不推测未记载的枚举。控件由 property-rows.ts 的 field() 按种类自动选择。
type Choice = readonly [value: string, label: string, icon?: string]
type ConfigControl =
  | { kind: "choice"; options: readonly Choice[]; layout?: "select" }
  | { kind: "switch"; on: string; off: string; defaultValue?: string }
  | { kind: "multiple"; options: readonly Choice[]; separator: string; defaultValue?: string }
  | { kind: "text" }
  | { kind: "color" }
  /** 几个维度编码成一个数：值 = 各维度所选值之和（LIST TYPE = 位置 0 / 2 + 时机 0 / 1）。 */
  | { kind: "sum"; parts: ReadonlyArray<{ label: string; options: readonly Choice[] }> }

const SWITCH = { kind: "switch", on: "1", off: "0" } as const

const metadata: Record<string, ConfigControl> = {
  SkinType: { kind: "switch", on: "0", off: "1", defaultValue: "0" },
  SupportDarkMode: SWITCH,
  SkinFlags: { kind: "choice", options: [["0", "自动拉升"], ["1", "皮肤高度"]] },
  MinImeCode: { kind: "choice", layout: "select", options: [["0", "基础功能"], ["1", "多重前景"], ["2", "面板内候选字与符号"], ["3", "TTF 字体"]] },
  SupportPlatform: { kind: "multiple", separator: "", defaultValue: "SWIA", options: [["S", "Symbian"], ["W", "Windows Mobile"], ["I", "iOS"], ["A", "Android"]] },
  Abilities: { kind: "multiple", separator: ",", options: [["Sound", "音效"], ["Animation", "动效"], ["3DTouch", "3D Touch"]] },
  SupportPatch: { kind: "multiple", separator: "|", defaultValue: "Accessory|Sound|Anim", options: [["Accessory", "配饰"], ["Sound", "音效"], ["Anim", "动效"]] },
}
const fields: Record<string, ConfigControl> = {
  NO_BLUR: SWITCH,
  FONT_CLEARTYPE: SWITCH,
  SYMBOL_FULL_SCREEN: SWITCH,
  LIST_ORDER: { kind: "choice", options: [["0", "竖排"], ["1", "横排"]] },
  LIST_LEVEL: { kind: "choice", options: [["0", "主列表"], ["1", "副列表"]] },
  SCROLL_SIDE: { kind: "choice", options: [["0", "向内"], ["1", "向外"]] },
  ANIM_LEVEL: { kind: "choice", options: [["0", "按键下方"], ["1", "按键上方"]] },
}
/** anim.ini 每个 [ANIM*] 里的开关与枚举（手册第 173–180 页）。 */
const animation: Record<string, ConfigControl> = {
  REPEAT_MODE: SWITCH,
  REMOVE: SWITCH,
  FINISH_AFTER_PRACTICES: SWITCH,
  REMOVE_INCLUDE_PRACTICES: SWITCH,
  BUILD_METHOD: { kind: "choice", options: [["0", "同时"], ["1", "接续"]] },
  EMIT_TYPE: { kind: "choice", options: [["0", "依次"], ["1", "同时"]] },
}
const COLOR_VALUE = /^(?:#|0x)?[0-9a-f]{6}(?:[0-9a-f]{2})?$/i

export function baiduConfigControl(section: string, key: string, value = ""): ConfigControl | undefined {
  if (!section) return metadata[key]
  if (/^ANIM\d+$/i.test(section)) return animation[key]
  // 颜色键的值不是色值（如引用）时保持文本，色块编辑不了它。
  if (/_COLOR$/.test(key)) return !value.trim() || COLOR_VALUE.test(value.trim()) ? { kind: "color" } : undefined
  if (key === "VERSION" && /^GLOBAL$/i.test(section)) return SWITCH
  if (key === "ANCHOR_TYPE") {
    if (/^BAR\d*$/i.test(section)) return { kind: "choice", options: [["1", "中间对齐"], ["2", "两边对齐"]] }
    if (/^ICON\d+$/i.test(section)) return { kind: "text" }
  }
  if (key === "PERSIST" && /^ICON\d+$/i.test(section)) return { kind: "choice", options: [["0", "隐藏"], ["1", "无候选"], ["2", "有候选"], ["3", "始终"]] }
  if (key === "TYPE") {
    if (/^LIST\d*$/i.test(section)) return { kind: "sum", parts: [
      { label: "位置", options: [["0", "面板内"], ["2", "面板上方"]] },
      { label: "时机", options: [["0", "始终"], ["1", "有列表项时"]] },
    ] }
    if (/^BAR\d*$/i.test(section)) return { kind: "choice", options: [["0", "跟随按键"], ["1", "面板置顶"]] }
  }
  return fields[key]
}

/** 未知扩展项原样保留；空值代表手册默认值，但不在渲染时写回文件。 */
export function baiduConfigTokens(value: string, separator: string, defaultValue = ""): string[] {
  return (value.trim() || defaultValue).split(separator).map((part) => part.trim()).filter(Boolean)
}

/** `sum` 值拆回各维度：每一维取不超过余数的最大选项；拆不干净（未知值）时 undefined。 */
export function baiduConfigSumParts(control: Extract<ConfigControl, { kind: "sum" }>, value: string): string[] | undefined {
  if (!value.trim()) return control.parts.map(() => "")
  let rest = Number(value)
  if (!Number.isInteger(rest)) return
  const parts = control.parts.map(({ options }) => {
    const option = [...options].map(([option]) => Number(option)).sort((left, right) => right - left).find((option) => option <= rest)
    rest -= option ?? 0
    return option === undefined ? "" : String(option)
  })
  return rest === 0 ? parts : undefined
}
