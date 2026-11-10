// 按键音效在百度（BDS/BDI）与搜狗（SSF）之间转换时的边界情况：
// 搜狗皮肤里的音效文件可能不是 WAV，也可能带百度播不了、这里也解不了的 MP3。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { SkinArchive } from '../src/skin.ts'
import { convertBaiduToSsf } from '../src/ssf/baidu-to-ssf.ts'
import { convertSsfDocument } from '../src/ssf/ssf-convert.ts'

const ogg = new Uint8Array(readFileSync(new URL('./fixtures/click.ogg', import.meta.url)))
const sogouTemplate = SkinArchive.open(new Uint8Array(readFileSync(new URL('../public/sogou-template.bds', import.meta.url))))
// 只转 BDS/BDI：这条路径只用到搜狗基础布局。
const templates = { sogou: sogouTemplate }

function aiff(frames = 32) {
  const ssndLength = 8 + frames * 2
  const bytes = new Uint8Array(12 + 26 + 8 + ssndLength)
  const view = new DataView(bytes.buffer)
  const ascii = (offset, text) => [...text].forEach((char, index) => { bytes[offset + index] = char.charCodeAt(0) })
  ascii(0, 'FORM'); view.setUint32(4, bytes.length - 8); ascii(8, 'AIFF')
  ascii(12, 'COMM'); view.setUint32(16, 18); view.setUint16(20, 1); view.setUint32(22, frames); view.setUint16(26, 16)
  view.setUint16(28, 0x400d); view.setUint32(30, 0xac440000); view.setUint32(34, 0)
  ascii(38, 'SSND'); view.setUint32(42, ssndLength)
  for (let frame = 0; frame < frames; frame++) view.setInt16(54 + frame * 2, frame % 2 ? 8000 : -8000)
  return bytes
}

/** 16-bit PCM WAV with a different waveform per frequency, so two sounds never compare equal. */
function wav(hz = 440, frames = 2048) {
  const bytes = new Uint8Array(44 + frames * 2)
  const view = new DataView(bytes.buffer)
  const ascii = (offset, text) => [...text].forEach((char, index) => { bytes[offset + index] = char.charCodeAt(0) })
  ascii(0, 'RIFF'); view.setUint32(4, 36 + frames * 2, true); ascii(8, 'WAVE')
  ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, 22050, true); view.setUint32(28, 44100, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  ascii(36, 'data'); view.setUint32(40, frames * 2, true)
  for (let frame = 0; frame < frames; frame++) view.setInt16(44 + frame * 2, Math.round(Math.sin(frame * hz / 1000) * 8000), true)
  return bytes
}

const isOgg = (bytes) => bytes !== undefined && strFromU8(bytes.subarray(0, 4)) === 'OggS'

/** One Baidu theme with a single default key sound. */
function baiduSkin(files) {
  return SkinArchive.open(zipSync({
    'Info.txt': strToU8('Name=probe\r\nStyle=default\r\n'),
    'port/gen.ini': strToU8('[PANEL]\r\nSOUND_STYLE=1\r\n'),
    'port/py_9.ini': strToU8('[PANEL]\r\nKEY_NUM=1\r\n\r\n[KEY1]\r\nCENTER=q\r\n'),
    'res/default.css': strToU8('[GLOBAL]\r\nSTYLE_NUM=1\r\n\r\n[STYLE1]\r\nPRESS_SOUND_PATH=click.ogg\r\n'),
    'res/click.ogg': ogg,
    ...files,
  }))
}

/** The Sogou skin the fixture above converts to, with `default/` replaced by `sound` only. */
async function sogouSkin(sound) {
  const files = unzipSync((await convertBaiduToSsf(baiduSkin())).bytes)
  for (const path of Object.keys(files)) if (path.startsWith('default/') && /\.(wav|ogg|mp3|aiff?)$/i.test(path)) delete files[path]
  files['default/sound_android.ini'] = strToU8('[General]\nSUPPORT_SCREEN=1080\nVERSION=1\n[Key]\nsound=bell\n')
  Object.assign(files, sound)
  return SkinArchive.open(zipSync(files), 'ssf')
}

test('SSF 的音效文件是 AIFF 时，转 BDS 仍生成 Ogg 并保留引用', async () => {
  const ssf = await sogouSkin({ 'default/bell.aiff': aiff() })
  const out = await convertSsfDocument(ssf, 'bds', templates)
  const files = unzipSync(out.bytes)
  assert.equal(files['res/bell.aiff']?.length, aiff().length, '原文件保留')
  assert.ok(isOgg(files['res/bell.ogg']), '生成 Android 能播的 Ogg')
  assert.match(strFromU8(files['res/default.css']), /^PRESS_SOUND_PATH=bell\.ogg$/m)
  assert.deepEqual(out.warnings.filter((warning) => /音效|按键音/.test(warning)), [])
})

test('SSF 的音效文件是 AIFF 时，转 BDI 直接引用 AIFF', async () => {
  const ssf = await sogouSkin({ 'default/bell.aiff': aiff() })
  const files = unzipSync((await convertSsfDocument(ssf, 'bdi', templates)).bytes)
  assert.equal(files['skin/res/bell.aiff']?.length, aiff().length)
  assert.match(strFromU8(files['skin/res/default.css']), /^PRESS_SOUND_PATH=bell\.aiff$/m)
})

test('SSF 的音效文件是 MP3 时，转 BDS 报警而不是静默带上百度播不了的文件', async () => {
  const ssf = await sogouSkin({ 'default/bell.mp3': strToU8('ID3 fake') })
  const out = await convertSsfDocument(ssf, 'bds', templates)
  const files = unzipSync(out.bytes)
  assert.ok(out.warnings.some((warning) => /bell\.mp3 无法转换为 OGG/.test(warning)), out.warnings.join('\n'))
  assert.ok(files['res/bell.mp3'], '文件照旧保留，用户可以自己替换')
})

test('面板显示/隐藏音效在转 SSF 时给出提示', async () => {
  const source = baiduSkin({
    'res/default.css': strToU8('[GLOBAL]\r\nSTYLE_NUM=1\r\n\r\n[STYLE1]\r\nPRESS_SOUND_PATH=click.ogg\r\nPANEL_SHOW_SOUND_PATH=show.wav\r\nPANEL_HIDE_SOUND_PATH=hide.wav\r\n'),
    'res/show.wav': wav(880),
    'res/hide.wav': wav(1320),
  })
  const out = await convertBaiduToSsf(source)
  assert.ok(out.warnings.some((warning) => warning.includes('面板显示/隐藏音效')), out.warnings.join('\n'))
})

test('搜狗没有对应按键区段的音效不会被复制成无人引用的文件', async () => {
  const source = baiduSkin({
    'port/py_9.ini': strToU8('[PANEL]\r\nKEY_NUM=2\r\n\r\n[KEY1]\r\nCENTER=q\r\n\r\n[KEY2]\r\nCENTER=zzz\r\nSOUND_STYLE=7\r\n'),
    'res/default.css': strToU8('[GLOBAL]\r\nSTYLE_NUM=7\r\n\r\n[STYLE1]\r\nPRESS_SOUND_PATH=click.ogg\r\n\r\n[STYLE7]\r\nPRESS_SOUND_PATH=del.wav\r\n'),
    'res/del.wav': wav(440),
  })
  const files = unzipSync((await convertBaiduToSsf(source)).bytes)
  assert.deepEqual(Object.keys(files).filter((path) => /\.wav$/i.test(path)), ['default/click.wav'])
  assert.doesNotMatch(strFromU8(files['default/sound_android.ini']), /del/)
})
