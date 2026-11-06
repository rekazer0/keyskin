import { test } from 'node:test'
import assert from 'node:assert/strict'
import { strToU8, zipSync } from 'fflate'
import { SkinArchive } from '../src/skin.ts'
import { IniDocument } from '../src/ini.ts'
import { parseXmlPlist } from '../src/palm/palm-plist.ts'
import { cropImage, decodePng, encodePng } from '../src/ssf/ssf-png.ts'

const image = (width, height, rgba) => encodePng({ width, height, data: new Uint8Array(width * height * 4).map((_, index) => rgba[index % 4]) })

// Like a common Android BDS: text logo / hide keys ("百度" / "收回") over an image candidate bar background.
function androidSkin(logoStyle = '[STYLE115]\nSHOW=百度\nNM_COLOR=000000\nHL_COLOR=000000\n') {
  const cand = '\ufeff[CAND]\r\nBACK_STYLE=524\r\nFORE_STYLE=129\r\nICON_NUM=2\r\n\r\n[ICON1]\r\nFORE_STYLE=115\r\nKEY=F31\t\r\n\r\n[ICON2]\r\nFORE_STYLE=107\r\nKEY=F8\t\r\n'
  const files = {
    'res/default.css': strToU8(`\ufeff[GLOBAL]\nSTYLE_NUM=300\n${logoStyle}[STYLE107]\nSHOW=收回\nNM_COLOR=000000\n[STYLE129]\nNM_COLOR=63B8FF\n[STYLE524]\nNM_IMG=xhbj1,1\n[STYLE530]\nNM_IMG=logo,1\nHL_IMG=logo,2\n`),
    'res/xhbj1.png': image(4, 4, [0x12, 0x34, 0x56, 0xff]),
    'res/xhbj1.til': strToU8('[GLOBAL]\nTILE_NUM=1\n[IMG1]\nSOURCE_RECT=0,0,4,4\n'),
    'res/logo.png': image(6, 3, [0xff, 0, 0, 0xff]),
    'res/logo.til': strToU8('[GLOBAL]\nTILE_NUM=2\n[IMG1]\nSOURCE_RECT=0,0,3,3\n[IMG2]\nSOURCE_RECT=3,0,3,3\n'),
  }
  for (const orientation of ['port', 'land']) {
    files[`${orientation}/gen.ini`] = strToU8('\ufeff[PANEL]\r\nSIZE=360,258\r\n[CAND]\r\nLAYOUT_NAME=cand1\r\nVIEW_RECT=0,0,360,50\r\n')
    files[`${orientation}/cand1.cnd`] = strToU8(cand)
  }
  return SkinArchive.open(zipSync(files), 'bds')
}

test('BDS → BDI declares the iOS LOGO layout coloured like the Android logo key', async () => {
  const warnings = []
  const bdi = SkinArchive.open(await androidSkin().toBytesAsync('bdi', warnings), 'bdi')
  const css = IniDocument.parse(bdi.getText('light/skin/res/default.css'))
  const backs = new Set()
  for (const orientation of ['port', 'land']) {
    const gen = IniDocument.parse(bdi.getText(`light/skin/${orientation}/gen.ini`))
    assert.equal(gen.get('LOGO', 'LAYOUT_NAME'), 'logo')
    const logo = IniDocument.parse(bdi.getText(`light/skin/${orientation}/logo.ini`))
    // Black like the "百度" key Android shows, not iOS's faint default tint.
    assert.equal(logo.get('ICON1', 'TEXT_STYLE'), '115')
    backs.add(logo.get('PANEL', 'BACK_STYLE'))
  }
  // Both orientations share one colour sampled from the candidate bar's image, numbered past every
  // existing style even though this skin's STYLE_NUM (300) is stale.
  assert.deepEqual([...backs], ['531'])
  assert.equal(css.get('STYLE531', 'NM_COLOR'), '123456')
  assert.equal(css.get('GLOBAL', 'STYLE_NUM'), '531')
  assert.ok(warnings.some((text) => text.includes('收回')))
  assert.equal(bdi.getBytes('light/skin/res/logo/customImageConfig.plist'), undefined)
})

test('BDS → BDI hands iOS an image logo key through customImageConfig', async () => {
  const source = androidSkin()
  for (const orientation of ['port', 'land']) {
    source.setText(`light/skin/${orientation}/cand1.cnd`, source.getText(`light/skin/${orientation}/cand1.cnd`).replace('FORE_STYLE=115', 'FORE_STYLE=530'))
  }
  const converted = SkinArchive.open(await source.toBytesAsync('bdi'), 'bdi')
  const [entry] = parseXmlPlist(converted.getBytes('light/skin/res/logo/customImageConfig.plist'))
  assert.equal(entry.Name, '0')
  const atlas = decodePng(source.getBytes('light/skin/res/logo.png'))
  for (const [state, rect] of [['Normal', [0, 0, 3, 3]], ['Highlight', [3, 0, 3, 3]]]) {
    assert.deepEqual(decodePng(converted.getBytes(`light/skin/res/logo/${entry.Images.Normal[state]}_iphone@3x.png`)), cropImage(atlas, ...rect))
  }
  // An image logo has no colour of its own: the icons take the candidate words' colour.
  assert.equal(IniDocument.parse(converted.getText('light/skin/port/logo.ini')).get('ICON1', 'TEXT_STYLE'), '129')
})

