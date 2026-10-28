import { theme, layout, layoutImageSize, layoutImagePreview, layoutImageFileLabel, layoutImageFile, layoutImageApply, canvasWrap, orientation, layoutImageLayout, layoutImageScope, layoutImageError, layoutImageTargetInputs, layoutImageDialog, layoutImageConfigButtons, layoutImageConfigDesc, layoutImageConfigFieldset } from "./dom"
import { IniDocument, normalizeKeySections } from "../ini.ts"
import { appState } from "./state"
import { currentConfigPath, styleConfigPath, genConfigPath, toolbarConfigPath, setSourceValue, layoutSource } from "./config-context"
import { type LayoutImageTarget, type LayoutKeyGeometry, planLayoutImage, layoutImageTileBytes, applyCandidateImageStyles, layoutKeyRects, type LayoutImagePlan, validateKeyRects, matchLayoutKeysToCells, planLayoutImageSlices, applyLayoutImageRects, applyLayoutImageStyles } from "../layout-image.ts"
import { resolvePanelConfig } from "../keyboard.ts"
import { resolveCandidateRect } from "../candidate-style.ts"
import { fitPngTo, showStatus, decodePngMask } from "./file-operations"
import { commitBatch, updateDirty } from "./edit-history"
import { renderFiles } from "./file-tree"
import { selectFile } from "./navigation"
import { refreshPreview } from "./preview-render"
import { detectGridCells } from "../layout-scan.ts"
import { type TileRect } from "../tiles.ts"
import { populateKeyInspector } from "./key-inspector"
import { type LayoutImageConfig } from "./types"
import { styleConfigDocument } from "./style-picker"
import { replaceSsfLayoutImage, replaceSxiLayoutImage } from "./layout-image-native"
import { isSxiBoardAddress, sxiPointer } from "./sxi-documents"
import { palmBoardLabel } from "../palm/palm-labels.ts"

// 替换键盘样式
export function resourceRootPath(): string {
  return `${theme.value}/skin/res`
}

function currentLayoutDocument(): IniDocument | undefined {
  if (!appState.archive || appState.archive.format === "bda") return
  if (appState.archive.isText(appState.layoutPath)) return IniDocument.parse(appState.archive.getText(appState.layoutPath))
  const path = currentConfigPath(layout.value)
  return appState.archive.isText(path) ? IniDocument.parse(appState.archive.getText(path)) : appState.layoutDocument
}

export function currentGenDocument(): IniDocument | undefined {
  const path = genConfigPath()
  const source = layoutSource()
  return source?.isText(path) ? IniDocument.parse(source.getText(path)) : undefined
}

export function nextResourceBase(root = resourceRootPath()): string {
  let base = `${root}/replace_image`
  let suffix = 2
  while (appState.archive?.names().some((path) => path === `${base}.png` || path === `${base}.til`)) {
    base = `${root}/replace_image${suffix}`
    suffix += 1
  }
  return base
}

export function updateLayoutImageForm(): void {
  const hasImage = appState.layoutImageWidth > 0 && appState.layoutImageHeight > 0
  layoutImageSize.textContent = hasImage
    ? `${appState.layoutImageWidth} × ${appState.layoutImageHeight} · 点击可更换`
    : "支持 PNG · 也可以直接拖到画布"
  layoutImagePreview.hidden = !hasImage
  layoutImageFileLabel.hidden = hasImage
  layoutImageFile.classList.toggle("has-image", hasImage)
  layoutImageApply.disabled =
    !appState.archive || appState.archive.format === "bda" || !hasImage || !appState.layoutImageTarget || appState.layoutImageApplying
}

export function setLayoutImageHighlight(active: boolean): void {
  if (appState.layoutImageHighlight === active) return
  appState.layoutImageHighlight = active
  canvasWrap.classList.toggle("layout-image-target", active)
}

/** What the chosen target replaces, under the targets. */
export function layoutImageScopeText(): string {
  const target = appState.layoutImageTarget
  if (target === "panel") return "替换当前布局的完整背景。"
  if (target === "candidate") return "替换当前主题候选栏的背景图片。"
  const keys = appState.selectedKeySections.length
    ? `已选中 ${appState.selectedKeySections.length} 个按键，将只替换这些按键。`
    : "未选中按键，将替换当前布局的全部按键。"
  // A Sogou key has a single foreground image.
  return appState.archive?.format === "ssf" && target?.startsWith("fore") ? `${keys}搜狗按键只有一层前景，图片会替换现有前景。` : keys
}

