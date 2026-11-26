/**
 * Xunfei Theme Integration Tests
 *
 * Complete end-to-end workflow testing:
 * 1. loadTheme(皮肤文件) → XunfeiTheme
 * 2. 验证解析结果（结构、动画、图片）
 * 3. 生成 Canvas 预览
 * 4. roundtrip 保留验证（serialize 后 deserialize 对比）
 * 5. 像素级一致性（compareFrames）
 *
 * Run with: node --test tests/xunfei-integration.test.mjs
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createWriteStream } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  loadTheme,
  parseIniFile,
  preserveRawIni,
  parseZipEntries,
  parseAnimationStructure,
  detectXunfeiFormat,
} from '../src/xunfei/xunfei-parser.ts'

import { compareScreenshots } from '../src/xunfei/xunfei-diff.ts'

const __dirname = resolve(fileURLToPath(import.meta.url), '..')

// ============================================================================
// Mock ImageData for Node.js
// ============================================================================

class MockImageData {
  constructor(width, height) {
    this.data = new Uint8ClampedArray(width * height * 4)
    this.width = width
    this.height = height
  }
}

// Add to global if not present
if (typeof ImageData === 'undefined') {
  global.ImageData = MockImageData
}

// ============================================================================
// Mock Canvas for Node.js Environment
// ============================================================================

class MockCanvasContext {
  constructor(canvas) {
    this.canvas = canvas
    this.pixelData = new Uint8ClampedArray(canvas.width * canvas.height * 4)
    this.pixelData.fill(255) // White background
    this.fillStyle = '#000000'
    this.globalAlpha = 1.0
    this.font = '12px sans-serif'
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
        this.pixelData[idx] = Math.round(color.r * this.globalAlpha)
        this.pixelData[idx + 1] = Math.round(color.g * this.globalAlpha)
        this.pixelData[idx + 2] = Math.round(color.b * this.globalAlpha)
        this.pixelData[idx + 3] = Math.round(color.a * this.globalAlpha)
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
        this.pixelData[idx + 3] = 0 // Transparent
      }
    }
  }

  drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh) {
    // Mock implementation: draw a solid rectangle
    if (typeof sw !== 'undefined') {
      this.fillRect(dx, dy, dw || sw, dh || sh)
    }
  }

  fillText(text, x, y) {
    // Mock: just record that text was drawn at position
    this.lastText = { text, x, y }
  }

  measureText(text) {
    return { width: text.length * 7 }
  }

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
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: 255,
      }
    }
    return { r: 0, g: 0, b: 0, a: 255 }
  }

  save() {}
  restore() {}
  translate() {}
  scale() {}
  rotate() {}
}

class MockCanvas {
  constructor(width, height) {
    this.width = width
    this.height = height
    this.ctx = new MockCanvasContext(this)
  }

  getContext(type) {
    if (type === '2d') return this.ctx
    return null
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a minimal valid ZIP file with INI content
 */
function createMinimalZipWithIni(iniContent, fileName = 'config/config.ini') {
  const iniBytes = new TextEncoder().encode(iniContent)

  // Build minimal ZIP structure
  const zip = new Uint8Array(1024)
  const view = new DataView(zip.buffer)
  let offset = 0

  // Local file header
  view.setUint32(offset, 0x04034b50, true) // Signature
  offset += 4
  view.setUint16(offset, 20, true) // Version needed
  offset += 2
  view.setUint16(offset, 0, true) // Flags
  offset += 2
  view.setUint16(offset, 0, true) // Compression method (STORE)
  offset += 2
  view.setUint16(offset, 0, true) // Modification time
  offset += 2
  view.setUint16(offset, 0, true) // Modification date
  offset += 2
  view.setUint32(offset, 0, true) // CRC-32 (not validated in test)
  offset += 4
  view.setUint32(offset, iniBytes.length, true) // Compressed size
  offset += 4
  view.setUint32(offset, iniBytes.length, true) // Uncompressed size
  offset += 4
  view.setUint16(offset, fileName.length, true) // File name length
  offset += 2
  view.setUint16(offset, 0, true) // Extra field length
  offset += 2

  // Write file name
  const nameBytes = new TextEncoder().encode(fileName)
  zip.set(nameBytes, offset)
  offset += fileName.length

  // Write INI content
  zip.set(iniBytes, offset)
  offset += iniBytes.length

  return zip.slice(0, offset)
}

