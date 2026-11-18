import { IniDocument } from "../ini"
import { tileSlices } from "../tiles"
import { type Visual } from "../atlas"
import { appState } from "./state"
import { mobilePortraitQuery, preview } from "./canvas-interaction"
import { pickerDialog } from "./dom"
import { visualResolver } from "./bda-documents"
import { pngImage } from "./file-operations"

export function clearMobilePickerPreview(): void {
  appState.mobilePickerPreviewRequest++
  preview.setDraftVisual()
  appState.mobilePickerBitmap?.close()
  appState.mobilePickerBitmap = undefined
}

/** 候选只覆盖当前键的绘制，不改压缩包、样式引用或撤销栈。 */
export async function previewMobilePickerSelection(selected: { session?: string; styleID?: string; imagePath?: string }): Promise<void> {
  if (!selected.session || selected.session !== appState.styleLibrarySession?.session) return
  clearMobilePickerPreview()
  const archive = appState.archive
  const target = appState.stylePickerTarget
  if (!mobilePortraitQuery.matches || !pickerDialog.open || !archive || !["bdi", "bds"].includes(archive.format)
    || !target || target.disabled
    || !["BACK_STYLE", "FORE_STYLE"].includes(target.dataset.keyField ?? "") || appState.selectedKeySections.length !== 1) return
  const section = appState.selectedKeySections[0]
  const layout = appState.layoutPath
  const request = appState.mobilePickerPreviewRequest
  let visual: Visual | undefined
  let bitmap: ImageBitmap | undefined
  try {
    if (selected.styleID) visual = await visualResolver()?.resolve(selected.styleID, appState.styleLibraryHighlighted)
    else if (selected.imagePath && archive.isImage(selected.imagePath)) {
      bitmap = await pngImage(archive.getBytes(selected.imagePath)!)
      const tilePath = selected.imagePath.replace(/\.png$/i, ".til")
      const slices = archive.isText(tilePath) ? tileSlices(IniDocument.parse(archive.getText(tilePath))) : []
      // 多切片必须由下一步明确选择，整张图只作未提交预览。
      const slice = slices.length === 1 ? slices[0] : undefined
      visual = { image: bitmap, source: slice?.source ?? [0, 0, bitmap.width, bitmap.height], inner: slice?.inner }
    }
    if (request !== appState.mobilePickerPreviewRequest || appState.archive !== archive || appState.stylePickerTarget !== target
      || appState.selectedKeySections.length !== 1 || appState.selectedKeySections[0] !== section || appState.layoutPath !== layout
      || !mobilePortraitQuery.matches || !pickerDialog.open) {
      bitmap?.close()
      return
    }
    appState.mobilePickerBitmap = bitmap
    if (visual || selected.styleID) preview.setDraftVisual({ section, foreground: target.dataset.keyField === "FORE_STYLE",
      layer: Number(target.dataset.styleReferenceIndex ?? 0), visual, styleID: selected.styleID ?? target.value, pressed: appState.styleLibraryHighlighted })
  } catch {
    bitmap?.close()
  }
}
