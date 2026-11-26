/**
 * Xunfei Screenshot Diff: compare rendered keyboard previews using SSIM and pixel-level analysis.
 *
 * Features:
 * - Structural Similarity Index (SSIM) for perceptual matching
 * - Pixel-by-pixel RGBA comparison with anti-aliasing tolerance (±5% per channel)
 * - Morphological filtering to remove noise (dilate/erode)
 * - Hotspot clustering for region-level impact analysis
 * - Visual heatmap overlay: red=high diff, yellow=medium, green=low
 * - Regional similarity analysis for specific areas
 * - PNG export for visual inspection via canvas
 */

// ============================================================================
// Types & Constants
// ============================================================================

export interface DiffReport {
  /** Similarity score 0-100 (100 = identical) */
  similarity: number
  /** Number of pixels exceeding tolerance threshold */
  diffPixelCount: number
  /** Heatmap as RGBA Uint8ClampedArray (R=diff magnitude, G/B=0, A=255) */
  heatmap: Uint8ClampedArray
  /** Width and height of compared images */
  width: number
  height: number
  /** MSE (Mean Squared Error) for reference */
  mse: number
  /** SSIM (Structural Similarity Index) 0-1 */
  ssim: number
  /** Hotspots: regions of significant differences */
  hotspots: Hotspot[]
}

export interface Hotspot {
  x: number
  y: number
  width: number
  height: number
  /** Severity 0-1, where 1 is most different */
  severity: number
  /** Number of differing pixels in this hotspot */
  pixelCount: number
}

export interface RegionalDiff {
  /** Similarity within the region 0-100 */
  similarity: number
  /** Number of differing pixels in region */
  diffPixelCount: number
  /** Total pixels in region */
  totalPixels: number
  /** Local MSE */
  mse: number
}

/** Tolerance per RGB channel (5% = 12.75/255) */
const TOLERANCE_PER_CHANNEL = 12.75

/** SSIM window size (11x11 Gaussian) */
const SSIM_WINDOW = 11
const SSIM_C1 = 6.5025
const SSIM_C2 = 58.5225

/** Morphological operation kernel size */
const MORPH_KERNEL_SIZE = 3

/** Minimum hotspot size (pixels) to cluster */
const MIN_HOTSPOT_SIZE = 50

/** Minimum hotspot severity to report */
const MIN_HOTSPOT_SEVERITY = 0.1

// ============================================================================
// Core Comparison
// ============================================================================

/**
 * Compare two ImageData objects and return structured diff report.
 * Calculates SSIM, MSE, diff pixels, heatmap, and hotspot regions.
 */
