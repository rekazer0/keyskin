/*
 * 旧版百度（BDI/BDS）anim.ini 的动画检查器（DESIGN.md §10「动画资源」）：资源配置里的「动效设计」与「粒子设计」
 * 共用这一份文件，按类型筛选。列表选中一个动效，下面是它的播放器、参数分组和被哪些样式引用。
 * 解析、类型清理、时间轴和引用关系都在 src/legacy-animation.ts；每次编辑通过 commitText 写回一个撤销步骤。
 */
import { IniDocument } from "../ini.ts"
import { element } from "../dom-element.ts"
import { iniPreviewClip } from "../animation-preview-model.ts"
import { animationPlayer } from "../animation-player.ts"
import {
  animationModeTitle, animationSection, animationWarning, comboList, imageCard, renderAnimationResource, sliderField,
  type AnimationListItem, type AnimationUse,
} from "../animation-inspector.ts"
import { decodeFrames } from "../native-motion.ts"
import { createIcon } from "../icons.ts"
import {
  LEGACY_ANIMATION_KINDS,
  LEGACY_ANIMATION_FIELDS,
  LEGACY_ANIMATION_INTPOL_OPTIONS,
  appendLegacyAnimation,
  legacyAnimationFieldGroups,
  legacyAnimationKindLabel,
  legacyAnimationReferences,
  legacyAnimationTimeline,
  legacyAnimationTypeLabel,
  legacyAnimationTypeOptions,
  legacyAnimationValueParts,
  parseLegacyAnimationFile,
  STYLE_ANIM_FIELDS,
  writeLegacyAnimationFields,
  writeLegacyAnimationKind,
  writeLegacyAnimationType,
  type LegacyAnimationEntry,
  type LegacyAnimationKind,
  type LegacyAnimationReference,
  type LegacyAnimationTimeline,
} from "../legacy-animation.ts"
import { visualResolver } from "./bda-documents"
import { preview } from "./canvas-interaction"
import { legacyAnimationConfigPath, setSourceValue, styleConfigPath } from "./config-context"
import { commitText, isEditing, updateDirty } from "./edit-history"
import { populateKeyInspector } from "./key-inspector"
import { refreshPreview } from "./preview-render"
import { keyAnimationItems, keyUses, keyPlaysStyle, keyboardPlayback, openAnimation, rememberAnimation, selectAnimation, selectedAnimation, shownInAnimationView } from "./animation-resource"
import { decorateStyleReferenceInput, openStyleReferenceEditor } from "./style-references"
import { appState } from "./state"
import { legacyKeyApply, legacyPanelUse } from "./legacy-animation-apply"
import type { PreviewItem } from "../preview-items.ts"

const SECTION = "document-property-section"
const KIND_ICONS: Record<LegacyAnimationKind, string> = { basic: "blend", combination: "layers", frame: "list-video", particle: "sparkles" }
const TYPE_ICONS = ["blend", "rotate-cw", "move", "scaling", "scaling", "rotate-3d"]
const EVENT_LABELS: Record<string, string> = {
  PRESS_ANIM: "按下", RELEASE_ANIM: "抬起", SHOW_ANIM: "显示", HIDE_ANIM: "隐藏", FIRST_PRESS_PANEL_ANIM: "面板首次按下",
}

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

function fieldValue(entry: LegacyAnimationEntry, key: string): string | undefined {
  return entry.fields.find(([name]) => name === key)?.[1]
}

/* —— 写回：一次编辑 = 一个撤销步骤，检查器、源码与画布一起刷新 —— */
function edit(update: (text: string) => string): void {
  if (!isEditing() || !appState.selectedDocument) return
  const before = appState.selectedDocument.toString()
  const after = update(before)
  if (before === after) return
  appState.selectedDocument = IniDocument.parse(after)
  commitText(appState.selectedPath, before, after)
  setSourceValue(after)
  refreshPreview()
  updateDirty()
  populateKeyInspector()
}

