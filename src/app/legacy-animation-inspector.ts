/*
 * 旧版百度（BDI/BDS）anim.ini 的可视化属性检查器（DESIGN.md §10）。
 * 继承器只负责呈现与写回：解析、类型清理、时间轴和引用关系都在 src/legacy-animation.ts 里，
 * 每次编辑通过 commitText 写回一个撤销步骤，画布与顶部示意预览立即刷新。
 */
import "../legacy-animation.css"
import { IniDocument } from "../ini.ts"
import { element } from "../dom-element.ts"
import { createIcon } from "../icons"
import { parseLegacyParticleEmitter } from "../preview-animation.ts"
import {
  LEGACY_ANIMATION_KINDS,
  LEGACY_ANIMATION_FIELDS,
  LEGACY_ANIMATION_KIND_ICONS,
  LEGACY_ANIMATION_TIMELINE_KEYS,
  LEGACY_ANIMATION_INTPOL_OPTIONS,
  legacyAnimationFieldGroups,
  legacyAnimationKindLabel,
  legacyAnimationReferenceText,
  legacyAnimationReferences,
  legacyAnimationTimeline,
  legacyAnimationTypeLabel,
  legacyAnimationTypeOptions,
  legacyAnimationValueParts,
  parseLegacyAnimationFile,
  writeLegacyAnimationFields,
  writeLegacyAnimationKind,
  writeLegacyAnimationType,
  type LegacyAnimationDocument,
  type LegacyAnimationEntry,
  type LegacyAnimationKind,
  type LegacyAnimationReference,
} from "../legacy-animation.ts"
import { legacyAnimationPreviewBlock } from "../legacy-animation-preview.ts"
import { preview } from "./canvas-interaction"
import { setSourceValue, styleConfigPath } from "./config-context"
import { commitText, isEditing, updateDirty } from "./edit-history"
import { syncMobileInspectorGroups } from "./mobile-layout"
import { refreshPreview } from "./preview-render"
import { appState } from "./state"

/* —— 选中对象与文档 —— */
function isLegacyAnimationDocument(): boolean {
  const format = appState.archive?.format
  return Boolean(appState.selectedDocument) && (format === "bdi" || format === "bds") && /(^|\/)anim\.ini$/i.test(appState.selectedPath)
}

function styleDocument(): IniDocument | undefined {
  const archive = appState.archive
  const path = styleConfigPath()
  if (!archive?.isText(path)) return undefined
  return IniDocument.parse(archive.getText(path))
}

function layoutDocument(): IniDocument | undefined {
  if (appState.layoutDocument) return appState.layoutDocument
  const archive = appState.archive
  if (!archive?.isText(appState.layoutPath)) return undefined
  return IniDocument.parse(archive.getText(appState.layoutPath))
}

function indexEntries(model: LegacyAnimationDocument): Map<string, LegacyAnimationEntry> {
  return new Map(model.entries.flatMap((entry) => entry.index === undefined ? [] : [[String(entry.index), entry] as const]))
}

function fieldValue(entry: LegacyAnimationEntry, key: string): string | undefined {
  return entry.fields.find(([name]) => name === key)?.[1]
}

/* —— 写回：一次编辑 = 一个撤销步骤 —— */
type EditOptions = { rebuild?: boolean; refresh?: () => void }

function edit(container: HTMLElement, update: (text: string) => string, options: EditOptions = {}): void {
  if (!isEditing() || !appState.selectedDocument) return
  const before = appState.selectedDocument.toString()
  const after = update(before)
  if (before === after) return
  appState.selectedDocument = IniDocument.parse(after)
  commitText(appState.selectedPath, before, after)
  // 检查器与源码面板共用同一个文档：写回后同步源码与画布。
  setSourceValue(after)
  refreshPreview()
  updateDirty()
  if (options.rebuild) {
    populateLegacyAnimationInspector(container)
    syncMobileInspectorGroups()
  } else {
    options.refresh?.()
  }
}

