import { strFromU8, strToU8 } from "fflate"
import { IniDocument } from "./ini.ts"
import { appendStyle } from "./ios-toolbar.ts"
import { cropImage, decodePng, encodePng, MAX_PIXELS, pngSize } from "./ssf/ssf-png.ts"
import { tileSlices } from "./tiles.ts"

/** Android draws the toolbar separately; use the authored lower slice instead of stretching the whole scene under it. */
export function adaptIosPanelBackgrounds(
  files: Map<string, Uint8Array>, root: string, orientation: string,
  general: IniDocument, candidate: IniDocument, styles: IniDocument, joined: Set<string>,
): void {
  const directory = `${root}${orientation}/`
  const style = (document: IniDocument, section: string) => document.get(section, "BACK_STYLE")?.split(",")[0].trim()
  const panelBack = style(general, "PANEL")
  const candBack = style(candidate, "CAND")
  if (!panelBack || !candBack) return
  const read = (reference: string | undefined) => {
    const [name, index] = reference?.split(",").map((part) => part.trim()) ?? []
    if (!name || !/^\d+$/.test(index ?? "")) return
    const folder = files.has(`${directory}res/${name}.png`) ? `${directory}res/` : `${root}res/`
    const path = `${folder}${name}.png`
    const til = files.get(`${folder}${name}.til`)
    if (!files.has(path) || !til) return
    const slice = tileSlices(IniDocument.parse(strFromU8(til))).find((item) => item.index === Number(index))
    if (slice && !slice.inner && slice.source.every(Number.isInteger) && slice.source[0] >= 0 && slice.source[1] >= 0
      && slice.source[2] > 0 && slice.source[3] > 0) return { path, rect: slice.source }
  }
  const ref = (id: string, key: string) => styles.get(`STYLE${id}`, key)
  const patched = new Map<string, string>()
  for (const [path, bytes] of files) {
    if (!path.startsWith(directory) || !/^[^/]+\.ini$/.test(path.slice(directory.length))) continue
    const layout = IniDocument.parse(strFromU8(bytes))
    const back = style(layout, "PANEL")
    if (!back || !/^\d+$/.test(back) || back === panelBack) continue
    if (!patched.has(back)) {
      const entries = styles.entries(`STYLE${back}`).map(({ key, value }) => ({ key, value }))
      let changed = false
      for (const entry of entries.filter(({ key }) => key === "NM_IMG" || key === "HL_IMG")) {
        const baseRef = ref(panelBack, entry.key) ?? ref(panelBack, "NM_IMG")
        const base = read(baseRef)
        const bar = read(ref(candBack, entry.key) ?? ref(candBack, "NM_IMG"))
        const whole = read(entry.value)
        if (!baseRef || !base || !bar || !whole || base.path !== whole.path || bar.path !== whole.path) continue
        const [x, y, width, height] = whole.rect
        const [barX, barY, barW, barH] = bar.rect
        const [baseX, baseY, baseW, baseH] = base.rect
        const png = files.get(whole.path)!
        const size = pngSize(png)
        if (!size || x + width > size[0] || y + height > size[1] || barX !== x || baseX !== x || barW !== width || baseW !== width
          || barY < y || barY + barH !== baseY || baseY + baseH !== y + height) continue
        joined.add(whole.path)
        entry.value = baseRef
        changed = true
      }
      patched.set(back, changed ? appendStyle(styles, entries) : back)
    }
    const next = patched.get(back)!
    if (next !== back) {
      layout.set("PANEL", "BACK_STYLE", layout.get("PANEL", "BACK_STYLE")!.replace(/^\s*\d+/, next))
      files.set(path, strToU8(layout.toString()))
    }
  }
}

/** Separate the background slices so Android does not reuse the same bitmap for different bands. */
export function separateBdsBackgroundSlices(files: Map<string, Uint8Array>, cssPath: string, atlases: Set<string>): void {
  if (!atlases.size) return
  const styles = IniDocument.parse(strFromU8(files.get(cssPath)!))
  const folder = cssPath.slice(0, -"default.css".length)
  const entries = styles.entries().filter(({ key }) => key === "NM_IMG" || key === "HL_IMG")
  for (const path of atlases) {
    const name = path.split("/").at(-1)!.slice(0, -4)
    // A shared table can still be used with resources supplied by an orientation-specific directory.
    if (folder === path.slice(0, -`${name}.png`.length) && ["port", "land"].some((orientation) =>
      files.has(`${folder.slice(0, -4)}${orientation}/res/${name}.png`))) continue
    const til = IniDocument.parse(strFromU8(files.get(path.replace(/\.png$/, ".til"))!))
    const references = new Map<number, string>()
    const png = decodePng(files.get(path)!)
    for (const { section, key, value } of entries) {
      const [resource, index] = value.split(",").map((part) => part.trim())
      if (resource !== name || !/^\d+$/.test(index ?? "")) continue
      const id = Number(index)
      if (!references.has(id)) {
        const tile = tileSlices(til).find((tile) => tile.index === id)
        if (!tile || tile.inner || til.get(`IMG${id}`, "SCALE")) continue
        const [x, y, width, height] = tile.source
        if (!tile.source.every(Number.isInteger) || x < 0 || y < 0 || width < 1 || height < 1
          || x + width > png.width || y + height > png.height || width * (height + 1) > MAX_PIXELS) continue
        let target = `keyskin_${name}_band${id}`
        while (files.has(`${folder}${target}.png`) || files.has(`${folder}${target}.til`)) target = `_${target}`
        const image = cropImage(png, x, y, width, height + 1)
        image.data.fill(0, width * height * 4)
        files.set(`${folder}${target}.png`, encodePng(image))
        const alpha = til.get("GLOBAL", "USE_ALPHA")
        files.set(`${folder}${target}.til`, strToU8(`[GLOBAL]\r\nTILE_NUM=1\r\n${alpha !== undefined ? `USE_ALPHA=${alpha}\r\n` : ""}\r\n[IMG1]\r\nSOURCE_RECT=0,0,${width},${height}\r\n`))
        references.set(id, `${target},1`)
      }
      styles.set(section, key, references.get(id)!)
    }
  }
  files.set(cssPath, strToU8(styles.toString()))
}
