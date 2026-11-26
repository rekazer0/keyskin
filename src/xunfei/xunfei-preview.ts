/**
 * Xunfei Canvas Preview: render themes on HTML5 Canvas with animation & keyboard state.
 *
 * Responsibilities:
 * - Load images from theme ZIP via imageID → HTMLImageElement
 * - Apply offset.ini positioning and style.ini colors (NM/PS/DS)
 * - Render keyboard layout with 9-patch scaling
 * - Support keyboard states: idle, pressed(keyId), longPress(keyId)
 * - Animate frame sequences, transforms, alpha fades
 * - Capture frames for diff validation
 */

import type { StyleDefinition, FontDefinition, ColorDefinition } from "../xunfei-theme"
import type { IniConfig } from "./xunfei-parser"

// ============================================================================
// Configuration & Types
// ============================================================================

export interface XunfeiConfig {
  offset: IniConfig
  style: IniConfig
  image: IniConfig
  animation?: IniConfig
  resources: Map<string, Uint8Array>
}

export interface KeyDefinition {
  keyId: number | string
  x: number
  y: number
  w: number
  h: number
  styleId?: number | string
  label?: string
}

export enum KeyboardState {
  Idle = "idle",
  Pressed = "pressed",
  LongPressed = "long_pressed",
}

export interface KeyState {
  keyId: string | number
  state: KeyboardState
  startTime: number
}

export interface AnimationFrame {
  time: number
  opacity?: number
  translateX?: number
  translateY?: number
  scaleX?: number
  scaleY?: number
  rotate?: number
}

export interface AnimationDefinition {
  id: string
  frames: AnimationFrame[]
  loop?: boolean
  duration: number
}

// ============================================================================
// XunfeiCanvasPreview Class
// ============================================================================

export class XunfeiCanvasPreview {
  private config: XunfeiConfig
  private canvas: HTMLCanvasElement | OffscreenCanvas
  private ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  private imageCache: Map<string, HTMLImageElement | ImageBitmap>
  private keyStates: Map<string | number, KeyState>
  private keyboardLayout: Map<number | string, KeyDefinition>
  private styleCache: Map<string | number, Partial<StyleDefinition>>
  private animationFrameId: number | null = null
  private animations: Map<string, AnimationDefinition> = new Map()

  constructor(config: XunfeiConfig, canvasOrContext?: HTMLCanvasElement | OffscreenCanvas) {
    this.config = config

    if (canvasOrContext instanceof HTMLCanvasElement || canvasOrContext instanceof OffscreenCanvas) {
      this.canvas = canvasOrContext
      const ctx = this.canvas.getContext("2d")
      if (!ctx) {
        throw new Error("Failed to get 2D canvas context")
      }
      this.ctx = ctx as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
    } else {
      throw new Error("Canvas element required")
    }

    this.imageCache = new Map()
    this.keyStates = new Map()
    this.keyboardLayout = new Map()
    this.styleCache = new Map()
    this.parseConfiguration()
  }

  /**
   * Parse offset.ini, style.ini, and image.ini to build internal lookup tables.
   */
  private parseConfiguration(): void {
    // Parse offset.ini to build keyboard layout
    this.parseOffsetIni()

    // Parse style.ini to cache style definitions
    this.parseStyleIni()

    // Parse image.ini to cache image metadata
    this.parseImageIni()

    // Parse animation.ini if present
    if (this.config.animation) {
      this.parseAnimationIni()
    }
  }

  /**
   * Parse offset.ini to extract key positions and dimensions.
   */
  private parseOffsetIni(): void {
    for (const [section, entries] of this.config.offset.sections) {
      // Skip non-key sections
      if (section.startsWith("KEY_") || /^\d+$/.test(section)) {
        const keyId = parseInt(section) || section
        const x = parseInt(entries.get("x") || "0")
        const y = parseInt(entries.get("y") || "0")
        const w = parseInt(entries.get("w") || "60")
        const h = parseInt(entries.get("h") || "60")
        const styleId = entries.get("style") || keyId
        const label = entries.get("label")

        this.keyboardLayout.set(keyId, {
          keyId,
          x,
          y,
          w,
          h,
          styleId,
          label: label || String(keyId),
        })
      }
    }
  }

