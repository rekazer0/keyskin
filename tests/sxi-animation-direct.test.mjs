import assert from 'node:assert/strict'
import { test } from 'node:test'
import { palmPreviewClip } from '../src/palm/palm-preview-clip.ts'
import { sxiDirectEdit } from '../src/palm/sxi-animation-direct.ts'

function setup(kind, model) {
  const table = { 1: { [kind]: model, info: '保留' } }
  const writes = []
  const clip = palmPreviewClip(table, '1')
  const edit = sxiDirectEdit(table, '1', clip, (key, value) => writes.push([key, value]))
  const handle = (field, index = 0) => edit?.handles.find((item) => item.field === field && item.index === index)
  return { edit, handle, writes }
}

test('SXI stages native endpoints and single-pass timing without changing skin.json during preview', () => {
  const model = { b: { t: 2, back: true, count: 2 }, duration: 200, delay: 10, c_delay: 20,
    from_px: [0, 0], to_px: [24, -36], to_p: [40, 50], pxp: [27, 54] }
  const { edit, handle, writes } = setup('a1', model)
  assert.deepEqual(edit.pivot, [0.25, 0.5])
  assert.equal(edit.delay, 30)
  const y = handle('TO_PX', 1)
  assert.equal(y.unit, 'px')
  assert.equal(y.value, -36)
  assert.deepEqual(edit.preview(y, -48).tracks[0].value(1), [24, -48])
  assert.deepEqual(model.to_px, [24, -36])
  assert.deepEqual(writes, [])
  edit.commit(y, -48)
  const duration = handle('DURATION')
  assert.equal(edit.preview(duration, 300).duration, 30 + 300 * 4)
  edit.commit(duration, 300)
  assert.deepEqual(writes, [['to_px', [24, -48]], ['duration', 300]])

  const scale = setup('a1', { b: { t: 4 }, duration: 100, to_p: [125, 90], pp: [25, 75], pxp: [54, 54] })
  assert.equal(scale.handle('TO').label, '缩放 X')
  assert.deepEqual(scale.edit.pivot, [0.25, 0.75])
  assert.deepEqual(scale.edit.preview(scale.handle('TO'), 150).tracks[0].value(1), [1.5, 0.9])
  const turn = setup('a1', { b: { t: 1 }, to: 450 })
  assert.equal(turn.handle('TO').label, '终止角度')
  const opacity = setup('a1', { b: { t: 0 }, to: 127 })
  assert.deepEqual([opacity.handle('TO').min, opacity.handle('TO').max], [0, 255])
})

test('SXI particle bounds edit just the active endpoint and do not expose a single-pass duration', () => {
  const model = { i_p: [7], count: 2, rate: 4, duration: 300, velocity: [20, 120], v_direction: [-90, -45] }
  const { edit, handle, writes } = setup('a4', model)
  const speed = handle('VELOCITY')
  const direction = handle('VELOCITY_DIRECTION', 1)
  assert.equal(speed.max, 120)
  assert.equal(direction.min, -90)
  assert.equal(handle('DURATION'), undefined)
  assert.deepEqual(edit.preview(speed, 40).particles[0].emitter.velocity, [40, 120])
  assert.deepEqual(edit.preview(direction, -30).particles[0].emitter.velocityDirection, [-90, -30])
  edit.commit(direction, -30)
  assert.deepEqual(writes, [['v_direction', [-90, -30]]])
  assert.deepEqual(model.v_direction, [-90, -45])
})

test('SXI uses d for explicit frame timing and omits handles for fallbacks or unsupported previews', () => {
  const frames = setup('af2', { file: 'tap.webp', d: 200, delay: 20 })
  const duration = frames.handle('DURATION')
  assert.equal(frames.edit.preview(duration, 300).images[0].duration, 300)
  frames.edit.commit(duration, 300)
  assert.deepEqual(frames.writes, [['d', 300]])

  assert.equal(setup('af2', { file: 'tap.webp', d: 0 }).edit, undefined)
  assert.equal(setup('af2', { d: 200 }).edit, undefined)
  assert.equal(setup('a4', { velocity: [0, 100] }).edit, undefined)
  assert.equal(setup('a1', { b: { t: 5 }, to_p: [0, 1], duration: 200 }).edit, undefined)
  assert.equal(setup('a1', { b: { t: 2 }, from_px: [0, 0], to_p: [0, 1] }).edit, undefined)
  assert.equal(setup('a1', { b: { t: 1 }, to: 'rand(0,90)' }).edit, undefined)
  assert.equal(setup('a10', { d: 200 }).edit, undefined)
})
