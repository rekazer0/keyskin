import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { IniDocument } from '../src/ini.ts'
import { SkinArchive } from '../src/skin.ts'
import { legacyHintCandidates, legacyHintHasHold, parseLegacyHint } from '../src/preview-hints.ts'
import { previewItems } from '../src/preview-items.ts'
import { convertSsfDocument, ssfDocumentBytes } from '../src/ssf/ssf-convert.ts'
import { SsfPackage } from '../src/ssf/ssf-package.ts'
import { decodePng, encodePng, nineSliceImage, placeImage } from '../src/ssf/ssf-png.ts'
import { convertSsfToBaidu } from '../src/ssf/ssf-to-baidu.ts'
import { solid, ssfFixture } from './helpers/ssf-fixture.mjs'

const read = path => new Uint8Array(readFileSync(new URL(path, import.meta.url)))
const templates = { sogou: SkinArchive.open(read('../public/sogou-template.bds')), bda: SkinArchive.open(read('../public/default-template.bda'), 'bda') }
const ini = (archive, path) => IniDocument.parse(archive.getText(path))

function popupFixture() {
  const files = unzipSync(ssfFixture())
  for (const [theme, folder] of [['light', 'status1'], ['dark', 'status2']]) {
    const prefix = `1080/${folder}/`
    files[`${prefix}phoneSkin.ini`] = strToU8(`${new TextDecoder().decode(files[`${prefix}phoneSkin.ini`])}
[General]
POPUP_OFFSET_VERTICAL=-12
[BgPopup_Rect]
NORMAL=pop.png,1,158,1,183
[PopupBG]
BG_IMAGE=BgPopup_Rect
PADDINGS=8,10,8,20
[PopupBG_Phone]
BG_IMAGE=BgPopup_Rect
PADDINGS=8,10,8,20
[PopupBG_Qwerty]
BG_IMAGE=pop26.png
[TextStyle_Popup]
TEXT_COLOR=0xFF112233
TEXT_SIZE=0.06
[TextStyle_Popup_Phone_Minor_LongPress]
TEXT_COLOR=0xFF445566
TEXT_SIZE=0.05
[TextStyle_Popup_Phone_LongPress]
TEXT_COLOR=0xFF778899
[TextStyle_Popup_Qwerty]
TEXT_COLOR=0xFF123456
[FGStyle_Phone_Popup]
LABEL_POSITION=0.2,0.4,0.8,0.8
`)
    files[`${prefix}pop.png`] = encodePng(placeImage(solid(111, 140, theme === 'light' ? [10, 20, 30] : [40, 50, 60]), 159, 184, 24, 17))
    files[`${prefix}pop26.png`] = encodePng(solid(120, 180, [70, 80, 90]))
  }
  return zipSync(files)
}

function checkHint(archive, theme, orientation, board) {
  const directory = `${theme}/skin/${orientation}`
  const layout = ini(archive, `${directory}/${board}.ini`)
  const name = layout.get('HINT', 'LAYOUT_NAME') ?? ini(archive, `${directory}/gen.ini`).get('HINT', 'LAYOUT_NAME')
  assert.ok(name, `${directory}/${board}: missing popup reference`)
  const hint = parseLegacyHint(ini(archive, `${directory}/${name}.pop`))
  assert.ok(hint?.icons.has(hint.holdIcon), 'tap bubble exists')
  assert.ok(hint.icons.has(hint.barIcon), 'long-press bar exists')
  const key = previewItems(layout).find(key => key.center === (board === 'py_26' ? 'q' : 'b'))
  assert.equal(legacyHintHasHold(key, hint, true), true)
  assert.deepEqual(legacyHintCandidates(key, 'hold', true), board === 'py_26' ? ['Q', '1', 'q'] : ['A', 'B', 'C', '2', 'a', 'b', 'c'])
  const css = ini(archive, `${theme}/skin/res/default.css`)
  const tap = hint.icons.get(hint.holdIcon)
  const bar = hint.icons.get(hint.barIcon)
  const text = css.entries(`STYLE${bar.foreStyle}`)
  assert.ok(text.some(({ key }) => key === 'FONT_SIZE'))
  const [image] = css.get(`STYLE${tap.backStyle}`, 'NM_IMG').split(',')
  const background = decodePng(archive.getBytes(`${theme}/skin/res/${image}.png`))
  return { hint, tap, bar, css, image, background }
}

