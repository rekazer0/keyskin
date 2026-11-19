import assert from 'node:assert/strict'
import { test } from 'node:test'
import { strToU8, zipSync } from 'fflate'
import { SkinArchive } from '../src/skin.ts'
import { inspectSkin } from '../src/skin-preflight.ts'
import { bdsFixture } from './helpers/baidu-fixture.mjs'

const layout = 'light/skin/port/py_26.ini'
const atlas = 'light/skin/res/preflight.til'

test('preflight is read-only and its repairs preserve BOM, line endings, values and section numbering', () => {
  const archive = SkinArchive.open(bdsFixture(), 'bds')
  const before = '［PANEL］\r\nKEY_NUM＝8  \r\n[KEY1]\r\nCENTER=a＝b\r\n'
  archive.setBytes(layout, strToU8(`\uFEFF${before}`))
  archive.setText(atlas, '[GLOBAL]\n[IMG1]\nSOURCE_RECT=0,0,1,1\n')
  const revision = archive.revision
  const { issues, changes } = inspectSkin(archive)
  assert.equal(archive.revision, revision)
  assert.equal(issues.filter(issue => issue.fixable).length, 4)
  assert.equal(changes.length, 2)
  for (const { path, after } of changes) archive.setText(path, after)
  assert.deepEqual(archive.getBytes(layout), strToU8('\uFEFF[PANEL]\r\nKEY_NUM=1  \r\n[KEY1]\r\nCENTER=a＝b\r\n'))
  assert.match(archive.getText(atlas), /TILE_NUM=1/)
  assert.deepEqual(inspectSkin(archive), { issues: [], changes: [] })
})

test('ambiguous configuration, syntax and invalid assets require manual repair', () => {
  const archive = SkinArchive.open(bdsFixture(), 'bds')
  archive.delete('Info.txt')
  archive.setText(layout, '[PANEL]\nKEY_NUM=1\n[KEY2]\nCENTER=q\n')
  archive.setText('light/skin/land/example.ini', '[PANEL]\nNO_BLUR=1\nNO_BLUR＝0\n无效行')
  archive.setText(atlas, '[GLOBAL]\nTILE_NUM=1\n[IMG1]\nSOURCE_RECT=0,0,0,1\n')
  archive.setText('light/skin/res/broken.png', 'not a PNG')
  const { issues, changes } = inspectSkin(archive)
  assert.equal(changes.length, 0)
  assert.ok(issues.every(issue => !issue.fixable))
  for (const message of ['缺少必要文件', 'KEY_NUM', '全角', '应为 [段名]', 'SOURCE_RECT', 'PNG']) {
    assert.ok(issues.some(issue => issue.message.includes(message)), message)
  }
  assert.ok(issues.some(issue => issue.location.endsWith('example.ini:4')))
})

test('uses native format rules for SXI, BDA and SSF source files', () => {
  const open = (format, files) => SkinArchive.open(zipSync(files), format)
  const sxi = open('sxi', { 'skin.json': strToU8('[]') })
  assert.match(inspectSkin(sxi).issues[0].message, /JSON/)
  const bda = open('bda', { 'port/appearanceConfig': Uint8Array.of(0xff) })
  assert.match(inspectSkin(bda).issues[0].message, /BDA.*无法解析/)
  const utf16 = Uint8Array.from([0xff, 0xfe, ...Array.from('[General]\nskin_name=x\n', ch => [ch.charCodeAt(0), 0]).flat()])
  const ssf = open('ssf', { 'phoneTheme.ini': utf16, '960/phoneSkin.ini': strToU8('[General]\n') })
  assert.deepEqual(inspectSkin(ssf).issues, [])
  ssf.delete('960/phoneSkin.ini')
  assert.equal(inspectSkin(ssf).issues[0].location, 'phoneSkin.ini')
})
