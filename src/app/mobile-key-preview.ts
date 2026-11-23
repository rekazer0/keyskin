import { mobileKeyPreview, mobileKeyCanvas, mobileKeySize, layout, selectedKeyName, selectedKeyContext, selectedKeyPreview } from "./dom"
import { mobilePortraitQuery, preview } from "./canvas-interaction"
import { appState } from "./state"
import { layoutLabel } from "./file-tree"

/** 复用画布的真实渲染，保持原生格式、文字、图片和按下态一致。 */
export function syncMobileKeyPreview(pressed = false): void {
  const layoutName = appState.layoutPath && /\.ini$/i.test(appState.layoutPath)
    ? layoutLabel(appState.layoutPath.split("/").pop()!) : layout.selectedOptions[0]?.textContent ?? "画布"
  if (!appState.selectedKeySections.length && appState.selectedPath === appState.layoutPath && appState.layoutPath && !appState.selectedCandidate && !appState.selectedToolbarSections.length) {
    selectedKeyName.textContent = layoutName
    const { width, height } = preview.logicalSize()
    selectedKeyContext.textContent = mobilePortraitQuery.matches && appState.archive
      ? `${width} × ${height} · ${appState.archive.format.toUpperCase()} · 点按选择按键` : "轻点上方按键，开始编辑"
  }
  if (appState.animationDesignMode !== "all") {
    const title = document.querySelector<HTMLElement>("#document-fields")?.dataset.mobileAnimationLabel
    if (title) selectedKeyName.textContent = title
  }
  const section = appState.selectedKeySections.length === 1 ? appState.selectedKeySections[0] : undefined
  const key = preview.keys.find((key) => key.sections.includes(section ?? ""))
  mobileKeyPreview.hidden = !mobilePortraitQuery.matches || document.documentElement.dataset.mobilePane !== "inspector"
    || !key || appState.selectedPath !== appState.layoutPath
  if (mobileKeyPreview.hidden || !key) return
  selectedKeyContext.textContent = `${layoutName} · ${section}`
  const label = key.show.trim() || (/^[\p{L}\p{N}]$/u.test(key.center) ? key.center : "")
  if (label) selectedKeyName.textContent = `按键 ${label}`
  if (pressed) preview.flashPress(key)
  void preview.whenDrawn().then(() => {
    if (appState.selectedKeySections.length !== 1 || appState.selectedKeySections[0] !== section || mobileKeyPreview.hidden || !preview.keys.includes(key)) return
    const { rect } = key
    if (rect.width <= 0 || rect.height <= 0 || !preview.canvas.width || !preview.canvas.height) return
    const size = preview.logicalSize()
    const scaleX = preview.canvas.width / size.width, scaleY = preview.canvas.height / size.height
    mobileKeyCanvas.width = Math.max(1, Math.round(rect.width * scaleX))
    mobileKeyCanvas.height = Math.max(1, Math.round(rect.height * scaleY))
    mobileKeyCanvas.getContext("2d")?.drawImage(preview.canvas,
      rect.x * scaleX, rect.y * scaleY, rect.width * scaleX, rect.height * scaleY,
      0, 0, mobileKeyCanvas.width, mobileKeyCanvas.height)
    mobileKeySize.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`
    const thumbnail = document.createElement("canvas")
    thumbnail.width = mobileKeyCanvas.width
    thumbnail.height = mobileKeyCanvas.height
    thumbnail.getContext("2d")?.drawImage(mobileKeyCanvas, 0, 0)
    selectedKeyPreview.replaceChildren(thumbnail)
  }).catch(() => {})
}
