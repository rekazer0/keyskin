// 候选栏与整体布局的「文字」分组，以及按键文字的写入。百度 BDS/BDI 写 default.css 的 STYLE 文字属性，
// BDA 写 appearanceConfig 的文字样式，手心直接写 skin.json 样式的 s_1（sxi-text.ts）；
// 搜狗皮肤的文字由 ssf-inspector.ts 处理。皮肤没有的文字样式在第一次修改时新建。
import { appState } from "./state"
import { cachedIniDocument } from "./style-document"
import { IniDocument } from "../ini.ts"
import { textStyleSections, textStyleValue, writeTextStyleProperty, type TextStyleRef } from "../style-properties.ts"
import { candidateFirstForeground, candidateInputForegroundStyle, candidateInputSizeForeground, candidateWordsForeground } from "../candidate-style.ts"
import { type BdaStyleRef } from "../bda.ts"
import { element } from "../dom-element.ts"
import { isListCell } from "../layout.ts"
import { styleConfigPath, genConfigPath, isToolbarPath, effectiveToolbarSections, effectiveKeyValue, effectiveKeySection } from "./config-context"
import { commitTextChanges, isEditing } from "./edit-history"
import { currentBdaAppearance, bdaAppearancePart } from "./bda-documents"
import { bdaStyleValue, createBdaPanelTextStyle, updateBdaRefs } from "./key-inspector"
import { field } from "./property-rows"
import { skinFontNameOptions } from "./skin-fonts"
import { fontFileField, textStyleGroup, textStyleNote, textStyleRows, textStyleTargetSwitch } from "./dom"
import { palmSharedTextCount, palmTextTargets, palmTextValues, writePalmText, type PalmText } from "./sxi-text"
import { createIcon } from "../icons"

export type TextProperty = "FONT_NAME" | "FONT_SIZE" | "FONT_WEIGHT" | "FONT_CLEARTYPE" | "NM_COLOR" | "HL_COLOR" | "BORDER_COLOR" | "BORDER_SIZE"

type TextTarget = {
  id: string
  label: string
  properties: TextProperty[]
  css?: TextStyleRef[]
  bda?: BdaStyleRef[]
  /** Where a BDA panel gets a new text style when it has none here, and the style it starts from. */
  bdaCreate?: { path: string[]; copyFrom?: BdaStyleRef }
  palm?: PalmText
  note?: string
  summary?: string
}

type PalmProperty = Exclude<TextProperty, "FONT_WEIGHT" | "FONT_CLEARTYPE" | "BORDER_COLOR" | "BORDER_SIZE">

const LABELS: Record<TextProperty, string> = { FONT_NAME: "字体名称", FONT_SIZE: "字号", FONT_WEIGHT: "字重", FONT_CLEARTYPE: "字体平滑", NM_COLOR: "颜色", HL_COLOR: "按下颜色", BORDER_COLOR: "阴影颜色", BORDER_SIZE: "阴影大小" }
/** 悬停说明：写清格式支持与生效条件，标签本身不再带括号说明。 */
const HINTS: Partial<Record<TextProperty, string>> = {
  FONT_NAME: "字体名称（FONT_NAME）：这个文字样式使用的字体，可填系统字体名（iOS，如 PingFang SC）或皮肤内字体文件名；Android 真机只认皮肤内字体文件",
  FONT_WEIGHT: "字重（FONT_WEIGHT）：百度真机不解析，导出 BDS 时按它把按键文字切成图片",
  FONT_CLEARTYPE: "字体平滑（FONT_CLEARTYPE）：百度 CSS 的平滑字体开关，写回皮肤；编辑器预览始终平滑",
  BORDER_COLOR: "阴影颜色（BORDER_COLOR）：文字样式下的 BORDER_COLOR 是向下阴影的颜色",
  BORDER_SIZE: "阴影大小（BORDER_SIZE）：配合阴影颜色使用，0 为无阴影；百度新版安卓不绘制文字阴影，导出时按这个设置切片",
}
/** 字重只有 100–900 这九档；有自然范围，按设计规范配滑块 + 数值。 */
const WEIGHT_RANGE = { min: 100, step: 100 } as const
const KEY_PROPERTIES: TextProperty[] = ["FONT_NAME", "FONT_SIZE", "NM_COLOR", "HL_COLOR"]
// 百度 CSS 没有字重，BDS 导出时切成图片（font-bake-export.ts）；BDA / 手心的文字样式不支持。
const CSS_KEY_PROPERTIES: TextProperty[] = ["FONT_NAME", "FONT_SIZE", "FONT_WEIGHT", "FONT_CLEARTYPE", "NM_COLOR", "HL_COLOR", "BORDER_COLOR", "BORDER_SIZE"]
// 真机候选字用用户字体（candidate-style.ts），皮肤只能改字号与颜色。
const CANDIDATE_PROPERTIES: TextProperty[] = ["FONT_SIZE", "NM_COLOR", "HL_COLOR"]
const CANDIDATE_NOTE = "真机候选字使用用户字体，皮肤只能改字号与颜色"

