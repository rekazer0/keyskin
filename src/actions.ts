import { IniDocument } from "./ini.ts"

const functionCodeDescriptions: Record<string, string> = {
  F1: "切换到符号面板", F3: "切换到拇指/全键盘", F4: "返回", F5: "切换到软键盘",
  F6: "切换到数字面板", F7: "切换到表情面板", F8: "隐藏面板", F9: "查看更多候选字",
  F10: "切换小写和首字母大写", F11: "切换小写和大写锁定", F12: "切换到网络面板",
  F13: "一键换皮肤", F14: "面板切换功能容器", F15: "切换到中文输入状态",
  F16: "切换到英文输入状态", F17: "切换到拨号界面", F21: "菜单", F22: "候选字上翻",
  F23: "候选字下翻", F24: "中文输入方式选择菜单", F25: "切换字母/联想",
  F26: "候选字单字/全部切换", F27: "锁定符号面板", F28: "修改英文排序",
  F29: "候选条上翻页", F30: "候选条下翻页", F31: "Logo 菜单", F32: "弹出预备的列表",
  F36: "退格", F37: "删除", F38: "空格", F39: "回车", F40: "清除输入码",
  F41: "Tab", F42: "Home", F43: "End", F44: "剪切", F45: "复制", F46: "粘贴",
  F47: "全选", F48: "清空", F49: "光标上移", F50: "光标下移", F51: "光标左移",
  F52: "光标右移", F53: "手写区", F54: "结束联想", F55: "候选字所在区域",
  F56: "遮罩效果的键值", F61: "启动选字模式", F62: "切换其他输入法（地球）",
  F63: "输入法选择菜单", F64: "右上角关闭（X 或 OK）", F65: "Win", F66: "恢复",
  F67: "撤销", F68: "调起应用-搜索", F69: "调起应用-短信", F70: "调起应用-Email 邮箱（Android 实为短信）",
  F71: "启用表情符号功能", F72: "启动语音", F73: "启动多媒体",
  F74: "启动颜文字面板", F75: "回车换行", F76: "启动输入法剪贴板面板",
  F77: "懒人短语/筛选过程中切换过滤项", F78: "手写模式标志绘制区域", F79: "语音面板的语音控制按钮",
  F80: "语音自绘区", F81: "速成仓颉切换", F82: "搜索卡片", F83: "快速编辑",
  F84: "输入方式浮层", F85: "极简面板语种切换键",
  F86: "切换到普通游戏键盘", F87: "游戏键盘和谐语料", F88: "游戏键盘语料",
  F89: "符号快捷输入功能键", F90: "切换面板态符号面板", F91: "面板态符号面板首屏和更多屏互切",
  F92: "关闭联想状态", F93: "长按的符号", F94: "国际化输入空格键左滑",
  F95: "国际化输入空格键右滑", F96: "悬浮键盘", F97: "通知中心",
  F99: "快速编辑",
}

// These function codes mutate a skin state in-place instead of loading another layout.
// Keep this separate from page routing: the APK handles F91 as Global.n0[38] toggle.
const skinStateToggleActions: Record<string, number> = {
  F91: 38,
}

export const knownFunctionCodes = Object.keys(functionCodeDescriptions)

const skinStateDescriptions: Record<number, string> = {
  0: "零状态（空状态）",
  1: "英文首字母大写",
  2: "英文锁定大写",
  3: "英文联想状态",
  4: "有输入码状态",
  5: "中文更多候选字单字状态",
  6: "符号面板锁定",
  7: "翻页面板处于页顶",
  8: "翻页面板处于页底",
  9: "中文联想状态",
  10: "输入码中存在模糊输入",
  11: "输入码都是精确输入",
  12: "输入语言类型是英文",
  13: "有多媒体输入结果上屏",
  14: "中文下的临时英文输入状态",
  16: "表单不可跳转至下一项",
  17: "表单可以跳转至下一项",
  18: "表单不可提交",
  19: "表单可以提交",
  20: "搜索框不可进行搜索",
  21: "搜索框可以进行搜索",
  22: "页面跳转输入框不可跳转",
  23: "页面跳转输入框可以跳转",
  24: "特殊环境输入框不满足加入条件",
  25: "特殊环境输入框已满足加入条件",
  26: "输入框不满足发送条件",
  27: "输入框已满足发送条件",
  28: "解锁屏幕输入框",
  29: "密码输入框",
  30: "聊天框且无候选字和输入码",
  31: "iOS 输入框不满足换行条件",
  32: "语音面板点按模式倾听状态",
  33: "iOS 空格键二态",
  34: "长按语音关闭且无国际化语言",
  35: "速成仓颉状态",
  36: "长按语音开启且无国际化语言",
  37: "长按语音关闭且有国际化语言",
  38: "iPhone X 适配/Android 符号面板更多屏",
  39: "面板态符号更多屏",
  40: "英文面板的上个中文面板是五笔",
  41: "英文面板的上个中文面板是笔画",
  42: "英文面板的上个中文面板是手写",
  43: "英文面板的上个中文面板是仓颉",
  44: "英文面板的上个中文面板是注音",
  45: "英文面板的上个中文面板是拼音",
  46: "快捷符号展示状态",
  47: "候选字筛选状态",
  50: "和谐语料状态",
  51: "游戏语料状态",
  52: "iOS 面板态符号更多屏",
  53: "列表翻页处于页顶",
  54: "列表翻页处于页底",
  55: "符号页返回键处于删除状态",
  56: "Vivo 语音面板错误状态",
  63: "Pad 符号扩展页",
  67: "融合布局状态",
  94: "AI 输入返回键第一态",
  95: "AI 输入返回键第二态",
}