test('saving a converted BDI re-cuts the logo artwork from the restyled logo key', async () => {
  const source = androidSkin()
  for (const orientation of ['port', 'land']) {
    source.setText(`light/skin/${orientation}/cand1.cnd`, source.getText(`light/skin/${orientation}/cand1.cnd`).replace('FORE_STYLE=115', 'FORE_STYLE=530'))
  }
  // Red normal tile, blue pressed tile, so re-cutting the wrong one shows.
  source.setBytes('light/skin/res/logo.png', encodePng({ width: 6, height: 3, data: new Uint8Array(72).map((_, index) => (index >> 2) % 6 < 3 ? [0xff, 0, 0, 0xff][index % 4] : [0, 0, 0xff, 0xff][index % 4]) }))
  const bdi = SkinArchive.open(await source.toBytesAsync('bdi'), 'bdi')
  // The user swaps the normal logo for the pressed tile in the editor, then saves the BDI again.
  bdi.setText('light/skin/res/default.css', bdi.getText('light/skin/res/default.css').replace('NM_IMG=logo,1', 'NM_IMG=logo,2'))
  const saved = SkinArchive.open(await bdi.toBytesAsync('bdi'), 'bdi')
  const atlas = decodePng(source.getBytes('light/skin/res/logo.png'))
  assert.deepEqual(decodePng(saved.getBytes('light/skin/res/logo/toolbar-logo_Normal_iphone@3x.png')), cropImage(atlas, 3, 0, 3, 3))
  // A hand-made customImageConfig is not ours to rewrite.
  saved.setText('light/skin/res/logo/customImageConfig.plist', '<plist><array><dict><key>Name</key><string>0</string></dict></array></plist>')
  saved.setText('light/skin/res/default.css', saved.getText('light/skin/res/default.css').replace('NM_IMG=logo,2', 'NM_IMG=logo,1'))
  const handMade = SkinArchive.open(await saved.toBytesAsync('bdi'), 'bdi')
  assert.deepEqual(decodePng(handMade.getBytes('light/skin/res/logo/toolbar-logo_Normal_iphone@3x.png')), cropImage(atlas, 3, 0, 3, 3))
})

test('BDS export stays unchanged and BDI completes the existing LOGO layout without replacing its name', async () => {
  const bds = SkinArchive.open(await androidSkin().toBytesAsync('bds'), 'bds')
  assert.equal(bds.getBytes('light/skin/port/logo.ini'), undefined)
  const source = androidSkin()
  source.setText('light/skin/port/gen.ini', `${source.getText('light/skin/port/gen.ini')}[LOGO]\r\nLAYOUT_NAME=mine\r\n`)
  const bdi = SkinArchive.open(await source.toBytesAsync('bdi'), 'bdi')
  assert.equal(IniDocument.parse(bdi.getText('light/skin/port/gen.ini')).get('LOGO', 'LAYOUT_NAME'), 'mine')
  assert.equal(bdi.getBytes('light/skin/port/logo.ini'), undefined)
  assert.equal(IniDocument.parse(bdi.getText('light/skin/port/mine.ini')).get('ICON1', 'TEXT_STYLE'), '115')
  assert.ok(bdi.getBytes('light/skin/land/logo.ini'))
})

test('iOS packaging notes are collected apart from key sounds the target cannot play', async () => {
  const sounds = []
  const notes = []
  await androidSkin().toBytesAsync('bdi', sounds, notes)
  // 导出弹窗按两类分别说明：适配调整不能出现在「按键音未能转换」下面。
  assert.ok(notes.some((text) => text.includes('收回')))
  assert.equal(sounds.some((text) => text.includes('收回')), false)
})

