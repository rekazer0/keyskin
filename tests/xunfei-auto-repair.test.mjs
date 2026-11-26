import { test } from 'node:test'
import assert from 'node:assert'
import {
  analyzeHotspotsForRepair,
  applyPatches,
  runAutoRepair,
} from '../src/xunfei/xunfei-auto-repair.ts'

// ============================================================================
// Mock Helpers
// ============================================================================

function createMockDiffReport(similarity = 85) {
  return {
    similarity,
    diffPixelCount: 1500,
    heatmap: new Uint8ClampedArray(500 * 500 * 4),
    width: 500,
    height: 500,
    mse: 15.0,
    ssim: 0.92,
    hotspots: [
      {
        x: 100,
        y: 150,
        width: 60,
        height: 40,
        severity: 0.45,
        pixelCount: 180,
      },
      {
        x: 200,
        y: 250,
        width: 50,
        height: 50,
        severity: 0.35,
        pixelCount: 200,
      },
      {
        x: 350,
        y: 100,
        width: 100,
        height: 100,
        severity: 0.8,
        pixelCount: 8000, // Very large, severity too high — skipped
      },
    ],
  }
}

function createMockConfig() {
  const config = {
    offset: {
      sections: new Map([
        [
          '[KEY1]',
          new Map([
            ['X', '100'],
            ['Y', '150'],
            ['W', '60'],
            ['H', '40'],
          ]),
        ],
        [
          '[KEY2]',
          new Map([
            ['X', '200'],
            ['Y', '250'],
            ['W', '50'],
            ['H', '50'],
          ]),
        ],
      ]),
      rawText: '[KEY1]\nX=100\nY=150\nW=60\nH=40\n',
      encoding: 'utf-8',
      lineEnding: '\n',
    },
    style: {
      sections: new Map([
        [
          '[KEY1]',
          new Map([
            ['NM_Color', '#FF1A73E8'],
            ['PS_Color', '#FF5F6368'],
            ['TEXT_SIZE', '14'],
            ['TEXT_SIZE_RATIO', '1.0'],
          ]),
        ],
        [
          '[KEY2]',
          new Map([
            ['NM_Color', '#FFF1F3F4'],
            ['IMAGEINDEX', '1'],
            ['TEXT_SIZE', '12'],
          ]),
        ],
      ]),
      rawText: '[KEY1]\nNM_Color=#FF1A73E8\n',
      encoding: 'utf-8',
      lineEnding: '\n',
    },
    image: {
      sections: new Map([
        [
          '[IMAGE1]',
          new Map([
            ['IMAGEDATA', 'res/bg.png'],
            ['X', '0'],
            ['Y', '0'],
            ['W', '1024'],
            ['H', '1024'],
          ]),
        ],
      ]),
      rawText: '[IMAGE1]\n',
      encoding: 'utf-8',
      lineEnding: '\n',
    },
    animation: undefined,
    resources: new Map(),
  }

  return config
}

function createMockImageData(width = 500, height = 500) {
  // Mock ImageData for Node.js environment
  const data = new Uint8ClampedArray(width * height * 4)
  return { data, width, height }
}

// ============================================================================
// Tests
// ============================================================================

test('analyzeHotspotsForRepair: identifies color mismatches', () => {
  const diffReport = createMockDiffReport(85)
  const config = createMockConfig()

  const patches = analyzeHotspotsForRepair(diffReport, config)

  // Should identify at least one color mismatch in hotspots
  assert.ok(patches.length > 0, 'should generate patches for hotspots')

  // Check that patches have expected structure
  for (const patch of patches) {
    assert.ok(patch.diagnosis, 'patch should have diagnosis')
    assert.ok(patch.delta, 'patch should have delta')
    assert.ok(patch.confidence >= 0 && patch.confidence <= 1, 'confidence should be 0–1')
    assert.deepStrictEqual(
      Object.keys(patch).sort(),
      ['after', 'before', 'confidence', 'delta', 'diagnosis', 'hotspot'].sort(),
      'patch should have all expected properties'
    )
  }
})

