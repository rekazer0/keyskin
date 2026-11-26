/**
 * Xunfei theme data model (Phase 1: no animations yet).
 *
 * Core design principles:
 * - Interoperable with BDI's SXI/SSF models via shared style/image abstractions
 * - Round-trip lossless: parse → edit → serialize ≥95% preservation
 * - Extension-ready for animations (Phase 2) through AnimationRef hooks
 * - Hierarchical style resolution (concrete → parent → system default)
 */

// ============================================================================
// Core Entities
// ============================================================================

/**
 * Metadata about a Xunfei theme: identification, versioning, and resolution list.
 * Maps to Xunfei's Info.txt and skin.json root properties.
 */
export interface XunfeiThemeInfo {
  /** Theme identifier (e.g., "my_keyboard_2024"); used as directory name. */
  id: string

  /** Display name shown in IME settings. */
  name: string

  /** Theme author; preserved during round-trip but not used in preview. */
  author?: string

  /** Semantic version for theme compatibility (e.g., "1.0.0", "2.5.1"). */
  version?: string

  /** List of supported device resolutions (e.g., [1080, 1440, 2160] for portrait). */
  resolutions: number[]

  /** Theme description or feature notes; preserved but not visible in editor. */
  notes?: string

  /** Custom metadata reserved for phase 2+ (animations, particle effects, etc.). */
  metadata?: Record<string, unknown>
}

/**
 * Hierarchical color definition: normal state, pressed state, disabled state.
 * Unused fields are `undefined` (not null) to distinguish from intentional transparency.
 */
export interface ColorDefinition {
  /** Color in ARGB hex (e.g., "#FF1A73E8"); stored as string for precision. */
  normal?: string

  /** Pressed/highlighted state; often darker or accent color. */
  pressed?: string

  /** Disabled state; typically desaturated. */
  disabled?: string

  /** Fallback color if any state is not defined (phase 2+: used for animations). */
  fallback?: string
}

/**
 * Typography configuration: font family, size, weight, tracking.
 * Maps directly to Xunfei font style properties.
 */
export interface FontDefinition {
  /** Font family name (e.g., "HarmonyOS Sans SC", "Roboto"). */
  family: string

  /** Font size in pixels (e.g., 12, 14, 16). */
  size: number

  /** Font weight (100–900; common: 400 = normal, 500 = medium, 600 = semibold). */
  weight?: number

  /** Letter spacing in pixels; can be negative. */
  tracking?: number

  /** Line height multiplier or fixed pixels; phase 2+ for multi-line text. */
  lineHeight?: number
}

/**
 * 9-patch image slice definition: a source rectangle within an atlas, plus stretchable region.
 * Enables efficient reuse of a single image file across multiple UI states and resolutions.
 *
 * Example: a button background that stretches horizontally but has fixed corner radii.
 */
export interface ImageSlice {
  /** Unique identifier within this theme (e.g., "btn_normal", "bg_01"). */
  id: string

  /** Resource file path relative to theme root (e.g., "res/images/atlas.png"). */
  sourceFile: string

  /**
   * Source rectangle [x, y, width, height] in pixels (the "content box").
   * Specifies where in the atlas this slice begins and its full dimension.
   */
  sourceRect: [x: number, y: number, width: number, height: number]

  /**
   * 9-patch scale region [left, top, right, bottom] in pixels.
   * Defines which parts stretch (interior) vs. which stay fixed (corners).
   * Phase 2+: may support additional scaling hints for animations.
   */
  innerRect?: [left: number, top: number, right: number, bottom: number]

  /** Fallback color when image cannot load; complements visual integrity. */
  fallbackColor?: string

  /** Metadata for phase 2+ (e.g., DPI variant, animation frame index). */
  metadata?: Record<string, unknown>
}

/**
 * Complete style definition: visual appearance for one semantic component state.
 * Combines colors, fonts, and images into a single reusable style unit.
 *
 * Maps to Xunfei's style object (e.g., {"c_normal": "...", "f_s": 14, "s_2": {...}}).
 */
export interface StyleDefinition {
  /** Unique identifier within this theme (e.g., 1, 10, 42). */
  id: number | string

  /** Type of style (affects how it renders): "normal", "text", "image", "border". */
  type: "normal" | "text" | "image" | "border"

  /** Display label for editor UI (e.g., "Key Normal", "Candidate Selected"). */
  label?: string

  // ---- Visual properties ----
  /** Foreground colors (text, icons); undefined means inherit. */
  colors?: ColorDefinition

  /** Typography for text rendering. */
  font?: FontDefinition

  /** Background fill image (or fallback solid fill). */
  background?: ImageSlice

