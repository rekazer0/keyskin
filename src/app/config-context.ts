import { sxiFragmentRange, sxiSectionRanges } from "../palm/sxi-edit.ts"
import { palmAnimationTableAddress, palmCandidateAddress, palmStyleTableAddress, sxiPointer } from "./sxi-documents"
import { palmStylePointer } from "./sxi-styles"
import { palmTilePointer } from "../palm/palm-style-edit.ts"
import { appState } from "./state"
import { skinState, sourceEditor, theme, orientation, colorPickers, colorAlphas, candidateArea, toolbarStrip, candidateBackgroundCanvas, candidateInputBackgroundCanvas, candidateInputBox, candidateInputText, toolbarCanvas } from "./dom"
import { isListCell } from "../layout.ts"
import { effectivePanelSection } from "../panel-tools.ts"
import { selectedBdaSourceKeys } from "./document-inspector"
import { jsonPropertyRanges, iniSectionRanges } from "../highlight.ts"
import { source, toolbarPreview, candidateBackgroundPreview } from "./canvas-interaction"
import { deferNumberInputRefresh } from "../number-input-wheel.ts"
import { updateSourceHighlight } from "./source-panel"
import { IniDocument } from "../ini.ts"
import { bdaBasePath, textDocument, currentBdaAppearance } from "./bda-documents"
import { firstExistingPath } from "../resources.ts"
import { type VisualResolver } from "../atlas.ts"
import { isConfiguredSymbolLayout } from "../actions.ts"
import { resolveCandidateRect, resolveCandidateInputStyle, candidateInputBackgroundStyle, inputBarBox, type InputBarMetrics } from "../candidate-style.ts"
import { drawInputBarBackground, setCanvasSize } from "../preview-draw.ts"
import { bdaStyleID } from "../bda.ts"
import { devicePreviewTransparent, inputBarInKeyboard } from "./preview-render"
import { canvasEditable } from "./edit-history"
import { isSsfBoardPath, ssfSelectedBindings, ssfSkeleton } from "./ssf-documents"
import type { SkinArchive } from "../skin.ts"

export function selectedSourceSections(): string[] {
  if (appState.resourceConfigActive && appState.selectedResourcePath) {
    return appState.selectedTileIndex === undefined ? [] : [`IMG${appState.selectedTileIndex}`]
  }
  if (appState.resourceConfigActive && appState.resourceInspectorMode === "style") {
    return appState.selectedStyleID && appState.archive?.format !== "bda" ? [`STYLE${appState.selectedStyleID}`] : []
  }
  const toolbarSections = isToolbarPath(appState.selectedPath) ? effectiveToolbarSections() : []
  if (toolbarSections.length) return toolbarSections
  // A Sogou board's source is its phoneSkin.ini: the selected key's classes are what to reveal.
  if (isSsfBoardPath(appState.selectedPath)) return ssfSelectedBindings().flatMap(({ binding }) => binding.sections)
  return appState.selectedPath === appState.layoutPath ? effectiveSelectedSections() : []
}

export function currentSkinState(): number | undefined {
  return skinState.value ? Number(skinState.value) : undefined
}

export function effectiveKeySection(section: string): string {
  if (!appState.layoutDocument || isListCell(section)) return section
  return effectivePanelSection(appState.layoutDocument, section, currentSkinState())
}

function effectiveSelectedSections(): string[] {
  return appState.selectedKeySections.map(effectiveKeySection)
}

export function effectiveToolbarSections(): string[] {
  if (!appState.selectedDocument) return appState.selectedToolbarSections
  return [...new Set(appState.selectedToolbarSections.flatMap((section) => {
    const effective = effectivePanelSection(appState.selectedDocument!, section, currentSkinState())
    return effective === section ? [section] : [section, effective]
  }))]
}

export function effectiveKeyValue(section: string, key: string): string | undefined {
  if (!appState.layoutDocument) return
  const effective = effectiveKeySection(section)
  return appState.layoutDocument.get(effective, key) ?? appState.layoutDocument.get(section, key)
}

