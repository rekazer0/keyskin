/*
 * 旧版百度（BDI/BDS）anim.ini 的动画检查器（DESIGN.md §10「动画资源」）：资源配置里的「动效设计」与「粒子设计」
 * 共用这一份文件，按类型筛选。列表选中一个动效，下面是它的播放器、参数分组和被哪些样式引用。
 * 解析、类型清理、时间轴和引用关系都在 src/legacy-animation.ts；每次编辑通过 commitText 写回一个撤销步骤。
 */
import { IniDocument } from "../ini.ts"
import { iniPreviewClip } from "../animation-preview-model.ts"
import { animationPlayer } from "../animation-player.ts"
import {
  animationModeTitle, animationWarning, comboList, renderAnimationResource,
  type AnimationListItem,
} from "../animation-inspector.ts"
import { baiduConfigControl } from "../baidu-config-controls.ts"
import { field, section, type FieldSpec } from "./property-rows"
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
  legacyAnimationStyles,
  legacyAnimationTimeline,
  legacyAnimationTypeLabel,
  legacyAnimationTypeOptions,
  legacyAnimationValueParts,
  parseLegacyAnimationFile,
  removeLegacyAnimation,
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
import { legacyAnimationConfigPath, setSourceValue, styleConfigPath } from "./config-context"
import { commitText, isEditing, updateDirty } from "./edit-history"
import { populateKeyInspector } from "./key-inspector"
import { refreshPreview } from "./preview-render"
import { keyAnimationItems, keyPlaysStyle, keyboardPlayback, openAnimation, rememberAnimation, selectAnimation, selectedAnimation, selectAnimationStyle, selectedAnimationStyle, shownInAnimationView, styleAnimationItems } from "./animation-resource"
import { appState } from "./state"
import { animationKeySample } from "./animation-key-sample"
import type { PreviewItem } from "../preview-items.ts"
import { animationStyleActions, animationStyleCard } from "./animation-style-inspector"
import { styleKindIcon, styleReferenceCard, type StyleReferenceState } from "../style-card.ts"

const KIND_ICONS: Record<LegacyAnimationKind, string> = { basic: "blend", combination: "layers", frame: "list-video", particle: "sparkles" }
const TYPE_ICONS = ["blend", "rotate-cw", "move", "scaling", "scaling", "rotate-3d"]

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

/* —— 属性行：标签来自 LEGACY_ANIMATION_FIELDS，开关与枚举的控件来自 baiduConfigControl —— */
type Commit = (value: string | undefined) => void

function row(entry: LegacyAnimationEntry, key: string, label: string, spec: FieldSpec, commit: Commit): HTMLElement {
  return field({
    key, label, spec,
    rowKey: [appState.selectedPath, entry.section, key],
    commit: (value: string | string[] | boolean) => commit(typeof value === "boolean" ? (value ? "1" : "0")
      : Array.isArray(value) ? (value.every((part) => !part) ? undefined : value.map((part) => part || "0").join(",")) : value || undefined),
  })
}

/** 基础动效的起止值：写法跟 TYPE 走；手册允许 rand(a,b)，所以都是表达式数值。 */
function basicValueLabel(entry: LegacyAnimationEntry, key: string): string {
  const prefix = key === "FROM" ? "起始" : "终止"
  return `${prefix}${["透明度", "角度", "位置", "缩放", "缩放", "3D 角度"][entry.type ?? 0] ?? ""}`
}

function basicValueSpec(entry: LegacyAnimationEntry, value: string): FieldSpec {
  const type = entry.type ?? 0
  if (type === 0) return { kind: "number", value, expression: true, range: "alpha" }
  if (type === 1) return { kind: "number", value, expression: true, unit: "°", range: "angle" }
  const values = legacyAnimationValueParts(value)
  return { kind: "parts", affixes: type === 5 ? ["X", "Y", "Z"] : ["X", "Y"], values, expression: true, unit: type === 5 ? "°" : "%" }
}

