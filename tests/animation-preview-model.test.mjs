import test from 'node:test'
import assert from 'node:assert/strict'
import { IniDocument } from '../src/ini.ts'
import { bdaPreviewClip, iniPreviewClip } from '../src/animation-preview-model.ts'
import { motionAt } from '../src/native-motion.ts'
import { animationTable } from './helpers/sxi-animation-fixture.mjs'
import { animationsIni } from '../src/palm/sxi-style.ts'

const size = { width: 100, height: 50 }
const document = IniDocument.parse('[ANIM1]\nCATEGORY=0\nTYPE=2\nDURATION=100\nDELAY=20\nFROM=0,0\nTO=100,100\nREPEAT_CNT=2\nREPEAT_MODE=1\n[ANIM2]\nCATEGORY=0\nTYPE=0\nDURATION=80\nFROM=255\nTO=0\n[ANIM3]\nCATEGORY=1\nBUILD_LIST=1,2\nBUILD_METHOD=1\n')

test('inspector samples full repeats, reverse, delay and relative translation without rewriting INI', () => {
  const before = document.toString()
  const clip = iniPreviewClip(document, 'ANIM1')
  assert.equal(clip.duration, 420)
  assert.equal(motionAt(clip.tracks, 10, size), undefined)
  assert.deepEqual(motionAt(clip.tracks, 70, size).translation, [50, 25])
  assert.deepEqual(motionAt(clip.tracks, 170, size).translation, [50, 25])
  assert.deepEqual(motionAt(clip.tracks, 420, size).translation, [0, 0])
  assert.equal(document.toString(), before)
})

test('nested sequential combinations shift tracks by full child duration; simultaneous uses maximum', () => {
  const sequential = iniPreviewClip(document, 'ANIM3')
  assert.equal(sequential.duration, 500)
  assert.equal(sequential.tracks[1].start, 420)
  const parallel = IniDocument.parse(document.toString())
  parallel.set('ANIM3', 'BUILD_METHOD', '0')
  assert.equal(iniPreviewClip(parallel, 'ANIM3').duration, 420)
  parallel.set('ANIM3', 'BUILD_LIST', '3,999')
  const invalid = iniPreviewClip(parallel, 'ANIM3')
  assert.equal(invalid.tracks.length, 0)
  assert.match(invalid.notes.join(' '), /循环.*不存在/)
})

test('Palm projection previews native geometry and keeps unsupported special effects explicit', () => {
  const projected = IniDocument.parse(animationsIni(animationTable()).toString())
  const scale = iniPreviewClip(projected, 'ANIM100')
  assert.equal(scale.duration, 320)
  assert.deepEqual(motionAt(scale.tracks, 160, size).scale, [0.92, 0.92])
  assert.equal(iniPreviewClip(projected, 'ANIM104').particles[0].emitter.totalNumber, 12)
  const special = iniPreviewClip(projected, 'ANIM107')
  assert.equal(special.tracks.length, 0)
  assert.match(special.notes.join(' '), /暂不支持/)
})

test('pixels, opacity, pivots and infinite clips retain their semantics', () => {
  const doc = IniDocument.parse('[ANIM1]\nCATEGORY=0\nTYPE=2\nDURATION=100\nFROM_PX=0,0\nTO_PX=10,20\nPIVOT_PX=16,32\nREPEAT_CNT=-1\n')
  const clip = iniPreviewClip(doc, 'ANIM1')
  assert.deepEqual(motionAt(clip.tracks, 50, size).translation, [5, 10])
  assert.equal(clip.duration, 100)
  assert.match(clip.notes.join(' '), /循环/)
  doc.set('ANIM1', 'TYPE', '0')
  doc.set('ANIM1', 'FROM', '255')
  doc.set('ANIM1', 'TO', '0')
  assert.equal(motionAt(iniPreviewClip(doc, 'ANIM1').tracks, 50, size).opacity, 0.5)
})

test('timeline lanes name each clip of a combination at its start', () => {
  const clip = iniPreviewClip(document, 'ANIM3')
  assert.deepEqual(clip.lanes.map((lane) => [lane.label, lane.start, lane.passes]), [['动画 1 · 位移', 20, 4], ['动画 2 · 透明度', 420, 1]])
})

test('BDA effects preview their midpoints, groups compose children, unsupported media say so', () => {
  const transform = (kind, extra = {}) => ({
    kind, key: kind, repeatCount: 1, repeatMode: 0, delay: 0, removeOnFinish: false, duration: 100, interpolation: 0,
    from: [[0, 0], [0, 0]], to: [[100, 100], [100, 100]], relative: true, ...extra,
  })
  const animation = {
    targets: [], sequences: new Map(), bindings: new Map(), targetBindings: new Map(),
    effects: new Map([
      ['alpha:fade', transform('alpha', { key: 'fade', from: [[0, 0], [0, 0]], to: [[200, 255], [200, 255]] })],
      ['shift:up', transform('shift', { key: 'up', delay: 50, to: [[0, 0], [-100, -100]] })],
      ['group:both', { kind: 'group', key: 'both', buildMode: 1, repeatCount: 1, repeatMode: 0, removeOnFinish: false, delay: 0, items: [{ kind: 'alpha', key: 'fade' }, { kind: 'shift', key: 'up' }] }],
      ['lottie:fun', { kind: 'lottie', key: 'fun', repeatCount: 1, removeOnFinish: false }],
    ]),
  }
  const fade = bdaPreviewClip(animation, 'alpha:fade')
  assert.ok(Math.abs(motionAt(fade.tracks, 100, size).opacity - 227.5 / 255) < 1e-9)
  assert.match(fade.notes.join(' '), /中点/)
  const both = bdaPreviewClip(animation, 'group:both')
  assert.equal(both.duration, 250, '接续：位移在透明度之后开始，再加自己的延迟')
  assert.deepEqual(motionAt(both.tracks, 250, size).translation, [0, -50])
  assert.deepEqual(both.lanes.map((lane) => lane.label), ['fade · 透明度', 'up · 位移'])
  const lottie = bdaPreviewClip(animation, 'lottie:fun')
  assert.equal(lottie.tracks.length + lottie.images.length + lottie.particles.length, 0)
  assert.match(lottie.notes.join(' '), /Lottie暂不支持/)
})