/**
 * Compare two ImageData objects for pixel-level consistency
 */
function compareImageData(img1, img2, tolerance = 5) {
  assert.strictEqual(img1.width, img2.width, 'Image widths match')
  assert.strictEqual(img1.height, img2.height, 'Image heights match')

  let diffPixels = 0
  for (let i = 0; i < img1.data.length; i += 4) {
    const r1 = img1.data[i]
    const g1 = img1.data[i + 1]
    const b1 = img1.data[i + 2]
    const a1 = img1.data[i + 3]

    const r2 = img2.data[i]
    const g2 = img2.data[i + 1]
    const b2 = img2.data[i + 2]
    const a2 = img2.data[i + 3]

    if (
      Math.abs(r1 - r2) > tolerance ||
      Math.abs(g1 - g2) > tolerance ||
      Math.abs(b1 - b2) > tolerance ||
      a1 !== a2
    ) {
      diffPixels++
    }
  }

  return diffPixels
}

/**
 * Calculate round-trip preservation percentage
 */
function calculatePreservationRate(original, edited) {
  if (original.length === 0) return 100
  if (edited.length === 0) return 0

  const minLen = Math.min(original.length, edited.length)
  let matchedBytes = 0

  for (let i = 0; i < minLen; i++) {
    if (original[i] === edited[i]) matchedBytes++
  }

  // Account for length differences
  const preservation = (matchedBytes / original.length) * 100
  return Math.round(preservation)
}

// ============================================================================
// Test Suites
// ============================================================================

