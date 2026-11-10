import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { SkinArchive } from '../src/skin.ts'
import { IniDocument } from '../src/ini.ts'
import { parseXmlPlist } from '../src/palm/palm-plist.ts'
import { decodeBdaAppearance } from '../src/bda-decode.ts'
import { strFromU8 } from 'fflate'
import { convertSsfDocument, documentPackage, ssfDocumentBytes } from '../src/ssf/ssf-convert.ts'
import { ssfToBaiduFiles } from '../src/ssf/ssf-to-baidu.ts'
import { decodePng, cropImage, encodePng, resizeImage } from '../src/ssf/ssf-png.ts'
import { toolbarImageRect } from '../src/preview-draw.ts'
import { ssfFixture, solid } from './helpers/ssf-fixture.mjs'

const read = (path) => new Uint8Array(readFileSync(new URL(path, import.meta.url)))
const templates = {
  sogou: SkinArchive.open(read('../public/sogou-template.bds')),
  bda: SkinArchive.open(read('../public/default-template.bda'), 'bda'),
}

test('SSF → BDI packages native iOS toolbar plists, exact normal/pressed artwork and an F14 container', async () => {
  const original = await ssfDocumentBytes(ssfFixture())
  const source = SkinArchive.open(original, 'ssf')
  // The SSF look on the skeleton (its seven toolbar ICONs) is the reference for the artwork the export moves.
  const canvas = ssfToBaiduFiles(documentPackage(source), templates.sogou, Number(documentPackage(source).resolution)).files
  const canvasText = (path) => strFromU8(canvas.get(path))
  const converted = await convertSsfDocument(source, 'bdi', templates)
  const bdi = SkinArchive.open(converted.bytes, 'bdi')
  assert.ok(converted.warnings.some((text) => text.includes('AI侃侃')))
  for (const theme of ['light', 'dark']) {
    const prefix = `${theme}/skin/`
    const menuPath = `${prefix}res/logo/com.baidu.inputmethod.toolbarMenuItems.plist`
    const items = parseXmlPlist(bdi.getBytes(menuPath))
    assert.deepEqual(items.map(({ Name }) => Name), ['19', '17', '23', '26', '45'])
    assert.ok(items.every(({ Position }) => Position === 'toolbar'))
    assert.equal(bdi.getText(menuPath), bdi.getText(menuPath.replace('.plist', '.nijigen.plist')))
    const logo = parseXmlPlist(bdi.getBytes(`${prefix}res/logo/customImageConfig.plist`))
    assert.equal(logo[0].Name, '0')
    const cand = IniDocument.parse(canvasText(`${prefix}port/cand1.cnd`))
    const css = IniDocument.parse(canvasText(`${prefix}res/default.css`))
    for (const [item, action] of [...items.map((item, index) => [item, ['F7', 'F13', 'F72', 'F82', 'F68'][index]]), [logo[0], 'F31']]) {
      const section = cand.sections().find((name) => cand.get(name, 'KEY') === action)
      for (const [state, field] of [['Normal', 'NM_IMG'], ['Highlight', 'HL_IMG']]) {
        const [resource, tile] = css.get(`STYLE${cand.get(section, 'FORE_STYLE')}`, field).split(',')
        const til = IniDocument.parse(canvasText(`${prefix}res/${resource}.til`))
        const rect = til.get(`IMG${tile}`, 'SOURCE_RECT').split(',').map(Number)
        const expected = cropImage(decodePng(canvas.get(`${prefix}res/${resource}.png`)), ...rect)
        // Every plist image name resolves to <name>_iphone@3x.png, the way native skins ship them.
        const name = item.Images.Normal[state]
        const actual = decodePng(bdi.getBytes(`${prefix}res/logo/${name}_iphone@3x.png`))
        assert.deepEqual(actual, expected, `${theme} ${action} ${state}`)
        assert.equal(item.Images.Theme[state], name)
      }
    }
    for (const orientation of ['port', 'land']) {
      const gen = IniDocument.parse(bdi.getText(`${prefix}${orientation}/gen.ini`))
      assert.equal(gen.get('LOGO', 'LAYOUT_NAME'), 'logo', `${theme}/${orientation}: load native logo resources`)
      const logoLayout = IniDocument.parse(bdi.getText(`${prefix}${orientation}/${gen.get('LOGO', 'LAYOUT_NAME')}.ini`))
      assert.equal(logoLayout.get('GLOBAL', 'VERSION'), '1')
      // ICON_NUM=1 counts an [ICON1]; the menu colours come from the candidate bar (V6 p160).
      const bdiCss = IniDocument.parse(bdi.getText(`${prefix}res/default.css`))
      assert.equal(logoLayout.get('PANEL', 'ICON_INDEX'), '1')
      assert.match(bdiCss.get(`STYLE${logoLayout.get('PANEL', 'BACK_STYLE')}`, 'NM_COLOR'), /^[0-9A-F]{6}$/)
      assert.equal(logoLayout.get('ICON1', 'TEXT_STYLE'), cand.get('CAND', 'FORE_STYLE'))
      const native = IniDocument.parse(bdi.getText(`${prefix}${orientation}/cand1.cnd`))
      assert.deepEqual([1, 2, 3, 4].map((id) => native.get(`ICON${id}`, 'KEY')), ['F31', 'F14', 'F8', 'F9'])
      assert.equal(native.get('CAND', 'ICON_NUM'), '4')
      assert.equal(native.get('ICON4', 'PERSIST'), '2')
      assert.deepEqual([1, 2, 3, 4].map((id) => native.get(`ICON${id}`, 'ANCHOR_TYPE')), ['1', '5', '3', '3'])
      assert.ok(Number(native.get('CAND', 'PADDING').split(',')[2]) > 0)
      for (const section of ['ICON1', 'ICON3', 'ICON4']) {
        const style = native.get(section, 'FORE_STYLE')
        const [resource, tile] = css.get(`STYLE${style}`, 'NM_IMG').split(',')
        const rect = IniDocument.parse(canvasText(`${prefix}res/${resource}.til`)).get(`IMG${tile}`, 'SOURCE_RECT').split(',').map(Number)
        // Points as whole numbers, like native skins (100 px artwork → FIX_SIZE=33,33).
        assert.equal(native.get(section, 'FIX_SIZE'), rect.slice(2).map((size) => Math.round(size / 3)).join(','))
      }
      for (const field of ['BACK_STYLE', 'FORE_STYLE']) {
        assert.equal(native.get('CAND', field), IniDocument.parse(canvasText(`${prefix}${orientation}/cand1.cnd`)).get('CAND', field))
      }
    }
  }
  assert.deepEqual(source.toBytes(), original)
})

