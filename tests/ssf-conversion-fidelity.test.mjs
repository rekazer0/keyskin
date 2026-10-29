import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { IniDocument } from '../src/ini.ts'
import { SkinArchive } from '../src/skin.ts'
import { offsetFromSection } from '../src/preview-items.ts'
import { parseLegacyAnimation } from '../src/preview-animation.ts'
import { convertBaiduToSsf } from '../src/ssf/baidu-to-ssf.ts'
import { convertSsfToBaidu } from '../src/ssf/ssf-to-baidu.ts'
import { convertSsfToBda } from '../src/ssf/ssf-to-bda.ts'
import { decodeBdaAppearance } from '../src/bda-decode.ts'
import { SsfPackage } from '../src/ssf/ssf-package.ts'
import { SsfLook } from '../src/ssf/ssf-look.ts'
import { decodePng, encodePng } from '../src/ssf/ssf-png.ts'
import { ssfFixture, solid } from './helpers/ssf-fixture.mjs'

const templateBytes = new Uint8Array(readFileSync(new URL('../public/default-template.bds', import.meta.url)))
const template = SkinArchive.open(templateBytes)
const pixel = (image, x, y) => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)]
const parse = (files, path) => IniDocument.parse(new TextDecoder().decode(files[path]))
const keySection = (document, action) => document.sections().find((name) => /^KEY\d+$/.test(name) && document.get(name, 'CENTER') === action)

function styleImage(archive, styleID) {
  const css = IniDocument.parse(archive.getText('light/skin/res/default.css'))
  const [name] = css.get(`STYLE${styleID}`, 'NM_IMG').split(',')
  return decodePng(archive.getBytes(`light/skin/res/${name}.png`))
}

test('Baidu R_POS uses percentages of the key; POS stays in pixels', () => {
  const document = IniDocument.parse('[OFFSET1]\nR_POS=25,-25\n[OFFSET2]\nPOS=4,-3\nR_POS=99,99\n')
  assert.deepEqual(offsetFromSection(document, 'OFFSET1', { width: 80, height: 40 }), [20, -10])
  assert.deepEqual(offsetFromSection(document, 'OFFSET2', { width: 80, height: 40 }), [4, -3])
})

test('Baidu → SSF places R_POS foregrounds relative to the key and respects explicit offsets', async () => {
  for (const explicit of [undefined, '1,2']) {
    const files = unzipSync(templateBytes)
    const layout = parse(files, 'port/py_26.ini')
    const q = keySection(layout, 'q')
    const [, , width, height] = layout.get(q, 'VIEW_RECT').split(',').map(Number)
    layout.set(q, 'FORE_STYLE', '99002')
    layout.set(q, 'POS_TYPE', '1')
    layout.remove(q, 'FORE_OFFSET')
    if (explicit) layout.set(q, 'FORE_OFFSET', explicit)
    const gen = parse(files, 'port/gen.ini')
    gen.removeSections(['OFFSET1'])
    gen.appendSection('OFFSET1', [{ key: 'R_POS', value: '25,-25' }])
    const css = parse(files, 'res/default.css')
    css.appendSection('STYLE99002', [{ key: 'NM_IMG', value: 'offset_glyph,1' }])
    files['res/offset_glyph.png'] = encodePng(solid(6, 6, [12, 34, 56]))
    files['res/offset_glyph.til'] = strToU8('[IMG1]\nSOURCE_RECT=0,0,6,6\n')
    files['port/py_26.ini'] = strToU8(layout.toString())
    files['port/gen.ini'] = strToU8(gen.toString())
    files['res/default.css'] = strToU8(css.toString())
    const { bytes } = await convertBaiduToSsf(SkinArchive.open(zipSync(files)))
    const pkg = await SsfPackage.open(bytes)
    const rect = pkg.keys('light').get('Key_Q', 'FG_RECT').split(',').map(Number)
    const [dx, dy] = explicit ? [1, 2] : [Math.trunc(width / 4), Math.trunc(-height / 4)]
    const left = Math.round((width - 6) / 2 + dx)
    const top = Math.round((height - 6) / 2 + dy)
    const expected = [left / width, top / height, (left + 6) / width, (top + 6) / height]
    rect.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 0.001, `${explicit ?? 'R_POS'}: ${rect}`))
  }
})

