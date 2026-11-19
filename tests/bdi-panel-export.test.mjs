import assert from 'node:assert/strict'
import test from 'node:test'
import { SkinArchive } from '../src/skin.ts'
import { IniDocument } from '../src/ini.ts'
import { buildSxiZip } from '../src/palm/palm-export.ts'
import { convertSxiToBaidu } from '../src/palm/sxi-to-baidu.ts'
import { convertSsfSxi } from '../src/palm/ssf-sxi-convert.ts'
import { SsfPackage } from '../src/ssf/ssf-package.ts'
import { previewDrawOrder, previewItems } from '../src/preview-items.ts'
import { decodePng, encodePng } from '../src/ssf/ssf-png.ts'
import { nativeToolbarFixture } from './helpers/native-toolbar-fixture.mjs'

const layout = `[PANEL]
SIZE=120,90
KEY_NUM=10
[KEY10]
BACK_STYLE=1
VIEW_RECT=0,0,120,90
[KEY1]
VIEW_RECT=0,0,40,30
TOUCH_RECT=1,1,38,28
CENTER=q
FORE_STYLE=3
POS_TYPE=9
FORE_ANIM_STYLE=18
STAT_STYLE=S4_1
[TIP1]
FORE_STYLE=3
[KEY2]
VIEW_RECT=0,30,40,30
CENTER=a
[KEY3]
VIEW_RECT=40,0,40,30
CENTER=w
[KEY4]
VIEW_RECT=40,30,40,30
CENTER=s
[KEY8]
VIEW_RECT=100,60,20,30
CENTER=m
`

test('BDI export preserves cross-key pixels, touches and panel layering in every layout, theme and orientation', async () => {
  const source = nativeToolbarFixture()
  for (const theme of ['light', 'dark']) {
    const root = `${theme}/skin/`
    source.setBytes(`${root}res/overlay.png`, encodePng({ width: 64, height: 54, data: new Uint8Array(64 * 54 * 4).fill(213) }))
    source.setText(`${root}res/overlay.til`, '[IMG1]\nSOURCE_RECT=0,0,64,54\n')
    source.setText(`${root}res/default.css`, source.getText(`${root}res/default.css`) + '[STYLE5]\nNM_IMG=overlay,1\n')
    for (const orientation of ['port', 'land']) for (const name of ['py_9', 'en_26s', 'num_9']) {
      source.setText(`${root}${orientation}/${name}.ini`, layout.replace('[KEY4]', '[KEY4]\nFORE_STYLE=5'))
    }
  }
  const bytes = source.toBytes()
  const notes = []
  const converted = SkinArchive.open(await source.toBytesAsync('bds', notes), 'bds')
  assert.equal(notes.filter(note => note.includes('跨键前景')).length, 1)
  for (const theme of ['light', 'dark']) {
    const root = `${theme}/skin/`
    const css = IniDocument.parse(converted.getText(`${root}res/default.css`))
    for (const orientation of ['port', 'land']) for (const name of ['py_9', 'en_26s', 'num_9']) {
      const path = `${root}${orientation}/${name}.ini`
      const doc = IniDocument.parse(converted.getText(path))
      assert.equal(doc.get('PANEL', 'BACK_STYLE'), '1')
      assert.equal(doc.hasSection('KEY10'), false)
      const key = doc.get('KEY1', 'FORE_STYLE')
      assert.match(key, /^3,\d+$/)
      assert.equal(doc.get('TIP1', 'FORE_STYLE'), key)
      assert.equal(doc.get('KEY1', 'POS_TYPE'), '9,0')
      assert.equal(doc.get('KEY1', 'FORE_ANIM_STYLE'), '18,0')
      assert.equal(doc.get('KEY1', 'TOUCH_RECT'), '1,1,38,28')
      assert.equal(doc.get('KEY4', 'FORE_STYLE'), '5')
      assert.equal(doc.get('KEY8', 'FORE_STYLE'), undefined)
      const id = key.split(',')[1]
      const [image, index] = css.get(`STYLE${id}`, 'NM_IMG').split(',')
      const tile = IniDocument.parse(converted.getText(`${root}res/${image}.til`))
      const [x, y, w, h] = tile.get(`IMG${index}`, 'SOURCE_RECT').split(',').map(Number)
      assert.deepEqual([w, h], [40, 30])
      const atlas = decodePng(converted.getBytes(`${root}res/${image}.png`))
      const alpha = (left, top) => atlas.data[((y + top) * atlas.width + x + left) * 4 + 3]
      assert.equal(alpha(39, 29), 213, 'the diagonal neighbor gets the overflowing artwork')
      assert.equal(alpha(0, 0), 0, 'the patch leaves unrelated pixels transparent')
      assert.equal(source.getText(path), layout.replace('[KEY4]', '[KEY4]\nFORE_STYLE=5'))
    }
  }
  assert.deepEqual(source.toBytes(), bytes)
  assert.deepEqual(await converted.toBytesAsync('bds'), converted.toBytes(), 'BDS save never adds duplicate fragments')
})

