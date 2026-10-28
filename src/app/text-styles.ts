// 候选栏与整体布局的「文字」分组，以及按键文字的写入。百度 BDS/BDI 写 default.css 的 STYLE 文字属性，
// BDA 写 appearanceConfig 的文字样式，手心直接写 skin.json 样式的 s_1（sxi-text.ts）；
// 搜狗皮肤的文字由 ssf-inspector.ts 处理。皮肤没有的文字样式在第一次修改时新建。
import { appState } from "./state"
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
import { parseStyleColor } from "./resource-inspector"
import { fontFileField, textStyleGroup, textStyleNote, textStyleRows, textStyleTargetSwitch } from "./dom"
import { palmSharedTextCount, palmTextTargets, palmTextValues, writePalmText, type PalmText } from "./sxi-text"

export type TextProperty = "FONT_NAME" | "FONT_SIZE" | "NM_COLOR" | "HL_COLOR"

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
}

const LABELS: Record<TextProperty, string> = { FONT_NAME: "字体名称", FONT_SIZE: "字号", NM_COLOR: "颜色", HL_COLOR: "按下颜色" }
const KEY_PROPERTIES: TextProperty[] = ["FONT_NAME", "FONT_SIZE", "NM_COLOR", "HL_COLOR"]
// 真机候选字用用户字体（candidate-style.ts），皮肤只能改字号与颜色。
const CANDIDATE_PROPERTIES: TextProperty[] = ["FONT_SIZE", "NM_COLOR", "HL_COLOR"]
const CANDIDATE_NOTE = "真机候选字使用用户字体，皮肤只能改字号与颜色"

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
  const styles = iniDocument(styleConfigPath())
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
    const document = iniDocument(path)
    for (const section of document?.sections() ?? []) {
      for (const style of textStyleSections(styles, document!.get(section, "FORE_STYLE") ?? "")) used.add(style)
    }
  }
  return used
}

