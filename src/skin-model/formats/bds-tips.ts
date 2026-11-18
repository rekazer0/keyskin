// 百度皮肤的提示键（`[TIPn]`）读写。
//
// 一个按键在不同「皮肤状态」下可以换成另一套样式与动作，写法是
// `[KEY1] STAT_STYLE=S11_4|S12_5`：状态组 11 用 TIP4，状态组 12 用 TIP5。
// IR 里把它记成按键的状态覆盖，`state` 保留 `S11` 这样的组名，便于原样写回。
import type { IniDocument } from "@/ini.ts"
import type { SkinAction } from "@/skin-model/types.ts"
import type { KeyStateOverride } from "@/skin-model/key.ts"

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

/** 一个 `[TIPn]` 段 → 状态覆盖；段不存在时返回 undefined。 */
function overrideOf(document: IniDocument, ref: TipRef, options: TipReadOptions): KeyStateOverride | undefined {
  const section = `TIP${ref.section}`
  if (!document.sections().includes(section)) return
  const read = (name: string): string | undefined => document.get(section, name)?.trim() || undefined
  const action = options.actionOf(read("CENTER"))
  const back = read("BACK_STYLE")
  const pressed = read("HL_BACK_STYLE")
  const fore = read("FORE_STYLE")
  const text = read("SHOW")
  return {
    state: ref.state,
    ...(action ? { actions: { press: action } } : {}),
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
}

/** 按键的提示键状态覆盖；没有任何 `[TIPn]` 段时返回空数组。 */
export function tipOverridesOf(document: IniDocument, statStyle: string | undefined, options: TipReadOptions): KeyStateOverride[] {
  return tipsOf(statStyle).flatMap((ref) => {
    const override = overrideOf(document, ref, options)
    return override ? [override] : []
  })
}

/** 状态覆盖 → 提示段编号；同一个状态组下只保留第一条。 */
export function tipRefsOf(overrides: readonly KeyStateOverride[] | undefined): TipRef[] {
  const seen = new Set<string>()
  const refs: TipRef[] = []
  overrides?.forEach((override, index) => {
    if (!/^S\d+$/.test(override.state) || seen.has(override.state)) return
    seen.add(override.state)
    refs.push({ state: override.state, section: index + 1 })
  })
  return refs
}

/** 一个状态覆盖写成 `[TIPn]` 段的行；没有可写内容时返回空数组。 */
export function tipLines(override: KeyStateOverride, section: number, actionValue: (action: SkinAction | undefined) => string | undefined): string[] {
  const lines = [`[TIP${section}]`]
  const style = override.style
  if (style?.back) lines.push(`BACK_STYLE=${style.back}`)
  if (style?.pressedBack) lines.push(`HL_BACK_STYLE=${style.pressedBack}`)
  if (style?.fore?.length) lines.push(`FORE_STYLE=${style.fore.join(",")}`)
  if (style?.text) lines.push(`SHOW=${style.text}`)
  const action = actionValue(override.actions?.press)
  if (action) lines.push(`CENTER=${action}`)
  return lines.length > 1 ? [...lines, ""] : []
}
