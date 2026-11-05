// 皮肤字体替换：导入 / 移除字体文件，并把 [GLOBAL] FONT_PATH 与 [STYLE*] FONT_NAME
// 同步到皮肤的每份 CSS（light/dark × port/land 或单布局）；BDS 另把按键文字烘焙成图片（font-bake.ts）。
import { appState } from "./state"
import { IniDocument } from "../ini.ts"
import { commitBatch, isEditing, updateDirty } from "./edit-history"
import { refreshPreview } from "./preview-render"
import { populateKeyInspector } from "./key-inspector"
import { composePng, showError, showStatus } from "./file-operations"
import { styleConfigPath } from "./config-context"
import { fontFileField, fontFileSelect, fontImportButton, fontNameInput, fontRemoveButton, skinFontNames } from "./dom"
import { type Change } from "../history.ts"
import { parseColor } from "../atlas.ts"
import {
  bakeableStyles,
  bakedImageBase,
  bakedTileText,
  keyForegroundStyleIDs,
  layoutsUsingStyle,
  packTiles,
  withBakedStyles,
  withoutBakedStyles,
} from "../font-bake.ts"
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

/** FONT_NAME 的候选项：皮肤内字体文件名（带 / 不带扩展名），仍允许手输系统字体名。 */
export function skinFontNameOptions(): string[] {
  const names = (skinFontFiles(appState.archive?.names() ?? [])).flatMap((path) => {
    const name = path.split("/").pop() ?? path
    return [name, name.replace(/\.(?:ttf|otf|ttc)$/i, "")]
  })
  return [...new Set(names)]
}

