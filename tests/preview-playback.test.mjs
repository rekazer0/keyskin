import test from 'node:test'
import assert from 'node:assert/strict'
import { Preview } from '../src/preview.ts'
import { IniDocument } from '../src/ini.ts'
import { keyAnimationStyles, previewItems } from '../src/preview-items.ts'
import { legacyParticleFrames, parseLegacyAnimation, parseLegacyParticleEmitter } from '../src/preview-animation.ts'
import { playAnimation } from '../src/preview-playback.ts'
import { pointerDown, pointerUp } from '../src/preview-pointer.ts'

const animations = IniDocument.parse('[ANIM1]\nPARTICLE_IMAGE=2\nTOTAL_NUMBER=3\nBIRTH_RATE=1\nLIFE=500,500\n[ANIM2]\nTYPE=3\nFROM=100,100\nTO=80,80\nDURATION=300')
const styles = IniDocument.parse('[STYLE7]\nPRESS_ANIM=1\n[STYLE8]\nSHOW_ANIM=1\n[STYLE9]\nPRESS_ANIM=2')
const layout = IniDocument.parse('[KEY1]\nVIEW_RECT=0,0,100,100\nCENTER=q\nBACK_ANIM_STYLE=7\n[KEY2]\nVIEW_RECT=100,0,100,100\nCENTER=w\nBACK_ANIM_STYLE=9')
const keys = previewItems(layout)
const emitter = parseLegacyParticleEmitter(animations, 'ANIM1')

function harness(t) {
  const oldWindow = globalThis.window
  const now = Date.now
  let time = 1000
  let id = 0
  const frames = new Map()
  const timers = new Map()
  globalThis.window = {
    requestAnimationFrame: (fn) => (frames.set(++id, fn), id),
    cancelAnimationFrame: (id) => frames.delete(id),
    setTimeout: (fn) => (timers.set(++id, fn), id),
    clearTimeout: (id) => timers.delete(id),
  }
  Date.now = () => time
  t.after(() => { globalThis.window = oldWindow; Date.now = now })
  const preview = Object.assign(Object.create(Preview.prototype), {
    legacyAnimationStates: new Map(), animationPlayback: 0, keys, selected: new Set(),
    mode: 'preview', panelWidth: 200, panelHeight: 100, panelAnimationStyle: '7',
    legacyPanelAnimationStartedAt: 0, draw() {}, fitCanvas() {},
    cancelPointerInteraction() {}, layoutItems: () => keys, scenes: new Map(), visualCache: new Map(),
    canvas: { setPointerCapture() {} }, point: () => ({ x: 50, y: 50 }), hit: () => keys[0],
    onSelect() {}, onEvent() {},
  })
  return { preview, frames, timers, advance(ms) {
    time += ms
    const pending = [...frames.values()]
    frames.clear()
    pending.forEach((fn) => fn())
  } }
}

test('particle press begins immediately, observes birth rate and ends after the last particle', () => {
  assert.equal(legacyParticleFrames(emitter, -1, 100, 100).length, 0)
  assert.equal(legacyParticleFrames(emitter, 0, 100, 100).length, 1)
  assert.equal(legacyParticleFrames(emitter, 100, 100, 100).length, 1)
  assert.equal(legacyParticleFrames(emitter, 1000, 100, 100).length, 1)
  assert.equal(legacyParticleFrames(emitter, 2501, 100, 100).length, 0)
})

test('press bindings do not fall back to show; duplicate key styles emit only once', () => {
  assert.equal(parseLegacyAnimation(styles, animations).has('8'), false)
  assert.equal(parseLegacyAnimation(styles, animations, 'SHOW_ANIM').has('8'), true)
  assert.deepEqual(keyAnimationStyles({ ...keys[0], animStyle: '7', foreAnimStyle: '7', foreAnimStyles: ['7', '9'], pressStyle: '7' }), ['7', '9'])
  assert.deepEqual(keyAnimationStyles({ ...keys[0], pressStyle: '7' }, '7'), ['7'])
})

