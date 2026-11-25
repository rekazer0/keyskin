import { fingerprint } from "./ssf-cache.ts"
import type { LookImage } from "./ssf-look.ts"
import { decodePng, pngSize, resizeImage } from "./ssf-png.ts"

type Artwork = { image: LookImage; size: [number, number] }

/** Intern source images before assigning format-specific resource names. */
export class SsfArtwork {
  private readonly byContent = new Map<string, Artwork[]>()
  private readonly byImage = new WeakMap<LookImage, Artwork>()
  private readonly backgrounds = new Set<Artwork>()
  private readonly scalable = new Map<Artwork, Artwork>()
  private readonly pixels = new Map<Artwork, ReturnType<typeof decodePng>>()

  artwork(image: LookImage, scalable = false): Artwork {
    const art = this.exact(image)
    return scalable ? this.background(art) : art
  }

  private exact(image: LookImage): Artwork {
    const existing = this.byImage.get(image)
    if (existing) return existing
    const signature = `${fingerprint(image.bytes)}:${image.stretch?.join() ?? ""}`
    const bucket = this.byContent.get(signature) ?? []
    let art = bucket.find(({ image: original }) => original.bytes === image.bytes || original.bytes.every((value, i) => value === image.bytes[i]))
    if (!art) {
      const size = pngSize(image.bytes)
      if (!size) throw new Error(`${image.id} 不是有效的 PNG`)
      art = { image, size }
      bucket.push(art)
      this.byContent.set(signature, bucket)
    }
    this.byImage.set(image, art)
    return art
  }

  private background(art: Artwork): Artwork {
    const { image } = art
    const cached = this.scalable.get(art)
    if (cached) return cached
    // Baidu stretches key backgrounds to VIEW_RECT. Match proportional variants only if scaling
    // reproduces every pixel; foreground sizes and nine-slice borders are not interchangeable.
    const [w, h] = art.size
    let chosen = art
    if (!image.stretch && !this.backgrounds.has(art)) for (const other of this.backgrounds) {
      const [ow, oh] = other.size
      if (other.image.stretch || ow === w || w * oh !== h * ow) continue
      try {
        const a = this.decode(art), b = this.decode(other)
        const equal = w > ow ? resizeImage(b, w, h).data.every((value, i) => value === a.data[i])
          : resizeImage(a, ow, oh).data.every((value, i) => value === b.data[i])
        if (equal) { chosen = other; break }
      } catch { /* Keep the original; a PNG variant may not be supported by the converter. */ }
    }
    this.backgrounds.add(chosen)
    this.scalable.set(art, chosen)
    return chosen
  }

  private decode(art: Artwork): ReturnType<typeof decodePng> {
    let pixels = this.pixels.get(art)
    if (!pixels) {
      pixels = decodePng(art.image.bytes)
      this.pixels.set(art, pixels)
    }
    return pixels
  }
}