/* —— 分组与属性行 —— */
function sectionShell(title: string, code: string, icon: string): { section: HTMLElement; body: HTMLElement } {
  const section = element("section", "ui-section document-property-section legacy-animation-section")
  section.dataset.inspectorGroupLabel = title
  const heading = element("h3", "document-section-heading")
  const titleNode = element("span", "document-section-title")
  titleNode.textContent = title
  const codeNode = element("span", "document-section-code")
  codeNode.textContent = code
  heading.append(createIcon(icon, 14), titleNode, codeNode)
  const body = element("div", "legacy-animation-body")
  section.append(heading, body)
  return { section, body }
}

function fieldRow(section: string, key: string, label: string, control: HTMLElement): HTMLElement {
  const row = element("label", "ui-field legacy-animation-field")
  row.dataset.documentKey = key
  row.dataset.inspectorRowKey = JSON.stringify([appState.selectedPath, section, key])
  const caption = element("span", "document-field-caption")
  caption.textContent = label
  caption.title = `${label}（${key}）`
  row.append(caption, control)
  return row
}

const NUMBER_VALUE = /^-?\d+(?:\.\d+)?$/
const RANDOM_VALUE = /^rand\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)$/i

function validAnimationValue(value: string): boolean {
  return NUMBER_VALUE.test(value) || RANDOM_VALUE.test(value)
}

function inputControl(
  value: string | undefined,
  label: string,
  commit: (value: string | undefined) => void,
  { numeric = true, unit, step, placeholder = "未设置" }: { numeric?: boolean; unit?: string; step?: string; placeholder?: string } = {},
): HTMLElement {
  const wrap = element("span", "ui-input")
  const input = element("input")
  input.type = numeric ? "number" : "text"
  input.value = value ?? ""
  input.placeholder = placeholder
  input.disabled = !isEditing()
  input.setAttribute("aria-label", label)
  if (numeric) input.step = step ?? "any"
  if (unit) {
    const affix = element("span", "ui-input-affix")
    affix.textContent = unit
    wrap.append(affix)
  }
  input.addEventListener("change", () => {
    const text = input.value.trim()
    if (text && numeric && !validAnimationValue(text)) {
      input.value = value ?? ""
      return
    }
    commit(text || undefined)
  })
  wrap.append(input)
  return wrap
}

/** 单值输入：手册允许 FROM/TO 写成 rand(a,b)，所以用文本输入而不是 number。 */
function valueControl(value: string | undefined, label: string, commit: (value: string | undefined) => void, unit?: string): HTMLElement {
  const wrap = element("span", "ui-input")
  const input = element("input")
  input.type = "text"
  input.inputMode = "decimal"
  input.value = value ?? ""
  input.placeholder = "未设置"
  input.disabled = !isEditing()
  input.setAttribute("aria-label", label)
  input.addEventListener("change", () => {
    const text = input.value.trim()
    if (text && !validAnimationValue(text)) {
      input.value = value ?? ""
      return
    }
    commit(text || undefined)
  })
  if (unit) {
    const affix = element("span", "ui-input-affix")
    affix.textContent = unit
    wrap.append(affix)
  }
  wrap.append(input)
  return wrap
}

function pairControl(
  value: string | undefined,
  label: string,
  parts: readonly string[],
  commit: (value: string | undefined) => void,
  { unit, step }: { unit?: string; step?: string } = {},
): HTMLElement {
  const values = value ? legacyAnimationValueParts(value) : []
  const wrap = element("span", `legacy-animation-pair legacy-animation-${parts.length}`)
  const inputs = parts.map((part, index) => {
    const box = element("span", "ui-input")
    const affix = element("span", "ui-input-affix")
    affix.textContent = part
    const input = element("input")
    input.type = "text"
    input.inputMode = "decimal"
    input.value = values[index] ?? ""
    input.placeholder = part
    input.step = step ?? "any"
    input.disabled = !isEditing()
    input.setAttribute("aria-label", `${label}${part}`)
    box.append(affix, input)
    wrap.append(box)
    return input
  })
  const write = () => {
    const next = inputs.map((input) => input.value.trim())
    if (next.every((text) => !text)) {
      commit(undefined)
      return
    }
    if (next.some((text) => text && !validAnimationValue(text))) {
      inputs.forEach((input, index) => { input.value = values[index] ?? "" })
      return
    }
    commit(next.map((text) => text || "0").join(","))
  }
  for (const input of inputs) input.addEventListener("change", write)
  if (unit) {
    const suffix = element("span", "ui-input-affix")
    suffix.textContent = unit
    wrap.append(suffix)
  }
  return wrap
}

