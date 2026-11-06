import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SkinArchive } from '../src/skin.ts'
import { IniDocument } from '../src/ini.ts'
import { convertSsfDocument, ssfDocumentBytes } from '../src/ssf/ssf-convert.ts'
import { decodePng, encodePng } from '../src/ssf/ssf-png.ts'
import { ssfFixture, solid } from './helpers/ssf-fixture.mjs'

const read = (path) => new Uint8Array(readFileSync(new URL(path, import.meta.url)))
const templates = {
  sogou: SkinArchive.open(read('../public/sogou-template.bds')),
  bda: SkinArchive.open(read('../public/default-template.bda'), 'bda'),
}

for (const format of ['bds', 'bdi']) {
  test(`SSF → ${format}: runtime symbol keys get text without overriding custom or transparent artwork`, async () => {
    const source = SkinArchive.open(await ssfDocumentBytes(ssfFixture()), 'ssf')
    for (const folder of ['status1', 'status2']) {
      const path = `1080/${folder}/phoneSkin.ini`
      const skin = IniDocument.parse(source.getText(path))
      const set = (section, key, value) => {
        if (!skin.sections().includes(section)) skin.appendSection(section, [])
        skin.set(section, key, value)
      }
      set('TextStyle_Qwerty', 'TEXT_COLOR', '0xFF123456')
      set('TextStyle_Qwerty', 'TEXT_COLOR_PRESSED', '0xFF654321')
      set('Key_UDSymbol1_Qwerty', 'LABEL', '、')
      set('Key_CommaEn_T', 'ICON', 'symbol-transparent.png')
      set('Key_PeriodEn_T', 'ICON', 'symbol-own.png')
      source.setText(path, skin.toString())
      source.setBytes(`1080/${folder}/symbol-transparent.png`, encodePng(solid(2, 2, [0, 0, 0], 0)))
      source.setBytes(`1080/${folder}/symbol-own.png`, encodePng(solid(2, 2, [10, 20, 30])))
    }
    const output = SkinArchive.open((await convertSsfDocument(source, format, templates)).bytes, format)
    for (const theme of ['light', 'dark']) for (const orientation of ['port', 'land']) {
      const prefix = `${theme}/skin/`
      const css = IniDocument.parse(output.getText(`${prefix}res/default.css`))
      const layout = IniDocument.parse(output.getText(`${prefix}${orientation}/py_26.ini`))
      for (const [action, label] of [['，', '、'], ['。', '。']]) {
        const section = layout.sections().find((name) => layout.get(name, 'CENTER') === action)
        const style = `STYLE${layout.get(section, 'FORE_STYLE')}`
        assert.equal(css.get(style, 'SHOW'), label, `${theme}/${orientation} ${action}`)
        assert.equal(css.get(style, 'NM_COLOR'), 'FF123456')
        assert.equal(css.get(style, 'HL_COLOR'), 'FF654321')
        assert.ok(Number(css.get(style, 'FONT_SIZE')) > 0)
        assert.equal(layout.get(section, 'CENTER'), action, 'display text does not change the action')
      }
      const english = IniDocument.parse(output.getText(`${prefix}${orientation}/en_26.ini`))
      for (const [action, visible] of [[',', false], ['.', true]]) {
        const section = english.sections().find((name) => english.get(name, 'CENTER') === action)
        const style = `STYLE${english.get(section, 'FORE_STYLE')}`
        assert.equal(css.get(style, 'SHOW'), undefined, 'explicit artwork wins over text fallback')
        const [resource] = css.get(style, 'NM_IMG').split(',')
        const image = decodePng(output.getBytes(`${prefix}res/${resource}.png`))
        assert.equal(image.data.some((value, index) => index % 4 === 3 && value > 0), visible)
      }
    }
  })
}
