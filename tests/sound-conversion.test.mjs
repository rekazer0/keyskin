import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { SkinArchive } from '../src/skin.ts'
import { convertBdaArchive } from '../src/bda-convert.ts'
import { bdaSoundResourceType, updateBdaKeySound } from "../src/bda-encode.ts"
import { decodeAiffPcm } from '../src/sounds.ts'
import { IniDocument } from '../src/ini.ts'

const ogg = new Uint8Array(readFileSync(new URL('./fixtures/click.ogg', import.meta.url)))

function aiff(frames = 32) {
  const ssndLength = 8 + frames * 2
  const bytes = new Uint8Array(12 + 26 + 8 + ssndLength)
  const view = new DataView(bytes.buffer)
  const ascii = (offset, text) => [...text].forEach((char, index) => { bytes[offset + index] = char.charCodeAt(0) })
  ascii(0, 'FORM'); view.setUint32(4, bytes.length - 8); ascii(8, 'AIFF')
  ascii(12, 'COMM'); view.setUint32(16, 18); view.setUint16(20, 1); view.setUint32(22, frames); view.setUint16(26, 16)
  // 22050 Hz as an 80-bit extended float
  view.setUint16(28, 0x400d); view.setUint32(30, 0xac440000); view.setUint32(34, 0)
  ascii(38, 'SSND'); view.setUint32(42, ssndLength)
  for (let frame = 0; frame < frames; frame++) view.setInt16(54 + frame * 2, frame % 2 ? 8000 : -8000)
  return bytes
}

// 32-bit float AIFC, as written by macOS afconvert (seen in real skins with .aif key sounds)
function aifcFloat32(samples = [0.5, -0.25, 1, -1]) {
  const ssndLength = 8 + samples.length * 4
  const bytes = new Uint8Array(12 + 8 + 24 + 8 + ssndLength)
  const view = new DataView(bytes.buffer)
  const ascii = (offset, text) => [...text].forEach((char, index) => { bytes[offset + index] = char.charCodeAt(0) })
  ascii(0, 'FORM'); view.setUint32(4, bytes.length - 8); ascii(8, 'AIFC')
  ascii(12, 'COMM'); view.setUint32(16, 24); view.setUint16(20, 1); view.setUint32(22, samples.length); view.setUint16(26, 32)
  view.setUint16(28, 0x400d); view.setUint32(30, 0xac440000); view.setUint32(34, 0)
  ascii(38, 'fl32'); ascii(42, '\x00\x00')
  ascii(44, 'SSND'); view.setUint32(48, ssndLength)
  samples.forEach((sample, index) => view.setFloat32(60 + index * 4, sample))
  return bytes
}

const isAiff = (bytes) => strFromU8(bytes.subarray(0, 4)) === 'FORM' && strFromU8(bytes.subarray(8, 12)) === 'AIFF'
const isOgg = (bytes) => strFromU8(bytes.subarray(0, 4)) === 'OggS'

test('BDS → BDI adds an AIFF copy of Ogg key sounds and points PRESS_SOUND_PATH at it', async () => {
  const archive = SkinArchive.open(zipSync({
    'Info.txt': strToU8('AtomSkinName=test'),
    'port/py_9.ini': strToU8('[PANEL]\nSOUND_STYLE=7\n'),
    'res/default.css': strToU8('[GLOBAL]\nSTYLE_NUM=7\n\n[STYLE7]\nPRESS_SOUND_PATH=click.ogg\n'),
    'res/click.ogg': ogg,
  }))
  const files = unzipSync(await archive.toBytesAsync('bdi'))
  assert.ok(isOgg(files['skin/res/click.ogg']))
  assert.ok(isAiff(files['skin/res/click.aiff']))
  assert.match(strFromU8(files['skin/res/default.css']), /^PRESS_SOUND_PATH=click\.aiff$/m)
})

test('BDI → BDS encodes AIFF key sounds as Ogg Vorbis and keeps the BOM', async () => {
  const archive = SkinArchive.open(zipSync({
    'skin/Info.txt': strToU8('AtomSkinName=test'),
    'skin/port/py_9.ini': strToU8('[PANEL]\nSOUND_STYLE=1\n'),
    'skin/res/default.css': strToU8('\ufeff[STYLE1]\r\nPRESS_SOUND_PATH=tap.aiff\r\n'),
    'skin/res/tap.aiff': aiff(),
  }), 'bdi')
  const files = unzipSync(await archive.toBytesAsync('bds'))
  assert.ok(isAiff(files['res/tap.aiff']))
  assert.ok(isOgg(files['res/tap.ogg']))
  assert.deepEqual([...files['res/default.css'].subarray(0, 3)], [0xef, 0xbb, 0xbf])
  assert.equal(strFromU8(files['res/default.css']).replace(/^\ufeff/, ''), '[STYLE1]\r\nPRESS_SOUND_PATH=tap.ogg\r\n')
})