test('SSF foreground replaces template offsets and fills its FG_RECT in the target key', async () => {
  const files = unzipSync(templateBytes)
  const layout = parse(files, 'port/py_26.ini')
  const q = keySection(layout, 'q')
  layout.set(q, 'POS_TYPE', '1')
  files['port/py_26.ini'] = strToU8(layout.toString())
  const { archive } = convertSsfToBaidu(await SsfPackage.open(ssfFixture()), SkinArchive.open(zipSync(files)))
  const result = IniDocument.parse(archive.getText('light/skin/port/py_26.ini'))
  assert.equal(result.get(q, 'POS_TYPE'), undefined)
  assert.equal(result.get(q, 'FORE_OFFSET'), undefined)
  const [, , width, height] = result.get(q, 'VIEW_RECT').split(',').map(Number)
  const image = styleImage(archive, result.get(q, 'FORE_STYLE'))
  assert.deepEqual([image.width, image.height], [width, height])
  assert.equal(pixel(image, width >> 1, Math.floor(height * 0.1))[3], 0)
  assert.ok(pixel(image, width >> 1, Math.floor(height * 0.5))[3] > 0)
})

test('SSF explicit transparent function icon also hides the Baidu template icon', async () => {
  const files = unzipSync(ssfFixture())
  const skin = parse(files, '1080/status1/phoneSkin.ini')
  skin.appendSection('Key_Enter_Qwerty', [{ key: 'ICON', value: 'transparent.png' }])
  files['1080/status1/phoneSkin.ini'] = strToU8(skin.toString())
  files['1080/status1/transparent.png'] = encodePng(solid(1, 1, [0, 0, 0], 0))
  const { archive } = convertSsfToBaidu(await SsfPackage.open(zipSync(files)), template)
  const layout = IniDocument.parse(archive.getText('light/skin/port/py_26.ini'))
  const image = styleImage(archive, layout.get(keySection(layout, 'F39'), 'FORE_STYLE'))
  assert.ok(image.data.every((value, index) => index % 4 !== 3 || value === 0))
})

test('SSF FG_RECT uses right/bottom edges and fits the glyph without stretching in landscape', async () => {
  const pkg = await SsfPackage.open(ssfFixture())
  pkg.keys('light').set('Key_Q', 'FG_RECT', '0.25,0.1,0.75,0.9')
  const image = decodePng(new SsfLook(pkg, 'light', [], 1080).key('py_26', 'q', true, [200, 100]).fore.normal.bytes)
  const points = []
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) if (pixel(image, x, y)[3]) points.push([x, y])
  assert.deepEqual([
    Math.min(...points.map(([x]) => x)), Math.min(...points.map(([, y]) => y)),
    Math.max(...points.map(([x]) => x)) + 1, Math.max(...points.map(([, y]) => y)) + 1,
  ], [57, 10, 144, 90])
})

test('Baidu → SSF → Baidu applies a translucent candidate background only once', async () => {
  const files = unzipSync(templateBytes)
  const gen = parse(files, 'port/gen.ini')
  const candPath = `port/${gen.get('CAND', 'LAYOUT_NAME')}.cnd`
  const cand = parse(files, candPath)
  const css = parse(files, 'res/default.css')
  css.appendSection('STYLE99001', [{ key: 'NM_COLOR', value: '80406080' }])
  cand.set('CAND', 'BACK_STYLE', '99001')
  files[candPath] = strToU8(cand.toString())
  files['res/default.css'] = strToU8(css.toString())
  const { bytes } = await convertBaiduToSsf(SkinArchive.open(zipSync(files)))
  const pkg = await SsfPackage.open(bytes)
  const look = new SsfLook(pkg, 'light', [], 1080)
  const image = decodePng(look.keyboard().cand.bytes)
  assert.deepEqual(pixel(image, image.width >> 1, image.height >> 1), [64, 96, 128, 128])
})

