import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { strToU8, zipSync } from 'fflate'
import { SkinArchive } from '../src/skin.ts'
import { IniDocument } from '../src/ini.ts'
import { conversionLayoutPaths, convertLayout, readConversionLayout } from '../src/layout-conversion.ts'
import { encodeSkinJson, parseSkinJson } from '../src/palm/sxi-json.ts'

const path = 'light/skin/port/py_26.ini'
const address = 'skin.json/default/port_layout/b/full26Pinyin'
function iniArchive(layout, extra = {}) {
  const files = {
    'light/port/gen.ini': '[PANEL]\nSIZE=100,100\n',
    'light/port/py_26.ini': layout,
    'light/res/default.css': '[STYLE7]\nNM_COLOR=FF000000\n',
    ...extra,
  }
  return SkinArchive.open(zipSync(Object.fromEntries(Object.entries(files).map(([name, value]) => [name, strToU8(value)]))))
}
const sourceText = '[PANEL]\nKEY_NUM=2\nCUSTOM=keep\n[TIP1]\nCENTER=old-state\n[OFFSET1]\nPOS=1,2\n[KEY1]\nCENTER=q\nUP=source-up\nBACK_STYLE=7\nFORE_STYLE=71\nSOUND_STYLE=5\nVIEW_RECT=0,0,40,50\n[KEY2]\nCENTER=w\nBACK_STYLE=7\nFORE_STYLE=72\nVIEW_RECT=50,0,40,50\n'
const templateText = '[PANEL]\nSIZE=200,100\nKEY_NUM=3\n[KEY1]\nCENTER=w\nBACK_STYLE=999\nFORE_STYLE=999\nVIEW_RECT=100,20,50,30\nTOUCH_RECT=98,18,54,34\n[KEY2]\nCENTER=q\nUP=template-up\nVIEW_RECT=0,20,50,30\n[KEY3]\nCENTER=e\nVIEW_RECT=50,60,50,30\n'
const siblingText = '[PANEL]\nKEY_NUM=1\n[OFFSET1]\nPOS=30,40\n[TIP1]\nCENTER=E\nFORE_STYLE=84\nPOS_TYPE=1\n[KEY1]\nCENTER=e\nFORE_STYLE=73\nPOS_TYPE=1\nSTAT_STYLE=S1_1\nVIEW_RECT=0,0,40,50\n'

test('BDS/BDI use template geometry and count, preserve native key appearance/gestures and remap sibling dependencies', async () => {
  const source = iniArchive(sourceText.replace('CENTER=q', 'CENTER=q\nSTAT_STYLE=S3_3'), { 'light/port/en_26.ini': siblingText })
  const template = SkinArchive.open(await iniArchive(templateText).platformBytesAsync('bdi'), 'bdi')
  const before = new Map(source.names().map(name => [name, source.getBytes(name)]))
  const change = convertLayout(source, path, template, path)
  assert.equal(change.path, path)
  const result = IniDocument.parse(change.after)
  assert.equal(result.get('PANEL', 'KEY_NUM'), '3')
  assert.equal(result.get('PANEL', 'CUSTOM'), 'keep')
  assert.equal(result.get('KEY1', 'CENTER'), 'w')
  assert.equal(result.get('KEY1', 'VIEW_RECT'), '50,20,25,30')
  assert.equal(result.get('KEY1', 'TOUCH_RECT'), '49,18,27,34')
  assert.equal(result.get('KEY1', 'FORE_STYLE'), '72')
  assert.equal(result.get('KEY2', 'FORE_STYLE'), '71')
  assert.equal(result.get('KEY2', 'UP'), 'source-up')
  assert.equal(result.get('KEY2', 'SOUND_STYLE'), '5')
  assert.equal(result.hasSection('TIP3'), false, 'an intentionally missing state replacement must stay missing')
  assert.equal(result.get('KEY3', 'FORE_STYLE'), '73')
  assert.equal(result.get('OFFSET' + result.get('KEY3', 'POS_TYPE'), 'POS'), '30,40')
  const tip = result.get('KEY3', 'STAT_STYLE').split('_')[1]
  assert.notEqual(tip, '1')
  assert.equal(result.get('TIP' + tip, 'CENTER'), 'E')
  assert.equal(result.get('OFFSET' + result.get('TIP' + tip, 'POS_TYPE'), 'POS'), '30,40')
  assert.equal(result.get('TIP1', 'CENTER'), 'old-state')
  for (const [name, bytes] of before) assert.deepEqual(source.getBytes(name), bytes, name)
  assert.equal(source.changed.size, 0)
  assert.equal(template.changed.size, 0)
  // BDI is edited through the same canonical layout, without converting the skin.
  const bdi = SkinArchive.open(await source.platformBytesAsync('bdi'), 'bdi')
  assert.equal(IniDocument.parse(convertLayout(bdi, path, template, path).after).get('KEY3', 'CENTER'), 'e')
})

