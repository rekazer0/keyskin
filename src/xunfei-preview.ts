import { type XunfeiTheme, type OffsetConfiguration, type StyleDefinition, type ImageSlice } from "./xunfei-theme.ts"

/**
 * Phase 1: Static Xunfei theme canvas preview renderer.
 * Renders keyboard layout with background, keys (image slices), and labels.
 * No animations yet; full animation support planned for Phase 2.
 */

export interface XunfeiPreviewOptions {
  /** Canvas resolution (e.g., "1920x1080", "1440x810") */
  resolution: string
  /** Portrait or landscape orientation */
  orientation: "portrait" | "landscape"
  /** Optional highlight pressed state of a specific key (keyId) */
  highlightKeyId?: string | number
}

export interface RenderContext {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  dpi: number
  canvasWidth: number
  canvasHeight: number
}

/**
 * Find the offset configuration for a given resolution and orientation.
 * Returns the first matching entry; falls back to default if none found.
 */
function findOffsetConfig(
  theme: XunfeiTheme,
  resolution: number,
  orientation: "portrait" | "landscape"
): OffsetConfiguration | undefined {
  return theme.offsets.find(
    (config) =>
      config.resolutions.includes(resolution) &&
      (orientation === "portrait" ? config.portraitOffset : config.landscapeOffset)
  )
}

/**
 * Parse resolution string (e.g., "1920x1080") into { width, height, dpi }.
 * Assumes 96 DPI unless otherwise specified in theme metadata.
 */
function parseResolution(resolutionStr: string, orientation: "portrait" | "landscape"): { width: number; height: number; dpi: number } {
  const parts = resolutionStr.toLowerCase().split("x").map(Number)
  if (parts.length < 2 || !parts.every(Number.isFinite)) {
    throw new Error(`Invalid resolution format: ${resolutionStr}`)
  }

  let [width, height] = parts
  // Swap if landscape and dimensions suggest portrait
  if (orientation === "landscape" && width < height) {
    [width, height] = [height, width]
  } else if (orientation === "portrait" && width > height) {
    [width, height] = [height, width]
  }

  const dpi = 96 // Default DPI; can be extended to read from theme metadata
  return { width, height, dpi }
}

/**
 * Load image slice from theme resources and render onto canvas.
 * Returns true if successful; false if image not found or failed to decode.
 */
async function renderImageSlice(
  ctx: RenderContext,
  slice: ImageSlice,
  theme: XunfeiTheme,
  targetX: number,
  targetY: number,
  scale: number = 1
): Promise<boolean> {
  try {
    const imageData = theme.resources.files.get(slice.sourceFile)
    if (!imageData) {
      console.warn(`Image not found: ${slice.sourceFile}`)
      return false
    }

    // Decode image bytes into bitmap
    const blob = new Blob([new Uint8Array(imageData)], { type: "image/png" })
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.src = url

    return new Promise((resolve) => {
      img.onload = () => {
        const [srcX, srcY, srcW, srcH] = slice.sourceRect
        const scaledW = srcW * scale
        const scaledH = srcH * scale

        ctx.ctx.drawImage(img, srcX, srcY, srcW, srcH, targetX, targetY, scaledW, scaledH)
        URL.revokeObjectURL(url)
        resolve(true)
      }
      img.onerror = () => {
        console.warn(`Failed to decode image: ${slice.sourceFile}`)
        URL.revokeObjectURL(url)
        resolve(false)
      }
    })
  } catch (error) {
    console.error(`Error rendering image slice ${slice.id}:`, error)
    return false
  }
}

/**
 * Render text label onto canvas using style's font and color.
 * Handles normal state, pressed state, and fallback colors.
 * Phase 1: basic rendering; shadow support deferred to Phase 2.
 */