test('SSF RootView BG_STYLE=2 uses BG_COLOR ahead of an inactive BG_IMAGE', async () => {
  const files = unzipSync(ssfFixture())
  const skin = parse(files, '1080/status1/phoneSkin.ini')
  skin.set('RootView', 'BG_STYLE', '2')
  skin.set('RootView', 'BG_COLOR', '0xFF123456')
  skin.appendSection('WALLPAPER', [{ key: 'BG_IMAGE', value: 'bg.png' }])
  files['1080/status1/phoneSkin.ini'] = strToU8(skin.toString())
  const look = new SsfLook(await SsfPackage.open(zipSync(files)), 'light', [])
  assert.equal(Boolean(look.keyboard().panel), false)
  assert.equal(look.keyboard().panelColor, 'FF123456')
  const pkg = await SsfPackage.open(zipSync(files))
  const { archive } = convertSsfToBaidu(pkg, template)
  const gen = IniDocument.parse(archive.getText('light/skin/port/gen.ini'))
  const css = IniDocument.parse(archive.getText('light/skin/res/default.css'))
  assert.equal(css.get(`STYLE${gen.get('PANEL', 'BACK_STYLE')}`, 'NM_COLOR'), 'FF123456')
  const bda = SkinArchive.open(new Uint8Array(readFileSync(new URL('../public/default-template.bda', import.meta.url))), 'bda')
  const converted = convertSsfToBda(pkg, bda)
  assert.ok(!converted.warnings.some((warning) => warning.includes('纯色背景')))
  for (const orientation of ['port', 'land']) {
    const appearance = decodeBdaAppearance(converted.archive.getBytes(`light/skin/${orientation}/appearanceConfig`))
    const ref = appearance.panels.get('py_26').backStyle
    assert.equal(ref.type, 'color')
    assert.equal(appearance.colorStyles.get(ref.key).normalColor, 0xFF123456)
  }
})

const SOGOU_ANIM = `[Anim_Style_Key_Qwertys]
BG_ANIM=Animation_fun
DECO_ANIM=Animation_1
DECO_ANIM_NUMBER=-1
[Animation_fun]
DOWN_ANIM_OBJ=Anim_Obj_fun
[Anim_Obj_fun]
ANIM=Anim_fun_scale
[Anim_fun_scale]
TYPE=2
DURATION=260
KEYFRAME=Keyframe_fun,Keyframe_fun
[Keyframe_fun]
TIME=0,0.5,1
VALUE=1,0.9,1
[Animation_1]
DOWN_ANIM_OBJ=Anim_Obj_1
[Anim_Obj_1]
IMG=01.png
POS_ANCHOR=0
NEW_POS_X=0,0
NEW_POS_Y=-0.15,-0.15
RATE_KEY_W=0.5
RATE_KEY_H=0.5
RELATETO=1,1
ANIM=Anim_1
[Anim_1]
ANIM_SET=Anim_throw,Anim_fade
PLAY_METHOD=0
[Anim_throw]
TYPE=1
DURATION=600
START_VALUE=0,0
VELOCITY=0,-500
ACCELERATION=0,1500
[Anim_fade]
TYPE=4
DURATION=600
KEYFRAME=Keyframe_fade
[Keyframe_fade]
TIME=0,1
VALUE=255,150
`