/** 写回用的文档：每次新解析一份，改动不会串到检查器读的那份缓存。 */
function iniDocument(path: string): IniDocument | undefined {
  return appState.archive?.isText(path) ? IniDocument.parse(appState.archive.getText(path)) : undefined
}

/** The selected keys' texts: each key's FORE_STYLE, given a new text layer on first edit when it has none. */
export function selectedKeyTextRefs(): TextStyleRef[] {
  const layout = appState.layoutDocument
  if (!layout) return []
  return appState.selectedKeySections.map((section) => isListCell(section)
    ? { foreground: layout.get("LIST", "FORE_STYLE") ?? "", owner: { path: appState.layoutPath, section: "LIST", key: "FORE_STYLE", append: true } }
    : { foreground: effectiveKeyValue(section, "FORE_STYLE") ?? "", owner: { path: appState.layoutPath, section: effectiveKeySection(section), key: "FORE_STYLE", append: true } })
}

/** What `refs` show for `property` in the current default.css, read like the preview. */
export function textRefValues(refs: readonly TextStyleRef[], property: TextProperty): string[] {
  const styles = cachedIniDocument(styleConfigPath())
  return styles ? refs.map((ref) => textStyleValue(styles, ref, property)) : []
}

/**
 * Writes one text property for `refs` into the current default.css, creating a text style (and the
 * reference to it) for texts that have none, as one undo step across every file it touches.
 */
export function writeTextRefs(refs: readonly TextStyleRef[], property: TextProperty, value: string): void {
  const archive = appState.archive
  const stylePath = styleConfigPath()
  const styles = iniDocument(stylePath)
  if (!archive || !styles || !refs.length || !isEditing()) return
  const before = new Map([[stylePath, archive.getText(stylePath)]])
  const documents = new Map([[stylePath, styles]])
  for (const owner of writeTextStyleProperty(styles, refs, property, value)) {
    if (!documents.has(owner.path)) {
      before.set(owner.path, archive.isText(owner.path) ? archive.getText(owner.path) : "")
      documents.set(owner.path, iniDocument(owner.path) ?? IniDocument.parse(""))
    }
    const document = documents.get(owner.path)!
    if (document.sections().includes(owner.section)) document.set(owner.section, owner.key, owner.value)
    else document.appendSection(owner.section, [{ key: owner.key, value: owner.value }])
  }
  commitTextChanges([...documents].map(([path, document]) => ({ path, before: before.get(path)!, after: document.toString() })))
}

/** Text styles the other layouts of this folder draw, so a layout-wide edit can say what else it changes. */
function otherLayoutTextStyles(styles: IniDocument): Set<string> {
  const folder = appState.layoutPath.slice(0, appState.layoutPath.lastIndexOf("/") + 1)
  const used = new Set<string>()
  for (const path of appState.archive?.names() ?? []) {
    if (path === appState.layoutPath || !path.startsWith(folder) || !/^[^/]+\.ini$/i.test(path.slice(folder.length))) continue
    const document = cachedIniDocument(path)
    for (const section of document?.sections() ?? []) {
      for (const style of textStyleSections(styles, document!.get(section, "FORE_STYLE") ?? "")) used.add(style)
    }
  }
  return used
}

