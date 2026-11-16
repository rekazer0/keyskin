// 候选栏的「文字」分组，以及按键文字的写入。百度 BDS/BDI 写 default.css 的 STYLE 文字属性，
// BDA 写 appearanceConfig 的文字样式，手心直接写 skin.json 样式的 s_1（sxi-text.ts）；
// 搜狗皮肤的文字由 ssf-inspector.ts 处理。皮肤没有的文字样式在第一次修改时新建。
import { appState } from "./state"
import { cachedIniDocument } from "./style-document"
import { IniDocument } from "../ini.ts"
import { textStyleValue, textStyleSections, writeTextStyleProperty, resolveStylePropertyLayers, type TextStyleRef } from "../style-properties.ts"
import { candidateFirstForeground, candidateInputForegroundStyle, candidateInputSizeForeground, candidateWordsForeground } from "../candidate-style.ts"
import { type BdaStyleRef } from "../bda.ts"
import { element } from "../dom-element.ts"
import { isListCell } from "../layout.ts"
import { styleConfigPath, genConfigPath, isToolbarPath, effectiveToolbarSections, effectiveKeyValue, effectiveKeySection } from "./config-context"
import { commitTextChanges, isEditing } from "./edit-history"
import { currentBdaAppearance, bdaAppearancePart } from "./bda-documents"
import { bdaStyleValue, createBdaPanelTextStyle, updateBdaRefs } from "./key-inspector"
import { typographyRows } from "./typography"
import { skinFontField, styleFontChoices } from "./skin-fonts"
import { selectedBdaTextRefs, canCreateBdaKeyText, createBdaKeyText } from "./bda-key-text"
import { textStyleGroup, textStyleNote, textStyleRows, textStyleTargetSwitch, primaryCssFields } from "./dom"
import { palmTextTargets, palmTextValues, writePalmText, type PalmText } from "./sxi-text"
import { createIcon } from "../icons"

type TextProperty = "FONT_NAME" | "FONT_SIZE" | "FONT_WEIGHT" | "FONT_CLEARTYPE" | "NM_COLOR" | "HL_COLOR" | "BORDER_COLOR" | "BORDER_SIZE"

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

type PalmProperty = Exclude<TextProperty, "FONT_WEIGHT" | "FONT_CLEARTYPE" | "BORDER_COLOR" | "BORDER_SIZE">

/** 悬停说明：写清格式支持与生效条件，标签本身不再带括号说明。 */
const HINTS: Partial<Record<TextProperty, string>> = {
  FONT_NAME: "字体名称（FONT_NAME）：这个文字样式使用的字体，可填系统字体名（iOS，如 PingFang SC）或皮肤内字体文件名；Android 真机只认皮肤内字体文件",
  FONT_WEIGHT: "字重（FONT_WEIGHT）：百度真机不解析，导出 BDS 时按它把按键文字切成图片",
  FONT_CLEARTYPE: "字体平滑（FONT_CLEARTYPE）：百度 CSS 的平滑字体开关，写回皮肤；编辑器预览始终平滑",
  BORDER_COLOR: "阴影颜色（BORDER_COLOR）：文字样式下的 BORDER_COLOR 是向下阴影的颜色",
  BORDER_SIZE: "阴影大小（BORDER_SIZE）：配合阴影颜色使用，0 为无阴影；百度新版安卓不绘制文字阴影，导出时按这个设置切片",
}
// 真机候选字用用户字体（candidate-style.ts），皮肤只能改字号与颜色。
const CANDIDATE_PROPERTIES: TextProperty[] = ["FONT_SIZE", "NM_COLOR", "HL_COLOR"]
const CANDIDATE_NOTE = "真机候选字使用用户字体，皮肤只能改字号与颜色"

/** 写回用的文档：每次新解析一份，改动不会串到检查器读的那份缓存。 */
function iniDocument(path: string): IniDocument | undefined {
  return appState.archive?.isText(path) ? IniDocument.parse(appState.archive.getText(path)) : undefined
}

/** The selected keys' texts: each key's FORE_STYLE, given a new text layer on first edit when it has none. */
function selectedKeyTextRefs(): TextStyleRef[] {
  const layout = appState.layoutDocument
  if (!layout) return []
  return appState.selectedKeySections.map((section) => isListCell(section)
    ? { foreground: layout.get("LIST", "FORE_STYLE") ?? "", owner: { path: appState.layoutPath, section: "LIST", key: "FORE_STYLE", append: true } }
    : { foreground: effectiveKeyValue(section, "FORE_STYLE") ?? "", owner: { path: appState.layoutPath, section: effectiveKeySection(section), key: "FORE_STYLE", append: true } })
}

/** What `refs` show for `property` in the current default.css, read like the preview. */
function textRefValues(refs: readonly TextStyleRef[], property: TextProperty): string[] {
  const styles = cachedIniDocument(styleConfigPath())
  return styles ? refs.map((ref) => textStyleValue(styles, ref, property)) : []
}

/**
 * Writes one text property for `refs` into the current default.css, creating a text style (and the
 * reference to it) for texts that have none, as one undo step across every file it touches.
 */
