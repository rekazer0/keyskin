import { test } from 'node:test'
import assert from 'node:assert/strict'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { SkinArchive } from '../src/skin.ts'
import { IniDocument } from '../src/ini.ts'
import { AtlasResolver } from '../src/atlas.ts'
import { parseXmlPlist } from '../src/palm/palm-plist.ts'
import { cropImage, decodePng, encodePng } from '../src/ssf/ssf-png.ts'

const image = (width, height, rgba) => encodePng({ width, height, data: new Uint8Array(width * height * 4).map((_, index) => rgba[index % 4]) })

// The iOS toolbar: functions live in the plist, artwork in res/logo/1.0/*_iphone@3x.png.
const TOOLBAR_ITEMS = [
  ['toolbar', '19', '表情', '1.0/toolbarMenuItem_Emoji_Normal', 8, 8],
  ['toolbar', '17', '键盘类型', '1.0/toolbarMenuItem_KBSwitch_Normal', 6, 4],
  ['toolbar', '26', '搜索', '1.0/toolbarMenuItem_Search_Normal', 8, 8],
  ['menu', '3', '建议反馈', '1.0/menu_suggestion_normal.png', 8, 8],
]

function itemXml([position, name, title, file]) {
  const states = `<key>Normal</key><dict><key>Normal</key><string>${file}</string></dict><key>Theme</key><dict><key>Normal</key><string>${file}</string></dict>`
  return `<dict><key>Position</key><string>${position}</string><key>Name</key><string>${name}</string><key>Titles</key><dict><key>Normal</key><dict><key>Normal</key><string>${title}</string><key>Selected</key><string>${title}</string></dict></dict><key>Images</key><dict>${states}</dict></dict>`
}

const plist = `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><array>${TOOLBAR_ITEMS.map(itemXml).join('\n')}</array></plist>\n`

function iosFiles(extra = {}) {
  const files = { 'skin/Info.txt': strToU8('Name=测试\nSupportPlatform=I\n') }
  for (const theme of ['light', 'dark']) {
    files[`skin/${theme}/skin/res/logo/com.baidu.inputmethod.toolbarMenuItems.plist`] = strToU8(`\ufeff${plist}`)
    for (const [, , , file, width, height] of TOOLBAR_ITEMS) {
      files[`skin/${theme}/skin/res/logo/${file.endsWith('.png') ? file : `${file}_iphone@3x.png`}`] = image(width, height, [0x33, 0x99, 0x66, 0xff])
    }
  }
  return { ...files, ...extra }
}

const iosSkin = (extra) => SkinArchive.open(zipSync(iosFiles(extra)), 'bdi')

test('BDI → BDS re-cuts the iOS toolbar artwork into the Android pop_menu_icons atlas', async () => {
  const warnings = []
  const bds = unzipSync(await iosSkin().toBytesAsync('bds', warnings))
  const til = IniDocument.parse(new TextDecoder().decode(bds['light/res/logo/pop_menu_icons.til']))
  // Android bitmap indexes for the same functions: 表情 26, 键盘类型 27, 搜索 31; the plist's menu entries are skipped.
  assert.deepEqual(til.sections().filter((name) => name.startsWith('IMG')), ['IMG26', 'IMG27', 'IMG31'])
  const atlas = decodePng(bds['light/res/logo/pop_menu_icons.png'])
  const tile = (index) => til.get(`IMG${index}`, 'SOURCE_RECT').split(',').map(Number)
  assert.deepEqual(tile(26), [0, 0, 8, 8])
  assert.deepEqual(tile(27), [0, 8, 6, 4])
  assert.deepEqual(tile(31), [0, 12, 8, 8])
  // Each tile is the original iOS picture at the rect the .til names.
  const emoji = decodePng(bds['light/res/logo/1.0/toolbarMenuItem_Emoji_Normal_iphone@3x.png'])
  assert.deepEqual(cropImage(atlas, ...tile(26)), emoji)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /pop_menu_icons/)
  // TILE_NUM has to exceed the highest index or the client stops reading there.
  assert.equal(til.get('GLOBAL', 'TILE_NUM'), '32')
  // The skin keeps its iOS artwork and gains the Android package fields.
  assert.ok(bds['light/res/logo/com.baidu.inputmethod.toolbarMenuItems.plist'])
  assert.ok(bds['light/res/logo/1.0/toolbarMenuItem_Emoji_Normal_iphone@3x.png'])
  assert.match(new TextDecoder().decode(bds['Info.txt']), /SupportPlatform=A/)
})

test('a hand-made Android atlas is left alone when a BDI is exported to BDS', async () => {
  const handMade = image(2, 2, [1, 2, 3, 255])
  const bds = unzipSync(await iosSkin({
    'skin/light/skin/res/logo/pop_menu_icons.png': handMade,
    'skin/light/skin/res/logo/pop_menu_icons.til': strToU8('[GLOBAL]\nTILE_NUM=1\n[IMG0]\nSOURCE_RECT=0,0,2,2\n'),
  }).toBytesAsync('bds'))
  assert.deepEqual(bds['light/res/logo/pop_menu_icons.png'], handMade)
})

test('the toolbar preview follows the format: BDS reads the Android atlas, BDI the iOS plist', async () => {
  const original = globalThis.createImageBitmap
  globalThis.createImageBitmap = async (source) => ({ width: source?.width ?? 8, height: source?.height ?? 8 })
  try {
    const bds = SkinArchive.open(await iosSkin().toBytesAsync('bds'), 'bds')
    const android = await new AtlasResolver(bds, 'light', 'port').resolveToolbarImages()
    // A BDS keeps the iOS plist it was converted from; the preview must still not promise its icons.
    assert.ok(bds.getBytes('light/skin/res/logo/com.baidu.inputmethod.toolbarMenuItems.plist'))
    assert.deepEqual([...new Set(android.map((visual) => visual.imagePath?.split('/').pop()))], ['pop_menu_icons.png'])
    assert.deepEqual(android.map((visual) => visual.source), [[0, 0, 8, 8], [0, 0, 6, 4], [0, 0, 8, 8]])

    const bdi = iosSkin()
    const ios = await new AtlasResolver(bdi, 'light', 'port').resolveToolbarImages()
    assert.ok(ios.every((visual) => visual.imagePath.endsWith('_iphone@3x.png')))
    assert.ok(ios.length > 0)
  } finally {
    globalThis.createImageBitmap = original
  }
})

test('a BDS without the atlas previews no toolbar icons, like the phone', async () => {
  const converted = unzipSync(await iosSkin().toBytesAsync('bds'))
  delete converted['light/res/logo/pop_menu_icons.png']
  delete converted['light/res/logo/pop_menu_icons.til']
  const original = globalThis.createImageBitmap
  globalThis.createImageBitmap = async () => ({ width: 8, height: 8 })
  try {
    assert.deepEqual(await new AtlasResolver(SkinArchive.open(zipSync(converted), 'bds'), 'light', 'port').resolveToolbarImages(), [])
  } finally {
    globalThis.createImageBitmap = original
  }
})
