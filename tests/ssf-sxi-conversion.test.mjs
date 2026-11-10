import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { SkinArchive } from '../src/skin.ts'
import { IniDocument } from '../src/ini.ts'
import { convertSsfSxi } from '../src/palm/ssf-sxi-convert.ts'
import { convertBaiduToSsf } from '../src/ssf/baidu-to-ssf.ts'
import { SsfPackage } from '../src/ssf/ssf-package.ts'
import { ssfFixture } from './helpers/ssf-fixture.mjs'
import { canExport } from '../src/export.ts'

const read = name => new Uint8Array(readFileSync(new URL(`../public/${name}`, import.meta.url)))
const templates = { sogou: SkinArchive.open(read('sogou-template.bds')), bda: SkinArchive.open(read('default-template.bda'), 'bda') }

test('Sogou and Palm cross-convert with their own configs, images and sound resources', async () => {
  assert.ok(canExport('ssf', 'sxi'))
  assert.ok(canExport('sxi', 'ssf'))
  const files = unzipSync(ssfFixture({ single: true }))
  delete files['default/res/day_keyboard_start.webp']
  const source = SkinArchive.open(zipSync(files), 'ssf')
  const converted = await convertSsfSxi(source, templates)
  const palm = SkinArchive.open(converted.bytes, 'sxi')
  const skin = JSON.parse(palm.getText('skin.json'))
  assert.ok(skin.default.s_info.ss_1)
  assert.ok(palm.names().some(path => path.endsWith('.png')))
  assert.ok(palm.names().some(path => path.endsWith('s_del.ogg')))
  const back = await convertSsfSxi(palm)
  const pkg = await SsfPackage.open(back.bytes)
  assert.ok(pkg.skin('light').get('RootView', 'BG_IMAGE'))
  assert.ok(pkg.files.get('default/s_del.wav'))
  assert.equal(pkg.ini('default/sound_android.ini').get('Key_Backspace_Qwerty', 'sound'), 's_del')
})

test('Baidu export writes bound Sogou animations and every decoration image', async () => {
  const source = SkinArchive.open(read('default-template.bds'))
  const layout = IniDocument.parse(source.getText('light/skin/port/py_26.ini'))
  const q = layout.sections().find(section => layout.get(section, 'CENTER') === 'q')
  const css = IniDocument.parse(source.getText('light/skin/res/default.css'))
  css.appendSection('STYLE99999', [{ key: 'PRESS_ANIM', value: '1' }])
  layout.set(q, 'BACK_ANIM_STYLE', '99999')
  const particleStyle = layout.get(q, 'BACK_STYLE')
  source.setText('light/skin/port/py_26.ini', layout.toString())
  source.setText('light/skin/res/default.css', css.toString())
  source.setBytes('light/skin/res/anim.ini', strToU8(`[ANIM1]\nBUILD_LIST=2,3\nBUILD_METHOD=0\n[ANIM2]\nTYPE=4\nFROM=100,100\nTO=90,90\nDURATION=200\n[ANIM3]\nCATEGORY=3\nPARTICLE_IMAGE=${particleStyle}\nTOTAL_NUMBER=1\nLIFE=200,200\nEMIT_TYPE=1\n`))
  const result = await convertBaiduToSsf(source)
  const pkg = await SsfPackage.open(result.bytes)
  const id = pkg.keys('light').get('Key_Q', 'ANIM_STYLE')
  assert.ok(id)
  const anim = pkg.ini(pkg.path('light', 'anim.ini'))
  assert.ok(anim.get(id, 'BG_ANIM'))
  const deco = anim.get(id, 'DECO_ANIM')
  const object = anim.get(deco, 'DOWN_ANIM_OBJ')
  const file = anim.get(object, 'IMG')
  assert.ok(pkg.file('light', file))
  assert.ok(anim.sections().some(section => anim.get(section, 'VALUE') === '1,0.9'))
})

test('Baidu export takes the symbol column styles a board inherits from gen.ini', async () => {
  const source = SkinArchive.open(read('templates/iqoo-rounded-black.bds'))
  assert.equal(IniDocument.parse(source.getText('light/skin/port/py_9.ini')).get('LIST', 'FORE_STYLE'), undefined)
  const pkg = await SsfPackage.open((await convertBaiduToSsf(source)).bytes)
  const skin = pkg.skin('light')
  assert.equal(skin.get('TextStyle_Text', 'TEXT_COLOR'), '0xFFFFFFFF')
  assert.ok(skin.get('CandidateCodeView', 'BG_IMAGE') || skin.get('CandidateCodeView', 'BG_IMAGES'))
})
