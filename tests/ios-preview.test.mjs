import { test } from 'node:test'
import assert from 'node:assert/strict'
import { iosCandidateBackground } from '../src/ios-preview.ts'

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
