// 搜狗 INI 段的字段层：把一个段读成「五态图片 + 颜色 + 文字 + 图标 + 引用」。
//
// 这里不碰模型，只回答「这个段写了什么」。图片引用、状态名与未建模字段的划分都在这一层定，
// 模型层与写回层共用同一份字段语义，避免两边各认一套。
import type { IniDocument } from "@/ini.ts"
import { parseSsfImage, ssfColor, type SsfImageRef } from "@/ssf/ssf-package.ts"
import type { UnitRect } from "@/skin-model/types.ts"

/** 搜狗图片字段固定的五个状态。 */
export const SSF_STATES = ["NORMAL", "PRESSED", "DISABLED", "NORMAL_ON", "PRESSED_ON"] as const
export type SsfState = (typeof SSF_STATES)[number]

/**
 * 五态对应的状态轴编码（`pressed|enabled|on`，未知轴写 `*`）。
 *
 * `NORMAL`/`PRESSED` 落在按键背景层的 `style`/`pressed` 上，其余三态落在 `Key.states`。
 * `DISABLED` 只有一份，格式没有 `DISABLED_ON`，所以它不指定开关在哪一侧——这是格式缺字段，
 * 不是「禁用优先」，因此写 `*` 而不是硬填一个布尔。
 */
export const STATE_AXES: Readonly<Record<SsfState, string>> = {
  NORMAL: "0|1|0",
  PRESSED: "1|1|0",
  DISABLED: "*|0|*",
  NORMAL_ON: "0|1|1",
  PRESSED_ON: "1|1|1",
}

/** 状态轴编码 → 搜狗字段名；写回时用它把 `Key.states` 还原成字段。 */
export function stateOfAxes(axes: string): SsfState | undefined {
  const entry = (Object.entries(STATE_AXES) as Array<[SsfState, string]>).find(([, value]) => value === axes)
  return entry?.[0]
}

/** 建模的字段；其余字段原样留在 `opaque`，不猜语义。 */
const MODELED = new Set([
  "NORMAL", "PRESSED", "DISABLED", "NORMAL_ON", "PRESSED_ON",
  "BG_STYLE", "BG_IMAGE", "BG_IMAGES", "BG_COLOR",
  "FG_IMAGES", "FG_RECT",
  "TEXT_COLOR", "TEXT_COLOR_PRESSED", "TEXT_SIZE", "TYPEFACE",
  "ICON", "ICON_PRESSED", "ANIM_STYLE", "LABEL", "LABEL_POSITION", "LABEL_STYLE",
  "L_KEY",
])

/** 一个段里读出来的全部内容；`extra` 是没建模的字段，按原样保留。 */
export type SsfSection = {
  section: string
  images: Partial<Record<SsfState, SsfImageRef>>
  backgroundStyle: boolean
  background?: string
  /** 背景引用写在哪个字段里：`BG_IMAGE` 与 `BG_IMAGES` 在样本里各有使用，写回沿用原字段名。 */
  backgroundField?: "BG_IMAGE" | "BG_IMAGES"
  foreground?: string
  foregroundRect?: UnitRect
  color?: string
  textColor?: string
  textColorPressed?: string
  textSize?: number
  typeface?: string
  icon?: SsfImageRef
  iconPressed?: SsfImageRef
  label?: string
  labelStyle?: string
  labelPosition?: readonly number[]
  anim?: string
  /** 长按弹出的字符；`L_KEY` 的值形如 `Key_Q,0`。 */
  longPress?: string
  extra: ReadonlyMap<string, string>
}

/** `0,0.104,1,0.896` → 归一化矩形；四个数都必须是有限数。 */
export function unitRectOf(value: string | undefined): UnitRect | undefined {
  const numbers = value?.split(",").map((part) => Number(part.trim())) ?? []
  if (numbers.length !== 4 || !numbers.every(Number.isFinite)) return
  const [left, top, right, bottom] = numbers
  return { left, top, right, bottom }
}

/** `0.3,0.3,0.7,0.7` 这类按键内定位；值不是数字时按原样丢掉。 */
export function numberListOf(value: string | undefined): number[] | undefined {
  const numbers = value?.split(",").map((part) => Number(part.trim())) ?? []
  return numbers.length && numbers.every(Number.isFinite) ? numbers : undefined
}

/**
 * 读一个段。段不存在时返回 undefined。
 *
 * 搜狗把同一个按键拆在两个文件里（`phoneSkin.ini` 写背景，`keys.ini` 写前景），
 * 两边的段名可能相同；字段按文件顺序取第一个出现的值，不能整段二选一，否则前景会丢。
 */
