// 导出 BDS 时补齐百度安卓的结构（src/bds-package.ts）：规则来自 MuMu 真机逐项对照官方皮肤。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { IniDocument } from '../src/ini.ts'
import { decodePng, encodePng } from '../src/ssf/ssf-png.ts'
import { completeBdsPackage, globalFirst, MAX_IMAGE_FILES, symbolLayoutFrom, withInheritedSections, withMoreDefaults } from '../src/bds-package.ts'
import { bakeBdsBackgrounds } from '../src/bds-backgrounds.ts'

const py9 = [
  '[PANEL]', 'SIZE=1080,642', 'KEY_NUM=4', 'BACK_STYLE=1',
  '[KEY1]', 'CENTER=b', 'VIEW_RECT=189,5,234,160', 'FORE_STYLE=2',
  '[KEY2]', 'CENTER=F36', 'VIEW_RECT=891,5,183,160', 'BACK_STYLE=3',
  '[KEY3]', 'CENTER=F1', 'VIEW_RECT=6,485,183,152', 'BACK_STYLE=4',
  '[KEY4]', 'CENTER=F38', 'VIEW_RECT=189,485,350,152', 'BACK_STYLE=5',
  '[LIST]', 'POS=6,5', 'CELL_SIZE=183,120', 'LIST_NUM=4', 'TYPE=0', 'NAMES=， 。', 'FORE_STYLE=9',
].join('\n')

test('GLOBAL 段挪到 css 开头，其余内容不变', () => {
  assert.equal(globalFirst('[STYLE1]\nA=1\n[GLOBAL]\nSTYLE_NUM=1\n[STYLE2]\nB=2\n'), '[GLOBAL]\nSTYLE_NUM=1\n[STYLE1]\nA=1\n[STYLE2]\nB=2\n')
  assert.equal(globalFirst('[STYLE1]\r\nA=1\r\n[GLOBAL]\r\nSTYLE_NUM=1'), '[GLOBAL]\r\nSTYLE_NUM=1\r\n[STYLE1]\r\nA=1\r\n')
  const already = '[GLOBAL]\nSTYLE_NUM=1\n[STYLE1]\n'
  assert.equal(globalFirst(already), already)
})

test('布局缺的 INPUT/CAND/MORE 空段补在开头', () => {
  assert.equal(withInheritedSections('[CAND]\n[PANEL]\nKEY_NUM=0\n'), '[INPUT]\n[MORE]\n[CAND]\n[PANEL]\nKEY_NUM=0\n')
})

test('gen.ini 的 MORE 补上符号面板需要的字段，已有的不动', () => {
  const gen = IniDocument.parse(withMoreDefaults('[PANEL]\nSIZE=1,1\n', '9'))
  assert.deepEqual([gen.get('MORE', 'SYM_LAYOUT'), gen.get('MORE', 'GRID'), gen.get('MORE', 'FORE_STYLE')], ['symbol', '4,4', '9'])
  assert.equal(IniDocument.parse(withMoreDefaults('[MORE]\nFORE_STYLE=5\n', '9')).get('MORE', 'FORE_STYLE'), '5')
})

test('用拼音九键生成符号面板：列表、底行、删除键照搬，符号键改成返回', () => {
  const symbol = IniDocument.parse(symbolLayoutFrom(IniDocument.parse(py9)))
  assert.equal(symbol.get('PANEL', 'SIZE'), '1080,642')
  assert.equal(symbol.get('PANEL', 'KEY_NUM'), '4')
  assert.equal(symbol.get('LIST', 'NAMES'), undefined)
  assert.equal(symbol.get('LIST', 'FORE_STYLE'), '9')
  assert.deepEqual([symbol.get('KEY1', 'CENTER'), symbol.get('KEY1', 'VIEW_RECT')], ['F55', '189,5,702,480'])
  assert.deepEqual([2, 3, 4].map((n) => symbol.get(`KEY${n}`, 'CENTER')), ['F4', 'F38', 'F36'])
  assert.ok(['INPUT', 'CAND', 'MORE'].every((section) => symbol.sections().includes(section)))
})