function cssTargets(): { scope: "candidate" | "layout"; targets: TextTarget[] } | undefined {
  const styles = cachedIniDocument(styleConfigPath())
  if (!styles) return
  if (isToolbarPath(appState.selectedPath)) {
    if (effectiveToolbarSections().length) return
    const candidate = appState.selectedDocument
    const general = cachedIniDocument(genConfigPath())
    const cnd = { path: appState.selectedPath, section: "CAND" }
    const words = candidateWordsForeground(candidate, general)
    const input = candidateInputForegroundStyle(general, candidate)
    // The preview's lookups (candidate-style.ts). A missing style is created on first edit; a new 首选
    // style starts from the candidate words, which it otherwise inherits entirely.
    return {
      scope: "candidate",
      targets: [
        { id: "candidate", label: "候选字", properties: CANDIDATE_PROPERTIES, note: CANDIDATE_NOTE, css: [{ foreground: words, owner: { ...cnd, key: "FORE_STYLE" } }] },
        { id: "first", label: "首选", properties: CANDIDATE_PROPERTIES, note: CANDIDATE_NOTE, css: [{ foreground: candidateFirstForeground(candidate, general), owner: { ...cnd, key: "FIRST_FORE" }, copyFrom: words }] },
        {
          id: "input",
          label: "输入码",
          properties: CANDIDATE_PROPERTIES,
          note: CANDIDATE_NOTE,
          // iOS keyboards size the inline code from INPUT and colour it from SCAND: edit both.
          css: input
            ? [...new Set([input, candidateInputSizeForeground(general, candidate)])].filter(Boolean).map((foreground) => ({ foreground }))
            : [{ foreground: "", owner: { path: genConfigPath(), section: "INPUT", key: "FORE_STYLE" } }],
        },
      ],
    }
  }
  const layout = appState.layoutDocument
  if (appState.selectedPath !== appState.layoutPath || !layout) return
  // A key's first text layer is its label; further text layers are hints (smaller, often another colour).
  const label: TextStyleRef[] = []
  const hint: TextStyleRef[] = []
  for (const section of layout.sections().filter((name) => /^KEY\d+$/.test(name))) {
    const tokens = (effectiveKeyValue(section, "FORE_STYLE") ?? "").split(",").map((token) => token.trim())
      .filter((token) => textStyleSections(styles, token).length)
    if (tokens[0]) label.push({ foreground: tokens[0] })
    hint.push(...tokens.slice(1).map((foreground) => ({ foreground })))
  }
  const others = otherLayoutTextStyles(styles)
  const note = (refs: TextStyleRef[]) => {
    const sections = new Set(refs.flatMap((ref) => textStyleSections(styles, ref.foreground)))
    const shared = [...sections].filter((section) => others.has(section)).length
    return `修改本布局按键用到的 ${sections.size} 个文字样式${shared ? `，其中 ${shared} 个也用于其他布局，会一并改变` : ""}`
  }
  const summary = (refs: TextStyleRef[]) => {
    const sections = new Set(refs.flatMap((ref) => textStyleSections(styles, ref.foreground)))
    const shared = [...sections].filter((section) => others.has(section)).length
    return `${sections.size} 个样式${shared ? ` · ${shared} 个跨布局共享` : ""}`
  }
  return {
    scope: "layout",
    targets: [
      { id: "label", label: "按键文字", properties: CSS_KEY_PROPERTIES, css: label, summary: label.length ? summary(label) : "无文字层", note: label.length ? note(label) : "本布局的按键没有文字层（字画在图片里）；选中按键修改文字会为它新建文字层" },
      ...hint.length ? [{ id: "hint", label: "提示文字", properties: CSS_KEY_PROPERTIES, css: hint, summary: summary(hint), note: note(hint) }] : [],
    ],
  }
}

