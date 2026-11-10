import { IniDocument } from "./ini.ts"
import { SkinArchive } from "./skin.ts"
import { layoutsUsingStyle } from "./font-bake.ts"
import { skinStylePaths } from "./font-files.ts"
import { decodePng, encodePng, MAX_PIXELS, nineSliceImage } from "./ssf/ssf-png.ts"

type Rect = [number, number, number, number]
type ImageRef = { name: string; tile: number }

const rect = (value: string | undefined): Rect | undefined => {
  const values = value?.split(",").map((part) => Number(part.trim()))
  return values?.length === 4 && values.every(Number.isFinite) ? values as Rect : undefined
}

function imageRef(value: string | undefined): ImageRef | undefined {
  const [name, tile] = value?.split(",").map((part) => part.trim()) ?? []
  const index = Number(tile)
  return name && Number.isInteger(index) ? { name, tile: index } : undefined
}

function styleEntries(css: IniDocument, id: number): Array<{ key: string; value: string }> | undefined {
  return css.sections().includes(`STYLE${id}`) ? css.entries(`STYLE${id}`).map(({ key, value }) => ({ key, value })) : undefined
}

/** Complete Android's unsupported light-mode INNER_RECT before it stretches a background. */
export function bakeBdsBackgrounds(bytes: Uint8Array): Uint8Array {
  const archive = SkinArchive.open(bytes, "bds")
  let changed = false
  // Only the ordinary light renderer ignores INNER_RECT; night mode builds a real NinePatch.
  const names = archive.names()
  const stylePaths = skinStylePaths(names).filter((path) => path.startsWith("light/"))
  const bakedImages = new Map<string, string>()
  let nextStyle = Math.max(0, ...stylePaths.flatMap((path) => IniDocument.parse(archive.getText(path)).sections()
    .flatMap((name) => /^STYLE(\d+)$/.test(name) ? [Number(name.slice(5))] : []))) + 1
  const res = "light/skin/res"
  for (const cssPath of stylePaths) {
    const css = IniDocument.parse(archive.getText(cssPath))
    const variants = new Map<string, number>()
    let themeChanged = false
    for (const path of layoutsUsingStyle(names, cssPath)) {
      const roots = [`${path.slice(0, path.lastIndexOf("/"))}/res`, res]
      const layout = IniDocument.parse(archive.getText(path))
      for (const section of layout.sections()) {
        const styleID = Number(layout.get(section, "BACK_STYLE"))
        const size = section === "PANEL" ? rect(layout.get(section, "SIZE")) : rect(layout.get(section, "VIEW_RECT"))
        if (!Number.isInteger(styleID) || !size || size[2] <= 0 || size[3] <= 0 || size[2] * size[3] > MAX_PIXELS) continue
        const entries = styleEntries(css, styleID)
        if (!entries) continue
        const images = entries.filter(({ key }) => key === "NM_IMG" || key === "HL_IMG").map((entry) => {
          const ref = imageRef(entry.value)
          const base = ref && roots.map((root) => `${root}/${ref.name}`)
            .find((base) => archive.getBytes(`${base}.png`) && archive.getBytes(`${base}.til`))
          return { ...entry, ref, base }
        })
        if (!images.length) continue
        const key = `${styleID}:${size[2]}:${size[3]}:${images.map(({ base }) => base).join("|")}`
        let variant = variants.get(key)
        let variantEntries: Array<{ key: string; value: string }> | undefined
        if (variant === undefined) {
          variant = styleID
          variantEntries = entries.map((entry) => ({ ...entry }))
          let baked = false
          for (const image of images) {
            const { ref, base } = image
            if (!ref || !base) continue
            const tilPath = `${base}.til`
            const pngPath = `${base}.png`
            const tilBytes = archive.getBytes(tilPath)
            const pngBytes = archive.getBytes(pngPath)
            if (!tilBytes || !pngBytes) continue
            const tiles = IniDocument.parse(archive.getText(tilPath))
            const source = rect(tiles.get(`IMG${ref.tile}`, "SOURCE_RECT"))
            const inner = rect(tiles.get(`IMG${ref.tile}`, "INNER_RECT"))
            if (!source || !inner || inner[2] <= 0 || inner[3] <= 0 || source[2] <= 0 || source[3] <= 0) continue
            if (inner[0] < source[0] || inner[1] < source[1] || inner[0] + inner[2] > source[0] + source[2] || inner[1] + inner[3] > source[1] + source[3]) continue
            if (source[2] === size[2] && source[3] === size[3]) continue
            const imageKey = `${base},${ref.tile}:${size[2]},${size[3]}`
            let outputName = bakedImages.get(imageKey)
            if (!outputName) {
              const decoded = decodePng(pngBytes)
              if (source[0] < 0 || source[1] < 0 || source[0] + source[2] > decoded.width || source[1] + source[3] > decoded.height) continue
              outputName = `keyskin_bds_${nextStyle}_${image.key.toLowerCase()}`
              archive.setBytes(`${res}/${outputName}.png`, encodePng(nineSliceImage(decoded, source, inner, size[2], size[3])))
              archive.setText(`${res}/${outputName}.til`, `[GLOBAL]\r\nTILE_NUM=1\r\n[IMG1]\r\nSOURCE_RECT=0,0,${size[2]},${size[3]}\r\n`)
              bakedImages.set(imageKey, outputName)
            }
            const target = variantEntries.find((entry) => entry.key === image.key && entry.value === image.value)
            if (target) target.value = `${outputName},1`
            baked = true
            changed = true
            themeChanged = true
          }
          if (baked) {
            variant = nextStyle++
            css.appendSection(`STYLE${variant}`, variantEntries)
            variants.set(key, variant)
          }
        }
        if (variant !== styleID) {
          layout.set(section, "BACK_STYLE", String(variant))
          changed = true
          themeChanged = true
        }
      }
      archive.setText(path, layout.toString())
    }
    if (themeChanged && nextStyle > Math.max(0, Number(css.get("GLOBAL", "STYLE_NUM") ?? 0))) {
      css.set("GLOBAL", "STYLE_NUM", String(nextStyle))
      changed = true
    }
    if (themeChanged) archive.setText(cssPath, css.toString())
  }
  return changed ? archive.toBytes("bds") : bytes
}