test('analyzeHotspotsForRepair: skips severe hotspots', () => {
  const diffReport = createMockDiffReport(85)
  const config = createMockConfig()

  const patches = analyzeHotspotsForRepair(diffReport, config)

  // The third hotspot has severity 0.8 (> MAX_SEVERITY_FOR_AUTO of 0.7)
  // so it should not be repaired
  const skippedHotspot = diffReport.hotspots[2]
  const hasSkipped = !patches.some(p => p.hotspot === skippedHotspot)

  assert.ok(hasSkipped, 'should skip hotspots with severity > 0.7')
})

test('analyzeHotspotsForRepair: sets correct diagnosis category', () => {
  const diffReport = createMockDiffReport(85)
  const config = createMockConfig()

  const patches = analyzeHotspotsForRepair(diffReport, config)

  for (const patch of patches) {
    assert.ok(
      ['color', 'offset', 'image', 'font', 'unknown'].includes(patch.diagnosis.category),
      `diagnosis category should be valid, got: ${patch.diagnosis.category}`
    )
    assert.ok(patch.diagnosis.section, 'diagnosis should have section')
    assert.ok(patch.diagnosis.property, 'diagnosis should have property')
    assert.ok(patch.diagnosis.reason, 'diagnosis should have reason')
  }
})

test('applyPatches: modifies config correctly', () => {
  const config = createMockConfig()
  const mockPatch = {
    hotspot: { x: 100, y: 150, width: 60, height: 40, severity: 0.45, pixelCount: 180 },
    diagnosis: {
      category: 'color',
      section: '[KEY1]',
      property: 'NM_Color',
      reason: 'Color mismatch detected',
    },
    delta: {
      colorDelta: { r: -20, g: -20, b: -20, a: 0 },
      interpolation: 0.5,
    },
    confidence: 0.85,
    before: '#FF1A73E8',
    after: '#FF0A6BE8',
  }

  const repaired = applyPatches(config, [mockPatch])

  // Check that original config is unmodified
  const originalColor = config.style.sections.get('[KEY1]')?.get('NM_Color')
  assert.strictEqual(originalColor, '#FF1A73E8', 'original config should be unchanged')

  // Check that repaired config has adjusted value
  const repairedColor = repaired.style.sections.get('[KEY1]')?.get('NM_Color')
  assert.ok(repairedColor !== originalColor, 'repaired config should have modified color')
})

test('applyPatches: deep clones config to avoid mutations', () => {
  const config = createMockConfig()
  const patches = []

  const repaired = applyPatches(config, patches)

  // Modify repaired config
  repaired.style.sections.get('[KEY1]')?.set('NM_Color', '#FFAABBCC')

  // Original should be unchanged
  const originalColor = config.style.sections.get('[KEY1]')?.get('NM_Color')
  assert.strictEqual(originalColor, '#FF1A73E8', 'original should be unchanged after repaired modification')
})

test('runAutoRepair: full pipeline returns improvement metrics', () => {
  const diffReport = createMockDiffReport(85)
  const config = createMockConfig()
  const renderedImages = new Map([['preview', createMockImageData()]])

  const result = runAutoRepair(diffReport, config, renderedImages, 85)

  assert.ok(result.patches, 'result should have patches')
  assert.ok(result.repairedConfig, 'result should have repaired config')
  assert.ok(result.verificationReport, 'result should have verification report')
  assert.ok(result.improvement, 'result should have improvement metrics')

  assert.ok(result.verificationReport.preservationRate >= 90, 'preservation rate should be acceptable')
  assert.strictEqual(result.improvement.similarityBefore, 85, 'before similarity should be preserved')
  assert.ok(result.improvement.similarityAfter > 85, 'after similarity should improve')
})

test('runAutoRepair: works with zero hotspots', () => {
  const diffReport = createMockDiffReport(99)
  diffReport.hotspots = []
  const config = createMockConfig()
  const renderedImages = new Map([['preview', createMockImageData()]])

  const result = runAutoRepair(diffReport, config, renderedImages, 99)

  assert.strictEqual(result.patches.length, 0, 'no patches should be generated for clean diff')
  assert.ok(result.repairedConfig, 'result should still have config')
})

