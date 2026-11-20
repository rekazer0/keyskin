import type { Visual } from "../atlas.ts"
import { drawStyleText, drawVisual, foregroundLayerRect, foregroundTextPoint, phoneForegroundVisual } from "../preview-draw.ts"
import { effectivePreviewItem, offsetFromSection, paddedRect, visiblePreviewItems } from "../preview-items.ts"
import { keyPlaysStyle } from "./animation-resource"
import { preview } from "./canvas-interaction"
import { appState } from "./state"

/** The same key artwork and offsets as the layout canvas, separated so a background binding cannot scale its foreground. */
export async function animationKeySample(styles: ReadonlySet<string>): Promise<{ width: number; height: number; trial: boolean; layers: Array<{ visual: Visual; animate: boolean }> } | undefined> {
  const keys = visiblePreviewItems(preview.keys, preview.skinState)
  const sections = appState.animationDesignMode === "all" ? appState.selectedKeySections : appState.animationKeys
  const selected = keys.find((key) => key.sections.some(section => sections.includes(section)))
  let key = selected ?? keys.find(key => keyPlaysStyle(key, styles)) ?? keys.find((key) => /^KEY\d+$/i.test(key.section) && key.editable)
  if (!key || !preview.resolver) return
  if (preview.stateDocument) key = effectivePreviewItem(preview.stateDocument, key, preview.skinState)
  const area = paddedRect(key), rect = { ...area, x: 0, y: 0 }, resolver = preview.resolver
  if (area.width <= 0 || area.height <= 0) return
  const { offsets, theme } = preview
  const layers: Array<{ visual: Visual; animate: boolean }> = []
  const trial = !keyPlaysStyle(key, styles)
  const paint = async (draw: (context: CanvasRenderingContext2D) => void, animate: boolean) => {
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(area.width)); canvas.height = Math.max(1, Math.round(area.height))
    draw(canvas.getContext("2d")!)
    layers.push({ visual: { image: await createImageBitmap(canvas), source: [0, 0, canvas.width, canvas.height] }, animate })
  }
  const back = await resolver.resolve(key.backStyle, false)
  if (back) await paint((context) => drawVisual(context, back, rect, true), trial || styles.has(key.backAnimStyle || key.animStyle || ""))
  for (const [index, id] of key.foreStyles.entries()) {
    const visual = phoneForegroundVisual(await resolver.resolve(id, false))
    const styleText = resolver.resolveStyleText?.(id, false)
    if (!visual && !styleText) continue
    const offset = key.foreOffsets[index] ?? offsetFromSection(offsets, `OFFSET${key.positionTypes[index] ?? ""}`, rect)
    await paint((context) => {
      if (visual) drawVisual(context, visual, foregroundLayerRect(rect, visual.source, offset), false)
      if (styleText) drawStyleText(context, styleText, foregroundTextPoint(rect, offset), theme)
    }, trial || styles.has(key.foreAnimStyles[index] || key.foreAnimStyle || key.animStyle || ""))
  }
  if (layers.length) return { width: area.width, height: area.height, trial, layers }
}