test('float AIFC decodes and converts to Ogg for BDS', async () => {
  const decoded = decodeAiffPcm(aifcFloat32())
  assert.equal(decoded.sampleRate, 22050)
  assert.deepEqual([...decoded.channelData[0]], [0.5, -0.25, 1, -1])
  const archive = SkinArchive.open(zipSync({
    'skin/port/py_9.ini': strToU8('[PANEL]\nSOUND_STYLE=1\n'),
    'skin/res/default.css': strToU8('[STYLE1]\nPRESS_SOUND_PATH=tap.aif\n'),
    'skin/res/tap.aif': aifcFloat32(Array.from({ length: 2048 }, (_, i) => Math.sin(i / 8) / 2)),
  }), 'bdi')
  const warnings = []
  const files = unzipSync(await archive.toBytesAsync('bds', warnings))
  assert.deepEqual(warnings, [])
  assert.ok(isOgg(files['res/tap.ogg']))
  assert.match(strFromU8(files['res/default.css']), /^PRESS_SOUND_PATH=tap\.ogg$/m)
})

test('BDI → BDS reuses a bundled Ogg sibling instead of transcoding', async () => {
  const archive = SkinArchive.open(zipSync({
    'skin/port/py_9.ini': strToU8('[PANEL]\nSOUND_STYLE=1\n'),
    'skin/res/default.css': strToU8('[STYLE1]\nPRESS_SOUND_PATH=tap.aiff\n'),
    'skin/res/tap.aiff': aiff(),
    'skin/res/tap.ogg': ogg,
  }), 'bdi')
  const files = unzipSync(await archive.toBytesAsync('bds'))
  assert.deepEqual(files['res/tap.ogg'], ogg)
  assert.match(strFromU8(files['res/default.css']), /^PRESS_SOUND_PATH=tap\.ogg$/m)
})

test('light and dark css are adapted separately: same-named file reused, otherwise converted', async () => {
  const css = '[STYLE1]\r\nPRESS_SOUND_PATH=tap.aiff\r\n\r\n[STYLE2]\r\nPRESS_SOUND_PATH=del.aiff\r\n'
  const archive = SkinArchive.open(zipSync({
    'skin/light/skin/port/py_9.ini': strToU8('[PANEL]\n'),
    'skin/dark/skin/port/py_9.ini': strToU8('[PANEL]\n'),
    'skin/light/skin/res/default.css': strToU8(css),
    'skin/dark/skin/res/default.css': strToU8(css),
    'skin/light/skin/res/tap.aiff': aiff(),
    'skin/light/skin/res/tap.ogg': ogg,
    'skin/light/skin/res/del.aiff': aiff(),
    'skin/dark/skin/res/tap.aiff': aiff(),
    'skin/dark/skin/res/del.aiff': aiff(),
    'skin/dark/skin/res/unused.aiff': aiff(),
  }), 'bdi')
  const files = unzipSync(await archive.toBytesAsync('bds'))
  const expected = '[STYLE1]\r\nPRESS_SOUND_PATH=tap.ogg\r\n\r\n[STYLE2]\r\nPRESS_SOUND_PATH=del.ogg\r\n'
  assert.equal(strFromU8(files['light/res/default.css']), expected)
  assert.equal(strFromU8(files['dark/res/default.css']), expected)
  assert.deepEqual(files['light/res/tap.ogg'], ogg)
  for (const path of ['light/res/del.ogg', 'dark/res/tap.ogg', 'dark/res/del.ogg']) assert.ok(isOgg(files[path]), path)
  assert.equal(files['dark/res/unused.ogg'], undefined)
})

test('BDI export keeps css that already names AIFF', async () => {
  const archive = SkinArchive.open(zipSync({
    'port/py_9.ini': strToU8('[PANEL]\n'),
    'res/default.css': strToU8('[STYLE1]\nPRESS_SOUND_PATH=tap.aiff\n'),
    'res/tap.aiff': aiff(),
    'res/tap.ogg': ogg,
  }))
  const files = unzipSync(await archive.toBytesAsync('bdi'))
  assert.equal(strFromU8(files['skin/res/default.css']), '[STYLE1]\nPRESS_SOUND_PATH=tap.aiff\n')
})

test('missing referenced sound is reported, css left unchanged', async () => {
  const warnings = []
  const archive = SkinArchive.open(zipSync({
    'port/py_9.ini': strToU8('[PANEL]\n'),
    'res/default.css': strToU8('[STYLE1]\nPRESS_SOUND_PATH=gone.ogg\n'),
  }))
  const files = unzipSync(await archive.toBytesAsync('bdi', warnings))
  assert.equal(strFromU8(files['skin/res/default.css']), '[STYLE1]\nPRESS_SOUND_PATH=gone.ogg\n')
  assert.equal(warnings.length, 1)
})

