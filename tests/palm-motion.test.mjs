import test from 'node:test'
import assert from 'node:assert/strict'
import { PalmBoard } from '../src/palm/palm-board.ts'
import { PalmMotion } from '../src/palm/palm-motion.ts'
import { palmPreviewClip } from '../src/palm/palm-preview-clip.ts'
import { legacyParticleFrames } from '../src/preview-animation.ts'

const visual = { image: {}, source: [10, 20, 20, 10] }
const particle = () => ({ a4: {
  b: { c: 3, t: 1 }, count: 2, rate: 2, life: [1000, 1000], delay: 100,
  i_p: [1523], aera: [[0, 0], [1, 1]], velocity: [20, 20], v_direction: [0, 0],
  scale: [0.5, 0.5], alpha: [128, 128],
} })

async function fixture({ animations = { 1101: particle() }, events = { 3: 1101 }, ownBase = {}, globalBase = { base_pa: 813 }, keyBase = {}, image = visual } = {}) {
  const skin = { default: {
    s_info: { ss_1: { 813: { s_5: events } }, ss_2: animations },
    port_layout: { b: {
      defaultGlobal: { board: { size: [500, 300], b: globalBase, a_insets: { left: 10, top: 20, right: 30, bottom: 40 } } },
      t9Pinyin: { board: { b: ownBase }, keys: [{ id: '1', rect: [[50, 60], [100, 80]], b: keyBase, values: [4, 'q'] }] },
    } },
  } }
  const board = new PalmBoard(skin, 'default', 'port', 't9Pinyin')
  const motion = await PalmMotion.load(skin, 'default', 'port', board, { paint: async () => ({ visual: image }) })
  return { board, effects: motion.effects(board.keys()), animations }
}

test('SXI panel particles inherit global bindings and use the inspector sampler and real image size', async () => {
  const { board, effects, animations } = await fixture()
  assert.equal(board.panelAnimation, '813')
  assert.deepEqual(board.panelClip.region, { x: 10, y: 20, width: 460, height: 240 })
  assert.deepEqual(effects.panel(99), [], 'delay is respected')
  const sprite = effects.panel(350)[0]
  const expected = legacyParticleFrames(palmPreviewClip(animations, '1101').particles[0].emitter, 250, 460, 240)[0]
  assert.equal(sprite.visual, visual)
  assert.deepEqual(sprite.rect, { x: 10 + expected.x - 10, y: 20 + expected.y - 5, width: 20, height: 10 })
  assert.deepEqual(sprite.motion, { scale: [0.5, 0.5], rotation: 0, opacity: 128 / 255 })
  assert.equal(effects.panel(850).length, 2, 'birth rate and count are respected')
  assert.deepEqual(effects.panel(2200), [], 'dead particles disappear')
  assert.equal(effects.panel(450)[0].rect.x - sprite.rect.x, 2, 'velocity changes the particle position')
})

test('panel particles work on press and through sequential combinations without duplicating the show clip', async () => {
  const animations = {
    1: { a1: { b: { t: 4, clear: true }, duration: 200, from_p: [100, 100], to_p: [100, 100] } },
    2: particle(),
    3: { a3: { a_method: 'sequential', animations: [1, 2] } },
  }
  const { effects } = await fixture({ animations, events: { 1: 3, 3: 2 } })
  assert.deepEqual(effects.press('KEY1', 299, 1).sprites, [])
  assert.equal(effects.press('KEY1', 300, 1).sprites.length, 1)
  assert.ok(effects.pressDuration('KEY1', 1) >= 1800)
  assert.deepEqual(effects.panel(400, { section: 'KEY1', elapsed: 350, seed: 1 }), [], 'a running press replaces the same panel slot')
  assert.equal(effects.panel(400).length, 1)
})

test('particles bound to key layers use the key rectangle and missing pictures stay empty', async () => {
  const { effects } = await fixture({ events: { 1: 1101 }, globalBase: {}, keyBase: { base_ba: 813 } })
  const sprite = effects.press('KEY1', 350, 1).sprites[0]
  const expected = legacyParticleFrames(palmPreviewClip({ 1101: particle() }, '1101').particles[0].emitter, 250, 100, 80)[0]
  assert.equal(sprite.rect.x, 50 + expected.x - 10)
  assert.equal(sprite.rect.y, 60 + expected.y - 5)
  const missing = await fixture({ image: null })
  assert.deepEqual(missing.effects.panel(350), [], 'a missing picture does not crash playback or draw a stand-in')
})

test('an authored panel binding overrides the global one; asi remains a supported fallback', async () => {
  assert.equal((await fixture({ ownBase: { asi: 814 } })).board.panelClip.style, 814)
  assert.equal((await fixture({ ownBase: { asi: 814, base_pa: 815 } })).board.panelClip.style, 815)
  assert.equal((await fixture({ ownBase: { base_pa: 0 } })).board.panelClip.style, 0)
})