function selectControl(
  value: string | undefined,
  label: string,
  options: ReadonlyArray<readonly [string, string]>,
  commit: (value: string | undefined) => void,
  optional = false,
): HTMLElement {
  const wrap = element("span", "ui-input ui-select")
  const select = element("select")
  select.disabled = !isEditing()
  select.setAttribute("aria-label", label)
  const choices: Array<readonly [string, string]> = optional ? [["", "未设置"] as const, ...options] : [...options]
  if (value !== undefined && !choices.some(([option]) => option === value)) choices.push([value, `${value}（当前）`])
  for (const [option, text] of choices) select.append(new Option(text, option))
  select.value = value ?? (optional ? "" : choices[0]?.[0] ?? "")
  select.addEventListener("change", () => commit(select.value === "" ? undefined : select.value))
  wrap.append(select)
  return wrap
}

function switchControl(value: string | undefined, label: string, commit: (value: string | undefined) => void): HTMLElement {
  const input = element("input", "ui-switch")
  input.type = "checkbox"
  input.setAttribute("role", "switch")
  input.checked = value?.trim() === "1"
  input.disabled = !isEditing()
  input.setAttribute("aria-label", label)
  input.addEventListener("change", () => commit(input.checked ? "1" : "0"))
  return input
}

/* —— 基础动效的数值字段：FROM/TO 的写法跟 TYPE 走 —— */
function basicValueLabel(entry: LegacyAnimationEntry, key: string): string {
  const prefix = key === "FROM" ? "起始" : "终止"
  switch (entry.type ?? 0) {
    case 0: return `${prefix}透明度`
    case 1: return `${prefix}角度`
    case 2: return `${prefix}位置`
    case 3:
    case 4: return `${prefix}缩放`
    default: return `${prefix}3D 角度`
  }
}

function basicValueControl(entry: LegacyAnimationEntry, key: string, value: string | undefined, commit: (value: string | undefined) => void): HTMLElement {
  const label = basicValueLabel(entry, key)
  switch (entry.type ?? 0) {
    case 0: return valueControl(value, label, commit, "0–255")
    case 1: return valueControl(value, label, commit, "°")
    case 5: return pairControl(value, label, ["X", "Y", "Z"], commit, { unit: "°" })
    default: return pairControl(value, label, ["X", "Y"], commit, { unit: "%" })
  }
}

function intpolControl(entry: LegacyAnimationEntry, value: string | undefined, commit: (value: string | undefined) => void): HTMLElement {
  const values = legacyAnimationValueParts(value ?? "0")
  const count = entry.kind === "basic" && [2, 3, 4].includes(entry.type ?? 0) ? 2 : 1
  if (count === 1) return selectControl(values[0] ?? "0", "插值器", LEGACY_ANIMATION_INTPOL_OPTIONS, (next) => commit(next ?? "0"))
  const wrap = element("span", "legacy-animation-pair legacy-animation-2")
  const selects = ["X", "Y"].map((axis, index) => {
    const box = element("span", "ui-input ui-select")
    const select = element("select")
    select.disabled = !isEditing()
    select.setAttribute("aria-label", `插值器${axis}`)
    for (const [option, text] of LEGACY_ANIMATION_INTPOL_OPTIONS) select.append(new Option(`${axis} · ${text}`, option))
    select.value = values[index] ?? values[0] ?? "0"
    box.append(select)
    wrap.append(box)
    return select
  })
  const write = () => commit(selects.map((select) => select.value).join(","))
  for (const select of selects) select.addEventListener("change", write)
  return wrap
}