/* —— 属性行 —— */
function fieldRow(section: string, key: string, label: string, control: HTMLElement): HTMLElement {
  const row = element("label", "ui-field document-property-field")
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
  input.addEventListener("change", () => {
    const text = input.value.trim()
    if (text && numeric && !validAnimationValue(text)) {
      input.value = value ?? ""
      return
    }
    commit(text || undefined)
  })
  wrap.append(input)
  if (unit) wrap.append(Object.assign(element("span", "ui-input-affix"), { textContent: unit }))
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
  wrap.append(input)
  if (unit) wrap.append(Object.assign(element("span", "ui-input-affix"), { textContent: unit }))
  return wrap
}

function pairControl(
  value: string | undefined,
  label: string,
  parts: readonly string[],
  commit: (value: string | undefined) => void,
  step?: string,
): HTMLElement {
  const values = value ? legacyAnimationValueParts(value) : []
  const wrap = element("span", "ui-field-pair")
  if (parts.length > 2) wrap.dataset.columns = String(parts.length)
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
    case 2: return `${prefix}位置（%）`
    case 3:
    case 4: return `${prefix}缩放（%）`
    default: return `${prefix}3D 角度（°）`
  }
}

function basicValueControl(entry: LegacyAnimationEntry, key: string, value: string | undefined, commit: (value: string | undefined) => void): HTMLElement {
  const label = basicValueLabel(entry, key)
  switch (entry.type ?? 0) {
    case 0: return valueControl(value, label, commit, "0–255")
    case 1: return valueControl(value, label, commit, "°")
    case 5: return pairControl(value, label, ["X", "Y", "Z"], commit)
    default: return pairControl(value, label, ["X", "Y"], commit)
  }
}

