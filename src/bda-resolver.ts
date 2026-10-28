import { decodeBdaAppearance } from "./bda-decode.ts"
import { type VisualResolver, type Visual, type TextVisual, type StyleTextVisual, pngBitmap } from "./atlas.ts"
import { type BdaAppearance, bdaStyleRef } from "./bda.ts"
import { SkinArchive } from "./skin.ts"

export function bdaLayoutNames(bytes: Uint8Array): string[] {
  return [...decodeBdaAppearance(bytes).panels.keys()]
}

export function bdaColorHex(value: number): string {
  return (value >>> 0).toString(16).padStart(8, "0").toUpperCase()
}

function bdaCssColor(value: number): string | undefined {
  if (!value) return
  const hex = bdaColorHex(value)
  const alpha = Number.parseInt(hex.slice(0, 2), 16) / 255
  const red = Number.parseInt(hex.slice(2, 4), 16)
  const green = Number.parseInt(hex.slice(4, 6), 16)
  const blue = Number.parseInt(hex.slice(6, 8), 16)
  return `rgba(${red}, ${green}, ${blue}, ${Number(alpha.toFixed(3))})`
}

// BDA filterColor 是叠加在图片之上的颜色滤镜（tint），不是背景填充。
// 0 与 0xFFFFFFFF（不透明白）都表示「无滤镜」。
function bdaFilterColor(value: number): string | undefined {
  const unsigned = value >>> 0
  if (!unsigned || unsigned === 0xffffffff) return
  return bdaCssColor(unsigned)
}

export function pngSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

export class BdaResolver implements VisualResolver {
  private readonly appearance: BdaAppearance
  private readonly archive: SkinArchive
  private readonly fallback?: SkinArchive
  private readonly theme: string
  private readonly orientation: string

  constructor(
    archive: SkinArchive,
    appearanceBytes: Uint8Array,
    fallback?: SkinArchive,
    theme = "light",
    orientation = "port",
  ) {
    this.archive = archive
    this.fallback = fallback
    this.theme = theme
    this.orientation = orientation
    this.appearance = decodeBdaAppearance(appearanceBytes)
  }

  private resource(resourceID: string): { archive: SkinArchive; path: string } | undefined {
    resourceID = resourceID.replace(/\.png$/i, "")
    const paths = [
      `${this.theme}/skin/${this.orientation}/res/${resourceID}.png`,
      `${this.theme}/skin/res/${resourceID}.png`,
      `light/skin/res/${resourceID}.png`,
    ]
    for (const archive of [this.archive, this.fallback]) {
      if (!archive) continue
      const path = paths.find((candidate) => archive.isImage(candidate))
      if (path) return { archive, path }
    }
  }

  private bitmap(archive: SkinArchive, path: string): Promise<ImageBitmap | undefined> {
    return pngBitmap(archive.getBytes(path)!)
  }

  sourceSize(styleID: string, highlighted: boolean): { width: number; height: number } | undefined {
    const rawKey = Number(styleID)
    const ref = bdaStyleRef(styleID) ?? (
      Number.isInteger(rawKey) && this.appearance.imageStyles.has(rawKey)
        ? { type: "image" as const, key: rawKey }
        : undefined
    )
    if (ref?.type !== "image") return
    const style = this.appearance.imageStyles.get(ref.key)
    const atom = highlighted ? style?.highlightImage ?? style?.normalImage : style?.normalImage
    const found = atom?.resource?.resourceID ? this.resource(atom.resource.resourceID) : undefined
    return found ? pngSize(found.archive.getBytes(found.path)!) : undefined
  }

  async resolve(styleID: string, highlighted: boolean): Promise<Visual | undefined> {
    const rawKey = Number(styleID)
    const ref = bdaStyleRef(styleID) ?? (
      Number.isInteger(rawKey)
        ? this.appearance.imageStyles.has(rawKey)
          ? { type: "image" as const, key: rawKey }
          : this.appearance.colorStyles.has(rawKey)
            ? { type: "color" as const, key: rawKey }
            : undefined
        : undefined
    )
    if (!ref) return
    if (ref.type === "color") {
      const style = this.appearance.colorStyles.get(ref.key)
      const normalColor = style?.normalColor ?? style?.highlightColor ?? 0
      return style ? { color: bdaCssColor(highlighted ? style.highlightColor ?? normalColor : normalColor) } : undefined
    }
    if (ref.type === "text") {
      const style = this.appearance.textStyles.get(ref.key)
      return style ? { text: { text: style.contentText || "Aa", ...this.resolveText(styleID, highlighted) } } : undefined
    }
    const style = this.appearance.imageStyles.get(ref.key)
    const atom = highlighted ? style?.highlightImage ?? style?.normalImage : style?.normalImage
    const found = atom?.resource?.resourceID ? this.resource(atom.resource.resourceID) : undefined
    if (!found) return { filterColor: bdaFilterColor(atom?.filterColor ?? 0) }
    const image = await this.bitmap(found.archive, found.path)
    if (!image) return { filterColor: bdaFilterColor(atom?.filterColor ?? 0) }
    const inner = atom?.innerRect
    return {
      image,
      imagePath: found.archive === this.archive ? found.path : undefined,
      source: [0, 0, image.width, image.height],
      // 与 .til 的 INNER_RECT 一致：宽高为 0（官方皮肤常写空的 innerRect）时整图拉伸，不按九宫格切。
      inner: inner && inner.width > 0 && inner.height > 0
        ? [inner.x, inner.y, inner.width, inner.height]
        : undefined,
      filterColor: bdaFilterColor(atom?.filterColor ?? 0),
    }
  }

  async resolveResource(resourceID: string): Promise<Visual | undefined> {
    const found = this.resource(resourceID)
    if (!found) return
    const image = await this.bitmap(found.archive, found.path)
    if (!image) return
    return { image, imagePath: found.path, source: [0, 0, image.width, image.height] }
  }

  resolveText(foreground: string, highlighted: boolean): TextVisual | undefined {
    const ref = foreground.split(",").map((value) => {
      const encoded = bdaStyleRef(value)
      if (encoded?.type === "text") return encoded
      const key = Number(value)
      return Number.isInteger(key) && this.appearance.textStyles.has(key)
        ? { type: "text" as const, key }
        : undefined
    }).find(Boolean)
    if (!ref) return
    const style = this.appearance.textStyles.get(ref.key)
    const normalColor = style?.normalColor ?? style?.highlightColor ?? 0
    return style ? {
      fontName: style.fontName || undefined,
      fontSize: style.fontSize || undefined,
      color: bdaCssColor(highlighted ? style.highlightColor ?? normalColor : normalColor),
    } : undefined
  }

  resolveStyleText(styleID: string, highlighted: boolean): StyleTextVisual | undefined {
    const ref = bdaStyleRef(styleID)
    if (ref?.type !== "text") return
    const style = this.appearance.textStyles.get(ref.key)
    if (!style?.contentText) return
    return { text: style.contentText, ...this.resolveText(styleID, highlighted) }
  }

  async resolveToolbarImages(): Promise<Visual[]> {
    return []
  }
}