function fieldControl(container: HTMLElement, entry: LegacyAnimationEntry, key: string, refresh: () => void): HTMLElement {
  const value = fieldValue(entry, key)
  const spec = LEGACY_ANIMATION_FIELDS[key]
  const commit = (next: string | undefined, rebuild = false) => {
    if (!isEditing()) return
    edit(container, (text) => {
      if (key === "BUILD_LIST") {
        const count = (next ?? "").split(",").map((part) => part.trim()).filter(Boolean).length
        return writeLegacyAnimationFields(text, entry.section, { BUILD_LIST: next, BUILD_NUM: String(count) })
      }
      return writeLegacyAnimationFields(text, entry.section, { [key]: next })
    }, { rebuild: rebuild || entry.kind === "particle", refresh })
  }
  if (key === "INTPOL") return intpolControl(entry, value, (next) => commit(next))
  if (key === "FROM" || key === "TO") {
    return basicValueControl(entry, key, value, (next) => commit(next))
  }
  if (!spec) return inputControl(value, key, (next) => commit(next), { numeric: false })
  if (spec.kind === "number") return inputControl(value, spec.label, (next) => commit(next, LEGACY_ANIMATION_TIMELINE_KEYS.includes(key)), { unit: spec.unit, step: spec.step })
  if (spec.kind === "text") return inputControl(value, spec.label, (next) => commit(next, LEGACY_ANIMATION_TIMELINE_KEYS.includes(key)), { numeric: false })
  if (spec.kind === "select") return selectControl(value, spec.label, spec.options ?? [], (next) => commit(next, LEGACY_ANIMATION_TIMELINE_KEYS.includes(key)), spec.optional)
  if (spec.kind === "switch") return switchControl(value, spec.label, (next) => commit(next))
  const parts = spec.kind === "quad"
    ? ["左", "上", "右", "下"]
    : spec.kind === "triple" ? ["X", "Y", "Z"]
      : spec.kind === "pair" && /PIVOT|_PX$/.test(key) ? ["X", "Y"] : ["最小", "最大"]
  const rebuild = LEGACY_ANIMATION_TIMELINE_KEYS.includes(key)
  return pairControl(value, spec.label, parts, (next) => commit(next, rebuild), { unit: spec.unit, step: spec.step })
}

/* —— 时间轴条 —— */
function timelineElement(entry: LegacyAnimationEntry, byIndex: ReadonlyMap<string, LegacyAnimationEntry>): HTMLElement {
  const timeline = legacyAnimationTimeline(entry, byIndex)
  const root = element("div", "legacy-animation-timeline")
  root.setAttribute("aria-label", `${entry.section} 时间轴`)
  const header = element("div", "legacy-animation-timeline-header")
  const title = element("span", "legacy-animation-timeline-title")
  title.textContent = "时间轴"
  const detail = element("span", "legacy-animation-timeline-detail")
  if (entry.kind === "frame") detail.textContent = "按 gif 自身时长播放"
  else if (timeline.repeat === 0) detail.textContent = "无限重复"
  else detail.textContent = [timeline.delay > 0 ? `延迟 ${timeline.delay} ms` : "", `持续 ${timeline.duration} ms`].filter(Boolean).join(" · ")
  header.append(createIcon("timer", 14), title, detail)
  const track = element("div", "legacy-animation-timeline-track")
  if (entry.kind === "basic" || entry.kind === "combination") {
    if (timeline.delay > 0) {
      const delay = element("span", "legacy-animation-timeline-delay")
      delay.textContent = `${timeline.delay} ms`
      delay.style.flexGrow = String(timeline.delay)
      track.append(delay)
    }
    const active = element("span", "legacy-animation-timeline-active")
    active.textContent = entry.kind === "combination"
      ? `${legacyAnimationKindLabel(entry.kind)}（${fieldValue(entry, "BUILD_METHOD") === "0" ? "同时" : "接续"}）`
      : legacyAnimationTypeLabel(entry.kind, entry.type)
    active.style.flexGrow = String(Math.max(timeline.duration, 1))
    track.append(active)
  } else {
    const active = element("span", "legacy-animation-timeline-active")
    active.textContent = legacyAnimationKindLabel(entry.kind)
    active.style.flexGrow = "1"
    track.append(active)
  }
  const chips = element("div", "legacy-animation-chips")
  const chip = (text: string) => Object.assign(element("span", "ui-badge"), { textContent: text })
  chips.append(...[
    entry.kind !== "frame" ? chip(timeline.repeat === 0 ? "无限重复" : `重复 ${timeline.repeat} 次`) : null,
    timeline.reverse ? chip("自动往返") : null,
    timeline.remove ? chip("结束移除") : null,
    timeline.total === Infinity ? null : chip(`总计 ${timeline.total} ms`),
  ].filter((node): node is HTMLElement => Boolean(node)))
  root.append(header, track, chips)
  return root
}