function bdaTargets(): { scope: "candidate" | "layout"; targets: TextTarget[] } | undefined {
  const info = currentBdaAppearance()
  if (!info || bdaAppearancePart(appState.selectedPath)?.kind !== "panel" || appState.selectedPath !== appState.layoutPath) return
  const panel = info.appearance.panels.get(appState.selectedPath.split("/").pop()?.replace(/\.ini$/i, "") ?? "")
  if (!panel) return
  const text = (refs: Array<BdaStyleRef | undefined>) =>
    [...new Map(refs.filter((ref): ref is BdaStyleRef => ref?.type === "text").map((ref) => [ref.key, ref])).values()]
  if (appState.selectedCandidate) {
    return {
      scope: "candidate",
      targets: [
        { id: "candidate", label: "候选字", properties: CANDIDATE_PROPERTIES, note: CANDIDATE_NOTE, bda: text([panel.cand?.cellForeStyle]), bdaCreate: { path: ["cand", "cellForeStyle"] } },
        { id: "first", label: "首选", properties: CANDIDATE_PROPERTIES, note: CANDIDATE_NOTE, bda: text([panel.cand?.firstCellForeStyle]), bdaCreate: { path: ["cand", "firstCellForeStyle"], copyFrom: panel.cand?.cellForeStyle } },
        { id: "input", label: "输入码", properties: CANDIDATE_PROPERTIES, note: CANDIDATE_NOTE, bda: text([panel.input?.textStyle]), bdaCreate: { path: ["input", "textStyle"] } },
      ],
    }
  }
  const keys = [...panel.keys.values()].map((key) => key.foreStyles.filter((ref) => ref.type === "text"))
  const label = text(keys.map((refs) => refs[0]))
  const hint = text(keys.flatMap((refs) => refs.slice(1)))
  return {
    scope: "layout",
    targets: [
      { id: "label", label: "按键文字", properties: KEY_PROPERTIES, bda: label, summary: label.length ? `${label.length} 个样式 · 跨布局共享` : "无文字层", note: label.length ? `修改本布局按键用到的 ${label.length} 个文字样式，其他布局共用的样式会一并改变` : "本布局的按键没有文字层" },
      ...hint.length ? [{ id: "hint", label: "提示文字", properties: KEY_PROPERTIES, bda: hint, summary: `${hint.length} 个样式 · 跨布局共享`, note: `修改本布局按键用到的 ${hint.length} 个提示文字样式，其他布局共用的样式会一并改变` }] : [],
    ],
  }
}

function palmTargets(): { scope: "candidate" | "layout"; targets: TextTarget[] } | undefined {
  const palm = palmTextTargets()
  if (!palm) return
  if (palm.scope === "candidate") {
    return {
      scope: "candidate",
      targets: [
        { id: "candidate", label: "候选字", properties: CANDIDATE_PROPERTIES, note: CANDIDATE_NOTE, palm: palm.words },
        { id: "first", label: "首选", properties: CANDIDATE_PROPERTIES, note: CANDIDATE_NOTE, palm: palm.first },
        { id: "input", label: "输入码", properties: CANDIDATE_PROPERTIES, note: CANDIDATE_NOTE, palm: palm.input },
      ],
    }
  }
  const note = (ids: string[]) => {
    const shared = palmSharedTextCount(ids)
    return `修改本布局按键用到的 ${ids.length} 个文字样式${shared ? `，其中 ${shared} 个也用于其他布局，会一并改变` : ""}`
  }
  const summary = (ids: string[]) => {
    const shared = palmSharedTextCount(ids)
    return `${ids.length} 个样式${shared ? ` · ${shared} 个跨布局共享` : ""}`
  }
  const label = palm.label?.ids ?? []
  const hint = palm.hint?.ids ?? []
  return {
    scope: "layout",
    targets: [
      { id: "label", label: "按键文字", properties: KEY_PROPERTIES, palm: palm.label, summary: label.length ? summary(label) : "无文字样式", note: label.length ? note(label) : "本布局的按键没有文字样式（字画在图片里）；选中按键可以在「样式」里添加文字样式" },
      ...hint.length ? [{ id: "hint", label: "提示文字", properties: KEY_PROPERTIES, palm: palm.hint, summary: summary(hint), note: note(hint) }] : [],
    ],
  }
}

