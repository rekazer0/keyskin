import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { strFromU8, strToU8, unzipSync } from 'fflate'
import { IniDocument } from '../src/ini.ts'
import { SkinArchive } from '../src/skin.ts'
import { decodeBdaAppearance } from '../src/bda-decode.ts'
import { SsfLook } from '../src/ssf/ssf-look.ts'
import { SsfPackage } from '../src/ssf/ssf-package.ts'
import { ssfToBaiduFiles } from '../src/ssf/ssf-to-baidu.ts'
import { convertSsfToBda } from '../src/ssf/ssf-to-bda.ts'
import { decodePng, encodePng } from '../src/ssf/ssf-png.ts'
import { solid, ssfFixture } from './helpers/ssf-fixture.mjs'

const template = SkinArchive.open(new Uint8Array(readFileSync(new URL('../public/sogou-template.bds', import.meta.url))))
const read = (files, path) => IniDocument.parse(strFromU8(files.get(path)))

test('SSF implicit enter ICON_RECT survives Baidu export in both themes, orientations and resolutions', () => {
  const files = new Map(Object.entries(unzipSync(ssfFixture())))
  for (const theme of ['status1', 'status2']) {
    const path = `1080/${theme}/phoneSkin.ini`
    const styles = ['FGStyle_Enter_Py9', 'FGStyle_Enter_Py26'].flatMap((name) => [name, `${name}_Land`])
    files.set(path, strToU8(strFromU8(files.get(path)) + `
[Key_Enter]
ICON=send.png
ICON_PRESSED=send_p.png
[Key_Enter_Qwerty]
ICON=send.png
ICON_PRESSED=send_p.png
${styles.map((name) => `[${name}]\nICON_RECT=0.6,0.05,1,0.35`).join('\n')}
`))
    files.set(`1080/${theme}/send.png`, encodePng(solid(64, 39, [11, 22, 33])))
    files.set(`1080/${theme}/send_p.png`, encodePng(solid(64, 39, [44, 55, 66])))
  }
  const pkg = SsfPackage.fromFiles(files)
  for (const width of [480, 1080]) {
    const { files: output } = ssfToBaiduFiles(pkg, template, width)
    for (const theme of ['light', 'dark']) for (const orientation of ['port', 'land']) for (const board of ['py_9', 'py_26']) {
      const layout = read(output, `${theme}/skin/${orientation}/${board}.ini`)
      const key = layout.sections().find((section) => layout.get(section, 'CENTER') === 'F39')
      const [, , w, h] = layout.get(key, 'VIEW_RECT').split(',').map(Number)
      const css = read(output, `${theme}/skin/res/default.css`)
      const style = `STYLE${layout.get(key, 'FORE_STYLE')}`
      assert.equal(layout.get(key, 'FORE_OFFSET'), undefined)
      assert.equal(layout.get(key, 'POS_TYPE'), undefined)
      for (const [state, rgb] of [['NM_IMG', [11, 22, 33]], ['HL_IMG', [44, 55, 66]]]) {
        const image = decodePng(output.get(`${theme}/skin/res/${css.get(style, state).split(',')[0]}.png`))
        assert.deepEqual([image.width, image.height], [w, h])
        const pixel = (x, y) => [...image.data.slice((Math.floor(y) * w + Math.floor(x)) * 4, (Math.floor(y) * w + Math.floor(x)) * 4 + 4)]
        assert.equal(pixel(w / 2, h / 2)[3], 0, 'send icon must leave the key centre transparent')
        assert.deepEqual(pixel(w * 0.8, h * 0.2), [...rgb, 255], `${theme}/${orientation}/${board} ${state}: send icon sits in the top-right bubble`)
      }
    }
  }
})

