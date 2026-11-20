// IR 动效的关键帧编辑。
//
// 读取走 `MotionNode.track.keyframes`：面板显示的是中间表示里的关键帧，不是格式字段的副本。
// 写入先经 `setKeyframe` 落到模型，再把同一个值写回 anim.ini 的 FROM / TO，
// 文档与模型因此保持一致——不靠「改文档后让模型作废重建」来间接同步。
import { appState } from "./state"
import { skinModel } from "./skin-model-state"
import { commitText, isEditing, updateDirty } from "./edit-history"
import { legacyAnimationConfigPath, setSourceValue } from "./config-context"
import { refreshPreview } from "./preview-render"
import { populateKeyInspector } from "./key-inspector"
import { field, section } from "./property-rows"
import { IniDocument } from "../ini.ts"
import { writeLegacyAnimationFields, type LegacyAnimationEntry } from "../legacy-animation.ts"
import { firstTrackOf, setKeyframe } from "@/skin-model/motion-edit.ts"
import type { SkinModel } from "@/skin-model/model.ts"

/** 这个动画在 IR 里的第一个属性轨道；帧序列、组合与不透明节点没有可编辑关键帧。 */
function trackOfModel(sectionId: string) {
  const model = skinModel.model
  const node = model?.motions.get(sectionId)
  const track = node ? firstTrackOf(node) : undefined
  return model && track?.node.kind === "track" ? { model, track } : undefined
}

/** anim.ini 的一个字段改动提交：文档与模型一起换，模型不再作废重建。 */
function commitAnimationField(sectionId: string, key: string, value: string, model: SkinModel): void {
  const path = legacyAnimationConfigPath()
  const archive = appState.archive
  const before = path && archive ? archive.getText(path) ?? appState.selectedDocument?.toString() : appState.selectedDocument?.toString()
  if (!path || !before) return
  const after = writeLegacyAnimationFields(before, sectionId, { [key]: value })
  if (before === after) return
  appState.selectedDocument = IniDocument.parse(after)
  commitText(path, before, after, false, model)
  setSourceValue(after)
  refreshPreview()
  updateDirty()
  populateKeyInspector()
}

/**
 * 关键帧的起点与终点各自落在 anim.ini 的 FROM / TO 上。
 * 值可能是 `x,y` 或 `rand(a,b)`：只改第一个分量，其余保持原样，避免把双轴或区间压成单值。
 */
function commitEdge(sectionId: string, index: number, text: string, end: boolean): void {
  if (!isEditing()) return
  const value = Number(text)
  if (!Number.isFinite(value)) return
  const found = trackOfModel(sectionId)
  if (!found) return
  const next = setKeyframe(found.model, sectionId, found.track.path, index, { value })
  if (next === found.model) return
  const key = end ? "TO" : "FROM"
  const current = edgeValueOf(sectionId, key)
  const parts = (current ?? "0").split(",").map((part) => part.trim())
  parts[0] = String(Math.round(value))
  commitAnimationField(sectionId, key, parts.join(","), next)
}

/** 从当前 anim.ini 文本里取某个动画段的字段值。 */
function edgeValueOf(sectionId: string, key: string): string | undefined {
  const text = appState.selectedDocument?.toString()
  if (!text) return undefined
  return text.match(new RegExp(`^\\[${sectionId}\\]$[\\s\\S]*?^${key}=(.*)$`, "mi"))?.[1]?.trim()
}

/**
 * 「关键帧」分组：把 IR 里的关键帧显示成可编辑的参数行。
 * 只有首尾两个关键帧能落回 anim.ini 的 FROM / TO；中间帧属于格式表达能力之外，只读展示。
 */
export function irKeyframeSection(entry: LegacyAnimationEntry): HTMLElement | undefined {
  const found = trackOfModel(entry.section)
  if (!found) return undefined
  const keyframes = found.track.node.kind === "track" ? found.track.node.keyframes : []
  if (!keyframes.length) return undefined
  const rows: HTMLElement[] = []
  keyframes.forEach((frame, index) => {
    const end = index === keyframes.length - 1
    const editable = index === 0 || end
    // 中间帧写不回 anim.ini：给只读行，避免面板上改了值却在保存时丢掉。
    rows.push(field({
      key: `ir.frame.${index}.value`,
      label: `关键帧 ${index + 1} · ${editable ? (index === 0 ? "起始值" : "终止值") : "中间值"}`,
      spec: editable
        ? { kind: "number" as const, value: String(Math.round(frame.value)), expression: true }
        : { kind: "text" as const, value: String(Math.round(frame.value)) },
      rowKey: [appState.selectedPath, entry.section, `ir.${index}`],
      editable: editable && isEditing(),
      ...(editable ? { commit: (value: string) => commitEdge(entry.section, index, value, end) } : {}),
    }))
    rows.push(field({
      key: `ir.frame.${index}.time`,
      label: `关键帧 ${index + 1} · 时间`,
      spec: { kind: "text", value: `${frame.time} ms` },
      rowKey: [appState.selectedPath, entry.section, `ir.${index}.time`],
      editable: false,
    }))
  })
  const target = found.track.node.kind === "track"
    ? `${found.track.node.target.subject}${found.track.node.target.name ? `:${found.track.node.target.name}` : ""} · ${found.track.node.target.property}`
    : ""
  return section("关键帧（中间表示）", rows, {
    className: "document-property-section",
    code: `${target} · ${keyframes.length} 帧`,
  })
}
