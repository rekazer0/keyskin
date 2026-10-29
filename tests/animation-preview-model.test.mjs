import test from 'node:test'
import assert from 'node:assert/strict'
import { IniDocument } from '../src/ini.ts'
import { bdaPreviewClip, iniPreviewClip } from '../src/animation-preview-model.ts'
import { motionAt } from '../src/native-motion.ts'
import { animationTable } from './helpers/sxi-animation-fixture.mjs'
import { animationsIni } from '../src/palm/sxi-style.ts'
import { palmPreviewClip } from '../src/palm/palm-preview-clip.ts'

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

test('Palm animations preview straight from skin.json and keep unsupported special effects explicit', () => {
  const table = animationTable()
  const before = JSON.stringify(table)
  const scale = palmPreviewClip(table, '100')
  assert.equal(scale.duration, 320)
  assert.deepEqual(motionAt(scale.tracks, 160, size).scale, [0.92, 0.92])
  assert.equal(palmPreviewClip(table, '104').particles[0].emitter.totalNumber, 12)
  const special = palmPreviewClip(table, '107')
  assert.equal(special.tracks.length, 0)
  assert.match(special.notes.join(' '), /暂不支持/)
  assert.match(palmPreviewClip(table, '999').notes.join(' '), /动画 999 不存在/)
  assert.deepEqual(palmPreviewClip(table, '102').lanes.map((lane) => lane.label), ['动画 100 · 缩放', '动画 101 · 位移'])
  assert.equal(JSON.stringify(table), before, '预览不改动 skin.json')
})

test('a Palm animation previews the same as the anim.ini it exports as', () => {
  const table = animationTable()
  const exported = IniDocument.parse(animationsIni(table).toString())
  for (const id of Object.keys(table)) {
    const native = palmPreviewClip(table, id)
    const ini = iniPreviewClip(exported, `ANIM${id}`)
    assert.equal(native.duration, ini.duration, `${id} duration`)
    assert.deepEqual(native.tracks.map((track) => [track.kind, track.start, track.duration, track.passes, track.hold]), ini.tracks.map((track) => [track.kind, track.start, track.duration, track.passes, track.hold]), `${id} tracks`)
    for (const at of [0, 50, 160, 300]) assert.deepEqual(motionAt(native.tracks, at, size), motionAt(ini.tracks, at, size), `${id} at ${at}ms`)
    assert.deepEqual(native.particles.map((item) => item.emitter), ini.particles.map((item) => item.emitter), `${id} particles`)
    assert.deepEqual(native.images, ini.images, `${id} images`)
  }
})

test('Palm previews follow the family and PalmSkin defaults, not a stray category or missing fields', () => {
  // 分类写错时 anim.ini 会按错误的分类解释；直接读 skin.json 按 a1 / af2 / a4 判断。
  const table = {
    '1': { a1: { b: { t: 3, c: 2, count: 1 }, duration: 100, from_p: [100, 100], to_p: [50, 50] } },
    '2': { a1: { b: { t: 1 }, duration: 100, delay: 10, c_delay: 30, from: 0, to: 90 } },
    '3': { a3: { a_method: 'sequential', animations: [1, 2] } },
    '4': { af2: { b: { count: 2 ** 63 }, file: 'loop.webp', d: 300 } },
  }
  const scale = palmPreviewClip(table, '1')
  assert.deepEqual(motionAt(scale.tracks, 50, size).scale, [0.75, 0.75])
  assert.equal(scale.tracks[0].hold, true, 'clear 缺省为 false：保留终态')
  const turn = palmPreviewClip(table, '2')
  assert.equal(turn.tracks[0].start, 40, 'c_delay 与 delay 相加，与画布一致')
  assert.equal(motionAt(turn.tracks, 90, size).rotation, 45)
  const sequence = palmPreviewClip(table, '3')
  assert.equal(sequence.tracks[1].start, 140, '顺序组合：第二个在第一个结束后开始')
  const loop = palmPreviewClip(table, '4')
  assert.equal(loop.lanes[0].unbounded, true)
  assert.match(loop.notes.join(' '), /循环动画/)
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