test('SSF → BDI maps native cursor 18 and clipboard 35 from the source menu artwork, including theme and pressed fallback', async () => {
  const source = SkinArchive.open(await ssfDocumentBytes(ssfFixture()), 'ssf')
  for (const folder of ['status1', 'status2']) {
    source.setBytes(`1080/${folder}/ime_function_textedit.png`, source.getBytes(`1080/${folder}/902.png`))
    source.setBytes(`1080/${folder}/ime_function_textedit_p.png`, source.getBytes(`1080/${folder}/26q_x.png`))
    source.setBytes(`1080/${folder}/ime_function_clipboard.png`, source.getBytes(`1080/${folder}/delf_26.png`))
  }
  const bdi = SkinArchive.open((await convertSsfDocument(source, 'bdi', templates)).bytes, 'bdi')
  for (const [theme, folder] of [['light', 'status1'], ['dark', 'status2']]) {
    const prefix = `${theme}/skin/res/logo/`
    const items = parseXmlPlist(bdi.getBytes(`${prefix}com.baidu.inputmethod.toolbarMenuItems.plist`))
    for (const [id, file, position] of [['18', 'ime_function_textedit', 'toolbar'], ['35', 'ime_function_clipboard', 'menu']]) {
      const item = items.find(({ Name }) => Name === id)
      assert.equal(item.Position, position)
      for (const state of ['Normal', 'Highlight']) {
        const original = source.getBytes(`1080/${folder}/${file}${state === 'Highlight' ? '_p' : ''}.png`) ?? source.getBytes(`1080/${folder}/${file}.png`)
        assert.deepEqual(bdi.getBytes(`${prefix}${item.Images.Normal[state]}_iphone@3x.png`), original)
      }
    }
  }
})

