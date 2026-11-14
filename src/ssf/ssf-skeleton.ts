// Sogou's official keyboard skeleton (layouts and built-in artwork extracted from the Sogou APK, in
// the canvas's INI schema) laid out for one look of a skin at the skin's resolution. The SSF canvas
// takes its key sections and geometry from here; the Baidu export paints the skin's look onto it.

import { strToU8 } from "fflate"
import { IniDocument } from "../ini.ts"
import { scaleIniDocument } from "../panel-tools.ts"
import type { SkinArchive } from "../skin.ts"
import type { SsfTheme } from "./ssf-package.ts"
import { ssfKeyActions } from "./ssf-keymap.ts"

function size(value: string | undefined): number[] {
  return value?.split(",").map((part) => Number(part.trim())) ?? []
}

/** Layout units per skeleton unit, per orientation, and the factor text sizes follow. */
export function ssfSkeletonScale(base: SkinArchive, panelWidth?: number): { port: [number, number]; land: [number, number]; text: number } {
  const panel = base.isText("light/skin/port/gen.ini") ? IniDocument.parse(base.getText("light/skin/port/gen.ini")).get("PANEL", "SIZE") : undefined
  const templateWidth = size(panel)[0] || 480
  const scale = (panelWidth || templateWidth) / templateWidth
  const scales = { port: [scale, scale] as [number, number], land: [scale, scale] as [number, number], text: panelWidth ? scale : 1 }
  // Sogou PhoneSkinMgr's SkinUILayoutHelper.getSkinSize uses separate landscape dimensions.
  const landscape = new Map([[1080, [1920, 570]], [720, [1280, 380]], [480, [854, 260]]]).get(panelWidth ?? 0)
  if (landscape && base.isText("light/skin/land/gen.ini")) {
    const [width, height] = size(IniDocument.parse(base.getText("light/skin/land/gen.ini")).get("PANEL", "SIZE"))
    if (width > 0 && height > 0) scales.land = [landscape[0] / width, landscape[1] / height]
  }
  return scales
}

/** Copies the skeleton's `light/skin` tree to `theme`'s, layouts scaled to `panelWidth`. */
export function copySsfSkeleton(base: SkinArchive, theme: SsfTheme, output: Map<string, Uint8Array>, panelWidth?: number): void {
  const scales = ssfSkeletonScale(base, panelWidth)
  const prefix = "light/skin/"
  for (const path of base.names()) {
    if (!path.startsWith(prefix) || path.endsWith("/")) continue
    const name = path.slice(prefix.length)
    if (name === "Info.txt" || name === "demo.png") continue
    let bytes = base.getBytes(path)!
    const orientation = name.match(/^(port|land)\/.*\.(?:ini|cnd)$/i)?.[1] as "port" | "land" | undefined
    const [xScale, yScale] = orientation ? scales[orientation] : [1, 1]
    if (orientation) {
      const document = scaleIniDocument(IniDocument.parse(new TextDecoder().decode(bytes)), xScale, yScale)
      for (const section of document.sections().filter((section) => /^KEY\d+$/.test(section))) {
        const action = document.get(section, "CENTER")
        if (!action) continue
        for (const [field, value] of Object.entries(ssfKeyActions(name.split("/").pop()!, action, document.get(section, "SSF_SECTION")))) {
          if (document.get(section, field) === undefined) document.set(section, field, value)
        }
      }
      bytes = strToU8(document.toString())
    }
    output.set(`${theme}/skin/${name}`, bytes)
  }
}