test('SSF key animations become Baidu press animations: key layer bounce and thrown decorations', async () => {
  const files = unzipSync(ssfFixture())
  files['1080/status1/anim.ini'] = strToU8(SOGOU_ANIM)
  files['1080/status1/01.png'] = encodePng(solid(40, 40, [9, 8, 7]))
  const { archive, warnings } = convertSsfToBaidu(await SsfPackage.open(zipSync(files)), template)
  assert.ok(!warnings.some((warning) => /anim\.ini/.test(warning)))
  const layout = IniDocument.parse(archive.getText('light/skin/port/py_26.ini'))
  const css = IniDocument.parse(archive.getText('light/skin/res/default.css'))
  const anim = IniDocument.parse(archive.getText('light/skin/res/anim.ini'))
  const q = keySection(layout, 'q')
  const press = css.get(`STYLE${layout.get(q, 'BACK_ANIM_STYLE')}`, 'PRESS_ANIM')
  const parts = anim.get(`ANIM${press}`, 'BUILD_LIST').split(',').map((id) => `ANIM${id.trim()}`)
  // 1 → 0.9 → 1 plays as two scale segments in turn.
  const bounce = parts.find((part) => anim.get(part, 'BUILD_METHOD') === '1')
  const segments = anim.get(bounce, 'BUILD_LIST').split(',').map((id) => `ANIM${id.trim()}`)
  assert.deepEqual(segments.map((part) => [anim.get(part, 'TYPE'), anim.get(part, 'FROM'), anim.get(part, 'TO'), anim.get(part, 'DURATION')]),
    [['4', '100,100', '90,90', '130'], ['4', '90,90', '100,100', '130']])
  // The decoration flies up from above the key centre and fades from 255 to 150 in 0.6 s.
  const particle = parts.find((part) => anim.get(part, 'CATEGORY') === '3')
  assert.equal(anim.get(particle, 'EMIT_REGION'), '0.5,0.35,0,0')
  assert.equal(anim.get(particle, 'VELOCITY_DIRECTION'), '-90,-90')
  assert.equal(anim.get(particle, 'ACCELERATION_DIRECTION'), '90,90')
  assert.equal(anim.get(particle, 'ALPHA_SPEED'), '-175,-175')
  assert.equal(anim.get(particle, 'LIFE'), '600,600')
  assert.ok(css.get(`STYLE${anim.get(particle, 'PARTICLE_IMAGE')}`, 'NM_IMG'))
  // The 9-key board has no ANIM_STYLE of its own and plays nothing (the fixture has no Anim_Style_Key).
  const nine = IniDocument.parse(archive.getText('light/skin/port/py_9.ini'))
  assert.ok(keySection(nine, 'b'))
  assert.equal(nine.get(keySection(nine, 'b'), 'BACK_ANIM_STYLE'), undefined)
  // The editor previews what it wrote.
  const preview = parseLegacyAnimation(css, anim).get(layout.get(q, 'BACK_ANIM_STYLE'))
  assert.equal(preview.particles.length, 1)
})

test('SSF → BDI puts the Sogou pinyin bar in the iOS input row above the candidate bar', async () => {
  const files = unzipSync(ssfFixture())
  const skin = parse(files, '1080/status1/phoneSkin.ini')
  skin.appendSection('VPA_Bar', [{ key: 'BG_IMAGE', value: 'vpabg.png' }, { key: 'COMPOSING_TEXT_COLOR', value: '0xFF123456' }])
  files['1080/status1/phoneSkin.ini'] = strToU8(skin.toString())
  files['1080/status1/vpabg.png'] = encodePng(solid(1080, 84, [200, 10, 10]))
  const pkg = await SsfPackage.open(zipSync(files))
  const bds = convertSsfToBaidu(pkg, template).archive
  assert.ok(!IniDocument.parse(bds.getText('light/skin/port/gen.ini')).sections().includes('SCAND'))

  const { archive } = convertSsfToBaidu(pkg, template, undefined, 'bdi')
  const gen = IniDocument.parse(archive.getText('light/skin/port/gen.ini'))
  // Full panel width (480 here), so iOS takes the row height from it: 84 Sogou pixels × 480/1080.
  const row = styleImage(archive, gen.get('SCAND', 'BACK_STYLE'))
  assert.deepEqual([row.width, row.height], [480, 37])
  assert.deepEqual(pixel(row, 10, 10), [200, 10, 10, 255])
  const candidates = IniDocument.parse(archive.getText(`light/skin/port/${gen.get('CAND', 'LAYOUT_NAME')}.cnd`))
  const bar = styleImage(archive, candidates.get('CAND', 'BACK_STYLE'))
  const bdsBar = styleImage(bds, IniDocument.parse(bds.getText(`light/skin/port/${gen.get('CAND', 'LAYOUT_NAME')}.cnd`)).get('CAND', 'BACK_STYLE'))
  // iOS stretches the candidate background over both rows: the pinyin bar sits on top of the Sogou bar.
  assert.equal(bar.width, bdsBar.width)
  assert.equal(bar.height, bdsBar.height + Math.round(37 * bar.width / 480))
  assert.deepEqual(pixel(bar, 10, 2), [200, 10, 10, 255])
  assert.deepEqual(pixel(bar, 10, bar.height - 2), pixel(bdsBar, 10, bdsBar.height - 2))
  const css = IniDocument.parse(archive.getText('light/skin/res/default.css'))
  assert.equal(css.get(`STYLE${gen.get('INPUT', 'FORE_STYLE')}`, 'NM_COLOR'), 'FF123456')
})
