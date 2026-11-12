import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { strFromU8, strToU8, unzipSync } from 'fflate'
import { IniDocument } from '../src/ini.ts'
import { SkinArchive } from '../src/skin.ts'
import { decodeBdaAppearance } from '../src/bda-decode.ts'
import { ssfKeyBinding } from '../src/ssf/ssf-keymap.ts'
import { ssfForeground, ssfIconPair } from '../src/ssf/ssf-parts.ts'
import { applySsfKeyImage } from '../src/ssf/ssf-layout-image.ts'
import { SsfPackage } from '../src/ssf/ssf-package.ts'
import { SsfStyles, ssfBoardScene } from '../src/ssf/ssf-scene.ts'
import { SsfLook } from '../src/ssf/ssf-look.ts'
import { ssfToBaiduFiles } from '../src/ssf/ssf-to-baidu.ts'
import { convertSsfToBda } from '../src/ssf/ssf-to-bda.ts'
import { decodePng, encodePng } from '../src/ssf/ssf-png.ts'
import { ssfFixture, solid } from './helpers/ssf-fixture.mjs'

const parse = (files, path) => IniDocument.parse(strFromU8(files.get(path)))
const binding = (action = 'F38', land = false) => ssfKeyBinding('py_26', action, land)
const template = (name) => SkinArchive.open(new Uint8Array(readFileSync(new URL(`../public/${name}`, import.meta.url))))
const transparent = (image) => image.data.every((value, index) => index % 4 !== 3 || value === 0)
function inkBox(image) {
  let left = image.width, top = image.height, right = 0, bottom = 0
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    if (!image.data[(y * image.width + x) * 4 + 3]) continue
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1)
  }
  return [left, top, right, bottom]
}
function fixture(extra) {
  const files = new Map(Object.entries(unzipSync(ssfFixture({ single: true }))))
  const skin = parse(files, '1080/phoneSkin.ini')
  extra(skin, files)
  files.set('1080/phoneSkin.ini', strToU8(skin.toString()))
  return { files, pkg: SsfPackage.fromFiles(files), skin }
}

async function scene(skinText, action, texts = ['q'], land = false) {
  const files = new Map([['phoneTheme.ini', strToU8('[General]\nskin_type=1\n')], ['1080/phoneSkin.ini', strToU8(skinText)]])
  const pkg = SsfPackage.fromFiles(files)
  const styles = new SsfStyles(SkinArchive.fromSourceFiles([...files].map(([path, data]) => ({ path, data }))), pkg, 'light')
  styles.file = async (name) => name === 'icon.png' ? { source: [0, 0, 10, 10], image: {} } : undefined
  const layout = IniDocument.parse(`[KEY1]\nCENTER=${action}\nVIEW_RECT=0,0,100,100\nFORE_STYLE=${texts.map((_, i) => i + 1).join(',')}\n`)
  const resolver = {
    resolveStyleText: (id) => texts[Number(id) - 1] ? { text: texts[Number(id) - 1], fontSize: 24 } : undefined,
    resolve: async () => ({ source: [0, 0, 10, 10], image: {} }),
  }
  const result = await ssfBoardScene(styles, { layout, template: layout, resolver, scale: 1 }, 'py_26', land, { width: 1080, height: 100, barHeight: 0 })
  return result.keys[0]
}

test('ICONS selects its first file or image section, with explicit ICON and pressed overrides taking priority', () => {
  const skin = IniDocument.parse('[Key_Space]\nICONS=SpaceIcons,unused.png\n[SpaceIcons]\nNORMAL=icon.png\nPRESSED=down.png\n')
  assert.deepEqual(ssfIconPair(skin, 'Key_Space'), { normal: 'icon.png', pressed: 'down.png', images: 'SpaceIcons' })
  assert.deepEqual(ssfForeground(skin, IniDocument.parse(''), binding()), { kind: 'icon', owner: 'Key_Space' })
  skin.set('Key_Space', 'ICON_PRESSED', 'override.png')
  assert.equal(ssfIconPair(skin, 'Key_Space').pressed, 'override.png')
  skin.set('Key_Space', 'ICON', 'direct.png')
  assert.deepEqual(ssfIconPair(skin, 'Key_Space'), { normal: 'direct.png', pressed: 'override.png' })
  skin.remove('Key_Space', 'ICON')
  skin.set('Key_Space', 'ICONS', 'first.png,second.png')
  assert.equal(ssfIconPair(skin, 'Key_Space').normal, 'first.png')
})

