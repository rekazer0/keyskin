import test from 'node:test'
import assert from 'node:assert/strict'
import { strToU8, zipSync } from 'fflate'
import { SkinArchive } from '../src/skin.ts'
import { buildSxiZip } from '../src/palm/palm-export.ts'
import { PalmBoard } from '../src/palm/palm-board.ts'
import { decodePng, encodePng } from '../src/ssf/ssf-png.ts'

function fixture(inner = '2,2,4,4') {
  const data = new Uint8Array(16 * 8 * 4)
  // Transparent one-pixel gutter, opaque key face, with a different pressed colour.
  for (let y = 1; y < 7; y++) for (let x = 1; x < 7; x++) {
    data.set([40, 80, 120, 255], (y * 16 + x) * 4)
    data.set([120, 80, 40, 255], (y * 16 + x + 8) * 4)
  }
  return SkinArchive.open(zipSync(Object.fromEntries(Object.entries({
    'Info.txt': 'Name=Background regression\n',
    'light/port/gen.ini': '[PANEL]\nSIZE=100,100\n',
    'light/port/py_26.ini': [
      '[KEY1]', 'BACK_STYLE=1', 'FORE_STYLE=2', 'VIEW_RECT=0,0,20,16', 'CENTER=q', 'STAT_STYLE=S11_1',
      '[KEY2]', 'BACK_STYLE=1', 'VIEW_RECT=20,0,30,16', 'CENTER=w', 'STAT_STYLE=S11_1',
      '[KEY3]', 'BACK_STYLE=1', 'VIEW_RECT=50,0,20,16', 'CENTER=e',
      '[KEY4]', 'BACK_STYLE=1', 'VIEW_RECT=0,16,22,18',
      '[KEY5]', 'BACK_STYLE=1', 'VIEW_RECT=20,16,22,18',
      '[TIP1]', 'BACK_STYLE=1', 'CENTER=Q',
    ].join('\n'),
    'light/land/gen.ini': '[PANEL]\nSIZE=200,100\n',
    'light/land/py_26.ini': '[KEY1]\nBACK_STYLE=1\nVIEW_RECT=0,0,40,16\nCENTER=q\n',
    'light/res/default.css': '[STYLE1]\nNM_IMG=key,1\nHL_IMG=key,2\n[STYLE2]\nSHOW=Q\nFONT_SIZE=12\n',
    'light/res/key.til': `[IMG1]\nSOURCE_RECT=0,0,8,8\nINNER_RECT=${inner}\n[IMG2]\nSOURCE_RECT=8,0,8,8\nINNER_RECT=10,2,4,4\n`,
    'light/res/key.png': encodePng({ width: 16, height: 8, data }),
  }).map(([path, value]) => [path, typeof value === 'string' ? strToU8(value) : value]))), 'bdi')
}

function image(skin, archive, styleId, state) {
  const [name, id] = skin.s_info.ss_1[styleId].s_2[state].split(',')
  const tile = skin.s_info.info[name].find((tile) => tile.id === `IMG${id}`)
  const path = skin.r_info.find((path) => path.endsWith(`/${name}.png`))
  return { tile, png: decodePng(archive.getBytes(path)) }
}

test('Baidu key backgrounds keep design-sized gutters, shadow plates and state overrides on Palm Android', () => {
  const source = fixture()
  const before = source.toBytes()
  const result = buildSxiZip(source)
  assert.deepEqual(source.toBytes(), before)
  const archive = SkinArchive.open(result.bytes, 'sxi')
  const skin = JSON.parse(archive.getText('skin.json'))
  const theme = skin.default
  const board = theme.port_layout.b.full26Pinyin
  assert.equal(board.keys.length, 5, 'overlapping decoration keys are retained')
  assert.equal(new PalmBoard(skin, 'default', 'port', 'full26Pinyin').keys().length, 5, 'preview retains the same decorations')
  assert.deepEqual(board.keys[0].rect, [[0, 0], [20, 16]])
  assert.deepEqual(board.keys[0].b.base_f, [2], 'foregrounds keep their authored styles')
  assert.equal(board.keys[0].b.base_b, board.keys[2].b.base_b, 'same style and size reuse a baked image')
  assert.notEqual(board.keys[0].b.base_b, board.keys[1].b.base_b, 'different widths get different backgrounds')
  for (const [index, width] of [[0, 20], [1, 30]]) {
    for (const [state, colour] of [['normal', [40, 80, 120, 255]], ['hl', [120, 80, 40, 255]]]) {
      const { tile, png } = image(theme, archive, board.keys[index].b.base_b, state)
      assert.equal(tile.rect2, undefined, 'Android scales the completed artwork without a fixed-pixel nine-patch')
      assert.deepEqual(tile.rect1, [[0, 0], [width, 16]])
      assert.deepEqual([png.width, png.height], [width, 16])
      const pixel = (x, y) => [...png.data.slice((y * width + x) * 4, (y * width + x + 1) * 4)]
      assert.equal(pixel(0, 8)[3], 0, 'transparent gutter survives')
      assert.deepEqual(pixel(1, 8), colour, 'gutter remains one design pixel before device scaling')
      assert.deepEqual(pixel(width - 2, 8), colour)
      assert.equal(pixel(width - 1, 8)[3], 0)
    }
    const tip = board.key_fix[board.keys[index].fix_a[1]]
    assert.deepEqual(tip.v, [4, 'Q'], 'state actions survive background specialization')
    assert.equal(tip.b.base_b, board.keys[index].b.base_b)
  }
  const landscape = theme.land_layout.b.full26Pinyin.keys[0]
  assert.equal(image(theme, archive, landscape.b.base_b, 'normal').png.width, 40)
  assert.ok(theme.s_info.info.key[0].rect2, 'source tiles remain available to foregrounds and animations')
  assert.deepEqual(result.warnings, [])
})

