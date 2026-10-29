// 皮肤字体替换：导入 / 移除字体文件，并把 [GLOBAL] FONT_PATH 与 [STYLE*] FONT_NAME
// 同步到皮肤的每份 CSS（light/dark × port/land 或单布局），真机与预览都读同一套路径。
import { appState } from "./state"
import { IniDocument } from "../ini.ts"
import { commitBatch, isEditing, updateDirty } from "./edit-history"
import { refreshPreview } from "./preview-render"
import { populateKeyInspector } from "./key-inspector"
import { showError, showStatus } from "./file-operations"
import { styleConfigPath } from "./config-context"
import { fontFileField, fontFileSelect, fontImportButton, fontNameInput, fontRemoveButton, skinFontNames } from "./dom"
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
function fontStylePaths(): string[] {
  const archive = appState.archive
  if (!archive || archive.format !== "bdi" && archive.format !== "bds") return []
  return skinStylePaths(archive.names())
}

function styleFontReference(): string {
  const archive = appState.archive
  const path = styleConfigPath()
  if (!archive?.isText(path)) return ""
  return IniDocument.parse(archive.getText(path)).get("GLOBAL", "FONT_PATH")?.trim() ?? ""
}

function resolveStyleFont(reference: string): string | undefined {
  if (!appState.archive || !reference) return
  return resolveFontReference(appState.archive.names(), reference, fontSearchDirectories(styleConfigPath()))
}

function replaceText(changes: Change[], path: string, text: string, after: string | undefined): void {
  if (after !== undefined) changes.push({ kind: "text", path, before: text, after })
}

/** 下拉里一行显示文件名；完整归档路径放在 title 上，便于区分同名文件。 */
function fontOption(path: string): HTMLOptionElement {
  const option = new Option(path.split("/").pop() ?? path, path)
  option.title = path
  return option
}

function populateFontSelect(styles: string[]): void {
  const archive = appState.archive
  if (!archive) return
  const reference = styleFontReference()
  const current = resolveStyleFont(reference)
  const fonts = skinFontFiles(archive.names())
  const nodes: Array<HTMLOptionElement | HTMLOptGroupElement> = [new Option("系统默认", "")]
  for (const theme of [...new Set(styles.map(themeOfPath))]) {
    const options = fonts.filter((path) => themeOfPath(path) === theme).map(fontOption)
    if (!options.length) continue
    const group = document.createElement("optgroup")
    group.label = theme === "dark" ? "深色主题字体" : "浅色主题字体"
    group.append(...options)
    nodes.push(group)
  }
  if (reference && !current) nodes.push(new Option(`${reference}（缺失）`, `missing:${reference}`))
  fontFileSelect.replaceChildren(...nodes)
  fontFileSelect.value = current ?? (reference ? `missing:${reference}` : "")
  fontFileSelect.disabled = !isEditing()
}

/** FONT_NAME 的候选项：皮肤内字体文件名（可带/不带扩展名）加“系统默认”，仍允许手输系统字体名。 */
function populateFontNameOptions(available: boolean): void {
  skinFontNames.replaceChildren()
  if (!available) {
    fontNameInput.removeAttribute("list")
    return
  }
  fontNameInput.setAttribute("list", "skin-font-names")
  const archive = appState.archive
  const values = new Set(["系统默认"])
  const options = [new Option("系统默认", "")]
  for (const path of skinFontFiles(archive?.names() ?? [])) {
    const name = path.split("/").pop() ?? path
    for (const value of new Set([name, name.replace(/\.(?:ttf|otf|ttc)$/i, "")])) {
      if (values.has(value)) continue
      values.add(value)
      options.push(new Option(value, value))
    }
  }
  skinFontNames.append(...options)
}

export function populateFontControls(): void {
  const styles = fontStylePaths()
  const available = styles.length > 0
  fontFileField.hidden = !available
  fontImportButton.disabled = !available || !isEditing()
  fontRemoveButton.disabled = !available || !isEditing() || !styleFontReference()
  if (available) populateFontSelect(styles)
  populateFontNameOptions(available)
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

/** 把选中的字体应用为每份 CSS 的 GLOBAL FONT_PATH；空值表示恢复系统默认。 */
export function setGlobalFont(value: string): void {
  if (!isEditing() || value.startsWith("missing:")) return
  const archive = appState.archive
  const styles = fontStylePaths()
  if (!archive || !styles.length) return
  const fontPath = value ? archive.getBytes(value) && isFontFile(value) ? value : resolveStyleFont(value) : undefined
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
  updateDirty()
}

/** 移除当前 GLOBAL 字体：删掉各主题下的字体文件，并清掉所有 CSS 里的引用（可撤销）。 */
export function removeSelectedFont(): void {
  if (!isEditing()) return
  const archive = appState.archive
  const styles = fontStylePaths()
  if (!archive || !styles.length) return
  const reference = styleFontReference()
  const resolved = resolveStyleFont(reference)
  const fileName = (resolved ?? reference).split("/").pop() ?? ""
  const stem = fileName.replace(/\.(?:ttf|otf|ttc)$/i, "").toLowerCase()
  if (!stem) return
  const removed = new Set<string>()
  if (resolved) removed.add(resolved)
  for (const path of skinFontFiles(archive.names())) {
    if (!/^(?:light|dark)\/skin\/res\//i.test(path)) continue
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
  commitBatch(changes)
  refreshPreview()
  populateKeyInspector()
  updateDirty()
  showStatus(`已移除字体 ${fileName}。`)
}

/** Rejects bytes the browser cannot load as a font. */
export async function validateFont(bytes: Uint8Array): Promise<void> {
  if (typeof FontFace === "undefined") return
  const data = bytes.slice().buffer
  await new FontFace("BdiFontValidation", data).load()
}

/** 从磁盘导入字体：校验能加载，按主题根 res 各存一份，并写进每份 CSS 的 GLOBAL FONT_PATH。 */
export async function importFontFile(file: File): Promise<void> {
  if (!isEditing()) return
  const archive = appState.archive
  const styles = fontStylePaths()
  if (!archive || !styles.length) return
  try {
    if (!isFontFile(file.name)) throw new Error("只支持 .ttf / .otf / .ttc 字体文件")
    const bytes = new Uint8Array(await file.arrayBuffer())
    await validateFont(bytes)
    // 读文件和校验期间换了皮肤或离开编辑模式：改动是按原来的皮肤算的，不能写进现在的皮肤。
    if (appState.archive !== archive || !isEditing()) return
    const fileName = uniqueFontFileName(sanitizeFontFileName(file.name), archive.names())
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
    updateDirty()
    showStatus(`已导入字体 ${fileName}。`)
  } catch (error) {
    showError(error, "导入字体")
  }
}