test('transparent landscape icon overrides portrait and allows a visible pressed state without a placeholder file', async () => {
  const text = '[Key_Space]\nICON=icon.png\n[Key_Space_Land]\nICON=transparent.png\nICON_PRESSED=icon.png\n'
  const key = await scene(text, 'F38', ['space'], true)
  assert.deepEqual(key.layers(false).fore, [])
  assert.equal(key.layers(true).fore[0].kind, 'image')
  const { pkg } = fixture((skin) => {
    skin.set('Key_Space', 'ICON', 'delf_26.png')
    skin.appendSection('Key_Space_Land', [{ key: 'ICON', value: 'transparent.png' }, { key: 'ICON_PRESSED', value: 'delf_26.png' }])
  })
  const warnings = []
  const fore = new SsfLook(pkg, 'light', warnings).key('py_26', 'F38', true).fore
  assert.ok(transparent(decodePng(fore.normal.bytes)))
  assert.ok(!transparent(decodePng(fore.pressed.bytes)))
  assert.deepEqual(warnings, [])
  const skeletonLook = new SsfLook(pkg, 'light', []).key('py_26', 'F38', true, [100, 100], 'Key_Space')
  assert.ok(transparent(decodePng(skeletonLook.fore.normal.bytes)))
  assert.ok(!transparent(decodePng(skeletonLook.fore.pressed.bytes)))
  assert.deepEqual(ssfKeyBinding('py_26', 'F38', true, 'Key_Space').sections.slice(0, 2), ['Key_Space_Land', 'Key_Space'])
})

test('normal foreground replacement preserves the pressed icon, including ICONS groups and explicit transparency', async () => {
  for (const normal of ['icon.png', 'transparent.png']) {
    const skin = IniDocument.parse(`[Key_Space]\nICONS=SpaceIcons\n[SpaceIcons]\nNORMAL=${normal}\nPRESSED=down.png\n`)
    const keys = IniDocument.parse('')
    applySsfKeyImage(skin, keys, binding(), 'fore-normal', 'replacement.png')
    const images = keys.get('Key_Space', 'FG_IMAGES')
    assert.equal(keys.get(images, 'NORMAL'), 'replacement.png')
    assert.equal(keys.get(images, 'PRESSED'), 'down.png')
  }
  const key = await scene('[Key_Space]\nICON=icon.png\n', 'F38')
  assert.equal(key.layers(false).fore[0].kind, 'image')
})

test('native foreground visibility keeps main/minor identities and ICON_RECT fits custom and built-in icons', async () => {
  for (const [main, minor, expected] of [[0, 1, ['minor']], [1, 0, ['main']], [0, 0, []]]) {
    const key = await scene(`[Key_W]\nFG_STYLE=Own\nLABEL=main\nMINOR_LABEL=minor\n[Own]\nLABEL_VISIBLE=${main}\nMINOR_LABEL_VISIBLE=${minor}\n`, 'w', ['W', '2'])
    assert.deepEqual(key.layers(false).fore.map((layer) => layer.text.text), expected.map((value) => value.toUpperCase()))
  }
  for (const icon of ['', 'ICON=icon.png\n']) {
    const key = await scene(`[Key_Backspace_Qwerty]\n${icon}FG_STYLE=Own\n[Own]\nICON_RECT=0.1,0.1,0.2,0.2\n`, 'F36', [null])
    const rect = key.layers(false).fore[0].rect
    for (const [field, value] of Object.entries({ x: 10, y: 10, width: 10, height: 10 })) assert.ok(Math.abs(rect[field] - value) < 1e-8)
  }
})