const MIN_SKIN_STATE = 0
const MAX_SKIN_STATE = 122
export const knownSkinStates = Array.from(
  { length: MAX_SKIN_STATE - MIN_SKIN_STATE + 1 },
  (_, index) => index + MIN_SKIN_STATE,
)

const skinStateFallbackTexts: Record<number, string> = {
  17: "下一项",
  21: "搜索",
  23: "前往",
  27: "发送",
}

export function skinStateFallbackText(state: number | undefined): string | undefined {
  return state === undefined ? undefined : skinStateFallbackTexts[state]
}

export function skinStateForcesComposition(state: number | undefined): boolean {
  return state === 4
}

export function skinStateLabel(state: number): string {
  const description = skinStateDescriptions[state]
  return description ? `S${state}（${description}）` : `S${state}`
}

export function actionDescription(value: string): string {
  if (!value) return "未设置"
  if (functionCodeDescriptions[value]) return functionCodeDescriptions[value]
  if (/^F\d+$/.test(value)) return `百度功能码 ${value}`
  const state = previewStateFromAction(value)
  if (state !== undefined) return `百度状态码 ${skinStateLabel(state)}`
  return ""
}

export function shouldSuggestActionCodes(value: string): boolean {
  return !value.trim() || /^F\d*$/i.test(value.trim())
}

export function previewStateFromAction(code: string): number | undefined {
  const match = code.trim().match(/^S(\d+)(?:_\d+)?$/)
  if (!match) return
  const state = Number(match[1])
  return state >= MIN_SKIN_STATE && state <= MAX_SKIN_STATE ? state : undefined
}

export function previewToggleStateFromAction(code: string): number | undefined {
  return skinStateToggleActions[code.trim().toUpperCase()]
}

/** Simulates actions whose native handler updates a boolean input-state bit. */
export function previewStateTransitionFromAction(code: string, currentState?: number): number | null | undefined {
  const value = code.trim().toUpperCase()
  if (value === "F10") return currentState === 1 ? null : 1
  if (value === "F11") return currentState === 2 ? null : 2
  if (value === "F25") return currentState === 3 ? null : 3
  if (value === "F27") return currentState === 6 ? null : 6
}

export function isConfiguredSymbolLayout(path: string, general: IniDocument | undefined): boolean {
  const current = path.split("/").pop()?.replace(/\.ini$/i, "").toLowerCase()
  const configured = (general?.get("MORE", "SYM_LAYOUT")?.trim() || "symbol")
    .replace(/\.ini$/i, "")
    .toLowerCase()
  return Boolean(current && current === configured)
}

function previewPageTarget(
  code: string,
  currentName: string,
  baseName = "py_9.ini",
  availableNames?: Iterable<string>,
  symbolLayout = "symbol",
): string | undefined {
  const value = code.trim()
  const available = availableNames ? new Map(
    [...availableNames].map((name) => [name.toLowerCase(), name]),
  ) : undefined
  const existing = (name: string): string | undefined => {
    const filename = name.replace(/\.ini$/i, "") + ".ini"
    return available ? available.get(filename.toLowerCase()) : filename
  }
  const firstMatching = (preferred: string[], pattern: RegExp): string | undefined => {
    for (const name of preferred) {
      const match = existing(name)
      if (match) return match
    }
    return available && [...available.values()].find((name) => pattern.test(name.replace(/\.ini$/i, "")))
  }
  const suffix = currentName.match(/(?:^|[_-])(9|14|26)(?:\.ini)?$/i)?.[1]
  const explicit = value.match(/^Z\+([A-Za-z0-9_-]+)$/)
  if (explicit) return existing(explicit[1])
  if (value === "F4" || value === "F15") return existing(baseName)
  if (value === "F6") return firstMatching(
    suffix ? [`num_${suffix}`] : ["num_9", "num_26"],
    /^(?:num|numbers?|numeric)(?:[_-]|$)/i,
  )
  if (value === "F1" || value === "F90") return firstMatching(
    [symbolLayout, "symbol", suffix ? `sym_${suffix}_cn` : ""].filter(Boolean),
    /^(?:sym|symbol)(?:[_-]|$)|(?:^|[_-])symbol(?:[_-]|$)/i,
  )
  // 英文输入状态固定进入 26 键英文面板，不跟随中文布局的 9/26 键后缀。
  if (value === "F16") return firstMatching(
    ["en_26", "en_9"],
    /^(?:en|english|letter|letters)(?:[_-]|$)/i,
  )
}

export function previewPageTransition(
  code: string,
  currentName: string,
  returnName: string,
  availableNames?: Iterable<string>,
  symbolLayout = "symbol",
): { target: string | undefined; returnName: string } {
  const value = code.trim()
  const requestedTarget = previewPageTarget(
    value,
    currentName,
    returnName,
    availableNames,
    symbolLayout,
  )
  const returnsToOrigin =
    value === "F4" ||
    value === "F15" ||
    ((value === "F6" || value === "F16") &&
      requestedTarget?.toLowerCase() === currentName.toLowerCase())
  const enteringTransientPage =
    !returnsToOrigin && Boolean(requestedTarget)
  const nextReturnName = enteringTransientPage ? currentName : returnName
  return {
    target: returnsToOrigin
      ? previewPageTarget(value, currentName, nextReturnName, availableNames, symbolLayout)
      : requestedTarget,
    returnName: returnsToOrigin ? returnName : nextReturnName,
  }
}

