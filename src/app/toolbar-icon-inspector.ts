import { drawVisualPreview, type Visual } from "../atlas.ts"
import { element } from "../dom-element.ts"
import { appState } from "./state"
import { visualResolver } from "./bda-documents"
import { commitBytes, isEditing, updateDirty } from "./edit-history"
import { refreshPreview } from "./preview-render"
import { runFileOperation } from "./file-operations"
import { field, section } from "./property-rows"
import { showPickerWindow } from "./image-pickers"
import type { TileRect } from "../tiles.ts"

async function replaceIcon(visual: Visual, imagePath: string, source?: TileRect): Promise<boolean> {
  const archive = appState.archive
  const path = visual.imagePath
  if (!archive || !path || !isEditing()) return false
  const bytes = archive.getBytes(imagePath)
  if (!bytes) throw new Error("所选图片已不存在")
  const replacement = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: "image/png" }))
  try {
    if (appState.archive !== archive || !isEditing()) return false
    const before = archive.getBytes(path)
    if (!before) throw new Error("图标图片已不存在")
    const original = await createImageBitmap(new Blob([new Uint8Array(before)], { type: "image/png" }))
    try {
      const canvas = element("canvas")
      canvas.width = original.width
      canvas.height = original.height
      const context = canvas.getContext("2d")!
      context.drawImage(original, 0, 0)
      const rect = visual.source ?? [0, 0, original.width, original.height]
      context.clearRect(...rect)
      context.drawImage(replacement, ...(source ?? [0, 0, replacement.width, replacement.height] as TileRect), ...rect)
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("无法生成图标图片")), "image/png"))
      const after = new Uint8Array(await blob.arrayBuffer())
      if (appState.archive !== archive || !isEditing()) return false
      if (archive.getBytes(path) !== before) throw new Error("图标图片已改变，请重新选择后替换")
      commitBytes(path, before, after)
      refreshPreview()
      updateDirty()
      void refreshToolbarIconCards()
      return true
    } finally {
      original.close()
    }
  } finally {
    replacement.close()
  }
}


async function refreshToolbarIconCards(): Promise<void> {
  const visuals = await visualResolver()?.resolveToolbarImages()
  if (!visuals) return
  for (const [index, visual] of visuals.entries()) {
    const canvas = document.querySelector<HTMLCanvasElement>(`[data-document-key="TOOLBAR_ICON_${index + 1}"] canvas`)
    if (canvas) drawVisualPreview(canvas, [visual], false)
  }
}
/** F14 的图标是原生图片资源，不是 SWITCH 的文字样式。 */
export function toolbarIconSection(): HTMLElement {
  const group = section("工具栏图标", [])
  const archive = appState.archive
  const images = visualResolver()?.resolveToolbarImages() ?? Promise.resolve([])
  void images.then(visuals => {
    if (!group.isConnected || appState.archive !== archive) return
    for (const [index, visual] of visuals.entries()) {
      const label = `图标 ${index + 1}`
      const pick = () => {
        appState.resourcePickerSelect = undefined
        appState.stylePickerTarget = undefined
        appState.pickerTarget = {
          source: "FORE_STYLE", property: "NM_IMG",
          selectImage: (path, source) => {
            if (appState.archive !== archive) return
            void runFileOperation("修改工具栏图标", () => replaceIcon(visual, path, source))
          },
        }
        void showPickerWindow("styles", "全部图片", 1100, 760)
      }
      const row = field({
        key: `TOOLBAR_ICON_${index + 1}`, label,
        spec: {
          kind: "image", value: visual.imagePath?.split("/").pop() ?? "",
          load: () => Promise.resolve(visual), pick,
        },
        commit: () => {},
      })
      row.querySelector("input")!.readOnly = true
      group.append(row)
    }
  }).catch(() => {})
  return group
}
