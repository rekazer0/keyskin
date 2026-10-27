import { test } from 'node:test'
import assert from 'node:assert/strict'
import { strToU8, zipSync } from 'fflate'
import { SkinArchive } from '../src/skin.ts'
import { IniDocument } from '../src/ini.ts'
import { decodePng, encodePng } from '../src/ssf/ssf-png.ts'

// One picture split Android-style: a red bar slice (rows 0–1) over a blue panel slice (rows 2–7).
function splitPicture(panelInner = '') {
  const width = 6
  const data = new Uint8Array(width * 8 * 4)
  for (let row = 0; row < 8; row++) {
    for (let column = 0; column < width; column++) data.set(row < 2 ? [255, 0, 0, 255] : [0, 0, 255, 255], (row * width + column) * 4)
  }
  const files = {
    'res/default.css': strToU8('[GLOBAL]\nSTYLE_NUM=3\n[STYLE1]\nNM_IMG=pic,1\nHL_IMG=pic,1\n[STYLE2]\nNM_IMG=pic,2\n[STYLE9]\nNM_COLOR=808080\n'),
    'res/pic.png': encodePng({ width, height: 8, data }),
    'res/pic.til': strToU8(`[GLOBAL]\nTILE_NUM=2\n[IMG1]\nSOURCE_RECT=0,0,6,2\nINNER_RECT=0,0,6,2\n[IMG2]\nSOURCE_RECT=0,2,6,6\n${panelInner}`),
    // Bar 360×60 above a 360×240 panel: at the panel slice's 6 px width that is 1 bar row over 4 panel rows.
    'port/gen.ini': strToU8('[PANEL]\nBACK_STYLE=9\nSIZE=360,240\n[CAND]\nLAYOUT_NAME=cand1\nVIEW_RECT=0,0,360,60\n'),
    'port/cand1.cnd': strToU8('[TAB]\nBACK_STYLE=1\n[CAND]\nBACK_STYLE=1\nFORE_STYLE=9\n'),
    'port/py_26.ini': strToU8('[PANEL]\nBACK_STYLE=2\nKEY_NUM=0\n'),
    'port/en_26.ini': strToU8('[PANEL]\nKEY_NUM=0\n'),
  }
  return SkinArchive.open(zipSync(files), 'bds')
}

test('BDS → BDI stacks the bar and panel slices so iPhone shows the picture whole', async () => {
  const warnings = []
  const bdi = SkinArchive.open(await splitPicture().toBytesAsync('bdi', warnings), 'bdi')
  const css = IniDocument.parse(bdi.getText('light/skin/res/default.css'))
  const style = IniDocument.parse(bdi.getText('light/skin/port/py_26.ini')).get('PANEL', 'BACK_STYLE')
  const [resource, tile] = css.get(`STYLE${style}`, 'NM_IMG').split(',')
  const image = decodePng(bdi.getBytes(`light/skin/res/${resource}.png`))
  assert.equal(IniDocument.parse(bdi.getText(`light/skin/res/${resource}.til`)).get(`IMG${tile}`, 'SOURCE_RECT'), '0,0,6,5')
  const pixel = (row) => [...image.data.subarray(row * 6 * 4, row * 6 * 4 + 4)]
  assert.deepEqual([image.width, image.height], [6, 5])
  assert.deepEqual(pixel(0), [255, 0, 0, 255])
  assert.deepEqual([1, 4].map(pixel), [[0, 0, 255, 255], [0, 0, 255, 255]])
  // The bar lets the stacked picture through, in its TAB state too.
  const cand = IniDocument.parse(bdi.getText('light/skin/port/cand1.cnd'))
  for (const section of ['CAND', 'TAB']) assert.equal(css.get(`STYLE${cand.get(section, 'BACK_STYLE')}`, 'NM_COLOR'), '00000000')
  // Layouts with a colour background (here inherited from gen.ini) keep it.
  assert.equal(IniDocument.parse(bdi.getText('light/skin/port/gen.ini')).get('PANEL', 'BACK_STYLE'), '9')
  assert.equal(IniDocument.parse(bdi.getText('light/skin/port/en_26.ini')).get('PANEL', 'BACK_STYLE'), undefined)
  assert.ok(warnings.some((text) => text.includes('拼成一张整图')))
})

test('a nine-patch panel, and BDS export, keep the Android background', async () => {
  const bdi = SkinArchive.open(await splitPicture('INNER_RECT=2,4,2,2\n').toBytesAsync('bdi'), 'bdi')
  assert.equal(IniDocument.parse(bdi.getText('light/skin/port/py_26.ini')).get('PANEL', 'BACK_STYLE'), '2')
  assert.equal(IniDocument.parse(bdi.getText('light/skin/port/cand1.cnd')).get('CAND', 'BACK_STYLE'), '1')
  const bds = SkinArchive.open(await splitPicture().toBytesAsync('bds'), 'bds')
  assert.equal(IniDocument.parse(bds.getText('light/skin/port/py_26.ini')).get('PANEL', 'BACK_STYLE'), '2')
})