/** 位移与缩放的 X / Y 各有一个插值器。 */
function intpolSpec(entry: LegacyAnimationEntry, value: string | undefined): FieldSpec {
  const values = legacyAnimationValueParts(value ?? "0")
  if (!(entry.kind === "basic" && [2, 3, 4].includes(entry.type ?? 0))) return { kind: "choice", value: values[0] ?? "0", options: LEGACY_ANIMATION_INTPOL_OPTIONS }
  return { kind: "parts", affixes: ["X", "Y"], values: [values[0] ?? "0", values[1] ?? values[0] ?? "0"], options: LEGACY_ANIMATION_INTPOL_OPTIONS }
}

const RANGES: Record<string, "duration" | "count" | "rate"> = { DURATION: "duration", DELAY: "duration", TOTAL_NUMBER: "count", BIRTH_RATE: "rate" }

function fieldSpec(entry: LegacyAnimationEntry, key: string, value: string): FieldSpec {
  const spec = LEGACY_ANIMATION_FIELDS[key]
  const config = baiduConfigControl(entry.section, key)
  if (config?.kind === "switch") return { kind: "switch", checked: (value || config.defaultValue) === config.on }
  if (config?.kind === "choice") return { kind: "choice", value, options: config.options }
  if (spec?.kind === "number") return { kind: "number", value, unit: spec.unit, step: Number(spec.step) || undefined, range: RANGES[key] }
  if (spec?.kind === "pair" || spec?.kind === "quad") {
    const affixes = spec.kind === "quad" ? ["←", "↑", "→", "↓"] : /PIVOT|_PX$/.test(key) ? ["X", "Y"] : ["最小", "最大"]
    return { kind: "parts", affixes, values: legacyAnimationValueParts(value), columns: affixes.length, expression: true, unit: spec.unit, step: Number(spec.step) || undefined }
  }
  return { kind: "text", value }
}

/** ANIM_PATH 是 anim.ini 旁（或 res 里）的 gif / webp / png：图片卡片，名称可选现有文件。 */
function animPathSpec(value: string): FieldSpec {
  const folder = appState.selectedPath.replace(/[^/]*$/, "")
  return {
    kind: "image",
    value,
    placeholder: "选择或输入文件",
    suggestions: (appState.archive?.names() ?? []).filter((path) => path.startsWith(folder) && /\.(gif|webp|png)$/i.test(path)).map((path) => path.slice(folder.length)),
    load: () => {
      const bytes = value ? readSkinFile(value) : undefined
      return bytes && decodeFrames(bytes, /\.gif$/i.test(value) ? "image/gif" : /\.png$/i.test(value) ? "image/png" : "image/webp").then((frames) => frames[0]?.visual)
    },
  }
}

function fieldRow(entry: LegacyAnimationEntry, key: string): HTMLElement {
  const value = fieldValue(entry, key) ?? ""
  const commit: Commit = (next) => edit((text) => writeLegacyAnimationFields(text, entry.section, { [key]: next }))
  const label = key === "FROM" || key === "TO" ? basicValueLabel(entry, key) : LEGACY_ANIMATION_FIELDS[key]?.label ?? key
  const spec = key === "INTPOL" ? intpolSpec(entry, fieldValue(entry, key))
    : key === "FROM" || key === "TO" ? basicValueSpec(entry, value)
      : key === "PARTICLE_IMAGE" ? { kind: "style", value, reference: key } as const
        : key === "ANIM_PATH" ? animPathSpec(value)
          : fieldSpec(entry, key, value)
  return row(entry, key, label, spec, key === "INTPOL" ? (next) => commit(next ?? "0") : commit)
}

/** 手册第 180 页的 CATEGORY：0 基础 / 1 组合 / 2 帧 / 3 粒子。 */
function kindCategory(kind: LegacyAnimationKind): number {
  return kind === "basic" ? 0 : kind === "combination" ? 1 : kind === "frame" ? 2 : 3
}

/** 动效类型：动效设计里在基础 / 组合 / 帧之间切换，粒子设计只放粒子，原始文件视图四类都有。 */
function kindRow(entry: LegacyAnimationEntry): HTMLElement | undefined {
  const kinds = LEGACY_ANIMATION_KINDS.filter(({ kind }) => shownInAnimationView(kind === "particle"))
  if (kinds.length < 2) return
  return row(entry, "CATEGORY", LEGACY_ANIMATION_FIELDS.CATEGORY.label, { kind: "choice", value: entry.kind, layout: "labeled", options: kinds.map(({ kind, label }) => [kind, label.replace(/动效$/, ""), KIND_ICONS[kind]]) }, (next) => {
    if (next && next !== entry.kind) edit((text) => writeLegacyAnimationKind(text, entry.section, next as LegacyAnimationKind))
  })
}

