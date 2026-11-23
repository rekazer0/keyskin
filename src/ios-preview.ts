import type { Visual, VisualResolver } from "./atlas.ts"
import { candidateWordsForeground } from "./candidate-style.ts"
import type { IniDocument } from "./ini.ts"
import { sceneKey, type NativeScene, type SceneLayer } from "./native-scene.ts"
import type { PreviewItem, Rect } from "./preview-items.ts"
import { defaultToolbarIcon, toolbarImageRect } from "./preview-draw.ts"
import { fixedToolbarIconRect, iosToolbarScale } from "./ios-toolbar-geometry.ts"

/** Oversized CND hit boxes must not drag the fixed-size artwork below the visible native bar. */
export async function iosToolbarImageScene(
  resolver: VisualResolver,
  items: PreviewItem[],
  width: number,
  height: number,
  devicePointWidth: number | undefined,
  color = "currentColor",
  implicit?: Rect,
): Promise<NativeScene> {
  const scale = iosToolbarScale(width, devicePointWidth)
  const functions = async (rect: Rect, ids?: readonly string[]): Promise<SceneLayer[]> => {
    const images = await Promise.all((await resolver.resolveToolbarImages(undefined, ids)).map(async (visual) => {
      if (visual.image || !visual.defaultIcon) return visual
      const size = Math.min(width / 18, height * 0.45)
      const fallback = await defaultToolbarIcon(visual.defaultIcon, size, color)
      return { ...visual, ...fallback, imagePath: undefined }
    }))
    return images.map((visual, index) => ({
      kind: "image", visual,
      rect: toolbarImageRect(visual, {
        x: rect.x + index * rect.width / images.length, y: 0,
        width: rect.width / images.length, height,
      }, width, devicePointWidth),
    }))
  }
  // shortcut: sample iOS's keyboard, cursor and clipboard slots until device toolbar preferences can be read.
  const background = implicit ? await functions(implicit, ["17", "18", "35"]) : []
  const keys = await Promise.all(items.filter((item) => item.center.trim() === "F14" || item.foreRect && ["F31", "F8", "F9"].includes(item.center.trim())).map(async (item) => {
    const rect = item.rect
    if (rect.x + rect.width <= 0 || rect.x >= width || rect.y + rect.height <= 0 || rect.y >= height) return
    if (item.center.trim() === "F14") {
      const fore = await functions(rect)
      if (!fore.length) return
      return sceneKey(item.section, rect, async (pressed) => {
        const back = await resolver.resolve(pressed ? item.highlightBackStyle ?? item.backStyle : item.backStyle, pressed)
        return { back: back ? [{ kind: "image", visual: back, rect }] : [], fore }
      })
    }
    const fixed = item.foreRect!
    const icon = fixedToolbarIconRect(rect, { width: fixed.width * scale, height: fixed.height * scale }, width, height)
    const { x, y, width: w, height: h } = icon
    const normal = await Promise.all(item.foreStyles.map((id) => resolver.resolve(id, false)))
    if (!normal.some((visual) => visual?.image && visual.source)) return
    const key = await sceneKey(item.section, rect, async (pressed) => {
      const visuals = pressed ? await Promise.all(item.foreStyles.map((id) => resolver.resolve(id, true))) : normal
      const back = await resolver.resolve(pressed ? item.highlightBackStyle ?? item.backStyle : item.backStyle, pressed)
      const fore: SceneLayer[] = visuals.flatMap((visual) => {
        if (!visual?.image || !visual.source) return []
        const [, , sw, sh] = visual.source
        const fit = Math.min(w / sw, h / sh)
        return [{ kind: "image", visual: { ...visual, inner: undefined }, rect: {
          x: x + (w - sw * fit) / 2, y: y + (h - sh * fit) / 2,
          width: sw * fit, height: sh * fit,
        } }]
      })
      return { back: back ? [{ kind: "image", visual: back, rect }] : [], fore }
    })
    return { ...key, selectionRect: icon }
  }))
  return { background, partial: true, keys: keys.filter((key) => key !== undefined) }
}

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
  const icon = (name: string) => defaultToolbarIcon(name, side, color)
  const images = await resolver.resolveToolbarImages()
  const functions = await Promise.all(images.map((visual) => visual.image && visual.source ? visual : icon(visual.defaultIcon ?? "image-off")))
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

/** Contiguous slices already divide the artwork at the candidate/panel boundary. */
export function hasSeparateIosPanelBackground(resolver: VisualResolver, panelStyle: string, candidateStyle: string): boolean {
  const path = resolver.imagePath?.(panelStyle, false)
  if (!path || path !== resolver.imagePath?.(candidateStyle, false)) return false
  const panel = resolver.sourceRect?.(panelStyle, false)
  const candidate = resolver.sourceRect?.(candidateStyle, false)
  return Boolean(panel && candidate && candidate[3] > 0 && panel[0] === candidate[0]
    && panel[2] === candidate[2] && panel[1] === candidate[1] + candidate[3])
}

/** The candidate style can paint over the shared panel image, or be its own band. */
export async function iosCandidateBackground(
  resolver: VisualResolver,
  panelStyle: string,
  candidateStyle: string,
  width: number,
  panelHeight: number,
  candidateHeight: number,
  inputHeight: number,
  sharedInput = false,
): Promise<NativeScene> {
  const [panel, candidate] = await Promise.all([resolver.resolve(panelStyle, false), resolver.resolve(candidateStyle, false)])
  const background: SceneLayer[] = []
  if (panel?.image && !hasSeparateIosPanelBackground(resolver, panelStyle, candidateStyle)) {
    background.push({ kind: "image", visual: panel, rect: { x: 0, y: sharedInput ? 0 : -inputHeight, width, height: inputHeight + candidateHeight + panelHeight } })
  }
  if (candidate) background.push({ kind: "image", visual: candidate, rect: { x: 0, y: 0, width, height: candidateHeight + (sharedInput ? inputHeight : 0) } })
  return { background, keys: [] }
}
