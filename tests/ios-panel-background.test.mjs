import { test } from 'node:test'
import assert from 'node:assert/strict'
import { strToU8, zipSync } from 'fflate'
import { SkinArchive } from '../src/skin.ts'
import { IniDocument } from '../src/ini.ts'
import { encodePng } from '../src/ssf/ssf-png.ts'

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

for (const format of ['bdi', 'bds']) for (const inner of ['', 'INNER_RECT=2,4,2,2\n']) {
  test(`BDS → ${format.toUpperCase()} preserves separate toolbar and panel backgrounds${inner ? ' with nine-patch' : ''}`, async () => {
    const source = splitPicture(inner)
    const warnings = []
    const exported = SkinArchive.open(await source.toBytesAsync(format, warnings), format)
    const root = 'light/skin/'
    const css = IniDocument.parse(exported.getText(`${root}res/default.css`))
    for (const style of ['STYLE1', 'STYLE2']) {
      assert.equal(css.get(style, 'NM_IMG'), IniDocument.parse(source.getText(`${root}res/default.css`)).get(style, 'NM_IMG'))
    }
    for (const file of ['port/cand1.cnd', 'port/py_26.ini', 'port/en_26.ini']) {
      assert.equal(exported.getText(root + file), source.getText(root + file))
    }
    assert.equal(IniDocument.parse(exported.getText(`${root}port/gen.ini`)).get('PANEL', 'BACK_STYLE'), '9')
    assert.deepEqual(exported.getBytes(`${root}res/pic.png`), source.getBytes(`${root}res/pic.png`))
    const tiles = IniDocument.parse(exported.getText(`${root}res/pic.til`))
    assert.equal(tiles.get('IMG1', 'SOURCE_RECT'), '0,0,6,2')
    assert.equal(tiles.get('IMG2', 'SOURCE_RECT'), '0,2,6,6')
    assert.equal(tiles.get('IMG2', 'INNER_RECT'), inner ? '2,4,2,2' : undefined)
    assert.ok(exported.names().every(name => !name.includes('ios_keyboard_')))
    assert.deepEqual(warnings, [])
  })
}
