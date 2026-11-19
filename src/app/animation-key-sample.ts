import type { Visual } from "../atlas.ts"
import { drawStyleText, drawVisual, foregroundLayerRect, foregroundTextPoint } from "../preview-draw.ts"
import { paddedRect, type PreviewItem } from "../preview-items.ts"
import { preview } from "./canvas-interaction"
import { appState } from "./state"

/** 与画布同一套按键图与偏移；单独取出来，免得背景绑定把前景一起缩放。 */
export async function animationKeySample(plays: (key: PreviewItem) => boolean, styles: ReadonlySet<string>): Promise<{ width: number; height: number; trial: boolean; layers: Array<{ visual: Visual; animate: boolean }> } | undefined> {
  // 可见性与状态覆盖都已经在 IR 里定好，这里直接用当前画出的那些键。
  const keys = preview.keys.filter((key) => key.visible)
  const selected = keys.find((key) => appState.animationKeys.includes(key.section))
  const key = selected ?? keys.find(plays) ?? keys.find((each) => /^KEY\d+$/i.test(each.section) && each.editable)
  if (!key || !preview.resolver) return
  const area = paddedRect(key), rect = { ...area, x: 0, y: 0 }, resolver = preview.resolver
  const layers: Array<{ visual: Visual; animate: boolean }> = []
  const trial = !plays(key)
  const paint = async (draw: (context: CanvasRenderingContext2D) => void, animate: boolean) => {
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(area.width)); canvas.height = Math.max(1, Math.round(area.height))
    draw(canvas.getContext("2d")!)
    layers.push({ visual: { image: await createImageBitmap(canvas), source: [0, 0, canvas.width, canvas.height] }, animate })
  }
  const back = await resolver.resolve(key.backStyle ?? "", false)
  await paint((context) => drawVisual(context, back, rect, true), trial || styles.has(key.container.back?.anim ?? ""))
  for (const [index, id] of key.foreStyles.entries()) {
    const visual = await resolver.resolve(id, false)
    const styleText = resolver.resolveStyleText?.(id, false)
    const offset = key.container.fore[index]?.offset
    await paint((context) => {
      if (visual?.image) drawVisual(context, visual, foregroundLayerRect(rect, visual.source, offset ? [offset.x, offset.y] : undefined), false)
      else if (styleText) drawStyleText(context, styleText, foregroundTextPoint(rect, offset ? [offset.x, offset.y] : undefined), preview.theme)
    }, trial || styles.has(key.container.fore[index]?.anim ?? ""))
  }
  return { width: area.width, height: area.height, trial, layers }
}