function intpolControl(entry: LegacyAnimationEntry, value: string | undefined, commit: (value: string | undefined) => void): HTMLElement {
  const values = legacyAnimationValueParts(value ?? "0")
  const count = entry.kind === "basic" && [2, 3, 4].includes(entry.type ?? 0) ? 2 : 1
  if (count === 1) return selectControl(values[0] ?? "0", "插值器", LEGACY_ANIMATION_INTPOL_OPTIONS, (next) => commit(next ?? "0"))
  const wrap = element("span", "ui-field-pair")
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

/** Values with a natural range get a slider beside the number (DESIGN.md §10). */
const SLIDERS: Record<string, { min: number; max: number; step?: number }> = {
  DURATION: { min: 0, max: 2000, step: 10 },
  DELAY: { min: 0, max: 2000, step: 10 },
  TOTAL_NUMBER: { min: 1, max: 200 },
  BIRTH_RATE: { min: 0.1, max: 50, step: 0.1 },
}

function withSlider(control: HTMLElement, bounds: { min: number; max: number; step?: number }): HTMLElement {
  return sliderField(control, control.querySelector("input")!, bounds)
}

/** PARTICLE_IMAGE lists style IDs: a bare input that the style card decorates once it is in its row. */
function particleImageInput(value: string | undefined, commit: (value: string | undefined) => void): HTMLInputElement {
  const input = element("input")
  input.value = value ?? ""
  input.disabled = !isEditing()
  input.setAttribute("aria-label", "粒子图片样式")
  input.addEventListener("change", () => commit(input.value.trim() || undefined))
  return input
}

/** ANIM_PATH is a gif / webp / png next to anim.ini (or in res): a picture card with the files on offer. */
function animPathCard(value: string | undefined, commit: (value: string | undefined) => void): HTMLElement {
  const folder = appState.selectedPath.replace(/[^/]*$/, "")
  const files = element("datalist")
  files.id = "anim-path-files"
  for (const path of appState.archive?.names() ?? []) {
    if (path.startsWith(folder) && /\.(gif|webp|png)$/i.test(path)) files.append(new Option(path.slice(folder.length)))
  }
  const card = imageCard({
    label: "gif 路径",
    value: value ?? "",
    editable: isEditing(),
    placeholder: "选择或输入文件",
    list: files.id,
    load: () => {
      const bytes = value ? readSkinFile(value) : undefined
      return bytes && decodeFrames(bytes, /\.gif$/i.test(value!) ? "image/gif" : /\.png$/i.test(value!) ? "image/png" : "image/webp").then((frames) => frames[0]?.visual)
    },
    onChange: (next) => commit(next || undefined),
  })
  card.append(files)
  return card
}

function fieldControl(entry: LegacyAnimationEntry, key: string): HTMLElement {
  const value = fieldValue(entry, key)
  const spec = LEGACY_ANIMATION_FIELDS[key]
  const commit = (next: string | undefined) => edit((text) => writeLegacyAnimationFields(text, entry.section, { [key]: next }))
  if (key === "INTPOL") return intpolControl(entry, value, (next) => commit(next))
  if (key === "FROM" || key === "TO") {
    const control = basicValueControl(entry, key, value, (next) => commit(next))
    const type = entry.type ?? 0
    return type === 0 ? withSlider(control, { min: 0, max: 255 }) : type === 1 ? withSlider(control, { min: -360, max: 360 }) : control
  }
  if (key === "PARTICLE_IMAGE") return particleImageInput(value, commit)
  if (key === "ANIM_PATH") return animPathCard(value, commit)
  if (!spec) return inputControl(value, key, (next) => commit(next), { numeric: false })
  if (spec.kind === "number") {
    const control = inputControl(value, spec.label, (next) => commit(next), { unit: spec.unit, step: spec.step })
    return SLIDERS[key] ? withSlider(control, SLIDERS[key]) : control
  }
  if (spec.kind === "text") return inputControl(value, spec.label, (next) => commit(next), { numeric: false })
  if (spec.kind === "select") return selectControl(value, spec.label, spec.options ?? [], (next) => commit(next), spec.optional)
  if (spec.kind === "switch") return switchControl(value, spec.label, (next) => commit(next))
  const parts = spec.kind === "quad"
    ? ["左", "上", "右", "下"]
    : spec.kind === "triple" ? ["X", "Y", "Z"]
      : spec.kind === "pair" && /PIVOT|_PX$/.test(key) ? ["X", "Y"] : ["最小", "最大"]
  return pairControl(value, spec.label, parts, (next) => commit(next), spec.step)
}


function fieldLabel(entry: LegacyAnimationEntry, key: string): string {
  if (key === "FROM" || key === "TO") return basicValueLabel(entry, key)
  const spec = LEGACY_ANIMATION_FIELDS[key]
  if (!spec) return key
  return spec.unit && ["pair", "quad", "triple"].includes(spec.kind) ? `${spec.label}（${spec.unit}）` : spec.label
}

/** 手册第 180 页的 CATEGORY：0 基础 / 1 组合 / 2 帧 / 3 粒子。 */
function kindCategory(kind: LegacyAnimationKind): number {
  return kind === "basic" ? 0 : kind === "combination" ? 1 : kind === "frame" ? 2 : 3
}

/** 动效类型：动效设计里在基础 / 组合 / 帧之间切换，粒子设计只放粒子，原始文件视图四类都有。 */
function kindRow(entry: LegacyAnimationEntry): HTMLElement | undefined {
  const kinds = LEGACY_ANIMATION_KINDS.filter(({ kind }) => shownInAnimationView(kind === "particle"))
  if (kinds.length < 2) return
  const control = selectControl(entry.kind, "动效类型", kinds.map(({ kind, label }) => [kind, label] as const), (next) => {
    if (next && next !== entry.kind) edit((text) => writeLegacyAnimationKind(text, entry.section, next as LegacyAnimationKind))
  })
  return fieldRow(entry.section, "CATEGORY", "动效类型", control)
}

function typeRow(entry: LegacyAnimationEntry): HTMLElement {
  const label = entry.kind === "particle" ? "粒子类型" : "动画类型"
  const control = selectControl(
    entry.type === undefined ? undefined : String(entry.type),
    label,
    legacyAnimationTypeOptions(entry.kind).map(([value, text]) => [String(value), text] as const),
    (next) => { if (next !== undefined) edit((text) => writeLegacyAnimationType(text, entry.section, Number(next))) },
  )
  return fieldRow(entry.section, "TYPE", label, control)
}

/* —— 组合动效：子动效按播放顺序排成列表，增删排序写回 BUILD_LIST / BUILD_NUM —— */
function buildList(entry: LegacyAnimationEntry): string[] {
  return (fieldValue(entry, "BUILD_LIST") ?? "").split(",").map((part) => part.trim()).filter(Boolean)
}

function writeBuildList(entry: LegacyAnimationEntry, ids: string[]): void {
  edit((text) => writeLegacyAnimationFields(text, entry.section, { BUILD_LIST: ids.join(","), BUILD_NUM: String(ids.length) }))
}

function comboRows(entry: LegacyAnimationEntry, byIndex: ReadonlyMap<string, LegacyAnimationEntry>): HTMLElement[] {
  const ids = buildList(entry)
  const method = fieldValue(entry, "BUILD_METHOD")
  const methodRow = fieldRow(entry.section, "BUILD_METHOD", "组合方式",
    selectControl(method, "组合方式", LEGACY_ANIMATION_FIELDS.BUILD_METHOD.options ?? [], (next) =>
      edit((text) => writeLegacyAnimationFields(text, entry.section, { BUILD_METHOD: next }))))
  // 隐藏的 BUILD_LIST 行承载改动标记与重置；列表本身是下面的子动效编辑器。
  const listRow = fieldRow(entry.section, "BUILD_LIST", "子动效列表", inputControl(fieldValue(entry, "BUILD_LIST"), "子动效列表", (next) =>
    writeBuildList(entry, (next ?? "").split(",").map((part) => part.trim()).filter(Boolean)), { numeric: false }))
  listRow.hidden = true
  const basics = [...byIndex.values()].filter((child) => child.kind === "basic" && child.index !== undefined && child.section !== entry.section)
  return [methodRow, comboList({
    editable: isEditing(),
    empty: "还没有子动效；组合动效只能引用基础动效。",
    children: ids.map((id) => {
      const child = byIndex.get(String(Number(id)))
      if (!child) return { title: `动画 ${id}`, detail: "anim.ini 里没有这个动效，请移除", missing: true }
      if (child.kind !== "basic") return { title: `动画 ${id}`, detail: `${legacyAnimationKindLabel(child.kind)}不能放进组合，不会播放`, missing: true }
      return { title: `动画 ${id}`, detail: `${legacyAnimationTypeLabel(child.kind, child.type)} · ${timelineText(legacyAnimationTimeline(child, byIndex))}` }
    }),
    move: (index, offset) => {
      const next = [...ids]
      ;[next[index], next[index + offset]] = [next[index + offset], next[index]]
      writeBuildList(entry, next)
    },
    remove: (index) => writeBuildList(entry, ids.filter((_, position) => position !== index)),
    add: {
      options: basics.filter((child) => !ids.some((id) => Number(id) === child.index))
        .map((child) => [String(child.index), `动画 ${child.index} · ${legacyAnimationTypeLabel(child.kind, child.type)}`]),
      run: (id) => writeBuildList(entry, [...ids, id]),
    },
  }), listRow]
}

function parameterSections(entry: LegacyAnimationEntry, byIndex: ReadonlyMap<string, LegacyAnimationEntry>): HTMLElement[] {
  return legacyAnimationFieldGroups(entry).map((group, index) => {
    const section = animationSection(group.title, SECTION)
    if (index === 0) {
      const kind = kindRow(entry)
      if (kind) section.append(kind)
    }
    for (const key of group.keys) {
      if (key === "TYPE") section.append(typeRow(entry))
      else if (key === "BUILD_METHOD") section.append(...comboRows(entry, byIndex))
      else if (key === "BUILD_LIST" || key === "BUILD_NUM") continue
      else {
        const row = fieldRow(entry.section, key, fieldLabel(entry, key), fieldControl(entry, key))
        section.append(row)
        if (key === "PARTICLE_IMAGE") decorateStyleReferenceInput(row.querySelector("input")!, key)
        if (key === "ANIM_PATH") row.classList.add("style-reference-field")
      }
    }
    return section
  })
}

/* —— 列表与引用 —— */
function timelineText(timeline: LegacyAnimationTimeline): string {
  if (timeline.repeat === 0) return "循环"
  return [`${timeline.total} ms`, timeline.repeat > 1 ? `重复 ${timeline.repeat} 次` : "", timeline.reverse ? "往返" : ""].filter(Boolean).join(" · ")
}

function kindLabel(entry: LegacyAnimationEntry): string {
  if (entry.kind === "basic") return legacyAnimationTypeLabel(entry.kind, entry.type ?? 0)
  return entry.kind === "particle" ? "粒子" : entry.kind === "frame" ? "GIF 帧动画" : "组合"
}

function problem(entry: LegacyAnimationEntry, byIndex: ReadonlyMap<string, LegacyAnimationEntry>): string | undefined {
  if (entry.category !== undefined && entry.category !== kindCategory(entry.kind)) return `CATEGORY=${entry.category} 与${legacyAnimationKindLabel(entry.kind)}不一致`
  if (entry.kind === "combination" && buildList(entry).some((id) => byIndex.get(String(Number(id)))?.kind !== "basic")) return "组合里有找不到或不能播放的子动效"
  if (entry.kind === "frame" && !fieldValue(entry, "ANIM_PATH")) return "还没有设置 gif 路径"
  if (entry.kind === "particle" && !fieldValue(entry, "PARTICLE_IMAGE")) return "还没有设置粒子图片"
}

function listItem(entry: LegacyAnimationEntry, byIndex: ReadonlyMap<string, LegacyAnimationEntry>, uses: number): AnimationListItem {
  const timeline = legacyAnimationTimeline(entry, byIndex)
  const detail = entry.kind === "frame" ? fieldValue(entry, "ANIM_PATH") || "未设置 gif"
    : entry.kind === "particle" ? `${fieldValue(entry, "TOTAL_NUMBER") ?? "?"} 个粒子 · ${timelineText(timeline)}`
      : entry.kind === "combination" ? `${fieldValue(entry, "BUILD_METHOD") === "0" ? "同时" : "接续"} · ${buildList(entry).length} 个子动效 · ${timelineText(timeline)}`
        : timelineText(timeline)
  return {
    id: entry.section,
    title: `动画 ${entry.index ?? entry.section}`,
    kind: kindLabel(entry),
    icon: entry.kind === "basic" ? TYPE_ICONS[entry.type ?? 0] ?? "blend" : KIND_ICONS[entry.kind],
    detail,
    uses,
    problem: problem(entry, byIndex),
  }
}

/** default.css 的指针按事件归组；布局的 ANIM_STYLE 先指向样式，单独成行。 */
function uses(references: readonly LegacyAnimationReference[]): AnimationUse[] {
  const groups = new Map<string, LegacyAnimationReference[]>()
  for (const reference of references) {
    const key = reference.layoutField ? `${reference.layoutField}|${reference.field}` : reference.field
    groups.set(key, [...groups.get(key) ?? [], reference])
  }
  return [...groups.values()].map((items) => {
    const [first] = items
    const event = EVENT_LABELS[first.field] ?? first.field
    const names = [...new Set(items.map((item) => item.layoutSection ? `[${item.layoutSection}] → ${item.styleSection}` : item.styleSection))]
    const styles = [...new Set(items.map((item) => item.styleSection))]
    return {
      icon: first.layoutField ? "layout-grid" : "palette",
      title: first.layoutField ? `布局 ${first.layoutField} · ${event}` : `${event} · ${first.field}`,
      detail: `${names.length} 处：${names.slice(0, 6).join("、")}${names.length > 6 ? " 等" : ""}`,
      targets: styles.map((style) => ({ label: style, open: () => openStyleReferenceEditor(style.replace(/^STYLE/i, "")) })),
    }
  })
}

/** ANIM_PATH 相对 anim.ini 所在目录；找不到时再试皮肤的 res 目录。 */
function readSkinFile(path: string): Uint8Array | undefined {
  const archive = appState.archive
  if (!archive) return
  const folder = appState.selectedPath.replace(/[^/]*$/, "")
  const res = styleConfigPath().replace(/[^/]*$/, "")
  for (const candidate of [`${folder}${path}`, `${res}${path}`, path]) {
    const bytes = archive.getBytes(candidate.replace(/\/\.\//g, "/"))
    if (bytes) return bytes
  }
}

/** Styles whose PRESS_ANIM plays `entry`, directly or through a combination that lists it: the keyboard canvas plays these. */
function pressStyles(entry: LegacyAnimationEntry, entries: readonly LegacyAnimationEntry[], references: readonly LegacyAnimationReference[]): Set<string> {
  const players = new Set([entry.index, ...entries.filter((candidate) => candidate.kind === "combination"
    && buildList(candidate).some((id) => Number(id) === entry.index)).map((candidate) => candidate.index)])
  return new Set(references.filter((reference) => reference.field === "PRESS_ANIM" && players.has(reference.animation))
    .map((reference) => reference.styleSection.replace(/^STYLE/i, "")))
}

/* —— 对外入口 —— */
export function populateLegacyAnimationInspector(container: HTMLElement): boolean {
  if (!isLegacyAnimationDocument()) return false
  const text = appState.selectedDocument!.toString()
  const model = parseLegacyAnimationFile(text)
  const byIndex = new Map(model.entries.flatMap((entry) => entry.index === undefined ? [] : [[String(entry.index), entry] as const]))
  const references = legacyAnimationReferences(styleDocument(), layoutDocument())
  const referencesOf = (entry: LegacyAnimationEntry) => references.filter((reference) => reference.animation === entry.index)
  const entries = model.entries.filter((entry) => shownInAnimationView(entry.kind === "particle"))
  const plays = (id: string, key: PreviewItem) => keyPlaysStyle(key, pressStyles(entries.find((entry) => entry.section === id)!, model.entries, references))
  const { items, keyFilter } = keyAnimationItems(entries.map((entry) => listItem(entry, byIndex, referencesOf(entry).length)), plays)
  const selected = selectedAnimation(items)
  const entry = entries.find((candidate) => candidate.section === selected)
  const listRows: HTMLElement[] = []
  if (model.animNum !== undefined && model.animNum !== model.entries.length) {
    listRows.push(animationWarning(`[GLOBAL] ANIM_NUM=${model.animNum}，实际有 ${model.entries.length} 个动效；写回任意字段时自动修正。`))
  }
  // 粒子由播放器画到键盘上（keyboardPlayback），不再用文档检查器的整面板预览。
  appState.particlePreviewSection = ""
  preview.setParticlePreview()
  const create = (kind: LegacyAnimationKind, copyOf?: string) => edit((current) => {
    const next = appendLegacyAnimation(current, kind, copyOf)
    rememberAnimation(next.section)
    return next.text
  })
  renderAnimationResource(container, {
    mode: appState.animationDesignMode,
    sectionClass: SECTION,
    items,
    selected,
    keyFilter,
    editable: isEditing(),
    onSelect: selectAnimation,
    create: {
      options: LEGACY_ANIMATION_KINDS.filter(({ kind }) => shownInAnimationView(kind === "particle"))
        .map(({ kind, label }) => [kind, kind === "particle" ? "粒子" : label]),
      run: (kind) => create(kind as LegacyAnimationKind),
    },
    duplicate: () => { if (entry) create(entry.kind, entry.section) },
    listRows,
    player: entry && {
      clip: iniPreviewClip(appState.selectedDocument!, entry.section, { fillBefore: true }),
      key: `${appState.selectedPath}|${entry.section}`,
      resolver: visualResolver(),
      readFile: readSkinFile,
      keyboard: keyboardPlayback((key) => keyPlaysStyle(key, pressStyles(entry, model.entries, references))),
    },
    warnings: entry?.category !== undefined && entry.category !== kindCategory(entry.kind)
      ? [animationWarning(`CATEGORY=${entry.category} 与识别出的${legacyAnimationKindLabel(entry.kind)}不一致，已按内容编辑。`, {
          label: "修正", disabled: !isEditing(),
          run: () => edit((current) => writeLegacyAnimationFields(current, entry.section, { CATEGORY: String(kindCategory(entry.kind)) })),
        })]
      : [],
    sections: entry ? parameterSections(entry, byIndex) : [],
    uses: entry ? [
      ...keyUses(entry.section, plays, legacyKeyApply(entry)),
      ...legacyPanelUse(entry, pressStyles(entry, model.entries, references)),
      ...uses(referencesOf(entry)),
    ] : [],
  })
  container.dataset.path = appState.selectedPath
  return true
}

/** 样式字段值里引用的动画编号，各自在 anim.ini 里的条目（找不到为 undefined）。 */
function referencedAnimations(value: string): Array<{ id: string; entry?: LegacyAnimationEntry }> {
  const path = legacyAnimationConfigPath()
  if (!path || !appState.archive?.isText(path)) return []
  const entries = parseLegacyAnimationFile(appState.archive.getText(path)).entries
  return value.split(",").map((part) => part.trim()).filter((part) => /^\d+$/.test(part))
    .map((id) => ({ id, entry: entries.find((candidate) => candidate.index === Number(id)) }))
}

/** 动画样式引用的全部动画（PRESS_ANIM、RELEASE_ANIM……去重）。 */
function styleAnimations(styleID: string, styles: IniDocument): LegacyAnimationEntry[] {
  const entries = STYLE_ANIM_FIELDS.flatMap((field) => referencedAnimations(styles.get(`STYLE${styleID}`, field) ?? ""))
    .flatMap(({ entry }) => entry ? [entry] : [])
  return [...new Map(entries.map((entry) => [entry.section, entry])).values()]
}

/** 样式列表里动画样式的说明，如「动画 1 · 缩放」。 */
export function styleAnimationSummary(styleID: string, styles: IniDocument): string {
  return styleAnimations(styleID, styles).map((entry) => `动画 ${entry.index} · ${kindLabel(entry)}`).join("、") || "未引用动画"
}

/** 动画样式没有正常 / 按下外观：详情里为它引用的每个动画放一个播放器，播放时也在用这个样式的按键上播放。 */
export function styleAnimationPlayers(styleID: string, styles: IniDocument): HTMLElement[] {
  const path = legacyAnimationConfigPath()!
  const animations = styleAnimations(styleID, styles)
  const animationsDocument = animations.length ? IniDocument.parse(appState.archive!.getText(path)) : undefined
  return animations.map((entry) => animationPlayer({
    clip: iniPreviewClip(animationsDocument!, entry.section, { fillBefore: true }),
    key: `${path}|${entry.section}`,
    resolver: visualResolver(),
    readFile: readSkinFile,
    keyboard: keyboardPlayback((key) => keyPlaysStyle(key, new Set([styleID]))),
  }))
}

/** 样式里 PRESS_ANIM 等字段引用的动画：每个编号一个按钮，点一下打开动效设计 / 粒子设计并选中它。 */
export function styleAnimationLinks(key: string, value: string): HTMLElement | undefined {
  const path = legacyAnimationConfigPath()
  if (!STYLE_ANIM_FIELDS.some((field) => field === key) || !path) return
  const animations = referencedAnimations(value)
  if (!animations.length) return
  const links = element("span", "style-animation-links")
  for (const { id, entry } of animations) {
    const button = element("button", "ui-button")
    button.type = "button"
    button.dataset.size = "sm"
    button.dataset.variant = "quiet"
    button.disabled = !entry
    button.title = entry ? `在${entry.kind === "particle" ? "粒子" : "动效"}设计中打开动画 ${id}` : `anim.ini 里没有动画 ${id}`
    button.append(createIcon(entry?.kind === "particle" ? "wand-sparkles" : "film", 12), entry ? `动画 ${id} · ${kindLabel(entry)}` : `动画 ${id}（缺失）`)
    if (entry) button.addEventListener("click", () => openAnimation(path, entry.kind === "particle", entry.section))
    links.append(button)
  }
  return links
}

/** 对象头：动效设计 / 粒子设计与文件位置。 */
export function legacyAnimationInspectorTitle(): { name: string; context: string } | undefined {
  if (!isLegacyAnimationDocument()) return undefined
  const model = parseLegacyAnimationFile(appState.selectedDocument!.toString())
  const count = model.entries.filter((entry) => shownInAnimationView(entry.kind === "particle")).length
  return { name: animationModeTitle(appState.animationDesignMode), context: `${appState.selectedPath} · ${count} 个${appState.animationDesignMode === "particle" ? "粒子" : "动效"}` }
}
