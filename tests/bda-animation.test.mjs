import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bdaAnimationBytes, bdaAnimationFixture } from './helpers/bda-animation-fixture.mjs'
import { decodeBdaAnimation } from '../src/bda-decode.ts'
import { updateBdaAnimationEffect, updateBdaAnimationWidth, updateBdaAnimationFrame, rawFields, rawString } from '../src/bda-encode.ts'
import { SkinArchive } from '../src/skin.ts'
import { convertBdaPlatform } from '../src/bda-platform.ts'

const original = bdaAnimationBytes()
const effect = (bytes, id) => decodeBdaAnimation(bytes).effects.get(id)
const cases = [
  ['group:press', 'repeatCount', 7], ['group:press', 'repeatMode', 1], ['group:press', 'delay', 90], ['group:press', 'buildMode', 1],
  ['alpha:fade', 'repeatCount', 4], ['alpha:fade', 'repeatMode', 0], ['alpha:fade', 'delay', 80], ['alpha:fade', 'duration', 420], ['alpha:fade', 'interpolation', 3],
  ['scale:zoom', 'duration', 320], ['shift:move', 'duration', 480], ['rotate:turn', 'duration', 360],
  ['image:spark', 'loopForever', false], ['image:spark', 'startRepeatFrame', 0], ['image:spark', 'repeatCount', 6],
  ['emitter:snow', 'duration', 2.75], ['emitter:snow', 'birthRate', 17], ['emitter:snow', 'totalNumber', 60],
  ...['frame:webp', 'lottie:vector', 'video:movie'].flatMap((id) => [[id, 'resourceID', 'replacement'], [id, 'repeatCount', 5], [id, 'removeOnFinish', false]]),
  ...['group:press', 'alpha:fade', 'scale:zoom', 'shift:move', 'rotate:turn', 'image:spark', 'emitter:snow'].map((id) => [id, 'removeOnFinish', false]),
]

for (const [id, property, value] of cases) test(`BDA ${id}.${property} edits the map value and preserves other effects`, () => {
  const next = updateBdaAnimationEffect(original, id, property, value)
  const decoded = decodeBdaAnimation(next)
  const wanted = effect(next, id)
  assert.equal(property === 'resourceID' ? wanted.resource.resourceID : wanted[property], value)
  assert.equal(decoded.effects.size, 10)
  assert.deepEqual(decoded.targetBindings, decodeBdaAnimation(original).targetBindings)
  for (const [otherID, other] of decoded.effects) if (otherID !== id) assert.deepEqual(other, effect(original, otherID))
  const unknown = rawFields(next).find((field) => field.number === 101)
  assert.equal(rawString(unknown), 'root-unknown')
})

test('animation design width uses field 12, preserving every shift effect and unknown bytes', () => {
  const next = updateBdaAnimationWidth(original, 1242)
  assert.equal(decodeBdaAnimation(next).designWidth, 1242)
  const withoutWidth = (bytes) => rawFields(bytes).filter((f) => f.number !== 12).map((f) => bytes.slice(f.start, f.end))
  assert.deepEqual(withoutWidth(next), withoutWidth(original))
})

test('transform ranges edit scalar/vector and pixel fields, preserving the other bounds', () => {
  for (const [id, property, path, value] of [
    ['alpha:fade', 'fromMin', ['from', 0, 0], 64], ['rotate:turn', 'toMax', ['to', 0, 1], 180],
    ['scale:zoom', 'fromYMax', ['from', 1, 1], 95], ['shift:move', 'toXMin', ['to', 0, 0], 35],
  ]) {
    const before = structuredClone(effect(original, id))
    const next = effect(updateBdaAnimationEffect(original, id, property, value), id)
    before[path[0]][path[1]][path[2]] = value
    if (id.startsWith('alpha') || id.startsWith('rotate')) before[path[0]][1][path[2]] = value
    assert.deepEqual(next, before)
  }
})

test('particle ranges remain float location/length, and updating min preserves the previous max', () => {
  for (const property of ['life', 'rotation', 'spin', 'scale', 'scaleSpeed', 'alpha', 'alphaSpeed', 'velocity', 'velocityDirection', 'acceleration', 'accelerationDirection']) {
    const next = updateBdaAnimationEffect(original, 'emitter:snow', `${property}Min`, -0.5)
    assert.deepEqual(effect(next, 'emitter:snow')[property], [-0.5, effect(original, 'emitter:snow')[property][1]])
    const max = updateBdaAnimationEffect(next, 'emitter:snow', `${property}Max`, 8.25)
    assert.deepEqual(effect(max, 'emitter:snow')[property], [-0.5, 8.25])
  }
  const next = updateBdaAnimationEffect(original, 'emitter:snow', 'emitLeft', -0.25)
  assert.deepEqual(effect(next, 'emitter:snow').emitRegion, [-0.25, 0, 1, 1])
})

test('editing keeps unknown map/value/range/resource fields verbatim', () => {
  let next = updateBdaAnimationEffect(original, 'alpha:fade', 'fromMin', 80)
  next = updateBdaAnimationEffect(next, 'frame:webp', 'resourceID', 'new.webp')
  next = updateBdaAnimationFrame(next, 'spark', 1, 'duration', 900)
  for (const text of ['entry-unknown', 'range-unknown', 'effect-unknown', 'resource-unknown', 'sequence-unknown', 'binding-unknown', 'root-unknown']) {
    const count = (bytes) => new TextDecoder().decode(bytes).split(text).length
    assert.equal(count(next), count(original), text)
  }
  assert.equal(decodeBdaAnimation(next).sequences.get('spark').frames[1].duration, 900)
})

test('invalid edits reject rather than truncate/wrap numbers or write into unrelated fields', () => {
  for (const value of [-1, 1.5, Infinity, NaN, 2 ** 32]) assert.throws(() => updateBdaAnimationEffect(original, 'alpha:fade', 'duration', value))
  assert.throws(() => updateBdaAnimationWidth(original, 0))
  assert.throws(() => updateBdaAnimationEffect(original, 'video:movie', 'interpolation', 1))
  assert.throws(() => updateBdaAnimationEffect(original, 'alpha:missing', 'duration', 1))
})

test('BDA edited animation survives save/reopen across themes, orientations, numbered and light configs', async () => {
  const bytes = bdaAnimationFixture()
  const archive = SkinArchive.open(bytes, 'bda')
  assert.deepEqual(archive.toBytes(), bytes)
  const path = 'light/skin/port/animationConfig'
  const next = updateBdaAnimationEffect(archive.getBytes(path), 'alpha:fade', 'duration', 540)
  archive.setBytes(path, next)
  const reopened = SkinArchive.open(await archive.toBytesAsync(), 'bda')
  assert.deepEqual(reopened.getBytes(path), next)
  const configs = archive.names().filter((path) => /animationConfig$/i.test(path))
  assert.equal(configs.length, 12)
  for (const name of archive.names()) assert.deepEqual(reopened.getBytes(name), archive.getBytes(name), name)
  for (const platform of ['ios', 'android']) {
    const converted = convertBdaPlatform(archive, platform)
    for (const name of configs) assert.deepEqual(converted.getBytes(name), archive.getBytes(name), `${platform}:${name}`)
  }
})