test('SSF → BDS gives Android the native F14 toolbar and the Sogou icons in the logo menu atlas', async () => {
  const source = SkinArchive.open(await ssfDocumentBytes(ssfFixture()), 'ssf')
  for (const folder of ['status1', 'status2']) {
    source.setBytes(`1080/${folder}/ime_function_textedit.png`, source.getBytes(`1080/${folder}/902.png`))
    source.setBytes(`1080/${folder}/ime_function_clipboard.png`, source.getBytes(`1080/${folder}/delf_26.png`))
  }
  const canvas = ssfToBaiduFiles(documentPackage(source), templates.sogou, Number(documentPackage(source).resolution)).files
  const canvasText = (path) => strFromU8(canvas.get(path))
  const converted = await convertSsfDocument(source, 'bds', templates)
  const bds = SkinArchive.open(converted.bytes, 'bds')
  assert.ok(converted.warnings.some((text) => text.startsWith('Android 工具栏')))
  for (const [theme, folder] of [['light', 'status1'], ['dark', 'status2']]) {
    const prefix = `${theme}/skin/`
    for (const orientation of ['port', 'land']) {
      const cand = IniDocument.parse(bds.getText(`${prefix}${orientation}/cand1.cnd`))
      assert.deepEqual([1, 2, 3, 4].map((id) => cand.get(`ICON${id}`, 'KEY')), ['F31', 'F14', 'F8', 'F9'])
      assert.ok(!cand.entries().some(({ key }) => key === 'FIX_SIZE'), 'FIX_SIZE is iOS only')
      assert.equal(bds.getText(`${prefix}${orientation}/res/default.css`), bds.getText(`${prefix}res/default.css`), 'Android direction-local styles include the final toolbar styles')
      // LogoLoader reads [GLOBAL] VERSION; only 1 loads the skin's pop_menu_icons.
      assert.equal(IniDocument.parse(bds.getText(`${prefix}${orientation}/logo.ini`)).get('GLOBAL', 'VERSION'), '1')
    }
    assert.deepEqual(bds.names().filter((path) => path.startsWith(`${prefix}res/logo/`) && !path.endsWith('/')).sort(), [`${prefix}res/logo/pop_menu_icons.png`, `${prefix}res/logo/pop_menu_icons.til`])
    const til = IniDocument.parse(bds.getText(`${prefix}res/logo/pop_menu_icons.til`))
    const atlas = decodePng(bds.getBytes(`${prefix}res/logo/pop_menu_icons.png`))
    // MenuFunction bitmap indexes of Baidu 13.3.18.31; LogoIconSource reads IMG<n> only for n < TILE_NUM.
    assert.equal(til.get('GLOBAL', 'TILE_NUM'), '68')
    const slice = (index) => cropImage(atlas, ...til.get(`IMG${index}`, 'SOURCE_RECT').split(',').map(Number))
    const enlarged = (image) => resizeImage(image, Math.ceil(image.width / 0.82), Math.ceil(image.height / 0.82))
    const reference = IniDocument.parse(canvasText(`${prefix}port/cand1.cnd`))
    const css = IniDocument.parse(canvasText(`${prefix}res/default.css`))
    for (const [action, index] of [['F7', 26], ['F13', 27], ['F72', 29], ['F82', 31], ['F8', 67]]) {
      const section = reference.sections().find((name) => reference.get(name, 'KEY') === action)
      const [resource, tile] = css.get(`STYLE${reference.get(section, 'FORE_STYLE')}`, 'NM_IMG').split(',')
      const rect = IniDocument.parse(canvasText(`${prefix}res/${resource}.til`)).get(`IMG${tile}`, 'SOURCE_RECT').split(',').map(Number)
      const original = cropImage(decodePng(canvas.get(`${prefix}res/${resource}.png`)), ...rect)
      assert.deepEqual(slice(index), index === 67 ? original : enlarged(original), `${theme} ${action} → IMG${index}`)
    }
    for (const [file, index] of [['ime_function_textedit', 25], ['ime_function_clipboard', 50]]) {
      assert.deepEqual(slice(index), enlarged(decodePng(source.getBytes(`1080/${folder}/${file}.png`))), `${theme} ${file} → IMG${index}`)
    }
  }
})