test('same-format save leaves sounds untouched', async () => {
  const source = zipSync({
    'port/py_9.ini': strToU8('[PANEL]\n'),
    'res/default.css': strToU8('[STYLE1]\nPRESS_SOUND_PATH=tap.aiff\n'),
    'res/tap.aiff': aiff(),
  })
  const files = unzipSync(await SkinArchive.open(source).toBytesAsync('bds'))
  assert.ok(files['res/tap.aiff'])
  assert.equal(files['res/tap.ogg'], undefined)
})

test('BDS → BDI repeats Info.txt in each theme folder', async () => {
  const archive = SkinArchive.open(zipSync({
    'Info.txt': strToU8('Name=x\r\nStyle=default\r\nSupportPlatform=A\r\n'),
    'light/port/py_9.ini': strToU8('[PANEL]\n'),
    'dark/port/py_9.ini': strToU8('[PANEL]\n'),
  }))
  const files = unzipSync(await archive.toBytesAsync('bdi'))
  for (const path of ['skin/Info.txt', 'skin/light/skin/Info.txt', 'skin/dark/skin/Info.txt']) {
    assert.equal(strFromU8(files[path]), 'Name=x\r\nSupportPlatform=I\r\n', path)
  }
})

test('BDA → BDS keeps key sounds', async () => {
  const template = unzipSync(new Uint8Array(readFileSync(new URL('../public/default-template.bda', import.meta.url))))
  let soundConfig = updateBdaKeySound(new Uint8Array(), 'KEY_DELETE', { type: bdaSoundResourceType('del.ogg'), resourceID: 'del.ogg' })
  soundConfig = updateBdaKeySound(soundConfig, 'default', { type: bdaSoundResourceType('tap.ogg'), resourceID: 'tap.ogg' })
  soundConfig = updateBdaKeySound(soundConfig, 'default', { type: bdaSoundResourceType('tap.aiff'), resourceID: 'tap.aiff' }, true)
  const source = SkinArchive.open(zipSync({
    ...template,
    'port/soundConfig': soundConfig,
    'res/tap.ogg': ogg,
    'res/del.ogg': ogg,
    'res/tap.aiff': aiff(),
  }), 'bda')
  const base = SkinArchive.open(new Uint8Array(readFileSync(new URL('../public/bda-base.bds', import.meta.url))))
  const result = convertBdaArchive(source, base, 'bds')
  const files = unzipSync(await result.archive.platformBytesAsync('bds'))
  const prefix = Object.keys(files).some((name) => name.startsWith('light/')) ? 'light/' : ''
  const css = strFromU8(files[`${prefix}res/default.css`])
  const tapStyle = css.match(/\[STYLE(\d+)\]\r?\nPRESS_SOUND_PATH=tap\.ogg/)?.[1]
  const delStyle = css.match(/\[STYLE(\d+)\]\r?\nPRESS_SOUND_PATH=del\.ogg/)?.[1]
  assert.ok(tapStyle && delStyle, css.slice(-200))
  assert.ok(files[`${prefix}res/tap.ogg`] && files[`${prefix}res/del.ogg`])
  const layout = strFromU8(files[`${prefix}port/py_9.ini`] ?? files[`${prefix}port/py_26.ini`])
  assert.match(layout, new RegExp(`^SOUND_STYLE=${tapStyle}$`, 'm'))
})

test('BDA → BDS does not promote a single key\'s sound to the panel default', async () => {
  const template = unzipSync(new Uint8Array(readFileSync(new URL('../public/default-template.bda', import.meta.url))))
  const soundConfig = updateBdaKeySound(new Uint8Array(), 'KEY_DELETE', { type: bdaSoundResourceType('del.ogg'), resourceID: 'del.ogg' })
  const source = SkinArchive.open(zipSync({ ...template, 'port/soundConfig': soundConfig, 'res/del.ogg': ogg }), 'bda')
  const base = SkinArchive.open(new Uint8Array(readFileSync(new URL('../public/bda-base.bds', import.meta.url))))
  const archive = convertBdaArchive(source, base, 'bds').archive
  const layouts = archive.names().filter((name) => /\/port\/[^/]+\.ini$/.test(name))
  assert.ok(layouts.length)
  for (const path of layouts) assert.equal(IniDocument.parse(archive.getText(path)).get('PANEL', 'SOUND_STYLE'), undefined, path)
})