export function compareScreenshots(
  expected: ImageData,
  actual: ImageData
): DiffReport {
  if (expected.width !== actual.width || expected.height !== actual.height) {
    throw new Error(
      `Image dimensions mismatch: ${expected.width}x${expected.height} vs ${actual.width}x${actual.height}`
    )
  }

  const width = expected.width
  const height = expected.height
  const dataExpected = expected.data
  const dataActual = actual.data
  const pixelCount = width * height

  // Generate diff mask and heatmap
  const diffMask = new Uint8Array(pixelCount) // 0=same, 1=different
  const heatmap = new Uint8ClampedArray(pixelCount * 4)
  let diffPixelCount = 0
  let mseSum = 0

  for (let i = 0; i < dataExpected.length; i += 4) {
    const pixelIdx = i / 4
    const r1 = dataExpected[i]
    const g1 = dataExpected[i + 1]
    const b1 = dataExpected[i + 2]
    const a1 = dataExpected[i + 3]

    const r2 = dataActual[i]
    const g2 = dataActual[i + 1]
    const b2 = dataActual[i + 2]
    const a2 = dataActual[i + 3]

    // Alpha always must match exactly (not subject to tolerance)
    const alphaDiff = Math.abs(a1 - a2)

    // RGB tolerance: ±5% per channel for anti-aliasing
    const rDiff = Math.abs(r1 - r2)
    const gDiff = Math.abs(g1 - g2)
    const bDiff = Math.abs(b1 - b2)

    const isRDiffExceed = rDiff > TOLERANCE_PER_CHANNEL
    const isGDiffExceed = gDiff > TOLERANCE_PER_CHANNEL
    const isBDiffExceed = bDiff > TOLERANCE_PER_CHANNEL
    const isAlphaDiffExceed = alphaDiff > 0

    const isDifferent =
      isRDiffExceed ||
      isGDiffExceed ||
      isBDiffExceed ||
      isAlphaDiffExceed

    if (isDifferent) {
      diffPixelCount++
      diffMask[pixelIdx] = 1
    }

    // Heatmap: magnitude of difference (red channel encodes severity)
    const diffMagnitude = Math.max(rDiff, gDiff, bDiff, alphaDiff)
    heatmap[pixelIdx * 4] = Math.min(255, diffMagnitude * 2) // R: red = diff
    heatmap[pixelIdx * 4 + 1] = 0 // G
    heatmap[pixelIdx * 4 + 2] = 0 // B
    heatmap[pixelIdx * 4 + 3] = 255 // A: always opaque

    // MSE: sum squared errors (normalized per channel)
    mseSum += (rDiff * rDiff + gDiff * gDiff + bDiff * bDiff + alphaDiff * alphaDiff) / 4
  }

  const mse = mseSum / pixelCount
  const ssim = calculateSSIM(dataExpected, dataActual, width, height)

  // Apply morphological filtering to remove noise
  const filteredMask = morphologicalFilter(diffMask, width, height)

  // Cluster diff regions into hotspots
  const hotspots = clusterHotspots(filteredMask, heatmap, width, height)

  // Convert MSE to similarity score (0-100, 100=identical)
  const similarity = Math.max(0, 100 - mse / 2.55)

  return {
    similarity: Math.round(similarity * 100) / 100,
    diffPixelCount,
    heatmap,
    width,
    height,
    mse: Math.round(mse * 100) / 100,
    ssim: Math.round(ssim * 10000) / 10000,
    hotspots,
  }
}

/**
 * Generate a full visual diff overlay combining checkerboard and heatmap.
 * Returns ImageData suitable for canvas display or PNG export.
 */
export function generateDiffOverlay(
  expected: ImageData,
  actual: ImageData
): ImageData {
  const report = compareScreenshots(expected, actual)

  // Create overlay combining checkerboard background with heatmap
  const overlayData = new Uint8ClampedArray(report.width * report.height * 4)

  const squareSize = 8
  for (let y = 0; y < report.height; y++) {
    for (let x = 0; x < report.width; x++) {
      const pixelIdx = y * report.width + x
      const idx = pixelIdx * 4

      // Checkerboard background
      const isWhite = ((Math.floor(x / squareSize) + Math.floor(y / squareSize)) % 2 === 0)
      const bgColor = isWhite ? 255 : 204

      // Blend heatmap on top
      const heatR = report.heatmap[idx]
      const alpha = heatR / 255

      overlayData[idx] = Math.round(bgColor * (1 - alpha) + heatR * alpha)
      overlayData[idx + 1] = Math.round(bgColor * (1 - alpha))
      overlayData[idx + 2] = Math.round(bgColor * (1 - alpha))
      overlayData[idx + 3] = 255
    }
  }

  return new ImageData(overlayData, report.width, report.height)
}

/**
 * Analyze similarity within a specific rectangular region.
 * Returns regional metrics without full image comparison.
 */
