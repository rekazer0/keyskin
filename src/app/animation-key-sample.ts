import { isTransparentColor, type Visual } from "../atlas.ts"
import { drawStyleText, drawVisual, foregroundLayerRect, foregroundTextPoint, phoneForegroundVisual } from "../preview-draw.ts"
import { effectivePreviewItem, offsetFromSection, paddedRect, shouldDrawItemBackground, visiblePreviewItems, type PreviewItem } from "../preview-items.ts"
import { keyPlaysStyle } from "./animation-resource"
import { preview } from "./canvas-interaction"
import { appState } from "./state"

/** The same key artwork and offsets as the layout canvas, separated so a background binding cannot scale its foreground. */
export async function animationKeySample(styles: ReadonlySet<string>): Promise<{ width: number; height: number; layers: Array<{ visual: Visual; animate: boolean }> } | undefined> {
  const keys = visiblePreviewItems(preview.keys, preview.skinState)
  const sections = appState.animationDesignMode === "all" ? appState.selectedKeySections : appState.animationKeys
  const candidates = new Set([
    ...keys.filter(key => key.sections.some(section => sections.includes(section))),
    ...keys.filter(key => keyPlaysStyle(key, styles)),
    ...keys.filter(key => /^KEY\d+$/i.test(key.section) && key.editable),
  ])
  for (const key of candidates) {
    const sample = await renderKeySample(key, styles)
    if (sample) return sample
  }
}

async function renderKeySample(key: PreviewItem, styles: ReadonlySet<string>) {
  const { resolver, stateDocument, skinState, offsets, theme, panelStyle, panelWidth, panelHeight } = preview
  if (!resolver) return
  if (stateDocument) key = effectivePreviewItem(stateDocument, key, skinState)
  const area = paddedRect(key), rect = { ...area, x: 0, y: 0 }
  if (area.width <= 0 || area.height <= 0) return
  const layers: Array<{ visual: Visual; animate: boolean }> = []
  const trial = !keyPlaysStyle(key, styles)
  const paint = async (draw: (context: CanvasRenderingContext2D) => void, animate: boolean) => {
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(area.width)); canvas.height = Math.max(1, Math.round(area.height))
    draw(canvas.getContext("2d")!)
    layers.push({ visual: { image: await createImageBitmap(canvas), source: [0, 0, canvas.width, canvas.height] }, animate })
  }
  if (shouldDrawItemBackground(key, panelStyle, panelWidth, panelHeight)) {
    const back = await resolver.resolve(key.backStyle, false)
    if (back && ((back.image && back.source) || [back.color, back.borderColor].some(color => color && !isTransparentColor(color)))) {
      await paint((context) => drawVisual(context, back, rect, true), trial || styles.has(key.backAnimStyle || key.animStyle || ""))
    }
  }
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
  if (layers.length) return { width: area.width, height: area.height, layers }
}
