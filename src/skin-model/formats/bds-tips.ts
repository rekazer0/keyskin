// 百度皮肤的提示键（`[TIPn]`）读写。
//
// 一个按键在不同「皮肤状态」下可以换成另一套样式与动作，写法是
// `[KEY1] STAT_STYLE=S11_4|S12_5`：状态组 11 用 TIP4，状态组 12 用 TIP5。
// IR 里把它记成按键的状态覆盖，`state` 保留 `S11` 这样的组名，便于原样写回。
import { numbersOf } from "@/ini.ts"
import type { IniDocument } from "@/ini.ts"
import type { KeyEvent, SkinAction } from "@/skin-model/types.ts"
import type { KeyStateOverride, TipBody } from "@/skin-model/key.ts"

/** 一条 `STAT_STYLE` 条目：状态组与提示段编号。 */
export type TipRef = { state: string; section: number }

const ENTRY = /(?:^|\|)\s*(S\d+)_(\d+)\s*(?=\||$)/g

/** `S11_4|S12_5` → 两条引用；写法不合法时返回空数组。 */
export function tipsOf(statStyle: string | undefined): TipRef[] {
  const refs: TipRef[] = []
  for (const match of statStyle?.matchAll(ENTRY) ?? []) {
    refs.push({ state: match[1], section: Number(match[2]) })
  }
  return refs
}

/** 引用写回 `STAT_STYLE`；空列表返回 undefined，表示这个按键没有状态覆盖。 */
export function statStyleOf(refs: readonly TipRef[]): string | undefined {
  return refs.length ? refs.map((ref) => `${ref.state}_${ref.section}`).join("|") : undefined
}

export type TipReadOptions = {
  /** 把位置类型与前景偏移换算成布局字段，由调用方决定是否需要。 */
  actionOf: (value: string | undefined) => SkinAction | undefined
}

/** `[TIPn]` 段里的动作字段，事件与字段一一对应。 */
const ACTION_FIELDS: ReadonlyArray<{ event: KeyEvent; field: string }> = [
  { event: "press", field: "CENTER" },
  { event: "long-press", field: "HOLD" },
  { event: "swipe-up", field: "UP" },
  { event: "swipe-down", field: "DOWN" },
  { event: "swipe-left", field: "LEFT" },
  { event: "swipe-right", field: "RIGHT" },
]

/** 一个 `[TIPn]` 段 → 段内容；段不存在或没有内容时返回 undefined。 */
export function tipBodyOf(document: IniDocument, section: number, options: TipReadOptions): TipBody | undefined {
  const name = `TIP${section}`
  if (!document.sections().includes(name)) return
  const read = (field: string): string | undefined => document.get(name, field)?.trim() || undefined
  // 状态有自己的整套动作，和按键一样按事件拆。
  const actions: NonNullable<TipBody["actions"]> = {}
  for (const { event, field } of ACTION_FIELDS) {
    const action = options.actionOf(read(field))
    if (action) actions[event] = action
  }
  const back = read("BACK_STYLE")
  const pressed = read("HL_BACK_STYLE")
  const fore = read("FORE_STYLE")
  const text = read("SHOW")
  const position = read("POS_TYPE")?.split(",").map((token) => Number(token.trim())).filter((each) => Number.isFinite(each))
  const holdSymbol = read("HOLDSYM")
  const info = read("INFO")
  const viewRect = numbersOf(read("VIEW_RECT"))
  const body: TipBody = {
    ...(position?.length ? { labelPosition: position } : {}),
    ...(holdSymbol ? { holdSymbol } : {}),
    ...(info ? { info } : {}),
    ...(viewRect.length === 4
      ? { viewRect: { position: { x: viewRect[0], y: viewRect[1] }, size: { width: viewRect[2], height: viewRect[3] } } }
      : {}),
    ...(Object.keys(actions).length ? { actions } : {}),
    ...(back || pressed || fore || text
      ? {
        style: {
          ...(back ? { back } : {}),
          ...(pressed ? { pressedBack: pressed } : {}),
          ...(fore ? { fore: fore.split(",").map((item) => item.trim()).filter(Boolean) } : {}),
          ...(text ? { text } : {}),
        },
      }
      : {}),
  }
  return Object.keys(body).length ? body : undefined
}

/** 板上所有 `[TIPn]` 段；有引用的和没引用的都在，段号是键。 */
export function tipPoolOf(document: IniDocument, options: TipReadOptions): Map<number, TipBody> {
  const pool = new Map<number, TipBody>()
  for (const section of document.sections()) {
    const match = /^TIP(\d+)$/i.exec(section)
    if (!match) continue
    const body = tipBodyOf(document, Number(match[1]), options)
    if (body) pool.set(Number(match[1]), body)
  }
  return pool
}

/** 按键引用的状态覆盖；段不在板上时跳过。 */
export function tipOverridesOf(document: IniDocument, statStyle: string | undefined, options: TipReadOptions): KeyStateOverride[] {
  return tipsOf(statStyle).flatMap((ref) => {
    const body = tipBodyOf(document, ref.section, options)
    return body ? [{ ...body, state: ref.state, section: ref.section }] : []
  })
}

/** 状态覆盖 → 提示段编号；同一个状态组下只保留第一条。 */
export function tipRefsOf(overrides: readonly KeyStateOverride[] | undefined): TipRef[] {
  const seen = new Set<string>()
  const refs: TipRef[] = []
  overrides?.forEach((override, index) => {
    if (!/^S\d+$/.test(override.state) || seen.has(override.state)) return
    seen.add(override.state)
    refs.push({ state: override.state, section: override.section ?? index + 1 })
  })
  return refs
}

/** 一个状态覆盖写成 `[TIPn]` 段的行；没有可写内容时返回空数组。 */
export function tipLines(override: TipBody, section: number, actionValue: (action: SkinAction | undefined) => string | undefined): string[] {
  const lines = [`[TIP${section}]`]
  const style = override.style
  if (style?.back) lines.push(`BACK_STYLE=${style.back}`)
  if (style?.pressedBack) lines.push(`HL_BACK_STYLE=${style.pressedBack}`)
  if (style?.fore?.length) lines.push(`FORE_STYLE=${style.fore.join(",")}`)
  if (style?.text) lines.push(`SHOW=${style.text}`)
  if (override.labelPosition?.length) lines.push(`POS_TYPE=${override.labelPosition.join(",")}`)
  if (override.holdSymbol) lines.push(`HOLDSYM=${override.holdSymbol}`)
  if (override.info) lines.push(`INFO=${override.info}`)
  if (override.viewRect) {
    const box = override.viewRect
    lines.push(`VIEW_RECT=${box.position.x},${box.position.y},${box.size.width},${box.size.height}`)
  }
  // 状态自己的整套动作也要写回，不只按下。
  for (const { event, field } of ACTION_FIELDS) {
    const value = actionValue(override.actions?.[event])
    if (value !== undefined) lines.push(`${field}=${value}`)
  }
  return lines.length > 1 ? [...lines, ""] : []
}
