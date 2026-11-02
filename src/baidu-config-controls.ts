// 百度教程 V6：同名字段按所属分区解释，不推测未记载的枚举。
type Choice = readonly [value: string, label: string]
type ConfigControl =
  | { kind: "choice"; options: readonly Choice[]; segmented?: boolean }
  | { kind: "switch"; on: string; off: string; defaultValue?: string }
  | { kind: "multiple"; options: readonly Choice[]; separator: string; defaultValue?: string }

const metadata: Record<string, ConfigControl> = {
  SkinType: { kind: "switch", on: "0", off: "1", defaultValue: "0" },
  SupportDarkMode: { kind: "switch", on: "1", off: "0" },
  SkinFlags: { kind: "choice", options: [["0", "自动拉升"], ["1", "皮肤高度"]], segmented: true },
  MinImeCode: { kind: "choice", options: [["0", "基础功能"], ["1", "多重前景"], ["2", "面板内候选字与符号"], ["3", "TTF 字体"]] },
  SupportPlatform: { kind: "multiple", separator: "", defaultValue: "SWIA", options: [["S", "Symbian"], ["W", "Windows Mobile"], ["I", "iOS"], ["A", "Android"]] },
  Abilities: { kind: "multiple", separator: ",", options: [["Sound", "音效"], ["Animation", "动效"], ["3DTouch", "3D Touch"]] },
  SupportPatch: { kind: "multiple", separator: "|", defaultValue: "Accessory|Sound|Anim", options: [["Accessory", "配饰"], ["Sound", "音效"], ["Anim", "动效"]] },
}
const fields: Record<string, ConfigControl> = {
  NO_BLUR: { kind: "switch", on: "1", off: "0" },
  FONT_CLEARTYPE: { kind: "switch", on: "1", off: "0" },
  LIST_ORDER: { kind: "choice", options: [["0", "竖排"], ["1", "横排"]], segmented: true },
  LIST_LEVEL: { kind: "choice", options: [["0", "主列表"], ["1", "副列表"]], segmented: true },
  SCROLL_SIDE: { kind: "choice", options: [["0", "向内"], ["1", "向外"]], segmented: true },
  ANIM_LEVEL: { kind: "choice", options: [["0", "按键下方"], ["1", "按键上方"]], segmented: true },
}

export function baiduConfigControl(section: string, key: string): ConfigControl | undefined {
  if (!section) return metadata[key]
  if (key === "ANCHOR_TYPE") {
    if (/^BAR\d*$/i.test(section)) return { kind: "choice", options: [["1", "中间对齐"], ["2", "两边对齐"]], segmented: true }
    if (/^ICON\d+$/i.test(section)) return { kind: "choice", options: [
      ["1", "左上"], ["2", "上中"], ["3", "右上"], ["4", "左中"], ["5", "中心"], ["6", "右中"], ["7", "左下"], ["8", "下中"], ["9", "右下"],
    ] }
  }
  if (key === "PERSIST" && /^ICON\d+$/i.test(section)) return { kind: "choice", options: [["0", "隐藏"], ["1", "无候选字时"], ["2", "有候选字时"], ["3", "始终显示"]] }
  if (key === "TYPE") {
    if (/^LIST\d*$/i.test(section)) return { kind: "choice", options: [["0", "面板内 · 始终显示"], ["1", "面板内 · 有列表项时"], ["2", "面板上方 · 始终显示"], ["3", "面板上方 · 有列表项时"]] }
    if (/^BAR\d*$/i.test(section)) return { kind: "choice", options: [["0", "跟随按键"], ["1", "面板置顶"]], segmented: true }
  }
  return fields[key]
}

/** 未知扩展项原样保留；空值代表手册默认值，但不在渲染时写回文件。 */
export function baiduConfigTokens(value: string, separator: string, defaultValue = ""): string[] {
  return (value.trim() || defaultValue).split(separator).map((part) => part.trim()).filter(Boolean)
}
