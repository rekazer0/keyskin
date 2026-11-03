import { test } from 'node:test'
import assert from 'node:assert/strict'
import { strFromU8, strToU8 } from 'fflate'
import { decodeWav } from '../src/wav.ts'
import { adaptPackageSounds, decodeAiffPcm } from '../src/sounds.ts'
import { wav } from './helpers/ssf-fixture.mjs'

const head = (bytes) => strFromU8(bytes.subarray(0, 4))

test('WAV PCM decodes signed samples and validates truncated chunks', () => {
  const bytes = wav(32)
  const decoded = decodeWav(bytes)
  assert.equal(decoded.sampleRate, 8000)
  assert.equal(decoded.samplesDecoded, 32)
  assert.equal(decoded.channelData[0][0], -6000 / 32768)
  assert.throws(() => decodeWav(bytes.subarray(0, bytes.length - 1)), /不完整/)
  const invalid = bytes.slice()
  new DataView(invalid.buffer).setUint16(20, 7, true)
  assert.throws(() => decodeWav(invalid), /编码/)
})

test('WAV key sounds are encoded as native OGG/AIFF and their references follow', async () => {
  for (const format of ['bds', 'bdi']) {
    const files = new Map([
      ['res/default.css', strToU8('[STYLE1]\nPRESS_SOUND_PATH=tap.wav\n')],
      ['res/tap.wav', wav(2048)],
    ])
    const result = await adaptPackageSounds(files, format)
    const extension = format === 'bds' ? 'ogg' : 'aiff'
    assert.deepEqual(result.warnings, [])
    assert.equal(result.converted, 1)
    assert.equal(head(files.get(`res/tap.${extension}`)), format === 'bds' ? 'OggS' : 'FORM')
    assert.match(strFromU8(files.get('res/default.css')), new RegExp(`PRESS_SOUND_PATH=tap\\.${extension}`))
    assert.equal(head(files.get('res/tap.wav')), 'RIFF')
    if (format === 'bdi') assert.equal(decodeAiffPcm(files.get('res/tap.aiff')).samplesDecoded, 2048)
  }
})

test('orientation WAV does not reuse a different shared native sibling', async () => {
  const files = new Map([
    ['port/res/default.css', strToU8('[STYLE1]\nPRESS_SOUND_PATH=tap.wav\n')],
    ['port/res/tap.wav', wav(64)],
    ['res/tap.aiff', strToU8('not the orientation sound')],
  ])
  const result = await adaptPackageSounds(files, 'bdi')
  assert.deepEqual(result.warnings, [])
  assert.equal(decodeAiffPcm(files.get('port/res/tap.aiff')).samplesDecoded, 64)
  assert.equal(strFromU8(files.get('res/tap.aiff')), 'not the orientation sound')
})

test('invalid WAV leaves the source reference and reports a conversion failure', async () => {
  const files = new Map([
    ['res/default.css', strToU8('[STYLE1]\nPRESS_SOUND_PATH=tap.wav\n')],
    ['res/tap.wav', strToU8('RIFFbroken')],
  ])
  const result = await adaptPackageSounds(files, 'bds')
  assert.equal(result.warnings.length, 1)
  assert.match(strFromU8(files.get('res/default.css')), /tap\.wav/)
  assert.equal(files.get('res/tap.ogg'), undefined)
})
