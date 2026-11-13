import { nativeToolbarFixture as fixture } from './helpers/native-toolbar-fixture.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { SkinArchive } from '../src/skin.ts'
import { IniDocument } from '../src/ini.ts'
import { buildSxiZip } from '../src/palm/palm-export.ts'
import { PalmBoard } from '../src/palm/palm-board.ts'
import { convertBaiduToSsf } from '../src/ssf/baidu-to-ssf.ts'
import { SsfPackage } from '../src/ssf/ssf-package.ts'
import { decodePng } from '../src/ssf/ssf-png.ts'

test('BDI → BDS writes point-calibrated heights and complete edge artwork into the package', async () => {
  const source = fixture()
  const before = source.toBytes()
  const converted = SkinArchive.open(await source.toBytesAsync('bds'), 'bds')
  const generatedTiles = converted.names().filter(path => /\/res\/keyskin_.*\.til$/.test(path))
  assert.equal(generatedTiles.length, 20, 'both themes and orientations include the background and both edge image states')
  for (const path of generatedTiles) {
    const tiles = IniDocument.parse(converted.getText(path))
    assert.equal(tiles.get('GLOBAL', 'TILE_NUM'), '1', `${path}: Android requires the slice count to load IMG1`)
    assert.equal(tiles.get('GLOBAL', 'USE_ALPHA'), '1', `${path}: preserve the artwork alpha`)
  }
  const menu = IniDocument.parse(converted.getText('light/skin/res/logo/pop_menu_icons.til'))
  assert.equal(menu.get('IMG27', 'SOURCE_RECT'), '0,0,68,68', 'Android receives point-calibrated function bitmaps too')
  for (const theme of ['light', 'dark']) for (const [orientation, height] of [['port', 106], ['land', 49]]) {
    const root = `${theme}/skin/`
    const gen = IniDocument.parse(converted.getText(`${root}${orientation}/gen.ini`))
    const cand = IniDocument.parse(converted.getText(`${root}${orientation}/cand1.cnd`))
    const css = IniDocument.parse(converted.getText(`${root}res/default.css`))
    assert.equal(gen.get('CAND', 'VIEW_RECT'), `0,0,1125,${height}`)
    assert.equal(gen.get('PANEL', 'SIZE'), '1125,592', 'key geometry never follows toolbar density')
    assert.equal(cand.get('ICON1', 'FIX_SIZE'), undefined, 'target clients read the calibrated bitmap, not iOS points')
    const [name] = css.get(`STYLE${cand.get('ICON1', 'FORE_STYLE')}`, 'NM_IMG').split(',')
    const edge = decodePng(converted.getBytes(`${root}res/${name}.png`))
    assert.ok(edge.height <= height)
    assert.ok(Math.abs(edge.width / edge.height - 136 / 110) < 0.03, 'source artwork keeps its aspect ratio')
    const [back] = css.get(`STYLE${cand.get('CAND', 'BACK_STYLE')}`, 'NM_IMG').split(',')
    const image = decodePng(converted.getBytes(`${root}res/${back}.png`))
    assert.deepEqual([image.width, image.height], [1125, height], 'Android receives a completed background at the exported height')
    assert.equal(cand.get('ICON4', 'POS'), '-1500,-30', 'deliberately off-screen controls stay hidden')
    assert.equal(converted.getText(`${root}${orientation}/py_26.ini`), source.getText(`${root}${orientation}/py_26.ini`))
  }
  assert.deepEqual(source.toBytes(), before)
  assert.deepEqual(await converted.toBytesAsync('bds'), converted.toBytes(), 'saving a BDS does not scale it again')
})

test('BDI → SXI uses the same exported height, including its background and function images', () => {
  const source = fixture()
  const before = source.toBytes()
  const archive = SkinArchive.open(buildSxiZip(source).bytes, 'sxi')
  const skin = JSON.parse(archive.getText('skin.json'))
  for (const theme of ['default', 'night']) for (const [orientation, height] of [['port', 106], ['land', 49]]) {
    const board = new PalmBoard(skin, theme, orientation, 'full26Pinyin')
    assert.equal(board.candidateSize.height, height)
    assert.equal(board.height, 592)
    for (const { rect } of board.icons().filter(({ rect }) => rect.x >= 0)) assert.ok(rect.y >= 0 && rect.y + rect.height <= height)
  }
  const icon = decodePng(archive.getBytes('light/skin/res/logo/function_iphone@3x.png'))
  assert.deepEqual([icon.width, icon.height], [68, 68], 'functions use their native size instead of the old 58px click target')
  const android = SkinArchive.open(buildSxiZip(fixture('bds')).bytes, 'sxi')
  assert.equal(new PalmBoard(JSON.parse(android.getText('skin.json')), 'default', 'port', 'full26Pinyin').candidateSize.height, 124, 'Android-authored dimensions are retained')
  assert.deepEqual(source.toBytes(), before)
})

test('BDI → SSF fits the calibrated background inside the native bar instead of stretching it', async () => {
  const source = fixture()
  const before = source.toBytes()
  const result = await convertBaiduToSsf(source, { animations: false })
  const pkg = await SsfPackage.open(result.bytes)
  for (const theme of ['light', 'dark']) {
    const image = decodePng(pkg.file(theme, 'bar.png'))
    assert.deepEqual([image.width, image.height], [1080, 120], 'Sogou owns its native bar dimensions')
    const pixel = (y) => [...image.data.slice((y * image.width + 500) * 4, (y * image.width + 501) * 4)]
    assert.deepEqual(pixel(17), [210, 230, 210, 255], 'the unused strip retains the input background')
    assert.deepEqual(pixel(18), [255, 255, 255, 255], 'the white bar remains 102px high at 1080px width')
    assert.deepEqual(pixel(119), [255, 255, 255, 255])
    const icon = decodePng(pkg.file(theme, 'ime_function_switch.png'))
    assert.deepEqual([icon.width, icon.height], [65, 65], 'native function images use the calibrated size too')
  }
  assert.ok(result.warnings.some((warning) => warning.includes('搜狗工具栏高度')))
  assert.deepEqual(source.toBytes(), before)
})