function writeTextRefs(refs: readonly TextStyleRef[], property: TextProperty, value: string): void {
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

function cssTargets(): { scope: "candidate"; targets: TextTarget[] } | undefined {
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
}

function bdaTargets(): { scope: "candidate"; targets: TextTarget[] } | undefined {
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
}

function palmTargets(): { scope: "candidate"; targets: TextTarget[] } | undefined {
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
}

/** The selected candidate bar's text targets; keys keep their own 文字 group. */
function textTargets(): { scope: "candidate"; targets: TextTarget[] } | undefined {
  const archive = appState.archive
  if (!archive || archive.format === "ssf" || appState.selectedKeySections.length) return
  const context = archive.format === "bda" ? bdaTargets() : archive.format === "sxi" ? palmTargets() : cssTargets()
  if (context && appState.selectedCandidate === "input") context.targets = context.targets.filter(target => target.id === "input")
  return context
}

function targetValues(target: TextTarget, property: TextProperty): string[] {
  // 候选栏只提供字号与颜色。
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

/** Whether this text has a style or can create one on its first edit. */
function writable(target: TextTarget): boolean {
  if (target.palm) return target.palm.ids.length > 0 || Boolean(target.palm.create)
  return target.bda ? target.bda.length > 0 || Boolean(target.bdaCreate) : (target.css ?? []).some((ref) => ref.owner || ref.foreground)
}

/** 按键、候选栏、样式详情使用同一套文字字段。 */
export function baiduTypographyRows(values: (key: string) => string[], write: (key: string, value: string) => void, properties: string[], editable: boolean, name = ""): HTMLElement[] {
  const mapping = { text: "CONTENT_TEXT", font: "FONT_NAME", size: "FONT_SIZE", weight: "FONT_WEIGHT", smooth: "FONT_CLEARTYPE", color: "NM_COLOR", pressed: "HL_COLOR", shadowColor: "BORDER_COLOR", shadowSize: "BORDER_SIZE" } as const
  return typographyRows({
    fields: Object.fromEntries(Object.entries(mapping).filter(([, key]) => properties.includes(key)).map(([attribute, key]) => {
      const list = values(key)
      return [attribute, { key, values: list, ...(key === "FONT_CLEARTYPE" ? { checked: list[0] !== "0" } : {}), hint: HINTS[key as TextProperty] }]
    })),
    size: { min: 1 }, fonts: properties.includes("FONT_NAME") ? styleFontChoices() : [], fontPlaceholder: appState.archive?.format === "bda" ? "系统默认" : "继承皮肤字体", editable, name, write,
    sample: appState.selectedKeySections.length === 1 ? previewKeyText() : undefined,
  })
}

export function renderKeyTypography(container: HTMLElement, hasSelection: boolean): boolean {
  const format = appState.archive?.format
  if (format !== "bdi" && format !== "bds" && format !== "bda") {
    container.replaceChildren()
    return false
  }
  const bda = appState.archive?.format === "bda"
  const info = bda ? currentBdaAppearance() : undefined
  const refs = bda ? selectedBdaTextRefs() : []
  const cssRefs = !bda && hasSelection ? selectedKeyTextRefs() : []
  const styles = cachedIniDocument(styleConfigPath())
  const hasStyle = bda ? refs.length > 0 : cssRefs.some(ref => styles && textStyleSections(styles, ref.foreground).length > 0)
  const available = hasSelection && (!bda || Boolean(info && (refs.length || canCreateBdaKeyText())))
  const properties = bda ? ["CONTENT_TEXT", "FONT_NAME", "FONT_SIZE", "NM_COLOR", "HL_COLOR"]
    : ["FONT_NAME", "FONT_SIZE", "FONT_WEIGHT", "FONT_CLEARTYPE", "NM_COLOR", "HL_COLOR", "BORDER_COLOR", "BORDER_SIZE"]
  const rows = available ? baiduTypographyRows(key => bda ? refs.map(ref => bdaStyleValue(info!.appearance, ref, key)) : textRefValues(cssRefs, key as TextProperty), (key, value) => {
    if (bda) {
      if (refs.length) updateBdaRefs(refs, key, value)
      else createBdaKeyText(key, value)
    } else writeTextRefs(cssRefs, key as TextProperty, value)
  }, properties, isEditing()) : []
  for (const row of rows) {
    if (!row.classList.contains("ui-field") || row.dataset.supported === "false") continue
    const key = row.dataset.documentKey!
    const input = row.querySelector<HTMLInputElement>("input:not([type=range])")
    if (input && !key.includes(" ")) input.dataset.styleField = key
    if (key === "FONT_NAME") {
      row.title = HINTS.FONT_NAME!
      row.querySelector("button")!.id = "font-name-picker"
    }
    if (key === "FONT_WEIGHT") row.id = "typography-font-weight"
    if (key === "FONT_CLEARTYPE") row.id = "typography-cleartype"
    if (key === "NM_COLOR HL_COLOR") row.id = "key-text-color"
  }
  const shadows = element("div", "inspector-grid")
  shadows.id = "key-text-shadow"
  shadows.hidden = bda
  shadows.append(...rows.filter(row => row.dataset.typography?.startsWith("shadow")))
  const global = hasSelection ? skinFontField() : undefined
  const content = bda ? rows.find(row => row.dataset.typography === "text") : undefined
  if (content) primaryCssFields.append(content)
  container.replaceChildren(...rows.filter(row => row !== content && !(bda && row.tagName === "H4") && !row.dataset.typography?.startsWith("shadow")), shadows, ...global ? [global] : [])
  return hasStyle
}

function previewKeyText(): string | undefined {
  const styles = cachedIniDocument(styleConfigPath())
  const foreground = selectedKeyTextRefs()[0]?.foreground
  if (styles && foreground) {
    const text = resolveStylePropertyLayers(styles, foreground, "SHOW").map(layer => layer.value).join("")
    if (text) return text
  }
  return appState.layoutDocument?.get(appState.selectedKeySections[0], "SHOW")
}

export function populateTextStyleGroup(): void {
  const context = textTargets()
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
  if (target.note) textStyleNote.append(createIcon("info"), "跟随用户字体")
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
  textStyleRows.append(...baiduTypographyRows(key => targetValues(target, key as TextProperty), (key, value) => writeTarget(target, key as TextProperty, value), target.properties, isEditing() && writable(target), target.label))
}