test('ICONS, missing transparent sentinel, label switches and icon bounds survive BDS and BDA export', () => {
  const { pkg } = fixture((skin) => {
    skin.appendSection('Key_Space_Land', [{ key: 'ICON', value: 'transparent.png' }, { key: 'ICON_PRESSED', value: 'delf_26.png' }])
    skin.appendSection('Key_W', [{ key: 'ICONS', value: 'CustomIcons,unused.png' }, { key: 'FG_STYLE', value: 'IconLayout' }])
    skin.appendSection('CustomIcons', [{ key: 'NORMAL', value: 'delf_26.png' }, { key: 'PRESSED', value: '26q_x.png' }])
    skin.appendSection('IconLayout', [{ key: 'ICON_RECT', value: '0.1,0.1,0.3,0.3' }])
    skin.remove('Key_Backspace_Qwerty', 'ICON')
    skin.set('Key_Backspace_Qwerty', 'FG_STYLE', 'IconLayout')
    skin.appendSection('Key_SwitchToEN_Qwerty', [{ key: 'FG_STYLE', value: 'HiddenLabel' }])
    skin.appendSection('Key_E', [{ key: 'FG_STYLE', value: 'HiddenLabel' }])
    skin.appendSection('HiddenLabel', [{ key: 'LABEL_VISIBLE', value: '0' }, { key: 'MINOR_LABEL_VISIBLE', value: '1' }])
  })
  for (const width of [320, 1080]) {
    const bds = ssfToBaiduFiles(pkg, template('sogou-template.bds'), width)
    const css = parse(bds.files, 'light/skin/res/default.css')
    for (const orientation of ['port', 'land']) {
      const layout = parse(bds.files, `light/skin/${orientation}/py_26.ini`)
      const key = (action) => layout.sections().find((name) => layout.get(name, 'CENTER') === action)
      const ids = (action) => layout.get(key(action), 'FORE_STYLE').split(',')
      const image = (action, state = 'NM_IMG') => decodePng(bds.files.get(`light/skin/res/${css.get(`STYLE${ids(action)[0]}`, state).split(',')[0]}.png`))
      assert.ok(transparent(image('F38')), `${orientation}: missing transparent.png stays hidden`)
      if (orientation === 'land') assert.ok(!transparent(image('F38', 'HL_IMG')))
      for (const action of ['w', 'F36']) {
        const [, , width, height] = layout.get(key(action), 'VIEW_RECT').split(',').map(Number)
        const glyph = image(action)
        assert.deepEqual([glyph.width, glyph.height], [width, height])
        const [left, top, right, bottom] = inkBox(glyph)
        assert.ok(left >= width * 0.1 - 1 && top >= height * 0.1 - 1 && right <= width * 0.3 + 1 && bottom <= height * 0.3 + 1)
      }
      const switchStyles = ids('F16').map((id) => `STYLE${id}`)
      assert.equal(css.get(switchStyles[0], 'NM_COLOR'), '00000000')
      assert.notEqual(css.get(switchStyles[1], 'NM_COLOR'), '00000000')
    }
  }
  const { archive } = convertSsfToBda(pkg, template('default-template.bda'))
  for (const orientation of ['port', 'land']) {
    const appearance = decodeBdaAppearance(archive.getBytes(`light/skin/${orientation}/appearanceConfig`))
    const keys = appearance.panels.get('py_26').keys
    const image = (action, state = 'normalImage') => {
      const style = appearance.imageStyles.get(keys.get(`KEY_${action}`).foreStyles[0].key)
      return decodePng(archive.getBytes(`light/skin/res/${style[state].resource.resourceID}.png`))
    }
    assert.ok(transparent(image('F38')))
    if (orientation === 'land') assert.ok(!transparent(image('F38', 'highlightImage')))
    assert.ok(!transparent(image('W')))
    const refs = keys.get('KEY_E').foreStyles.filter((ref) => ref.type === 'text')
    assert.equal(appearance.textStyles.get(refs[0].key).normalColor, 0)
    assert.notEqual(appearance.textStyles.get(refs[1].key).normalColor, 0)
    const glyph = image('F36')
    const [left, top, right, bottom] = inkBox(glyph)
    assert.ok(left >= glyph.width * 0.1 - 1 && top >= glyph.height * 0.1 - 1 && right <= glyph.width * 0.3 + 1 && bottom <= glyph.height * 0.3 + 1)
  }
})