test('整包修复：CRLF Info、补 symbol.ini，图片超过上限时合成图集并改写引用', async () => {
  const png = encodePng({ width: 4, height: 2, data: new Uint8Array(32).fill(0x80) })
  const files = {
    'Info.txt': strToU8('Name=t\nSupportPlatform=A\n'),
    'light/port/gen.ini': strToU8('[PANEL]\nSIZE=1080,642\n'),
    'light/port/py_9.ini': strToU8(py9),
    'light/port/logo.ini': strToU8('[GLOBAL]\nICON_NUM=0\n'),
    'light/res/default.css': strToU8('[STYLE1]\nNM_IMG=img0,1\n[STYLE2]\nNM_IMG=img129,1\n[GLOBAL]\nSTYLE_NUM=2\n'),
  }
  for (let i = 0; i < MAX_IMAGE_FILES + 2; i++) {
    files[`light/res/img${i}.png`] = png
    files[`light/res/img${i}.til`] = strToU8('[GLOBAL]\nTILE_NUM=1\n[IMG1]\nSOURCE_RECT=0,0,4,2\nINNER_RECT=1,0,2,2\n')
  }
  const composed = []
  const out = unzipSync(await completeBdsPackage(zipSync(files), async (width, height, parts) => {
    composed.push({ width, height, parts: parts.length })
    return encodePng({ width, height, data: new Uint8Array(width * height * 4).fill(0x80) })
  }))
  const text = (path) => strFromU8(out[path])
  assert.equal(text('Info.txt'), 'Name=t\r\nSupportPlatform=A\r\n')
  assert.ok(out['light/port/symbol.ini'])
  assert.ok(text('light/port/py_9.ini').startsWith('[INPUT]\n[CAND]\n[MORE]\n'))
  assert.ok(!text('light/port/logo.ini').includes('[CAND]'))
  const images = Object.keys(out).filter((path) => /^light\/res\/[^/]+\.png$/.test(path))
  assert.ok(images.length <= MAX_IMAGE_FILES)
  const kept = images.filter((path) => !path.includes('keyskin_atlas'))
  assert.ok(kept.length > 0, 'only the surplus images are packed; original PNGs retain their encoding')
  assert.equal(composed.reduce((sum, { parts }) => sum + parts, 0) + kept.length, MAX_IMAGE_FILES + 2)
  for (const path of kept) assert.deepEqual(out[path], files[path])
  const css = IniDocument.parse(text('light/res/default.css'))
  assert.equal(css.sections()[0], 'GLOBAL')
  const [image, tile] = css.get('STYLE2', 'NM_IMG').split(',')
  const til = IniDocument.parse(text(`light/res/${image}.til`))
  const [x] = til.get(`IMG${tile}`, 'SOURCE_RECT').split(',').map(Number)
  assert.equal(til.get(`IMG${tile}`, 'INNER_RECT'), `${x + 1},${til.get(`IMG${tile}`, 'SOURCE_RECT').split(',')[1]},2,2`)
})

test('BDS 按键背景按布局尺寸烘焙 INNER_RECT，避免百度亮色路径整图拉伸', () => {
  const data = new Uint8Array(4 * 4 * 4)
  for (let i = 0; i < data.length; i += 4) data.set([i / 4, 80, 120, 255], i)
  const files = {
    'Info.txt': strToU8('Name=t\nSupportPlatform=A\n'),
    'light/port/gen.ini': strToU8('[PANEL]\nSIZE=8,6\n'),
    'light/port/py_9.ini': strToU8('[KEY1]\nBACK_STYLE=1\nVIEW_RECT=0,0,8,6\n'),
    'light/res/default.css': strToU8('[GLOBAL]\nSTYLE_NUM=2\n[STYLE1]\nNM_IMG=key,1\n'),
    'light/res/key.png': encodePng({ width: 4, height: 4, data }),
    'light/res/key.til': strToU8('[IMG1]\nSOURCE_RECT=0,0,4,4\nINNER_RECT=1,1,2,2\n'),
  }
  const out = unzipSync(bakeBdsBackgrounds(zipSync(files)))
  const css = IniDocument.parse(strFromU8(out['light/res/default.css']))
  const style = css.get('STYLE2', 'NM_IMG')
  assert.ok(style)
  assert.equal(css.get('STYLE1', 'NM_IMG'), 'key,1')
  assert.deepEqual([...decodePng(out[`light/res/${style.split(',')[0]}.png`]).data.slice(0, 8)], [0, 80, 120, 255, 1, 80, 120, 255])
  const til = IniDocument.parse(strFromU8(out[`light/res/${style.split(',')[0]}.til`]))
  assert.equal(til.get('IMG1', 'SOURCE_RECT'), '0,0,8,6')
  assert.equal(til.get('IMG1', 'INNER_RECT'), undefined)
  assert.equal(IniDocument.parse(strFromU8(out['light/port/py_9.ini'])).get('KEY1', 'BACK_STYLE'), '2')
})

