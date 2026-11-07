import type { Visual, VisualResolver } from "./atlas.ts"
import { iconMarkup } from "./icons.ts"
import { candidateWordsForeground } from "./candidate-style.ts"
import type { IniDocument } from "./ini.ts"
import type { NativeScene, SceneLayer } from "./native-scene.ts"
import type { PreviewItem, Rect } from "./preview-items.ts"

/** iOS paints native toolbar controls; CND's text logo and hide labels belong to Android. */
export async function iosDefaultToolbarScene(
  general: IniDocument | undefined,
  candidate: IniDocument,
  resolver: VisualResolver,
  items: PreviewItem[],
  width: number,
  height: number,
): Promise<NativeScene> {
  const color = resolver.resolveText(candidateWordsForeground(candidate, general), false)?.color
    ?? "currentColor"
  const side = Math.min(width / 18, height * 0.45)
  const icon = async (name: string): Promise<Visual> => {
    const image = new Image()
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconMarkup(name, side * 3).replaceAll("currentColor", color))}`
    await image.decode()
    const bitmap = await createImageBitmap(image)
    return { image: bitmap, source: [0, 0, bitmap.width, bitmap.height] }
  }
  // shortcut: the phone owns the function order; use its standard controls when the skin supplies no artwork.
  const functions = await Promise.all(["keyboard", "type", "clipboard-paste"].map(icon))
  const [logo, hide, more] = await Promise.all([icon("hand"), icon("chevron-down"), icon("chevron-right")])
  const layer = (visual: Visual, slot: Rect): SceneLayer => {
    const [, , w, h] = visual.source!
    const scale = Math.min(side / w, side / h)
    return { kind: "image", visual, rect: {
      x: slot.x + (slot.width - w * scale) / 2,
      y: slot.y + (slot.height - h * scale) / 2,
      width: w * scale, height: h * scale,
    } }
  }
  return { background: [], partial: true, keys: items.filter((item) => ["F14", "F31", "F8", "F9"].includes(item.center.trim())).map((item) => {
    const rect = item.rect
    const action = item.center.trim()
    const fore = action === "F14"
      ? functions.map((visual, i) => layer(visual, { ...rect, x: rect.x + i * rect.width / functions.length, width: rect.width / functions.length }))
      : action === "F31" ? [layer(logo, rect)]
      : action === "F8" ? [layer(hide, rect)]
      : [layer(more, rect)]
    return { section: item.section, rect, layers: () => ({ back: [], fore }) }
  }) }
}

/** The same stretched picture supplies both canvases; the candidate bar paints its own style over it. */
export async function iosCandidateBackground(
  resolver: VisualResolver,
  panelStyle: string,
  candidateStyle: string,
  width: number,
  panelHeight: number,
  candidateHeight: number,
  inputHeight: number,
): Promise<NativeScene> {
  const [panel, candidate] = await Promise.all([resolver.resolve(panelStyle, false), resolver.resolve(candidateStyle, false)])
  const background: SceneLayer[] = []
  if (panel?.image) background.push({ kind: "image", visual: panel, rect: { x: 0, y: -inputHeight, width, height: inputHeight + candidateHeight + panelHeight } })
  if (candidate) background.push({ kind: "image", visual: candidate, rect: { x: 0, y: 0, width, height: candidateHeight } })
  return { background, keys: [] }
}
