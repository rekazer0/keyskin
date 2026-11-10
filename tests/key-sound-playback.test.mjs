// 预览按键音的播放：几毫秒的音效要解码后直接播，`<audio>` 元素只作兜底。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { declarations, run } from './helpers/app-source.mjs'

const ogg = new Uint8Array(readFileSync(new URL('./fixtures/click.ogg', import.meta.url)))
const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0])
const source = declarations('keySoundBuffers', 'releaseKeySound', 'playDecodedSound', 'playSoundPath')

/** 每个用例一套假的 Web Audio / 媒体元素，记录播放走的是哪条路。 */
function harness({ bytes = ogg, decode = async () => ({ duration: 0.001 }), playElement = async () => {} } = {}) {
  const played = { sources: 0, elements: 0, decoded: 0 }
  class FakeAudio {
    constructor(src) { this.src = src; this.onended = undefined; this.preload = "" }
    play() { played.elements += 1; return playElement() }
    pause() {}
  }
  class FakeAudioContext {
    constructor() { this.state = "running"; this.destination = {} }
    async resume() {}
    decodeAudioData() { played.decoded += 1; return decode() }
    createBuffer(channels, length, sampleRate) { return { channels, length, sampleRate, copyToChannel() {} } }
    createBufferSource() {
      return { buffer: undefined, onended: undefined, connect() {}, start() { played.sources += 1 } }
    }
  }
  const context = run(source, {
    Audio: FakeAudio,
    AudioContext: FakeAudioContext,
    TextDecoder,
    Blob: class { constructor(parts, options) { this.parts = parts; this.options = options } },
    URL: { createObjectURL: () => "blob:probe", revokeObjectURL() {} },
    soundMimeType: (path) => (/\.ogg$/i.test(path) ? "audio/ogg" : "audio/wav"),
    decodeAiffPcm: () => ({ channelData: [new Float32Array(8)], samplesDecoded: 8, sampleRate: 22050 }),
    eventLog: { textContent: "" },
    archive: { getBytes: () => bytes },
    keySoundBuffers: new Map(),
  })
  /** 播放一次，返回 onFinished 的错误信息（正常播放时没有回调）。 */
  const press = (path = "light/skin/res/click.ogg") => new Promise((resolve) => {
    context.playSoundPath(path, resolve)
    setTimeout(() => resolve(undefined), 50)
  })
  return { context, played, press }
}

test('按键音先解码成 AudioBuffer 再播放，不依赖 media 元素', async () => {
  const { context, played, press } = harness()
  await press()
  assert.equal(played.decoded, 1)
  assert.equal(played.sources, 1)
  assert.equal(played.elements, 0, '解码成功就不该再走 <audio>')
  assert.equal(context.eventLog.textContent, "")
})

test('同一个音效再次点击用缓存，不再解码', async () => {
  const { played, press } = harness()
  await press()
  await press()
  assert.equal(played.decoded, 1)
  assert.equal(played.sources, 2)
})

test('解码不了的时候回退到 media 元素播放', async () => {
  const { context, played, press } = harness({ bytes: wav, decode: async () => { throw new DOMException("no decoder", "EncodingError") } })
  await press("light/skin/res/click.wav")
  assert.equal(played.elements, 1, '元素播放是兜底')
  assert.equal(played.sources, 0)
  assert.equal(context.eventLog.textContent, "")
})

test('解码和元素播放都失败时报错，并说明是哪个文件', async () => {
  const { context, press } = harness({
    bytes: wav,
    decode: async () => { throw new DOMException("no decoder", "EncodingError") },
    playElement: async () => { throw new DOMException("aborted", "AbortError") },
  })
  const error = await press("light/skin/res/click.wav")
  assert.match(error, /无法播放按键音效：click\.wav/)
  assert.equal(context.eventLog.textContent, error)
})
