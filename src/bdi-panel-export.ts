import { strFromU8, strToU8 } from "fflate"
import { bakedTileText, packTiles } from "./font-bake.ts"
import { IniDocument } from "./ini.ts"
import { appendStyle } from "./ios-toolbar.ts"
import { foregroundLayerRect } from "./preview-draw.ts"
import { offsetFromSection, paddedRect, previewItems, type PreviewItem, type Rect } from "./preview-items.ts"
import { compositeImage, cropImage, decodePng, encodePng, MAX_PIXELS, pngSize, type RgbaImage } from "./ssf/ssf-png.ts"
import { tileSlices } from "./tiles.ts"

const integerRect = (r: Rect) => [r.x, r.y, r.width, r.height].every(Number.isSafeInteger) && r.width > 0 && r.height > 0
const intersects = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
const hasAction = (key: PreviewItem) => Boolean(key.center || key.up || key.down || key.left || key.right || key.hold || key.holdSymbols)

/** Repackage iOS-only panel layering for the Android renderer without moving any hit rectangles. */
export function adaptBdiPanels(files: Map<string, Uint8Array>, notes?: string[]): void {
  const documents = new Map<string, IniDocument>()
  const read = (path: string) => {
    const bytes = files.get(path)
    if (!bytes) return
    if (!documents.has(path)) documents.set(path, IniDocument.parse(strFromU8(bytes)))
    return documents.get(path)
  }
  const write = (path: string, doc: IniDocument) => files.set(path, strToU8(doc.toString()))
  const crops = new Map<string, RgbaImage>()
  const atlases = new Map<string, Map<string, { id: string; image: RgbaImage }>>()
  let hasOverflow = false
  for (const path of [...files.keys()]) {
    const match = path.match(/^(.*?)(port|land)\/(?!gen\.ini$)[^/]+\.ini$/i)
    if (!match) continue
    const [, root, orientation] = match
    const general = read(`${root}${orientation}/gen.ini`)
    const layout = read(path)!
    if (!layout.hasSection("PANEL")) continue
    const size = (layout.get("PANEL", "SIZE") || general?.get("PANEL", "SIZE"))?.split(",").map(Number)
    if (size?.length !== 2 || size.some((side) => !Number.isFinite(side) || side <= 0)) continue
    const keys = previewItems(layout, size[0], size[1]).filter(({ section }) => /^KEY\d+$/.test(section))
    if (!keys.length) continue
    const shared = `${root}res/`, local = `${root}${orientation}/res/`
    const folder = files.has(`${local}default.css`) ? local : shared
    const css = read(`${folder}default.css`)
    if (!css) continue
    let changed = false
    const back = layout.get("PANEL", "BACK_STYLE") ?? general?.get("PANEL", "BACK_STYLE")
    const base = keys.filter(({ section, rect, backStyle }) => rect.x === 0 && rect.y === 0 && rect.width === size[0] && rect.height === size[1]
      && /^[1-9]\d*$/.test(backStyle) && layout.entries(section).every(({ key }) => key === "BACK_STYLE" || key === "VIEW_RECT"))
    // Android paints higher-numbered keys later, even when the background is written first in the file.
    if ((!back?.trim() || back.trim() === "0") && base.length === 1) {
      layout.set("PANEL", "BACK_STYLE", base[0].backStyle)
      layout.removeSections([base[0].section])
      changed = true
    }
    const geometry = keys.map((key) => ({ key, area: paddedRect(key) })).filter(({ area }) => integerRect(area))
    const interactive = geometry.filter(({ key, area }) => hasAction(key) && area.width <= 2048 && area.height <= 2048)
    const patches = new Map<string, { image: RgbaImage; ids: string[] }>()
    const imageStyle = (id: string) => {
      const [name, index] = css.get(`STYLE${id}`, "NM_IMG")?.split(",").map((part) => part.trim()) ?? []
      if (!name || !/^\d+$/.test(index ?? "")) return
      const resource = files.has(`${local}${name}.png`) ? local : shared
      const til = read(`${resource}${name}.til`)
      if (!til) return
      const tile = tileSlices(til).find((item) => item.index === Number(index))
      const bytes = files.get(`${resource}${name}.png`)
      const dimensions = bytes && pngSize(bytes)
      if (!tile || !dimensions || dimensions[0] * dimensions[1] > MAX_PIXELS) return
      const [x, y, width, height] = tile.source
      if (!tile.source.every(Number.isSafeInteger) || x < 0 || y < 0 || width <= 0 || height <= 0
        || x + width > dimensions[0] || y + height > dimensions[1]) return
      return { tile, bytes, cropId: `${resource}${name},${index}` }
    }
    const pixels = ({ tile, bytes, cropId }: NonNullable<ReturnType<typeof imageStyle>>) => {
      let image = crops.get(cropId)
      if (!image) {
        try { image = cropImage(decodePng(bytes!), ...tile.source) } catch { return }
        crops.set(cropId, image)
      }
      return image
    }
    for (const { key, area } of geometry) for (const [layer, id] of key.foreStyles.entries()) {
      const sprite = imageStyle(id)
      if (!sprite) continue
      const { tile, cropId } = sprite
      const [, , width, height] = tile.source
      const offset = key.foreOffsets[layer] ?? offsetFromSection(general, `OFFSET${key.positionTypes[layer] ?? ""}`, area)
      const placed = foregroundLayerRect(area, tile.source, offset ?? [0, 0])
      const bounds = { ...placed, x: Math.round(placed.x), y: Math.round(placed.y) }
      if (bounds.x >= area.x && bounds.y >= area.y && bounds.x + width <= area.x + area.width && bounds.y + height <= area.y + area.height) continue
      for (const target of interactive) {
        const dest = target.area
        if (target.key === key || !intersects(dest, bounds)) continue
        const image = pixels(sprite)
        if (!image) break
        const fragment = cropImage(image, dest.x - bounds.x, dest.y - bounds.y, dest.width, dest.height)
        // The original layer still paints inside its own key; don't draw that part twice.
        for (let row = Math.max(area.y, dest.y); row < Math.min(area.y + area.height, dest.y + dest.height); row++) {
          const start = Math.max(area.x, dest.x) - dest.x, end = Math.min(area.x + area.width, dest.x + dest.width) - dest.x
          if (end > start) fragment.data.fill(0, ((row - dest.y) * dest.width + start) * 4, ((row - dest.y) * dest.width + end) * 4)
        }
        if (!fragment.data.some((alpha, i) => i % 4 === 3 && alpha !== 0)) continue
        const old = patches.get(target.key.section)
        const fragmentId = [cropId, dest.width, dest.height, bounds.x - dest.x, bounds.y - dest.y,
          area.x - dest.x, area.y - dest.y, area.width, area.height].join(":")
        patches.set(target.key.section, { image: old ? compositeImage(old.image, fragment) : fragment, ids: [...old?.ids ?? [], fragmentId] })
      }
    }
    // A previously exported BDS can reach this pass again through SXI. Do not blend the same slice twice.
    for (const { key } of interactive) {
      const patch = patches.get(key.section)?.image
      if (!patch) continue
      const exists = key.foreStyles.some((id) => {
        if (!/^_*keyskin_overlay\d+,/.test(css.get(`STYLE${id}`, "NM_IMG") ?? "")) return false
        const sprite = imageStyle(id)
        const image = sprite && pixels(sprite)
        return image?.width === patch.width && image.height === patch.height && image.data.every((value, i) => value === patch.data[i])
      })
      if (exists) patches.delete(key.section)
    }
    if (patches.size) {
      if (!atlases.has(folder)) atlases.set(folder, new Map())
      const sprites = atlases.get(folder)!
      for (const [section, { image, ids }] of patches) {
        const signature = JSON.stringify(ids)
        let sprite = sprites.get(signature)
        if (!sprite) {
          sprite = { id: appendStyle(css, []), image }
          sprites.set(signature, sprite)
        }
        addForeground(layout, section, sprite.id)
      }
      hasOverflow = changed = true
    }
    if (changed) write(path, layout)
  }
  for (const [folder, sprites] of atlases) {
    const cssPath = `${folder}default.css`
    const css = read(cssPath)!
    const entries = [...sprites.values()]
    for (let start = 0; start < entries.length;) {
      let batch = entries.slice(start, start + 32)
      let pack = packTiles(batch.map(({ image }) => image))
      while (batch.length > 1 && pack.height > 2048) {
        batch = batch.slice(0, Math.ceil(batch.length / 2))
        pack = packTiles(batch.map(({ image }) => image))
      }
      let name = `keyskin_overlay${start}`
      while (files.has(`${folder}${name}.png`) || files.has(`${folder}${name}.til`)) name = `_${name}`
      const data = new Uint8Array(pack.width * pack.height * 4)
      batch.forEach(({ id, image }, index) => {
        const [x, y] = pack.rects[index]
        for (let row = 0; row < image.height; row++) {
          data.set(image.data.subarray(row * image.width * 4, (row + 1) * image.width * 4), ((y + row) * pack.width + x) * 4)
        }
        css.set(`STYLE${id}`, "NM_IMG", `${name},${index + 1}`)
      })
      files.set(`${folder}${name}.png`, encodePng({ width: pack.width, height: pack.height, data }))
      files.set(`${folder}${name}.til`, strToU8(bakedTileText(pack.rects)))
      start += batch.length
    }
    write(cssPath, css)
  }
  if (hasOverflow) notes?.push("跨键前景已切片以完整显示；键外部分保留正常态，不随原按键的按下动画变化。")
}