function sxiArchive() {
  const skin = {
    default: {
      port_layout: {
        b: {
          defaultGlobal: { board: { size: [100, 100], b: { base_b: 1 } }, offset: { 1: { p: [1, 2] } } },
          full26Pinyin: { extra: 'keep', keys: [
            { id: '1', rect: [[0, 0], [40, 50]], b: { base_b: 7, base_f: [71], base_s: 5 }, values: [0, 'source-up', 4, 'q'], fix_a: [3, 3] },
            { id: '2', rect: [[50, 0], [40, 50]], b: { base_b: 7, base_f: [72] }, values: [4, 'w'] },
          ], key_fix: { 1: { v: [4, 'old-state'] } } },
          full26English: { offset: { 1: { p: [30, 40] } }, key_fix: { 1: { b: { base_f: [84], base_o: [1] }, v: [4, 'E'] } }, keys: [
            { id: '5', rect: [[0, 0], [40, 50]], b: { base_f: [73], base_o: [1], base_ba: 4 }, fix_a: [1, 1], values: [4, 'e'], extra: true },
            { id: '6', b: {}, values: [] },
          ] },
        }, c: { cand1: { extra: 'candidate stays' } },
      }, s_info: { ss_1: { 7: { f: 1 } }, ss_2: { 4: { anim: [] } } },
    }, night: { keep: true },
  }
  return SkinArchive.open(zipSync({ 'skin.json': strToU8(encodeSkinJson(skin)) }), 'sxi')
}

test('SXI edits only the chosen native board, importing source offsets and key_fix without foreign style ids', () => {
  const source = sxiArchive()
  const before = parseSkinJson(source.getText('skin.json'))
  const change = convertLayout(source, address, iniArchive(templateText), path)
  assert.equal(change.path, 'skin.json')
  const result = parseSkinJson(change.after)
  const board = result.default.port_layout.b.full26Pinyin
  assert.equal(board.keys.length, 3)
  assert.deepEqual(board.keys[0].rect, [[50, 20], [25, 30]])
  assert.deepEqual(board.keys[0].hit_rect, [[49, 18], [27, 34]])
  assert.deepEqual(board.keys[0].b, { base_b: 7, base_f: [72] })
  assert.deepEqual(board.keys[1].values, [0, 'source-up', 4, 'q'])
  const key = board.keys[2]
  assert.equal(key.extra, true)
  assert.equal(key.b.base_ba, 4)
  assert.deepEqual(board.offset[key.b.base_o[0]].p, [30, 40])
  assert.notEqual(key.fix_a[1], 1)
  assert.equal(board.key_fix[3], undefined, 'new fixes must not satisfy an old missing reference')
  const fix = board.key_fix[key.fix_a[1]]
  assert.deepEqual(fix.v, [4, 'E'])
  assert.deepEqual(board.offset[fix.b.base_o[0]].p, [30, 40])
  result.default.port_layout.b.full26Pinyin = before.default.port_layout.b.full26Pinyin
  assert.deepEqual(result, before, 'other boards, defaults, candidates, shared resources and themes stay intact')
  assert.equal(source.changed.size, 0)
})

test('SXI templates can lay out BDS keys; native gestures and foregrounds still come from the open skin', () => {
  const source = iniArchive(sourceText)
  const change = convertLayout(source, path, sxiArchive(), address)
  const result = IniDocument.parse(change.after)
  assert.equal(result.get('KEY1', 'FORE_STYLE'), '71')
  assert.equal(result.get('KEY1', 'UP'), 'source-up')
  assert.equal(result.get('KEY1', 'VIEW_RECT'), '0,0,40,50')
})

test('self-contained templates do not need gen.ini', () => {
  const template = SkinArchive.open(zipSync({ 'light/port/py_26.ini': strToU8(templateText) }))
  const source = iniArchive(sourceText, { 'light/port/en_26.ini': siblingText })
  assert.equal(IniDocument.parse(convertLayout(source, path, template, path).after).get('PANEL', 'KEY_NUM'), '3')
})