test('Android preview uses numeric key draw order rather than moving full-panel keys behind the others', () => {
  const items = previewItems(IniDocument.parse(layout), 120, 90)
  const list = { ...items[0], section: 'LIST' }
  assert.equal(previewDrawOrder(items, 120, 90)[0].section, 'KEY10')
  assert.deepEqual(previewDrawOrder([...items, list], 120, 90, undefined, true).slice(-2).map(item => item.section), ['KEY10', 'LIST'])
})

test('SXI to BDS adapts native cross-key artwork and panel backgrounds only once', async () => {
  const source = nativeToolbarFixture()
  const root = 'light/skin/'
  const path = `${root}port/en_26.ini`
  source.setText(path, layout.replace('POS_TYPE=9\n', ''))
  source.setBytes(`${root}res/overlay.png`, encodePng({ width: 64, height: 54, data: new Uint8Array(64 * 54 * 4).fill(213) }))
  source.setText(`${root}res/overlay.til`, '[IMG1]\nSOURCE_RECT=0,0,64,54\n')
  source.setText(`${root}res/default.css`, source.getText(`${root}res/default.css`).replace('NM_COLOR=202020\nFONT_SIZE=43', 'NM_IMG=overlay,1'))
  const palm = SkinArchive.open(buildSxiZip(source).bytes, 'sxi')
  const before = palm.getText('skin.json')
  const ios = SkinArchive.open((await convertSxiToBaidu(palm, 'bdi')).bytes, 'bdi')
  const iosLayout = IniDocument.parse(ios.getText(path))
  assert.equal(iosLayout.get('KEY3', 'FORE_STYLE'), undefined)
  const converted = await convertSxiToBaidu(palm, 'bds')
  const android = SkinArchive.open(converted.bytes, 'bds')
  const doc = IniDocument.parse(android.getText(path))
  assert.ok(converted.warnings.some(note => note.includes('跨键前景')))
  assert.equal(doc.get('PANEL', 'BACK_STYLE'), iosLayout.get('KEY10', 'BACK_STYLE'))
  assert.equal(doc.hasSection('KEY10'), false)
  assert.equal(doc.get('KEY1', 'TOUCH_RECT'), '1,1,38,28')
  assert.match(doc.get('KEY3', 'FORE_STYLE'), /^\d+$/)
  const restored = SkinArchive.open((await convertSxiToBaidu(SkinArchive.open(buildSxiZip(android).bytes, 'sxi'), 'bds')).bytes, 'bds')
  assert.equal(IniDocument.parse(restored.getText(path)).get('KEY3', 'FORE_STYLE')?.split(',').length, 1)
  const keys = (await SsfPackage.open((await convertSsfSxi(palm)).bytes)).keys('light')
  assert.ok(keys.get('Key_W', 'FG_IMAGES'), 'SSF receives the same native Palm overflow')
  assert.equal(palm.getText('skin.json'), before)
})
