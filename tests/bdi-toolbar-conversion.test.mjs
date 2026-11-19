import { legacyToolbarFixture, nativeToolbarFixture as fixture } from './helpers/native-toolbar-fixture.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { SkinArchive } from '../src/skin.ts'
import { IniDocument } from '../src/ini.ts'
import { buildSxiZip } from '../src/palm/palm-export.ts'
import { PalmBoard } from '../src/palm/palm-board.ts'
import { convertBaiduToSsf } from '../src/ssf/baidu-to-ssf.ts'
import { SsfPackage } from '../src/ssf/ssf-package.ts'
import { decodePng } from '../src/ssf/ssf-png.ts'
import { plist, toolbarMenuItem } from '../src/ios-toolbar.ts'

test('BDI → SSF sizes both edge PNGs by FIX_SIZE instead of the raw slice dimensions', async () => {
  const source = fixture()
  for (const theme of ['light', 'dark']) {
    const path = `${theme}/skin/port/cand1.cnd`
    const cand = IniDocument.parse(source.getText(path))
    cand.set('ICON1', 'FIX_SIZE', '20,20')
    cand.set('ICON2', 'FIX_SIZE', '25,15')
    source.setText(path, cand.toString())
  }
  const ssf = await SsfPackage.open((await convertBaiduToSsf(source, { animations: false })).bytes)
  // The shared BDI → BDS step converts points to layout pixels before SSF scales to 1080-wide artwork.
  for (const theme of ['light', 'dark']) for (const [name, expected] of [['logo', [49, 39]], ['close', [45, 36]]]) {
    for (const suffix of ['', '_p']) {
      const { width, height } = decodePng(ssf.file(theme, `${name}${suffix}.png`))
      assert.deepEqual([width, height], expected, `${theme}/${name}${suffix}`)
    }
  }
})

test('adding toolbar artwork to a legacy BDI preserves layout dimensions across exports', async () => {
  const source = legacyToolbarFixture()
  const before = await convertBaiduToSsf(source, { animations: false })
  const beforeSsf = await SsfPackage.open(before.bytes)
  for (const theme of ['light', 'dark']) source.setText(`${theme}/skin/res/logo/com.baidu.inputmethod.toolbarMenuItems.plist`,
    plist([toolbarMenuItem('17', '键盘类型', 'toolbar', 'function', 'function')]))
  const android = SkinArchive.open(await source.toBytesAsync('bds'), 'bds')
  const palm = SkinArchive.open(buildSxiZip(source).bytes, 'sxi')
  const skin = JSON.parse(palm.getText('skin.json'))
  for (const theme of ['light', 'dark']) for (const orientation of ['port', 'land']) {
    for (const file of ['gen.ini', 'cand1.cnd']) {
      const path = `${theme}/skin/${orientation}/${file}`
      assert.equal(android.getText(path), source.getText(path), 'an icon plist does not opt into iOS point geometry')
    }
    assert.equal(new PalmBoard(skin, theme === 'light' ? 'default' : 'night', orientation, 'full26Pinyin').candidateSize.height, 50)
  }
  const after = await convertBaiduToSsf(source, { animations: false })
  const afterSsf = await SsfPackage.open(after.bytes)
  for (const theme of ['light', 'dark']) for (const image of ['bar.png', 'bg.png']) {
    assert.ok(beforeSsf.file(theme, image))
    assert.deepEqual(afterSsf.file(theme, image), beforeSsf.file(theme, image), 'menu artwork cannot resize the exported background')
  }
})

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

test('BDI → BDS keeps oversized toolbar hit boxes aligned on the Android center row', async () => {
  const source = fixture()
  const dir = 'light/skin/port/'
  const path = `${dir}cand1.cnd`
  const gen = IniDocument.parse(source.getText(`${dir}gen.ini`))
  gen.set('CAND', 'VIEW_RECT', '0,0,1080,105')
  source.setText(`${dir}gen.ini`, gen.toString())
  const cand = IniDocument.parse(source.getText(path))
  for (const [i, action, width, anchor, x, persist] of [
    [1, 'F31', 128, 4, 30, 1], [2, 'F14', 824, 4, 128, 1],
    [3, 'F8', 128, 6, -158, 1], [4, 'F9', 128, 6, -158, 2],
  ]) {
    const section = `ICON${i}`
    for (const [key, value] of Object.entries({ KEY: action, SIZE: `${width},128`, ANCHOR_TYPE: anchor,
      POS: `${x},-65`, PERSIST: persist, FORE_STYLE: 2 })) cand.set(section, key, String(value))
    if (action !== 'F14') cand.set(section, 'FIX_SIZE', '30,30')
  }
  cand.remove('ICON2', 'FIX_SIZE')
  source.setText(path, cand.toString())
  const result = SkinArchive.open(await source.toBytesAsync('bds'), 'bds')
  const exported = IniDocument.parse(result.getText(path))
  for (const [section, anchor, x, width, height, persist] of [
    ['ICON1', '4', 57, 74, 74, '1'], ['ICON2', '4', 128, 824, 65, '1'],
    ['ICON3', '6', -131, 74, 74, '1'], ['ICON4', '6', -131, 74, 74, '2'],
  ]) {
    assert.equal(exported.get(section, 'ANCHOR_TYPE'), anchor, `${section}: anchor on the Android center row`)
    assert.equal(exported.get(section, 'SIZE'), `${width},${height}`)
    const [px, py] = exported.get(section, 'POS').split(',').map(Number)
    assert.equal(px, x, `${section}: preserves the original horizontal center`)
    assert.ok(Math.abs(py + height / 2) <= 0.5, `${section}: vertically centered without fractional coordinates`)
    assert.equal(exported.get(section, 'PERSIST'), persist)
  }
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