export function readSection(documents: IniDocument | readonly IniDocument[], section: string): SsfSection | undefined {
  const all = Array.isArray(documents) ? documents : [documents as IniDocument]
  const present = all.filter((document) => document.hasSection(section))
  if (!present.length) return
  const read = (field: string): string | undefined => {
    for (const document of present) {
      const value = document.get(section, field)?.trim()
      if (value) return value
    }
    return
  }
  const images: Partial<Record<SsfState, SsfImageRef>> = {}
  for (const state of SSF_STATES) {
    const image = parseSsfImage(read(state))
    if (image) images[state] = image
  }
  const extra = new Map<string, string>()
  for (const document of present) {
    for (const entry of document.entries(section)) {
      if (!MODELED.has(entry.key.toUpperCase())) extra.set(entry.key, entry.value)
    }
  }
  return {
    section,
    images,
    backgroundStyle: read("BG_STYLE") === "2",
    ...(read("BG_IMAGE") ? { background: read("BG_IMAGE"), backgroundField: "BG_IMAGE" as const } : read("BG_IMAGES") ? { background: read("BG_IMAGES"), backgroundField: "BG_IMAGES" as const } : {}),
    ...(read("FG_IMAGES") ? { foreground: read("FG_IMAGES") } : {}),
    ...(unitRectOf(read("FG_RECT")) ? { foregroundRect: unitRectOf(read("FG_RECT")) } : {}),
    ...(ssfColor(read("BG_COLOR")) ? { color: ssfColor(read("BG_COLOR")) } : {}),
    ...(ssfColor(read("TEXT_COLOR")) ? { textColor: ssfColor(read("TEXT_COLOR")) } : {}),
    ...(ssfColor(read("TEXT_COLOR_PRESSED")) ? { textColorPressed: ssfColor(read("TEXT_COLOR_PRESSED")) } : {}),
    ...(read("TEXT_SIZE") && Number.isFinite(Number(read("TEXT_SIZE"))) ? { textSize: Number(read("TEXT_SIZE")) } : {}),
    ...(read("TYPEFACE") ? { typeface: read("TYPEFACE") } : {}),
    ...(parseSsfImage(read("ICON")) ? { icon: parseSsfImage(read("ICON")) } : {}),
    ...(parseSsfImage(read("ICON_PRESSED")) ? { iconPressed: parseSsfImage(read("ICON_PRESSED")) } : {}),
    ...(read("LABEL") ? { label: read("LABEL") } : {}),
    ...(read("LABEL_STYLE") ? { labelStyle: read("LABEL_STYLE") } : {}),
    ...(numberListOf(read("LABEL_POSITION")) ? { labelPosition: numberListOf(read("LABEL_POSITION")) } : {}),
    ...(read("ANIM_STYLE") ? { anim: read("ANIM_STYLE") } : {}),
    ...(read("L_KEY") ? { longPress: read("L_KEY") } : {}),
    extra,
  }
}

/**
 * `BG_IMAGE` 的值可能是同文件里的段名，也可能是图片文件，必须先查段表再落到资源路径。
 * 带图片扩展名的按文件处理；其余按段名处理。
 */
export function referenceOf(value: string | undefined): { section?: string; file?: string } | undefined {
  const name = value?.trim()
  if (!name) return
  return /\.(png|webp|jpe?g)$/i.test(name) ? { file: name } : { section: name }
}

/** 有的段把图片直接写在引用字段里（`BG_IMAGES=foo.png`），这里给出两种情况下的图片名。 */
export function imageNameOf(value: string | undefined): string | undefined {
  return parseSsfImage(value)?.file
}

/** 一个段自己的图片字段里有没有 `state` 的图。 */
export function imageOf(section: SsfSection | undefined, state: SsfState): SsfImageRef | undefined {
  return section?.images[state]
}

/**
 * 样式名里的段名：`ssf:<时段>/<段名>[|<前景段>][#<字段>|@<状态>]`。
 *
 * 样式表是池，键只持有引用。段名进样式名是必要的：写回时要把字段放回原来的段，
 * 而页面/时段的组合同样要能从引用上还原，否则导出的 INI 会张冠李戴。
 */
export const STYLE_PREFIX = "ssf:"

/** 段本身（`NORMAL` 或组件字段）的样式名。 */
export function sectionStyleName(status: string, section: string): string {
  return `${STYLE_PREFIX}${status}/${section}`
}

/** 段的某个图片状态的样式名；`NORMAL` 也有，供写回按字段还原。 */
export function stateStyleName(status: string, section: string, state: SsfState): string {
  return `${sectionStyleName(status, section)}#${state}`
}

/** 按键某个状态把背景段与前景段合成一层的样式名；没有前景段时右侧留空。 */
export function compositeStyleName(status: string, background: string, foreground: string | undefined, state: SsfState): string {
  return `${STYLE_PREFIX}${status}/${background}|${foreground ?? ""}#${state}`
}

/** 段里一个非图片字段的样式名（`ICON`、`TEXT_COLOR`）。 */
export function fieldStyleName(status: string, section: string, field: string): string {
  return `${sectionStyleName(status, section)}@${field}`
}

export type StyleName = {
  status: string
  section: string
  foreground?: string
  state?: SsfState
  field?: string
}

/** 样式名拆回段名、时段与状态；不是本格式写的样式返回 undefined。 */
export function parseStyleName(name: string): StyleName | undefined {
  if (!name.startsWith(STYLE_PREFIX)) return
  const body = name.slice(STYLE_PREFIX.length)
  const slash = body.indexOf("/")
  if (slash < 0) return
  const status = body.slice(0, slash)
  let rest = body.slice(slash + 1)
  const stateAt = rest.lastIndexOf("#")
  const fieldAt = rest.lastIndexOf("@")
  let state: SsfState | undefined
  let field: string | undefined
  if (stateAt > 0) {
    const value = rest.slice(stateAt + 1)
    if ((SSF_STATES as readonly string[]).includes(value)) {
      state = value as SsfState
      rest = rest.slice(0, stateAt)
    }
  } else if (fieldAt > 0) {
    field = rest.slice(fieldAt + 1)
    rest = rest.slice(0, fieldAt)
  }
  const pipe = rest.indexOf("|")
  const section = pipe >= 0 ? rest.slice(0, pipe) : rest
  const foreground = pipe >= 0 ? rest.slice(pipe + 1) : undefined
  if (!section) return
  return { status, section, ...(foreground !== undefined ? { foreground } : {}), ...(state ? { state } : {}), ...(field ? { field } : {}) }
}