function addForeground(layout: IniDocument, section: string, id: string): void {
  const append = (target: string) => {
    const fore = layout.get(target, "FORE_STYLE")?.trim().split(",").map((part) => part.trim()).filter(Boolean) ?? []
    const slots = layout.get(target, "POS_TYPE") ?? layout.get(section, "POS_TYPE")
    if (slots) layout.set(target, "POS_TYPE", [...Array.from({ length: fore.length }, (_, i) => slots.split(",")[i]?.trim() || "0"), "0"].join(","))
    const offsets = layout.get(target, "FORE_OFFSET") ?? layout.get(section, "FORE_OFFSET")
    if (offsets) layout.set(target, "FORE_OFFSET", [...Array.from({ length: fore.length }, (_, i) => offsets.split(";")[i] ?? ""), "0,0"].join(";"))
    const anim = layout.get(target, "FORE_ANIM_STYLE") ?? layout.get(section, "FORE_ANIM_STYLE")
    if (anim || layout.get(target, "ANIM_STYLE") || layout.get(section, "ANIM_STYLE")) {
      const values = anim?.split(",") ?? []
      layout.set(target, "FORE_ANIM_STYLE", [...Array.from({ length: fore.length }, (_, i) => values[i]?.trim() || values[0]?.trim() || "0"), "0"].join(","))
    }
    layout.set(target, "FORE_STYLE", [...fore, id].join(","))
  }
  const tips = new Set(Array.from(layout.get(section, "STAT_STYLE")?.matchAll(/S\d+_(\d+)/g) ?? [], ([, index]) => `TIP${index}`))
  for (const tip of tips) {
    if (layout.get(tip, "FORE_STYLE") !== undefined) append(tip)
  }
  append(section)
}