  /**
   * Parse style.ini to extract color and font definitions.
   */
  private parseStyleIni(): void {
    for (const [section, entries] of this.config.style.sections) {
      if (section.startsWith("STYLE_") || /^\d+$/.test(section)) {
        const styleId = parseInt(section) || section
        const def: Partial<StyleDefinition> = {
          id: styleId,
          type: "normal",
        }

        // Parse colors: NM_Color (normal), PS_Color (pressed), DS_Color (disabled)
        const nmColor = entries.get("NM_Color")
        const psColor = entries.get("PS_Color")
        const dsColor = entries.get("DS_Color")

        if (nmColor || psColor || dsColor) {
          def.colors = {
            normal: nmColor,
            pressed: psColor,
            disabled: dsColor,
            fallback: nmColor,
          }
        }

        // Parse font: F_Family, F_Size, F_Weight
        const family = entries.get("F_Family") || "Arial"
        const size = parseInt(entries.get("F_Size") || "12")
        const weight = parseInt(entries.get("F_Weight") || "400")

        def.font = {
          family,
          size,
          weight,
        }

        this.styleCache.set(styleId, def)
      }
    }
  }

  /**
   * Parse image.ini to extract 9-patch definitions.
   */
  private parseImageIni(): void {
    // Store image metadata for later lookup during rendering
    // Format: [IMG_<id>] with sourceFile, sourceRect, innerRect
    for (const [section] of this.config.image.sections) {
      if (section.startsWith("IMG_")) {
        // Image metadata is stored but not actively used in phase 1
      }
    }
  }

  /**
   * Parse animation.ini to extract animation frame sequences.
   */
  private parseAnimationIni(): void {
    if (!this.config.animation) return

    for (const [section, entries] of this.config.animation.sections) {
      if (section.startsWith("ANIM_")) {
        const animId = section.substring(5)
        const frames: AnimationFrame[] = []
        const duration = parseInt(entries.get("duration") || "1000")

        // Parse frame definitions: frame_0, frame_1, etc.
        const frameEntries = Array.from(entries.entries())
          .filter(([k]) => k.startsWith("frame_"))
          .sort(([a], [b]) => {
            const numA = parseInt(a.split("_")[1])
            const numB = parseInt(b.split("_")[1])
            return numA - numB
          })

        for (const [, value] of frameEntries) {
          const frameData = this.parseFrameData(value)
          frames.push(frameData)
        }

        this.animations.set(animId, {
          id: animId,
          frames,
          duration,
          loop: entries.get("loop") === "true",
        })
      }
    }
  }

  /**
   * Parse frame data string into AnimationFrame object.
   * Format: "time:100 opacity:0.5 tx:10 ty:20 sx:1.0 sy:1.0 rotate:45"
   */
  private parseFrameData(value: string): AnimationFrame {
    const frame: AnimationFrame = { time: 0 }
    const pairs = value.split(/\s+/)

    for (const pair of pairs) {
      const [key, val] = pair.split(":")
      const num = parseFloat(val)

      switch (key) {
        case "time":
          frame.time = num
          break
        case "opacity":
          frame.opacity = num
          break
        case "tx":
          frame.translateX = num
          break
        case "ty":
          frame.translateY = num
          break
        case "sx":
          frame.scaleX = num
          break
        case "sy":
          frame.scaleY = num
          break
        case "rotate":
          frame.rotate = num
          break
      }
    }

    return frame
  }

  /**
   * Preload all images used in the theme.
   */
  async preloadImages(): Promise<void> {
    const promises: Promise<HTMLImageElement | ImageBitmap | null>[] = []
    for (const data of this.config.resources.values()) {
      promises.push(
        new Promise((resolve) => {
          const blob = new Blob([data as BufferSource], { type: "image/png" })
          const url = URL.createObjectURL(blob)
          const img = new Image()
          img.onload = () => {
            this.imageCache.set(url, img)
            URL.revokeObjectURL(url)
            resolve(img)
          }
          img.onerror = () => {
            URL.revokeObjectURL(url)
            resolve(null)
          }
          img.src = url
        })
      )
    }
    await Promise.all(promises)
  }

  /**
   * Resolve a style from cache or return default.
   */
  private resolveStyle(styleId: number | string): Partial<StyleDefinition> | undefined {
    return this.styleCache.get(styleId)
  }

  /**
   * Get color based on keyboard state: NM (normal), PS (pressed), DS (disabled).
   */
  private getColorForState(colors: ColorDefinition | undefined, state: KeyboardState): string {
    if (!colors) return "#FF000000"

    switch (state) {
      case KeyboardState.Pressed:
      case KeyboardState.LongPressed:
        return colors.pressed || colors.normal || colors.fallback || "#FF000000"
      default:
        return colors.normal || colors.fallback || "#FF000000"
    }
  }

  /**
   * Parse color string from INI format (ARGB hex) to canvas format.
   */
  private parseColor(colorStr: string | undefined): string {
    if (!colorStr) return "#FF000000"

    // Convert ARGB format (e.g., "#FF1A73E8") to RGBA for canvas
    if (colorStr.startsWith("#") && colorStr.length === 9) {
      const a = colorStr.substring(1, 3)
      const rgb = colorStr.substring(3)
      return `#${rgb}${a}`
    }

    return colorStr
  }