export function openLayoutImageDialog(): void {
  if (!appState.archive || appState.archive.format === "bda") return
  // A Palm board is read from skin.json; Palm and Sogou styles live in skin.json / phoneSkin.ini, not a default.css.
  const palmBoard = sxiPointer(appState.layoutPath)
  if (appState.archive.format === "sxi" ? !isSxiBoardAddress(appState.layoutPath) : !currentLayoutDocument()) return
  if (appState.archive.format !== "sxi" && appState.archive.format !== "ssf" && !styleConfigDocument()) return
  const themeLabel = theme.value === "dark" ? "深色" : "浅色"
  const orientationLabel = orientation.value === "land" ? "横屏" : "竖屏"
  const name = palmBoard ? palmBoardLabel(palmBoard[3]) : appState.layoutPath.split("/").pop() ?? "布局"
  layoutImageLayout.textContent = `当前布局：${name}（${themeLabel} · ${orientationLabel}）`
  layoutImageError.hidden = true
  layoutImageError.textContent = ""
  if (!appState.layoutImageTarget) {
    appState.layoutImageTarget = appState.selectedKeySections.length ? "key-normal" : "panel"
    layoutImageTargetInputs.find((input) => input.value === appState.layoutImageTarget)!.checked = true
  }
  layoutImageScope.textContent = layoutImageScopeText()
  syncLayoutImageConfig()
  updateLayoutImageForm()
  layoutImageDialog.showModal()
  // 选择器必须在 showModal 之后触发，否则部分 WebView（含 Tauri）不会弹出系统文件框。
  if (!appState.layoutImageBytes) layoutImageFile.click()
}

export function setLayoutImageBytes(bytes: Uint8Array): void {
  if (appState.layoutImageObjectURL) URL.revokeObjectURL(appState.layoutImageObjectURL)
  appState.layoutImageObjectURL = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: "image/png" }))
  appState.layoutImageBytes = bytes
  appState.layoutImageWidth = 0
  appState.layoutImageHeight = 0
  layoutImagePreview.src = appState.layoutImageObjectURL
  layoutImageError.hidden = true
  layoutImageError.textContent = ""
  updateLayoutImageForm()
  const image = new Image()
  image.onload = () => {
    appState.layoutImageWidth = image.naturalWidth
    appState.layoutImageHeight = image.naturalHeight
    updateLayoutImageForm()
  }
  image.onerror = () => {
    layoutImageError.textContent = "无法读取该图片，请确认选择的是有效的 PNG 文件。"
    layoutImageError.hidden = false
    updateLayoutImageForm()
  }
  image.src = appState.layoutImageObjectURL
}

export function layoutImageTargetLabel(target: LayoutImageTarget): string {
  switch (target) {
    case "panel": return "键盘背景"
    case "key-normal": return "正常按键背景"
    case "key-highlight": return "按下按键背景"
    case "fore-normal": return "按键前景"
    case "fore-highlight": return "按键按下前景"
    case "candidate": return "候选栏背景样式"
  }
}

export async function applyLayoutImage(): Promise<void> {
  if (appState.layoutImageApplying) return
  appState.layoutImageApplying = true
  layoutImageApply.textContent = "正在应用…"
  updateLayoutImageForm()
  try {
    await runLayoutImageReplace()
  } catch (error) {
    layoutImageError.textContent = `替换失败：${error instanceof Error ? error.message : String(error)}`
    layoutImageError.hidden = false
  } finally {
    appState.layoutImageApplying = false
    layoutImageApply.textContent = "应用替换"
    updateLayoutImageForm()
  }
}

export function showLayoutImageError(text: string): void {
  layoutImageError.textContent = text
  layoutImageError.hidden = false
}

type SlicedLayoutImage = { source: Uint8Array; plan: LayoutImagePlan; width: number; height: number }

/**
 * The chosen picture sliced for the panel or the keys: fitted to the panel (无跟随), or cut along the
 * key grid found in the picture, the keys either keeping their rects (图片跟随布局) or taking the
 * grid's (布局跟随图片, `matchKeys` pairs them). Undefined after showing why it cannot be sliced.
 */