function cssTargets(): { scope: "candidate" | "layout"; targets: TextTarget[] } | undefined {
  const styles = iniDocument(styleConfigPath())
  if (!styles) return
  if (isToolbarPath(appState.selectedPath)) {
    if (effectiveToolbarSections().length) return
    const candidate = appState.selectedDocument
    const general = iniDocument(genConfigPath())
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
  return {
    scope: "layout",
    targets: [
      { id: "label", label: "按键文字", properties: KEY_PROPERTIES, css: label, note: label.length ? note(label) : "本布局的按键没有文字层（字画在图片里）；选中按键修改文字会为它新建文字层" },
      ...hint.length ? [{ id: "hint", label: "提示文字", properties: KEY_PROPERTIES, css: hint, note: note(hint) }] : [],
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
      { id: "label", label: "按键文字", properties: KEY_PROPERTIES, bda: label, note: label.length ? `修改本面板按键用到的 ${label.length} 个文字样式，其他面板共用的样式会一并改变` : "本面板的按键没有文字层" },
      ...hint.length ? [{ id: "hint", label: "提示文字", properties: KEY_PROPERTIES, bda: hint, note: `修改本面板按键用到的 ${hint.length} 个提示文字样式，其他面板共用的样式会一并改变` }] : [],
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
  const label = palm.label?.ids ?? []
  const hint = palm.hint?.ids ?? []
  return {
    scope: "layout",
    targets: [
      { id: "label", label: "按键文字", properties: KEY_PROPERTIES, palm: palm.label, note: label.length ? note(label) : "本布局的按键没有文字样式（字画在图片里）；选中按键可以在「样式」里添加文字样式" },
      ...hint.length ? [{ id: "hint", label: "提示文字", properties: KEY_PROPERTIES, palm: palm.hint, note: note(hint) }] : [],
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
  if (target.palm) return palmTextValues(target.palm, property)
  if (target.bda) {
    const info = currentBdaAppearance()
    return info ? target.bda.map((ref) => bdaStyleValue(info.appearance, ref, property)) : []
  }
  return textRefValues(target.css ?? [], property)
}

function writeTarget(target: TextTarget, property: TextProperty, value: string): void {
  if (target.palm) writePalmText(target.palm, property, value)
  else if (target.bda?.length) updateBdaRefs(target.bda, property, value)
  else if (target.bdaCreate) createBdaPanelTextStyle(target.bdaCreate.path, target.bdaCreate.copyFrom, property, value)
  else writeTextRefs(target.css ?? [], property, value)
}

/** A target nothing can be written to yet (a layout whose keys have no text, a BDA bar without a style). */
function writable(target: TextTarget): boolean {
  if (target.palm) return target.palm.ids.length > 0 || Boolean(target.palm.create)
  return target.bda ? target.bda.length > 0 || Boolean(target.bdaCreate) : (target.css ?? []).some((ref) => ref.owner || ref.foreground)
}

function fieldRow(label: string, property: TextProperty, control: HTMLElement): HTMLElement {
  const row = element("label", "ui-field")
  row.title = property
  const caption = element("span")
  caption.textContent = label
  row.append(caption, control)
  return row
}

function placeholder(values: string[]): string {
  return new Set(values).size > 1 ? "混合" : "未设置"
}

function valueRow(target: TextTarget, property: TextProperty, values: string[]): HTMLElement {
  const input = element("input")
  input.value = values.every((value) => value === values[0]) ? values[0] ?? "" : ""
  input.placeholder = placeholder(values)
  input.setAttribute("aria-label", `${target.label}${LABELS[property]}`)
  input.disabled = !isEditing() || !writable(target)
  if (property === "FONT_SIZE") {
    input.type = "number"
    input.min = "1"
    input.step = "1"
  } else input.setAttribute("list", "skin-font-names")
  input.addEventListener("change", () => {
    if (input.type === "number" && input.value && !input.checkValidity()) return
    writeTarget(target, property, input.value.trim())
  })
  return fieldRow(LABELS[property], property, input)
}

/** Picker, AARRGGBB text and opacity; an unchanged opacity keeps its exact byte when only the hue changes. */
function colorRow(target: TextTarget, property: TextProperty, values: string[]): HTMLElement {
  const control = element("span", "color-control ui-input ui-color")
  const picker = element("input")
  const text = element("input")
  const alpha = element("input")
  picker.type = "color"
  alpha.type = "number"
  alpha.min = "0"
  alpha.max = "1"
  alpha.step = "0.01"
  const common = values.every((value) => value === values[0]) ? values[0] ?? "" : ""
  const parsed = parseStyleColor(common)
  const shownAlpha = String(parsed ? Math.round(parsed.alpha * 100) / 100 : 1)
  const alphaByte = parsed ? Math.round(parsed.alpha * 255) : 255
  text.value = common
  text.placeholder = placeholder(values)
  picker.value = `#${parsed?.hex ?? "000000"}`
  alpha.value = shownAlpha
  const label = `${target.label}${LABELS[property]}`
  picker.setAttribute("aria-label", label)
  text.setAttribute("aria-label", `${label}值`)
  alpha.setAttribute("aria-label", `${label}透明度`)
  for (const input of [picker, text, alpha]) input.disabled = !isEditing() || !writable(target)
  const fromControls = () => {
    const opacity = alpha.value === shownAlpha ? alphaByte : Math.round(Math.max(0, Math.min(1, Number(alpha.value))) * 255)
    writeTarget(target, property, `${opacity.toString(16).padStart(2, "0")}${picker.value.slice(1)}`.toUpperCase())
  }
  picker.addEventListener("change", fromControls)
  alpha.addEventListener("change", () => { if (alpha.value !== "" && alpha.checkValidity()) fromControls() })
  text.addEventListener("change", () => {
    const value = text.value.trim().replace(/^#/, "")
    if (!value || parseStyleColor(value)) writeTarget(target, property, value.toUpperCase())
  })
  control.append(picker, text, alpha)
  return fieldRow(LABELS[property], property, control)
}

export function populateTextStyleGroup(): void {
  const context = textTargets()
  if (context?.scope !== "layout") fontFileField.hidden = true
  textStyleGroup.hidden = !context
  textStyleTargetSwitch.replaceChildren()
  textStyleRows.replaceChildren()
  if (!context) return
  const target = context.targets.find((item) => item.id === appState.textStyleTarget) ?? context.targets[0]
  textStyleNote.textContent = target.note ?? ""
  textStyleNote.hidden = !textStyleNote.textContent
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
  textStyleRows.append(...target.properties.map((property) => {
    const values = targetValues(target, property)
    return property.endsWith("COLOR") ? colorRow(target, property, values) : valueRow(target, property, values)
  }))
}
