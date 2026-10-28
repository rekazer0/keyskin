import { test } from 'node:test'
import assert from 'node:assert/strict'
import { strToU8, zipSync } from 'fflate'
import { sxiFragmentRange, sxiSectionRanges } from '../src/palm/sxi-edit.ts'
import { addPalmStyle, palmStyleIDList, palmStyleKindOf, palmStyleLocation, palmTilePointer, palmTileSlices, removePalmTile, setPalmTile, setPalmTiles } from '../src/palm/palm-style-edit.ts'
import { encodeSkinJson, parseSkinJson, sxiAddressPointer } from '../src/palm/sxi-json.ts'
import { SkinArchive } from '../src/skin.ts'

const layout = ['default', 'port_layout', 'b', 'full26Pinyin']
const board = { keys: [{ id: '9', b: { base_f: [1728], base_b: 3 }, values: [4, 'brace } and \\" quote'], rect: [[0, 0], [100, 100]] }, { id: '2', b: {} }], key_fix: { 7: { b: { base_f: [1728] } } } }
const original = encodeSkinJson({ default: { port_layout: { b: { full26Pinyin: board } }, s_info: { ss_1: { 1728: { id: 'STYLE1728', s_2: { normal: 'old,0', hl: 'old,1' }, s_1: { text: 'q' } } } } } })

test('a .sxi package holds only its own files: skin.json is read and saved as it is', () => {
  const archive = SkinArchive.open(zipSync({ 'skin.json': strToU8(original), 'light/skin/res/btn.png': new Uint8Array([1]) }), 'sxi')
  assert.deepEqual(archive.names(), ['light/skin/res/btn.png', 'skin.json'])
  assert.equal(archive.getBytes('light/skin/port/py_26.ini'), undefined, 'no layout is generated from skin.json')
  assert.equal(archive.isText('light/skin/res/default.css'), false)
  const skin = parseSkinJson(archive.getText('skin.json'))
  skin.default.s_info.ss_1[1728].s_1.f_s = 40
  archive.setText('skin.json', encodeSkinJson(skin))
  const reopened = SkinArchive.open(archive.toBytes('sxi'), 'sxi')
  assert.equal(parseSkinJson(reopened.getText('skin.json')).default.s_info.ss_1[1728].s_1.f_s, 40)
  assert.deepEqual(reopened.names(), archive.names())
})

