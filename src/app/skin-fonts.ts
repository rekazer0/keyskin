import { confirmDeletion } from "./ask"
// 皮肤字体按浅色 / 深色分别管理，同一模式的横竖屏共用字体与 GLOBAL FONT_PATH。
import { appState } from "./state"
import { cachedIniDocument } from "./style-document"
import { commitBatch, isEditing, updateDirty } from "./edit-history"
import { refreshPreview } from "./preview-render"
import { populateKeyInspector } from "./key-inspector"
import { showError, showStatus } from "./file-operations"
import { styleConfigPath } from "./config-context"
import { fontImportInput, theme } from "./dom"
import { embeddedFontPath, loadEmbeddedFont } from "../atlas.ts"
import { element, iconButton } from "../dom-element.ts"
import { SYSTEM_FONTS, type FontChoice } from "./font-picker"
import { field } from "./property-rows"
import { ssfPackage, ssfTheme } from "./ssf-documents"
import { renderResourceCatalogSearch } from "./resource-page"
import { type Change } from "../history.ts"
import {
  fontSearchDirectories,
  isFontFile,
  relativeArchivePath,
  resolveFontReference,
  sanitizeFontFileName,
  skinFontFiles,
  skinStylePaths,
  themeOfPath,
  uniqueFontFileName,
  withFontReferencesCleared,
  withGlobalFontPath,
} from "../font-files.ts"

/** 只有带 CSS 的百度皮肤（BDI/BDS）有字体文件与 FONT_PATH；BDA、搜狗、手心皮肤不显示这组控件。 */
function fontStylePaths(scope = theme.value): string[] {
  const archive = appState.archive
  if (!archive || archive.format !== "bdi" && archive.format !== "bds") return []
  return skinStylePaths(archive.names()).filter(path => themeOfPath(path) === scope)
}

function fontStylePath(scope = theme.value): string {
  return fontStylePaths(scope).find(path => path === styleConfigPath().replace(/^[^/]+/, scope)) ?? fontStylePaths(scope)[0] ?? styleConfigPath()
}

function styleFontReference(scope = theme.value): string {
  return cachedIniDocument(fontStylePath(scope))?.get("GLOBAL", "FONT_PATH")?.trim() ?? ""
}

function resolveStyleFont(reference: string, scope = theme.value): string | undefined {
  if (!appState.archive || !reference) return
  return resolveFontReference(appState.archive.names(), reference, fontSearchDirectories(fontStylePath(scope)))
}

function replaceText(changes: Change[], path: string, text: string, after: string | undefined): void {
  if (after !== undefined) changes.push({ kind: "text", path, before: text, after })
}

/** 字体候选与画布使用同一个文件解析器；系统字体仍可直接输入。 */
export function skinFontChoices(inherited = "", sourcePath = styleConfigPath()): FontChoice[] {
  const archive = appState.archive
  const make = (value: string, label = value): FontChoice => {
    const reference = value || inherited
    const path = archive && (archive.format === "ssf" ? ssfPackage()?.path(ssfTheme(), reference)
      : isFontFile(reference) && archive.getBytes(reference) ? reference : embeddedFontPath(archive.names(), sourcePath, reference, true))
    return { value, label, detail: path, ...(path && archive ? loadEmbeddedFont(archive, path) : { family: reference || undefined }),
      missing: Boolean(reference && !path && isFontFile(reference)) }
  }
  if (archive?.format === "sxi" || archive?.format === "bda") return SYSTEM_FONTS.map(choice => make(choice.value, choice.label))
  const names = [...new Set(skinFontFiles(archive?.names() ?? []).filter(path => !["bdi", "bds"].includes(archive?.format ?? "") || themeOfPath(path) === themeOfPath(sourcePath)).map(path => path.split("/").pop()!))]
  return [make("", inherited ? "继承皮肤字体" : "系统默认"), ...names.map(name => make(name))]
}

export function styleFontChoices(): FontChoice[] {
  return skinFontChoices(styleFontReference())
}

/** 皮肤默认字体与当前文字使用同一个紧凑字段，导入/移除只影响所属模式。 */
export function skinFontField(scope = theme.value): HTMLElement | undefined {
  if (!fontStylePaths(scope).length) return
  const reference = styleFontReference(scope)
  const choices = skinFontChoices("", fontStylePath(scope))
  const hint = `皮肤字体（GLOBAL FONT_PATH）：${scope === "dark" ? "深色" : "浅色"}模式共用的默认字体`
  const row = field({ key: "FONT_PATH", rowKey: ["typography", "FONT_PATH"], label: "皮肤字体", hint, spec: { kind: "font", value: reference.split("/").pop() ?? "", choices }, editable: isEditing(), commit: value => setGlobalFont(value, scope) })
  row.id = "font-file-field"
  row.title = hint
  const actions = element("span", "ui-field-actions")
  const upload = iconButton("upload", "导入字体文件", () => { fontImportInput.dataset.theme = scope; fontImportInput.value = ""; fontImportInput.click() })
  upload.id = "font-import"
  upload.disabled = !isEditing()
  const remove = iconButton("trash-2", "移除皮肤字体", () => removeSelectedFont(scope))
  remove.id = "font-remove"
  remove.disabled = !isEditing() || !reference
  actions.append(upload, remove)
  row.append(actions)
  row.querySelector("button.ui-font-picker")!.id = "font-file-picker"
  return row
}

