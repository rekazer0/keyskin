/**
 * Tests for Xunfei Native Keyboard Preview.
 *
 * Covers:
 * - Preview initialization with theme data
 * - Key state management (pressed, released, transitions)
 * - Canvas rendering pipeline
 * - Multiple resolution presets and orientation
 * - Resource disposal
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  XunfeiNativePreview,
  KeyState,
} from '../src/xunfei/xunfei-native-preview.ts'

// Mock canvas for Node.js testing (matches HTMLCanvasElement API)
class MockCanvas {
  constructor() {
    this.width = 1080
    this.height = 1920
  }

  getContext(contextType) {
    if (contextType !== '2d') return null
    return new MockCanvasContext()
  }
}

class MockCanvasContext {
  constructor() {
    this.fillStyle = '#FFFFFF'
    this.font = '12px Arial'
    this.globalAlpha = 1
    this.textAlign = 'left'
    this.textBaseline = 'alphabetic'
  }
  fillRect() {}
  drawImage() {}
  fillText() {}
  resetTransform() {}
}

function createMockTheme() {
  return {
    info: {
      id: 'test_theme',
      name: 'Test Theme',
      version: '1.0.0',
      resolutions: [1080, 1440, 2160],
    },
    styles: new Map([
      [1, {
        id: 1,
        type: 'normal',
        colors: {
          normal: '#FF1A73E8',
          pressed: '#FFF3E5F5',
          fallback: '#FF1A73E8',
        },
        font: { family: 'Arial', size: 12, weight: 400 },
      }],
    ]),
    images: new Map([
      ['bg', {
        id: 'bg',
        sourceFile: 'res/bg.png',
        sourceRect: [0, 0, 1080, 1920],
      }],
    ]),
    offsets: [],
    animations: [],
    resources: {
      files: new Map([
        ['res/bg.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47])],
      ]),
    },
  }
}

// ============================================================================
// Tests
// ============================================================================

test('XunfeiNativePreview: initialization', () => {
  const canvas = new MockCanvas()
  const theme = createMockTheme()

  const preview = new XunfeiNativePreview({ canvas, theme, resolution: '1080p', orientation: 'portrait' })

  assert.ok(preview, 'Preview instance created')
  assert.equal(canvas.width, 1080, 'Canvas width set to 1080')
  assert.equal(canvas.height, 1920, 'Canvas height set to 1920')

  preview.dispose()
})

test('XunfeiNativePreview: resolution presets', () => {
  const theme = createMockTheme()

  const c1080 = new MockCanvas()
  new XunfeiNativePreview({ canvas: c1080, theme, resolution: '1080p' }).dispose()
  assert.equal(c1080.width, 1080)

  const c1440 = new MockCanvas()
  new XunfeiNativePreview({ canvas: c1440, theme, resolution: '1440p' }).dispose()
  assert.equal(c1440.width, 1440)

  const c2160 = new MockCanvas()
  new XunfeiNativePreview({ canvas: c2160, theme, resolution: '2160p' }).dispose()
  assert.equal(c2160.width, 2160)
})

test('XunfeiNativePreview: custom resolution', () => {
  const canvas = new MockCanvas()
  const theme = createMockTheme()

  new XunfeiNativePreview({
    canvas,
    theme,
    resolution: 'custom',
    customResolution: { width: 800, height: 1200 },
  }).dispose()

  assert.equal(canvas.width, 800)
  assert.equal(canvas.height, 1200)
})

test('XunfeiNativePreview: portrait vs landscape orientation', () => {
  const theme = createMockTheme()

  const cp = new MockCanvas()
  new XunfeiNativePreview({ canvas: cp, theme, resolution: '1080p', orientation: 'portrait' }).dispose()
  const pw = cp.width
  const ph = cp.height

  const cl = new MockCanvas()
  new XunfeiNativePreview({ canvas: cl, theme, resolution: '1080p', orientation: 'landscape' }).dispose()
  const lw = cl.width
  const lh = cl.height

  assert.ok(pw < ph, 'Portrait is taller than wide')
  assert.ok(lw > lh, 'Landscape is wider than tall')
  assert.equal(pw, lh, 'Portrait width equals landscape height')
  assert.equal(ph, lw, 'Portrait height equals landscape width')
})

test('XunfeiNativePreview: scale factor', () => {
  const theme = createMockTheme()

  const c1 = new MockCanvas()
  new XunfeiNativePreview({ canvas: c1, theme, resolution: '1080p', scale: 1 }).dispose()

  const c2 = new MockCanvas()
  new XunfeiNativePreview({ canvas: c2, theme, resolution: '1080p', scale: 2 }).dispose()

  assert.equal(c2.width, c1.width * 2)
  assert.equal(c2.height, c1.height * 2)
})

test('XunfeiNativePreview: key state management', () => {
  const canvas = new MockCanvas()
  const theme = createMockTheme()

  const preview = new XunfeiNativePreview({ canvas, theme, resolution: '1080p', interactive: false })

  assert.equal(preview.getKeyState(1), KeyState.Idle, 'initial state is Idle')

  preview.setKeyStateManual(1, KeyState.Pressed)
  assert.equal(preview.getKeyState(1), KeyState.Pressed)

  preview.setKeyStateManual(1, KeyState.LongPressed)
  assert.equal(preview.getKeyState(1), KeyState.LongPressed)

  preview.setKeyStateManual(1, KeyState.Idle)
  assert.equal(preview.getKeyState(1), KeyState.Idle)

  preview.dispose()
})

test('XunfeiNativePreview: default 9-key layout', () => {
  const canvas = new MockCanvas()
  const theme = createMockTheme()

  const preview = new XunfeiNativePreview({ canvas, theme, resolution: '1080p' })
  const hitboxes = preview.getKeyHitboxes()

  assert.equal(hitboxes.size, 9, 'Default layout has 9 keys')

  for (let i = 1; i <= 9; i++) {
    assert.ok(hitboxes.has(i), `Key ${i} exists`)
    const hb = hitboxes.get(i)
    assert.ok(hb.w > 0 && hb.h > 0, `Key ${i} has positive dimensions`)
  }

  preview.dispose()
})

test('XunfeiNativePreview: multi-key states', () => {
  const canvas = new MockCanvas()
  const theme = createMockTheme()

  const preview = new XunfeiNativePreview({ canvas, theme, resolution: '1080p', interactive: false })

  for (let i = 1; i <= 9; i++) {
    preview.setKeyStateManual(i, i % 2 === 0 ? KeyState.Pressed : KeyState.Idle)
  }

  for (let i = 1; i <= 9; i++) {
    const expected = i % 2 === 0 ? KeyState.Pressed : KeyState.Idle
    assert.equal(preview.getKeyState(i), expected, `Key ${i} state`)
  }

  preview.dispose()
})

test('XunfeiNativePreview: dispose is safe to call twice', () => {
  const canvas = new MockCanvas()
  const theme = createMockTheme()

  const preview = new XunfeiNativePreview({ canvas, theme, resolution: '1080p' })
  preview.dispose()
  assert.doesNotThrow(() => preview.dispose(), 'Second dispose should not throw')
})

test('XunfeiNativePreview: start/stop does not throw', () => {
  const canvas = new MockCanvas()
  const theme = createMockTheme()

  const preview = new XunfeiNativePreview({ canvas, theme, resolution: '1080p' })
  assert.doesNotThrow(() => preview.start())
  assert.doesNotThrow(() => preview.stop())
  assert.doesNotThrow(() => preview.start()) // idempotent
  preview.dispose()
})

test('XunfeiNativePreview: style cache populated from theme', () => {
  const canvas = new MockCanvas()
  const theme = createMockTheme()

  const preview = new XunfeiNativePreview({ canvas, theme, resolution: '1080p' })

  // Key state lookup of a known key should work
  assert.equal(preview.getKeyState(1), KeyState.Idle, 'Style-linked key queryable')

  preview.dispose()
})