test('skin.json addresses name parts by pointer', () => {
  assert.deepEqual(sxiAddressPointer('skin.json/default/port_layout/b/t9Pinyin'), ['default', 'port_layout', 'b', 't9Pinyin'])
  assert.deepEqual(sxiAddressPointer('skin.json/night/'), ['night'])
  assert.equal(sxiAddressPointer('skin.json/'), undefined)
  assert.equal(sxiAddressPointer('skin.json'), undefined)
  assert.equal(sxiAddressPointer('light/skin/res/btn.png'), undefined)
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
  const style = sxiFragmentRange(text, ['default', 's_info', 'ss_1', '1728'])
  assert.match(text.slice(...style), /"1728"\s*:\s*\{[\s\S]*STYLE1728/)
  assert.equal(sxiFragmentRange(text, ['default', 'nothing']), undefined)
})

test('Palm styles are looked up by id in the orientation table first, then the shared one', () => {
  const skin = parseSkinJson(original)
  skin.default.s_port = { ss_1: { 5: { s_1: { text: 'own' } } } }
  assert.deepEqual(palmStyleLocation(skin, 'default', 'port', '5'), ['default', 's_port', 'ss_1', '5'])
  assert.deepEqual(palmStyleLocation(skin, 'default', 'port', '1728'), ['default', 's_info', 'ss_1', '1728'])
  assert.equal(palmStyleLocation(skin, 'default', 'land', '5'), undefined)
  assert.deepEqual(palmStyleIDList(skin, 'default', 'port'), ['5', '1728'])
  assert.deepEqual(palmStyleIDList(skin, 'default', 'land'), ['1728'])
})

test('a new Palm style takes an id no table of the theme uses, or the one asked for', () => {
  const skin = parseSkinJson(original)
  skin.default.s_land = { ss_1: { 1: { id: 'STYLE1' } } }
  const id = addPalmStyle(skin, 'default', { s_2: { normal: 'new,2' } })
  assert.equal(id, '2')
  assert.deepEqual(skin.default.s_info.ss_1[2], { f: 0, id: 'STYLE2', s_2: { normal: 'new,2' } })
  assert.equal(addPalmStyle(skin, 'default', {}, '40'), '40')
  assert.throws(() => addPalmStyle(skin, 'default', {}, '1'), /STYLE1 已存在/)
  assert.throws(() => addPalmStyle(skin, 'night'), /缺少 night/)
})

test('Palm style kinds follow what the style draws', () => {
  assert.equal(palmStyleKindOf({ s_2: { normal: 'btn,1' }, s_1: { text: 'a' } }), 'image')
  assert.equal(palmStyleKindOf({ s_5: { 1: 3 } }), 'anim')
  assert.equal(palmStyleKindOf({ s_1: { for_back: true, c_normal: 'FF000000' } }), 'color')
  // A label's colour counts too, as NM_COLOR does in a Baidu style.
  assert.equal(palmStyleKindOf({ s_1: { text: 'a', f_s: 32, c_normal: 'FF000000', for_back: false } }), 'color')
  assert.equal(palmStyleKindOf({ s_4: { path_1: 'click.wav' } }), 'sound')
  assert.equal(palmStyleKindOf({ s_1: { text: 'a' } }), 'text')
  assert.equal(palmStyleKindOf({ s_3: { size: 1 } }), 'text')
  assert.equal(palmStyleKindOf({ f: 0 }), 'empty')
  assert.equal(palmStyleKindOf(undefined), 'empty')
})

test('Palm images are sliced by the tile map of the folder they are in', () => {
  assert.deepEqual(palmTilePointer('light/skin/res/btn.png'), ['default', 's_info', 'info', 'btn'])
  assert.deepEqual(palmTilePointer('dark/skin/land/res/btn.png'), ['night', 's_land', 'info', 'btn'])
  assert.deepEqual(palmTilePointer('light/skin/res/logo/pop_menu_icons.png'), ['default', 'a_m'])
  assert.equal(palmTilePointer('light/skin/res/logo/other.png'), undefined)
  const skin = parseSkinJson(original)
  skin.default.s_info.info = { btn: [{ id: 'IMG2', rect1: [[0, 0], [10, 10]], rect2: [[2, 2], [6, 6]], alpha: 1 }, { id: 'IMG1', rect1: [[10, 0], [10, 10]], rect2: [[0, 0], [0, 0]] }] }
  assert.deepEqual(palmTileSlices(skin, 'light/skin/res/btn.png'), [
    { index: 1, source: [10, 0, 10, 10] },
    { index: 2, source: [0, 0, 10, 10], inner: [2, 2, 6, 6] },
  ])
  // Editing keeps the tile's other fields; a slice without a stretchable centre drops rect2 and scales.
  setPalmTile(skin, 'light/skin/res/btn.png', { index: 2, source: [1, 1, 8, 8] })
  assert.deepEqual(skin.default.s_info.info.btn[0], { id: 'IMG2', rect1: [[1, 1], [8, 8]], alpha: 1 })
  setPalmTile(skin, 'light/skin/res/btn.png', { index: 3, source: [20, 0, 5, 5], inner: [21, 1, 3, 3] })
  assert.deepEqual(skin.default.s_info.info.btn[2], { id: 'IMG3', rect1: [[20, 0], [5, 5]], rect2: [[21, 1], [3, 3]] })
  removePalmTile(skin, 'light/skin/res/btn.png', 1)
  assert.deepEqual(palmTileSlices(skin, 'light/skin/res/btn.png').map((slice) => slice.index), [2, 3], 'the others keep their numbers')
  // An image without a tile map gets one.
  setPalmTiles(skin, 'light/skin/port/res/new.png', [{ index: 1, source: [0, 0, 4, 4] }, { index: 2, source: [4, 0, 4, 4] }])
  assert.deepEqual(skin.default.s_port.info.new.map((tile) => tile.id), ['IMG1', 'IMG2'])
  assert.throws(() => setPalmTile(skin, 'light/skin/other/x.png', { index: 1, source: [0, 0, 1, 1] }), /没有保存/)
})
