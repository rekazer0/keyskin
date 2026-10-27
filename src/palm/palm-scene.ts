// Palm `skin.json` painted the way the Palm keyboard paints it: the board model (palm-board.ts) says
// where each key, list cell and candidate-bar icon is in a keyboard state, the styles (palm-styles.ts)
// what it looks like.

import { iconMarkup } from "../icons.ts"
import { sceneKey, type NativeScene, type SceneLayer, type SceneLayers } from "../native-scene.ts"
import type { Rect } from "../preview-items.ts"
import type { LegacyHint, LegacyHintIcon } from "../preview-hints.ts"
import { baseOf, list, numbers, type PalmBase, type PalmBoard, type PalmTheme } from "./palm-board.ts"
import type { PalmMotion } from "./palm-motion.ts"
import type { PalmStyles } from "./palm-styles.ts"
import { asObject, type JsonObject } from "./sxi-ini.ts"

// What shows through a transparent skin: the Palm keyboard's own backdrop, sampled from Palm previews.
const BACKDROP: Record<PalmTheme, string> = { default: "#d0d3d9", night: "#212121" }

async function keyLayers(styles: PalmStyles, board: PalmBoard, base: PalmBase, rect: Rect, pressed: boolean): Promise<SceneLayers> {
  const fore: SceneLayer[] = []
  const groups: number[] = []
  for (const [index, id] of base.fores.entries()) {
    const layer = await styles.fore(id, pressed, rect, board.offset(base.offsets[index]))
    if (layer) fore.push(layer)
    if (layer) groups.push(index)
  }
  return { back: base.back === undefined ? [] : await styles.back(base.back, pressed, rect), fore, groups }
}

/** One keyboard board of a theme and orientation, in a keyboard state, animated by `motion`. */
export async function palmBoardScene(board: PalmBoard, styles: PalmStyles, state?: number, motion?: PalmMotion): Promise<NativeScene> {
  const keys = await Promise.all(board.keys(state).map(({ section, rect, base }) =>
    sceneKey(section, rect, (pressed) => keyLayers(styles, board, base, rect, pressed))))
  const symbols = board.list()
  if (symbols) {
    keys.push(await sceneKey("LIST", symbols.bar, async (pressed) => ({ back: symbols.base.back === undefined ? [] : await styles.back(symbols.base.back, pressed, symbols.bar), fore: [] })))
    for (const cell of symbols.cells) {
      keys.push(await sceneKey(cell.section, cell.rect, async (pressed) => {
        const label = symbols.base.fores[0] === undefined ? undefined : await styles.fore(symbols.base.fores[0], pressed, cell.rect, undefined, cell.title)
        // Palm centres a cell's punctuation on its ink, like the Baidu canvas does.
        const fore = label?.kind === "text" ? { ...label, text: { ...label.text, ink: true } } : label
        return { back: symbols.cell === undefined ? [] : await styles.back(symbols.cell, pressed, cell.rect), fore: fore ? [fore] : [] }
      }))
    }
  }
  // Keys below the panel (a navigation-bar row) grow the surface; the backdrop covers it too.
  const surface = { x: 0, y: 0, width: board.width, height: Math.ceil(Math.max(board.height, ...keys.filter((key) => /^KEY/.test(key.section)).map((key) => key.rect.y + key.rect.height))) }
  const effects = motion?.effects(board.keys(state))
  return {
    background: [
      { kind: "fill", rect: surface, color: BACKDROP[board.theme] },
      ...board.panelBack === undefined ? [] : await styles.back(board.panelBack, false, surface),
    ],
    keys,
    ...effects ? { effects } : {},
  }
}

/**
 * A bubble layout (`h.<file>`) as the canvas draws bubbles: `info` pairs a bubble type with an icon of
 * `icon_info` (0 the tap bubble, 1 the long-press bar, 2–5 swipes up, down, left, right), `i_cell` is
 * the bar's cell style.
 */