test('malformed geometry and unsupported formats fail before changing any file', () => {
  const source = iniArchive(sourceText)
  assert.throws(() => readConversionLayout(iniArchive(templateText.replace('100,20,50,30', 'NaN,20,50,30')), path), /坐标无效/)
  assert.throws(() => readConversionLayout(iniArchive(templateText.replace('200,100', '-1,100')), path), /尺寸无效/)
  assert.throws(() => readConversionLayout(source, 'light/skin/port/gen.ini'), /包含按键/)
  const ssf = SkinArchive.open(zipSync({ 'phoneTheme.ini': strToU8('[General]\n') }), 'ssf')
  assert.deepEqual(conversionLayoutPaths(ssf), [])
  assert.throws(() => convertLayout(ssf, path, source, path), /不支持/)
  assert.equal(source.changed.size, 0)
})

test('template choices merge theme and orientation variants and follow the current orientation', () => {
  const source = iniArchive(sourceText, {
    'dark/port/py_26.ini': sourceText,
    'light/land/py_26.ini': sourceText,
    'dark/land/py_26.ini': sourceText,
    'light/port/en_26.ini': sourceText,
  })
  assert.deepEqual(conversionLayoutPaths(source), [path, 'light/skin/port/en_26.ini'])
  assert.deepEqual(conversionLayoutPaths(source, 'dark/skin/land/py_9.ini'), ['light/skin/land/py_26.ini', 'light/skin/port/en_26.ini'])
  const palm = sxiArchive()
  const json = parseSkinJson(palm.getText('skin.json'))
  json.night.port_layout = structuredClone(json.default.port_layout)
  json.default.land_layout = structuredClone(json.default.port_layout)
  palm.setText('skin.json', encodeSkinJson(json))
  assert.deepEqual(conversionLayoutPaths(palm, 'skin.json/night/land_layout/b/t9Pinyin').sort(), [
    'skin.json/default/land_layout/b/full26Pinyin', 'skin.json/default/land_layout/b/full26English',
  ].sort())
})

test('missing buttons and foregrounds use local backgrounds and readable text without importing template appearance', async () => {
  const template = iniArchive(templateText.replace('CENTER=e', 'CENTER=F11\nSHOW=⇧\nHOLD=F10'))
  const bds = iniArchive(sourceText.replace('UP=source-up', 'UP=source-up\nSTAT_STYLE=S67_1'))
  for (const source of [bds, SkinArchive.open(await bds.platformBytesAsync('bdi'), 'bdi')]) {
    const change = convertLayout(source, path, template, path)
    const result = IniDocument.parse(change.after)
    const styles = IniDocument.parse(change.styles.after)
    assert.equal(result.get('KEY3', 'CENTER'), 'F11')
    assert.equal(result.get('KEY3', 'HOLD'), 'F10')
    assert.equal(result.get('KEY3', 'UP'), undefined, 'unrelated donor actions are not copied')
    assert.equal(result.get('KEY3', 'STAT_STYLE'), undefined, 'donor state cannot restore a different action or glyph')
    assert.equal(result.get('KEY3', 'BACK_STYLE'), '7')
    assert.equal(styles.get('STYLE' + result.get('KEY3', 'FORE_STYLE'), 'SHOW'), '⇧')
    assert.equal(styles.get('STYLE7', 'NM_COLOR'), 'FF000000', 'existing styles stay intact')
    assert.equal(result.toString().includes('999'), false)
    assert.equal(source.changed.size, 0, 'planning does not write files')
  }
  const source = sxiArchive()
  const before = parseSkinJson(source.getText('skin.json'))
  const change = convertLayout(source, address, template, path)
  const result = parseSkinJson(change.after)
  const key = result.default.port_layout.b.full26Pinyin.keys[2]
  assert.deepEqual(key.values, [4, 'capslock', 5, '⇧', 6, 'shift'])
  assert.equal(key.b.base_b, 7)
  assert.equal(key.fix_a, undefined)
  assert.equal(result.default.s_info.ss_1[key.b.base_f[0]].s_1.text, '⇧')
  assert.deepEqual(result.night, before.night)
  assert.deepEqual(result.default.port_layout.b.full26English, before.default.port_layout.b.full26English)
  assert.deepEqual(result.default.s_info.ss_1[7], before.default.s_info.ss_1[7])

  const grouped = iniArchive('[PANEL]\nSIZE=100,100\n[KEY1]\nCENTER=e\nCONVERSION_LETTERS=ew\nVIEW_RECT=0,0,80,50\n')
  const letters = iniArchive(sourceText.replace('FORE_STYLE=72\n', ''))
  const composed = convertLayout(letters, path, grouped, path)
  const layout = IniDocument.parse(composed.after)
  const css = IniDocument.parse(composed.styles.after)
  assert.equal(layout.get('KEY1', 'CENTER'), 'e')
  assert.equal(layout.get('KEY1', 'RIGHT'), 'w')
  assert.deepEqual(layout.get('KEY1', 'FORE_STYLE').split(',').map(id => css.get('STYLE' + id, 'SHOW')), ['e', 'w'])
})