test('BDS → BDI converts native Android menu atlas even when LOGO already exists, in both themes and orientations', async () => {
  let source = androidSkin()
  const indexes = [26, 27, 29, 31, 25, 50, 62]
  for (const theme of ['light', 'dark']) {
    const prefix = `${theme}/skin/`
    if (theme === 'dark') for (const path of source.names().filter((path) => path.startsWith('light/skin/') && !path.endsWith('/'))) source.setBytes(path.replace('light/', 'dark/'), source.getBytes(path))
    const data = new Uint8Array(indexes.length * 4)
    indexes.forEach((index, x) => data.set([index, theme === 'dark' ? 1 : 2, 0, 255], x * 4))
    source.setBytes(`${prefix}res/logo/pop_menu_icons.png`, encodePng({ width: indexes.length, height: 1, data }))
    source.setText(`${prefix}res/logo/pop_menu_icons.til`, '[GLOBAL]\nTILE_NUM=63\n' + indexes.map((index, x) => `[IMG${index}]\nSOURCE_RECT=${x},0,1,1\n`).join(''))
    for (const orientation of ['port', 'land']) {
      const genPath = `${prefix}${orientation}/gen.ini`
      source.setText(genPath, source.getText(genPath) + '[LOGO]\nLAYOUT_NAME=logo\n')
      source.setText(`${prefix}${orientation}/logo.ini`, '[GLOBAL]\nICON_NUM=1\nVERSION=1\n')
    }
  }
  source = SkinArchive.open(zipSync(Object.fromEntries(source.names().filter((path) => !path.endsWith('/')).map((path) => [path.replace(/^(light|dark)\/skin\//, '$1/'), source.getBytes(path)]))), 'bds')
  const before = source.toBytes()
  const bdi = SkinArchive.open(await source.toBytesAsync('bdi'), 'bdi')
  for (const theme of ['light', 'dark']) {
    const prefix = `${theme}/skin/`
    const menuPath = `${prefix}res/logo/com.baidu.inputmethod.toolbarMenuItems.plist`
    const items = parseXmlPlist(bdi.getBytes(menuPath))
    assert.deepEqual(items.map(({ Name }) => Name), ['19', '17', '23', '26', '18', '35', '45'])
    assert.equal(bdi.getText(menuPath), bdi.getText(menuPath.replace('.plist', '.nijigen.plist')))
    for (const [i, item] of items.entries()) {
      assert.equal(item.Position, 'toolbar')
      for (const themeState of ['Normal', 'Theme']) for (const state of ['Normal', 'Highlight', 'Selected']) {
        const png = bdi.getBytes(`${prefix}res/logo/${item.Images[themeState][state]}_iphone@3x.png`)
        assert.deepEqual([...decodePng(png).data], [indexes[i], theme === 'dark' ? 1 : 2, 0, 255])
      }
    }
    for (const orientation of ['port', 'land']) {
      const menu = IniDocument.parse(bdi.getText(`${prefix}${orientation}/logo.ini`))
      assert.equal(menu.get('GLOBAL', 'VERSION'), '1')
      assert.equal(menu.get('PANEL', 'ICON_INDEX'), '1')
      assert.equal(menu.get('ICON1', 'TEXT_STYLE'), '115')
    }
  }
  assert.deepEqual(source.toBytes(), before)
})

test('BDS → BDI uses explicit CND function artwork and preserves authored iOS menu files and colours', async () => {
  const source = androidSkin()
  const candPath = 'light/skin/port/cand1.cnd'
  source.setText(candPath, source.getText(candPath) + '[ICON3]\nKEY=F13\nFORE_STYLE=530\n')
  const bdi = SkinArchive.open(await source.toBytesAsync('bdi'), 'bdi')
  const [item] = parseXmlPlist(bdi.getBytes('light/skin/res/logo/com.baidu.inputmethod.toolbarMenuItems.plist'))
  assert.equal(item.Name, '17')
  const atlas = decodePng(source.getBytes('light/skin/res/logo.png'))
  for (const [state, x] of [['Normal', 0], ['Highlight', 3]]) {
    assert.deepEqual(decodePng(bdi.getBytes(`light/skin/res/logo/${item.Images.Normal[state]}_iphone@3x.png`)), cropImage(atlas, x, 0, 3, 3))
  }
  const plist = '<plist><array><dict><key>Name</key><string>17</string></dict></array></plist>'
  source.setText('light/skin/res/logo/com.baidu.inputmethod.toolbarMenuItems.plist', plist)
  source.setText('light/skin/port/gen.ini', source.getText('light/skin/port/gen.ini') + '[LOGO]\nLAYOUT_NAME=mine\n')
  source.setText('light/skin/port/mine.ini', '[GLOBAL]\nVERSION=1\nICON_NUM=1\n[PANEL]\nBACK_STYLE=129\nICON_INDEX=1\n[ICON1]\nTEXT_STYLE=107\nFORE_STYLE=107\n')
  const saved = SkinArchive.open(await source.toBytesAsync('bdi'), 'bdi')
  assert.equal(saved.getText('light/skin/res/logo/com.baidu.inputmethod.toolbarMenuItems.plist'), plist)
  assert.equal(IniDocument.parse(saved.getText('light/skin/port/mine.ini')).get('ICON1', 'TEXT_STYLE'), '107')
  assert.equal(IniDocument.parse(saved.getText('light/skin/port/mine.ini')).get('PANEL', 'BACK_STYLE'), '129')
})
