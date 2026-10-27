import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addSxiImageStyle, applySxiViewEdit, setSxiForeground, setSxiStyleImage, sxiSectionRanges, sxiStylePointer } from '../src/palm/sxi-edit.ts'
import { IniDocument } from '../src/ini.ts'
import { ACTION_CODES } from '../src/palm/palm-ini.ts'
import { encodeSkinJson, parseSkinJson, sxiDerivedFiles } from '../src/palm/sxi-projection.ts'
import { SkinArchive } from '../src/skin.ts'
import { strToU8, zipSync } from 'fflate'

const layout = ['default', 'port_layout', 'b', 'full26Pinyin']
const styles = ['default', 's_info', 'ss_1']
const board = { keys: [{ id: '9', b: { base_f: [1728], base_b: 3 }, values: [4, 'brace } and \\" quote'], rect: [[0, 0], [100, 100]] }, { id: '2', b: {} }], key_fix: { 7: { b: { base_f: [1728] } } } }
const original = encodeSkinJson({ default: { port_layout: { b: { full26Pinyin: board } }, s_info: { ss_1: { 1728: { id: 'STYLE1728', s_2: { normal: 'old,0', hl: 'old,1' }, s_1: { text: 'q' } } } } } })

test('SXI foreground append and state image edits persist through save/reopen without losing other data', () => {
  const added = addSxiImageStyle(original, styles, 'NM_IMG', 'new,2')
  let after = setSxiForeground(added.text, layout, ['KEY9', 'KEY2', 'TIP7'], `1728,${added.id}`)
  after = setSxiStyleImage(after, styles, [`STYLE${added.id}`], 'HL_IMG', 'new,3')
  const archive = SkinArchive.open(zipSync({ 'skin.json': strToU8(original) }), 'sxi')
  archive.setText('skin.json', after)
  const reopened = SkinArchive.open(archive.toBytes('sxi'), 'sxi')
  const skin = parseSkinJson(reopened.getText('skin.json'))
  assert.deepEqual(skin.default.port_layout.b.full26Pinyin.keys[0].b, { base_b: 3, base_f: [1728, Number(added.id)] })
  assert.deepEqual(skin.default.s_info.ss_1[added.id].s_2, { normal: 'new,2', hl: 'new,3' })
  assert.deepEqual(skin.default.s_info.ss_1[1728].s_1, { text: 'q' })
  assert.match(sxiDerivedFiles(skin).get('light/skin/port/py_26.ini').text, new RegExp(`FORE_STYLE=1728,${added.id}`))
  archive.setText('skin.json', original)
  assert.deepEqual(parseSkinJson(archive.getText('skin.json')), parseSkinJson(original))
  assert.throws(() => setSxiForeground(original, layout, ['KEY9'], 'NaN'), /编号/)
  assert.throws(() => setSxiForeground(original, layout, ['KEY404'], '1'), /KEY404/)
})

test('SXI view edits go back to the skin.json values they were projected from', () => {
  const view = (skin, path) => sxiDerivedFiles(parseSkinJson(skin)).get(path).text
  const edit = (skin, path, change) => {
    const before = view(skin, path)
    const document = IniDocument.parse(before)
    change(document)
    return applySxiViewEdit(skin, path, before, document.toString())
  }
  const layoutPath = 'light/skin/port/py_26.ini'
  const cssPath = 'light/skin/res/default.css'
  let after = edit(original, layoutPath, (document) => {
    document.set('KEY9', 'CENTER', 'w')
    document.set('KEY9', 'UP', 'F12')
    document.set('KEY9', 'VIEW_RECT', '1,2,30,40')
    document.set('KEY2', 'BACK_STYLE', '7')
  })
  let skin = parseSkinJson(after)
  const [key9, key2] = skin.default.port_layout.b.full26Pinyin.keys
  // CENTER (button 4) is replaced in place; UP (button 0) is appended as its Palm action name.
  assert.deepEqual(key9.values, [4, 'w', 0, ACTION_CODES.F12])
  assert.deepEqual(key9.rect, [[1, 2], [30, 40]])
  assert.equal(key2.b.base_b, 7)
  // Text properties land in s_1; a new STYLE section becomes a new style.
  after = edit(after, cssPath, (document) => {
    document.set('STYLE1728', 'FONT_SIZE', '36')
    document.appendSection('STYLE9', [{ key: 'NM_COLOR', value: 'FF112233' }])
  })
  skin = parseSkinJson(after)
  assert.deepEqual(skin.default.s_info.ss_1[1728].s_1, { text: 'q', f_s: 36 })
  assert.deepEqual(skin.default.s_info.ss_1[9], { f: 0, id: 'STYLE9', s_1: { c_normal: 'FF112233' } })
  assert.match(view(after, cssPath), /\[STYLE9\]\nNM_COLOR=FF112233/)
  // Values with no skin.json counterpart are refused rather than silently lost.
  assert.throws(() => edit(original, layoutPath, (document) => document.set('KEY9', 'FORE_OFFSET', '0,1')), /FORE_OFFSET/)
})

test('SXI source ranges follow key IDs, nested bases, escaped strings and state tips', () => {
  const text = encodeSkinJson(board)
  const ranges = sxiSectionRanges(text, ['KEY9', 'KEY2'])
  assert.deepEqual(ranges.map(([a, b]) => JSON.parse(text.slice(a, b)).id), ['9', '2'])
  const [a, b] = sxiSectionRanges(text, ['TIP7'])[0]
  assert.match(text.slice(a, b), /base_f/)
  assert.equal(sxiSectionRanges(text, ['KEY404']).length, 0)
  assert.doesNotThrow(() => sxiSectionRanges('{"keys":[{', ['KEY9']))
})

test('SXI full source ranges stay within the selected board and theme', () => {
  const skin = parseSkinJson(original)
  skin.default.port_layout.b.other = { keys: [{ id: '9', marker: 'other' }] }
  skin.night = { port_layout: { b: { full26Pinyin: { keys: [{ id: '9', marker: 'night' }] } } } }
  const text = encodeSkinJson(skin)
  for (const [pointer, expected] of [[layout, board.keys[0]], [['night', ...layout.slice(1)], skin.night.port_layout.b.full26Pinyin.keys[0]]]) {
    const ranges = sxiSectionRanges(text, ['KEY9'], pointer)
    assert.equal(ranges.length, 1)
    assert.deepEqual(JSON.parse(text.slice(...ranges[0])), expected)
  }
  assert.deepEqual(sxiSectionRanges(text, ['KEY9'], ['missing']), [])
})

test('SXI image edits target an orientation table even when identical tables were deduplicated in the projection', () => {
  const skin = parseSkinJson(original)
  skin.default.s_port = structuredClone(skin.default.s_info)
  const text = encodeSkinJson(skin)
  assert.equal(sxiDerivedFiles(skin).has('light/skin/port/res/default.css'), false)
  const own = sxiStylePointer(text, styles, 'port')
  const added = addSxiImageStyle(text, own, 'NM_IMG', 'new,1')
  const after = parseSkinJson(added.text)
  assert.deepEqual(after.default.s_info, skin.default.s_info)
  assert.match(sxiDerivedFiles(after).get('light/skin/port/res/default.css').text, /NM_IMG=new,1/)
  assert.deepEqual(sxiStylePointer(text, styles, 'land'), styles)
})