/** The candidate bar's or whole layout's text targets; keys keep their own 文字 group. */
function textTargets(): { scope: "candidate" | "layout"; targets: TextTarget[] } | undefined {
  const archive = appState.archive
  if (!archive || archive.format === "ssf" || appState.selectedKeySections.length) return
  return archive.format === "bda" ? bdaTargets() : archive.format === "sxi" ? palmTargets() : cssTargets()
}

function targetValues(target: TextTarget, property: TextProperty): string[] {
  // 手心与 BDA 的目标只列 KEY_PROPERTIES，不会有 FONT_WEIGHT。
  if (target.palm) return palmTextValues(target.palm, property as PalmProperty)
  if (target.bda) {
    const info = currentBdaAppearance()
    return info ? target.bda.map((ref) => bdaStyleValue(info.appearance, ref, property)) : []
  }
  return textRefValues(target.css ?? [], property)
}

function writeTarget(target: TextTarget, property: TextProperty, value: string): void {
  if (target.palm) writePalmText(target.palm, property as PalmProperty, value)
  else if (target.bda?.length) updateBdaRefs(target.bda, property, value)
  else if (target.bdaCreate) createBdaPanelTextStyle(target.bdaCreate.path, target.bdaCreate.copyFrom, property, value)
  else writeTextRefs(target.css ?? [], property, value)
}

/** A target nothing can be written to yet (a layout whose keys have no text, a BDA bar without a style). */
function writable(target: TextTarget): boolean {
  if (target.palm) return target.palm.ids.length > 0 || Boolean(target.palm.create)
  return target.bda ? target.bda.length > 0 || Boolean(target.bdaCreate) : (target.css ?? []).some((ref) => ref.owner || ref.foreground)
}

function commonValue(values: string[]): string {
  return values.every((value) => value === values[0]) ? values[0] ?? "" : ""
}

function valueRow(target: TextTarget, property: TextProperty, values: string[]): HTMLElement {
  const common = commonValue(values)
  const mixed = new Set(values).size > 1
  const editable = isEditing() && writable(target)
  const options = { key: property, label: LABELS[property], hint: HINTS[property], name: `${target.label}${LABELS[property]}`, mixed, editable }
  if (property === "FONT_WEIGHT") {
    return field({ ...options, spec: { kind: "number", value: common, ...WEIGHT_RANGE, range: "weight" },
      commit: (value) => writeTarget(target, property, value) })
  }
  if (property === "FONT_CLEARTYPE") {
    // 缺省值是开启（Android StyleParam.f = 1）：没写这一项的样式按开启显示；重置交回原值，不补写 0。
    const effective = values.map((value) => value || "1")
    return field({ ...options, mixed: new Set(effective).size > 1, baseline: common,
      spec: { kind: "switch", checked: effective.every((value) => value === "1") },
      commit: (checked) => writeTarget(target, property, checked ? "1" : "0"),
      reset: (value) => writeTarget(target, property, String(value ?? "")) })
  }
  if (property === "BORDER_SIZE") {
    return field({ ...options, spec: { kind: "number", value: common, unit: "px", min: 0, step: 1, range: "border" },
      commit: (value) => writeTarget(target, property, value) })
  }
  return property === "FONT_SIZE"
    ? field({ ...options, spec: { kind: "number", value: common, unit: "px", min: 1, step: 1, range: "fontSize" },
      commit: (value) => writeTarget(target, property, value) })
    : field({ ...options, spec: { kind: "text", value: common, suggestions: skinFontNameOptions() },
      commit: (value) => writeTarget(target, property, value) })
}

/** 单色阴影字段（BORDER_COLOR）：有值时带不透明度，点色块取色。 */
function borderColorRow(target: TextTarget, values: string[]): HTMLElement {
  return field({
    key: "BORDER_COLOR",
    label: LABELS.BORDER_COLOR,
    hint: HINTS.BORDER_COLOR,
    name: `${target.label}阴影颜色`,
    spec: { kind: "color", value: commonValue(values), codec: "argb" },
    mixed: new Set(values).size > 1,
    editable: isEditing() && writable(target),
    commit: (value) => writeTarget(target, "BORDER_COLOR", value),
  })
}

