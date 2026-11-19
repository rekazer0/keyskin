import { test } from 'node:test'
import assert from 'node:assert/strict'
import { strToU8, unzipSync } from 'fflate'
import { IniDocument } from '../src/ini.ts'
import { SkinArchive } from '../src/skin.ts'
import { PalmBoard } from '../src/palm/palm-board.ts'
import { buildSxiZip, buildSxiZipAsync } from '../src/palm/palm-export.ts'
import { convertSxiToBaidu, sxiToBaiduArchive } from '../src/palm/sxi-to-baidu.ts'
import { convertBaiduToSsf } from '../src/ssf/baidu-to-ssf.ts'
import { convertSsfToBaidu } from '../src/ssf/ssf-to-baidu.ts'
import { SsfPackage } from '../src/ssf/ssf-package.ts'
import { decodePng, encodePng } from '../src/ssf/ssf-png.ts'
import { bdsFixture } from './helpers/baidu-fixture.mjs'
import { solid } from './helpers/ssf-fixture.mjs'

const red = [255, 0, 0, 255], green = [0, 255, 0, 255], blue = [0, 0, 255, 255]
const read = (archive, path) => IniDocument.parse(archive.getText(path))
const firstPixel = (bytes) => [...decodePng(bytes).data.slice(0, 4)]

function source(platform = 'A', highlight = true) {
  const files = unzipSync(bdsFixture())
  files['Info.txt'] = strToU8(`Name=候选栏测试\nSupportPlatform=${platform}\n`)
  const doc = IniDocument.parse(new TextDecoder().decode(files['light/port/cand1.cnd']))
  doc.set('CAND', 'BACK_STYLE', '2') // Same style as KEY1; converting the bar must not recolor the key.
  files['light/port/cand1.cnd'] = strToU8(doc.toString())
  const css = IniDocument.parse(new TextDecoder().decode(files['light/res/default.css']))
  css.set('STYLE2', 'NM_IMG', 'normal,1')
  if (highlight) css.set('STYLE2', 'HL_IMG', 'highlight,1')
  else css.remove('STYLE2', 'HL_IMG')
  files['light/res/default.css'] = strToU8(css.toString())
  for (const [name, color] of [['normal', red], ['highlight', green], ['land', blue]]) {
    files[`light/res/${name}.png`] = encodePng(solid(4, 4, color))
    files[`light/res/${name}.til`] = strToU8('[IMG1]\nSOURCE_RECT=0,0,4,4\n')
  }
  for (const name of ['gen.ini', 'py_26.ini', 'cand1.cnd']) files[`light/land/${name}`] = files[`light/port/${name}`]
  if (highlight) css.set('STYLE2', 'HL_IMG', 'land,1')
  files['light/land/res/default.css'] = strToU8(css.toString())
  return SkinArchive.fromFiles(new Map(Object.entries(files)), 'bds')
}

async function ssf(archive) {
  return SsfPackage.open((await convertBaiduToSsf(archive, { animations: false })).bytes)
}

function baiduBar(archive, orientation, android) {
  const root = 'light/skin/'
  const local = `${root}${orientation}/res/default.css`
  const css = read(archive, archive.isText(local) ? local : `${root}res/default.css`)
  const gen = read(archive, `${root}${orientation}/gen.ini`)
  const cand = read(archive, `${root}${orientation}/${gen.get('CAND', 'LAYOUT_NAME')}.cnd`)
  const style = `STYLE${cand.get('CAND', 'BACK_STYLE')}`
  const ref = (android && css.get(style, 'HL_IMG')) || css.get(style, 'NM_IMG')
  return firstPixel(archive.getBytes(`${root}res/${ref.split(',')[0]}.png`))
}

test('百度 → SSF → 百度保留 Android 实际显示的工具栏像素；仅 iOS 和缺省高亮仍取正常态', async () => {
  const archive = source()
  const pkg = await ssf(archive)
  assert.deepEqual(firstPixel(pkg.file('light', 'bar.png')), green)
  for (const [skin, expected] of [[source('I'), red], [source('A', false), red]]) {
    assert.deepEqual(firstPixel((await ssf(skin)).file('light', 'bar.png')), expected)
  }
  for (const target of ['bdi', 'bds']) {
    const result = convertSsfToBaidu(pkg, archive, 1080, target).archive
    assert.deepEqual(baiduBar(result, 'port', target === 'bds'), green)
  }
})

test('百度 → SXI 同步、异步导出只转换候选栏引用，按方向读取实际显示的背景', async () => {
  const archive = source()
  const original = archive.toBytes()
  for (const { bytes } of [buildSxiZip(archive), await buildSxiZipAsync(archive)]) {
    const output = SkinArchive.open(bytes, 'sxi')
    const skin = JSON.parse(output.getText('skin.json'))
    for (const [orientation, expected, high] of [['port', green, 'highlight,1'], ['land', blue, 'land,1']]) {
      const board = new PalmBoard(skin, 'default', orientation, 'full26Pinyin')
      const styles = { ...skin.default.s_info.ss_1, ...skin.default[`s_${orientation}`]?.ss_1 }
      const [name] = skin.default.s_info.ss_1[board.candidateBack].s_2.normal.split(',')
      assert.equal(styles[board.candidateBack].s_2.normal, `${name},1`)
      assert.deepEqual(firstPixel(output.getBytes(`light/skin/res/${name}.png`)), expected)
      assert.deepEqual(styles[2].s_2, { normal: 'normal,1', hl: high })
      assert.equal(skin.default[`${orientation}_layout`].b.full26Pinyin.keys[0].b.base_b, 2)
    }
  }
  assert.deepEqual(unzipSync(archive.toBytes()), unzipSync(original))
})

test('SXI → BDS、BDI、SSF 保留 SXI 正常态背景，不受不同的高亮图影响', async () => {
  const archive = SkinArchive.open(buildSxiZip(source('I')).bytes, 'sxi')
  const original = archive.toBytes()
  for (const target of ['bdi', 'bds']) {
    const converted = SkinArchive.open((await convertSxiToBaidu(archive, target)).bytes, target)
    for (const orientation of ['port', 'land']) {
      assert.deepEqual(baiduBar(converted, orientation, target === 'bds'), red)
      const css = read(converted, `light/skin/${orientation === 'land' ? 'land/' : ''}res/default.css`)
      assert.equal(css.get('STYLE2', 'NM_IMG'), 'normal,1')
      assert.equal(css.get('STYLE2', 'HL_IMG'), orientation === 'port' ? 'highlight,1' : 'land,1')
    }
  }
  assert.deepEqual(firstPixel((await ssf(sxiToBaiduArchive(archive))).file('light', 'bar.png')), red)
  assert.deepEqual(unzipSync(archive.toBytes()), unzipSync(original))
})

test('SXI → BDS uses the shared bar style when the direction only overrides a different style', async () => {
  const archive = SkinArchive.open(buildSxiZip(source('I')).bytes, 'sxi')
  const skin = JSON.parse(archive.getText('skin.json'))
  skin.default.s_land.ss_1 = { 3: { s_1: { f_s: 42 } } }
  archive.setText('skin.json', JSON.stringify(skin))
  const converted = SkinArchive.open((await convertSxiToBaidu(archive, 'bds')).bytes, 'bds')
  assert.deepEqual(baiduBar(converted, 'land', true), red)
  const css = read(converted, 'light/skin/land/res/default.css')
  assert.equal(css.get('STYLE2', 'HL_IMG'), 'highlight,1', 'shared key retains its original highlight')
  assert.equal(css.get('STYLE3', 'FONT_SIZE'), '42', 'direction still overrides the other style')
})