test('loading configuration stays idle; presses play panel and independent keys, replay and expire', async (t) => {
  const { preview, frames, advance } = harness(t)
  preview.setLegacyAnimation(parseLegacyAnimation(styles, animations))
  preview.setPanel('', 200, 100, '7')
  assert.equal(preview.legacyPanelAnimationStartedAt, 0)
  assert.equal(frames.size, 0)
  await playAnimation(preview, keys[0])
  assert.equal(preview.legacyPanelAnimationStartedAt, 0)
  advance(50)
  await playAnimation(preview, keys[1])
  assert.equal(preview.legacyAnimationStates.size, 2)
  advance(50)
  await playAnimation(preview, keys[0])
  assert.equal(preview.legacyAnimationStates.get('KEY1').startedAt, 1100)
  assert.equal(preview.legacyAnimationStates.get('KEY2').startedAt, 1050)
  advance(300)
  assert.equal(preview.legacyAnimationStates.has('KEY2'), true, 'panel particle outlives the key transform')
  advance(2300)
  assert.equal(preview.legacyAnimationStates.size, 0)
  assert.equal(preview.legacyPanelAnimationStartedAt, 0)
  assert.equal(frames.size, 0)
  await playAnimation(preview, keys[0])
  preview.setDocument(layout)
  assert.equal(preview.legacyAnimationStates.size, 0)
  assert.equal(preview.legacyPanelAnimationStartedAt, 0)
  assert.equal(frames.size, 0)
})

test('key presses stop inspector-wide particles without replaying them near LIST', async (t) => {
  const { preview, frames } = harness(t)
  preview.setLegacyAnimation(parseLegacyAnimation(styles, animations))
  preview.setParticlePreview(emitter)
  await playAnimation(preview, keys[0])
  assert.equal(preview.legacyPanelAnimationStartedAt, 0)
  assert.equal(preview.legacyAnimationStates.has('KEY1'), true)
  preview.restartLegacyPanelAnimation()
  assert.equal(preview.legacyPanelAnimationStartedAt, 1000, 'explicit inspector replay still works')
  const panelTimer = preview.legacyPanelAnimationTimer
  await playAnimation(preview, keys[1])
  assert.equal(preview.legacyPanelAnimationStartedAt, 0)
  assert.equal(frames.has(panelTimer), false)
  assert.equal(preview.legacyAnimationStates.size, 2)
  preview.setParticlePreview()
  await playAnimation(preview, keys[0])
  assert.equal(preview.legacyPanelAnimationStartedAt, 0)
  assert.equal(preview.legacyAnimationStates.has('KEY1'), true, 'panel binding plays on the pressed key')
})

test('a key without particle bindings inherits panel particles at its own rectangle', async (t) => {
  const { preview } = harness(t)
  preview.setLegacyAnimation(parseLegacyAnimation(styles, animations))
  const key = { ...keys[1], backAnimStyle: undefined }
  await playAnimation(preview, key)
  assert.equal(preview.legacyPanelAnimationStartedAt, 0)
  assert.equal(preview.legacyAnimationStates.get('KEY2').key, key)
  assert.equal(preview.legacyAnimationStates.get('KEY2').duration, 2500)
  assert.deepEqual(keyAnimationStyles(key, preview.panelAnimationStyle), ['7'])
})

test('mouse edit click and touch tap both trigger animations; right click does not', (t) => {
  const { preview } = harness(t)
  preview.mode = 'edit'
  preview.editTool = 'select'
  const played = []
  preview.playAnimation = (key) => played.push(key.section)
  const event = { button: 0, pointerId: 1, pointerType: 'mouse', clientX: 0, clientY: 0 }
  pointerDown(preview, event)
  assert.deepEqual(played, ['KEY1'])
  pointerDown(preview, { ...event, button: 2 })
  assert.equal(played.length, 1)
  pointerDown(preview, { ...event, pointerType: 'touch' })
  assert.equal(played.length, 1)
  pointerUp(preview, { ...event, pointerType: 'touch' })
  assert.deepEqual(played, ['KEY1', 'KEY1'])
})