test('SSF → BDS/BDI packages retain tap and long-press bubbles in both themes and orientations', async () => {
  const source = SkinArchive.open(await ssfDocumentBytes(popupFixture()), 'ssf')
  for (const format of ['bds', 'bdi']) {
    const { bytes } = await convertSsfDocument(source, format, templates)
    const archive = SkinArchive.open(bytes, format)
    for (const theme of ['light', 'dark']) for (const orientation of ['port', 'land']) {
      const phone = checkHint(archive, theme, orientation, 'py_9')
      assert.deepEqual(phone.tap.size, [159, 184])
      assert.deepEqual(phone.bar.padding, [32, 10, 32, 20])
      assert.deepEqual(phone.tap.padding, [32, 74, 32, 37])
      assert.deepEqual(phone.tap.position, [0, -12])
      const center = (92 * phone.background.width + 79) * 4
      assert.deepEqual([...phone.background.data.subarray(center, center + 3)], theme === 'light' ? [10, 20, 30] : [40, 50, 60])
      assert.equal(phone.css.get(`STYLE${phone.tap.foreStyle}`, 'FONT_SIZE'), '65')
      assert.equal(phone.css.get(`STYLE${phone.bar.foreStyle}`, 'NM_COLOR'), 'FF445566')
      assert.equal(phone.css.get(`STYLE${phone.bar.foreStyle}`, 'HL_COLOR'), 'FF778899')
      assert.equal(ini(archive, `${theme}/skin/res/${phone.image}.til`).get('IMG1', 'INNER_RECT'), '1,1,157,182')
      const [barImage] = phone.css.get(`STYLE${phone.bar.backStyle}`, 'NM_IMG').split(',')
      const barTile = ini(archive, `${theme}/skin/res/${barImage}.til`)
      const image = decodePng(archive.getBytes(`${theme}/skin/res/${barImage}.png`))
      const cellWidth = phone.hint.cellSize[0]
      const barWidth = phone.bar.padding[0] + cellWidth * 7 + phone.bar.padding[2]
      const rendered = nineSliceImage(image, [0, 0, image.width, image.height], barTile.get('IMG1', 'INNER_RECT').split(',').map(Number), barWidth, 184)
      for (const index of [0, 6]) {
        const x = Math.round(phone.bar.padding[0] + cellWidth * (index + 0.5))
        assert.equal(rendered.data[(92 * barWidth + x) * 4 + 3], 255, 'outer long-press characters stay on the bubble background')
      }
      const qwerty = checkHint(archive, theme, orientation, 'py_26')
      assert.deepEqual(qwerty.tap.size, [120, 180])
      assert.equal(qwerty.css.get(`STYLE${qwerty.tap.foreStyle}`, 'NM_COLOR'), 'FF123456')
      assert.deepEqual([...qwerty.background.data.subarray(0, 3)], [70, 80, 90])
    }
    for (const path of archive.names().filter(path => /\/(port|land)\/[^/]+\.ini$/.test(path))) {
      const layout = ini(archive, path)
      const name = layout.get('HINT', 'LAYOUT_NAME')
      if (layout.sections().some(section => /^KEY\d+$/.test(section))) {
        assert.ok(name && archive.isText(`${path.slice(0, path.lastIndexOf('/'))}/${name}.pop`), path)
      }
    }
  }
})

test('SSF popup geometry, stretch bands and text sizes follow the target resolution', async () => {
  const { archive } = convertSsfToBaidu(await SsfPackage.open(popupFixture()), templates.sogou, 720)
  const phone = checkHint(archive, 'light', 'port', 'py_9')
  assert.deepEqual(phone.tap.size, [106, 123])
  assert.deepEqual(phone.tap.position, [0, -8])
  assert.deepEqual(phone.bar.padding, [21, 7, 21, 13])
  assert.equal(phone.css.get(`STYLE${phone.bar.foreStyle}`, 'FONT_SIZE'), '36')
  assert.equal(ini(archive, `light/skin/res/${phone.image}.til`).get('IMG1', 'INNER_RECT'), '1,1,104,121')
  assert.deepEqual([phone.background.width, phone.background.height], [106, 123])
})

test('SSF skins without popup artwork still export usable colour bubbles', async () => {
  const { archive } = convertSsfToBaidu(await SsfPackage.open(ssfFixture({ single: true })), templates.sogou, 1080)
  for (const orientation of ['port', 'land']) {
    const directory = `light/skin/${orientation}`
    const gen = ini(archive, `${directory}/gen.ini`)
    const hint = parseLegacyHint(ini(archive, `${directory}/${gen.get('HINT', 'LAYOUT_NAME')}.pop`))
    const css = ini(archive, 'light/skin/res/default.css')
    assert.ok(hint?.barIcon)
    assert.equal(css.get(`STYLE${hint.icons.get(hint.barIcon).backStyle}`, 'NM_COLOR'), 'FFFFFFFF')
  }
})