  /**
   * Draw text with font and color from style definition.
   */
  private drawText(text: string, x: number, y: number, font: FontDefinition | undefined, color: string): void {
    if (!font) return

    const size = font.size || 12
    const weight = font.weight || 400
    const family = font.family || "Arial"

    this.ctx.font = `${weight} ${size}px ${family}`
    this.ctx.fillStyle = color
    this.ctx.textAlign = "center"
    this.ctx.textBaseline = "middle"
    this.ctx.fillText(text, x, y)
  }

  /**
   * Render a single key with style, background, and text.
   */
  private async renderKey(keyDef: KeyDefinition): Promise<void> {
    const keyState = this.keyStates.get(keyDef.keyId)
    const state = keyState?.state || KeyboardState.Idle

    // Resolve style
    const style = this.resolveStyle(keyDef.styleId || keyDef.keyId)
    if (!style) return

    const colors = style.colors
    const color = this.parseColor(this.getColorForState(colors, state))

    // Draw background (placeholder: solid color for now)
    if (colors?.normal) {
      this.ctx.fillStyle = this.parseColor(colors.normal)
      this.ctx.fillRect(keyDef.x, keyDef.y, keyDef.w, keyDef.h)
    }

    // Draw text
    if (style.font && keyDef.label) {
      this.drawText(keyDef.label, keyDef.x + keyDef.w / 2, keyDef.y + keyDef.h / 2, style.font, color)
    }
  }

  /**
   * Render entire keyboard layout in portrait orientation (1920x1080).
   */
  async renderPortrait(): Promise<ImageData> {
    const width = 1920
    const height = 1080

    if (this.canvas instanceof HTMLCanvasElement) {
      this.canvas.width = width
      this.canvas.height = height
    } else if (this.canvas instanceof OffscreenCanvas) {
      (this.canvas as OffscreenCanvas).width = width;
      (this.canvas as OffscreenCanvas).height = height
    }

    return this.renderLayout(width, height)
  }

  /**
   * Render entire keyboard layout in landscape orientation (1080x1920).
   */
  async renderLandscape(): Promise<ImageData> {
    const width = 1080
    const height = 1920

    if (this.canvas instanceof HTMLCanvasElement) {
      this.canvas.width = width
      this.canvas.height = height
    } else if (this.canvas instanceof OffscreenCanvas) {
      (this.canvas as OffscreenCanvas).width = width;
      (this.canvas as OffscreenCanvas).height = height
    }

    return this.renderLayout(width, height)
  }

  /**
   * Common render layout logic for both portrait and landscape.
   */
  private async renderLayout(width: number, height: number): Promise<ImageData> {
    // Clear canvas with white background
    this.ctx.fillStyle = "#FFFFFF"
    this.ctx.fillRect(0, 0, width, height)

    // Render all keys from keyboard layout
    for (const keyDef of this.keyboardLayout.values()) {
      await this.renderKey(keyDef)
    }

    const ctx2d = this.ctx as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
    return ctx2d.getImageData(0, 0, width, height)
  }

  /**
   * Render a specific key in a given state (normal, pressed, disabled).
   */
  async renderKeyState(
    keyId: number | string,
    state: "normal" | "pressed" | "disabled"
  ): Promise<ImageData> {
    const keyboardState =
      state === "pressed" ? KeyboardState.Pressed : state === "disabled" ? KeyboardState.Idle : KeyboardState.Idle

    const keyDef = this.keyboardLayout.get(keyId)
    if (!keyDef) {
      throw new Error(`Key ${keyId} not found in keyboard layout`)
    }

    // Set key state
    this.keyStates.set(keyId, {
      keyId,
      state: keyboardState,
      startTime: Date.now(),
    })

    // Render just this key
    this.ctx.fillStyle = "#FFFFFF"
    this.ctx.fillRect(keyDef.x, keyDef.y, keyDef.w, keyDef.h)

    await this.renderKey(keyDef)

    const ctx2d = this.ctx as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
    return ctx2d.getImageData(keyDef.x, keyDef.y, keyDef.w, keyDef.h)
  }

  /**
   * Apply animation to a specific key or the entire layout.
   * Animates from frame 0 to current frame and applies transformations.
   */
  async applyAnimation(animId: string, frameIndex: number): Promise<void> {
    const anim = this.animations.get(animId)
    if (!anim || frameIndex >= anim.frames.length) {
      return
    }

    const frame = anim.frames[frameIndex]

    // Apply transformations from frame
    this.ctx.save()

    if (frame.translateX !== undefined || frame.translateY !== undefined) {
      this.ctx.translate(frame.translateX || 0, frame.translateY || 0)
    }

    if (frame.scaleX !== undefined || frame.scaleY !== undefined) {
      this.ctx.scale(frame.scaleX || 1, frame.scaleY || 1)
    }

    if (frame.rotate !== undefined) {
      this.ctx.rotate((frame.rotate * Math.PI) / 180)
    }

    if (frame.opacity !== undefined) {
      this.ctx.globalAlpha = frame.opacity
    }

    this.ctx.restore()
  }