function populateFontNameOptions(available: boolean): void {
  skinFontNames.replaceChildren()
  if (!available) {
    fontNameInput.removeAttribute("list")
    return
  }
  fontNameInput.setAttribute("list", "skin-font-names")
  skinFontNames.append(new Option("系统默认", ""), ...skinFontNameOptions().map((name) => new Option(name, name)))
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

let bakeFontID = 0

/** 把字体注册进页面，返回可在画布上使用的字体族名；字体无法加载时抛错。 */
async function loadBakeFont(bytes: Uint8Array): Promise<string> {
  const family = `KeySkinBakeFont${++bakeFontID}`
  document.fonts.add(await new FontFace(family, bytes.slice().buffer).load())
  return family
}

/** 一段按键文字：按 FONT_SIZE 画在透明底上，以文字中线居中，与真机前景图的居中方式一致。 */
function renderLabel(text: string, fontSize: number, family: string, color: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas")
  const context = canvas.getContext("2d")
  if (!context) throw new Error("无法创建文字画布")
  const font = `${fontSize}px "${family}"`
  context.font = font
  canvas.width = Math.max(1, Math.ceil(context.measureText(text).width) + 4)
  canvas.height = Math.max(1, Math.ceil(fontSize * 1.5))
  // 改尺寸会重置画布状态，字体与对齐要在之后设置。
  context.font = font
  context.fillStyle = color
  context.textAlign = "center"
  context.textBaseline = "middle"
  context.fillText(text, canvas.width / 2, canvas.height / 2)
  return canvas
}

function replaceBytes(changes: Change[], path: string, after: Uint8Array | undefined): void {
  const before = appState.archive?.getBytes(path)?.slice()
  if (before || after) changes.push({ kind: "bytes", path, before, after })
}

/**
 * 百度安卓不会用皮肤字体画按键文字（每次初始化键盘都重置为系统字体），BDS 只能把按键上的固定文字
 * 用皮肤字体画成图片。texts 是各 CSS 改完 FONT_PATH 之后的文本，返回烘焙后的文本；
 * fontBytes 为空时撤销烘焙并删除图集。
 */
async function bakeStyleTexts(texts: Map<string, string>, fontBytes: Uint8Array | undefined, changes: Change[]): Promise<Map<string, string>> {
  const archive = appState.archive
  if (archive?.format !== "bds") return texts
  const result = new Map(texts)
  const family = fontBytes && await loadBakeFont(fontBytes)
  for (const [path, text] of texts) {
    const base = bakedImageBase(path)
    if (!family) {
      result.set(path, withoutBakedStyles(text) ?? text)
      replaceBytes(changes, `${base}.png`, undefined)
      replaceBytes(changes, `${base}.til`, undefined)
      continue
    }
    const layouts = layoutsUsingStyle(archive.names(), path).map((layout) => archive.getText(layout))
    const styles = bakeableStyles(text, keyForegroundStyleIDs(layouts))
    if (!styles.length) continue
    const fallbackColor = themeOfPath(path) === "dark" ? "#f5f5f7" : "#17191c"
    const labels: HTMLCanvasElement[] = []
    const tiles = styles.map(({ id, fields }) => {
      const fontSize = Number(fields.FONT_SIZE) > 0 ? Number(fields.FONT_SIZE) : 24
      const normalColor = parseColor(fields.NM_COLOR) ?? fallbackColor
      const highlightColor = parseColor(fields.HL_COLOR) ?? normalColor
      labels.push(renderLabel(fields.SHOW.trim(), fontSize, family, normalColor))
      const normal = labels.length
      if (highlightColor !== normalColor) labels.push(renderLabel(fields.SHOW.trim(), fontSize, family, highlightColor))
      return { id, normal, highlight: labels.length }
    })
    const atlas = packTiles(labels)
    const png = await composePng(atlas.width, atlas.height, labels.map((image, index) => ({ image, rect: atlas.rects[index] })))
    replaceBytes(changes, `${base}.png`, png)
    replaceBytes(changes, `${base}.til`, new TextEncoder().encode(bakedTileText(atlas.rects)))
    result.set(path, withBakedStyles(text, tiles))
  }
  return result
}

/** 各 CSS 改写 GLOBAL FONT_PATH 并按需烘焙按键文字，合成一步撤销。读文件或渲染期间换了皮肤 / 离开编辑模式则放弃。 */
async function commitFontChange(changes: Change[], fontPaths: Map<string, string>, fontBytes: Uint8Array | undefined): Promise<boolean> {
  const archive = appState.archive
  if (!archive) return false
  const styles = fontStylePaths()
  const texts = new Map(styles.map((path) => {
    const text = archive.getText(path)
    const target = fontPaths.get(themeOfPath(path))
    return [path, withGlobalFontPath(text, target ? relativeArchivePath(path, target) : "") ?? text]
  }))
  const baked = await bakeStyleTexts(texts, fontBytes, changes)
  if (appState.archive !== archive || !isEditing()) return false
  for (const path of styles) {
    const text = archive.getText(path)
    const after = baked.get(path)
    replaceText(changes, path, text, after === text ? undefined : after)
  }
  if (!changes.length) return false
  commitBatch(changes)
  refreshPreview()
  populateKeyInspector()
  updateDirty()
  return true
}

/** 把选中的字体应用为每份 CSS 的 GLOBAL FONT_PATH；空值表示恢复系统默认。 */
export async function setGlobalFont(value: string): Promise<void> {
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
  try {
    await commitFontChange(changes, themeFonts, fontPath ? archive.getBytes(fontPath) : undefined)
  } catch (error) {
    showError(error, "设置字体")
  }
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
  const texts = new Map(styles.map((path) => {
    const text = archive.getText(path)
    const cleared = withFontReferencesCleared(text, path, archive.names(), removed, stem) ?? text
    return [path, archive.format === "bds" ? withoutBakedStyles(cleared) ?? cleared : cleared]
  }))
  if (archive.format === "bds") for (const path of styles) {
    replaceBytes(changes, `${bakedImageBase(path)}.png`, undefined)
    replaceBytes(changes, `${bakedImageBase(path)}.til`, undefined)
  }
  for (const path of styles) {
    const text = archive.getText(path)
    const after = texts.get(path)
    replaceText(changes, path, text, after === text ? undefined : after)
  }
  if (!changes.length) {
    showStatus("当前字体没有需要移除的文件或引用")
    return
  }
  commitBatch(changes)
  refreshPreview()
  populateKeyInspector()
  updateDirty()
  showStatus(`已移除字体 ${fileName}`)
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
    if (!await commitFontChange(changes, themeFonts, bytes)) return
    showStatus(`已导入字体 ${fileName}`)
  } catch (error) {
    showError(error, "导入字体")
  }
}
