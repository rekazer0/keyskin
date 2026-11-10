import { strFromU8, strToU8 } from "fflate"
import { deviceSpec } from "./devices.ts"
import { IniDocument } from "./ini.ts"
import { appendStyle } from "./ios-toolbar.ts"
import { resolveCandidateRect } from "./candidate-style.ts"
import { parseXmlPlist } from "./palm/palm-plist.ts"
import { cropImage, decodePng, encodePng, MAX_PIXELS, nineSliceImage, pngSize, resizeImage } from "./ssf/ssf-png.ts"

/** iOS toolbar sizes are @3x pixels, independent of the keyboard's layout width. */
export function iosToolbarScale(width: number, devicePointWidth: number | undefined): number {
  return devicePointWidth && devicePointWidth > 0 ? width / (3 * devicePointWidth) : 1
}

/** Materialise iOS point sizes in exported layout units before another keyboard reads them. */
export function adaptIosToolbarGeometry(files: Map<string, Uint8Array>): void {
  const text = (path: string) => {
    const bytes = files.get(path)
    return bytes && IniDocument.parse(strFromU8(bytes))
  }
  const numbers = (value?: string) => value?.split(",").map(Number)
  const frame = deviceSpec("iphone-17-pro-max")!.frame!
  const toolbarImages = new Map<string, number>()
  for (const path of [...files.keys()]) {
    const match = path.match(/^(.*?)(port|land)\/gen\.ini$/)
    if (!match) continue
    const [, root, orientation] = match
    const gen = text(path)!
    const plist = files.get(`${root}res/logo/com.baidu.inputmethod.toolbarMenuItems.plist`)
    if (!gen.get("LOGO", "LAYOUT_NAME") && !plist) continue
    const candPath = `${root}${orientation}/${gen.get("CAND", "LAYOUT_NAME")?.trim()}.cnd`
    const cand = text(candPath)
    const cssPath = files.has(`${root}${orientation}/res/default.css`)
      ? `${root}${orientation}/res/default.css` : `${root}res/default.css`
    const css = text(cssPath)
    if (!cand || !css) continue
    const { x, y, width, height: originalHeight } = resolveCandidateRect(cand, gen)
    // shortcut: exports use the same reference iPhone as canvas mode; recalibrate with other native layouts.
    const scale = iosToolbarScale(width, orientation === "port" ? frame.viewportWidth : frame.viewportHeight)
    const height = Math.max(1, Math.round(originalHeight * scale))
    const rect = [x, y, width, height].join(",")
    gen.set("CAND", "VIEW_RECT", rect)
    if (cand.get("CAND", "VIEW_RECT")) cand.set("CAND", "VIEW_RECT", rect)
    const image = (reference?: string, destination?: [number, number]) => {
      const [name, index] = reference?.split(",").map((part) => part.trim()) ?? []
      if (!name) return
      const folder = files.has(`${root}${orientation}/res/${name}.png`) ? `${root}${orientation}/res/` : `${root}res/`
      const til = text(`${folder}${name}.til`)
      const source = numbers(til?.get(`IMG${index}`, "SOURCE_RECT"))
      const bytes = files.get(`${folder}${name}.png`)
      if (!bytes || source?.length !== 4 || !source.every(Number.isFinite)) return
      const decoded = decodePng(bytes)
      if (!source.every(Number.isInteger) || source[0] < 0 || source[1] < 0 || source[2] <= 0 || source[3] <= 0
        || source[0] + source[2] > decoded.width || source[1] + source[3] > decoded.height) return
      const inner = numbers(til?.get(`IMG${index}`, "INNER_RECT"))
      if (destination && inner?.length === 4 && inner.every(Number.isInteger) && inner[2] > 0 && inner[3] > 0
        && inner[0] >= source[0] && inner[1] >= source[1] && inner[0] + inner[2] <= source[0] + source[2]
        && inner[1] + inner[3] <= source[1] + source[3]) return nineSliceImage(decoded, source, inner, ...destination)
      const cropped = cropImage(decoded, source[0], source[1], source[2], source[3])
      return destination ? resizeImage(cropped, ...destination) : cropped
    }
    const menu = plist && parseXmlPlist(plist)
    const functionHeights = Array.isArray(menu) ? menu.flatMap((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value) || value.Position !== "toolbar") return []
      const name = (value.Images as { Normal?: { Normal?: string } } | undefined)?.Normal?.Normal
      if (!name) return []
      const path = [name, `${name}_iphone@3x.png`, `${name}.png`].map((name) => `${root}res/logo/${name}`).find((path) => files.has(path))
      const bytes = path && files.get(path)
      const size = bytes && pngSize(bytes)
      // Native menu images are shared across orientations; portrait determines their exported pixel size.
      if (path && size && (orientation === "port" || !toolbarImages.has(path))) toolbarImages.set(path, scale)
      return size ? [size[1] * scale] : []
    }) : []
    for (const section of cand.sections().filter((name) => /^ICON\d+$/.test(name))) {
      const action = cand.get(section, "KEY")?.trim()
      const size = numbers(cand.get(section, "SIZE"))
      const pos = numbers(cand.get(section, "POS")) ?? [0, 0]
      if (size?.length !== 2 || ![...size, ...pos].every(Number.isFinite) || size.some((side) => side <= 0)) continue
      const anchor = Number(cand.get(section, "ANCHOR_TYPE")) || 1
      const top = (Math.ceil(anchor / 3) - 1) * originalHeight / 2 + pos[1]
      const left = (anchor - 1) % 3 * width / 2 + pos[0]
      if (left + size[0] <= 0 || left >= width || top + size[1] <= 0 || top >= originalHeight) continue
      if (action === "F14") {
        const h = Math.min(height, Math.max(1, Math.round(functionHeights.length ? Math.max(...functionHeights) : size[1] * scale)))
        cand.set(section, "ANCHOR_TYPE", String((anchor - 1) % 3 + 1))
        cand.set(section, "POS", [pos[0], (height - h) / 2].join(","))
        cand.set(section, "SIZE", [size[0], h].join(","))
        continue
      }
      const fixed = numbers(cand.get(section, "FIX_SIZE"))
      if (!fixed || fixed.length !== 2 || fixed.some((side) => !Number.isFinite(side) || side <= 0) || !["F31", "F8", "F9"].includes(action ?? "")) {
        cand.set(section, "POS", [pos[0], pos[1] * scale].join(","))
        cand.set(section, "SIZE", [size[0], Math.max(1, Math.round(size[1] * scale))].join(","))
        continue
      }
      const w = Math.max(1, Math.round(fixed[0] * 3 * scale))
      const h = Math.min(height, Math.max(1, Math.round(fixed[1] * 3 * scale)))
      if (w * h > MAX_PIXELS) continue
      const fore = cand.get(section, "FORE_STYLE")?.split(",").map((id) => {
        const entries = css.entries(`STYLE${id.trim()}`).map(({ key, value }) => ({ key, value }))
        let changed = false
        for (const entry of entries.filter(({ key }) => key === "NM_IMG" || key === "HL_IMG")) {
          const source = image(entry.value)
          if (!source) continue
          const fit = Math.min(w / source.width, h / source.height)
          const output = resizeImage(source, Math.max(1, Math.round(source.width * fit)), Math.max(1, Math.round(source.height * fit)))
          let name = `keyskin_${orientation}_${section}_${entry.key.toLowerCase()}`
          while (files.has(`${root}res/${name}.png`)) name = `_${name}`
          files.set(`${root}res/${name}.png`, encodePng(output))
          files.set(`${root}res/${name}.til`, strToU8(`[IMG1]\nSOURCE_RECT=0,0,${output.width},${output.height}\n`))
          entry.value = `${name},1`
          changed = true
        }
        return changed ? appendStyle(css, entries) : id
      })
      if (fore) cand.set(section, "FORE_STYLE", fore.join(","))
      cand.remove(section, "FIX_SIZE")
      cand.set(section, "ANCHOR_TYPE", action === "F8" ? "3" : "1")
      cand.set(section, "SIZE", [w, h].join(","))
      cand.set(section, "POS", [action === "F8" ? -w : Math.max(0, left), (height - h) / 2].join(","))
    }
    const back = cand.get("CAND", "BACK_STYLE")?.split(",")[0]
    const entries = css.entries(`STYLE${back}`).map(({ key, value }) => ({ key, value }))
    let baked = false
    if (width * height <= MAX_PIXELS && Number.isInteger(width)) for (const entry of entries.filter(({ key }) => key === "NM_IMG" || key === "HL_IMG")) {
      const output = image(entry.value, [width, height])
      if (!output) continue
      let name = `keyskin_${orientation}_candidate_${entry.key.toLowerCase()}`
      while (files.has(`${root}res/${name}.png`)) name = `_${name}`
      files.set(`${root}res/${name}.png`, encodePng(output))
      files.set(`${root}res/${name}.til`, strToU8(`[IMG1]\nSOURCE_RECT=0,0,${width},${height}\n`))
      entry.value = `${name},1`
      baked = true
    }
    if (baked) cand.set("CAND", "BACK_STYLE", appendStyle(css, entries))
    files.set(path, strToU8(gen.toString()))
    files.set(candPath, strToU8(cand.toString()))
    files.set(cssPath, strToU8(css.toString()))
  }
  for (const [path, scale] of toolbarImages) {
    const image = decodePng(files.get(path)!)
    files.set(path, encodePng(resizeImage(image, Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)))))
  }
}
