import { test } from 'node:test'
import assert from 'node:assert/strict'
import { strToU8, zipSync } from 'fflate'
import { IniDocument } from '../src/ini.ts'
import { SkinArchive } from '../src/skin.ts'
import { bakeBdsBackgrounds } from '../src/bds-backgrounds.ts'
import { decodePng, encodePng, nineSliceImage } from '../src/ssf/ssf-png.ts'

test('BDS 背景跨样式、状态和布局复用切片，只为不同尺寸或源切片生成图片', () => {
  const image = { width: 4, height: 4, data: Uint8Array.from({ length: 64 }, (_, i) => i % 4 === 3 ? 255 : i) }
  const layout = '[KEY1]\nBACK_STYLE=1\nVIEW_RECT=0,0,8,6\n[KEY2]\nBACK_STYLE=2\nVIEW_RECT=8,0,8,6\n[KEY3]\nBACK_STYLE=3\nVIEW_RECT=0,6,8,6\n[KEY4]\nBACK_STYLE=1\nVIEW_RECT=0,12,9,6\n'
  const source = zipSync({
    'Info.txt': strToU8('Name=shared backgrounds\n'),
    'light/port/py_26.ini': strToU8(layout),
    'light/land/py_26.ini': strToU8(layout),
    'light/res/default.css': strToU8('[GLOBAL]\nSTYLE_NUM=3\n[STYLE1]\nNM_IMG=key,1\nHL_IMG=key,1\nFONT_SIZE=11\n[STYLE2]\nNM_IMG=key,1\nHL_IMG=key,1\nFONT_SIZE=12\n[STYLE3]\nNM_IMG=key,2\nHL_IMG=key,1\n'),
    'light/res/key.png': encodePng(image),
    'light/res/key.til': strToU8('[IMG1]\nSOURCE_RECT=0,0,4,4\nINNER_RECT=1,1,2,2\n[IMG2]\nSOURCE_RECT=0,0,4,4\nINNER_RECT=0,0,2,2\n'),
  })
  const output = SkinArchive.open(bakeBdsBackgrounds(source), 'bds')
  const css = IniDocument.parse(output.getText('light/skin/res/default.css'))
  const port = IniDocument.parse(output.getText('light/skin/port/py_26.ini'))
  const land = IniDocument.parse(output.getText('light/skin/land/py_26.ini'))
  const field = (key, name) => css.get(`STYLE${port.get(key, 'BACK_STYLE')}`, name)
  const normal = field('KEY1', 'NM_IMG')
  assert.equal(field('KEY1', 'HL_IMG'), normal)
  assert.equal(field('KEY2', 'NM_IMG'), normal)
  assert.equal(field('KEY2', 'HL_IMG'), normal)
  assert.equal(field('KEY3', 'HL_IMG'), normal)
  assert.notEqual(field('KEY3', 'NM_IMG'), normal)
  assert.notEqual(field('KEY4', 'NM_IMG'), normal)
  assert.equal(field('KEY1', 'FONT_SIZE'), '11')
  assert.equal(field('KEY2', 'FONT_SIZE'), '12')
  for (const key of ['KEY1', 'KEY2', 'KEY3', 'KEY4']) {
    assert.equal(land.get(key, 'BACK_STYLE'), port.get(key, 'BACK_STYLE'))
    const name = field(key, 'NM_IMG').split(',')[0]
    const size = key === 'KEY4' ? [9, 6] : [8, 6]
    const inner = key === 'KEY3' ? [0, 0, 2, 2] : [1, 1, 2, 2]
    assert.deepEqual(decodePng(output.getBytes(`light/skin/res/${name}.png`)), nineSliceImage(image, [0, 0, 4, 4], inner, ...size))
  }
  assert.equal(output.names().filter(path => /keyskin_bds_.*\.png$/.test(path)).length, 3)
})

test('BDS 背景使用布局自己的 CSS 和图片目录，不把新样式写进未使用的共享 CSS', () => {
  const rootCss = '[GLOBAL]\nSTYLE_NUM=1\n[STYLE1]\nNM_IMG=key,1\nFONT_SIZE=10\n'
  const portCss = rootCss.replace('FONT_SIZE=10', 'FONT_SIZE=20')
  const landCss = rootCss.replace('FONT_SIZE=10', 'FONT_SIZE=30')
  const tile = strToU8('[IMG1]\nSOURCE_RECT=0,0,4,4\nINNER_RECT=1,1,2,2\n')
  const shared = { width: 4, height: 4, data: new Uint8Array(64).fill(80) }
  const local = { width: 4, height: 4, data: new Uint8Array(64).fill(160) }
  const files = {
    'light/res/default.css': strToU8(rootCss),
    'light/res/key.png': encodePng(shared),
    'light/res/key.til': tile,
    'light/port/res/default.css': strToU8(portCss),
    'light/land/res/default.css': strToU8(landCss),
    'light/land/res/key.png': encodePng(local),
    'light/land/res/key.til': tile,
    'dark/res/default.css': strToU8(rootCss),
  }
  for (const orientation of ['port', 'land']) files[`light/${orientation}/py_26.ini`] = strToU8('[KEY1]\nBACK_STYLE=1\nVIEW_RECT=0,0,8,6\n')
  const output = SkinArchive.open(bakeBdsBackgrounds(zipSync(files)), 'bds')
  for (const [orientation, size, image] of [['port', '20', shared], ['land', '30', local]]) {
    const layout = IniDocument.parse(output.getText(`light/skin/${orientation}/py_26.ini`))
    const css = IniDocument.parse(output.getText(`light/skin/${orientation}/res/default.css`))
    const id = `STYLE${layout.get('KEY1', 'BACK_STYLE')}`
    assert.equal(css.get(id, 'FONT_SIZE'), size)
    const name = css.get(id, 'NM_IMG').split(',')[0]
    assert.deepEqual(decodePng(output.getBytes(`light/skin/res/${name}.png`)), nineSliceImage(image, [0, 0, 4, 4], [1, 1, 2, 2], 8, 6))
  }
  assert.equal(output.getText('light/skin/res/default.css'), rootCss)
  assert.equal(output.getText('dark/skin/res/default.css'), rootCss)
  assert.equal(output.names().filter(path => /keyskin_bds_.*\.png$/.test(path)).length, 2)
})