test('invalid stretch rectangles stay intact instead of creating an invalid bitmap', () => {
  const result = buildSxiZip(fixture('20,2,4,4'))
  const skin = JSON.parse(SkinArchive.open(result.bytes, 'sxi').getText('skin.json')).default
  const key = skin.port_layout.b.full26Pinyin.keys[0]
  assert.equal(skin.s_info.ss_1[key.b.base_b].s_2.normal, 'key,1')
})

test('iPhone orientation tables resolve baked backgrounds and cached variants without shared-table fallback', () => {
  const source = fixture()
  for (const orientation of ['port', 'land']) {
    source.setText(`light/skin/${orientation}/res/default.css`, '[STYLE99]\nNM_COLOR=ff112233\n')
  }
  source.setText('light/skin/land/py_26.ini', '[KEY1]\nBACK_STYLE=1\nVIEW_RECT=0,0,20,16\nCENTER=q\n')
  const archive = SkinArchive.open(buildSxiZip(source).bytes, 'sxi')
  const theme = JSON.parse(archive.getText('skin.json')).default
  assert.equal(theme.port_layout.b.full26Pinyin.keys[0].b.base_b, theme.land_layout.b.full26Pinyin.keys[0].b.base_b,
    'a cached bitmap can be referenced from either orientation')
  for (const orientation of ['port', 'land']) {
    const own = theme[`s_${orientation}`]
    assert.equal(own.ss_1['99'].s_1.c_normal, 'ff112233', 'authored orientation styles survive')
    const board = theme[`${orientation}_layout`].b.full26Pinyin
    const bases = board.keys.flatMap((key) => [key.b, ...(key.fix_a ?? []).flatMap((id, index) =>
      index % 2 === 1 ? [board.key_fix[id].b] : [])])
    for (const base of bases) for (const state of ['normal', 'hl']) {
      const style = own.ss_1[base.base_b]
      assert.ok(style, `${orientation}: iPhone finds background style ${base.base_b}`)
      const [name, id] = style.s_2[state].split(',')
      const tile = own.info[name]?.find((tile) => tile.id === `IMG${id}`)
      assert.ok(tile, `${orientation}: iPhone finds the baked tile ${name}`)
      const path = theme[`r_${orientation}`].find((path) => path.endsWith(`/${name}.png`))
      assert.ok(path, `${orientation}: iPhone finds the resource declaration ${name}`)
      const png = decodePng(archive.getBytes(path))
      assert.deepEqual([png.width, png.height], tile.rect1[1])
      assert.ok(png.data.some((value, index) => index % 4 === 3 && value > 0), 'background pixels are visible')
    }
  }
})

test('candidate background decorations scale with the bar in both orientations', () => {
  const source = fixture()
  for (const [orientation, width] of [['port', 100], ['land', 200]]) {
    source.setText(`light/skin/${orientation}/gen.ini`, `[PANEL]\nSIZE=${width},100\n[CAND]\nLAYOUT_NAME=cand1\nVIEW_RECT=0,0,${width},20\nPADDING=0,4,0,0\n`)
    source.setText(`light/skin/${orientation}/cand1.cnd`, '[CAND]\nBACK_STYLE=1\n')
  }
  const archive = SkinArchive.open(buildSxiZip(source).bytes, 'sxi')
  const skin = JSON.parse(archive.getText('skin.json')).default
  for (const [orientation, width] of [['port', 100], ['land', 200]]) {
    const candidate = skin[`${orientation}_layout`].c.cand1
    const { tile, png } = image(skin, archive, candidate.b.base_b, 'normal')
    assert.deepEqual(tile.rect1, [[0, 0], [width, 16]], 'input-code inset is excluded from the background height')
    assert.equal(tile.rect2, undefined)
    assert.deepEqual([png.width, png.height], [width, 16])
    assert.deepEqual([...png.data.slice((8 * width + 1) * 4, (8 * width + 2) * 4)], [40, 80, 120, 255], 'edge decoration retains its design size')
  }
})
