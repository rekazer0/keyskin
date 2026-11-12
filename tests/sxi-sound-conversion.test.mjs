import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { strToU8, zipSync } from 'fflate'
import { SkinArchive } from '../src/skin.ts'
import { buildSxiZipAsync } from '../src/palm/palm-export.ts'
import { convertSxiToBaidu } from '../src/palm/sxi-to-baidu.ts'
import { convertSsfSxi } from '../src/palm/ssf-sxi-convert.ts'
import { SsfPackage } from '../src/ssf/ssf-package.ts'
import { decodeAiffPcm } from '../src/sounds.ts'
import { decodeWav } from '../src/wav.ts'
import { wav } from './helpers/ssf-fixture.mjs'

const ogg = new Uint8Array(readFileSync(new URL('./fixtures/click.ogg', import.meta.url)))
const head = bytes => new TextDecoder().decode(bytes?.subarray(0, 4))

function source(extension, bytes, extra = {}) {
  const files = { 'Info.txt': strToU8('Name=Sound conversion\n') }
  for (const theme of ['light', 'dark']) {
    files[`${theme}/port/gen.ini`] = strToU8('[PANEL]\nSIZE=300,120\nSOUND_STYLE=1\n')
    files[`${theme}/port/py_26.ini`] = strToU8('[PANEL]\nKEY_NUM=1\n[KEY1]\nCENTER=q\nVIEW_RECT=0,0,100,120\n')
    files[`${theme}/res/default.css`] = strToU8(`[STYLE1]\nPRESS_SOUND_PATH=tap.${extension}\nPANEL_SHOW_SOUND_PATH=tap.${extension}\nPANEL_HIDE_SOUND_PATH=tap.${extension}\n`)
    files[`${theme}/res/tap.${extension}`] = bytes
  }
  return SkinArchive.open(zipSync({ ...files, ...extra }), 'bds')
}

test('手心导出将 OGG/WAV 转成 AIFF，并同步两种外观的全部音效引用', async () => {
  for (const [extension, bytes] of [['ogg', ogg], ['wav', wav(128)]]) {
    const input = source(extension, bytes)
    const result = await buildSxiZipAsync(input)
    const output = SkinArchive.open(result.bytes, 'sxi')
    const skin = JSON.parse(output.getText('skin.json'))
    assert.deepEqual(result.warnings, [])
    for (const [theme, model] of [['light', skin.default], ['dark', skin.night]]) {
      assert.deepEqual(model.s_info.ss_1['1'].s_4, { path_1: 'tap.aiff', path_2: 'tap.aiff', path_3: 'tap.aiff' })
      const path = `${theme}/skin/res/tap.aiff`
      assert.ok(model.r_info.includes(path), path)
      assert.equal(head(output.getBytes(path)), 'FORM')
      const decoded = decodeAiffPcm(output.getBytes(path))
      assert.ok(decoded.samplesDecoded > 0)
      if (extension === 'wav') assert.equal(decoded.samplesDecoded, 128)
    }
    assert.match(input.getText('light/skin/res/default.css'), new RegExp(`tap\\.${extension}`), '导出不修改原文档')
  }
})

test('手心导出复用同目录 AIFF，并保留 iOS 来源的原音效', async () => {
  const native = SkinArchive.open((await buildSxiZipAsync(source('wav', wav(96)))).bytes, 'sxi').getBytes('light/skin/res/tap.aiff')
  const input = source('ogg', ogg, { 'light/res/tap.aiff': native, 'dark/res/tap.aiff': native })
  for (const archive of [input, SkinArchive.open(await input.toBytesAsync('bdi'), 'bdi')]) {
    const result = await buildSxiZipAsync(archive)
    const output = SkinArchive.open(result.bytes, 'sxi')
    assert.deepEqual(result.warnings, [])
    assert.deepEqual(output.getBytes('light/skin/res/tap.aiff'), native)
    assert.equal(JSON.parse(output.getText('skin.json')).default.s_info.ss_1['1'].s_4.path_1, 'tap.aiff')
  }
})

test('手心音效转回百度和搜狗后，文件编码与引用匹配目标平台', async () => {
  const palm = SkinArchive.open((await buildSxiZipAsync(source('wav', wav(128)))).bytes, 'sxi')
  for (const [format, extension, magic] of [['bds', 'ogg', 'OggS'], ['bdi', 'aiff', 'FORM']]) {
    const converted = await convertSxiToBaidu(palm, format)
    const output = SkinArchive.open(converted.bytes, format)
    assert.equal(head(output.getBytes(`light/skin/res/tap.${extension}`)), magic)
    assert.match(output.getText('light/skin/res/default.css'), new RegExp(`PRESS_SOUND_PATH=tap\\.${extension}`))
  }
  const sogou = await SsfPackage.open((await convertSsfSxi(palm)).bytes)
  const name = sogou.ini('default/sound_android.ini').get('Key', 'sound')
  assert.equal(decodeWav(sogou.files.get(`default/${name}.wav`)).samplesDecoded, 128)
})

test('手心导出的音效转码失败会报告，并保留源文件与原引用', async () => {
  const result = await buildSxiZipAsync(source('ogg', strToU8('broken')))
  assert.ok(result.warnings.some(warning => /tap\.ogg.*无法转换为 AIFF/.test(warning)))
  const output = SkinArchive.open(result.bytes, 'sxi')
  assert.equal(JSON.parse(output.getText('skin.json')).default.s_info.ss_1['1'].s_4.path_1, 'tap.ogg')
  assert.equal(head(output.getBytes('light/skin/res/tap.ogg')), 'brok')
})
