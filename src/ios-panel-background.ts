// iOS Baidu stretches a layout's PANEL background over the whole keyboard, candidate bar included, and paints the
// bar's own background on top of it; Android fits the panel below the bar. An Android skin that splits one picture
// into a bar slice and a panel slice therefore loses the top of the panel slice on iPhone, hidden behind the bar.
import { strFromU8, strToU8 } from "fflate"
import { IniDocument } from "./ini.ts"
import { candidateInputBackgroundStyle, candidateInputSizeForeground, inputBarMetrics } from "./candidate-style.ts"
import { appendStyle } from "./ios-toolbar.ts"
import { addZipEntry } from "./skin-zip.ts"
import { cropImage, decodePng, encodePng, resizeImage, type RgbaImage } from "./ssf/ssf-png.ts"

const numbers = (value?: string) => value?.split(",").map(Number)

/**
 * Stacks the bar slice above each panel slice in the skin's own proportions and clears the bar's background, so the
 * picture shows whole on iPhone the way Android draws it. Nine-patch slices and solid colours are left as they are.
 */
export function adaptIosPanelBackground(files: Map<string, Uint8Array>, warnings?: string[]): void {
  const text = (path: string) => {
    const bytes = files.get(path)
    return bytes && strFromU8(bytes)
  }
  let adapted = false
  for (const path of [...files.keys()]) {
    const match = path.match(/^(skin\/(?:(?:light|dark)\/skin\/)?)(port|land)\/gen\.ini$/)
    if (!match) continue
    const [, root, orientation] = match
    const gen = IniDocument.parse(text(path)!)
    const candPath = `${root}${orientation}/${gen.get("CAND", "LAYOUT_NAME")?.trim()}.cnd`
    const cssPath = `${root}res/default.css`
    const candText = text(candPath)
    const cssText = text(cssPath)
    const [, , barWidth, barHeight] = numbers(gen.get("CAND", "VIEW_RECT")) ?? []
    const panelSize = numbers(gen.get("PANEL", "SIZE")) ?? []
    if (!candText || !cssText || !(barWidth > 0 && barHeight > 0)) continue
    const cand = IniDocument.parse(candText)
    const css = IniDocument.parse(cssText)
    // A slice the client stretches whole: no INNER_RECT, or one that covers the slice.
    const picture = (style?: string): RgbaImage | undefined => {
      const [resource, tile] = (style && css.get(`STYLE${style}`, "NM_IMG")?.split(",")) || []
      const bytes = resource && files.get(`${root}res/${resource}.png`)
      const til = resource && text(`${root}res/${resource}.til`)
      if (!bytes || !til) return
      const tiles = IniDocument.parse(til)
      const rect = numbers(tiles.get(`IMG${tile}`, "SOURCE_RECT"))
      const inner = numbers(tiles.get(`IMG${tile}`, "INNER_RECT"))
      if (rect?.length !== 4 || !rect.every(Number.isFinite)) return
      const [x, y, width, height] = rect
      if (inner && !(inner[0] <= x && inner[1] <= y && inner[0] + inner[2] >= x + width && inner[1] + inner[3] >= y + height)) return
      return cropImage(decodePng(bytes), x, y, width, height)
    }
    const barStyle = cand.get("CAND", "BACK_STYLE")?.trim()
    const bar = picture(barStyle)
    if (!bar) continue
    const input = picture(candidateInputBackgroundStyle(gen, cand, true))
    const inputFont = Number(css.get(`STYLE${candidateInputSizeForeground(gen, cand)}`, "FONT_SIZE"))
    const inputHeight = input ? inputBarMetrics(inputFont, barWidth, input).height : 0

    const stacked = new Map<string, string>()
    for (const layoutPath of [...files.keys()]) {
      if (!layoutPath.startsWith(`${root}${orientation}/`) || !layoutPath.endsWith(".ini")) continue
      const layout = IniDocument.parse(text(layoutPath)!)
      const style = layout.get("PANEL", "BACK_STYLE")?.trim()
      const [panelWidth, panelHeight] = numbers(layout.get("PANEL", "SIZE")) ?? panelSize
      const panel = picture(style)
      if (!panel || !(panelWidth > 0 && panelHeight > 0)) continue
      const key = `${style},${panelWidth},${panelHeight}`
      let id = stacked.get(key)
      if (!id) {
        const barPicture = withoutBottomSeam(bar, panel)
        // iOS has an inline input row above the toolbar; omitting it lifts the bar's bottom seam into the toolbar.
        const width = panel.width
        const inputRows = Math.round(inputHeight * width / barWidth)
        const top = Math.round(barHeight * width / barWidth)
        const bottom = Math.round(panelHeight * width / panelWidth)
        const image = { width, height: inputRows + top + bottom, data: new Uint8Array(width * (inputRows + top + bottom) * 4) }
        if (input && inputRows > 0) image.data.set(resizeImage(input, width, inputRows).data)
        image.data.set(resizeImage(barPicture, width, top).data, width * inputRows * 4)
        image.data.set(resizeImage(panel, width, bottom).data, width * (inputRows + top) * 4)
        let name: string
        let index = stacked.size
        do name = `ios_keyboard_${orientation}${++index}`
        while (files.has(`${root}res/${name}.png`))
        addZipEntry(files, `${root}res/${name}.png`, encodePng(image))
        addZipEntry(files, `${root}res/${name}.til`, strToU8(`[GLOBAL]\nTILE_NUM=1\n\n[IMG1]\nSOURCE_RECT=0,0,${width},${image.height}\n`))
        id = appendStyle(css, [{ key: "NM_IMG", value: `${name},1` }, { key: "HL_IMG", value: `${name},1` }])
        stacked.set(key, id)
      }
      layout.set("PANEL", "BACK_STYLE", id)
      files.set(layoutPath, strToU8(layout.toString()))
    }
    if (!stacked.size) continue
    const clear = appendStyle(css, [{ key: "NM_COLOR", value: "00000000" }, { key: "HL_COLOR", value: "00000000" }])
    for (const section of cand.sections()) {
      if (cand.get(section, "BACK_STYLE")?.trim() === barStyle) cand.set(section, "BACK_STYLE", clear)
    }
    files.set(candPath, strToU8(cand.toString()))
    files.set(cssPath, strToU8(css.toString()))
    adapted = true
  }
  if (adapted) warnings?.push("iPhone 会把键盘背景铺满整个键盘（含工具栏）：已把工具栏背景与键盘背景拼成一张整图，工具栏背景改为透明")
}

/** A flat bar over the same flat panel needs no baked bottom separator on iOS. Keep artwork untouched. */
function withoutBottomSeam(bar: RgbaImage, panel: RgbaImage): RgbaImage {
  const color = panel.data.subarray(0, 4)
  if (color[3] !== 255 || !panel.data.every((value, index) => value === color[index % 4])) return bar
  const edgeRows = Math.max(2, Math.ceil(bar.height / 100))
  if (bar.height <= edgeRows) return bar
  const edge = bar.width * (bar.height - edgeRows) * 4
  if (!bar.data.subarray(0, edge).every((value, index) => value === color[index % 4])) return bar
  if (bar.data.subarray(edge).every((value, index) => value === color[index % 4])) return bar
  const data = bar.data.slice()
  for (let offset = edge; offset < data.length; offset += 4) data.set(color, offset)
  return { ...bar, data }
}
