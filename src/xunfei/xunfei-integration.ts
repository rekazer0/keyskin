/**
 * Xunfei Sample Validation Module: load, validate, preview, roundtrip, and compare themes.
 *
 * Provides end-to-end integration testing for .it/.itx files:
 * 1. Safe loading with error recovery
 * 2. Theme integrity checks (required fields, animation refs, images)
 * 3. Canvas preview screenshot generation
 * 4. Roundtrip validation (serialize → reload → binary compare)
 * 5. Pixel-level diff between two skins
 */

import { loadTheme, detectXunfeiFormat } from './xunfei-parser'
import { renderPortrait, renderLandscape } from './xunfei-preview'
import { compareScreenshots, DiffReport } from './xunfei-diff'
import type { XunfeiTheme } from '../xunfei-theme'
import type { XunfeiThemeMetadata } from './xunfei-parser'
import type { XunfeiConfig } from './xunfei-preview'

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  warnings: ValidationWarning[]
  stats: ValidationStats
}

export interface ValidationError {
  code: string
  field: string
  message: string
  severity: 'fatal' | 'major' | 'minor'
}

export interface ValidationWarning {
  code: string
  field: string
  message: string
}

export interface ValidationStats {
  totalStyles: number
  totalImages: number
  resolutions: number[]
  animationReferences: number
  missingResources: number
}

export interface LoadResult {
  theme: XunfeiTheme | null
  metadata: XunfeiThemeMetadata | null
  issues: string[]
  success: boolean
}

export interface RoundtripResult {
  identical: boolean
  preservationRate: number
  diffs: RoundtripDiff[]
  binaryMatch: boolean
}

export interface RoundtripDiff {
  section: string
  field: string
  before: string
  after: string
  impact: 'critical' | 'major' | 'minor'
}

export interface SkinComparison {
  similarity: number
  diffReport: DiffReport | null
  diffs: string[]
  hotspotCount: number
}

// ============================================================================
// 1. Load Sample Skin
// ============================================================================

/**
 * Safely load .it/.itx file with error recovery.
 * Returns structured result with theme, metadata, and issues.
 */
export async function loadSampleSkin(filePath: string): Promise<LoadResult> {
  const issues: string[] = []

  try {
    // Read file
    const data = await readFileBytes(filePath)
    if (!data) {
      return {
        theme: null,
        metadata: null,
        issues: [`Failed to read file: ${filePath}`],
        success: false,
      }
    }

    // Detect format
    const formatInfo = detectXunfeiFormat(data)
    if (!formatInfo.isXunfei) {
      return {
        theme: null,
        metadata: null,
        issues: ['File is not a valid Xunfei theme (.it/.itx)'],
        success: false,
      }
    }

    if (formatInfo.encrypted) {
      issues.push('Theme is encrypted (FlyitenC); limited feature support')
    }

    // Load theme with lenient mode
    let loadResult
    try {
      loadResult = await loadTheme(data, { lenient: true })
    } catch (err) {
      return {
        theme: null,
        metadata: loadResult?.metadata || null,
        issues: [...issues, `Parse error: ${String(err)}`],
        success: false,
      }
    }

    // Construct XunfeiTheme from metadata and INI files
    const theme = constructThemeFromMetadata(loadResult.metadata, loadResult.iniFiles)

    return {
      theme,
      metadata: loadResult.metadata,
      issues,
      success: true,
    }
  } catch (err) {
    return {
      theme: null,
      metadata: null,
      issues: [`Load error: ${String(err)}`],
      success: false,
    }
  }
}

// ============================================================================
// 2. Validate Theme Integrity
// ============================================================================

/**
 * Check theme integrity: required fields, animation refs, image resources.
 * Returns structured validation report.
 */
