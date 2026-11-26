/**
 * Xunfei Validation Tests: Compare Canvas Preview vs Device Screenshot
 *
 * Compares rendered keyboard preview PNG files against device screenshots using
 * perceptual diff analysis, reporting:
 * - Similarity score (0-100%)
 * - Diff regions via SSIM and hotspot analysis
 * - Known tolerances (anti-aliasing ±5%, font rendering)
 * - Recommendations for fixes if similarity < 85%
 *
 * Run with: node --test tests/xunfei-validation.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePng } from '../src/ssf/ssf-png.ts'
import { compareScreenshots, analyzeRegion } from '../src/xunfei/xunfei-diff.ts'

const __dirname = resolve(fileURLToPath(import.meta.url), '..')

// ============================================================================
// Mock Canvas for Node Environment
// ============================================================================

class MockCanvasContext {
  constructor(canvas) {
    this.canvas = canvas
    this.pixelData = new Uint8ClampedArray(canvas.width * canvas.height * 4)
    this.pixelData.fill(255) // White background
    this.fillStyle = '#000000'
  }

  fillRect(x, y, width, height) {
    const color = this.parseColor(this.fillStyle)
    const x0 = Math.max(0, Math.floor(x))
    const y0 = Math.max(0, Math.floor(y))
    const x1 = Math.min(this.canvas.width, Math.ceil(x + width))
    const y1 = Math.min(this.canvas.height, Math.ceil(y + height))

    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const idx = (py * this.canvas.width + px) * 4
        this.pixelData[idx] = color.r
        this.pixelData[idx + 1] = color.g
        this.pixelData[idx + 2] = color.b
        this.pixelData[idx + 3] = color.a
      }
    }
  }

  clearRect(x, y, width, height) {
    const x0 = Math.max(0, Math.floor(x))
    const y0 = Math.max(0, Math.floor(y))
    const x1 = Math.min(this.canvas.width, Math.ceil(x + width))
    const y1 = Math.min(this.canvas.height, Math.ceil(y + height))

    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const idx = (py * this.canvas.width + px) * 4
        this.pixelData[idx + 3] = 0
      }
    }
  }

  fillText() {}
  drawImage() {}
  measureText() {
    return { width: 100 }
  }
  save() {}
  restore() {}
  translate() {}
  scale() {}
  rotate() {}

  set globalAlpha(val) {}
  set font(val) {}

  getImageData(x, y, width, height) {
    const imageData = new ImageData(width, height)
    const x0 = Math.max(0, Math.floor(x))
    const y0 = Math.max(0, Math.floor(y))

    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const srcIdx = ((y0 + py) * this.canvas.width + (x0 + px)) * 4
        const dstIdx = (py * width + px) * 4
        if (srcIdx + 3 < this.pixelData.length) {
          imageData.data[dstIdx] = this.pixelData[srcIdx]
          imageData.data[dstIdx + 1] = this.pixelData[srcIdx + 1]
          imageData.data[dstIdx + 2] = this.pixelData[srcIdx + 2]
          imageData.data[dstIdx + 3] = this.pixelData[srcIdx + 3]
        }
      }
    }
    return imageData
  }

  parseColor(colorStr) {
    if (colorStr.startsWith('#')) {
      const hex = colorStr.slice(1)
      if (hex.length === 6) {
        return {
          r: parseInt(hex.slice(0, 2), 16),
          g: parseInt(hex.slice(2, 4), 16),
          b: parseInt(hex.slice(4, 6), 16),
          a: 255,
        }
      }
    }
    if (colorStr.startsWith('rgba')) {
      const match = colorStr.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/)
      if (match) {
        return {
          r: parseInt(match[1]),
          g: parseInt(match[2]),
          b: parseInt(match[3]),
          a: Math.round(parseFloat(match[4]) * 255),
        }
      }
    }
    return { r: 0, g: 0, b: 0, a: 255 }
  }
}

globalThis.OffscreenCanvas ??= class {
  constructor(width, height) {
    this.width = width
    this.height = height
    this._context = null
  }

  getContext(type) {
    if (type === '2d') {
      if (!this._context) {
        this._context = new MockCanvasContext(this)
      }
      return this._context
    }
    return null
  }
}

globalThis.ImageData ??= class {
  constructor(data, width, height) {
    if (typeof data === 'number') {
      // ImageData(width, height)
      this.width = data
      this.height = width
      this.data = new Uint8ClampedArray(this.width * this.height * 4)
    } else {
      // ImageData(data, width, height)
      this.data = data
      this.width = width
      this.height = height
    }
  }
}

// ============================================================================
// File Utilities
// ============================================================================

/**
 * Load PNG file and convert to ImageData
 */