/**
 * The skin.json text a Palm selection stands for: the selected keys of a board, else the part the
 * selection addresses (a candidate bar, a bubble, the selected style or image's tile map).
 */
export function sxiSourceRanges(text: string): Array<readonly [number, number]> {
  const pointer = sxiPointer(appState.selectedPath)
  if (!pointer) return []
  const part = !appState.resourceConfigActive ? pointer
    : appState.resourceInspectorMode === "style" ? appState.selectedStyleID ? palmStylePointer(appState.selectedStyleID) : undefined
    : appState.selectedResourcePath ? palmTilePointer(appState.selectedResourcePath) : undefined
  const sections = appState.resourceConfigActive ? [] : selectedSourceSections()
  if (sections.length) return sxiSectionRanges(text, sections, pointer)
  // A whole board is the selection's context, not something to mark.
  const range = part && part[2] !== "b" ? sxiFragmentRange(text, part) : undefined
  return range ? [range] : []
}

export function scrollSelectedSource(): void {
  if (sourceEditor.hidden) return
  const sections = selectedSourceSections()
  const bdaKeys = selectedBdaSourceKeys()
  const sxiRange = sxiSourceRanges(source.value)[0]
  if (!sxiRange && !sections.length && !bdaKeys.length && !appState.sourceHistoryHighlight) return
  const bdaRange = jsonPropertyRanges(source.value, bdaKeys)[0]
  const iniRange = iniSectionRanges(source.value, sections)[0]
  const range = sxiRange ?? bdaRange ?? iniRange ?? appState.sourceHistoryHighlight
  if (range) source.revealRange(range[0], range[1])
}

export function setSourceValue(text: string): void {
  if (deferNumberInputRefresh(setSourceValue, () => setSourceValue(text))) return
  // Every part of a Palm skin is shown in its skin.json.
  const archive = appState.archive
  source.value = sxiPointer(appState.selectedPath) ? archive!.getText("skin.json") : text
  updateSourceHighlight()
}

/**
 * Where the canvas reads Baidu layouts, gen.ini and default.css from: the document itself, except a
 * Sogou skin, which has none of them; its boards come from Sogou's official skeleton (ssf-preview.ts).
 */
export function layoutSource(): SkinArchive | undefined {
  return appState.archive?.format === "ssf" ? ssfSkeleton() : appState.archive
}

export function currentConfigPath(name: string): string {
  return `${theme.value}/skin/${orientation.value}/${name}`
}

/** The style table: default.css, or a Palm skin's `ss_1` in skin.json. */
export function styleConfigPath(): string {
  if (appState.archive?.format === "sxi") return palmStyleTableAddress()
  const candidates = [
    `${theme.value}/skin/${orientation.value}/res/default.css`,
    `${theme.value}/skin/res/default.css`,
  ]
  return candidates.find((path) => layoutSource()?.names().includes(path)) ?? candidates[0]
}

export function legacyAnimationConfigPath(): string | undefined {
  if (appState.archive?.format === "sxi") return palmAnimationTableAddress()
  return [
    `${theme.value}/skin/${orientation.value}/anim.ini`,
    `${theme.value}/skin/${orientation.value}/res/anim.ini`,
    `${theme.value}/skin/res/anim.ini`,
  ].find((path) => layoutSource()?.isText(path))
}

export function genConfigPath(): string {
  return currentConfigPath("gen.ini")
}

// LIST 候选栏单元的几何（POS/CELL_SIZE）可能定义在布局自身或 gen.ini（候选栏几何通常全局共享）
export function listGeometryDocument(): { document: IniDocument; path: string } | undefined {
  if (!appState.archive || !appState.layoutDocument) return
  if (appState.layoutDocument.get("LIST", "POS") !== undefined || appState.layoutDocument.get("LIST", "CELL_SIZE") !== undefined) {
    return { document: appState.layoutDocument, path: appState.layoutPath }
  }
  const path = genConfigPath()
  const source = layoutSource()
  if (source?.isText(path)) return { document: IniDocument.parse(source.getText(path)), path }
  return { document: appState.layoutDocument, path: appState.layoutPath }
}