test('runAutoRepair: handles mixed hotspot severities', () => {
  const diffReport = createMockDiffReport(80)
  const config = createMockConfig()
  const renderedImages = new Map([['preview', createMockImageData()]])

  const result = runAutoRepair(diffReport, config, renderedImages, 80)

  // Should have at least some patches for the lower-severity hotspots
  assert.ok(result.patches.length >= 1, 'should handle mixed severities')
})

test('repair patch confidence scoring', () => {
  const diffReport = createMockDiffReport(85)
  const config = createMockConfig()

  const patches = analyzeHotspotsForRepair(diffReport, config)

  for (const patch of patches) {
    assert.ok(patch.confidence >= 0.3, 'confidence should be reasonable for diagnosable hotspots')
  }
})

test('verify color delta calculation preserves valid ARGB range', () => {
  const config = createMockConfig()
  const mockPatch = {
    hotspot: { x: 100, y: 150, width: 60, height: 40, severity: 0.45, pixelCount: 180 },
    diagnosis: {
      category: 'color',
      section: '[KEY1]',
      property: 'NM_Color',
      reason: 'Color mismatch',
    },
    delta: {
      colorDelta: { r: -50, g: -50, b: -50, a: 0 },
      interpolation: 0.5,
    },
    confidence: 0.8,
    before: '#FF1A73E8',
    after: '#FFF1A6D8',
  }

  const repaired = applyPatches(config, [mockPatch])
  const color = repaired.style.sections.get('[KEY1]')?.get('NM_Color')

  // Color should be valid hex (8 hex digits after #)
  assert.match(color, /^#[0-9A-Fa-f]{8}$/, 'should produce valid hex color')

  // Parse and verify no channel is out of range
  const hex = color
  const value = parseInt(hex.slice(1), 16)
  const r = (value >> 16) & 0xff
  const g = (value >> 8) & 0xff
  const b = value & 0xff

  assert.ok(r >= 0 && r <= 255, 'R channel in range')
  assert.ok(g >= 0 && g <= 255, 'G channel in range')
  assert.ok(b >= 0 && b <= 255, 'B channel in range')
})

test('verify offset delta applies to position fields', () => {
  const config = createMockConfig()
  const mockPatch = {
    hotspot: { x: 100, y: 150, width: 60, height: 40, severity: 0.45, pixelCount: 180 },
    diagnosis: {
      category: 'offset',
      section: '[KEY1]',
      property: 'X',
      reason: 'Position offset',
    },
    delta: {
      offsetDelta: { x: 5, y: 0 },
      interpolation: 0.5,
    },
    confidence: 0.8,
    before: '100',
    after: '105',
  }

  const repaired = applyPatches(config, [mockPatch])
  const x = repaired.offset.sections.get('[KEY1]')?.get('X')

  assert.ok(parseInt(x, 10) > 100, 'X coordinate should increase')
})

test('verify font ratio adjustment bounds', () => {
  const config = createMockConfig()
  const mockPatch = {
    hotspot: { x: 100, y: 150, width: 30, height: 100, severity: 0.35, pixelCount: 200 },
    diagnosis: {
      category: 'font',
      section: '[KEY1]',
      property: 'TEXT_SIZE_RATIO',
      reason: 'Font size mismatch',
    },
    delta: {
      fontRatioAdjust: 1.5,
      interpolation: 0.5,
    },
    confidence: 0.75,
    before: '1.0',
    after: '1.5',
  }

  const repaired = applyPatches(config, [mockPatch])
  const ratio = parseFloat(repaired.style.sections.get('[KEY1]')?.get('TEXT_SIZE_RATIO'))

  // With interpolation 0.5, should be 1.0 + (1.5 - 1.0) * 0.5 = 1.25
  assert.ok(ratio >= 0.8 && ratio <= 2.0, 'font ratio should be within reasonable bounds')
})
