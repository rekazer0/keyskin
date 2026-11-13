import { mobileKeyPreview, mobileKeyCanvas, mobileKeySize, mobilePreviewSummary, layout } from "./dom"
import { mobilePortraitQuery, preview } from "./canvas-interaction"
import { appState } from "./state"

/** 复用画布的真实渲染，保持原生格式、文字、图片和按下态一致。 */
export function syncMobileKeyPreview(pressed = false): void {
  const size = preview.logicalSize()
  mobilePreviewSummary.textContent = `${layout.selectedOptions[0]?.textContent ?? "画布"} · ${size.width} × ${size.height}`
  const section = appState.selectedKeySections.length === 1 ? appState.selectedKeySections[0] : undefined
  const key = preview.keys.find((key) => key.sections.includes(section ?? ""))
  mobileKeyPreview.hidden = !mobilePortraitQuery.matches || document.documentElement.dataset.mobilePane !== "inspector"
    || !key || appState.selectedPath !== appState.layoutPath
  if (mobileKeyPreview.hidden || !key) return
  if (pressed) preview.flashPress(key)
  else preview.cancelPointerInteraction()
  preview.drawSync()
  void preview.rendered().then(() => {
    if (appState.selectedKeySections.length !== 1 || appState.selectedKeySections[0] !== section || mobileKeyPreview.hidden) return
    const { rect } = key
    if (rect.width <= 0 || rect.height <= 0 || !preview.canvas.width || !preview.canvas.height) return
    const scaleX = preview.canvas.width / size.width, scaleY = preview.canvas.height / size.height
    mobileKeyCanvas.width = Math.max(1, Math.round(rect.width * scaleX))
    mobileKeyCanvas.height = Math.max(1, Math.round(rect.height * scaleY))
    mobileKeyCanvas.getContext("2d")?.drawImage(preview.canvas,
      rect.x * scaleX, rect.y * scaleY, rect.width * scaleX, rect.height * scaleY,
      0, 0, mobileKeyCanvas.width, mobileKeyCanvas.height)
    mobileKeySize.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`
  })
}