export async function sliceLayoutImage(
  keys: LayoutKeyGeometry[],
  panelWidth: number,
  panelHeight: number,
  matchKeys: (keys: LayoutKeyGeometry[], cells: TileRect[]) => LayoutKeyGeometry[] | undefined,
): Promise<SlicedLayoutImage | undefined> {
  const target = appState.layoutImageTarget!
  let source = appState.layoutImageBytes!
  if (appState.layoutImageConfig === "none" || target === "panel") {
    // 布局配置仅对按键类目标生效，面板替换始终按整图处理
    if (target !== "panel") {
      const rectError = validateKeyRects(keys, panelWidth, panelHeight)
      if (rectError) return void showLayoutImageError(rectError)
    }
    if (appState.layoutImageWidth !== panelWidth || appState.layoutImageHeight !== panelHeight) {
      source = await fitPngTo(source, panelWidth, panelHeight)
    }
    return { source, plan: planLayoutImage(target, keys, IniDocument.parse(""), panelWidth, panelHeight), width: panelWidth, height: panelHeight }
  }
  // 图片跟随布局 / 布局跟随图片：按图片空白检测按键网格，切片源取自图片
  const scan = await decodePngMask(source)
  let cells = detectGridCells(scan.mask, scan.width, scan.height)
  if (!cells.length) return void showLayoutImageError("无法在图片中识别按键区域，请检查图片是否包含透明间隔。")
  if (appState.layoutImageConfig === "image-follows-layout" && cells.length === 1 && keys.length) {
    const maxWidth = Math.max(...keys.map(({ rect }) => rect[2]))
    const maxHeight = Math.max(...keys.map(({ rect }) => rect[3]))
    const scale = Math.min(1, maxWidth / scan.width, maxHeight / scan.height)
    if (scale < 1) {
      const width = Math.max(1, Math.round(scan.width * scale))
      const height = Math.max(1, Math.round(scan.height * scale))
      source = await fitPngTo(source, width, height)
      cells = cells.map(([x, y, cellWidth, cellHeight]) => [
        Math.round(x * scale),
        Math.round(y * scale),
        Math.max(1, Math.round(cellWidth * scale)),
        Math.max(1, Math.round(cellHeight * scale)),
      ])
    }
  }
  const matchedKeys = appState.layoutImageConfig === "layout-follows-image" ? matchKeys(keys, cells) : keys
  if (!matchedKeys) return
  return { source, plan: planLayoutImageSlices(target, matchedKeys, cells, IniDocument.parse("")), width: scan.width, height: scan.height }
}

