// Palm board identifiers (`SkinBoardType.rawValue`) mirrored from PalmSkin.
type PalmBoardType = string

const BOARD_CODES: Record<string, PalmBoardType> = {
  "*.cnd": "candidateBar",
  "*.pop": "bubbleLayout",
  gen: "defaultGlobal",
  bh: "stroke",
  def_9: "t9Default",
  def_26: "full26Default",
  def_26_new: "full26DefaultNoSwipe",
  en_9: "t9EnglishLower",
  en_9s: "t9EnglishUpper",
  en_26: "full26EnglishLower",
  en_26_new: "full26EnglishLowerNoSwipe",
  en_26s: "full26EnglishUpper",
  en_26s_new: "full26EnglishUpperNoSwipe",
  py_9: "t9Pinyin",
  py_14: "full14Pinyin",
  py_18: "full18Pinyin",
  py_26: "full26Pinyin",
  py_26_new: "full26PinyinNoSwipe",
  hw_grid: "handwritingGrid",
  hw_full: "handwritingFull",
  num_9: "t9Number",
  num_26: "full26Number",
  net: "net",
  net_shift: "netShift",
  dial: "dial",
  voice: "voice",
  symbol: "symbol",
  symbol_hw: "symbolHandwriting",
  sel_ch: "selChinese",
  sel_en: "selEnglish",
  sel_hw: "selHandwriting",
  chtmp: "tempUpperCaseChinese",
  chtmp_pad: "tempUpperCaseChinesePad",
  bh_pad: "strokePad",
  def_9_pad: "wubi9Pad",
  py_9_pad: "pinyin9Pad",
  en_9_pad: "english9Pad",
  en_9s_pad: "english9UpperPad",
  email: "emailIOS",
  email_shift: "emailShiftIOS",
  url: "urlIOS",
  url_shift: "urlShiftIOS",
  password: "passwordIOS",
  message_num: "messageNumber",
  cj: "cangjie",
  zy: "zhuyin",
  "*_h": "switchPanel",
  logo: "logo",
  emoji: "emoji",
  num_symbol_en26: "numSymbolEn26",
  en_26_num: "en26WithNumbers",
  en_26s_num: "en26UpperWithNumbers",
  email_num: "emailWithNumbers",
  email_num_shifts: "emailUpperWithNumbers",
  net_num: "netWithNumbers",
  net_num_shifts: "netUpperWithNumbers",
  num_symbol_cn26_pad: "numSymbolCn26Pad",
  num_symbol_cn26_pad_h: "numSymbolCn26PadHigh",
  num_symbol_en26_pad: "numSymbolEn26Pad",
  num_symbol_en26_pad_h: "numSymbolEn26PadHigh",
  py_26_top_num: "full26PinyinTopNumbers",
  en_26_top_num: "full26EnglishLowerTopNumbers",
  en_26s_top_num: "full26EnglishUpperTopNumbers",
  def_26_top_num: "full26DefaultTopNumbers",
  py_18_equal: "full18PinyinEqual",
}

export function boardTypeFromIniCode(code: string): PalmBoardType | undefined {
  return BOARD_CODES[code]
}

export function iniCodeFromBoardType(type: PalmBoardType): string | undefined {
  return Object.keys(BOARD_CODES).find((code) => !code.includes("*") && BOARD_CODES[code] === type)
}

export function boardTypeFromIniFileName(fileName: string): PalmBoardType | undefined {
  return boardTypeFromIniCode(fileName.replace(/\.ini/g, ""))
}