/* —— 组合动效的子动效说明 —— */
function combinationSummary(entry: LegacyAnimationEntry, byIndex: ReadonlyMap<string, LegacyAnimationEntry>): HTMLElement {
  const ids = (fieldValue(entry, "BUILD_LIST") ?? "").split(",").map((part) => part.trim()).filter(Boolean)
  const missing = ids.filter((id) => !byIndex.has(String(Number(id))))
  const children = ids.flatMap((id) => {
    const child = byIndex.get(String(Number(id)))
    return child ? [child] : []
  })
  const nonBasic = children.filter((child) => child.kind !== "basic")
  const note = element("p", missing.length || nonBasic.length ? "legacy-animation-warning" : "inspector-group-subtitle")
  if (missing.length) {
    note.textContent = `找不到子动效 ${missing.map((id) => `ANIM${id}`).join("、")}；组合动效只支持引用基础动效。`
  } else if (nonBasic.length) {
    note.textContent = `组合动效只支持基础动效，${nonBasic.map((child) => child.section).join("、")} 不会被播放。`
  } else if (children.length) {
    note.textContent = children
      .map((child) => `${child.section}（${legacyAnimationTypeLabel(child.kind, child.type)}）`)
      .join(" · ")
  } else {
    note.textContent = "BUILD_LIST 为空：组合动效暂时不会播放。"
  }
  return note
}

/* —— 单个动效分组 —— */
function animationSection(
  container: HTMLElement,
  entry: LegacyAnimationEntry,
  byIndex: ReadonlyMap<string, LegacyAnimationEntry>,
  refresh: () => void,
): HTMLElement {
  const { section, body } = sectionShell(
    `动效 ${entry.index ?? entry.section}`,
    `${entry.section} · ${legacyAnimationKindLabel(entry.kind)}`,
    LEGACY_ANIMATION_KIND_ICONS[entry.kind],
  )
  const categoryValue = entry.category === undefined ? undefined : String(entry.category)
  if (categoryValue !== undefined && Number(categoryValue) !== kindCategory(entry.kind)) {
    const warning = element("p", "legacy-animation-warning")
    warning.textContent = `CATEGORY=${categoryValue} 与识别出的${legacyAnimationKindLabel(entry.kind)}不一致，已按内容编辑；切一次动效类型可写回一致的值。`
    body.append(warning)
  }
  const kindControl = selectControl(
    entry.kind,
    "动效类型",
    LEGACY_ANIMATION_KINDS.map(({ kind, label }) => [kind, label] as const),
    (next) => {
      if (!next || next === entry.kind) return
      edit(container, (text) => writeLegacyAnimationKind(text, entry.section, next as LegacyAnimationKind), { rebuild: true })
    },
  )
  body.append(fieldRow(entry.section, "CATEGORY", "动效类型", kindControl))
  if (entry.kind === "basic" || entry.kind === "particle") {
    const typeLabel = entry.kind === "particle" ? "粒子类型" : "动画类型"
    const typeControl = selectControl(
      entry.type === undefined ? undefined : String(entry.type),
      typeLabel,
      legacyAnimationTypeOptions(entry.kind).map(([value, label]) => [String(value), label] as const),
      (next) => {
        if (next === undefined) return
        edit(container, (text) => writeLegacyAnimationType(text, entry.section, Number(next)), { rebuild: true })
      },
    )
    body.append(fieldRow(entry.section, "TYPE", typeLabel, typeControl))
  }
  body.append(timelineElement(entry, byIndex))
  if (entry.kind === "particle") body.append(particlePreviewBar(entry))
  for (const group of legacyAnimationFieldGroups(entry)) {
    const block = element("div", "ui-subsection legacy-animation-block")
    const heading = element("h4")
    heading.textContent = group.title
    block.append(heading)
    const grid = element("div", "document-property-grid")
    for (const key of group.keys) {
      grid.append(fieldRow(entry.section, key, fieldLabel(entry, key), fieldControl(container, entry, key, refresh)))
    }
    block.append(grid)
    body.append(block)
  }
  if (entry.kind === "combination") body.append(combinationSummary(entry, byIndex))
  return section
}