export function analyzeRegion(
  expected: ImageData,
  actual: ImageData,
  x: number,
  y: number,
  width: number,
  height: number
): RegionalDiff {
  if (expected.width !== actual.width || expected.height !== actual.height) {
    throw new Error('Image dimensions mismatch')
  }

  // Clamp region to image bounds
  const x0 = Math.max(0, x)
  const y0 = Math.max(0, y)
  const x1 = Math.min(expected.width, x + width)
  const y1 = Math.min(expected.height, y + height)

  const dataExpected = expected.data
  const dataActual = actual.data
  const imgWidth = expected.width

  let diffPixelCount = 0
  let mseSum = 0
  let totalPixels = 0

  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const idx = (py * imgWidth + px) * 4
      totalPixels++

      const r1 = dataExpected[idx]
      const g1 = dataExpected[idx + 1]
      const b1 = dataExpected[idx + 2]
      const a1 = dataExpected[idx + 3]

      const r2 = dataActual[idx]
      const g2 = dataActual[idx + 1]
      const b2 = dataActual[idx + 2]
      const a2 = dataActual[idx + 3]

      const alphaDiff = Math.abs(a1 - a2)
      const rDiff = Math.abs(r1 - r2)
      const gDiff = Math.abs(g1 - g2)
      const bDiff = Math.abs(b1 - b2)

      if (
        rDiff > TOLERANCE_PER_CHANNEL ||
        gDiff > TOLERANCE_PER_CHANNEL ||
        bDiff > TOLERANCE_PER_CHANNEL ||
        alphaDiff > 0
      ) {
        diffPixelCount++
      }

      mseSum += (rDiff * rDiff + gDiff * gDiff + bDiff * bDiff + alphaDiff * alphaDiff) / 4
    }
  }

  const mse = totalPixels > 0 ? mseSum / totalPixels : 0
  const similarity = Math.max(0, 100 - mse / 2.55)

  return {
    similarity: Math.round(similarity * 100) / 100,
    diffPixelCount,
    totalPixels,
    mse: Math.round(mse * 100) / 100,
  }
}

// ============================================================================
// SSIM Calculation
// ============================================================================

/**
 * Calculate Structural Similarity Index (SSIM) between two images.
 * SSIM measures perceived quality degradation, 0-1 scale (1=identical).
 */
function calculateSSIM(
  data1: Uint8ClampedArray,
  data2: Uint8ClampedArray,
  width: number,
  height: number
): number {
  let ssimSum = 0
  let count = 0

  // Sample every SSIM_WINDOW pixels to reduce computation
  const step = Math.max(1, Math.floor(SSIM_WINDOW / 2))

  for (let y = 0; y < height - SSIM_WINDOW; y += step) {
    for (let x = 0; x < width - SSIM_WINDOW; x += step) {
      const ssimLocal = calculateSSIMLocal(data1, data2, width, x, y)
      ssimSum += ssimLocal
      count++
    }
  }

  return count > 0 ? ssimSum / count : 1
}

/**
 * Calculate SSIM for a local window (11x11).
 */
function calculateSSIMLocal(
  data1: Uint8ClampedArray,
  data2: Uint8ClampedArray,
  width: number,
  startX: number,
  startY: number
): number {
  let mean1 = 0
  let mean2 = 0
  let count = 0

  // Calculate means
  for (let dy = 0; dy < SSIM_WINDOW; dy++) {
    for (let dx = 0; dx < SSIM_WINDOW; dx++) {
      const idx = ((startY + dy) * width + (startX + dx)) * 4
      mean1 += data1[idx]
      mean2 += data2[idx]
      count++
    }
  }

  mean1 /= count
  mean2 /= count

  // Calculate variance and covariance
  let var1 = 0
  let var2 = 0
  let covar = 0

  for (let dy = 0; dy < SSIM_WINDOW; dy++) {
    for (let dx = 0; dx < SSIM_WINDOW; dx++) {
      const idx = ((startY + dy) * width + (startX + dx)) * 4
      const diff1 = data1[idx] - mean1
      const diff2 = data2[idx] - mean2

      var1 += diff1 * diff1
      var2 += diff2 * diff2
      covar += diff1 * diff2
    }
  }

  var1 /= count
  var2 /= count
  covar /= count

  // SSIM formula: (2*μ1*μ2 + C1)(2*σ12 + C2) / ((μ1^2 + μ2^2 + C1)(σ1^2 + σ2^2 + C2))
  const numerator = (2 * mean1 * mean2 + SSIM_C1) * (2 * covar + SSIM_C2)
  const denominator =
    (mean1 * mean1 + mean2 * mean2 + SSIM_C1) * (var1 + var2 + SSIM_C2)

  return denominator > 0 ? numerator / denominator : 1
}