  /** Border visual properties (color, width). */
  border?: {
    color?: string
    width?: number
  }

  /** Shadow or glow effect (phase 2+). */
  shadow?: {
    color?: string
    offsetX?: number
    offsetY?: number
    blur?: number
  }

  // ---- Inheritance & linking ----
  /** If set, inherit missing properties from this parent style ID. */
  parentId?: number | string

  /** Reference to animation applied to this style (phase 2+). */
  animationRef?: AnimationRef

  /** Custom metadata (preserved during round-trip). */
  metadata?: Record<string, unknown>
}

/**
 * Device-aware offset configuration: position adjustments per resolution/orientation.
 * Enables a single style to work across different screen sizes without duplication.
 */
export interface OffsetConfiguration {
  /** Resolution(s) this offset applies to (e.g., [1080], [1440, 2160]). */
  resolutions: number[]

  /** Portrait mode offset [x, y] in pixels. */
  portraitOffset?: [number, number]

  /** Landscape mode offset [x, y] in pixels. */
  landscapeOffset?: [number, number]

  /** Scale factor (e.g., 1.0, 0.95) for this resolution bucket. */
  scale?: number

  /** Notes or rationale for this offset. */
  reason?: string
}

/**
 * Placeholder for phase 2+ animation bindings.
 * Allows styles to reference animations without defining them in phase 1.
 */
export interface AnimationRef {
  /** Animation identifier (e.g., "press_bounce", "fade_in"). */
  id: string

  /** Trigger event ("press", "release", "show", "hide", etc.). */
  trigger?: string

  /** Duration in milliseconds (phase 2+ uses this to validate). */
  duration?: number

  /** Metadata for future animation properties. */
  metadata?: Record<string, unknown>
}

// ============================================================================
// Complete Theme Model
// ============================================================================

/**
 * Complete Xunfei theme definition: all components, styles, and resources.
 * Represents a fully parsed and editable theme in memory.
 *
 * Usage:
 * 1. Parse: Xunfei JSON/INI → XunfeiTheme
 * 2. Edit: modify styles, images, offsets in-place
 * 3. Serialize: XunfeiTheme → JSON/INI output
 * 4. Verify: round-trip ≥95% byte-for-byte match
 */
export interface XunfeiTheme {
  /** Theme metadata and versioning. */
  info: XunfeiThemeInfo

  /** All style definitions by ID: fast lookup during rendering. */
  styles: Map<number | string, StyleDefinition>

  /** All image slices by ID: central resource registry. */
  images: Map<string, ImageSlice>

  /** Resolution-aware offset corrections: per-resolution UI tweaks. */
  offsets: OffsetConfiguration[]

  /** Raw resource bytes: original files needed for lossless round-trip. */
  resources: ResourceArchive

  /** Format-specific raw data for fields not yet modeled. */
  rawData?: Record<string, unknown>

  /** Preservation: track any parsing issues or warnings during load. */
  issues?: ParseIssue[]
}

/**
 * Archive of theme resource files (images, fonts, etc.).
 * Preserves byte-exact originals to enable lossless round-trip.
 */
export interface ResourceArchive {
  /** File path → raw bytes; preserves unknown files. */
  files: Map<string, Uint8Array>

  /** Directory structure info for round-trip recreation. */
  structure?: {
    rootPath: string
    directories: Set<string>
  }
}

/**
 * Parse issue encountered during theme load.
 * Logged for debugging and allows graceful degradation on malformed input.
 */
export interface ParseIssue {
  /** Severity: "error" (fatal), "warn" (recoverable), "info" (metadata). */
  level: "error" | "warn" | "info"

  /** Where the issue occurred (file path, line number, field name). */
  source: string

  /** Human-readable description. */
  message: string

  /** Original problematic value (for inspection). */
  value?: unknown

  /** Fallback or recovery action taken. */
  recovery?: string
}

// ============================================================================
// Codec Interface (Phase 1 Serialization)
// ============================================================================

/**
 * Bi-directional codec for Xunfei theme formats (JSON, INI).
 * Enables parse → edit → serialize with ≥95% lossless round-trip.
 */
export interface XunfeiThemeCodec {
  /**
   * Parse Xunfei theme from raw bytes.
   *
   * @param format "json" (native), "ini" (legacy), "zip" (packaged)
   * @param bytes Raw file data
   * @returns Fully populated XunfeiTheme
   * @throws On unrecoverable parse errors (missing required fields, corrupted format)
   */
  decode(format: "json" | "ini" | "zip", bytes: Uint8Array): Promise<XunfeiTheme>

