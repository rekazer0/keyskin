import { strToU8 } from "fflate"
import { IniDocument } from "../ini.ts"
import { withTileHeader, type TileRect } from "../tiles.ts"
import { SsfArtwork } from "./ssf-artwork.ts"
import type { LookImage, LookPair } from "./ssf-look.ts"
import { composeAtlasPng } from "./ssf-png.ts"

type Artwork = ReturnType<SsfArtwork["artwork"]>
type KeyImages = { rect: TileRect; back?: LookPair; fore?: LookPair }
const separated = ([x, y, w, h]: TileRect, [a, b, c, d]: TileRect) => x + w <= a || a + c <= x || y + h <= b || b + d <= y

function appendTile(til: IniDocument, index: number, [x, y, w, h]: TileRect, stretch?: LookImage["stretch"]): void {
  const entries = [{ key: "SOURCE_RECT", value: `${x},${y},${w},${h}` }]
  if (stretch && stretch[1] <= w && stretch[3] <= h) entries.push({
    key: "INNER_RECT", value: [x + stretch[0], y + stretch[2], stretch[1] - stretch[0], stretch[3] - stretch[2]].join(","),
  })
  til.appendSection(`IMG${index}`, entries)
}

/** Plans each source image once, before styles are emitted. A later key just refers to its tile. */
export class SsfBaiduImages {
  private readonly artwork = new SsfArtwork()
  private readonly refs = new Map<Artwork, string>()
  private nextImage = 1

  private readonly output: Map<string, Uint8Array>
  private readonly folder: string

  constructor(output: Map<string, Uint8Array>, folder: string) {
    this.output = output
    this.folder = folder
  }

  reference(image: LookImage, back: boolean): string {
    const art = this.artwork.artwork(image, back)
    const existing = this.refs.get(art)
    if (existing) return existing
    let name: string
    do { name = `ssf${this.nextImage++}` } while (this.output.has(`${this.folder}${name}.png`) || this.output.has(`${this.folder}${name}.til`))
    const til = IniDocument.parse("")
    appendTile(til, 1, [0, 0, ...art.size], art.image.stretch)
    this.write(name, art.image.bytes, til)
    const ref = `${name},1`
    this.refs.set(art, ref)
    return ref
  }

  plan(board: string, [width, height]: number[], keys: KeyImages[]): void {
    if (![width, height].every((side) => Number.isSafeInteger(side) && side > 0 && side <= 2048)) return
    const sorted = keys.filter(({ rect }) => rect.length === 4 && rect.every(Number.isSafeInteger))
      .sort((a, b) => a.rect[1] - b.rect[1] || a.rect[0] - b.rect[0])
    // Start with normal backgrounds, so a shared normal/pressed asset has a single canonical slot.
    for (const layer of ["back", "fore"] as const) for (const state of ["normal", "pressed"] as const) {
      const placed = new Map<Artwork, TileRect>()
      for (const { rect: [x, y, w, h], [layer]: pair } of sorted) {
        if (!pair || w <= 0 || h <= 0) continue
        const art = this.artwork.artwork(pair[state], layer === "back")
        if (this.refs.has(art) || placed.has(art)) continue
        const [sw, sh] = art.size
        if (sw > width || sh > height) continue
        const rect: TileRect = [Math.max(0, Math.min(width - sw, x + Math.round((w - sw) / 2))), Math.max(0, Math.min(height - sh, y + Math.round((h - sh) / 2))), sw, sh]
        if ([...placed.values()].every((other) => separated(rect, other))) placed.set(art, rect)
      }
      if (placed.size < 2) continue
      const base = `keyskin_keys_${board}_${layer}_${state}`
      let name = base
      for (let i = 2; this.output.has(`${this.folder}${name}.png`) || this.output.has(`${this.folder}${name}.til`); i++) name = `${base}_${i}`
      const til = IniDocument.parse("")
      const batch = [...placed]
      const parts = batch.map(([art, rect], index) => {
        appendTile(til, index + 1, rect, art.image.stretch)
        return { png: art.image.bytes, x: rect[0], y: rect[1] }
      })
      try { this.write(name, composeAtlasPng(width, height, parts), til) } catch { continue }
      batch.forEach(([art], index) => this.refs.set(art, `${name},${index + 1}`))
    }
  }

  private write(name: string, png: Uint8Array, til: IniDocument): void {
    this.output.set(`${this.folder}${name}.png`, png)
    this.output.set(`${this.folder}${name}.til`, strToU8(withTileHeader(til).toString()))
  }
}