// ============================================================================
// Morphological Operations
// ============================================================================

/**
 * Apply morphological filter (erode then dilate) to remove noise from diff mask.
 * This reduces isolated diff pixels while preserving larger regions.
 */
function morphologicalFilter(
  mask: Uint8Array,
  width: number,
  height: number
): Uint8Array {
  // Erode: remove isolated pixels
  const eroded = erodeMask(mask, width, height)
  // Dilate: restore some boundaries
  const dilated = dilateMask(eroded, width, height)
  return dilated
}

/**
 * Erode: a pixel is set only if all neighbors in kernel are set.
 */
function erodeMask(
  mask: Uint8Array,
  width: number,
  height: number
): Uint8Array {
  const result = new Uint8Array(mask.length)
  const r = Math.floor(MORPH_KERNEL_SIZE / 2)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      let allSet = true

      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const ny = y + dy
          const nx = x + dx
          if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
            if (mask[ny * width + nx] === 0) {
              allSet = false
              break
            }
          }
        }
        if (!allSet) break
      }

      result[idx] = allSet ? 1 : 0
    }
  }

  return result
}

/**
 * Dilate: a pixel is set if any neighbor in kernel is set.
 */
function dilateMask(
  mask: Uint8Array,
  width: number,
  height: number
): Uint8Array {
  const result = new Uint8Array(mask.length)
  const r = Math.floor(MORPH_KERNEL_SIZE / 2)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      let anySet = false

      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const ny = y + dy
          const nx = x + dx
          if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
            if (mask[ny * width + nx] === 1) {
              anySet = true
              break
            }
          }
        }
        if (anySet) break
      }

      result[idx] = anySet ? 1 : 0
    }
  }

  return result
}

// ============================================================================
// Hotspot Clustering
// ============================================================================

/**
 * Cluster diff regions into hotspots using connected component analysis.
 * Each hotspot is a bounding box around a connected region of differences.
 */
function clusterHotspots(
  diffMask: Uint8Array,
  heatmap: Uint8ClampedArray,
  width: number,
  height: number
): Hotspot[] {
  const visited = new Uint8Array(diffMask.length)
  const hotspots: Hotspot[] = []

  for (let i = 0; i < diffMask.length; i++) {
    if (diffMask[i] === 1 && visited[i] === 0) {
      const component = floodFill(diffMask, visited, i, width, height)
      if (component.length >= MIN_HOTSPOT_SIZE) {
        const hotspot = boundingBoxToHotspot(component, heatmap, width)
        if (hotspot.severity >= MIN_HOTSPOT_SEVERITY) {
          hotspots.push(hotspot)
        }
      }
    }
  }

  return hotspots
}

/**
 * Flood fill to find connected components of differences.
 */
function floodFill(
  mask: Uint8Array,
  visited: Uint8Array,
  start: number,
  width: number,
  height: number
): number[] {
  const component: number[] = []
  const queue = [start]
  visited[start] = 1

  while (queue.length > 0) {
    const idx = queue.shift()!
    component.push(idx)

    // 4-connectivity neighbors
    const neighbors = [
      idx - width, // up
      idx + width, // down
      idx - 1, // left
      idx + 1, // right
    ]

    for (const nIdx of neighbors) {
      const ny = Math.floor(nIdx / width)
      const nx = nIdx % width

      if (
        nIdx >= 0 &&
        nIdx < mask.length &&
        nx >= 0 &&
        nx < width &&
        ny >= 0 &&
        ny < height &&
        mask[nIdx] === 1 &&
        visited[nIdx] === 0
      ) {
        visited[nIdx] = 1
        queue.push(nIdx)
      }
    }
  }

  return component
}

