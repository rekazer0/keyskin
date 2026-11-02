import test from 'node:test'
import assert from 'node:assert/strict'
import { declarations, run } from './helpers/app-source.mjs'

function player(play = () => Promise.resolve()) {
  const audios = []
  const context = run(declarations('releaseKeySound', 'playSoundPath'), {
    Uint8Array, Blob, Error, DOMException,
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    Audio: class {
      constructor() { audios.push(this) }
      pause() {}
      play() { return play(this) }
    },
    archive: { getBytes: () => new Uint8Array([1]) },
    soundMimeType: () => 'audio/wav', eventLog: {},
  })
  return { context, audios }
}

test('sound completion, stop and replacement clear playback and notify once', () => {
  const { context, audios } = player()
  const ended = []
  context.playSoundPath('a.wav', () => ended.push('a'))
  context.playSoundPath('b.wav', () => ended.push('b'))
  assert.deepEqual(ended, ['a'])
  audios[0].onended()
  assert.equal(context.keySoundPath, 'b.wav', 'an old ended event cannot stop the new sound')
  audios[1].onended()
  context.releaseKeySound()
  assert.equal(context.keySoundPath, '')
  assert.deepEqual(ended, ['a', 'b'])
})

test('playback errors reach the caller; stale async failures do not affect the new sound', async () => {
  let reject
  const { context } = player(() => new Promise((_, fail) => { reject = fail }))
  const results = []
  context.playSoundPath('a.wav', error => results.push(error))
  const oldReject = reject
  context.playSoundPath('b.wav', error => results.push(error))
  oldReject(new Error('old failure'))
  await Promise.resolve()
  assert.equal(context.keySoundPath, 'b.wav')
  reject(new Error('decode failed'))
  await Promise.resolve()
  assert.match(results.at(-1), /decode failed/)
  assert.equal(context.keySoundPath, '')
})