test('BDA → BDI prefers iOS key sounds', async () => {
  const template = unzipSync(new Uint8Array(readFileSync(new URL('../public/default-template.bda', import.meta.url))))
  let soundConfig = updateBdaKeySound(new Uint8Array(), 'default', { type: 5, resourceID: 'tap.ogg' })
  soundConfig = updateBdaKeySound(soundConfig, 'default', { type: 10, resourceID: 'tap.aiff' }, true)
  const source = SkinArchive.open(zipSync({
    ...template, 'port/soundConfig': soundConfig, 'res/tap.ogg': ogg, 'res/tap.aiff': aiff(),
  }), 'bda')
  const base = SkinArchive.open(new Uint8Array(readFileSync(new URL('../public/bda-base.bds', import.meta.url))))
  const files = unzipSync(await convertBdaArchive(source, base, 'bdi').archive.platformBytesAsync('bdi'))
  const names = Object.keys(files).filter((name) => /\.(ogg|aiff|wav)$/.test(name))
  assert.ok(names.length)
  assert.ok(names.every((name) => name.endsWith('tap.aiff')), names.join())
})

// Reported 2026-10-13: a lowercase info.txt was neither renamed nor retargeted, so the IME fell back
// to its default skin and system key sound after a BDI ⇄ BDS conversion.
test('Info.txt with any filename case is renamed and retargeted on BDI ⇄ BDS conversion', async () => {
  const bds = unzipSync(await SkinArchive.open(zipSync({
    'skin/info.txt': strToU8('Name=x\nSupportPlatform=I\nStyle=default\n'),
    'skin/light/skin/INFO.TXT': strToU8('Name=x\n'),
    'skin/light/skin/port/py_9.ini': strToU8('[PANEL]\nSOUND_STYLE=1\n'),
    'skin/light/skin/res/default.css': strToU8('[STYLE1]\nPRESS_SOUND_PATH=tap.aiff\n'),
    'skin/light/skin/res/tap.aiff': aiff(),
    'skin/dark/skin/port/py_9.ini': strToU8('[PANEL]\n'),
  }), 'bdi').toBytesAsync('bds'))
  assert.deepEqual(Object.keys(bds).filter((path) => /info\.txt$/i.test(path)), ['Info.txt'])
  assert.equal(strFromU8(bds['Info.txt']), 'Name=x\nSupportPlatform=A\nStyle=default\n')
  assert.match(strFromU8(bds['light/res/default.css']), /^PRESS_SOUND_PATH=tap\.ogg$/m)
  assert.ok(isOgg(bds['light/res/tap.ogg']))

  const bdi = unzipSync(await SkinArchive.open(zipSync({
    'info.txt': strToU8('Name=x\nSupportPlatform=A\nStyle=default\n'),
    'port/py_9.ini': strToU8('[PANEL]\n'),
  }), 'bds').toBytesAsync('bdi'))
  assert.deepEqual(Object.keys(bdi).filter((path) => /info\.txt$/i.test(path)), ['skin/Info.txt'])
  assert.equal(strFromU8(bdi['skin/Info.txt']), 'Name=x\nSupportPlatform=I\n')
})

test('panel show/hide sounds are adapted like key press sounds', async () => {
  const archive = SkinArchive.open(zipSync({
    'skin/port/py_9.ini': strToU8('[PANEL]\nSOUND_STYLE=1\n'),
    'skin/res/default.css': strToU8('[STYLE1]\nPRESS_SOUND_PATH=tap.aiff\nPANEL_SHOW_SOUND_PATH=show.aiff\nPANEL_HIDE_SOUND_PATH=tap.aiff\n'),
    'skin/res/tap.aiff': aiff(),
    'skin/res/show.aiff': aiff(),
    'skin/res/show.ogg': ogg,
  }), 'bdi')
  const files = unzipSync(await archive.toBytesAsync('bds'))
  assert.equal(strFromU8(files['res/default.css']), '[STYLE1]\nPRESS_SOUND_PATH=tap.ogg\nPANEL_SHOW_SOUND_PATH=show.ogg\nPANEL_HIDE_SOUND_PATH=tap.ogg\n')
  assert.deepEqual(files['res/show.ogg'], ogg)
})

// 时光气囊 ships enter.aiff with a GuShao "JSONMETA{...}" watermark appended after the FORM chunk.
test('AIFF with data appended after the FORM chunk still converts', async () => {
  const watermarked = new Uint8Array([...aiff(), ...strToU8('JSONMETA\u0000\u0000\u0000\u0010{"marker":"x"}')])
  assert.equal(decodeAiffPcm(watermarked).samplesDecoded, 32)
  const warnings = []
  const files = unzipSync(await SkinArchive.open(zipSync({
    'skin/port/py_9.ini': strToU8('[PANEL]\nSOUND_STYLE=1\n'),
    'skin/res/default.css': strToU8('[STYLE1]\nPRESS_SOUND_PATH=enter.aiff\n'),
    'skin/res/enter.aiff': watermarked,
  }), 'bdi').toBytesAsync('bds', warnings))
  assert.deepEqual(warnings, [])
  assert.ok(isOgg(files['res/enter.ogg']))
})