function fieldLabel(entry: LegacyAnimationEntry, key: string): string {
  if (key === "FROM" || key === "TO") return basicValueLabel(entry, key)
  return LEGACY_ANIMATION_FIELDS[key]?.label ?? key
}

/** 手册第 180 页的 CATEGORY：0 基础 / 1 组合 / 2 帧 / 3 粒子。 */
function kindCategory(kind: LegacyAnimationKind): number {
  return kind === "basic" ? 0 : kind === "combination" ? 1 : kind === "frame" ? 2 : 3
}

/* —— 粒子动效：保留画布预览入口 —— */
function particlePreviewBar(entry: LegacyAnimationEntry): HTMLElement {
  const bar = element("div", "legacy-animation-particle-bar")
  const status = element("span")
  const button = element("button", "ui-button")
  button.type = "button"
  button.dataset.variant = "quiet"
  button.dataset.size = "sm"
  const render = () => {
    const active = appState.particlePreviewSection === entry.section
    status.textContent = active ? "正在键盘画布中预览" : "可在键盘画布中预览"
    button.textContent = active ? "重新播放" : "在画布预览"
    button.disabled = !isEditing() || !appState.selectedDocument
  }
  button.addEventListener("click", () => {
    if (!appState.selectedDocument) return
    appState.particlePreviewSection = entry.section
    preview.setParticlePreview(parseLegacyParticleEmitter(appState.selectedDocument, entry.section))
    render()
  })
  render()
  bar.append(status, button)
  return bar
}