test('missing symbol lists are built from template content with local typography', () => {
  const template = iniArchive(templateText + '[LIST]\nLIST_NUM=2\nPOS=0,0\nCELL_SIZE=10,10\nNAMES=! ?\nVALUES=! ?\nFORE_STYLE=99999\n')
  const change = convertLayout(iniArchive(sourceText), path, template, path)
  const result = IniDocument.parse(change.after)
  assert.equal(result.get('LIST', 'NAMES'), '! ?')
  assert.equal(result.get('LIST', 'VALUES'), '! ?')
  assert.notEqual(result.get('LIST', 'FORE_STYLE'), '99999')
  const palm = parseSkinJson(convertLayout(sxiArchive(), address, template, path).after)
  const list = palm.default.port_layout.b.full26Pinyin.list
  assert.deepEqual(list.titles, ['!', '?'])
  assert.deepEqual(list.values, ['!', '?'])
  assert.equal(palm.default.s_info.ss_1[list.b.base_f[0]].s_1.text, undefined, 'list style must allow each cell label to render')
})

test('T9 groups never supply single-letter artwork, even when their center actions match', () => {
  const cluster = '[PANEL]\nSIZE=100,100\n[KEY1]\nCENTER=e\nLEFT=d\nRIGHT=f\nUP=3\nSHOW=3\nBACK_STYLE=7\nFORE_STYLE=99\nVIEW_RECT=0,0,80,50\n'
  const single = '[PANEL]\nSIZE=100,100\n[KEY1]\nCENTER=e\nFORE_STYLE=73\nVIEW_RECT=0,0,40,50\n'
  const source = iniArchive(cluster, { 'light/port/en_26.ini': single })
  assert.equal(IniDocument.parse(convertLayout(source, path, iniArchive(single), path).after).get('KEY1', 'FORE_STYLE'), '73')
  const missing = convertLayout(iniArchive(cluster), path, iniArchive(single), path)
  const result = IniDocument.parse(missing.after)
  assert.equal(IniDocument.parse(missing.styles.after).get('STYLE' + result.get('KEY1', 'FORE_STYLE'), 'SHOW'), 'e')
  assert.equal(result.get('KEY1', 'LEFT'), undefined)
  const grouped = convertLayout(iniArchive(single), path, iniArchive(cluster), path)
  const output = IniDocument.parse(grouped.after)
  assert.equal(IniDocument.parse(grouped.styles.after).get('STYLE' + output.get('KEY1', 'FORE_STYLE'), 'SHOW'), 'DEF')
})

test('shipped BDS/SXI templates support switching 26-key and 9-key arrangements, including symbol lists and Palm placeholders', () => {
  for (const name of ['default-template.bds', 'templates/palm-harmony.sxi']) {
    const archive = SkinArchive.open(readFileSync(new URL('../public/' + name, import.meta.url)))
    const source = archive.format === 'sxi' ? address : path
    const template = source.replace('full26Pinyin', 't9Pinyin').replace('py_26', 'py_9')
    const expected = readConversionLayout(archive, template)
    const change = convertLayout(archive, source, archive, template)
    archive.setText(change.path, change.after)
    const result = readConversionLayout(archive, source)
    assert.equal(result.keys.length, expected.keys.length)
    assert.equal(result.list.count, expected.list.count)
    assert.equal(result.keys[0].actions.CENTER, expected.keys[0].actions.CENTER)
  }
})

