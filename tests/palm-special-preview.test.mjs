import test from 'node:test'
import assert from 'node:assert/strict'
import { unzipSync } from 'fflate'
import { motionAt } from '../src/native-motion.ts'
import { palmPreviewClip } from '../src/palm/palm-preview-clip.ts'
import { animationTable, sxiAnimationFixture } from './helpers/sxi-animation-fixture.mjs'

const files = unzipSync(sxiAnimationFixture())
const source = Object.entries(files).find(([name]) => /\.png$/i.test(name))[1]
const readFile = file => file === 'ball.png' ? source : files[file]
const size = { width: 64, height: 64 }
const sample = (clip, time) => {
  const image = clip.images[0]
  return motionAt(image.tracks, time - image.start, size)
}

function collision(changes) {
  const table = animationTable()
  Object.assign(table[106].a11, {
    g: 0, v: [40, 8], dir: [0, 1], a_vel: 90, a_resist: 0, resist: 0,
    rest: 1, fric: 0, collision_rect: [[0, 0], [20, 20]], launch_point: [10, 10], duration: 1000,
  }, changes)
  const before = JSON.stringify(table)
  const clip = palmPreviewClip(table, '106', { readFile })
  assert.equal(JSON.stringify(table), before)
  return clip
}

test('a10 identifies missing and unverified path resources without turning start and restore points into a path', () => {
  const table = animationTable()
  const missing = palmPreviewClip(table, '105', { readFile })
  assert.match(missing.notes.join(), /找不到.*path\.json/)
  const unverified = palmPreviewClip(table, '105', { readFile: () => new TextEncoder().encode('[[10,20],[50,50]]') })
  assert.match(unverified.notes.join(), /暂不支持.*path\.json/)
  for (const clip of [missing, unverified]) {
    assert.deepEqual([clip.duration, clip.tracks.length, clip.images.length], [0, 0, 0])
  }
  delete table[105].a10.file
  assert.match(palmPreviewClip(table, '105', { readFile }).notes.join(), /路径文件未设置/)
})

test('a11 attaches a seekable bounce and spin to the actual image, not the key', () => {
  const clip = collision({ delay: 50, use_touch: true })
  assert.equal(clip.duration, 1050)
  assert.equal(clip.images[0].file, 'ball.png')
  assert.deepEqual(clip.tracks, [])
  assert.equal(sample(clip, 49), undefined)
  assert.deepEqual(sample(clip, 50).translation, [0, 0])
  assert.ok(sample(clip, 300).translation[0] > 9.9)
  assert.ok(sample(clip, 550).translation[0] < 1)
  assert.ok(Math.abs(sample(clip, 550).rotation - 45) < 1e-8)
  assert.equal(sample(clip, 1050), undefined)
  assert.match(clip.notes.join(), /近似预览.*不跟随触摸/)
})

test('a11 samples gravity direction, restitution, friction and both kinds of drag', () => {
  const original = sample(collision({}), 500)
  const slowed = sample(collision({ rest: 0.25, fric: 0.5, a_resist: 1 }), 500)
  assert.ok(slowed.translation[0] > original.translation[0])
  assert.ok(slowed.translation[1] < original.translation[1])
  assert.ok(slowed.rotation < original.rotation)
  assert.ok(sample(collision({ resist: 10 }), 100).translation[0] < sample(collision({}), 100).translation[0])
  const fall = sample(collision({ v: [0, 0], g: 16, dir: [-2, 0] }), 500)
  assert.ok(fall.translation[0] < -2)
  assert.equal(fall.translation[1], 0)
})

test('a11 follows combination delay and alternate passes without moving the image-local clock', () => {
  const table = animationTable()
  table[106].a11.b.back = true
  table[110] = { a3: { a_method: 'sequential', animations: [100, 106] } }
  const clip = palmPreviewClip(table, '110', { readFile })
  assert.equal(clip.images[0].start, 320)
  assert.equal(clip.duration, 2120)
  assert.equal(clip.lanes[1].label, '动画 106 · 碰撞物理')
  assert.deepEqual(sample(clip, 320 + 450), sample(clip, 320 + 1350))
  assert.match(clip.notes.join(), /发射位置超出碰撞区域/)
})

test('a11 does not substitute a sample key when the image or collision configuration is unavailable', () => {
  const clip = palmPreviewClip(animationTable(), '106', { readFile: file => files[file] })
  assert.equal(clip.images.length, 0)
  assert.match(clip.notes.join(), /找不到.*ball\.png/)
  assert.match(collision({ collision_rect: [[0, 0], [0, 100]] }).notes.join(), /有效的碰撞区域/)
  assert.match(collision({ duration: 0 }).notes.join(), /时长/)
})