function renderLabel(
  ctx: RenderContext,
  text: string,
  style: StyleDefinition | undefined,
  targetX: number,
  targetY: number,
  width: number,
  height: number,
  isPressedState: boolean = false
): void {
  if (!style || !style.font || !text) return

  const font = style.font
  const color = isPressedState ? style.colors?.pressed : style.colors?.normal
  const fallback = style.colors?.fallback ?? "#FFFFFFFF"
  const textColor = color ?? fallback

  // Calculate font size in pixels (may need DPI adjustment)
  const fontSize = font.size * ctx.dpi / 96

  // Build canvas font string
  const fontWeight = font.weight ?? 400
  const canvasFontStr = `${fontWeight === 400 ? "" : fontWeight} ${fontSize}px ${font.family}`

  ctx.ctx.font = canvasFontStr
  ctx.ctx.fillStyle = textColor
  ctx.ctx.textAlign = "center"
  ctx.ctx.textBaseline = "middle"

  // Apply letter spacing if present (approximate by scaling)
  let scaleApplied = false
  if (font.tracking && font.tracking !== 0) {
    const metrics = ctx.ctx.measureText(text)
    const baseWidth = metrics.width
    const targetWidth = baseWidth + font.tracking * text.length
    if (baseWidth > 0) {
      const scaleX = targetWidth / baseWidth
      ctx.ctx.scale(scaleX, 1)
      scaleApplied = true
    }
  }

  // Draw text centered in the bounds
  ctx.ctx.fillText(text, targetX + width / 2, targetY + height / 2, width)

  // Restore transform if letter-spacing was applied
  if (scaleApplied) {
    ctx.ctx.resetTransform()
  }
}

/**
 * Main render function: create and populate canvas for Xunfei theme.
 * Phase 1: static layout only (background + image slices + labels).
 *
 * @param theme Parsed XunfeiTheme
 * @param options Resolution, orientation, optional highlight
 * @returns HTMLCanvasElement ready for display or export
 *
 * @throws On parse errors or missing critical resources
 */
export async function renderXunfeiThemePreview(
  theme: XunfeiTheme,
  options: XunfeiPreviewOptions
): Promise<HTMLCanvasElement> {
  const { resolution, orientation, highlightKeyId } = options

  // Parse resolution
  const { width: canvasWidth, height: canvasHeight, dpi } = parseResolution(resolution, orientation)

  // Create canvas
  const canvas = document.createElement("canvas")
  canvas.width = canvasWidth
  canvas.height = canvasHeight

  const context: RenderContext = {
    canvas,
    ctx: canvas.getContext("2d") as CanvasRenderingContext2D,
    dpi,
    canvasWidth,
    canvasHeight,
  }

  if (!context.ctx) {
    throw new Error("Failed to get 2D canvas context")
  }

  // Find offset configuration for this resolution and orientation
  const resolutionNum = parseInt(resolution.split("x")[0], 10)
  const offsetConfig = findOffsetConfig(theme, resolutionNum, orientation)

  // Get the offset for the current orientation
  const offset: [number, number] = orientation === "portrait"
    ? offsetConfig?.portraitOffset ?? [0, 0]
    : offsetConfig?.landscapeOffset ?? [0, 0]

  const scale = offsetConfig?.scale ?? 1

  // Render background (Image[0] from image.ini)
  const backgroundImageId = theme.resources.files.has("image.ini") ? "bg_0" : undefined
  if (backgroundImageId && theme.images.has(backgroundImageId)) {
    const bgImage = theme.images.get(backgroundImageId)!
    await renderImageSlice(context, bgImage, theme, 0, 0, scale)
  } else {
    // Fallback: fill with neutral background
    context.ctx.fillStyle = "#F5F5F5"
    context.ctx.fillRect(0, 0, canvasWidth, canvasHeight)
  }

  // Render keys: iterate through all styles and render their associated images + labels
  for (const [styleId, style] of theme.styles) {
    if (!style.background) continue

    const keyId = String(styleId)
    const isPressedState = keyId === String(highlightKeyId)

    // Lookup offset for this key
    const keyOffset: [number, number] = offset

    // Render background image slice
    const bgSlice = style.background
    const posX = keyOffset[0] * scale
    const posY = keyOffset[1] * scale
    const sliceWidth = bgSlice.sourceRect[2] * scale
    const sliceHeight = bgSlice.sourceRect[3] * scale

    await renderImageSlice(context, bgSlice, theme, posX, posY, scale)

    // Render label text
    if (style.label) {
      renderLabel(
        context,
        style.label,
        style,
        posX,
        posY,
        sliceWidth,
        sliceHeight,
        isPressedState
      )
    }
  }

  return canvas
}

/**
 * Convenience export: render theme preview and encode as PNG data URL.
 * Useful for previews in UI without needing to manage canvas lifecycle.
 */
export async function renderXunfeiThemePreviewDataUrl(
  theme: XunfeiTheme,
  options: XunfeiPreviewOptions
): Promise<string> {
  const canvas = await renderXunfeiThemePreview(theme, options)
  return canvas.toDataURL("image/png")
}