test('built-in 18-key template has 18 letter keys and 8 function keys, composes original foregrounds and keeps both letters reachable', async () => {
  const template = SkinArchive.open(readFileSync(new URL('../public/layout-templates/pinyin18.bds', import.meta.url)))
  const templatePath = 'light/skin/port/py_18.ini'
  const definition = readConversionLayout(template, templatePath)
  assert.equal(definition.keys.filter(key => /^[a-z]$/.test(key.actions.CENTER)).length, 18)
  assert.equal(definition.keys.length, 26)
  assert.equal(definition.keys.filter(key => key.letters).length, 8)
  assert.deepEqual(definition.size, [1125, 592])
  assert.ok(template.names().every(name => name.endsWith('.ini')), 'only geometry and actions, no skin artwork')
  const bds = SkinArchive.open(readFileSync(new URL('../public/default-template.bds', import.meta.url)))
  const bdi = SkinArchive.open(await bds.platformBytesAsync('bdi'), 'bdi')
  const sxi = SkinArchive.open(readFileSync(new URL('../public/templates/palm-harmony.sxi', import.meta.url)))
  for (const archive of [bds, bdi, sxi]) {
    const selected = archive.format === 'sxi' ? address : path
    const before = new Map(archive.names().map(name => [name, archive.getBytes(name)]))
    const change = convertLayout(archive, selected, template, templatePath)
    if (archive.format === 'sxi') {
      const board = parseSkinJson(change.after).default.port_layout.b.full26Pinyin
      const we = board.keys[1]
      assert.deepEqual(we.b.base_f, [98, 100], 'W/E text styles, without numeric swipe hints')
      assert.ok(we.values.some((value, index) => index % 2 && value === 'w' && we.values[index - 1] === 2))
      assert.ok(we.values.some((value, index) => index % 2 && value === 'e' && we.values[index - 1] === 4))
      assert.equal(we.fix_a, undefined, 'single-letter state overrides cannot replace a composed label')
    } else {
      const doc = IniDocument.parse(change.after)
      assert.equal(doc.get('KEY2', 'FORE_STYLE'), '2,3')
      assert.equal(doc.get('KEY2', 'CENTER'), 'e')
      assert.equal(doc.get('KEY2', 'LEFT'), 'w')
      assert.equal(doc.get('KEY2', 'SHOW'), 'WE')
      assert.equal(doc.get('PANEL', 'KEY_NUM'), '26')
    }
    for (const [name, bytes] of before) assert.deepEqual(archive.getBytes(name), bytes, 'planning leaves skin intact')
    archive.setText(change.path, change.after)
    const converted = readConversionLayout(archive, selected)
    assert.equal(converted.keys.length, 26)
    const repeat = convertLayout(archive, selected, template, templatePath)
    if (archive.format === 'sxi') assert.deepEqual(parseSkinJson(repeat.after).default.port_layout.b.full26Pinyin.keys[1].b.base_f, [98, 100])
    else assert.equal(IniDocument.parse(repeat.after).get('KEY2', 'FORE_STYLE'), '2,3')
  }
})

test('composed letters use the visible initial-state foreground, keeping source state tables intact', () => {
  const grouped = iniArchive('[PANEL]\nSIZE=100,100\n[KEY1]\nCENTER=w\nCONVERSION_LETTERS=qw\nVIEW_RECT=0,0,80,50\n')
  const source = iniArchive(sourceText.replace('[KEY2]', '[TIP9]\nFORE_STYLE=99\n[KEY2]\nSTAT_STYLE=S67_9'))
  const doc = IniDocument.parse(convertLayout(source, path, grouped, path).after)
  assert.equal(doc.get('KEY1', 'FORE_STYLE'), '71,99')
  assert.equal(doc.get('TIP9', 'FORE_STYLE'), '99')
  source.setText(path, doc.toString())
  const split = IniDocument.parse(convertLayout(source, path, iniArchive(sourceText), path).after)
  assert.equal(split.get('KEY1', 'CENTER'), 'q')
  assert.equal(split.get('KEY1', 'FORE_STYLE'), '71')
  assert.equal(split.get('KEY2', 'CENTER'), 'w')
  assert.equal(split.get('KEY2', 'FORE_STYLE'), '99')
  const palm = sxiArchive()
  const skin = parseSkinJson(palm.getText('skin.json'))
  skin.default.port_layout.b.full26Pinyin.keys[1].fix_a = [67, 4]
  skin.default.port_layout.b.full26Pinyin.key_fix[4] = { b: { base_f: [777] } }
  palm.setText('skin.json', encodeSkinJson(skin))
  const change = convertLayout(palm, address, grouped, path)
  const result = parseSkinJson(change.after)
  assert.deepEqual(result.default.port_layout.b.full26Pinyin.keys[0].b.base_f, [71, 777])
  assert.deepEqual(result.default.port_layout.b.full26Pinyin.key_fix[4], { b: { base_f: [777] } })
  palm.setText('skin.json', change.after)
  const separated = parseSkinJson(convertLayout(palm, address, iniArchive(sourceText), path).after).default.port_layout.b.full26Pinyin.keys
  assert.deepEqual(separated.map(key => key.b.base_f), [[71], [777]])
  assert.ok(separated[0].values.includes('q'))
  assert.ok(separated[1].values.includes('w'))
})
