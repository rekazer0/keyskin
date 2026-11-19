import assert from 'node:assert/strict'
import { test } from 'node:test'
import { IniDocument } from '../src/ini.ts'
import { SkinArchive } from '../src/skin.ts'
import { buildSxiZip } from '../src/palm/palm-export.ts'
import { convertSxiToBaidu } from '../src/palm/sxi-to-baidu.ts'
import { cropImage, decodePng, encodePng } from '../src/ssf/ssf-png.ts'
import { completeBdsBytes } from './helpers/bds-export.mjs'
import { nativeToolbarFixture } from './helpers/native-toolbar-fixture.mjs'

const css = '[STYLE1]\nNM_IMG=joined,2\n[STYLE5]\nNM_IMG=joined,3\n[STYLE6]\nNM_IMG=joined,4\nINFO=Full background\n[STYLE7]\nNM_IMG=edge,1\n'
const tiles = '[GLOBAL]\nTILE_NUM=4\n[IMG1]\nSOURCE_RECT=0,0,1125,1\n[IMG2]\nSOURCE_RECT=0,1,1125,2\n[IMG3]\nSOURCE_RECT=0,3,1125,5\n[IMG4]\nSOURCE_RECT=0,0,1125,8\n'

for (const sourceFormat of ['bdi', 'sxi']) test(`${sourceFormat.toUpperCase()} export joins authored Android background bands in both themes and orientations`, async () => {
  const source = nativeToolbarFixture(sourceFormat === 'bdi' ? 'bdi' : 'bds')
  const width = 1125
  const rgba = Uint8Array.from({ length: width * 8 * 4 }, (_, at) => at % 4 === 3 ? 255 : Math.floor(at / (width * 4)))
  for (const theme of ['light', 'dark']) {
    const root = `${theme}/skin/`
    source.setText(`${root}res/default.css`, source.getText(`${root}res/default.css`).replace(/\[STYLE1\][^[]*/, '') + css)
    source.setBytes(`${root}res/joined.png`, encodePng({ width, height: 8, data: rgba }))
    source.setText(`${root}res/joined.til`, tiles)
    for (const orientation of ['port', 'land']) {
      const dir = `${root}${orientation}/`
      source.setText(`${dir}gen.ini`, source.getText(`${dir}gen.ini`).replace('[PANEL]', '[PANEL]\nBACK_STYLE=5'))
      source.setText(`${dir}py_26.ini`, '[PANEL]\nBACK_STYLE=6\nSIZE=1125,592\n')
      source.setText(`${dir}en_26.ini`, '[PANEL]\nBACK_STYLE=7\nSIZE=1125,592\n')
    }
  }
  const input = sourceFormat === 'sxi' ? SkinArchive.open(buildSxiZip(source).bytes, 'sxi') : source
  const before = input.toBytes()
  const bytes = sourceFormat === 'sxi' ? (await convertSxiToBaidu(input, 'bds')).bytes : await input.toBytesAsync('bds')
  const exported = await completeBdsBytes(bytes, () => assert.fail('no atlas consolidation needed'))
  const target = SkinArchive.open(exported, 'bds')
  for (const theme of ['light', 'dark']) {
    const root = `${theme}/skin/`
    const styles = IniDocument.parse(target.getText(`${root}res/default.css`))
    const png = decodePng(target.getBytes(`${root}res/joined.png`))
    assert.deepEqual(png.data, rgba)
    if (sourceFormat === 'bdi') assert.equal(target.getText(`${root}res/joined.til`), tiles)
    for (const orientation of ['port', 'land']) {
      const dir = `${root}${orientation}/`
      const panel = IniDocument.parse(target.getText(`${dir}py_26.ini`))
      const style = `STYLE${panel.get('PANEL', 'BACK_STYLE')}`
      assert.equal(styles.get(style, 'NM_IMG'), 'keyskin_joined_band3,1')
      const band = decodePng(target.getBytes(`${root}res/keyskin_joined_band3.png`))
      assert.deepEqual([band.width, band.height], [width, 6])
      assert.deepEqual(cropImage(band, 0, 0, width, 5).data, rgba.subarray(width * 3 * 4))
      assert.ok(band.data.subarray(width * 5 * 4).every(value => value === 0))
      assert.equal(styles.get('STYLE6', 'NM_IMG'), 'keyskin_joined_band4,1')
      if (sourceFormat === 'bdi') assert.equal(styles.get(style, 'INFO'), 'Full background')
      assert.equal(panel.get('PANEL', 'SIZE'), '1125,592')
      assert.equal(IniDocument.parse(target.getText(`${dir}en_26.ini`)).get('PANEL', 'BACK_STYLE'), '7')
      const cand = IniDocument.parse(target.getText(`${dir}cand1.cnd`))
      const image = styles.get(`STYLE${cand.get('CAND', 'BACK_STYLE')}`, 'NM_IMG').split(',')[0]
      const toolbar = decodePng(target.getBytes(`${root}res/${image}.png`))
      assert.equal(toolbar.data[toolbar.data.length - 4], 2, 'toolbar ends immediately before the panel band starts')
    }
  }
  assert.deepEqual(input.toBytes(), before, 'export does not change the source document')
})
