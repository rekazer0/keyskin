import type { Visual, VisualResolver } from "./atlas.ts"
import { candidateWordsForeground } from "./candidate-style.ts"
import type { IniDocument } from "./ini.ts"
import { sceneKey, type NativeScene, type SceneLayer } from "./native-scene.ts"
import { persistVisible, type PreviewItem, type Rect } from "./preview-items.ts"
import { defaultToolbarIcon, toolbarImageRect } from "./preview-draw.ts"
import { iosToolbarScale } from "./ios-toolbar-geometry.ts"
import { actionText } from "./skin-model/inspect.ts"

/**
 * iOS 工具栏的按键：候选栏布局文档里带 `SIZE` 的面板与图标段。
 * 这一块没有对应的 IR 板，几何由 `ANCHOR_TYPE` 的九宫格锚点加 `POS` 摆位。
 */
export function iosToolbarItems(
  document: IniDocument,
  panelWidth: number,
  panelHeight: number,
  persistentOnly = false,
): PreviewItem[] {
  const sections = document.sections().filter((section) =>
    /^(CAND|SWITCH|PANEL|LIST|MORE|ICON\d+|TIP\d+)$/.test(section)
  )
  const read = (section: string, name: string): string => document.get(section, name) ?? ""
  return sections.flatMap((section) => {
    if (/^TIP\d+$/.test(section) || !persistVisible(document.get(section, "PERSIST"), persistentOnly)) return []
    const backStyle = read(section, "BACK_STYLE").split(",")[0] ?? ""
    // CAND.FORE_STYLE 是候选词的运行时样式，不是整条候选栏的静态前景。
    const foreStyles = section === "CAND"
      ? []
      : read(section, "FORE_STYLE").split(",").map((token) => token.trim()).filter(Boolean)
    if (section !== "CAND" && (!read(section, "SIZE") || (!/^ICON\d+$/i.test(section) && !backStyle && !foreStyles[0]))) return []
    const size = read(section, "SIZE").split(",").map(Number)
    const width = section === "CAND" ? panelWidth : size[0] ?? 0
    const height = section === "CAND" ? panelHeight : size[1] ?? 0
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return []
    const position = read(section, "POS").split(",").map(Number)
    const anchor = Number(read(section, "ANCHOR_TYPE"))
    const xAnchor = ((anchor - 1) % 3) + 1
    const yAnchor = Math.ceil(anchor / 3)
    const offsetX = Number.isFinite(position[0]) ? position[0] : 0
    const offsetY = Number.isFinite(position[1]) ? position[1] : 0
    const x = section === "CAND" ? 0 : xAnchor === 2 ? panelWidth / 2 + offsetX : xAnchor === 3 ? panelWidth + offsetX : offsetX
    const y = section === "CAND" ? 0 : yAnchor === 2 ? panelHeight / 2 + offsetY : yAnchor === 3 ? panelHeight + offsetY : offsetY
    // iOS 的 FIX_SIZE 是点；皮肤几何与 @3x 素材都是像素（工具书 V6 p158）。
    const fixed = read(section, "FIX_SIZE").split(",").map((value) => Number(value) * 3)
    const foreRect = fixed.length === 2 && fixed.every(Number.isFinite)
      ? { x: x + (width - fixed[0]) / 2, y: y + (height - fixed[1]) / 2, width: fixed[0], height: fixed[1] }
      : undefined
    const animStyles = [read(section, "ANIM_STYLE"), read(section, "PRESS_STYLE"), read(section, "BACK_ANIM_STYLE")].filter(Boolean)
    const highlight = read(section, "HL_BACK_STYLE").split(",")[0] || undefined
    // `KEY` 是图标按下时执行的功能键，工具栏按它筛要画的图标。
    const pressText = read(section, "KEY") || read(section, "CENTER")
    return [{
      key: {
        id: section,
        actions: pressText ? { press: { kind: "text", value: pressText } } : {},
        container: { fore: foreStyles.map((style) => ({ style })) },
      },
      section,
      sections: [section],
      rect: { x, y, width, height },
      ...(foreRect ? { foreRect } : {}),
      container: {
        ...(backStyle ? { back: { style: backStyle, ...(highlight ? { pressed: highlight } : {}) } } : {}),
        fore: foreStyles.map((style) => ({ style })),
      },
      ...(backStyle ? { backStyle } : {}),
      ...(highlight ? { highlightBackStyle: highlight } : {}),
      foreStyles,
      animStyles,
      editable: /^ICON\d+$/i.test(section),
      visible: true,
      fore: [],
      layers: [],
    }]
  })
}