export function palmHint(model: JsonObject): LegacyHint | undefined {
  const icons = new Map<string, LegacyHintIcon>()
  for (const [id, value] of Object.entries(asObject(model.icon_info ?? null) ?? {})) {
    const icon = asObject(value) ?? {}
    const size = numbers(icon.size ?? null)
    if (size?.length !== 2 || !(size[0] > 0 && size[1] > 0)) continue
    const position = numbers(icon.pos ?? null)
    const insets = asObject(icon.insets ?? null) ?? {}
    const inset = (side: string) => typeof insets[side] === "number" ? insets[side] as number : 0
    const base = baseOf(icon)
    icons.set(id, {
      backStyle: base.back === undefined ? "" : String(base.back),
      foreStyle: base.fores.map(String).join(","),
      size: [size[0], size[1]],
      position: position?.length === 2 ? [position[0], position[1]] : [0, 0],
      padding: [inset("left"), inset("top"), inset("right"), inset("bottom")],
    })
  }
  if (!icons.size) return
  const slots = new Map<number, string>()
  const info = list(model.info ?? null)
  for (let index = 0; index + 1 < info.length; index += 2) {
    if (typeof info[index] === "number" && (typeof info[index + 1] === "number" || typeof info[index + 1] === "string")) slots.set(info[index] as number, String(info[index + 1]))
  }
  return {
    icons,
    holdIcon: slots.get(0),
    barIcon: slots.get(1),
    upIcon: slots.get(2),
    downIcon: slots.get(3),
    leftIcon: slots.get(4),
    rightIcon: slots.get(5),
    ...model.i_cell === undefined ? {} : { cellStyle: String(model.i_cell) },
  }
}

/**
 * The candidate bar of a board: its backdrop and icons. The switch container (F14) holds the toolbar
 * functions, evenly spaced and only ever shrunk.
 */
export async function palmCandidateScene(board: PalmBoard, styles: PalmStyles, state: number | undefined): Promise<{ bar: SceneLayer[]; icons: NativeScene }> {
  const size = board.candidateSize
  if (!size) return { bar: [], icons: { background: [], keys: [] } }
  // Every icon is painted; the canvas lists only those its composition shows.
  const keys = await Promise.all(board.icons(state).map(async ({ section, rect, base, switch: container, fixed }) => {
    if (container) {
      const images = await styles.toolbarImages()
      return sceneKey(section, rect, async () => {
        const slot = rect.width / Math.max(1, images.length)
        return { back: [], fore: images.map((visual, at) => {
          const [, , width, height] = visual.source!
          const scale = Math.min(1, slot / width, rect.height / height)
          return { kind: "image", visual, rect: {
            x: rect.x + at * slot + (slot - width * scale) / 2,
            y: rect.y + (rect.height - height * scale) / 2,
            width: width * scale,
            height: height * scale,
          } } as const
        }) }
      })
    }
    return sceneKey(section, rect, async (pressed) => {
      const fore: SceneLayer[] = []
      for (const id of base.fores) {
        const layer = await styles.fore(id, pressed, rect, undefined)
        if (!layer) continue
        fore.push(fixed && layer.kind === "image"
          ? { ...layer, rect: { x: rect.x + (rect.width - fixed[0]) / 2, y: rect.y + (rect.height - fixed[1]) / 2, width: fixed[0], height: fixed[1] } }
          : layer)
      }
      return { back: base.back === undefined ? [] : await styles.back(base.back, pressed, rect), fore }
    })
  }))
  if (!keys.length) {
    const fore = await builtInToolbar(board, styles)
    keys.push(await sceneKey("BUILTIN_TOOLBAR", { x: 0, y: 0, ...size }, async () => ({ back: [], fore })))
  }
  const back = board.candidateBack
  return {
    bar: back === undefined ? [] : await styles.back(back, false, { x: 0, y: 0, ...size }),
    icons: { background: [], keys },
  }
}

// What the Palm keyboard draws on a bar the skin gives no icons (the built-in template's preview):
// settings, keyboard switch, skins and emoji centred in sevenths from the left, hide in the last.
const BUILT_IN_TOOLBAR = ["settings", "keyboard", "shirt", "smile"]

async function builtInToolbar(board: PalmBoard, styles: PalmStyles): Promise<SceneLayer[]> {
  const size = board.candidateSize
  if (!size || typeof document === "undefined") return []
  const color = styles.resolveText(String(board.candidateTextStyles.words ?? ""), false)?.color ?? "#333333"
  // Match the built-in bar's icon-to-height ratio, including on landscape keyboards.
  const side = Math.min(size.width / 14, size.height * 2 / 3)
  const slot = size.width / 7
  const icon = async (name: string, x: number): Promise<SceneLayer> => {
    // Rasterised at 3× so the canvas's device scale keeps the strokes sharp.
    const image = new Image()
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconMarkup(name, side * 3).replaceAll("currentColor", color))}`
    await image.decode()
    const bitmap = await createImageBitmap(image)
    return { kind: "image", visual: { image: bitmap, source: [0, 0, bitmap.width, bitmap.height] }, rect: { x: x - side / 2, y: (size.height - side) / 2, width: side, height: side } }
  }
  return Promise.all([...BUILT_IN_TOOLBAR.map((name, index) => icon(name, slot * (index + 0.5))), icon("chevron-down", size.width - slot / 2)])
}