function loadPngAsImageData(filepath) {
  const bytes = readFileSync(filepath)
  const decoded = decodePng(bytes)
  return new ImageData(decoded.data, decoded.width, decoded.height)
}

/**
 * Find all matching preview/device screenshot pairs
 */
function findScreenshotPairs(screenshotsDir) {
  const previewFiles = new Map()
  const deviceFiles = new Map()

  try {
    const files = readdirSync(screenshotsDir)

    for (const file of files) {
      if (file.startsWith('preview-') && file.endsWith('.png')) {
        const name = file.slice(8, -4) // Remove 'preview-' and '.png'
        previewFiles.set(name, resolve(screenshotsDir, file))
      } else if (file.startsWith('device-') && file.endsWith('.png')) {
        const name = file.slice(7, -4) // Remove 'device-' and '.png'
        deviceFiles.set(name, resolve(screenshotsDir, file))
      }
    }
  } catch (err) {
    // Directory may not exist yet
  }

  const pairs = []
  for (const [name, previewPath] of previewFiles) {
    const devicePath = deviceFiles.get(name)
    pairs.push({
      name,
      previewPath,
      devicePath: devicePath || null,
      hasDevice: !!devicePath,
    })
  }

  return pairs.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Generate recommendations based on hotspots and similarity score
 */
function generateRecommendations(similarity, hotspots, width, height) {
  const recommendations = []

  if (similarity < 85) {
    recommendations.push('⚠️ Similarity below 85% - review rendering differences')

    if (hotspots.length === 0) {
      recommendations.push('• No significant hotspots detected - check overall color/scaling')
    } else if (hotspots.length > 5) {
      recommendations.push(`• ${hotspots.length} difference regions found - check rendering state or theme`)
    }

    // Analyze hotspot severity distribution
    const severities = hotspots.map(h => h.severity)
    const avgSeverity = severities.length > 0 ? severities.reduce((a, b) => a + b) / severities.length : 0
    const maxSeverity = Math.max(...severities, 0)

    if (maxSeverity > 0.5) {
      recommendations.push('• High-severity differences detected - check color/font rendering')
    }

    if (avgSeverity > 0.3) {
      const topHotspot = hotspots.reduce((a, b) => a.severity > b.severity ? a : b, hotspots[0])
      if (topHotspot) {
        const regionName = topHotspot.y < height / 3 ? 'top' : topHotspot.y < (2 * height) / 3 ? 'middle' : 'bottom'
        const xName = topHotspot.x < width / 3 ? 'left' : topHotspot.x < (2 * width) / 3 ? 'center' : 'right'
        recommendations.push(`• Focus on ${xName}-${regionName} region (${topHotspot.pixelCount} pixels affected)`)
      }
    }
  } else if (similarity >= 95) {
    recommendations.push('✓ Excellent match (≥95%) - rendering is accurate')
  } else if (similarity >= 90) {
    recommendations.push('✓ Good match (≥90%) - minor anti-aliasing differences acceptable')
  } else {
    recommendations.push('⚠️ Fair match (85-90%) - review hotspots for systematic issues')
  }

  return recommendations
}

/**
 * Generate validation report for a single comparison
 */
function generateValidationReport(name, preview, device, comparison, width, height) {
  const recommendations = generateRecommendations(comparison.similarity, comparison.hotspots, width, height)

  return {
    name,
    timestamp: new Date().toISOString(),
    preview: {
      hasFile: true,
      dimensions: { width, height },
    },
    device: {
      hasFile: device !== null,
      dimensions: device ? { width: device.width, height: device.height } : null,
    },
    comparison: {
      similarity: comparison.similarity,
      ssim: comparison.ssim,
      mse: comparison.mse,
      diffPixels: comparison.diffPixelCount,
      totalPixels: width * height,
      diffPercentage: ((comparison.diffPixelCount / (width * height)) * 100).toFixed(2),
    },
    tolerances: {
      antiAliasingPerChannel: '±5% (12.75/255)',
      alphaChannel: 'exact match required',
      ssimThreshold: '0.85 (85% similarity)',
    },
    hotspots: comparison.hotspots.map(h => ({
      region: {
        x: h.x,
        y: h.y,
        width: h.width,
        height: h.height,
      },
      severity: h.severity.toFixed(4),
      pixelsAffected: h.pixelCount,
    })),
    recommendations,
    status: comparison.similarity >= 85 ? 'PASS' : 'FAIL',
  }
}

// ============================================================================
// Test Suite
// ============================================================================

mkdirSync(resolve(__dirname, '../test-results'), { recursive: true })
mkdirSync(resolve(__dirname, '../screenshots'), { recursive: true })

// Preview screenshots are local artifacts, not checked in; skip the comparisons where none exist.
const previewScreenshots = (() => {
  try {
    return readdirSync(resolve(__dirname, '../screenshots')).filter(name => name.startsWith('preview-') && name.endsWith('.png'))
  } catch {
    return []
  }
})()
const skipWithoutPreviews = previewScreenshots.length ? {} : { skip: 'no preview screenshots were captured' }

test('Validation: load preview screenshots', skipWithoutPreviews, async t => {
  const screenshotsDir = resolve(__dirname, '../screenshots')

  let previewCount = 0
  try {
    const files = readdirSync(screenshotsDir)
    previewCount = files.filter(f => f.startsWith('preview-') && f.endsWith('.png')).length
  } catch {
    // Directory doesn't exist yet
  }

  assert.ok(previewCount > 0, `Found ${previewCount} preview-*.png files`)
})

test('Validation: compare preview vs device screenshots', skipWithoutPreviews, async t => {
  const screenshotsDir = resolve(__dirname, '../screenshots')

  // Find all preview files
  let previewFiles = []
  try {
    const files = readdirSync(screenshotsDir)
    previewFiles = files
      .filter(f => f.startsWith('preview-') && f.endsWith('.png'))
      .map(f => ({ preview: f, device: `device-${f.slice(8)}` }))
  } catch {
    // Directory doesn't exist
  }

  assert.ok(previewFiles.length > 0, 'At least one preview file should exist')

  const allReports = []

  for (const { preview, device } of previewFiles) {
    const previewPath = resolve(screenshotsDir, preview)
    const devicePath = resolve(screenshotsDir, device)
    const hasDevice = existsSync(devicePath)

    // Load preview
    assert.ok(existsSync(previewPath), `Preview file exists: ${preview}`)

    // If device exists, compare; otherwise, create placeholder report
    if (hasDevice) {
      const previewData = loadPngAsImageData(previewPath)
      const deviceData = loadPngAsImageData(devicePath)

      // Both must be same dimensions
      assert.strictEqual(
        previewData.width, deviceData.width,
        `Dimension mismatch for ${preview}: width`
      )
      assert.strictEqual(
        previewData.height, deviceData.height,
        `Dimension mismatch for ${preview}: height`
      )

      const comparison = compareScreenshots(previewData, deviceData)
      assert.ok(typeof comparison.similarity === 'number', 'Similarity should be a number')
      assert.ok(comparison.similarity >= 0 && comparison.similarity <= 100, 'Similarity should be 0-100')

      const report = generateValidationReport(
        preview.slice(0, -4), // Remove .png
        previewData,
        deviceData,
        comparison,
        previewData.width,
        previewData.height
      )

      allReports.push(report)

      // Log for visibility
      console.log(`\n${preview}: ${comparison.similarity.toFixed(1)}% similarity`)
      console.log(`  SSIM: ${comparison.ssim.toFixed(4)}, MSE: ${comparison.mse.toFixed(2)}`)
      console.log(`  Hotspots: ${comparison.hotspots.length}`)
      if (comparison.similarity < 85) {
        console.log(`  Status: FAIL - Below 85% threshold`)
      }
    } else {
      // No device screenshot - create placeholder report
      const previewData = loadPngAsImageData(previewPath)
      const report = {
        name: preview.slice(0, -4),
        timestamp: new Date().toISOString(),
        preview: {
          hasFile: true,
          dimensions: { width: previewData.width, height: previewData.height },
        },
        device: {
          hasFile: false,
          dimensions: null,
        },
        comparison: {
          similarity: null,
          ssim: null,
          mse: null,
          diffPixels: null,
          totalPixels: previewData.width * previewData.height,
          diffPercentage: null,
        },
        tolerances: {
          antiAliasingPerChannel: '±5% (12.75/255)',
          alphaChannel: 'exact match required',
          ssimThreshold: '0.85 (85% similarity)',
        },
        hotspots: [],
        recommendations: ['⚠️ No device screenshot - capture device screenshot as device-' + preview.slice(8)],
        status: 'PENDING',
      }

      allReports.push(report)
      console.log(`\n${preview}: PENDING (no device screenshot)`)
    }
  }

  // Write comprehensive report
  const reportPath = resolve(__dirname, '../test-results/xunfei-diff-report.json')
  const fullReport = {
    timestamp: new Date().toISOString(),
    summary: {
      total: allReports.length,
      passed: allReports.filter(r => r.status === 'PASS').length,
      failed: allReports.filter(r => r.status === 'FAIL').length,
      pending: allReports.filter(r => r.status === 'PENDING').length,
      averageSimilarity: allReports
        .filter(r => r.comparison.similarity !== null)
        .reduce((sum, r) => sum + r.comparison.similarity, 0) /
        allReports.filter(r => r.comparison.similarity !== null).length || 0,
    },
    reports: allReports,
  }

  writeFileSync(reportPath, JSON.stringify(fullReport, null, 2))
  console.log(`\n✓ Report saved to: ${reportPath}`)
  console.log(`  Total: ${fullReport.summary.total}`)
  console.log(`  Passed: ${fullReport.summary.passed}`)
  console.log(`  Failed: ${fullReport.summary.failed}`)
  console.log(`  Pending: ${fullReport.summary.pending}`)
  console.log(`  Average Similarity: ${fullReport.summary.averageSimilarity.toFixed(1)}%`)
})

test('Validation: tolerance verification', async t => {
  // Verify that compareScreenshots uses correct tolerances
  const { OffscreenCanvas } = globalThis
  const canvas1 = new OffscreenCanvas(100, 100)
  const ctx1 = canvas1.getContext('2d')

  // Create test image 1
  ctx1.fillStyle = '#FF0000'
  ctx1.fillRect(0, 0, 100, 100)
  const imageData1 = ctx1.getImageData(0, 0, 100, 100)

  // Create test image 2 with slight anti-aliasing difference (±5%)
  const canvas2 = new OffscreenCanvas(100, 100)
  const ctx2 = canvas2.getContext('2d')
  ctx2.fillStyle = '#FE0000' // Slightly different red (254 vs 255)
  ctx2.fillRect(0, 0, 100, 100)
  const imageData2 = ctx2.getImageData(0, 0, 100, 100)

  const comparison = compareScreenshots(imageData1, imageData2)

  // Small differences within anti-aliasing tolerance should have high similarity
  assert.ok(comparison.similarity > 90, `Anti-aliasing tolerance test: ${comparison.similarity.toFixed(1)}% (should be > 90%)`)
  console.log(`✓ Tolerance verified: ${comparison.similarity.toFixed(1)}% for ±1 RGB channel difference`)
})

test('Validation: hotspot detection', async t => {
  const { OffscreenCanvas } = globalThis
  const canvas1 = new OffscreenCanvas(400, 400)
  const ctx1 = canvas1.getContext('2d')

  // Create base image
  ctx1.fillStyle = '#FFFFFF'
  ctx1.fillRect(0, 0, 400, 400)
  const baseImageData = ctx1.getImageData(0, 0, 400, 400)

  // Create modified image with a region change
  const canvas2 = new OffscreenCanvas(400, 400)
  const ctx2 = canvas2.getContext('2d')
  ctx2.fillStyle = '#FFFFFF'
  ctx2.fillRect(0, 0, 400, 400)
  ctx2.fillStyle = '#FF0000' // Red region
  ctx2.fillRect(100, 100, 150, 150) // Localized change
  const modifiedImageData = ctx2.getImageData(0, 0, 400, 400)

  const comparison = compareScreenshots(baseImageData, modifiedImageData)

  assert.ok(comparison.hotspots.length > 0, 'Hotspots should be detected for localized changes')

  if (comparison.hotspots.length > 0) {
    const hotspot = comparison.hotspots[0]
    // Hotspot should encompass the red rectangle area
    assert.ok(hotspot.x <= 100, `Hotspot x (${hotspot.x}) should start before or at x=100`)
    assert.ok(hotspot.y <= 100, `Hotspot y (${hotspot.y}) should start before or at y=100`)
    assert.ok(hotspot.x + hotspot.width >= 250, `Hotspot right edge should include x=250`)
    assert.ok(hotspot.y + hotspot.height >= 250, `Hotspot bottom edge should include y=250`)
    console.log(`✓ Hotspot detected: ${hotspot.width}×${hotspot.height} at (${hotspot.x}, ${hotspot.y}), severity=${hotspot.severity.toFixed(4)}`)
  }
})