  /**
   * Serialize Xunfei theme to bytes.
   * Preserves phase 1 format fidelity (non-animation fields).
   *
   * @param theme Edited theme in-memory
   * @param format Output format
   * @returns Serialized bytes
   * @throws On unserializable values
   */
  encode(theme: XunfeiTheme, format: "json" | "ini" | "zip"): Promise<Uint8Array>

  /**
   * Measure losslessness of a round-trip: bytes → edit → bytes.
   * Returns percentage match (100 = perfect, >95 = acceptable).
   */
  measureLosslessness(original: Uint8Array, edited: XunfeiTheme, format: "json" | "ini"): Promise<number>
}

// ============================================================================
// Query & Traversal (Phase 1 Navigation)
// ============================================================================

/**
 * Style resolution strategy: query the theme's style hierarchy.
 *
 * Example: resolveStyle(theme, "10") → returns concrete StyleDefinition,
 * following parentId chain until a property is found.
 */
export function resolveStyle(
  theme: XunfeiTheme,
  styleId: number | string,
  visited?: Set<number | string>,
): StyleDefinition | undefined {
  visited = visited ?? new Set()
  if (visited.has(styleId)) return undefined // Cycle detection

  const style = theme.styles.get(styleId)
  if (!style) return undefined

  visited.add(styleId)

  // If this style is complete, return it.
  if (style.colors && style.font && (style.background || style.border)) {
    return style
  }

  // Otherwise, merge with parent.
  if (style.parentId) {
    const parent = resolveStyle(theme, style.parentId, visited)
    if (parent) {
      return {
        ...parent,
        ...style, // Child overrides parent
        id: style.id, // Preserve original ID
      }
    }
  }

  return style
}

/**
 * Find all styles that reference a given image.
 * Useful for preview updates, dependency analysis.
 */
export function stylesUsingImage(
  theme: XunfeiTheme,
  imageId: string,
): Map<number | string, StyleDefinition> {
  const result = new Map<number | string, StyleDefinition>()
  for (const [id, style] of theme.styles) {
    if (style.background?.id === imageId) {
      result.set(id, style)
    }
  }
  return result
}

// ============================================================================
// Validation (Phase 1 Verification)
// ============================================================================

/**
 * Validate theme integrity: check for missing references, corruption, etc.
 * Returns array of issues found; empty = valid.
 */
export function validateTheme(theme: XunfeiTheme): ParseIssue[] {
  const issues: ParseIssue[] = []

  // Check theme info
  if (!theme.info.id || !/^[a-z0-9_]+$/.test(theme.info.id)) {
    issues.push({
      level: "error",
      source: "info.id",
      message: `Invalid theme ID: "${theme.info.id}". Must be alphanumeric + underscore.`,
      value: theme.info.id,
    })
  }

  // Check styles
  for (const [id, style] of theme.styles) {
    if (style.parentId && !theme.styles.has(style.parentId)) {
      issues.push({
        level: "warn",
        source: `styles[${id}].parentId`,
        message: `Parent style ${style.parentId} not found.`,
        value: style.parentId,
      })
    }

    if (style.background && !theme.images.has(style.background.id)) {
      issues.push({
        level: "warn",
        source: `styles[${id}].background`,
        message: `Background image "${style.background.id}" not found.`,
        value: style.background.id,
      })
    }
  }

  // Check images
  for (const [id, image] of theme.images) {
    const fileBytes = theme.resources.files.get(image.sourceFile)
    if (!fileBytes) {
      issues.push({
        level: "warn",
        source: `images[${id}].sourceFile`,
        message: `Image file "${image.sourceFile}" not in archive.`,
        value: image.sourceFile,
      })
    }
  }

  return issues
}

// ============================================================================
// Export Helpers (Phase 1 → BDI/SXI Adapters)
// ============================================================================

/**
 * Adapter: XunfeiTheme → BDI format (for interop validation).
 * Phase 1: styles only. Phase 2+: includes animations.
 *
 * Returns the common style/image subset that BDI can consume.
 */
export interface XunfeiToBdiAdapter {
  styleDefinitions: StyleDefinition[]
  imageSlices: ImageSlice[]
  resolutionOffsets: OffsetConfiguration[]
}

/**
 * Convert Xunfei theme to BDI-compatible format.
 * Preserves >95% fidelity for non-animation fields.
 */
export function adaptToBdi(theme: XunfeiTheme): XunfeiToBdiAdapter {
  return {
    styleDefinitions: Array.from(theme.styles.values()),
    imageSlices: Array.from(theme.images.values()),
    resolutionOffsets: theme.offsets,
  }
}