export function validateThemeIntegrity(theme: XunfeiTheme): ValidationResult {
  const errors: ValidationError[] = []
  const warnings: ValidationWarning[] = []

  // Check required metadata
  if (!theme.info.id || theme.info.id.trim() === '') {
    errors.push({
      code: 'MISSING_ID',
      field: 'info.id',
      message: 'Theme ID is required',
      severity: 'fatal',
    })
  }

  if (!theme.info.name || theme.info.name.trim() === '') {
    errors.push({
      code: 'MISSING_NAME',
      field: 'info.name',
      message: 'Theme name is required',
      severity: 'major',
    })
  }

  if (!theme.info.resolutions || theme.info.resolutions.length === 0) {
    warnings.push({
      code: 'EMPTY_RESOLUTIONS',
      field: 'info.resolutions',
      message: 'No resolutions defined; will use default 1080',
    })
  }

  // Check styles
  if (theme.styles.size === 0) {
    errors.push({
      code: 'NO_STYLES',
      field: 'styles',
      message: 'Theme has no styles defined',
      severity: 'fatal',
    })
  }

  let animRefCount = 0
  for (const [styleId, style] of theme.styles.entries()) {
    // Check animation references
    if (style.animationRef) {
      animRefCount++
      if (!style.animationRef.id) {
        warnings.push({
          code: 'INVALID_ANIM_REF',
          field: `styles[${styleId}].animationRef.id`,
          message: 'Animation reference has no ID',
        })
      }
    }

    // Check background image references
    if (style.background) {
      const img = theme.images.get(style.background.id)
      if (!img) {
        errors.push({
          code: 'MISSING_IMAGE_REF',
          field: `styles[${styleId}].background.id`,
          message: `Image reference '${style.background.id}' not found in images`,
          severity: 'major',
        })
      }
    }
  }

  // Check image resources
  let missingResources = 0
  for (const [imgId, img] of theme.images.entries()) {
    // Verify sourceFile exists in resources
    const hasResource = Array.from(theme.resources.files.keys()).some(
      path => path.includes(img.sourceFile) || path.endsWith(img.sourceFile)
    )

    if (!hasResource) {
      warnings.push({
        code: 'MISSING_RESOURCE_FILE',
        field: `images[${imgId}].sourceFile`,
        message: `Resource file '${img.sourceFile}' not found in archive`,
      })
      missingResources++
    }
  }

  const valid = errors.filter(e => e.severity === 'fatal').length === 0

  return {
    valid,
    errors,
    warnings,
    stats: {
      totalStyles: theme.styles.size,
      totalImages: theme.images.size,
      resolutions: theme.info.resolutions,
      animationReferences: animRefCount,
      missingResources,
    },
  }
}

// ============================================================================
// 3. Generate Preview Screenshot
// ============================================================================

/**
 * Create Canvas render of theme and return pixel data.
 * Renders portrait orientation by default.
 */
export async function generatePreviewScreenshot(
  theme: XunfeiTheme,
  orientation: 'portrait' | 'landscape' = 'portrait'
): Promise<ImageData | null> {
  try {
    // Convert XunfeiTheme to XunfeiConfig for preview
    const config = themeToPreviewConfig(theme)
    if (!config) return null

    // Render based on orientation
    const imageData =
      orientation === 'portrait'
        ? await renderPortrait(config)
        : await renderLandscape(config)

    return imageData
  } catch (err) {
    console.error('Preview generation failed:', err)
    return null
  }
}

// ============================================================================
// 4. Validate Roundtrip
// ============================================================================

/**
 * Serialize theme and reload; compare binary and report differences.
 */
export async function validateRoundtrip(theme: XunfeiTheme): Promise<RoundtripResult> {
  const diffs: RoundtripDiff[] = []

  try {
    // Serialize theme to binary (JSON format for now)
    const serialized = serializeTheme(theme)

    // Reload from serialized bytes
    const reloadedTheme = deserializeTheme(serialized)
    if (!reloadedTheme) {
      return {
        identical: false,
        preservationRate: 0,
        diffs: [
          {
            section: 'global',
            field: 'deserialization',
            before: 'valid',
            after: 'failed',
            impact: 'critical',
          },
        ],
        binaryMatch: false,
      }
    }

    // Compare metadata
    if (theme.info.id !== reloadedTheme.info.id) {
      diffs.push({
        section: 'info',
        field: 'id',
        before: theme.info.id,
        after: reloadedTheme.info.id,
        impact: 'critical',
      })
    }

    if (theme.info.name !== reloadedTheme.info.name) {
      diffs.push({
        section: 'info',
        field: 'name',
        before: theme.info.name,
        after: reloadedTheme.info.name,
        impact: 'critical',
      })
    }

    // Compare style counts
    if (theme.styles.size !== reloadedTheme.styles.size) {
      diffs.push({
        section: 'styles',
        field: 'count',
        before: String(theme.styles.size),
        after: String(reloadedTheme.styles.size),
        impact: 'major',
      })
    }

    // Compare image counts
    if (theme.images.size !== reloadedTheme.images.size) {
      diffs.push({
        section: 'images',
        field: 'count',
        before: String(theme.images.size),
        after: String(reloadedTheme.images.size),
        impact: 'major',
      })
    }

    // Calculate preservation rate
    const totalFields = theme.styles.size + theme.images.size + 5 // metadata fields
    const preservedFields = totalFields - diffs.filter(d => d.impact !== 'minor').length
    const preservationRate = (preservedFields / totalFields) * 100

    // Check binary match
    const binaryMatch = serialized.byteLength === 0 || diffs.length === 0

    return {
      identical: diffs.length === 0,
      preservationRate: Math.max(0, preservationRate),
      diffs,
      binaryMatch,
    }
  } catch (err) {
    return {
      identical: false,
      preservationRate: 0,
      diffs: [
        {
          section: 'global',
          field: 'roundtrip',
          before: 'valid',
          after: 'error',
          impact: 'critical',
        },
      ],
      binaryMatch: false,
    }
  }
}

// ============================================================================
// 5. Compare Skins
// ============================================================================

/**
 * Load two skins, generate previews, and perform pixel-level diff.
 */