  /**
   * Set keyboard key state (idle, pressed, long-pressed).
   */
  setKeyState(keyId: string | number, state: KeyboardState): void {
    this.keyStates.set(keyId, {
      keyId,
      state,
      startTime: Date.now(),
    })
  }

  /**
   * Clear a key's pressed state (return to idle).
   */
  releaseKey(keyId: string | number): void {
    this.keyStates.delete(keyId)
  }

  /**
   * Capture current frame as ImageData (for diff validation).
   */
  captureFrame(): ImageData {
    const ctx2d = this.ctx as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
    const width = this.canvas instanceof HTMLCanvasElement ? this.canvas.width : (this.canvas as OffscreenCanvas).width
    const height = this.canvas instanceof HTMLCanvasElement ? this.canvas.height : (this.canvas as OffscreenCanvas).height
    return ctx2d.getImageData(0, 0, width, height)
  }

  /**
   * Dispose resources (clear cache, stop animations).
   */
  dispose(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId)
      this.animationFrameId = null
    }
    this.imageCache.clear()
    this.keyStates.clear()
    this.animations.clear()
  }
}

/**
 * Create a preview renderer for a Xunfei theme on canvas.
 * Returns the preview instance for further manipulation.
 */
export async function createPreview(
  config: XunfeiConfig,
  canvas: HTMLCanvasElement | OffscreenCanvas
): Promise<XunfeiCanvasPreview> {
  const preview = new XunfeiCanvasPreview(config, canvas)
  await preview.preloadImages()
  return preview
}

/**
 * Render portrait (1920x1080) and return ImageData.
 */
export async function renderPortrait(config: XunfeiConfig): Promise<ImageData> {
  const canvas = new OffscreenCanvas(1920, 1080)
  const preview = await createPreview(config, canvas)
  const imageData = await preview.renderPortrait()
  preview.dispose()
  return imageData
}

/**
 * Render landscape (1080x1920) and return ImageData.
 */
export async function renderLandscape(config: XunfeiConfig): Promise<ImageData> {
  const canvas = new OffscreenCanvas(1080, 1920)
  const preview = await createPreview(config, canvas)
  const imageData = await preview.renderLandscape()
  preview.dispose()
  return imageData
}

/**
 * Render a key in a specific state and return ImageData.
 */
export async function renderKeyState(
  config: XunfeiConfig,
  keyId: number | string,
  state: "normal" | "pressed" | "disabled"
): Promise<ImageData> {
  const canvas = new OffscreenCanvas(100, 100)
  const preview = await createPreview(config, canvas)
  const imageData = await preview.renderKeyState(keyId, state)
  preview.dispose()
  return imageData
}

/**
 * Capture canvas frame as ImageData for diff validation.
 */
export function captureCanvasFrame(canvas: HTMLCanvasElement | OffscreenCanvas): ImageData {
  const ctx = canvas.getContext("2d")
  if (!ctx) {
    throw new Error("Failed to get 2D context")
  }
  const width = canvas instanceof HTMLCanvasElement ? canvas.width : (canvas as OffscreenCanvas).width
  const height = canvas instanceof HTMLCanvasElement ? canvas.height : (canvas as OffscreenCanvas).height
  const ctx2d = ctx as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  return ctx2d.getImageData(0, 0, width, height)
}

/**
 * Compare two ImageData frames: return pixel-level diff and similarity %.
 */
export function compareFrames(frame1: ImageData, frame2: ImageData): { similarity: number; diffPixels: number } {
  if (frame1.width !== frame2.width || frame1.height !== frame2.height) {
    return { similarity: 0, diffPixels: frame1.width * frame1.height }
  }

  const data1 = frame1.data
  const data2 = frame2.data
  let diffPixels = 0

  for (let i = 0; i < data1.length; i += 4) {
    const r1 = data1[i],
      g1 = data1[i + 1],
      b1 = data1[i + 2],
      a1 = data1[i + 3]
    const r2 = data2[i],
      g2 = data2[i + 1],
      b2 = data2[i + 2],
      a2 = data2[i + 3]

    if (r1 !== r2 || g1 !== g2 || b1 !== b2 || a1 !== a2) {
      diffPixels++
    }
  }

  const totalPixels = frame1.width * frame1.height
  const similarity = ((totalPixels - diffPixels) / totalPixels) * 100

  return { similarity, diffPixels }
}