/* —— 概览：数量、类型分布与 default.css / 布局的引用 —— */
function overviewSection(
  model: LegacyAnimationDocument,
  byIndex: ReadonlyMap<string, LegacyAnimationEntry>,
  references: readonly LegacyAnimationReference[],
  previewElement: HTMLElement,
): HTMLElement {
  const { section, body } = sectionShell("动画概览", `${model.entries.length} 个`, "wand-sparkles")
  body.append(previewElement)
  const summary = element("p", "inspector-group-subtitle")
  const declared = model.animNum === undefined ? "未声明" : String(model.animNum)
  summary.textContent = `共 ${model.entries.length} 个动效，[GLOBAL] ANIM_NUM=${declared}。类型按 CATEGORY 与内容自动识别。`
  body.append(summary)
  if (model.animNum !== undefined && model.animNum !== model.entries.length) {
    const warning = element("p", "legacy-animation-warning")
    warning.textContent = `ANIM_NUM=${model.animNum} 与实际的 ${model.entries.length} 个 [ANIM*] 不一致，写回任意字段时会自动修正。`
    body.append(warning)
  }
  const chips = element("div", "legacy-animation-chips")
  for (const { kind, label } of LEGACY_ANIMATION_KINDS) {
    const count = model.entries.filter((entry) => entry.kind === kind).length
    if (count) chips.append(Object.assign(element("span", "ui-badge"), { textContent: `${label} ${count}` }))
  }
  const inferred = model.entries.filter((entry) => entry.category === undefined).length
  if (inferred) chips.append(Object.assign(element("span", "ui-badge"), { textContent: `自动识别 ${inferred}` }))
  if (chips.childElementCount) body.append(chips)

  const block = element("div", "ui-subsection legacy-animation-block")
  const heading = element("h4")
  heading.textContent = `被引用的动效（${references.length} 处指针）`
  block.append(heading)
  const detail = element("p", "legacy-animation-reference-detail")
  detail.textContent = "引用来自 default.css 的 [STYLE*]；布局的 ANIM_STYLE 系列先指向样式，再由样式指向动效。"
  const grouped = new Map<number, LegacyAnimationReference[]>()
  for (const reference of references) {
    grouped.set(reference.animation, [...grouped.get(reference.animation) ?? [], reference])
  }
  const list = element("div", "legacy-animation-reference-list")
  for (const [animation, items] of [...grouped].sort(([left], [right]) => left - right)) {
    const entry = byIndex.get(String(animation))
    const button = element("button", "ui-list-item")
    button.type = "button"
    button.append(createIcon(entry ? LEGACY_ANIMATION_KIND_ICONS[entry.kind] : "circle-alert", 14))
    const text = element("span", "ui-list-item-text")
    const name = element("strong")
    name.textContent = `动效 ${animation}${entry ? ` · ${legacyAnimationKindLabel(entry.kind)}` : "（anim.ini 中不存在）"}`
    const meta = element("small")
    meta.textContent = `${items.length} 处引用 · ${items.map((item) => legacyAnimationReferenceText(item)).join("；")}`
    text.append(name, meta)
    button.append(text)
    button.addEventListener("click", () => {
      for (const other of list.querySelectorAll("button")) other.setAttribute("aria-pressed", "false")
      button.setAttribute("aria-pressed", "true")
      detail.textContent = items.map((item) =>
        `${item.layoutSection ? `布局 [${item.layoutSection}] ${item.layoutField}=${item.styleSection.replace(/^STYLE/i, "")} → ` : ""}default.css [${item.styleSection}] ${item.field}=${animation}`,
      ).join("；")
      if (!entry) detail.textContent += "（该动效在 anim.ini 中不存在）"
    })
    list.append(button)
  }
  if (grouped.size) block.append(list, detail)
  else block.append(Object.assign(element("p", "inspector-group-subtitle"), { textContent: "default.css 与当前布局都没有引用 anim.ini 的动效。" }))
  const unreferenced = model.entries.filter((entry) => entry.index !== undefined && !grouped.has(entry.index))
  if (unreferenced.length) {
    const note = element("p", "inspector-group-subtitle")
    note.textContent = `${unreferenced.length} 个动效没有被引用：${unreferenced.map((entry) => entry.section).join("、")}。`
    block.append(note)
  }
  body.append(block)
  return section
}

function syncParticlePreview(model: LegacyAnimationDocument): void {
  if (!appState.selectedDocument) return
  const particleSections = model.entries.filter((entry) => entry.kind === "particle").map((entry) => entry.section)
  if (!particleSections.includes(appState.particlePreviewSection)) appState.particlePreviewSection = particleSections[0] ?? ""
  preview.setParticlePreview(
    appState.particlePreviewSection
      ? parseLegacyParticleEmitter(appState.selectedDocument, appState.particlePreviewSection)
      : undefined,
  )
}

/* —— 对外入口 —— */
export function populateLegacyAnimationInspector(container: HTMLElement): boolean {
  if (!isLegacyAnimationDocument()) return false
  const model = parseLegacyAnimationFile(appState.selectedDocument!.toString())
  const byIndex = indexEntries(model)
  const previewBlock = legacyAnimationPreviewBlock(model, byIndex)
  container.replaceChildren(overviewSection(model, byIndex, legacyAnimationReferences(styleDocument(), layoutDocument()), previewBlock.element))
  for (const entry of model.entries) {
    container.append(animationSection(container, entry, byIndex, previewBlock.refresh))
  }
  syncParticlePreview(model)
  container.dataset.path = appState.selectedPath
  return true
}

/** 对象头：动画数量与文件位置。 */
export function legacyAnimationInspectorTitle(): { name: string; context: string } | undefined {
  if (!isLegacyAnimationDocument()) return undefined
  const model = parseLegacyAnimationFile(appState.selectedDocument!.toString())
  return { name: "按键动画", context: `${appState.selectedPath} · ${model.entries.length} 个动效` }
}