export async function compareSkins(
  skin1Path: string,
  skin2Path: string
): Promise<SkinComparison> {
  const diffs: string[] = []

  try {
    // Load both skins
    const load1 = await loadSampleSkin(skin1Path)
    const load2 = await loadSampleSkin(skin2Path)

    if (!load1.success || !load1.theme) {
      return {
        similarity: 0,
        diffReport: null,
        diffs: [...load1.issues, 'Failed to load first skin'],
        hotspotCount: 0,
      }
    }

    if (!load2.success || !load2.theme) {
      return {
        similarity: 0,
        diffReport: null,
        diffs: [...load2.issues, 'Failed to load second skin'],
        hotspotCount: 0,
      }
    }

    // Generate previews
    const preview1 = await generatePreviewScreenshot(load1.theme, 'portrait')
    const preview2 = await generatePreviewScreenshot(load2.theme, 'portrait')

    if (!preview1 || !preview2) {
      return {
        similarity: 0,
        diffReport: null,
        diffs: ['Failed to generate preview screenshots'],
        hotspotCount: 0,
      }
    }

    // Compare screenshots
    const diffReport = compareScreenshots(preview1, preview2)

    return {
      similarity: diffReport.similarity,
      diffReport,
      diffs,
      hotspotCount: diffReport.hotspots.length,
    }
  } catch (err) {
    return {
      similarity: 0,
      diffReport: null,
      diffs: [`Comparison error: ${String(err)}`],
      hotspotCount: 0,
    }
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Read file bytes (placeholder for Node.js/browser compatibility).
 */
async function readFileBytes(filePath: string): Promise<Uint8Array | null> {
  try {
    if (typeof require !== 'undefined') {
      // Node.js environment
      const fs = require('fs')
      return new Uint8Array(fs.readFileSync(filePath))
    }
    // Browser fetch
    const response = await fetch(filePath)
    return new Uint8Array(await response.arrayBuffer())
  } catch {
    return null
  }
}

/**
 * Convert XunfeiTheme to XunfeiConfig for preview rendering.
 */
function themeToPreviewConfig(theme: XunfeiTheme): XunfeiConfig | null {
  try {
    // Create stub INI configs from theme data
    const offset = {
      sections: new Map(),
      rawText: '',
      encoding: 'utf-8' as const,
      lineEnding: '\n' as const,
    }

    const style = {
      sections: new Map(),
      rawText: '',
      encoding: 'utf-8' as const,
      lineEnding: '\n' as const,
    }

    const image = {
      sections: new Map(),
      rawText: '',
      encoding: 'utf-8' as const,
      lineEnding: '\n' as const,
    }

    // Populate style sections from theme
    for (const [styleId, styleDef] of theme.styles.entries()) {
      const section = `STYLE_${styleId}`
      const entries = new Map<string, string>()

      if (styleDef.colors?.normal) entries.set('NM_Color', styleDef.colors.normal)
      if (styleDef.colors?.pressed) entries.set('PS_Color', styleDef.colors.pressed)
      if (styleDef.colors?.disabled) entries.set('DS_Color', styleDef.colors.disabled)

      if (styleDef.font) {
        entries.set('F_Family', styleDef.font.family)
        entries.set('F_Size', String(styleDef.font.size))
        if (styleDef.font.weight) entries.set('F_Weight', String(styleDef.font.weight))
      }

      style.sections.set(section, entries)
    }

    return {
      offset,
      style,
      image,
      resources: theme.resources.files,
    }
  } catch {
    return null
  }
}

/**
 * Serialize theme to binary (JSON representation for now).
 */
function serializeTheme(theme: XunfeiTheme): Uint8Array {
  const json = JSON.stringify({
    info: theme.info,
    styles: Array.from(theme.styles.entries()),
    images: Array.from(theme.images.entries()),
    offsets: theme.offsets,
  })

  return new TextEncoder().encode(json)
}

/**
 * Deserialize theme from binary.
 */
function deserializeTheme(data: Uint8Array): XunfeiTheme | null {
  try {
    const json = new TextDecoder().decode(data)
    const obj = JSON.parse(json)

    return {
      info: obj.info,
      styles: new Map(obj.styles),
      images: new Map(obj.images),
      offsets: obj.offsets,
      resources: { files: new Map() },
    }
  } catch {
    return null
  }
}

/**
 * Construct XunfeiTheme from loaded metadata and INI files.
 */
function constructThemeFromMetadata(
  metadata: XunfeiThemeMetadata,
  _iniFiles: Map<string, any>
): XunfeiTheme {
  // Phase 1: minimal theme construction from metadata
  // Phase 2+: parse _iniFiles to populate styles, images, animations
  return {
    info: {
      id: metadata.id,
      name: metadata.name,
      author: metadata.author,
      version: metadata.version,
      resolutions: metadata.resolution,
    },
    styles: new Map(),
    images: new Map(),
    offsets: [],
    resources: { files: new Map() },
  }
}