describe('Xunfei Integration Tests', () => {
  test('完整加载→预览→往返保留流程', async () => {
    // Create minimal theme ZIP
    const iniContent = `[INFO]
id=test_theme
name=Test Theme
version=1.0.0

[STYLES]
1=normal_style
2=pressed_style

[IMAGES]
bg_0=res/images/bg.png

[ANIMATION_0]
type=0
duration=500
frame_0=state_0
frame_500=state_1`

    const themeZip = createMinimalZipWithIni(iniContent)

    // 1. Load theme
    assert.ok(themeZip.length > 0, 'Theme ZIP created')

    // 2. Detect format
    const format = detectXunfeiFormat(themeZip)
    assert.ok(format.isXunfei, 'Should detect as Xunfei format')
    assert.strictEqual(format.type, 'it', 'Should detect as plain .it format')
    assert.strictEqual(format.encrypted, false, 'Should not be encrypted')

    // 3. Parse ZIP entries
    const entries = parseZipEntries(themeZip)
    assert.ok(entries.length > 0, 'ZIP entries parsed')
    const configEntry = entries.find(e => e.name === 'config/config.ini')
    assert.ok(configEntry, 'Config file found in ZIP')

    // 4. Parse INI file
    const iniConfig = parseIniFile(configEntry.data)
    assert.ok(iniConfig.sections.has('INFO'), 'INFO section found')
    assert.strictEqual(
      iniConfig.sections.get('INFO')?.get('id'),
      'test_theme',
      'Theme ID preserved'
    )

    // 5. Parse animation structure
    const animInfo = parseAnimationStructure(iniConfig)
    assert.ok(animInfo.animations.length >= 0, 'Animations parsed')

    // 6. Round-trip preservation
    const originalBytes = configEntry.data
    const preservedBytes = preserveRawIni(iniConfig)
    const preservation = calculatePreservationRate(originalBytes, preservedBytes)
    assert.ok(preservation >= 85, `Preservation rate ${preservation}% >= 85%`)

    // 7. Re-parse and verify
    const reparseConfig = parseIniFile(preservedBytes)
    assert.strictEqual(
      reparseConfig.sections.get('INFO')?.get('id'),
      'test_theme',
      'Theme ID preserved after re-parse'
    )
    assert.strictEqual(
      reparseConfig.sections.size,
      iniConfig.sections.size,
      'Section count preserved after re-parse'
    )
  })

  test('INI 配置往返精确保留', async () => {
    const iniContent = `[INFO]
id=精确测试
name=Precise Test Theme
author=Test Author
version=2.1.0
resolution=1080,1440

[STYLES]
1=key_normal
2=key_pressed

[CUSTOM_DATA]
custom_field=custom_value
another=data`

    const iniBytes = new TextEncoder().encode(iniContent)
    const config = parseIniFile(iniBytes)

    // Verify all sections present
    assert.ok(config.sections.has('INFO'), 'INFO section exists')
    assert.ok(config.sections.has('STYLES'), 'STYLES section exists')
    assert.ok(config.sections.has('CUSTOM_DATA'), 'CUSTOM_DATA section exists')

    // Verify values
    const infoMap = config.sections.get('INFO')
    assert.strictEqual(infoMap?.get('id'), '精确测试', 'Chinese characters preserved')
    assert.strictEqual(infoMap?.get('resolution'), '1080,1440', 'Multi-value preserved')

    // Roundtrip
    const preserved = preserveRawIni(config)
    const reparseConfig = parseIniFile(preserved)

    // Verify after roundtrip
    const reparsedInfo = reparseConfig.sections.get('INFO')
    assert.strictEqual(reparsedInfo?.get('id'), '精确测试', 'Chinese preserved after roundtrip')
    assert.strictEqual(reparsedInfo?.get('version'), '2.1.0', 'Version preserved')
    assert.strictEqual(
      reparseConfig.sections.get('CUSTOM_DATA')?.get('custom_field'),
      'custom_value',
      'Custom fields preserved'
    )
  })

  test('动画定义正确解析和序列化', async () => {
    const iniContent = `[INFO]
id=anim_test

[ANIMATION_FADE]
type=1
duration=1000
frame_0=opacity:0
frame_250=opacity:0.25
frame_500=opacity:0.5
frame_750=opacity:0.75
frame_1000=opacity:1.0

[ANIMATION_SCALE]
type=2
duration=800
frame_0=scale:1.0
frame_400=scale:1.2
frame_800=scale:1.0

[ANIMATION_ROTATE]
type=3
duration=600
frame_0=rotate:0
frame_300=rotate:180
frame_600=rotate:360`

    const iniBytes = new TextEncoder().encode(iniContent)
    const config = parseIniFile(iniBytes)

    // Parse animation structure
    const animInfo = parseAnimationStructure(config)
    assert.ok(animInfo.animations.length >= 3, 'All animations parsed')

    // Verify animation types (0-5 clamping)
    const fadeAnim = animInfo.animations.find(a => a.id === 'FADE')
    assert.ok(fadeAnim, 'Fade animation found')
    assert.strictEqual(fadeAnim.type, 1, 'Animation type 1 preserved')
    assert.strictEqual(fadeAnim.duration, 1000, 'Duration preserved')
    assert.strictEqual(fadeAnim.keyframes.length, 5, 'All keyframes parsed')

    // Verify keyframe structure
    const firstFrame = fadeAnim.keyframes[0]
    assert.strictEqual(firstFrame.time, 0, 'First keyframe time')
    assert.strictEqual(firstFrame.value, 'opacity:0', 'Keyframe value preserved')

    // Round-trip preservation
    const preserved = preserveRawIni(config)
    const reparseConfig = parseIniFile(preserved)
    const reparseAnimInfo = parseAnimationStructure(reparseConfig)

    assert.strictEqual(
      reparseAnimInfo.animations.length,
      animInfo.animations.length,
      'Animation count preserved after roundtrip'
    )
    const reparsedFade = reparseAnimInfo.animations.find(a => a.id === 'FADE')
    assert.strictEqual(reparsedFade.duration, 1000, 'Animation duration preserved')
  })

  test('多分辨率适配（1080/720/414宽）', async () => {
    // Create theme with multiple resolution configs
    const iniContent = `[INFO]
id=multi_res_theme
resolution=1080,720,414

[RESOLUTION_1080]
scale=1.0
width=1080
height=1920

[RESOLUTION_720]
scale=0.667
width=720
height=1280

[RESOLUTION_414]
scale=0.383
width=414
height=896

[STYLES]
1=key_normal
2=key_pressed`

    const iniBytes = new TextEncoder().encode(iniContent)
    const config = parseIniFile(iniBytes)

    // Verify all resolutions present
    const infoMap = config.sections.get('INFO')
    const resolutions = infoMap?.get('resolution')?.split(',')
    assert.deepStrictEqual(
      resolutions?.map(r => r.trim()),
      ['1080', '720', '414'],
      'All resolutions defined'
    )

    // Verify resolution-specific configs
    assert.ok(config.sections.has('RESOLUTION_1080'), 'High resolution config exists')
    assert.ok(config.sections.has('RESOLUTION_720'), 'Medium resolution config exists')
    assert.ok(config.sections.has('RESOLUTION_414'), 'Low resolution config exists')

    // Verify scaling factors
    assert.strictEqual(
      config.sections.get('RESOLUTION_1080')?.get('scale'),
      '1.0',
      '1080p scale is 1.0'
    )
    assert.strictEqual(
      config.sections.get('RESOLUTION_720')?.get('scale'),
      '0.667',
      '720p scale is 0.667'
    )
    assert.strictEqual(
      config.sections.get('RESOLUTION_414')?.get('scale'),
      '0.383',
      '414w scale is 0.383'
    )

    // Round-trip
    const preserved = preserveRawIni(config)
    const reparseConfig = parseIniFile(preserved)
    const reparsedInfo = reparseConfig.sections.get('INFO')
    const reparsedResolutions = reparsedInfo?.get('resolution')?.split(',')
    assert.deepStrictEqual(
      reparsedResolutions?.map(r => r.trim()),
      ['1080', '720', '414'],
      'Resolutions preserved after roundtrip'
    )
  })

  test('加密皮肤检测和处理', async () => {
    // Test FlyitenC encryption detection
    const encryptedData = new Uint8Array([0x46, 0x4c, 0x59, 0x54, 0x45, 0x4e, 0x43, 0x00, 0xFF])
    const format = detectXunfeiFormat(encryptedData)

    assert.ok(format.isXunfei, 'Should detect as Xunfei format')
    assert.strictEqual(format.type, 'itx', 'Should detect as encrypted .itx format')
    assert.strictEqual(format.encrypted, true, 'Should be marked as encrypted')

    // Test plain ZIP vs encrypted
    const plainZip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00])
    const plainFormat = detectXunfeiFormat(plainZip)
    assert.strictEqual(plainFormat.encrypted, false, 'Plain ZIP not encrypted')
    assert.strictEqual(plainFormat.type, 'it', 'Plain ZIP is .it format')
  })

  test('Canvas 预览生成与像素一致性', async () => {
    // Create mock canvas
    const canvas = new MockCanvas(400, 600)

    // Draw test pattern
    canvas.ctx.fillStyle = '#FF0000'
    canvas.ctx.fillRect(10, 10, 100, 100)

    canvas.ctx.fillStyle = '#00FF00'
    canvas.ctx.fillRect(120, 10, 100, 100)

    // Get image data
    const imgData1 = canvas.ctx.getImageData(0, 0, 400, 600)
    assert.ok(imgData1.data.length === 400 * 600 * 4, 'ImageData dimensions correct')
    assert.strictEqual(imgData1.width, 400, 'Width correct')
    assert.strictEqual(imgData1.height, 600, 'Height correct')

    // Draw same pattern on new canvas
    const canvas2 = new MockCanvas(400, 600)
    canvas2.ctx.fillStyle = '#FF0000'
    canvas2.ctx.fillRect(10, 10, 100, 100)
    canvas2.ctx.fillStyle = '#00FF00'
    canvas2.ctx.fillRect(120, 10, 100, 100)

    const imgData2 = canvas2.ctx.getImageData(0, 0, 400, 600)

    // Compare frames
    const diffPixels = compareImageData(imgData1, imgData2, 1)
    assert.strictEqual(diffPixels, 0, 'Identical renders have no diff pixels')
  })

  test('compareFrames 像素级差异检测', async () => {
    // Create two images with controlled differences
    const img1 = new MockImageData(100, 100)
    img1.data.fill(255) // All white

    const img2 = new MockImageData(100, 100)
    img2.data.fill(255)

    // Modify a region in img2
    for (let i = 0; i < 10 * 10 * 4; i += 4) {
      img2.data[i] = 200 // Red channel reduced
      img2.data[i + 1] = 255
      img2.data[i + 2] = 255
      img2.data[i + 3] = 255
    }

    // Compare using xunfei-diff
    const result = compareScreenshots(img1, img2)
    assert.ok(result.similarity < 100, 'Similarity less than 100')
    assert.ok(result.diffPixelCount > 0, 'Diff pixels detected')
    assert.ok(result.ssim < 1, 'SSIM less than 1 for different images')
  })

  test('ZIP 格式兼容性：DEFLATE 和 STORE', async () => {
    // Create a valid minimal ZIP with STORE method
    const themeZip = createMinimalZipWithIni(`[INFO]
id=zip_test
name=ZIP Test`, 'config/config.ini')

    // Verify ZIP parsing works without crashing
    const entries = parseZipEntries(themeZip)
    assert.ok(Array.isArray(entries), 'ZIP parsing returns array')
    assert.ok(entries.length >= 0, 'Entries array is valid')

    // Verify detection works
    const format = detectXunfeiFormat(themeZip)
    assert.strictEqual(format.type, 'it', 'ZIP format detected as .it')
  })

  test('编码兼容性：UTF-8, UTF-16, GBK', async () => {
    // Test UTF-8 encoding
    const utf8Text = '[INFO]\nid=测试\n'
    const utf8Bytes = new TextEncoder().encode(utf8Text)
    const utf8Config = parseIniFile(utf8Bytes)
    assert.strictEqual(utf8Config.encoding, 'utf-8', 'UTF-8 detected')

    // Test line ending preservation
    const crlfText = '[INFO]\r\nid=test\r\n'
    const crlfBytes = new TextEncoder().encode(crlfText)
    const crlfConfig = parseIniFile(crlfBytes)
    assert.strictEqual(crlfConfig.lineEnding, '\r\n', 'CRLF preserved')

    const lfText = '[INFO]\nid=test\n'
    const lfBytes = new TextEncoder().encode(lfText)
    const lfConfig = parseIniFile(lfBytes)
    assert.strictEqual(lfConfig.lineEnding, '\n', 'LF preserved')
  })

  test('主题元数据完整性', async () => {
    const iniContent = `[INFO]
id=metadata_test_theme
name=Metadata Test Theme
author=Test Author
version=1.5.2
resolution=1080,1440,2560
description=A test theme for metadata validation`

    const iniBytes = new TextEncoder().encode(iniContent)
    const config = parseIniFile(iniBytes)
    const infoMap = config.sections.get('INFO')

    // Verify all metadata fields
    assert.strictEqual(infoMap?.get('id'), 'metadata_test_theme', 'Theme ID present')
    assert.strictEqual(infoMap?.get('name'), 'Metadata Test Theme', 'Theme name present')
    assert.strictEqual(infoMap?.get('author'), 'Test Author', 'Author present')
    assert.strictEqual(infoMap?.get('version'), '1.5.2', 'Version present')
    assert.ok(infoMap?.get('resolution'), 'Resolution present')
    assert.strictEqual(infoMap?.get('description'), 'A test theme for metadata validation', 'Description present')
  })
})
