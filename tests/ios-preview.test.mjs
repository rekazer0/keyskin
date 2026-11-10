import { test } from 'node:test'
import assert from 'node:assert/strict'
import { iosCandidateBackground, iosToolbarImageScene } from '../src/ios-preview.ts'
import { iosToolbarScale } from '../src/ios-toolbar-geometry.ts'
import { IniDocument } from '../src/ini.ts'
import { previewItems } from '../src/preview-items.ts'

test('native iOS toolbar keeps its point height while the keyboard stretches to the phone width', () => {
  const scale = iosToolbarScale(1125, 440)
  assert.ok(Math.abs(124 * scale - 105.681818) < 0.000001)
  assert.equal(124 * scale * 1320 / 1125, 124)
  assert.equal(iosToolbarScale(1125, undefined), 1)
  assert.equal(iosToolbarScale(1125, 0), 1)
})

test('fixed iOS edge artwork fits the visible bar, with its pressed state and authored hit boxes intact', async () => {
  const document = IniDocument.parse('[CAND]\n[ICON1]\nFORE_STYLE=1\nSIZE=229,186\nPOS=0,20\nANCHOR_TYPE=1\nFIX_SIZE=50,52\nKEY=F31\n[ICON2]\nFORE_STYLE=1\nSIZE=229,186\nPOS=-229,0\nANCHOR_TYPE=3\nFIX_SIZE=50,52\nKEY=F8\n[ICON3]\nFORE_STYLE=1\nSIZE=229,186\nPOS=0,-500\nANCHOR_TYPE=1\nFIX_SIZE=50,52\nKEY=F31\n')
  const height = 124 * iosToolbarScale(1125, 440)
  const items = previewItems(document, 1125, height)
  const before = structuredClone(items)
  const normal = { image: {}, source: [0, 0, 136, 110] }
  const pressed = { image: {}, source: [0, 110, 136, 110] }
  const scene = await iosToolbarImageScene({ resolve: async (id, down) => id === '1' ? down ? pressed : normal : undefined }, items, 1125, height, 440)
  assert.deepEqual(scene.keys.map(key => key.section), ['ICON1', 'ICON2'])
  for (const key of scene.keys) {
    const rect = key.layers(false).fore[0].rect
    assert.ok(rect.x >= 0 && rect.x + rect.width <= 1125)
    assert.ok(rect.y >= 0 && rect.y + rect.height <= height)
    assert.ok(Math.abs(rect.width / rect.height - 136 / 110) < 0.000001)
    assert.deepEqual(key.layers(true).fore[0].visual.source, pressed.source)
    assert.deepEqual(key.rect, items.find(item => item.section === key.section).rect)
  }
  assert.deepEqual(items, before)
})

test('native functions centre in the bar and keep their point size despite a short F14 hit box', async () => {
  const document = IniDocument.parse('[CAND]\n[ICON1]\nSIZE=780,58\nPOS=-390,43\nANCHOR_TYPE=2\nKEY=F14\n')
  const image = { image: {}, imagePath: '/logo/function_iphone@3x.png', source: [0, 0, 80, 80] }
  const resolver = { resolve: async () => undefined, resolveToolbarImages: async () => [image, image] }
  const scale = iosToolbarScale(1125, 440)
  const height = 124 * scale
  const scene = await iosToolbarImageScene(resolver, previewItems(document, 1125, height), 1125, height, 440)
  const layers = scene.keys[0].layers(false).fore
  assert.equal(layers.length, 2)
  for (const { rect } of layers) {
    assert.equal(rect.height, 80 * scale)
    assert.equal(rect.y + rect.height / 2, height / 2)
  }
})

test('iOS candidate and panel share one picture, with the candidate style above it', async () => {
  const visuals = { panel: { image: {}, source: [0, 0, 1080, 713] }, candidate: { color: '#654321' } }
  const scene = await iosCandidateBackground({ resolve: async id => visuals[id] }, 'panel', 'candidate', 360, 258, 50, 24)
  assert.deepEqual(scene.background, [
    { kind: 'image', visual: visuals.panel, rect: { x: 0, y: -24, width: 360, height: 332 } },
    { kind: 'image', visual: visuals.candidate, rect: { x: 0, y: 0, width: 360, height: 50 } },
  ])
  assert.deepEqual(scene.keys, [])
})

test('missing iOS candidate artwork lets the panel picture through', async () => {
  const panel = { image: {}, source: [0, 0, 1080, 713] }
  const scene = await iosCandidateBackground({ resolve: async id => id === 'panel' ? panel : undefined }, 'panel', '', 360, 258, 50, 0)
  assert.equal(scene.background.length, 1)
  assert.deepEqual(scene.background[0].rect, { x: 0, y: -0, width: 360, height: 308 })
})

test('a solid panel fill stays below the candidate bar', async () => {
  const scene = await iosCandidateBackground({ resolve: async id => id === 'candidate' ? { color: '#000000' } : { color: '#ffffff' } }, 'panel', 'candidate', 360, 258, 50, 0)
  assert.equal(scene.background.length, 1, 'solid panel fills stay in the main canvas')
  assert.deepEqual(scene.background[0].rect, { x: 0, y: 0, width: 360, height: 50 })
})