/** 确保选中字体在每个主题都有副本；优先复用主题根 res，避免每个方向各存一份。 */
function ensureThemeFont(theme: string, fontPath: string, changes: Change[]): string {
  if (fontPath.startsWith(`${theme}/skin/`)) return fontPath
  const path = `${theme}/skin/res/${fontPath.split("/").pop()}`
  const existing = appState.archive?.getBytes(path)
  if (existing) return path
  const bytes = appState.archive?.getBytes(fontPath)
  if (!bytes) return fontPath
  changes.push({ kind: "bytes", path, before: undefined, after: bytes.slice() })
  return path
}

/** 把选中的字体应用为当前模式各份 CSS 的 GLOBAL FONT_PATH；空值恢复系统默认。 */
function setGlobalFont(value: string, scope = theme.value): void {
  if (!isEditing()) return
  const archive = appState.archive
  const styles = fontStylePaths(scope)
  if (!archive || !styles.length) return
  const fontPath = value ? archive.getBytes(value) && isFontFile(value) ? value : resolveStyleFont(value, scope) : undefined
  if (value && !fontPath) {
    showError(new Error("皮肤里找不到这个字体文件"), "设置字体")
    return
  }
  const changes: Change[] = []
  const themeFonts = new Map<string, string>()
  if (fontPath) for (const theme of new Set(styles.map(themeOfPath))) {
    themeFonts.set(theme, ensureThemeFont(theme, fontPath, changes))
  }
  for (const path of styles) {
    const text = archive.getText(path)
    const target = themeFonts.get(themeOfPath(path))
    replaceText(changes, path, text, withGlobalFontPath(text, target ? relativeArchivePath(path, target) : ""))
  }
  if (!changes.length) return
  commitBatch(changes)
  refreshPreview()
  populateKeyInspector()
  renderResourceCatalogSearch()
  updateDirty()
}

/** 移除当前模式的 GLOBAL 字体文件与引用（可撤销）。 */
async function removeSelectedFont(scope = theme.value): Promise<void> {
  if (!isEditing()) return
  const archive = appState.archive
  const styles = fontStylePaths(scope)
  if (!archive || !styles.length) return
  const reference = styleFontReference(scope)
  const resolved = resolveStyleFont(reference, scope)
  const fileName = (resolved ?? reference).split("/").pop() ?? ""
  const stem = fileName.replace(/\.(?:ttf|otf|ttc)$/i, "").toLowerCase()
  if (!stem) return
  const removed = new Set<string>()
  if (resolved) removed.add(resolved)
  for (const path of skinFontFiles(archive.names())) {
    if (!path.startsWith(`${scope}/skin/res/`)) continue
    if ((path.split("/").pop() ?? "").replace(/\.(?:ttf|otf|ttc)$/i, "").toLowerCase() === stem) removed.add(path)
  }
  const changes: Change[] = [...removed].map((path) => ({
    kind: "bytes" as const,
    path,
    before: archive.getBytes(path)?.slice(),
    after: undefined,
  }))
  for (const path of styles) {
    const text = archive.getText(path)
    replaceText(changes, path, text, withFontReferencesCleared(text, path, archive.names(), removed, stem))
  }
  if (!changes.length) {
    showStatus("当前字体没有需要移除的文件或引用")
    return
  }
  const revision = archive.revision
  if (!await confirmDeletion(`删除字体「${fileName}」？`, "字体引用也将被清除，删除后可撤销恢复。")
    || appState.archive !== archive || archive.revision !== revision || !isEditing()) return
  commitBatch(changes)
  refreshPreview()
  populateKeyInspector()
  renderResourceCatalogSearch()
  updateDirty()
  showStatus(`已移除字体 ${fileName}`)
}

/** Rejects bytes the browser cannot load as a font. */
export async function validateFont(bytes: Uint8Array): Promise<void> {
  if (typeof FontFace === "undefined") return
  const data = bytes.slice().buffer
  await new FontFace("BdiFontValidation", data).load()
}

/** 从磁盘导入字体：校验能加载，写入当前模式根 res 与各份 CSS 的 GLOBAL FONT_PATH。 */
export async function importFontFile(file: File, scope = theme.value): Promise<void> {
  if (!isEditing()) return
  const archive = appState.archive
  const styles = fontStylePaths(scope)
  if (!archive || !styles.length) return
  try {
    if (!isFontFile(file.name)) throw new Error("只支持 .ttf / .otf / .ttc 字体文件")
    const bytes = new Uint8Array(await file.arrayBuffer())
    await validateFont(bytes)
    // 读文件和校验期间换了皮肤或离开编辑模式：改动是按原来的皮肤算的，不能写进现在的皮肤。
    if (appState.archive !== archive || !isEditing()) return
    const fileName = uniqueFontFileName(sanitizeFontFileName(file.name), archive.names().filter(path => themeOfPath(path) === scope))
    const changes: Change[] = []
    const themeFonts = new Map<string, string>()
    for (const theme of new Set(styles.map(themeOfPath))) {
      const path = `${theme}/skin/res/${fileName}`
      themeFonts.set(theme, path)
      changes.push({ kind: "bytes", path, before: undefined, after: bytes.slice() })
    }
    for (const path of styles) {
      const target = themeFonts.get(themeOfPath(path))
      if (!target) continue
      const text = archive.getText(path)
      replaceText(changes, path, text, withGlobalFontPath(text, relativeArchivePath(path, target)))
    }
    commitBatch(changes)
    refreshPreview()
    populateKeyInspector()
    renderResourceCatalogSearch()
    updateDirty()
    showStatus(`已导入字体 ${fileName}`)
  } catch (error) {
    showError(error, "导入字体")
  }
}
