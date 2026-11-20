import { bitmapOf } from "../skin-model/image.ts"
import { styleLayers } from "../skin-model/style.ts"
import { paintLayer } from "../paint/layer.ts"
import { paddedRect, type PreviewItem } from "../preview-items.ts"
import { preview } from "./canvas-interaction"
import { appState } from "./state"

/** 与画布同一套按键图与偏移；单独取出来，免得背景绑定把前景一起缩放。 */
export async function animationKeySample(
  plays: (key: PreviewItem) => boolean,
  styles: ReadonlySet<string>,
): Promise<{ width: number; height: number; trial: boolean; layers: Array<{ bitmap: ImageBitmap; animate: boolean }> } | undefined> {
  // 可见性与状态覆盖都已经在 IR 里定好，这里直接用当前画出的那些键。
  const keys = preview.keys.filter((key) => key.visible)
  const selected = keys.find((key) => appState.animationKeys.includes(key.section))
  const key = selected ?? keys.find(plays) ?? keys.find((each) => /^KEY\d+$/i.test(each.section) && each.editable)
  const model = preview.model
  if (!key || !model) return
  const area = paddedRect(key), rect = { ...area, x: 0, y: 0 }
  const layers: Array<{ bitmap: ImageBitmap; animate: boolean }> = []
  const trial = !plays(key)
  const paint = async (draw: (context: CanvasRenderingContext2D) => void, animate: boolean) => {
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(area.width))
    canvas.height = Math.max(1, Math.round(area.height))
    draw(canvas.getContext("2d")!)
    layers.push({ bitmap: await createImageBitmap(canvas), animate })
  }
  const paintLayerOf = async (styleID: string | undefined, animate: boolean) => {
    const layer = styleLayers(model, styleID ?? "", false).find((each) => each.kind === "image" || each.kind === "color")
    if (!layer) return
    const source = layer.kind === "image" ? model.images.get(layer.image) : undefined
    const bitmap = source ? await bitmapOf(source) : undefined
    await paint((context) => paintLayer(context, layer, bitmap, rect), animate)
  }
  await paintLayerOf(key.backStyle, trial || styles.has(key.container.back?.anim ?? ""))
  for (const [index, id] of key.foreStyles.entries()) {
    await paintLayerOf(id, trial || styles.has(key.container.fore[index]?.anim ?? ""))
  }
  return { width: area.width, height: area.height, trial, layers }
}
