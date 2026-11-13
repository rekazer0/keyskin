import { parseXmlPlist } from "./palm/palm-plist.ts"
import { asObject } from "./palm/sxi-ini.ts"

// 百度 iOS 菜单功能 ID；名称和顺序与当前客户端一致，不依赖皮肤可改写的标题或图片名。
const FUNCTIONS = [
  ["17", "键盘类型", "toolbarMenuItem_KBSwitch_Normal", "keyboard"],
  ["18", "移动光标", "toolbarMenuItem_MoveCursor_Normal", "arrow-left-right"],
  ["19", "表情", "toolbarMenuItem_Emoji_Normal", "smile"],
  ["26", "AI搜索", "toolbarMenuItem_Search_Normal", "search"],
  ["0", "皮肤壁纸", "toolbarMenuItem_SkinShop_Normal", "shirt"],
  ["25", "键盘字体", "toolbarMenuItem_FontManageMent_Theme_Nijigen", "type"],
  ["55", "次遇", "toolbarMenuItem_ciyu_Normal", "smile-plus"],
  ["35", "剪贴板", "toolbarMenuItem_pasteBoard_Normal", "clipboard-paste"],
  ["20", "灵感语录", "toolbarMenuItem_LazyManMode_Normal", "lightbulb"],
  ["27", "快捷翻译", "toolbarMenuItem_Translation_Normal", "message-square-quote"],
  ["45", "超会写", "toolbarMenuItem_AITalking_Normal", "user-round"],
  ["37", "神句配图", "toolbarMenuItem_AIDoutu_Normal", "images"],
  ["43", "文字扫描", "toolbarMenuItem_TextScanning_Normal", "scan-line"],
  ["23", "语音输入", "toolbarMenuItem_Voice_Normal", "mic"],
  ["5", "音效与振动", "toolbarMenuItem_Sound_Normal", "volume-2"],
  ["32", "游戏键盘", "toolbarMenuItem_function_panel_Normal", "gamepad-2"],
  ["44", "多语言设置", "toolbarMenuItem_MultilingualSettings_Normal", "globe"],
  ["7", "切换繁体", "toolbarMenuItem_TraditionalCh_Normal", "case-upper"],
  ["14", "键盘手写", "toolbarMenuItem_KBHandWrite_Normal", "pen-line"],
  ["9", "调整高度", "toolbarMenuItem_AdjustHeight_Normal", "arrow-up-down"],
  ["10", "单手模式", "toolbarMenuItem_SingleHandMode_Normal", "hand"],
  ["6", "夜间模式", "toolbarMenuItem_NightMode_Normal", "moon"],
  ["13", "特技字体", "toolbarMenuItem_SuperWord_Normal", "wand-sparkles"],
  ["21", "Emoji密语", "toolbarMenuItem_EmojiTranslation_Normal", "message-square-more"],
  ["33", "语音速记", "toolbarMenuItem_Minute_Normal", "audio-lines"],
  ["15", "滑行输入", "toolbarMenuItem_SwipInput_Normal", "spline"],
  ["24", "同步", "toolbarMenuItem_BackUp_Normal", "rotate-cw"],
  ["2", "详细设置", "toolbarMenuItem_Settings_Normal", "settings"],
  ["36", "定制工具栏", "toolbar_show_custom_menu_Normal", "list"],
] as const

const IMAGE_ALIASES: Record<string, string> = {
  toolbarMenuItem_OCR_Normal: "43", toolbarMenuItem_LanguageSwitch_Normal: "44", toolbarMenuItem_Language_Normal: "44",
  toolbarMenuItem_AIKankan_Normal: "45", toolbarMenuItem_Keywrite_Normal: "14",
}

type BdiMenuIcon = { id: string; path: string; label: string; icon: string; position: string }

function menuEntries(bytes?: Uint8Array): BdiMenuIcon[] {
  const plist = bytes && parseXmlPlist(bytes)
  return (Array.isArray(plist) ? plist : []).map(asObject)
    .filter((item) => item?.Position === "toolbar" || item?.Position === "menu")
    .map((item) => {
      const image = asObject(asObject(item?.Images)?.Normal)?.Normal
      const path = typeof image === "string" ? image.trim().replace(/^\/+/, "").replace(/\.png$/i, "") : ""
      const name = path.split("/").pop()?.replace(/(?:_iphone)?@3x$/i, "") ?? ""
      const rawID = String(item?.Name ?? "").trim()
      const id = /^\d+$/.test(rawID) ? rawID : FUNCTIONS.find((entry) => entry[2] === name)?.[0] || IMAGE_ALIASES[name] || ""
      const known = FUNCTIONS.find((entry) => entry[0] === id)
      return { id, path, label: known?.[1] ?? `功能 ${id}`, icon: known?.[3] ?? "component", position: String(item?.Position) }
    }).filter((item) => item.id)
}

/** 检查器列全量菜单；名称只按客户端功能 ID 识别，不猜测皮肤标题的编码。 */
export function bdiMenuIcons(bytes?: Uint8Array): BdiMenuIcon[] {
  const entries = menuEntries(bytes)
  const result: BdiMenuIcon[] = FUNCTIONS.map(([id, label, name, icon], index) => {
    const entry = entries.find((item) => item.id === id)
    return { id, label, icon, path: entry?.path || `1.0/${name}`, position: entry?.position ?? (index < 4 ? "toolbar" : "menu") }
  })
  for (const entry of entries) {
    if (result.some((item) => item.id === entry.id)) continue
    result.push(entry)
  }
  return result
}

/** 有 toolbar 声明时保持原顺序；只有菜单时优先预览常用功能，手机端顺序由用户设置决定。 */
export function bdiToolbarIcons(bytes?: Uint8Array): BdiMenuIcon[] {
  const entries = menuEntries(bytes)
  const toolbar = entries.filter((item) => item.position === "toolbar")
  if (toolbar.length) return toolbar.slice(0, 4)
  // shortcut: 无工具栏声明时用已有菜单取图；真实功能列表需读取手机端设置。
  const common = FUNCTIONS.slice(0, 4).flatMap(([id]) => entries.find((item) => item.id === id) ?? [])
  return [...common, ...entries].filter((item, index, items) => items.findIndex((entry) => entry.id === item.id) === index).slice(0, 4)
}
