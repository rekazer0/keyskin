import type { Visual } from "../atlas.ts"
import { drawStyleText, drawVisual, foregroundLayerRect, foregroundTextPoint } from "../preview-draw.ts"
import { effectivePreviewItem, offsetFromSection, paddedRect, visiblePreviewItems, type PreviewItem } from "../preview-items.ts"
import { preview } from "./canvas-interaction"
import { appState } from "./state"

/** The same key artwork and offsets as the layout canvas, separated so a background binding cannot scale its foreground. */
export async function animationKeySample(plays: (key: PreviewItem) => boolean, styles: ReadonlySet<string>): Promise<{ width: number; height: number; trial: boolean; layers: Array<{ visual: Visual; animate: boolean }> } | undefined> {
  const keys = visiblePreviewItems(preview.keys, preview.skinState)
  const selected = keys.find((key) => appState.animationKeys.includes(key.section))
  let key = selected ?? keys.find(plays) ?? keys.find((key) => /^KEY\d+$/i.test(key.section) && key.editable)
  if (!key || !preview.resolver) return
  if (preview.stateDocument) key = effectivePreviewItem(preview.stateDocument, key, preview.skinState)
  const area = paddedRect(key), rect = { ...area, x: 0, y: 0 }, resolver = preview.resolver
  const layers: Array<{ visual: Visual; animate: boolean }> = []
  const trial = !plays(key)
  const paint = async (draw: (context: CanvasRenderingContext2D) => void, animate: boolean) => {
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(area.width)); canvas.height = Math.max(1, Math.round(area.height))
    draw(canvas.getContext("2d")!)
    layers.push({ visual: { image: await createImageBitmap(canvas), source: [0, 0, canvas.width, canvas.height] }, animate })
  }
  const back = await resolver.resolve(key.backStyle, false)
  await paint((context) => drawVisual(context, back, rect, true), trial || styles.has(key.backAnimStyle || key.animStyle || ""))
  for (const [index, id] of key.foreStyles.entries()) {
    const visual = await resolver.resolve(id, false)
    const styleText = resolver.resolveStyleText?.(id, false)
    const offset = key.foreOffsets[index] ?? offsetFromSection(preview.offsets, `OFFSET${key.positionTypes[index] ?? ""}`, rect)
    await paint((context) => {
      if (visual?.image) drawVisual(context, visual, foregroundLayerRect(rect, visual.source, offset), false)
      else if (styleText) drawStyleText(context, styleText, foregroundTextPoint(rect, offset), preview.theme)
    }, trial || styles.has(key.foreAnimStyles[index] || key.foreAnimStyle || key.animStyle || ""))
  }
  return { width: area.width, height: area.height, trial, layers }
}