test('official SSF skeleton keeps composite default labels and space icon groups in both orientations', () => {
  const css = IniDocument.parse(template.getText('light/skin/res/default.css'))
  for (const orientation of ['port', 'land']) {
    for (const board of ['py_9', 'py_9_big_enter', 'py_9_double_input', 'big_9']) {
      const layout = IniDocument.parse(template.getText(`light/skin/${orientation}/${board}.ini`))
      for (const [action, label] of [['F40', '重输'], ['F6', '123'], ['0', '0']]) {
        const key = layout.sections().find((section) => layout.get(section, 'CENTER') === action)
        if (!key) continue // Big-enter boards have no separate clear key.
        const id = layout.get(key, 'FORE_STYLE')
        assert.equal(css.get(`STYLE${id}`, 'SHOW'), label, `${orientation}/${board} ${action}`)
      }
      const space = layout.sections().find((section) => layout.get(section, 'CENTER') === 'F38')
      const style = `STYLE${layout.get(space, 'FORE_STYLE')}`
      for (const state of ['NM_IMG', 'HL_IMG']) {
        const image = css.get(style, state)?.split(',')[0]
        assert.ok(image && template.getBytes(`light/skin/res/${image}.png`), `${orientation}/${board} space ${state}`)
      }
      const switchKey = layout.sections().find((section) => layout.get(section, 'CENTER') === 'F16')
      const switchLabels = layout.get(switchKey, 'FORE_STYLE').split(',').map((id) => css.get(`STYLE${id}`, 'SHOW'))
      assert.deepEqual(switchLabels, ['中', '/英'], 'a composite child must not replace the switch key’s own labels')
    }
  }
})

test('SSF default space icon uses its state colours independently of label colours on export', () => {
  const files = new Map(Object.entries(unzipSync(ssfFixture({ single: true }))))
  const skin = read(files, '1080/phoneSkin.ini')
  skin.remove('Key_Space', 'ICON')
  skin.appendSection('General', [{ key: 'SPACE_ICON_COLOR', value: '0xFF627285,0xFFFFFFFF' }])
  skin.appendSection('TextStyle_Space_Label', [{ key: 'TEXT_COLOR', value: '0xFF123456' }])
  files.set('1080/phoneSkin.ini', strToU8(skin.toString()))
  const pkg = SsfPackage.fromFiles(files)
  const look = new SsfLook(pkg, 'light', []).key('py_9.ini', 'F38', false)
  assert.equal(look.label.normal, 'FF123456')
  assert.deepEqual(look.icon, { normal: 'FF627285', pressed: 'FFFFFFFF' })
  const { files: output } = ssfToBaiduFiles(pkg, template, 1080)
  const css = read(output, 'light/skin/res/default.css')
  for (const orientation of ['port', 'land']) for (const board of ['py_9', 'py_26']) {
    const layout = read(output, `light/skin/${orientation}/${board}.ini`)
    const space = layout.sections().find((section) => layout.get(section, 'CENTER') === 'F38')
    const style = `STYLE${layout.get(space, 'FORE_STYLE')}`
    for (const [state, rgb] of [['NM_IMG', [98, 114, 133]], ['HL_IMG', [255, 255, 255]]]) {
      const image = decodePng(output.get(`light/skin/res/${css.get(style, state).split(',')[0]}.png`))
      let visible = 0
      for (let at = 0; at < image.data.length; at += 4) if (image.data[at + 3]) {
        assert.deepEqual([...image.data.subarray(at, at + 3)], rgb)
        visible++
      }
      assert.ok(visible > 0, `${orientation}/${board} ${state} has visible ink`)
    }
  }
  const bdaTemplate = SkinArchive.open(new Uint8Array(readFileSync(new URL('../public/default-template.bda', import.meta.url))), 'bda')
  const { archive } = convertSsfToBda(pkg, bdaTemplate)
  for (const orientation of ['port', 'land']) {
    const appearance = decodeBdaAppearance(archive.getBytes(`light/skin/${orientation}/appearanceConfig`))
    const key = appearance.panels.get('py_9').keys.get('KEY_F38')
    const style = appearance.imageStyles.get(key.foreStyles[0].key)
    for (const [state, rgb] of [['normalImage', [98, 114, 133]], ['highlightImage', [255, 255, 255]]]) {
      const image = decodePng(archive.getBytes(`light/skin/res/${style[state].resource.resourceID}.png`))
      const ink = image.data.findIndex((value, index) => index % 4 === 3 && value > 0) - 3
      assert.ok(ink >= 0, `BDA ${orientation} ${state} has visible ink`)
      assert.deepEqual([...image.data.subarray(ink, ink + 3)], rgb)
    }
  }
})