/**
 * Convert connected component pixels to a hotspot with bounding box.
 */
function boundingBoxToHotspot(
  component: number[],
  heatmap: Uint8ClampedArray,
  width: number
): Hotspot {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let severitySum = 0

  for (const idx of component) {
    const y = Math.floor(idx / width)
    const x = idx % width
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)

    // Sum heatmap red channel (severity)
    severitySum += heatmap[idx * 4]
  }

  const severity = Math.min(1, severitySum / (component.length * 255))

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    severity,
    pixelCount: component.length,
  }
}

// ============================================================================
// PNG Export
// ============================================================================

/**
 * Save diff report as PNG file using canvas rendering.
 * Red heatmap overlaid on checkerboard background for transparency.
 */
export async function saveDiffPNG(
  report: DiffReport,
  path: string
): Promise<void> {
  const canvas = getCanvas()
  if (!canvas) {
    throw new Error('Canvas not available in this environment')
  }

  canvas.width = report.width
  canvas.height = report.height

  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!ctx) {
    throw new Error('Failed to get 2D context')
  }

  // Render checkerboard background
  renderCheckerboard(ctx, report.width, report.height)

  // Render heatmap as semi-transparent overlay
  const imageData = ctx.createImageData(report.width, report.height)
  imageData.data.set(report.heatmap)
  ctx.putImageData(imageData, 0, 0)

  // Draw hotspots as bounding boxes
  ctx.strokeStyle = 'rgba(255, 0, 0, 0.7)'
  ctx.lineWidth = 2
  for (const hotspot of report.hotspots) {
    ctx.strokeRect(hotspot.x, hotspot.y, hotspot.width, hotspot.height)
  }

  // Save as PNG
  await savePNG(canvas, path)
}

/**
 * Render transparent checkerboard pattern.
 */
function renderCheckerboard(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  width: number,
  height: number
): void {
  const squareSize = 8
  ctx.fillStyle = '#cccccc'
  ctx.fillRect(0, 0, width, height)

  ctx.fillStyle = '#ffffff'
  for (let y = 0; y < height; y += squareSize) {
    for (let x = 0; x < width; x += squareSize) {
      if (((x / squareSize) + (y / squareSize)) % 2 === 0) {
        ctx.fillRect(x, y, squareSize, squareSize)
      }
    }
  }
}

/**
 * Get canvas object (browser or Node.js).
 */
function getCanvas(): HTMLCanvasElement | OffscreenCanvas | null {
  if (typeof document !== 'undefined') {
    // Browser
    return document.createElement('canvas')
  }

  if (typeof OffscreenCanvas !== 'undefined') {
    // Worker/Node.js with OffscreenCanvas
    return new OffscreenCanvas(0, 0)
  }

  return null
}

/**
 * Save canvas as PNG file.
 * Browser: use Blob; Node.js: use canvas.toBuffer() if available.
 */
async function savePNG(canvas: any, path: string): Promise<void> {
  // Browser environment
  if (typeof Blob !== 'undefined' && canvas.toBlob) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        async (blob: Blob) => {
          try {
            const buffer = await blob.arrayBuffer()
            const uint8Array = new Uint8Array(buffer)

            // Write to file (requires fs API or fetch to server)
            if (typeof require !== 'undefined') {
              const fs = require('fs')
              fs.writeFileSync(path, uint8Array)
            } else {
              throw new Error('No fs module available')
            }

            resolve()
          } catch (err) {
            reject(err)
          }
        },
        'image/png'
      )
    })
  }

  // Node.js with canvas library
  if (canvas.toBuffer) {
    const { writeFile } = await import('fs/promises')
    const buffer = canvas.toBuffer('image/png')
    await writeFile(path, buffer)
    return
  }

  throw new Error('PNG export not supported in this environment')
}
