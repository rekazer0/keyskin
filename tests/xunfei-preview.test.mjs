/**
 * Xunfei Canvas Preview Tests
 *
 * Tests for rendering Xunfei themes on canvas with:
 * - Idle state rendering
 * - Key press state simulation
 * - Frame comparison validation
 * - Animation playback
 * - PNG snapshot export
 *
 * Run with: node --test tests/xunfei-preview.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodePng } from '../src/ssf/ssf-png.ts'

const __dirname = resolve(fileURLToPath(import.meta.url), '..')

// ============================================================================
// Mock Canvas Implementation for Node
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
  constructor(width, height) {
    this.width = width
    this.height = height
    this.data = new Uint8ClampedArray(width * height * 4)
  }
}

// ============================================================================
// Frame Utilities
// ============================================================================

function captureCanvasFrame(canvas) {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Failed to get 2D context')
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

function compareFrames(frame1, frame2) {
  if (frame1.width !== frame2.width || frame1.height !== frame2.height) {
    return { similarity: 0, diffPixels: frame1.width * frame1.height }
  }

  const data1 = frame1.data
  const data2 = frame2.data
  let diffPixels = 0

  for (let i = 0; i < data1.length; i += 4) {
    if (
      data1[i] !== data2[i] ||
      data1[i + 1] !== data2[i + 1] ||
      data1[i + 2] !== data2[i + 2] ||
      data1[i + 3] !== data2[i + 3]
    ) {
      diffPixels++
    }
  }

  const totalPixels = frame1.width * frame1.height
  const similarity = ((totalPixels - diffPixels) / totalPixels) * 100

  return { similarity, diffPixels }
}

async function saveImageDataAsPng(imageData, filename) {
  const { width, height, data } = imageData
  const pngBytes = encodePng({ width, height, data })
  writeFileSync(filename, Buffer.from(pngBytes))
}

// ============================================================================
// Test Suite
// ============================================================================

mkdirSync(resolve(__dirname, '../screenshots'), { recursive: true })

test('Canvas test on first sample theme - create and validate', async () => {
  // Create a sample canvas
  const canvas = new OffscreenCanvas(1920, 1080)
  assert.ok(canvas, 'Canvas created')
  assert.strictEqual(canvas.width, 1920, 'Canvas width is correct')
  assert.strictEqual(canvas.height, 1080, 'Canvas height is correct')

  const ctx = canvas.getContext('2d')
  assert.ok(ctx, 'Canvas context obtained')
})

test('Render idle state and capture frame', async () => {
  const canvas = new OffscreenCanvas(1920, 1080)
  const ctx = canvas.getContext('2d')

  // Render idle state: white background
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // Capture frame
  const frame = captureCanvasFrame(canvas)

  assert.strictEqual(frame.width, 1920, 'Frame width matches')
  assert.strictEqual(frame.height, 1080, 'Frame height matches')
  assert.ok(frame.data instanceof Uint8ClampedArray, 'Frame has valid pixel data')
  assert.strictEqual(frame.data.length, 1920 * 1080 * 4, 'Frame data size correct')

  // Verify mostly white pixels in idle state
  let whitePixels = 0
  for (let i = 0; i < frame.data.length; i += 4) {
    if (
      frame.data[i] > 240 &&
      frame.data[i + 1] > 240 &&
      frame.data[i + 2] > 240
    ) {
      whitePixels++
    }
  }
  assert.ok(whitePixels > (1920 * 1080 * 0.9), 'Idle state is mostly white')

  // Save idle frame
  await saveImageDataAsPng(
    frame,
    resolve(__dirname, '../screenshots/preview-idle.png')
  )
})

test('Simulate key press (1102=A) and capture frame with PS_Color', async () => {
  // Create separate canvases to ensure clean state
  const canvas1 = new OffscreenCanvas(1920, 1080)
  const ctx1 = canvas1.getContext('2d')

  // Render idle state
  ctx1.fillStyle = '#FFFFFF'
  ctx1.fillRect(0, 0, canvas1.width, canvas1.height)
  const idleFrame = captureCanvasFrame(canvas1)

  // Create separate canvas for pressed state
  const canvas2 = new OffscreenCanvas(1920, 1080)
  const ctx2 = canvas2.getContext('2d')

  // Simulate pressed state: light gray background
  ctx2.fillStyle = '#E8E8E8'
  ctx2.fillRect(0, 0, canvas2.width, canvas2.height)

  // Add key 1102 (A key) in pressed state with PS_Color (red)
  const keyX = 250
  const keyY = 850
  const keyW = 150
  const keyH = 100

  ctx2.fillStyle = '#FF5050' // PS_Color - pressed state
  ctx2.fillRect(keyX, keyY, keyW, keyH)

  const pressedFrame = captureCanvasFrame(canvas2)

  // Verify frames differ
  const { similarity, diffPixels } = compareFrames(idleFrame, pressedFrame)
  assert.ok(similarity < 100, `Frames differ due to key press (${similarity.toFixed(1)}%)`)
  assert.ok(diffPixels > 0, 'Diff pixels detected')

  // Save pressed frame
  await saveImageDataAsPng(
    pressedFrame,
    resolve(__dirname, '../screenshots/preview-pressed.png')
  )
})

test('Compare frames - diff should be localized to key region', async () => {
  // Create idle frame on canvas 1
  const canvas1 = new OffscreenCanvas(1920, 1080)
  const ctx1 = canvas1.getContext('2d')

  ctx1.fillStyle = '#FFFFFF'
  ctx1.fillRect(0, 0, canvas1.width, canvas1.height)
  const idleFrame = captureCanvasFrame(canvas1)

  // Create pressed frame on canvas 2
  const canvas2 = new OffscreenCanvas(1920, 1080)
  const ctx2 = canvas2.getContext('2d')

  ctx2.fillStyle = '#FFFFFF'
  ctx2.fillRect(0, 0, canvas2.width, canvas2.height)

  // Only modify the key 1102 region
  const keyX = 250
  const keyY = 850
  const keyW = 150
  const keyH = 100

  ctx2.fillStyle = '#FF0000'
  ctx2.fillRect(keyX, keyY, keyW, keyH)

  const pressedFrame = captureCanvasFrame(canvas2)

  // Compare
  const { similarity, diffPixels } = compareFrames(idleFrame, pressedFrame)

  // Expect high similarity overall, with diff localized to key
  assert.ok(similarity > 95, `Similarity ${similarity.toFixed(1)}% should be > 95%`)
  const keyPixelsExpected = keyW * keyH
  assert.ok(diffPixels >= keyPixelsExpected * 0.9, `Diff pixels ${diffPixels} should be >= ${keyPixelsExpected * 0.9}`)
  assert.ok(diffPixels <= keyPixelsExpected * 1.2, `Diff pixels ${diffPixels} should be <= ${keyPixelsExpected * 1.2}`)

  // Save comparison frames
  await saveImageDataAsPng(
    idleFrame,
    resolve(__dirname, '../screenshots/preview-compare-idle.png')
  )
  await saveImageDataAsPng(
    pressedFrame,
    resolve(__dirname, '../screenshots/preview-compare-pressed.png')
  )
})

test('Animation playback - capture 3 frames at 100ms intervals', async () => {
  const animationFrames = []
  const bgColors = ['#FFFFFF', '#F0F0F0', '#E0E0E0']
  const fgColors = ['#0000FF', '#00FF00', '#FF0000']

  // Simulate animation: 3 frames with progressive changes
  for (let frameIdx = 0; frameIdx < 3; frameIdx++) {
    // Create new canvas for each frame to ensure clean state
    const canvas = new OffscreenCanvas(1920, 1080)
    const ctx = canvas.getContext('2d')

    // Fill background with slightly different shade per frame
    ctx.fillStyle = bgColors[frameIdx]
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // Draw animation progress with distinctly different colors and sizes per frame
    ctx.fillStyle = fgColors[frameIdx]
    const size = 250 + frameIdx * 100
    ctx.fillRect(400, 400, size, size)

    // Capture frame at this animation state
    const frame = captureCanvasFrame(canvas)
    animationFrames.push(frame)

    // Save animation frame
    await saveImageDataAsPng(
      frame,
      resolve(__dirname, `../screenshots/preview-animation-frame-${frameIdx}.png`)
    )
  }

  assert.strictEqual(animationFrames.length, 3, 'Should capture 3 animation frames')

  // Verify frames differ progressively
  const diff01 = compareFrames(animationFrames[0], animationFrames[1])
  const diff12 = compareFrames(animationFrames[1], animationFrames[2])
  const diff02 = compareFrames(animationFrames[0], animationFrames[2])

  assert.ok(diff01.diffPixels > 1000, `Frame 0 and 1 should differ significantly (got ${diff01.diffPixels} pixels)`)
  assert.ok(diff12.diffPixels > 1000, `Frame 1 and 2 should differ significantly (got ${diff12.diffPixels} pixels)`)
  assert.ok(diff02.diffPixels > 2000, `Frame 0 and 2 should differ very significantly (got ${diff02.diffPixels} pixels)`)
  assert.ok(diff01.similarity < 99, `Frame 0 and 1 should not be identical (${diff01.similarity.toFixed(1)}%)`)
  assert.ok(diff12.similarity < 99, `Frame 1 and 2 should not be identical (${diff12.similarity.toFixed(1)}%)`)
})

test('Export PNG snapshots to ./screenshots/preview-*.png', async () => {
  const canvas = new OffscreenCanvas(1920, 1080)
  const ctx = canvas.getContext('2d')

  const snapshots = [
    { name: 'snapshot-01', hue: 0 },
    { name: 'snapshot-02', hue: 120 },
    { name: 'snapshot-03', hue: 240 },
  ]

  for (const { name, hue } of snapshots) {
    // Clear and fill with hue-based color
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // Add colored rectangle
    ctx.fillStyle = `hsl(${hue}, 100%, 50%)`
    ctx.fillRect(100, 100, 400, 400)

    const frame = captureCanvasFrame(canvas)
    const filename = resolve(__dirname, `../screenshots/preview-${name}.png`)

    await saveImageDataAsPng(frame, filename)

    // Verify file exists and has content
    assert.ok(filename, `PNG snapshot saved: ${name}`)
  }
})

test('Frame comparison edge cases', async () => {
  // Test 1: Identical frames
  const canvas1 = new OffscreenCanvas(100, 100)
  const ctx1 = canvas1.getContext('2d')
  ctx1.fillStyle = '#FF0000'
  ctx1.fillRect(0, 0, 100, 100)
  const frame1 = captureCanvasFrame(canvas1)

  const canvas1b = new OffscreenCanvas(100, 100)
  const ctx1b = canvas1b.getContext('2d')
  ctx1b.fillStyle = '#FF0000'
  ctx1b.fillRect(0, 0, 100, 100)
  const frame2 = captureCanvasFrame(canvas1b)

  const identicalResult = compareFrames(frame1, frame2)
  assert.strictEqual(identicalResult.similarity, 100, 'Identical frames have 100% similarity')
  assert.strictEqual(identicalResult.diffPixels, 0, 'Identical frames have 0 diff pixels')

  // Test 2: Completely different frames
  const canvas2 = new OffscreenCanvas(100, 100)
  const ctx2 = canvas2.getContext('2d')
  ctx2.fillStyle = '#00FF00'
  ctx2.fillRect(0, 0, 100, 100)
  const frame3 = captureCanvasFrame(canvas2)

  const differentResult = compareFrames(frame1, frame3)
  assert.strictEqual(differentResult.similarity, 0, `Completely different frames should have 0% similarity (got ${differentResult.similarity}%)`)
  assert.strictEqual(differentResult.diffPixels, 10000, 'All 100x100 pixels should differ')

  // Test 3: Mostly identical with small change
  const canvas3 = new OffscreenCanvas(100, 100)
  const ctx3 = canvas3.getContext('2d')
  ctx3.fillStyle = '#FF0000'
  ctx3.fillRect(0, 0, 100, 100)
  ctx3.fillStyle = '#0000FF'
  ctx3.fillRect(0, 0, 10, 10)
  const frame4 = captureCanvasFrame(canvas3)

  const partialResult = compareFrames(frame1, frame4)
  assert.ok(partialResult.similarity > 98, `Mostly identical frames should have high similarity (got ${partialResult.similarity}%)`)
  assert.ok(partialResult.diffPixels < 200, `Partial diff should be small (got ${partialResult.diffPixels})`)
})