test('部分合图为字体图片预留数量，并保留已有图集，避免再次导出覆盖资源', async () => {
  const png = encodePng({ width: 4, height: 2, data: new Uint8Array(32).fill(0x80) })
  const oldAtlas = encodePng({ width: 64, height: 64, data: Uint8Array.from({ length: 64 * 64 * 4 }, (_, i) => (Math.imul(i, 65537) >>> 8) & 255) })
  const tile = strToU8('[GLOBAL]\nTILE_NUM=1\n[IMG1]\nSOURCE_RECT=0,0,4,2\n')
  const files = {
    'light/res/default.css': strToU8('[STYLE1]\nNM_IMG=keyskin_atlas1,1\n[STYLE2]\nNM_IMG=keyskin_font,1\n'),
    'light/res/keyskin_atlas1.png': oldAtlas,
    'light/res/keyskin_atlas1.til': tile,
    'light/res/keyskin_font.png': png,
    'light/res/keyskin_font.til': tile,
  }
  for (let i = 0; i < MAX_IMAGE_FILES; i++) {
    files[`light/res/img${i}.png`] = png
    files[`light/res/img${i}.til`] = tile
  }
  const out = unzipSync(await completeBdsPackage(zipSync(files), async (width, height) =>
    encodePng({ width, height, data: new Uint8Array(width * height * 4) })))
  assert.ok(Object.keys(out).filter(path => /^light\/res\/[^/]+\.png$/.test(path)).length <= MAX_IMAGE_FILES)
  for (const path of ['light/res/keyskin_atlas1.png', 'light/res/keyskin_atlas1.til', 'light/res/keyskin_font.png', 'light/res/keyskin_font.til']) assert.deepEqual(out[path], files[path])
  assert.ok(out['light/res/keyskin_atlas2.png'])
  assert.equal(IniDocument.parse(strFromU8(out['light/res/default.css'])).get('STYLE1', 'NM_IMG'), 'keyskin_atlas1,1')
})

test('图集改写按整个引用匹配：数字开头的图片名（BDA 资源 ID）也跟着改', async () => {
  const png = encodePng({ width: 4, height: 2, data: new Uint8Array(32).fill(0x80) })
  const til = strToU8('[GLOBAL]\nTILE_NUM=1\n[IMG1]\nSOURCE_RECT=0,0,4,2\n')
  const files = {
    'Info.txt': strToU8('Name=t\r\n'),
    'light/res/default.css': strToU8('[GLOBAL]\nSTYLE_NUM=1\n[STYLE1]\nNM_IMG=3btn,1\n'),
    'light/port/res/default.css': strToU8('[GLOBAL]\nSTYLE_NUM=1\n[STYLE1]\nNM_IMG=10023,1\nHL_IMG=btn,1\n'),
  }
  for (const name of ['10023', '3btn', 'btn', ...Array.from({ length: MAX_IMAGE_FILES }, (_, i) => `img${i}`)]) {
    files[`light/res/${name}.png`] = name === 'btn' ? encodePng({ width: 4, height: 2, data: new Uint8Array(32).fill(0x40) }) : png
    files[`light/res/${name}.til`] = til
  }
  const out = unzipSync(await completeBdsPackage(zipSync(files), async (width, height) =>
    encodePng({ width, height, data: new Uint8Array(width * height * 4).fill(0x80) })))
  const resolves = (path, key) => {
    const [name, slice] = IniDocument.parse(strFromU8(out[path])).get('STYLE1', key).split(',')
    return Boolean(out[`light/res/${name}.png`]) && IniDocument.parse(strFromU8(out[`light/res/${name}.til`])).sections().includes(`IMG${slice}`)
  }
  assert.ok(resolves('light/port/res/default.css', 'NM_IMG'), 'a numeric image name follows its image into the atlas')
  assert.ok(resolves('light/res/default.css', 'NM_IMG'))
  assert.ok(resolves('light/port/res/default.css', 'HL_IMG'))
  const style = (path, key) => IniDocument.parse(strFromU8(out[path])).get('STYLE1', key)
  assert.notEqual(style('light/res/default.css', 'NM_IMG'), style('light/port/res/default.css', 'HL_IMG'), '3btn is not mistaken for btn')
})