test('SSF → BDS keeps middle toolbar icons at the SSF size after Android native scaling', async () => {
  const source = SkinArchive.open(await ssfDocumentBytes(ssfFixture()), 'ssf')
  const icons = [
    ['ime_function_expression', 26, 78, 78], ['ime_function_switch', 27, 61, 43],
    ['ime_function_voice', 29, 37, 55], ['ime_function_sousou', 31, 1, 1],
    ['ime_function_textedit', 25, 72, 48], ['ime_function_clipboard', 50, 88, 88],
  ]
  for (const folder of ['status1', 'status2']) for (const [name, , width, height] of icons) {
    source.setBytes(`1080/${folder}/${name}.png`, encodePng(solid(width, height, [90, 120, 150])))
  }
  const bds = SkinArchive.open((await convertSsfDocument(source, 'bds', templates)).bytes, 'bds')
  for (const theme of ['light', 'dark']) {
    const til = IniDocument.parse(bds.getText(`${theme}/skin/res/logo/pop_menu_icons.til`))
    for (const [name, index, width, height] of icons) {
      const source = til.get(`IMG${index}`, 'SOURCE_RECT').split(',').map(Number)
      const rect = toolbarImageRect({ source, imagePath: `${theme}/skin/res/logo/pop_menu_icons.png` },
        { x: 0, y: 0, width: 128, height: 126 }, 1080)
      assert.deepEqual([rect.width, rect.height], [width, height], `${theme} ${name}: source dimensions survive native scaling`)
      assert.equal(rect.x, (128 - width) / 2)
      assert.equal(rect.y, (126 - height) / 2)
    }
  }
})

test('SSF → BDA puts the toolbar art into the candidate keys Android reads by name', async () => {
  const source = SkinArchive.open(await ssfDocumentBytes(ssfFixture()), 'ssf')
  const files = { 'logo.png': '902.png', 'close.png': 'delf_26.png', 'ime_function_expression.png': '26q_x.png', 'ime_function_switch.png': '902.png', 'ime_function_voice.png': 'delf_26.png', 'ime_function_sousou.png': '26q_x.png', 'ime_function_textedit.png': '902.png', 'ime_function_clipboard.png': 'delf_26.png' }
  for (const folder of ['status1', 'status2']) for (const [name, from] of Object.entries(files)) source.setBytes(`1080/${folder}/${name}`, source.getBytes(`1080/${folder}/${from}`))
  const bda = SkinArchive.open((await convertSsfDocument(source, 'bda', templates)).bytes, 'bda')
  const path = 'light/skin/port/appearanceConfig'
  const appearance = decodeBdaAppearance(bda.getBytes(path))
  // Compare size and a digest: a deepEqual diff of two decoded images is too large to print.
  const digest = ({ width, height, data }) => `${width}x${height}:${createHash('sha256').update(data).digest('hex')}`
  const pixels = (ref) => {
    const id = appearance.imageStyles.get(ref.key).normalImage.resource.resourceID
    // Resource ids are numbered per theme, so look the image up next to this appearance.
    return digest(decodePng(bda.getBytes(`${path.replace(/port\/appearanceConfig$/, '')}res/${id}.png`)))
  }
  const fromSource = (name) => digest(decodePng(source.getBytes(`1080/status1/${name}`)))
  const cand = appearance.panels.get('py_9').cand
  for (const [key, file] of [['CAND_F31', 'logo.png'], ['CAND_F8', 'close.png']]) {
    assert.equal(pixels(cand.candKeys.get(key).foreStyles[0]), fromSource(file), key)
  }
  // CandIconFunction names for MenuFunction EMOJI, INPUT_MANAGER, VOICE, SEARCH, EDITOR, CLIPBOARD.
  for (const [key, file] of [['MENU_EMOJI', 'ime_function_expression.png'], ['MENU_MODE', 'ime_function_switch.png'], ['MENU_AUDIO', 'ime_function_voice.png'], ['MENU_SEARCH', 'ime_function_sousou.png'], ['MENU_MOVE', 'ime_function_textedit.png'], ['MENU_PASTE', 'ime_function_clipboard.png']]) {
    assert.equal(pixels(cand.menuKeys.get(key).foreStyles[0]), fromSource(file), key)
  }
})