export function isSkinInfoPath(path: string): boolean {
  return /(^|\/)Info\.txt$/i.test(path)
}

export function isToolbarPath(path: string): boolean {
  return /\.cnd$/i.test(path)
}

/** INI / CND / POP 是属性面板能描述并回写的布局配置文档。 */
export function isConfigLayoutPath(path: string): boolean {
  return /\.(ini|cnd|pop)$/i.test(path)
}

/**
 * 普通皮肤（bds/bdi）里所有布局文档都自带属性面板。
 * BDA 容器内的同名遗留文件由 bda 解析器处理，不能按普通布局文档放行；
 * 搜狗皮肤自己的每个 INI 由 ssf-inspector.ts 按搜狗字段解析（画布用的官方骨架不属于皮肤）。
 */
export function showsLayoutProperties(path: string): boolean {
  if (appState.archive?.format === "ssf") return /\.ini$/i.test(path) && appState.archive.isText(path)
  return appState.archive?.format !== "bda" && isConfigLayoutPath(path)
}

function colorControlKey(field: HTMLInputElement): string {
  return `${field.hasAttribute("data-keyboard-field") ? "keyboard" : "style"}-${field.dataset.keyboardField ?? field.dataset.styleField ?? ""}`
}

export function syncColorControl(field: HTMLInputElement): void {
  const value = field.value.trim().replace(/^#/, "")
  // An unset colour resets the picker; otherwise it would keep (and re-write) the previous key's colour.
  if (value && !/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(value)) return
  const hex = !value ? "FF000000" : value.length === 6 ? `FF${value}` : value.toUpperCase()
  const picker = colorPickers.find((item) => item.dataset.colorPickerFor === colorControlKey(field))
  const alpha = colorAlphas.find((item) => item.dataset.colorAlphaFor === colorControlKey(field))
  if (picker) {
    picker.value = `#${hex.slice(2)}`
    picker.disabled = field.disabled
  }
  if (alpha) {
    alpha.value = String(Number.parseInt(hex.slice(0, 2), 16) / 255)
    alpha.disabled = field.disabled
  }
}

export function writeColorControl(control: HTMLInputElement, alphaValue: number): void {
  const key = control.dataset.colorPickerFor ?? control.dataset.colorAlphaFor ?? ""
  const field = document.querySelector<HTMLInputElement>(
    `[data-${key.startsWith("keyboard-") ? "keyboard" : "style"}-field="${CSS.escape(key.replace(/^(keyboard|style)-/, ""))}"]`,
  )
  if (!field) return
  const rgb = control.type === "color" ? control.value.slice(1).toUpperCase() : colorPickers.find((item) => item.dataset.colorPickerFor === key)?.value.slice(1).toUpperCase()
  if (!rgb || rgb.length !== 6) return
  field.value = `${Math.round(Math.max(0, Math.min(1, alphaValue)) * 255).toString(16).padStart(2, "0")}${rgb}`.toUpperCase()
  field.dispatchEvent(new Event("change", { bubbles: true }))
}

export function keyboardContext():
  | { gen: IniDocument; genPath: string; styles: IniDocument; stylePath: string }
  | undefined {
  const source = layoutSource()
  if (!source) return
  const genPath = genConfigPath()
  const stylePath = styleConfigPath()
  if (!source.isText(genPath) || !source.isText(stylePath)) return
  return {
    gen: IniDocument.parse(source.getText(genPath)),
    genPath,
    styles: IniDocument.parse(source.getText(stylePath)),
    stylePath,
  }
}

export function toolbarConfigPath(): string | undefined {
  if (!appState.archive) return
  if (appState.archive.format === "sxi") return palmCandidateAddress()
  const directory = `${theme.value}/skin/${orientation.value}`
  const genPath = genConfigPath()
  const source = appState.archive.format === "bda" ? appState.bdaBase : layoutSource()
  const sourceGenPath = appState.archive.format === "bda" ? bdaBasePath(genPath) : genPath
  const configured = source?.isText(sourceGenPath)
    ? IniDocument.parse(source.getText(sourceGenPath)).get("CAND", "LAYOUT_NAME")?.trim()
    : undefined
  const sourceDirectory = appState.archive.format === "bda" ? bdaBasePath(directory) : directory
  const found = source && firstExistingPath(source.names(), sourceDirectory, [
    ...(configured ? [`${configured}.cnd`] : []),
    "cand1.cnd",
    "cand.cnd",
  ])
  return found && (appState.archive.format === "bda"
    ? `${directory}/${found.split("/").pop()}`
    : found)
}

function candidateCssLength(value: string | undefined, width: number): string | undefined {
  const number = Number(value)
  return Number.isFinite(number) ? `${(number / width) * 100}cqw` : undefined
}

function applyCandidateGeometry(
  document: IniDocument,
  width: number,
): void {
  const number = (key: string) => {
    const value = Number(document.get("CAND", key))
    return Number.isFinite(value) ? value : undefined
  }
  const padding = document.get("CAND", "PADDING")?.split(",")[0]
  applyCandidateSpacing({ padding: padding === undefined || !Number.isFinite(Number(padding)) ? undefined : Number(padding), firstGap: number("FIRST_GAP"), cellWidth: number("CELL_W"), moreWidth: number("MORE_W") }, width)
}

/** Candidate word spacing in skin units: left padding, first gap, cell and "more" widths. */
export function applyCandidateSpacing(
  spacing: { padding?: number; firstGap?: number; cellWidth?: number; moreWidth?: number },
  width: number,
): void {
  const length = (value: number | undefined) => value === undefined ? undefined : candidateCssLength(String(value), width)
  const set = (property: string, value: string | undefined) => value ? candidateArea.style.setProperty(property, value) : candidateArea.style.removeProperty(property)
  set("--candidate-left-padding", length(spacing.padding))
  set("--candidate-first-gap", length(spacing.firstGap))
  set("--candidate-cell-width", length(spacing.cellWidth))
  set("--candidate-cell-inset", length(spacing.cellWidth === undefined ? undefined : spacing.cellWidth / 2))
  set("--candidate-more-width", length(spacing.moreWidth))
}

export function hideCandidateInputBar(): void {
  appState.candidateInputBar = undefined
  candidateInputBackgroundCanvas.hidden = true
}

/** Sizes the input code bar around the typed code and paints its background, in skin units. */
export function fitCandidateInputBar(): void {
  const bar = appState.candidateInputBar
  const areaWidth = candidateArea.clientWidth
  if (!bar || !areaWidth) return
  const textWidth = (candidateInputText.offsetWidth / areaWidth) * bar.candidateWidth
  // The box and its insets are Baidu Android's; iOS fills the whole keyboard row (see device-preview.css).
  const box = inputBarInKeyboard()
    ? { width: bar.candidateWidth, paddingStart: 0, paddingEnd: 0 }
    : inputBarBox(textWidth, bar.metrics, bar.candidateWidth)
  const cqw = (value: number) => `${(value / bar.candidateWidth) * 100}cqw`
  candidateInputBox.style.setProperty("--candidate-input-box-width", cqw(box.width))
  candidateInputBox.style.setProperty("--candidate-input-padding-start", cqw(box.paddingStart))
  candidateInputBox.style.setProperty("--candidate-input-padding-end", cqw(box.paddingEnd))
  const width = Math.max(1, Math.round(box.width))
  const height = Math.max(1, Math.round(bar.metrics.height))
  setCanvasSize(candidateInputBackgroundCanvas, width, height)
  const context = candidateInputBackgroundCanvas.getContext("2d")
  if (!context) return
  context.clearRect(0, 0, width, height)
  drawInputBarBackground(context, bar.visual, width, height)
}

/** The input code bar at `metrics`, its background the resolved `backgroundStyle`; hidden at height 0. */
export function showCandidateInputBar(resolver: VisualResolver, metrics: InputBarMetrics, width: number, backgroundStyle: string): void {
  if (metrics.height <= 0) {
    hideCandidateInputBar()
    return
  }
  const bar: NonNullable<typeof appState.candidateInputBar> = { metrics, candidateWidth: width }
  appState.candidateInputBar = bar
  candidateInputBackgroundCanvas.hidden = !backgroundStyle
  fitCandidateInputBar()
  if (backgroundStyle) {
    void resolver.resolve(backgroundStyle, false).then((visual) => {
      if (appState.candidateInputBar !== bar) return
      bar.visual = visual
      fitCandidateInputBar()
    })
  }
}

export function refreshToolbarPreview(
  composing: boolean,
  resolver: VisualResolver,
): { width: number; height: number; inputHeight: number } | undefined {
  if (isConfiguredSymbolLayout(appState.layoutPath, textDocument(genConfigPath()))) {
    delete toolbarStrip.dataset.path
    toolbarStrip.hidden = true
    candidateBackgroundCanvas.hidden = true
    hideCandidateInputBar()
    return
  }
  const path = toolbarConfigPath()
  const document = path ? textDocument(path) : undefined
  if (!appState.archive || !path || !document) {
    delete toolbarStrip.dataset.path
    toolbarStrip.hidden = true
    candidateBackgroundCanvas.hidden = true
    hideCandidateInputBar()
    return
  }
  const gen = textDocument(genConfigPath())
  const bdaPanel = appState.archive.format === "bda"
    ? currentBdaAppearance()?.appearance.panels.get(appState.layoutPath.split("/").pop()?.replace(/\.ini$/i, "") ?? "")
    : undefined
  toolbarStrip.hidden = false
  toolbarStrip.dataset.path = path
  toolbarPreview.setResolver(resolver)
  toolbarPreview.setOffsets(gen)
  toolbarPreview.setDefaults(gen)
  toolbarPreview.setPersistentOnly(composing)
  toolbarPreview.setTheme(theme.value === "dark" ? "dark" : "light")
  toolbarPreview.setTransparent(true)
  const { width, height } = resolveCandidateRect(document, gen)
  const inputGeneral = bdaPanel?.input?.textStyle
    ? IniDocument.parse(`[INPUT]\nFORE_STYLE=${bdaStyleID(bdaPanel.input.textStyle)}\n`)
    : gen
  const inputStyle = resolveCandidateInputStyle(inputGeneral, resolver, width, document, inputBarInKeyboard())
  const inputHeight = inputStyle.height
  const backgroundStyle = appState.archive?.format === "bda"
    ? bdaStyleID(bdaPanel?.backStyle)
    : document.get("CAND", "BACK_STYLE")?.split(",")[0] ??
      gen?.get("SCAND", "BACK_STYLE")?.split(",")[0] ?? ""
  candidateBackgroundCanvas.hidden = false
  candidateBackgroundPreview.setResolver(resolver)
  candidateBackgroundPreview.setTheme(theme.value === "dark" ? "dark" : "light")
  candidateBackgroundPreview.setTransparent(devicePreviewTransparent())
  candidateBackgroundPreview.setPanel(
    backgroundStyle,
    width,
    height,
  )
  candidateBackgroundPreview.setDocument(undefined)
  const inputBackgroundStyle = bdaPanel?.input
    ? bdaStyleID(bdaPanel.input.backStyle)
    : candidateInputBackgroundStyle(gen, document, inputBarInKeyboard())
  showCandidateInputBar(resolver, inputStyle, width, inputBackgroundStyle)
  toolbarCanvas.style.setProperty("--toolbar-width", String(width))
  toolbarCanvas.style.setProperty("--toolbar-height", String(height))
  toolbarCanvas.style.setProperty("--candidate-input-height", String(inputHeight))
  applyCandidateGeometry(document, width)
  const toolbarDocument = IniDocument.parse(document.toString())
  toolbarDocument.set("CAND", "BACK_STYLE", "")
  toolbarPreview.setPanel("", width, height)
  toolbarPreview.setDocument(toolbarDocument)
  toolbarPreview.setMode(canvasEditable() ? "edit" : "preview")
  return { width, height, inputHeight }
}