async function runLayoutImageReplace(): Promise<void> {
  if (!appState.archive || !appState.layoutImageBytes || !appState.layoutImageTarget) return
  if (appState.layoutImageTarget === "panel" && appState.selectedKeySections.length) {
    return showLayoutImageError("键盘背景替换作用于整个布局，请先取消按键选择。")
  }
  if (appState.archive.format === "sxi") return replaceSxiLayoutImage()
  if (appState.archive.format === "ssf") return replaceSsfLayoutImage()
  const layout = currentLayoutDocument()
  const styles = styleConfigDocument()
  const gen = currentGenDocument()
  if (!layout || !styles || !gen) return
  // 每次都从最初选中的图片开始切片；复用上一次缩放后的字节会逐次降采样。
  let source = appState.layoutImageBytes
  const panel = resolvePanelConfig(layout, gen, styles)
  const alphaMode = appState.archive.format === "bds" ? 1 : 2
  if (appState.layoutImageTarget === "candidate") {
    const candPath = toolbarConfigPath()
    const cand = candPath && appState.archive.isText(candPath) ? IniDocument.parse(appState.archive.getText(candPath)) : undefined
    if (!candPath || !cand) return showLayoutImageError("当前主题未找到候选栏配置文件。")
    const candidateRect = resolveCandidateRect(cand, gen)
    if (appState.layoutImageWidth !== candidateRect.width || appState.layoutImageHeight !== candidateRect.height) {
      source = await fitPngTo(source, candidateRect.width, candidateRect.height)
    }
    const base = nextResourceBase()
    const plan = planLayoutImage(appState.layoutImageTarget, [], IniDocument.parse(""), candidateRect.width, candidateRect.height)
    const tilesBytes = layoutImageTileBytes(plan, alphaMode)
    const stylesDoc = IniDocument.parse(styles.toString())
    const candDoc = IniDocument.parse(cand.toString())
    applyCandidateImageStyles(stylesDoc, candDoc, plan, base.split("/").pop()!)
    const pngPath = `${base}.png`
    const tilPath = `${base}.til`
    const stylePath = styleConfigPath()
    commitBatch([
      { kind: "bytes", path: pngPath, before: appState.archive.getBytes(pngPath), after: source },
      { kind: "bytes", path: tilPath, before: appState.archive.getBytes(tilPath), after: tilesBytes },
      { kind: "text", path: candPath, before: cand.toString(), after: candDoc.toString() },
      { kind: "text", path: stylePath, before: styles.toString(), after: stylesDoc.toString() },
    ])
    layoutImageDialog.close()
    if (appState.selectedPath === candPath) {
      appState.selectedDocument = candDoc
      setSourceValue(candDoc.toString())
    }
    renderFiles()
    selectFile(candPath)
    refreshPreview()
    updateDirty()
    showStatus(`已应用「${layoutImageTargetLabel(appState.layoutImageTarget)}」替换`)
    return
  }
  const keys = layoutKeyRects(layout, appState.selectedKeySections, [panel.width, panel.height])
  const layoutDoc = IniDocument.parse(layout.toString())
  const sliced = await sliceLayoutImage(keys, panel.width, panel.height, (ordered, cells) => matchLayoutKeysToCells(layoutDoc, ordered, cells))
  if (!sliced) return
  const { plan } = sliced
  source = sliced.source
  const base = nextResourceBase()
  const tilesBytes = layoutImageTileBytes(plan, alphaMode)
  const stylesDoc = IniDocument.parse(styles.toString())
  if (appState.layoutImageConfig === "layout-follows-image" && appState.layoutImageTarget !== "panel") {
    // 布局跟随图片：把按键矩形与面板尺寸改写为图片网格
    applyLayoutImageRects(layoutDoc, plan.keys, plan.slices.map((slice) => slice.source), sliced.width, sliced.height)
  }
  applyLayoutImageStyles(appState.layoutImageTarget, layoutDoc, stylesDoc, plan, base.split("/").pop()!)
  normalizeKeySections(layoutDoc)
  const pngPath = `${base}.png`
  const tilPath = `${base}.til`
  const targetPath = appState.layoutPath
  const stylePath = styleConfigPath()
  commitBatch([
    { kind: "bytes", path: pngPath, before: appState.archive.getBytes(pngPath), after: source },
    { kind: "bytes", path: tilPath, before: appState.archive.getBytes(tilPath), after: tilesBytes },
    { kind: "text", path: targetPath, before: layout.toString(), after: layoutDoc.toString() },
    { kind: "text", path: stylePath, before: styles.toString(), after: stylesDoc.toString() },
  ])
  appState.layoutDocument = layoutDoc
  layoutImageDialog.close()
  if (appState.selectedPath === targetPath) {
    appState.selectedDocument = layoutDoc
    setSourceValue(layoutDoc.toString())
  }
  renderFiles()
  selectFile(targetPath)
  refreshPreview()
  populateKeyInspector()
  updateDirty()
  showStatus(`已应用「${layoutImageTargetLabel(appState.layoutImageTarget)}」替换`)
}

export function acceptLayoutImageFile(file: File | undefined): boolean {
  if (!file) return false
  if (!/\.png$/i.test(file.name) && file.type !== "image/png") {
    layoutImageError.textContent = "只支持 PNG 图片。"
    layoutImageError.hidden = false
    return false
  }
  const reader = new FileReader()
  reader.onload = () => setLayoutImageBytes(new Uint8Array(reader.result as ArrayBuffer))
  reader.readAsArrayBuffer(file)
  return true
}

const layoutImageConfigDescriptions: Record<LayoutImageConfig, string> = {
  none: "保持当前布局，图片按面板尺寸缩放后替换按键区域。",
  "image-follows-layout": "图片不按键盘布局切片，而是识别图片自身的按键区域并切片，再拉伸贴到按键上，不改布局。",
  "layout-follows-image": "识别图片的按键布局，把当前键盘布局的按键区域改为图片的布局，再导入切片。",
}

export function syncLayoutImageConfig(): void {
  // Sogou places keys itself, so a layout cannot follow the picture.
  const fixedLayout = appState.archive?.format === "ssf"
  if (fixedLayout && appState.layoutImageConfig === "layout-follows-image") appState.layoutImageConfig = "none"
  for (const button of layoutImageConfigButtons) {
    button.hidden = fixedLayout && button.dataset.layoutImageConfig === "layout-follows-image"
    button.classList.toggle("active", button.dataset.layoutImageConfig === appState.layoutImageConfig)
  }
  layoutImageConfigDesc.textContent = layoutImageConfigDescriptions[appState.layoutImageConfig]
  layoutImageConfigFieldset.disabled = appState.layoutImageTarget === "panel" || appState.layoutImageTarget === "candidate"
}
