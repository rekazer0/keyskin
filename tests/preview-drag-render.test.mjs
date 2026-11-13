import test from 'node:test'
import assert from 'node:assert/strict'
import { Preview } from '../src/preview.ts'
import { IniDocument } from '../src/ini.ts'
import { previewItems } from '../src/preview-items.ts'
import { paintPreview } from '../src/preview-paint.ts'

test('drag frames keep each key background and foreground when press animations reorder keys', async () => {
  const keys = previewItems(IniDocument.parse([
    '[KEY1]', 'VIEW_RECT=0,0,100,100', 'BACK_STYLE=1', 'FORE_STYLE=11',
    '[KEY2]', 'VIEW_RECT=120,0,100,100', 'BACK_STYLE=2', 'FORE_STYLE=12',
    '[KEY3]', 'VIEW_RECT=240,0,100,100', 'BACK_STYLE=3', 'FORE_STYLE=13',
  ].join('\n')))
  const backgrounds = [], foregrounds = []
  const context = {
    setTransform() {}, clearRect() {},
    fillRect(x, y, width, height) { backgrounds.push([x, y, width, height, this.fillStyle]) },
    fillText(text, x, y) { foregrounds.push([x, y, text]) },
  }
  let resolves = 0
  const preview = Object.assign(Object.create(Preview.prototype), {
    keys, drawID: 0, panelWidth: 340, panelHeight: 100, panelTopInset: 0,
    theme: 'light', transparent: true, mode: 'edit', selected: new Set(), draftSections: new Set(),
    legacyAnimationStates: new Map(), scenes: new Map(),
    canvas: { width: 340, height: 100, getContext: () => context },
    resolver: {
      resolve: async () => undefined,
      resolveText: () => undefined,
      resolveStyleText: (style) => ({ text: style }),
    },
    resolveVisual: async (style) => { resolves++; return { color: `#00000${style}` } },
    resolveToolbar: async () => [],
  })
  const frame = async () => {
    backgrounds.length = foregrounds.length = 0
    await paintPreview(preview)
    return { backgrounds: [...backgrounds].sort((a, b) => a[0] - b[0]), foregrounds: [...foregrounds].sort((a, b) => a[0] - b[0]) }
  }
  const baseline = await frame()
  const cachedResolves = resolves
  preview.editDrag = { original: new Map([[keys[0].section, { ...keys[0].rect }]]) }
  preview.legacyAnimationStates.set('KEY1', { key: keys[0], startedAt: Date.now(), duration: 1000 })
  assert.deepEqual(await frame(), baseline, 'clicking an animated key must not swap other keys styles')
  keys[0].rect.x += 10
  const moved = await frame()
  assert.deepEqual(moved.backgrounds.slice(1), baseline.backgrounds.slice(1), 'other backgrounds stay unchanged during movement')
  assert.deepEqual(moved.foregrounds.slice(1), baseline.foregrounds.slice(1), 'other foregrounds stay unchanged during movement')
  assert.equal(moved.backgrounds[0][0], 10)
  assert.equal(moved.foregrounds[0][0], 60)
  preview.legacyAnimationStates.clear()
  assert.deepEqual(await frame(), moved, 'animation expiry restores drawing order without swapping styles')
  assert.equal(resolves, cachedResolves, 'drag frames reuse the resolved visuals')
  preview.editDrag = undefined
  assert.deepEqual(await frame(), moved, 'releasing the pointer keeps the same styles')
})