/** 键在按下时执行的动作文本；工具栏用它区分系统功能键。 */
function pressText(item: PreviewItem): string {
  return actionText(item.key.actions.press) ?? ""
}

/** Oversized CND hit boxes must not drag the fixed-size artwork below the visible native bar. */
export async function iosToolbarImageScene(
  resolver: VisualResolver,
  items: PreviewItem[],
  width: number,
  height: number,
  devicePointWidth: number | undefined,
  color = "currentColor",
): Promise<NativeScene> {
  const scale = iosToolbarScale(width, devicePointWidth)
  const keys = await Promise.all(items.filter((item) => pressText(item) === "F14" || item.foreRect && ["F31", "F8", "F9"].includes(pressText(item))).map(async (item) => {
    const rect = item.rect
    if (rect.x + rect.width <= 0 || rect.x >= width || rect.y + rect.height <= 0 || rect.y >= height) return
    if (pressText(item) === "F14") {
      const images = await Promise.all((await resolver.resolveToolbarImages()).map(async (visual) => {
        if (visual.image || !visual.defaultIcon) return visual
        const size = Math.min(width / 18, height * 0.45)
        const fallback = await defaultToolbarIcon(visual.defaultIcon, size, color)
        return { ...visual, ...fallback, imagePath: undefined }
      }))
      if (!images.length) return
      const fore: SceneLayer[] = images.map((visual, index) => ({
        kind: "image", visual,
        rect: toolbarImageRect(visual, {
          x: rect.x + index * rect.width / images.length, y: 0,
          width: rect.width / images.length, height,
        }, width, devicePointWidth),
      }))
      return sceneKey(item.section, rect, async (pressed) => {
        const back = await resolver.resolve(pressed ? item.highlightBackStyle ?? item.backStyle ?? "" : item.backStyle ?? "", pressed)
        return { back: back ? [{ kind: "image", visual: back, rect }] : [], fore }
      })
    }
    const fixed = item.foreRect!
    const oversized = rect.y < 0 || rect.y + rect.height > height
    const w = fixed.width * scale
    const h = Math.min(fixed.height * scale, height)
    const x = oversized && pressText(item) === "F31" ? 0
      : oversized && pressText(item) === "F8" ? width - w
      : rect.x + (rect.width - w) / 2
    const y = oversized ? (height - h) / 2 : rect.y + (rect.height - h) / 2
    const normal = await Promise.all(item.foreStyles.map((id) => resolver.resolve(id, false)))
    if (!normal.some((visual) => visual?.image && visual.source)) return
    return sceneKey(item.section, rect, async (pressed) => {
      const visuals = pressed ? await Promise.all(item.foreStyles.map((id) => resolver.resolve(id, true))) : normal
      const back = await resolver.resolve(pressed ? item.highlightBackStyle ?? item.backStyle ?? "" : item.backStyle ?? "", pressed)
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
  }))
  return { background: [], partial: true, keys: keys.filter((key) => key !== undefined) }
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
  return { background: [], partial: true, keys: items.filter((item) => ["F14", "F31", "F8", "F9"].includes(pressText(item))).map((item) => {
    const rect = item.rect
    const action = pressText(item)
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