/** 正常 | 按下两个色块一行；改色相时保留原透明度的精确字节。 */
function colorRow(target: TextTarget, values: Record<"NM_COLOR" | "HL_COLOR", string[]>): HTMLElement {
  const common = (list: string[]) => list.every((value) => value === list[0]) ? list[0] ?? "" : ""
  return field({
    key: "NM_COLOR HL_COLOR",
    label: "文字颜色",
    hint: "左边是正常状态的颜色，右边是按下状态的颜色（NM_COLOR / HL_COLOR）",
    name: `${target.label}颜色`,
    spec: { kind: "colorPair", values: [common(values.NM_COLOR), common(values.HL_COLOR)], codec: "argb" },
    mixed: new Set(values.NM_COLOR).size > 1 || new Set(values.HL_COLOR).size > 1,
    editable: isEditing() && writable(target),
    commit: (next, { index = 0 }) => writeTarget(target, index ? "HL_COLOR" : "NM_COLOR", next[index]),
  })
}

/** 选中按键的文字阴影两行（BORDER_COLOR / BORDER_SIZE），与整体布局的文字组用同一套控件。 */
export function renderKeyTextShadow(container: HTMLElement): void {
  container.replaceChildren()
  const refs = selectedKeyTextRefs()
  const target: TextTarget = { id: "key-shadow", label: "按键文字", properties: ["BORDER_COLOR", "BORDER_SIZE"], css: refs }
  if (!refs.length) return
  container.append(borderColorRow(target, textRefValues(refs, "BORDER_COLOR")), valueRow(target, "BORDER_SIZE", textRefValues(refs, "BORDER_SIZE")))
}

/** 按键文字覆盖的「正常 | 按下」一行两个色块：改隐藏的原输入框，写回沿用 updateSelectedStyle。 */
export function renderKeyTextColor(container: HTMLElement): void {
  const [normal, pressed] = Array.from(container.querySelectorAll<HTMLInputElement>("input[type=hidden]"))
  container.querySelector(".ui-field")?.remove()
  container.prepend(field({
    key: "NM_COLOR HL_COLOR", label: "颜色", name: "文字颜色",
    spec: { kind: "colorPair", values: [normal.value, pressed.value], codec: "argb" },
    mixed: normal.placeholder === "混合" || pressed.placeholder === "混合", editable: !normal.disabled,
    commit: (next, { index = 0 }) => {
      const input = index ? pressed : normal
      input.value = next[index]
      input.dispatchEvent(new Event("change", { bubbles: true }))
    },
  }))
}

export function populateTextStyleGroup(): void {
  const context = textTargets()
  if (context?.scope !== "layout") fontFileField.hidden = true
  textStyleGroup.hidden = !context
  textStyleTargetSwitch.replaceChildren()
  textStyleRows.replaceChildren()
  if (!context) return
  const target = context.targets.find((item) => item.id === appState.textStyleTarget) ?? context.targets[0]
  textStyleNote.replaceChildren()
  textStyleNote.title = target.note ?? ""
  textStyleNote.setAttribute("aria-label", target.note ?? "")
  textStyleNote.tabIndex = 0
  textStyleNote.hidden = !target.note
  if (target.note) textStyleNote.append(createIcon(target.summary ? "layers" : "info"), target.summary ?? (context.scope === "candidate" ? "跟随用户字体" : target.note))
  textStyleTargetSwitch.hidden = context.targets.length < 2
  for (const item of context.targets) {
    const button = element("button")
    button.type = "button"
    button.textContent = item.label
    button.setAttribute("aria-pressed", String(item === target))
    button.addEventListener("click", () => {
      appState.textStyleTarget = item.id
      populateTextStyleGroup()
    })
    textStyleTargetSwitch.append(button)
  }
  textStyleRows.append(...target.properties.flatMap((property): HTMLElement[] => {
    if (property === "HL_COLOR") return []
    if (property === "NM_COLOR") return [colorRow(target, { NM_COLOR: targetValues(target, "NM_COLOR"), HL_COLOR: targetValues(target, "HL_COLOR") })]
    if (property === "BORDER_COLOR") return [borderColorRow(target, targetValues(target, "BORDER_COLOR"))]
    return [valueRow(target, property, targetValues(target, property))]
  }))
}
