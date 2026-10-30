/*
 * 把动效设计 / 粒子设计里选中的动画应用到按键或整个键盘（BDI/BDS）：按键和面板通过布局里的
 * ANIM_STYLE / BACK_ANIM_STYLE / FORE_ANIM_STYLE 引用动画样式，动画样式的 PRESS_ANIM / RELEASE_ANIM /
 * SHOW_ANIM / HIDE_ANIM 再指向动画。应用时在按键原来的动画样式上只换选中时机那一项（其他时机保留），
 * 已有一模一样的样式就复用，没有就在样式表里新建；样式表和布局记为一步撤销。
 */
import { IniDocument } from "../ini.ts"
import type { AnimationUse } from "../animation-inspector.ts"
import type { LegacyAnimationEntry } from "../legacy-animation.ts"
import type { PreviewItem } from "../preview-items.ts"
import type { KeyApply } from "./animation-resource"
import { effectiveKeySection, styleConfigPath } from "./config-context"
import { commitTextChanges, isEditing } from "./edit-history"
import { requestEditMode } from "./mobile-layout"
import { appState } from "./state"

type LayoutAnimationField = "ANIM_STYLE" | "BACK_ANIM_STYLE" | "FORE_ANIM_STYLE"

const TRIGGERS: Array<[string, string]> = [["PRESS_ANIM", "按下"], ["RELEASE_ANIM", "抬起"], ["SHOW_ANIM", "显示"], ["HIDE_ANIM", "隐藏"]]
const PARTS: Array<[LayoutAnimationField, string]> = [["ANIM_STYLE", "整个按键"], ["BACK_ANIM_STYLE", "背景"], ["FORE_ANIM_STYLE", "前景"]]
/** 上次选的时机和部位，换动画、换按键后保留。 */
const choice = { trigger: "PRESS_ANIM", part: "ANIM_STYLE" as LayoutAnimationField }

const styleFields = (styles: IniDocument, styleID: string) =>
  styles.entries(`STYLE${styleID}`).filter((entry) => entry.key !== "INFO" && entry.value.trim())

/** 样式 `base`（可无）把 `trigger` 换成 `id` 后的样式编号：已有内容一样的样式就复用，否则新建。 */
function styleWith(styles: IniDocument, base: string | undefined, trigger: string, id: string): string {
  const fields = new Map(base ? styleFields(styles, base).map((entry) => [entry.key, entry.value.trim()]) : [])
  fields.set(trigger, id)
  const ids = styles.sections().flatMap((section) => section.match(/^STYLE(\d+)$/)?.[1] ?? [])
  const existing = ids.find((styleID) => {
    const entries = styleFields(styles, styleID)
    return entries.length === fields.size && entries.every((entry) => fields.get(entry.key) === entry.value.trim())
  })
  if (existing) return existing
  const styleID = String(Math.max(0, ...ids.map(Number)) + 1)
  const label = TRIGGERS.find(([field]) => field === trigger)?.[1] ?? trigger
  styles.appendSection(`STYLE${styleID}`, [
    { key: "INFO", value: `${label}播放动画 ${id}${base && ids.includes(base) ? `（基于样式 ${base}）` : ""}` },
    ...[...fields].map(([key, value]) => ({ key, value })),
  ])
  if (Number(styles.get("GLOBAL", "STYLE_NUM") ?? -1) < Number(styleID)) styles.set("GLOBAL", "STYLE_NUM", styleID)
  return styleID
}

/** 每个目标（布局段 + 它现在的动画样式）的 `field` 改成在 `trigger` 时机播放 `entry` 的样式。 */
function apply(entry: LegacyAnimationEntry, targets: Array<{ section: string; current?: string }>, field: LayoutAnimationField, trigger: string): void {
  if (!appState.archive || !appState.layoutPath || entry.index === undefined) return
  const stylePath = styleConfigPath()
  const stylesBefore = appState.archive.isText(stylePath) ? appState.archive.getText(stylePath) : ""
  const styles = IniDocument.parse(stylesBefore)
  const before = appState.archive.getText(appState.layoutPath)
  const layout = IniDocument.parse(before)
  for (const { section, current } of targets) {
    // shortcut: 字段里写了多个样式（3,4）时只在第一个上改，遇到真实需求再逐个合并。
    const base = current?.split(",")[0].trim()
    const styleID = styleWith(styles, base && /^\d+$/.test(base) ? base : undefined, trigger, String(entry.index))
    if (!layout.set(section, field, styleID) && !layout.sections().includes(section)) layout.appendSection(section, [{ key: field, value: styleID }])
  }
  const stylesAfter = styles.toString()
  commitTextChanges([
    ...stylesAfter === stylesBefore ? [] : [{ path: stylePath, before: stylesBefore, after: stylesAfter }],
    { path: appState.layoutPath, before, after: layout.toString() },
  ])
}

const currentStyle = (key: PreviewItem, field: LayoutAnimationField) =>
  field === "ANIM_STYLE" ? key.animStyle : field === "BACK_ANIM_STYLE" ? key.backAnimStyle : key.foreAnimStyles[0]

/** 「应用到按键」：选时机（按下、抬起、显示、隐藏）和部位（整个按键、背景、前景），应用到画布上选中的按键。 */
export function legacyKeyApply(entry: LegacyAnimationEntry): KeyApply {
  return {
    choices: [
      { label: "播放时机", options: TRIGGERS, value: choice.trigger, change: (value) => { choice.trigger = value } },
      { label: "应用部位", options: PARTS, value: choice.part, change: (value) => { choice.part = value as LayoutAnimationField } },
    ],
    run: (keys) => apply(entry, keys.map((key) => ({ section: effectiveKeySection(key.section), current: currentStyle(key, choice.part) })), choice.part, choice.trigger),
  }
}

/** 粒子可以作为整个键盘的全景动效（面板的 ANIM_STYLE）。 */
export function legacyPanelUse(entry: LegacyAnimationEntry, styles: ReadonlySet<string>): AnimationUse[] {
  if (entry.kind !== "particle") return []
  const current = appState.layoutDocument?.get("PANEL", "ANIM_STYLE")?.trim() ?? ""
  if (current && styles.has(current)) return [{ icon: "layout-panel-top", title: "整个键盘", detail: `面板的 ANIM_STYLE=${current}（全景动效）` }]
  return [{
    icon: "layout-panel-top", title: "应用到整个键盘", detail: current ? `替换面板现在的 ANIM_STYLE=${current}` : "面板的 ANIM_STYLE（全景动效）",
    targets: [{
      label: "整个键盘", title: "应用到整个键盘",
      open: () => isEditing() ? apply(entry, [{ section: "PANEL" }], "ANIM_STYLE", "PRESS_ANIM") : requestEditMode(),
    }],
  }]
}