test('late image decoding cannot replace a newer press or revive a reset animation', async (t) => {
  const { preview, timers } = harness(t)
  const pending = []
  preview.animation = { targets: [], bindings: new Map(), targetBindings: new Map(), sequences: new Map([['one', { frames: [{ resourceID: 'image', duration: 100 }] }]]) }
  preview.resolver = { resolveResource() {} }
  preview.resolveResource = () => new Promise((resolve) => pending.push(resolve))
  const first = playAnimation(preview, keys[0])
  const second = playAnimation(preview, keys[1])
  pending[1]({ imagePath: 'new' })
  await second
  pending[0]({ imagePath: 'old' })
  await first
  assert.equal(preview.animationVisual.key.section, 'KEY2')
  assert.equal(preview.animationVisual.visual.imagePath, 'new')
  assert.equal(timers.size, 1)
  const third = playAnimation(preview, keys[0])
  preview.setAnimation(undefined)
  pending[2]({ imagePath: 'stale' })
  await third
  assert.equal(preview.animationVisual, undefined)
  assert.equal(timers.size, 0)
})

test('canvas clicks release paused player particles and play the active TIP binding in edit mode', (t) => {
  const { preview } = harness(t)
  const document = IniDocument.parse(`${layout.toString()}\n[TIP4]\nBACK_ANIM_STYLE=9`)
  document.set('KEY1', 'STAT_STYLE', 'S11_4')
  const base = previewItems(document)[0]
  preview.document = document
  preview.skinState = 11
  preview.mode = 'edit'
  preview.editTool = 'select'
  preview.hit = () => base
  preview.playerParticles = { particles: [{ emitter, start: 0, duration: 2500 }], elapsed: 100, key: base }
  let played
  preview.playAnimation = (key) => { played = key }
  pointerDown(preview, { button: 0, pointerType: 'mouse' })
  assert.equal(preview.playerParticles, undefined)
  assert.equal(played.backAnimStyle, '9')
  assert.equal(base.backAnimStyle, '7', 'selection keeps the base item unchanged')
})

test('native layout identity clears old press only when changing boards', (t) => {
  const { preview } = harness(t)
  preview.setDocument(undefined, 'palm-a')
  const press = { section: 'KEY1', startedAt: 1000, seed: 1 }
  preview.nativePress = press
  preview.setNativeItems(() => keys)
  preview.setDocument(undefined, 'palm-a')
  assert.equal(preview.nativePress, press)
  preview.setDocument(undefined, 'palm-b')
  assert.equal(preview.nativePress, undefined)
})

test('a panel SHOW_ANIM particle effect plays when the panel appears and keeps its time over a refresh', (t) => {
  const { preview, frames, advance } = harness(t)
  const show = parseLegacyAnimation(styles, animations, 'SHOW_ANIM')
  preview.setLegacyShowAnimation(show)
  assert.equal(preview.legacyPanelAnimationStartedAt, 0, '面板样式还是按下动画时不自动播放')
  preview.setPanel('', 200, 100, '8')
  assert.equal(preview.legacyPanelAnimationStartedAt, 1000, '面板出现就播放它的显示动画')
  assert.ok(frames.size > 0, '粒子的时间循环在跑')
  advance(120)
  const started = preview.legacyPanelAnimationStartedAt
  preview.setLegacyShowAnimation(parseLegacyAnimation(styles, animations, 'SHOW_ANIM'))
  assert.equal(preview.legacyPanelAnimationStartedAt, started, '预览刷新接着播，粒子不跳回开头')
  preview.setPanel('', 200, 100, '9')
  assert.equal(preview.legacyPanelAnimationStartedAt, 0, '换成没有显示粒子的面板样式就停')
})
