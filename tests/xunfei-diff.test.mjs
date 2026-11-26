import { test } from 'node:test'
import assert from 'node:assert'
import { compareScreenshots } from '../src/xunfei/xunfei-diff.ts'

// ============================================================================
// Test Helpers
// ============================================================================

function createImageData(width, height, fillValue = 0) {
  const data = new Uint8ClampedArray(width * height * 4)
  if (fillValue !== 0) {
    data.fill(fillValue)
  }
  return { data, width, height }
}

function setPixel(imageData, x, y, r, g, b, a = 255) {
  const idx = (y * imageData.width + x) * 4
  imageData.data[idx] = r
  imageData.data[idx + 1] = g
  imageData.data[idx + 2] = b
  imageData.data[idx + 3] = a
}

// ============================================================================
// Tests
// ============================================================================

test('compareScreenshots: identical images', () => {
  const img1 = createImageData(10, 10, 128)
  const img2 = createImageData(10, 10, 128)

  const result = compareScreenshots(img1, img2)

  assert.strictEqual(result.similarity, 100, 'similarity should be 100')
  assert.strictEqual(result.diffPixelCount, 0, 'diff pixel count should be 0')
  assert.strictEqual(result.mse, 0, 'MSE should be 0')
  assert.strictEqual(result.ssim, 1, 'SSIM should be 1')
  assert.strictEqual(result.width, 10, 'width preserved')
  assert.strictEqual(result.height, 10, 'height preserved')
  assert.ok(result.heatmap instanceof Uint8ClampedArray, 'heatmap is Uint8ClampedArray')
})

test('compareScreenshots: within tolerance (anti-aliasing)', () => {
  const img1 = createImageData(10, 10, 100)
  const img2 = createImageData(10, 10, 100)

  // Set one pixel with difference within ±5% tolerance (12.75)
  setPixel(img1, 5, 5, 100, 100, 100, 255)
  setPixel(img2, 5, 5, 110, 110, 110, 255) // diff = 10, within 12.75

  const result = compareScreenshots(img1, img2)

  assert.strictEqual(result.diffPixelCount, 0, 'within tolerance should not count as diff')
  assert.ok(result.similarity > 95, 'similarity should be very high')
})

test('compareScreenshots: exceeds tolerance', () => {
  const img1 = createImageData(10, 10, 100)
  const img2 = createImageData(10, 10, 100)

  // Set one pixel with difference exceeding ±5% tolerance
  setPixel(img1, 5, 5, 100, 100, 100, 255)
  setPixel(img2, 5, 5, 130, 100, 100, 255) // R diff = 30, exceeds 12.75

  const result = compareScreenshots(img1, img2)

  assert.ok(result.diffPixelCount > 0, 'diff pixel count should be > 0')
  assert.ok(result.similarity < 100, 'similarity should be less than 100')
  assert.ok(result.mse > 0, 'MSE should be > 0')
})

test('compareScreenshots: alpha channel mismatch', () => {
  const img1 = createImageData(10, 10, 100)
  const img2 = createImageData(10, 10, 100)

  setPixel(img1, 5, 5, 100, 100, 100, 255)
  setPixel(img2, 5, 5, 100, 100, 100, 200) // alpha diff = 55

  const result = compareScreenshots(img1, img2)

  assert.ok(result.diffPixelCount > 0, 'alpha mismatch should count as diff')
})

test('compareScreenshots: heatmap generation', () => {
  const img1 = createImageData(5, 5, 100)
  const img2 = createImageData(5, 5, 100)

  setPixel(img1, 2, 2, 100, 100, 100, 255)
  setPixel(img2, 2, 2, 150, 100, 100, 255) // R diff = 50

  const result = compareScreenshots(img1, img2)

  // Heatmap should have red channel set to diff magnitude * 2
  const heatmapIdx = (2 * 5 + 2) * 4
  assert.ok(result.heatmap[heatmapIdx] > 0, 'red channel should encode diff')
  assert.strictEqual(result.heatmap[heatmapIdx + 1], 0, 'green should be 0')
  assert.strictEqual(result.heatmap[heatmapIdx + 2], 0, 'blue should be 0')
  assert.strictEqual(result.heatmap[heatmapIdx + 3], 255, 'alpha should be 255')
})

test('compareScreenshots: dimension mismatch throws', () => {
  const img1 = createImageData(10, 10)
  const img2 = createImageData(5, 5)

  assert.throws(
    () => compareScreenshots(img1, img2),
    /dimensions mismatch/i,
    'should throw on size mismatch'
  )
})

test('compareScreenshots: SSIM calculation', () => {
  const img1 = createImageData(50, 50, 128)
  const img2 = createImageData(50, 50, 128)

  let result1 = compareScreenshots(img1, img2)
  assert.strictEqual(result1.ssim, 1, 'identical images have SSIM=1')

  // Add some variation
  for (let i = 0; i < 50; i++) {
    setPixel(img2, Math.floor(Math.random() * 50), Math.floor(Math.random() * 50), 150, 128, 128)
  }

  let result2 = compareScreenshots(img1, img2)
  assert.ok(result2.ssim < 1, 'varied image has SSIM < 1')
  assert.ok(result2.ssim > 0.5, 'SSIM should still be reasonable')
})
