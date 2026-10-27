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

test('BDS export and skins that already declare [LOGO] keep their toolbar files', async () => {
  const bds = SkinArchive.open(await androidSkin().toBytesAsync('bds'), 'bds')
  assert.equal(bds.getBytes('light/skin/port/logo.ini'), undefined)
  const source = androidSkin()
  source.setText('light/skin/port/gen.ini', `${source.getText('light/skin/port/gen.ini')}[LOGO]\r\nLAYOUT_NAME=mine\r\n`)
  const bdi = SkinArchive.open(await source.toBytesAsync('bdi'), 'bdi')
  assert.equal(IniDocument.parse(bdi.getText('light/skin/port/gen.ini')).get('LOGO', 'LAYOUT_NAME'), 'mine')
  assert.equal(bdi.getBytes('light/skin/port/logo.ini'), undefined)
  assert.ok(bdi.getBytes('light/skin/land/logo.ini'))
})