function typeRow(entry: LegacyAnimationEntry): HTMLElement {
  const options = legacyAnimationTypeOptions(entry.kind).map(([value, text]) => [String(value), text] as const)
  return row(entry, "TYPE", entry.kind === "particle" ? "粒子类型" : "变化属性", { kind: "choice", value: entry.type === undefined ? "" : String(entry.type), options }, (next) => {
    if (next !== undefined) edit((text) => writeLegacyAnimationType(text, entry.section, Number(next)))
  })
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
  // 隐藏的 BUILD_LIST 行承载改动标记与重置；列表本身是下面的子动效编辑器，数量（BUILD_NUM）在分组标题上。
  const listRow = row(entry, "BUILD_LIST", LEGACY_ANIMATION_FIELDS.BUILD_LIST.label, { kind: "text", value: ids.join(",") }, (next) =>
    writeBuildList(entry, (next ?? "").split(",").map((part) => part.trim()).filter(Boolean)))
  listRow.hidden = true
  const basics = [...byIndex.values()].filter((child) => child.kind === "basic" && child.index !== undefined && child.section !== entry.section)
  return [fieldRow(entry, "BUILD_METHOD"), comboList({
    editable: isEditing(),
    empty: "没有子动画",
    children: ids.map((id) => {
      const child = byIndex.get(String(Number(id)))
      if (!child) return { title: `动画 ${id}`, detail: "anim.ini 里没有这个动画", missing: true }
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
    const rows = group.keys.flatMap((key) => key === "TYPE" ? [typeRow(entry)]
      : key === "BUILD_METHOD" ? comboRows(entry, byIndex)
        : key === "BUILD_LIST" || key === "BUILD_NUM" ? []
          : [fieldRow(entry, key)])
    const kind = index === 0 ? kindRow(entry) : undefined
    return section(group.title, kind ? [kind, ...rows] : rows, { count: group.keys.includes("BUILD_LIST") ? String(buildList(entry).length) : undefined })
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
      : entry.kind === "combination" ? `${fieldValue(entry, "BUILD_METHOD") === "0" ? "同时" : "接续"} · ${buildList(entry).length} 个子动画 · ${timelineText(timeline)}`
        : timelineText(timeline)
  return {
    id: entry.section,
    title: `动画 ${entry.index ?? entry.section}`,
    info: fieldValue(entry, "INFO")?.trim() || undefined,
    kind: kindLabel(entry),
    icon: entry.kind === "basic" ? TYPE_ICONS[entry.type ?? 0] ?? "blend" : KIND_ICONS[entry.kind],
    detail,
    uses,
    problem: problem(entry, byIndex),
  }
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
  const pressByAnimation = new Map(entries.map((candidate) => [candidate.section, pressStyles(candidate, model.entries, references)]))
  const plays = (id: string, key: PreviewItem) => keyPlaysStyle(key, pressByAnimation.get(id) ?? new Set())
  const { items: keyItems, keyFilter } = keyAnimationItems(entries.map((entry) => listItem(entry, byIndex, referencesOf(entry).length)), plays)
  // 样式列表只列引用了当前入口动效的样式。
  const styles = legacyAnimationStyles(styleDocument())
  const shown = new Set(entries.flatMap((candidate) => candidate.index === undefined ? [] : [candidate.index]))
  const usage = styles.flatMap((style) => {
    const included = style.animations.filter((index) => shown.has(index))
    return included.length ? [{ id: style.id, title: `STYLE${style.id}`, detail: style.events.join(" · "), count: included.length }] : []
  })
  const styleIndexes = new Map(styles.map((style) => [style.id, new Set(style.animations)]))
  const entryIndexes = new Map(entries.flatMap((candidate) => candidate.index === undefined ? [] : [[candidate.section, candidate.index] as const]))
  const { items, styleFilter } = styleAnimationItems(keyItems, usage, (id, style) => {
    const index = entryIndexes.get(id)
    return index !== undefined && Boolean(styleIndexes.get(style)?.has(index))
  })
  const selected = selectedAnimation(items)
  const entry = entries.find((candidate) => candidate.section === selected)
  const listRows: HTMLElement[] = []
  if (model.animNum !== undefined && model.animNum !== model.entries.length) {
    listRows.push(animationWarning(`[GLOBAL] ANIM_NUM=${model.animNum}，实际有 ${model.entries.length} 个动画，写回任意字段时自动修正`))
  }
  const create = (kind: LegacyAnimationKind, copyOf?: string) => edit((current) => {
    const next = appendLegacyAnimation(current, kind, copyOf)
    rememberAnimation(next.section)
    return next.text
  })
  renderAnimationResource(container, {
    listSource: appState.archive,
    mode: appState.animationDesignMode,
    sectionClass: "document-property-section",
    items,
    selected,
    keyFilter,
    styles: { noun: "样式", icon: "paintbrush", items: usage, selected: selectedAnimationStyle(), onSelect: selectAnimationStyle, card: animationStyleCard, ...animationStyleActions(entry?.index) },
    thumbnail: id => ({ clip: iniPreviewClip(appState.selectedDocument!, id, { fillBefore: true }), key: `${appState.selectedPath}|${id}`, resolver: visualResolver(), readFile: readSkinFile }),
    styleFilter,
    editable: isEditing(),
    onSelect: selectAnimation,
    create: {
      options: LEGACY_ANIMATION_KINDS.filter(({ kind }) => shownInAnimationView(kind === "particle"))
        .map(({ kind, label }) => [kind, kind === "particle" ? "粒子" : label]),
      run: (kind) => create(kind as LegacyAnimationKind),
    },
    duplicate: () => { if (entry) create(entry.kind, entry.section) },
    remove: entry ? {
      blocked: referencesOf(entry).length || model.entries.some((candidate) => candidate.section !== entry.section && candidate.kind === "combination"
        && buildList(candidate).some((id) => Number(id) === entry.index)) ? "请先解除样式、布局或组合引用" : undefined,
      run: () => edit((current) => removeLegacyAnimation(current, entry.section, styleDocument(), layoutDocument()) ?? current),
    } : undefined,
    listRows,
    player: entry && {
      clip: iniPreviewClip(appState.selectedDocument!, entry.section, { fillBefore: true }),
      key: `${appState.selectedPath}|${entry.section}`,
      resolver: visualResolver(),
      readFile: readSkinFile,
      sample: () => animationKeySample((key) => keyPlaysStyle(key, pressByAnimation.get(entry.section) ?? new Set()), pressByAnimation.get(entry.section) ?? new Set()),
      keyboard: keyboardPlayback((key) => keyPlaysStyle(key, pressByAnimation.get(entry.section) ?? new Set())),
      direct: isEditing() ? { text, section: entry.section, editable: true, commit: (next) => edit(() => next) } : undefined,
    },
    warnings: entry?.category !== undefined && entry.category !== kindCategory(entry.kind)
      ? [animationWarning(`CATEGORY=${entry.category} 与识别出的${legacyAnimationKindLabel(entry.kind)}不一致，已按内容编辑。`, {
          label: "修正", disabled: !isEditing(),
          run: () => edit((current) => writeLegacyAnimationFields(current, entry.section, { CATEGORY: String(kindCategory(entry.kind)) })),
        })]
      : [],
    sections: entry ? parameterSections(entry, byIndex) : [],
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

/** Serializable sources; clips themselves contain sampler functions and cannot cross windows. */
export function styleAnimationSources(styleID: string, styles: IniDocument) {
  const entries = styleAnimations(styleID, styles)
  const path = legacyAnimationConfigPath()
  if (!entries.length || !path || !appState.archive) return
  const text = appState.archive.getText(path)
  const document = IniDocument.parse(text)
  const clips = entries.map(entry => iniPreviewClip(document, entry.section, { fillBefore: true }))
  const files: Record<string, number[]> = {}
  for (const file of new Set(clips.flatMap(clip => clip.images.flatMap(item => item.file ? [item.file] : [])))) {
    const bytes = readSkinFile(file)
    if (bytes) files[file] = Array.from(bytes)
  }
  return { text, sections: entries.map(entry => entry.section), files,
    particleIDs: [...new Set(clips.flatMap(clip => clip.particles.flatMap(item => item.emitter.images)))] }
}

/** 动画样式没有正常 / 按下外观：详情里为它引用的每个动画放一个播放器，播放时也在用这个样式的按键上播放。 */
export function styleAnimationPlayers(styleID: string, styles: IniDocument, thumbnail = false): HTMLElement[] {
  const path = legacyAnimationConfigPath()!
  const animations = styleAnimations(styleID, styles)
  const animationsDocument = animations.length ? IniDocument.parse(appState.archive!.getText(path)) : undefined
  return animations.map((entry) => animationPlayer({
    thumbnail,
    clip: iniPreviewClip(animationsDocument!, entry.section, { fillBefore: true }),
    key: `${path}|${entry.section}`,
    resolver: visualResolver(),
    readFile: readSkinFile,
    keyboard: thumbnail ? undefined : keyboardPlayback((key) => keyPlaysStyle(key, new Set([styleID]))),
  }))
}

/** 检查器动画引用卡的内容：样式播放的每个动画一格真实缩略图；单击选择样式，⌘ 单击打开那个动画。 */
export function styleAnimationReferenceStates(styleID: string, styles: IniDocument, choose: () => void): StyleReferenceState[] {
  const entries = styleAnimations(styleID, styles)
  const players = styleAnimationPlayers(styleID, styles, true)
  if (!entries.length) return [{ label: "未设置", content: createIcon("image-off", 16), onClick: choose }]
  return entries.map((entry, index) => ({
    label: `动画 ${entry.index} · ${kindLabel(entry)}`,
    content: players[index],
    onClick: (edit: boolean) => edit ? openAnimation(legacyAnimationConfigPath()!, entry.kind === "particle", entry.section) : choose(),
  }))
}

/** 样式里 PRESS_ANIM 等字段：编号输入框放进样式引用卡，右侧每个引用的动画一格真实缩略图，单击打开那个动画。 */
export function decorateStyleAnimationField(row: HTMLElement, key: string, value: string): void {
  const path = legacyAnimationConfigPath()
  const input = row.querySelector("input")
  if (!STYLE_ANIM_FIELDS.some((field) => field === key) || !path || !input) return
  const animations = referencedAnimations(value)
  const document = animations.some(({ entry }) => entry) ? IniDocument.parse(appState.archive!.getText(path)) : undefined
  const states: StyleReferenceState[] = animations.map(({ id, entry }) => entry ? {
    label: `动画 ${id} · ${kindLabel(entry)}`,
    content: animationPlayer({ thumbnail: true, clip: iniPreviewClip(document!, entry.section, { fillBefore: true }), key: `${path}|${entry.section}`, resolver: visualResolver(), readFile: readSkinFile }),
    onClick: () => openAnimation(path, entry.kind === "particle", entry.section),
  } : { label: `anim.ini 里没有动画 ${id}`, content: createIcon("image-off", 16) })
  ;(input.closest(".ui-input") ?? input).replaceWith(styleReferenceCard({
    name: input,
    kind: animations.length ? styleKindIcon("anim") : undefined,
    states,
    empty: { icon: "clapperboard", label: "输入动画编号", onClick: () => input.focus() },
    disabled: input.disabled,
  }))
  row.classList.add("style-reference-field")
}

/** 对象头：动效设计 / 粒子设计与文件位置。 */
export function legacyAnimationInspectorTitle(): { name: string; context: string } | undefined {
  if (!isLegacyAnimationDocument()) return undefined
  const model = parseLegacyAnimationFile(appState.selectedDocument!.toString())
  const count = model.entries.filter((entry) => shownInAnimationView(entry.kind === "particle")).length
  return { name: animationModeTitle(appState.animationDesignMode), context: `${appState.selectedPath} · ${count} 个${appState.animationDesignMode === "particle" ? "粒子" : "动效"}` }
}
