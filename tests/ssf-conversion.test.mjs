import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { strFromU8, strToU8, unzipSync, zipSync, zlibSync } from 'fflate'
import { IniDocument } from '../src/ini.ts'
import { SkinArchive } from '../src/skin.ts'
import { decodeBdaAppearance, decodeBdaSoundConfig } from '../src/bda-decode.ts'
import { convertBdaArchive } from '../src/bda-convert.ts'
import { SsfPackage, looksLikeSsf, parseSsfImage, ssfColor } from '../src/ssf/ssf-package.ts'
import { ssfBoard, ssfKeyBinding } from '../src/ssf/ssf-keymap.ts'
import { compositeImage, cropImage, decodePng, encodePng, placeImage, pngSize, resizeImage, tintImage } from '../src/ssf/ssf-png.ts'
import { convertSsfToBaidu } from '../src/ssf/ssf-to-baidu.ts'
import { convertSsfToBda } from '../src/ssf/ssf-to-bda.ts'
import { convertBaiduToSsf } from '../src/ssf/baidu-to-ssf.ts'
import { convertSsfDocument, exportSsf, ssfDocumentBytes } from '../src/ssf/ssf-convert.ts'
import { COLORS, SIZES, TEXT, skinContainer, solid, ssfFixture } from './helpers/ssf-fixture.mjs'

const read = (path) => new Uint8Array(readFileSync(new URL(path, import.meta.url)))
const bdsTemplate = SkinArchive.open(read('../public/default-template.bds'))
const bdaTemplate = SkinArchive.open(read('../public/default-template.bda'), 'bda')
const bdaBase = SkinArchive.open(read('../public/bda-base.bds'))
const templates = { sogou: SkinArchive.open(read('../public/sogou-template.bds')), bda: bdaTemplate }

/** Opens `.ssf` bytes the way the editor does: as an SSF document. */
const ssfDocument = async (bytes) => SkinArchive.open(await ssfDocumentBytes(bytes), 'ssf')
const convertSsfBytes = async (bytes, format) => convertSsfDocument(await ssfDocument(bytes), format, templates)

const pixel = (image, x, y) => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)]
const rgb = (image, x, y) => pixel(image, x, y).slice(0, 3)
/** Compares two images by their first differing byte; a full-array deepEqual diff runs out of memory. */
function assertSamePixels(actual, expected, message) {
  assert.deepEqual([actual.width, actual.height], [expected.width, expected.height], message)
  const index = actual.data.findIndex((value, offset) => value !== expected.data[offset])
  if (index < 0) return
  const at = index >> 2
  assert.fail(`${message}: (${at % actual.width},${Math.floor(at / actual.width)}) ${pixel(actual, at % actual.width, Math.floor(at / actual.width))} ≠ ${pixel(expected, at % actual.width, Math.floor(at / actual.width))}`)
}
const argb = (hex) => { const value = Number.parseInt(hex.replace(/^0x/i, ''), 16) >>> 0; return [(value >>> 16) & 255, (value >>> 8) & 255, value & 255] }

/** Follows a Baidu INI key (by layout + CENTER) to the image behind one of its styles. */
function baiduKeyStyle(archive, theme, orientation, layout, action, field = 'BACK_STYLE') {
  const document = IniDocument.parse(archive.getText(`${theme}/skin/${orientation}/${layout}.ini`))
  const section = document.sections().find((name) => /^KEY\d+$/.test(name) && document.get(name, 'CENTER') === action)
  assert.ok(section, `${layout} 没有 ${action}`)
  return baiduStyleImage(archive, theme, document.get(section, field).split(',')[0])
}

function baiduStyleImage(archive, theme, styleID) {
  const css = IniDocument.parse(archive.getText(`${theme}/skin/res/default.css`))
  const style = (field) => css.get(`STYLE${styleID}`, field)
  const [name] = (style('NM_IMG') ?? '').split(',')
  const result = { styleID, name, normalColor: style('NM_COLOR'), pressedColor: style('HL_COLOR') }
  if (!name) return result
  const tile = IniDocument.parse(archive.getText(`${theme}/skin/res/${name}.til`))
  const pressedName = style('HL_IMG').split(',')[0]
  return {
    ...result,
    image: decodePng(archive.getBytes(`${theme}/skin/res/${name}.png`)),
    pressed: decodePng(archive.getBytes(`${theme}/skin/res/${pressedName}.png`)),
    inner: tile.get('IMG1', 'INNER_RECT'),
  }
}

// —— PNG codec ——

function rawPng(width, height, colorType, depth, rows, { interlace = 0, chunks = [] } = {}) {
  const chunk = (type, body) => {
    const out = new Uint8Array(12 + body.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, body.length)
    out.set([...type].map((char) => char.charCodeAt(0)), 4)
    out.set(body, 8)
    return out
  }
  const header = new Uint8Array(13)
  new DataView(header.buffer).setUint32(0, width)
  new DataView(header.buffer).setUint32(4, height)
  header.set([depth, colorType, 0, 0, interlace], 8)
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), ...chunks.map(([type, body]) => chunk(type, body)), chunk('IDAT', zlibSync(rows)), chunk('IEND', new Uint8Array())]
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  parts.reduce((offset, part) => (out.set(part, offset), offset + part.length), 0)
  return out
}

test('PNG: RGBA round trip keeps every pixel, including alpha', () => {
  const image = solid(5, 3, [10, 20, 30], 40)
  image.data.set([255, 0, 128, 255], 4 * 7)
  const decoded = decodePng(encodePng(image))
  assert.deepEqual([decoded.width, decoded.height], [5, 3])
  assert.deepEqual([...decoded.data], [...image.data])
  assert.deepEqual(pngSize(encodePng(image)), [5, 3])
})

test('PNG: decodes 16-bit grey, palette with transparency, 1-bit palette and Adam7', () => {
  const grey16 = decodePng(rawPng(2, 1, 0, 16, new Uint8Array([0, 0xff, 0xff, 0x80, 0x00])))
  assert.deepEqual(pixel(grey16, 0, 0), [255, 255, 255, 255])
  assert.deepEqual(pixel(grey16, 1, 0), [128, 128, 128, 255])

  const palette = [['PLTE', new Uint8Array([255, 0, 0, 0, 0, 255])], ['tRNS', new Uint8Array([0])]]
  const indexed = decodePng(rawPng(2, 1, 3, 8, new Uint8Array([0, 0, 1]), { chunks: palette }))
  assert.deepEqual(pixel(indexed, 0, 0), [255, 0, 0, 0])
  assert.deepEqual(pixel(indexed, 1, 0), [0, 0, 255, 255])

  const oneBit = decodePng(rawPng(3, 1, 3, 1, new Uint8Array([0, 0b01000000]), { chunks: palette }))
  assert.deepEqual(oneBit.data.length, 12)
  assert.deepEqual(pixel(oneBit, 1, 0), [0, 0, 255, 255])

  // Adam7 2×2 RGB: pass 1 holds (0,0), pass 6 holds (1,0), pass 7 holds row 1.
  const rows = new Uint8Array([0, 1, 2, 3, 0, 4, 5, 6, 0, 7, 8, 9, 10, 11, 12])
  const interlaced = decodePng(rawPng(2, 2, 2, 8, rows, { interlace: 1 }))
  assert.deepEqual(rgb(interlaced, 0, 0), [1, 2, 3])
  assert.deepEqual(rgb(interlaced, 1, 0), [4, 5, 6])
  assert.deepEqual(rgb(interlaced, 0, 1), [7, 8, 9])
  assert.deepEqual(rgb(interlaced, 1, 1), [10, 11, 12])
})

test('PNG: rejects broken data instead of returning garbage', () => {
  assert.throws(() => decodePng(new Uint8Array([1, 2, 3])), /PNG/)
  const truncated = encodePng(solid(4, 4, [1, 1, 1])).slice(0, 40)
  assert.throws(() => decodePng(truncated))
})

test('PNG: place, crop, resize, composite and tint', () => {
  const red = solid(2, 2, [255, 0, 0])
  const placed = placeImage(red, 4, 4, 1, 2)
  assert.deepEqual(pixel(placed, 0, 0), [0, 0, 0, 0])
  assert.deepEqual(pixel(placed, 1, 2), [255, 0, 0, 255])
  assert.deepEqual(pixel(cropImage(placed, 1, 2, 1, 1), 0, 0), [255, 0, 0, 255])
  const resized = resizeImage(red, 6, 3)
  assert.deepEqual([resized.width, resized.height, ...pixel(resized, 5, 2)], [6, 3, 255, 0, 0, 255])
  const over = compositeImage(solid(1, 1, [0, 0, 255]), solid(1, 1, [255, 255, 255], 128))
  assert.deepEqual(pixel(over, 0, 0), [128, 128, 255, 255])
  const glyph = solid(1, 1, [0, 0, 0], 100)
  assert.deepEqual(pixel(tintImage(glyph, 'FF112233'), 0, 0), [0x11, 0x22, 0x33, 100])
})

// —— Package reading ——

test('ssf package: day/night come from the hours in time.ini, not the listing order', async () => {
  const pkg = await SsfPackage.open(ssfFixture())
  assert.equal(pkg.resolution, '1080')
  assert.deepEqual([...pkg.themes], [['light', '1080/status1/'], ['dark', '1080/status2/']])
  assert.deepEqual(pkg.info, { name: '测试皮肤', author: '测试作者', version: '10000' })
  const single = await SsfPackage.open(ssfFixture({ single: true }))
  assert.deepEqual([...single.themes], [['light', '1080/']])
})

test('ssf package: resolution follows time.ini supported screens', async () => {
  const files = {
    'phoneTheme.ini': strToU8('[General]\nskin_name=分辨率测试\n'),
    'time.ini': strToU8('[General]\nSUPPORT_SCREEN=720,1080\n[1080]\nSTATUS_LIST=status1\n'),
    '720/status1/phoneSkin.ini': strToU8('[General]\nSOURCE=720\n'),
    '1080/status1/phoneSkin.ini': strToU8('[General]\nSOURCE=1080\n'),
    '1440/status1/phoneSkin.ini': strToU8('[General]\nSOURCE=1440\n'),
  }
  const pkg = await SsfPackage.open(zipSync(files))

  assert.equal(pkg.resolution, '1080')
  assert.equal(pkg.folder('light'), '1080/status1/')
  assert.equal(pkg.skin('light').get('General', 'SOURCE'), '1080')
  assert.deepEqual(pkg.file('light', 'phoneSkin.ini'), files['1080/status1/phoneSkin.ini'])
})

test('ssf package: rejects PC skins, non-phone archives and unsafe paths', async () => {
  await assert.rejects(SsfPackage.open(zipSync({ 'skin.ini': strToU8('[General]') })), /电脑版/)
  await assert.rejects(SsfPackage.open(zipSync({ 'readme.txt': strToU8('x') })), /phoneTheme\.ini/)
  await assert.rejects(SsfPackage.open(zipSync({ 'phoneTheme.ini': strToU8('[General]') })), /phoneSkin\.ini/)
  await assert.rejects(SsfPackage.open(zipSync({ 'phoneTheme.ini': strToU8(''), '../1080/phoneSkin.ini': strToU8('') })), /不安全路径/)
})

test('ssf package: the encrypted container opens like the ZIP and is judged by its files', async () => {
  const files = unzipSync(ssfFixture())
  const pkg = await SsfPackage.open(await skinContainer(files))
  assert.deepEqual([...pkg.themes], [['light', '1080/status1/'], ['dark', '1080/status2/']])
  assert.deepEqual([...pkg.files.keys()].sort(), Object.keys(files).sort())
  assert.deepEqual(pkg.file('light', '26keyq.png'), files['1080/status1/26keyq.png'])
  const { bytes } = await convertSsfBytes(await skinContainer(files), 'bds')
  assert.deepEqual(rgb(baiduKeyStyle(SkinArchive.open(bytes), 'light', 'port', 'py_26', 'q').image, 0, 0), COLORS.light.qKey)
  // Windows-style names unpack to the same folders.
  const windows = Object.fromEntries(Object.entries(files).map(([name, body]) => [name.replace(/\//g, '\\'), body]))
  assert.ok((await SsfPackage.open(await skinContainer(windows))).files.has('1080/status1/phoneSkin.ini'))
})

test('ssf package: encrypted PC skins, other versions and damaged containers are rejected', async () => {
  await assert.rejects(SsfPackage.open(await skinContainer({ 'skin.ini': strToU8('[General]') })), /电脑版/)
  await assert.rejects(SsfPackage.open(await skinContainer({ 'skin.ini': strToU8('') }, { version: 2 })), /版本/)
  await assert.rejects(SsfPackage.open(new Uint8Array([...strToU8('Skin'), 3, 0, 0, 0])), /版本/)
  const broken = await skinContainer({ 'phoneTheme.ini': strToU8('') })
  broken[broken.length - 1] ^= 0xff
  await assert.rejects(SsfPackage.open(broken), /已损坏/)
  await assert.rejects(SsfPackage.open(await skinContainer({ '../phoneTheme.ini': strToU8('') })), /不安全路径/)
  await assert.rejects(SsfPackage.open(await skinContainer({ 'a.ini': strToU8(''), 'A.INI': strToU8('') })), /重复/)
  await assert.rejects(SsfPackage.open(await skinContainer({ 'phoneTheme.ini': strToU8('') }, { declared: 1 })), /已损坏/)
})

test('ssf package: reads UTF-16 and GBK INI text', async () => {
  const utf16 = new Uint8Array([0xff, 0xfe, ...[...'[General]\nskin_name=宽字'].flatMap((char) => [char.charCodeAt(0) & 255, char.charCodeAt(0) >> 8])])
  const gbk = new Uint8Array([...strToU8('[General]\nskin_name='), 0xd6, 0xd0, 0xce, 0xc4])
  for (const [theme, name] of [[utf16, '宽字'], [gbk, '中文']]) {
    const pkg = await SsfPackage.open(zipSync({ 'phoneTheme.ini': theme, '1080/phoneSkin.ini': strToU8('') }))
    assert.equal(pkg.info.name, name)
  }
})

test('ssf values: image stretch bands and colours', () => {
  assert.deepEqual(parseSsfImage('a.png,1,97,1,141'), { file: 'a.png', stretch: [1, 97, 1, 141] })
  assert.deepEqual(parseSsfImage('bar.png,0,1,1,0,1,1'), { file: 'bar.png' })
  assert.equal(parseSsfImage('BgCandidate1'), undefined)
  assert.equal(ssfColor('0xFF112233'), 'FF112233')
  assert.equal(ssfColor('0xd79903'), 'FFD79903')
  assert.equal(ssfColor('OXFF9e2720'), undefined)
})

// —— Key table ——

test('key table: boards, Sogou class names and landscape variants', () => {
  assert.equal(ssfBoard('light/skin/port/py_26.ini'), 'py26')
  assert.equal(ssfBoard('py_9_split_left'), 'py9')
  assert.equal(ssfBoard('symbol'), 'other')
  assert.deepEqual(ssfKeyBinding('py_26', 'q', false).sections, ['Key_Q'])
  assert.deepEqual(ssfKeyBinding('py_26', 'h', false).sections, ['Key_H_PY', 'Key_H'])
  assert.deepEqual(ssfKeyBinding('en_26', 's', false).sections, ['Key_S_EN', 'Key_S'])
  assert.deepEqual(ssfKeyBinding('py_26', 'h', true).sections, ['Key_H_Land_PY', 'Key_H_PY_Land', 'Key_H_Land', 'Key_H_PY', 'Key_H'])
  assert.deepEqual(ssfKeyBinding('py_9', 'k', false).sections, ['Key_JKL'])
  assert.deepEqual(ssfKeyBinding('py_9', '0', false, 'Key_0_py9'), { sections: ['Key_0_py9', 'Key_Edits'], defaults: ['KeyBg_Function'], keyClass: 'function' })
  assert.deepEqual(ssfKeyBinding('bh', 'B6', false).sections, ['Key_Wildcard'])
  assert.deepEqual(ssfKeyBinding('num_9', '7', false).sections, ['Key_7'])
  assert.deepEqual(ssfKeyBinding('py_26', 'F36', false), { sections: ['Key_Backspace_Qwerty'], defaults: ['KeyBg_Function_Qwerty', 'KeyBg_Function'], keyClass: 'function' })
  assert.deepEqual(ssfKeyBinding('py_9', 'F38', false).defaults, ['KeyBg_Space'])
  assert.deepEqual(ssfKeyBinding('symbol', '?', false), { sections: [], defaults: ['KeyBg_Default'], keyClass: 'char' })
})

// —— Sogou → BDS / BDI ——

test('ssf → BDS: per-key and shared backgrounds keep their stretch band, per theme', async () => {
  const { archive, warnings } = convertSsfToBaidu(await SsfPackage.open(ssfFixture()), bdsTemplate)
  assert.equal(archive.format, 'bds')
  assert.equal(IniDocument.parse(archive.getText('light/skin/land/gen.ini')).get('PANEL', 'SIZE'), '800,245')
  for (const theme of ['light', 'dark']) {
    const c = COLORS[theme]
    const q = baiduKeyStyle(archive, theme, 'port', 'py_26', 'q')
    assert.deepEqual(rgb(q.image, 0, 0), c.qKey)
    assert.deepEqual(rgb(q.pressed, 0, 0), c.qKeyPressed)
    // Sogou pixels shrink to the 480-wide template (×4/9): 98×142 → 44×63, the band with it.
    assert.deepEqual([q.image.width, q.image.height], [44, 63])
    assert.equal(q.inner, '1,1,42,61')
    assert.deepEqual(rgb(baiduKeyStyle(archive, theme, 'port', 'py_26', 'w').image, 0, 0), c.letterKey)
    assert.deepEqual(rgb(baiduKeyStyle(archive, theme, 'port', 'py_9', 'b').image, 0, 0), c.nineKey)
    assert.deepEqual(rgb(baiduKeyStyle(archive, theme, 'port', 'py_26', 'F36').image, 0, 0), c.functionKey)
    assert.deepEqual(rgb(baiduKeyStyle(archive, theme, 'port', 'py_26', 'F38').image, 0, 0), c.space)
    assert.deepEqual(rgb(baiduKeyStyle(archive, theme, 'land', 'py_26', 'q').image, 0, 0), c.qKey)
  }
  const info = archive.getText('Info.txt')
  assert.match(info, /^Name=测试皮肤$/m)
  assert.match(info, /^Author=测试作者$/m)
  assert.match(info, /^SupportDarkMode=1$/m)
  assert.ok(archive.getBytes('demo.png'))
  assert.ok(!warnings.some((warning) => /anim\.ini/.test(warning)))
  assert.ok(warnings.some((warning) => /webp/.test(warning)))
})

test('ssf → BDS: FG_RECT uses the target key and icons are centred on the key canvas', async () => {
  const { archive } = convertSsfToBaidu(await SsfPackage.open(ssfFixture()), bdsTemplate)
  const fore = baiduKeyStyle(archive, 'light', 'port', 'py_26', 'q', 'FORE_STYLE').image
  // FG_RECT=0,0.25,1,0.75 bounds the middle half of the target's 44×73 key.
  assert.deepEqual([fore.width, fore.height], [44, 73])
  assert.deepEqual(pixel(fore, 0, 16), [0, 0, 0, 0])
  assert.deepEqual(rgb(fore, 22, 36), COLORS.light.qGlyph)
  assert.deepEqual(pixel(fore, 22, 60), [0, 0, 0, 0])
  const icon = baiduKeyStyle(archive, 'light', 'port', 'py_26', 'F36', 'FORE_STYLE').image
  assert.deepEqual([icon.width, icon.height], [44, 63])
  assert.deepEqual(pixel(icon, 0, 0), [0, 0, 0, 0])
  assert.deepEqual(rgb(icon, 22, 32), COLORS.light.icon)
  const document = IniDocument.parse(archive.getText('light/skin/port/py_26.ini'))
  const q = document.sections().find((name) => document.get(name, 'CENTER') === 'q')
  assert.equal(document.get(q, 'FORE_OFFSET'), undefined)
})

test('ssf → BDS: text-drawn keys keep the template glyph in the Sogou label colour', async () => {
  const { archive } = convertSsfToBaidu(await SsfPackage.open(ssfFixture()), bdsTemplate)
  const glyph = baiduKeyStyle(archive, 'light', 'port', 'py_26', 'w', 'FORE_STYLE')
  const opaque = [...Array(glyph.image.width * glyph.image.height).keys()].find((index) => glyph.image.data[index * 4 + 3] > 0)
  assert.ok(opaque !== undefined, '模板字形应有可见像素')
  assert.deepEqual([...glyph.image.data.subarray(opaque * 4, opaque * 4 + 3)], argb(TEXT.light.qwerty))
  const pressedOpaque = [...glyph.pressed.data.subarray(opaque * 4, opaque * 4 + 3)]
  assert.deepEqual(pressedOpaque, argb(TEXT.light.qwertyPressed))
})

test('ssf → BDS: one Sogou background splits into candidate bar and panel', async () => {
  const { archive } = convertSsfToBaidu(await SsfPackage.open(ssfFixture()), bdsTemplate)
  const gen = IniDocument.parse(archive.getText('light/skin/port/gen.ini'))
  const panel = baiduStyleImage(archive, 'light', gen.get('PANEL', 'BACK_STYLE')).image
  assert.deepEqual([panel.width, panel.height], [1080, 846 - 126])
  assert.deepEqual(rgb(panel, 10, 10), COLORS.light.keyboard)
  const candDocument = IniDocument.parse(archive.getText(`light/skin/port/${gen.get('CAND', 'LAYOUT_NAME')}.cnd`))
  const bar = baiduStyleImage(archive, 'light', candDocument.get('CAND', 'BACK_STYLE')).image
  assert.equal(bar.height, 126)
  // 50 % white over the dark strip.
  assert.deepEqual(rgb(bar, 10, 10), COLORS.light.barTop.map((value) => Math.round((255 * 128 + value * 127) / 255)))
  const text = baiduStyleImage(archive, 'light', candDocument.get('CAND', 'FORE_STYLE'))
  assert.equal(text.normalColor, TEXT.light.candidate.slice(2))
  assert.equal(text.pressedColor, TEXT.light.candidateHighlight.slice(2))
  const symbolPanel = IniDocument.parse(archive.getText('light/skin/port/symbol.ini')).get('PANEL', 'BACK_STYLE')
  assert.equal(symbolPanel, gen.get('PANEL', 'BACK_STYLE'), '与通用背景相同的页面跟随新背景')
})

test('ssf → BDS: symbol column and key sounds', async () => {
  const { archive } = convertSsfToBaidu(await SsfPackage.open(ssfFixture()), bdsTemplate)
  const py9 = IniDocument.parse(archive.getText('light/skin/port/py_9.ini'))
  assert.deepEqual(rgb(baiduStyleImage(archive, 'light', py9.get('LIST', 'BACK_STYLE')).image, 0, 0), COLORS.light.codeBack)
  assert.deepEqual(rgb(baiduStyleImage(archive, 'light', py9.get('LIST', 'CELL_STYLE')).image, 0, 0), COLORS.light.codeCell)
  const css = IniDocument.parse(archive.getText('light/skin/res/default.css'))
  const gen = IniDocument.parse(archive.getText('light/skin/port/gen.ini'))
  assert.equal(css.get(`STYLE${gen.get('PANEL', 'SOUND_STYLE')}`, 'PRESS_SOUND_PATH'), 's_code.wav')
  const py26 = IniDocument.parse(archive.getText('light/skin/port/py_26.ini'))
  const backspace = py26.sections().find((name) => py26.get(name, 'CENTER') === 'F36')
  assert.equal(css.get(`STYLE${py26.get(backspace, 'SOUND_STYLE')}`, 'PRESS_SOUND_PATH'), 's_del.wav')
  assert.ok(archive.getBytes('light/skin/res/s_code.wav') && archive.getBytes('light/skin/res/s_del.wav'))
  assert.equal(css.get('GLOBAL', 'STYLE_NUM'), String(css.sections().filter((name) => /^STYLE\d+$/.test(name)).length))
})

test('ssf → BDS: a one-look skin becomes a single-theme package', async () => {
  const { archive } = convertSsfToBaidu(await SsfPackage.open(ssfFixture({ single: true })), bdsTemplate)
  assert.ok(archive.names().some((name) => name.startsWith('light/skin/')))
  assert.ok(!archive.names().some((name) => name.startsWith('dark/skin/')))
  assert.doesNotMatch(archive.getText('Info.txt'), /SupportDarkMode/)
  assert.ok(Object.keys(unzipSync(archive.toBytes())).includes('port/py_26.ini'))
})

test('ssf → BDS: missing images are reported, not fatal', async () => {
  const files = unzipSync(ssfFixture())
  delete files['1080/status1/26keyq.png']
  const { archive, warnings } = convertSsfToBaidu(await SsfPackage.open(zipSync(files)), bdsTemplate)
  assert.ok(warnings.some((warning) => warning.includes('26keyq.png')))
  assert.deepEqual(rgb(baiduKeyStyle(archive, 'light', 'port', 'py_26', 'q').image, 0, 0), COLORS.light.letterKey)
})

test('ssf → BDI and BDS: platform packages that reopen as their format', async () => {
  for (const format of ['bds', 'bdi']) {
    const { bytes } = await convertSsfBytes(ssfFixture(), format)
    const archive = SkinArchive.open(bytes, format)
    assert.equal(archive.format, format)
    assert.deepEqual(rgb(baiduKeyStyle(archive, 'dark', 'port', 'py_26', 'q').image, 0, 0), COLORS.dark.qKey)
    // BDS plays OGG and BDI plays AIFF: the Sogou WAV sounds are re-encoded on the way.
    const sounds = archive.names().filter((name) => /\/res\/s_code\./.test(name))
    assert.ok(sounds.length, `${format} 缺少按键音`)
  }
})

// —— Sogou → BDA ——

function bdaKeyImage(archive, theme, orientation, panel, keyName, which = 'back') {
  const appearance = decodeBdaAppearance(archive.getBytes(`${theme}/skin/${orientation}/appearanceConfig`))
  const key = appearance.panels.get(panel).keys.get(keyName)
  const ref = which === 'back' ? key.backStyle : key.foreStyles[0]
  return { appearance, key, ref, style: ref.type === 'image' ? appearance.imageStyles.get(ref.key) : appearance.textStyles.get(ref.key) }
}

test('ssf → BDA: keys point at new image styles with the Sogou images and stretch bands', async () => {
  const { archive } = convertSsfToBda(await SsfPackage.open(ssfFixture()), bdaTemplate)
  assert.equal(archive.format, 'bda')
  for (const theme of ['light', 'dark']) {
    const { style } = bdaKeyImage(archive, theme, 'port', 'py_26', 'KEY_Q')
    const image = decodePng(archive.getBytes(`${theme}/skin/res/${style.normalImage.resource.resourceID}.png`))
    assert.deepEqual(rgb(image, 0, 0), COLORS[theme].qKey)
    assert.deepEqual(style.normalImage.innerRect, { x: 2, y: 3, width: SIZES.key26[0] - 4, height: SIZES.key26[1] - 6 })
    const fore = bdaKeyImage(archive, theme, 'port', 'py_26', 'KEY_Q', 'fore')
    assert.equal(fore.ref.type, 'image')
    assert.equal(fore.key.foreStyleOffsets.length, 0)
    const text = bdaKeyImage(archive, theme, 'port', 'py_26', 'KEY_W', 'fore')
    assert.equal(text.ref.type, 'text')
    assert.equal(text.style.normalColor, Number.parseInt(TEXT[theme].qwerty, 16))
    assert.equal(text.style.contentText, 'W')
  }
})

test('ssf → BDA: new style keys never collide between orientations, so BDA → BDS keeps them all', async () => {
  const { archive } = convertSsfToBda(await SsfPackage.open(ssfFixture()), bdaTemplate)
  const port = decodeBdaAppearance(archive.getBytes('light/skin/port/appearanceConfig'))
  const land = decodeBdaAppearance(archive.getBytes('light/skin/land/appearanceConfig'))
  for (const group of ['imageStyles', 'textStyles', 'colorStyles']) {
    const shared = [...port[group].keys()].filter((key) => land[group].has(key))
    const differing = shared.filter((key) => JSON.stringify(port[group].get(key)) !== JSON.stringify(land[group].get(key)))
    assert.ok(differing.length <= 1, `${group} 冲突 ${differing.length}`)
  }
  const { warnings } = convertBdaArchive(archive, bdaBase)
  assert.ok(!warnings.some((warning) => /同号样式/.test(warning) && !/有 1 个/.test(warning)), warnings.join('\n'))
})

test('ssf → BDA: panel background, candidate bar and key sounds', async () => {
  const { archive } = convertSsfToBda(await SsfPackage.open(ssfFixture()), bdaTemplate)
  const appearance = decodeBdaAppearance(archive.getBytes('light/skin/port/appearanceConfig'))
  const panel = appearance.panels.get('py_26')
  const back = appearance.imageStyles.get(panel.backStyle.key)
  const image = decodePng(archive.getBytes(`light/skin/res/${back.normalImage.resource.resourceID}.png`))
  assert.deepEqual([image.width, image.height], [1080, 720])
  const bar = appearance.imageStyles.get(panel.cand.candBarStyle.key)
  assert.equal(decodePng(archive.getBytes(`light/skin/res/${bar.normalImage.resource.resourceID}.png`)).height, 126)
  const candidateText = appearance.textStyles.get(panel.cand.cellForeStyle.key)
  assert.equal(candidateText.normalColor, Number.parseInt(TEXT.light.candidate, 16))
  const list = [...appearance.panels.get('py_9').lists.values()][0]
  const listImage = (ref) => decodePng(archive.getBytes(`light/skin/res/${appearance.imageStyles.get(ref.key).normalImage.resource.resourceID}.png`))
  assert.deepEqual(rgb(listImage(list.backStyle), 0, 0), COLORS.light.codeBack)
  assert.deepEqual(rgb(listImage(list.cellBackStyle), 0, 0), COLORS.light.codeCell)
  const sounds = decodeBdaSoundConfig(archive.getBytes('light/skin/port/soundConfig'))
  assert.equal(sounds.keySounds.get('default').resourceID, 's_code.wav')
  assert.equal(sounds.keySounds.get('KEY_F36').resourceID, 's_del.wav')
  assert.ok(archive.getBytes('light/skin/res/s_del.wav'))
  assert.match(archive.getText('Info.txt'), /^AtomSkinName=light,dark$/m)
})

// —— Baidu → Sogou ——

test('BDS/BDI → ssf: toolbar actions keep all seven normal/pressed icons in both themes', async () => {
  const toolbarTemplate = SkinArchive.open(read('../public/sogou-template.bds'))
  const gen = IniDocument.parse(toolbarTemplate.getText('light/skin/port/gen.ini'))
  gen.set('PANEL', 'SIZE', '480,320')
  toolbarTemplate.setText('light/skin/port/gen.ini', gen.toString())
  const files = unzipSync(ssfFixture())
  const names = ['logo.png', 'ime_function_expression.png', 'ime_function_switch.png', 'ime_function_voice.png', 'ime_function_sousou.png', 'ime_function_fanlingxi.png', 'close.png']
  for (const status of ['status1', 'status2']) for (const [index, name] of names.entries()) {
    files[`1080/${status}/${name}`] = encodePng(solid(48, 54, [index + 1, status === 'status1' ? 20 : 40, 60]))
    files[`1080/${status}/${name.replace('.png', '_p.png')}`] = encodePng(solid(48, 54, [index + 1, 80, 100]))
  }
  // A 480-wide source also checks the conversion back to Sogou pixel dimensions.
  const source = convertSsfToBaidu(await SsfPackage.open(zipSync(files)), toolbarTemplate).archive
  for (const theme of ['light', 'dark']) {
    const path = `${theme}/skin/port/cand1.cnd`
    const cand = IniDocument.parse(source.getText(path))
    const fields = ['KEY', 'FORE_STYLE']
    for (const field of fields) {
      const first = cand.get('ICON1', field)
      cand.set('ICON1', field, cand.get('ICON7', field))
      cand.set('ICON7', field, first)
    }
    source.setText(path, cand.toString())
  }
  for (const format of ['bds', 'bdi']) {
    const archive = SkinArchive.open(await source.platformBytesAsync(format, []), format)
    const before = archive.toBytes()
    const { bytes } = await exportSsf(archive)
    const pkg = await SsfPackage.open(bytes)
    const reopened = convertSsfToBaidu(pkg, toolbarTemplate).archive
    for (const theme of ['light', 'dark']) for (const name of names) {
      for (const filename of [name, name.replace('.png', '_p.png')]) {
        const original = decodePng(files[`1080/${theme === 'light' ? 'status1' : 'status2'}/${filename}`])
        const expected = resizeImage(original, 21, 24)
        assertSamePixels(decodePng(pkg.file(theme, filename)), resizeImage(expected, 47, 54), `${format} ${theme} ${filename}`)
      }
      const sourceCand = IniDocument.parse(archive.getText(`${theme}/skin/port/cand1.cnd`))
      const targetCand = IniDocument.parse(reopened.getText(`${theme}/skin/port/cand1.cnd`))
      const action = IniDocument.parse(toolbarTemplate.getText('light/skin/port/cand1.cnd'))
      const targetSection = action.sections().find((section) => action.get(section, 'SSF_IMAGE') === name)
      const sourceSection = sourceCand.sections().find((section) => sourceCand.get(section, 'KEY') === action.get(targetSection, 'KEY'))
      const beforeStyle = baiduStyleImage(archive, theme, sourceCand.get(sourceSection, 'FORE_STYLE'))
      const afterStyle = baiduStyleImage(reopened, theme, targetCand.get(targetSection, 'FORE_STYLE'))
      assertSamePixels(afterStyle.image, beforeStyle.image, `${format} ${theme} ${name} reopened`)
      assertSamePixels(afterStyle.pressed, beforeStyle.pressed, `${format} ${theme} ${name} pressed reopened`)
    }
    assert.deepEqual(archive.toBytes(), before, 'export leaves the source unchanged')
  }
})

test('BDS → ssf → BDS keeps every key look', async () => {
  const first = convertSsfToBaidu(await SsfPackage.open(ssfFixture()), bdsTemplate).archive
  const exported = await convertBaiduToSsf(first)
  assert.deepEqual(exported.warnings, [])
  const pkg = await SsfPackage.open(exported.bytes)
  assert.deepEqual([...pkg.themes], [['light', '1080/status1/'], ['dark', '1080/status2/']])
  assert.equal(pkg.info.name, '测试皮肤')
  const second = convertSsfToBaidu(pkg, bdsTemplate).archive
  for (const theme of ['light', 'dark']) {
    for (const [layout, action] of [['py_26', 'q'], ['py_26', 'w'], ['py_9', 'b'], ['py_26', 'F36'], ['py_26', 'F38'], ['en_26', 'a']]) {
      const before = baiduKeyStyle(first, theme, 'port', layout, action)
      const after = baiduKeyStyle(second, theme, 'port', layout, action)
      assertSamePixels(after.image, before.image, `${theme} ${layout}:${action}`)
      assert.equal(after.inner, before.inner, `${theme} ${layout}:${action} 拉伸区`)
    }
    const fore = baiduKeyStyle(second, theme, 'port', 'py_26', 'q', 'FORE_STYLE').image
    assert.deepEqual(rgb(fore, fore.width >> 1, fore.height >> 1), COLORS[theme].qGlyph)
  }
})

// Sogou's installer (theme.install.checker.e) picks the resolution from directory entries and then
// unpacks only that folder (install.utils.c); without `1080/` it fails, or installs a blank skin.
test('BDS / BDI / BDA → ssf lists every folder as its own entry', async () => {
  const bdsDual = convertSsfToBaidu(await SsfPackage.open(ssfFixture()), bdsTemplate).archive
  for (const [label, bytes] of [
    ['BDS', (await convertBaiduToSsf(bdsTemplate)).bytes],
    ['双外观 BDS', (await convertBaiduToSsf(bdsDual)).bytes],
    ['BDA', (await exportSsf(bdaTemplate, bdaBase)).bytes],
  ]) {
    const names = Object.keys(unzipSync(bytes))
    for (const name of names.filter((entry) => !entry.endsWith('/'))) {
      const parts = name.split('/')
      for (let index = 1; index < parts.length; index++) {
        const folder = `${parts.slice(0, index).join('/')}/`
        assert.ok(names.indexOf(folder) >= 0 && names.indexOf(folder) < names.indexOf(name), `${label}: ${name} 前缺少 ${folder}`)
      }
    }
    assert.ok(names.includes('1080/'), label)
  }
  assert.ok(Object.keys(unzipSync((await convertBaiduToSsf(bdsDual)).bytes)).includes('1080/status2/'))
})

// Sogou reads key text only from text styles (Key_X FG_STYLE → LABEL_STYLE, by default the class
// style), never TEXT_COLOR in Key_X, so a Baidu text layer's colour becomes its class style's.
test('BDS → ssf: key text colours go to the class text style', async () => {
  const files = unzipSync(bdsTemplate.toBytes())
  const document = IniDocument.parse(strFromU8(files['port/py_26.ini']))
  const css = IniDocument.parse(strFromU8(files['res/default.css']))
  css.appendSection('STYLE99003', [{ key: 'NM_COLOR', value: 'ff112233' }, { key: 'HL_COLOR', value: 'ff445566' }])
  for (const action of ['q', 'w', 'e']) {
    const section = document.sections().find((name) => document.get(name, 'CENTER') === action)
    document.set(section, 'FORE_STYLE', [...(document.get(section, 'FORE_STYLE') ?? '').split(',').filter(Boolean), '99003'].join(','))
  }
  files['port/py_26.ini'] = strToU8(document.toString())
  files['res/default.css'] = strToU8(css.toString())
  const skin = (await SsfPackage.open((await convertBaiduToSsf(SkinArchive.open(zipSync(files)))).bytes)).skin('light')
  assert.equal(skin.get('TextStyle_Qwerty', 'TEXT_COLOR'), '0xFF112233')
  assert.equal(skin.get('TextStyle_Qwerty', 'TEXT_COLOR_PRESSED'), '0xFF445566')
  assert.equal(skin.get('Key_Q', 'TEXT_COLOR'), undefined)
})

test('BDS → ssf: background stacking, FORE_OFFSET → FG_RECT and package files', async () => {
  const files = unzipSync(bdsTemplate.toBytes())
  const document = IniDocument.parse(strFromU8(files['port/py_26.ini']))
  const q = document.sections().find((name) => document.get(name, 'CENTER') === 'q')
  document.set(q, 'FORE_OFFSET', '0,-10')
  files['port/py_26.ini'] = strToU8(document.toString())
  const { bytes } = await convertBaiduToSsf(SkinArchive.open(zipSync(files)))
  const pkg = await SsfPackage.open(bytes)
  assert.deepEqual([...pkg.themes], [['light', '1080/']])
  assert.ok(!pkg.files.has('time.ini'))
  const skin = pkg.skin('light')
  const background = decodePng(pkg.file('light', skin.get('RootView', 'BG_IMAGE')))
  assert.deepEqual([background.width, background.height], [1080, 846])
  assert.equal(skin.get('BgCandidate1', 'NORMAL'), 'bar.png')
  const rect = pkg.keys('light').get('Key_Q', 'FG_RECT').split(',').map(Number)
  assert.equal(rect.length, 4)
  assert.ok(rect[1] < 0.5 && rect[3] < 1, rect.join())
  for (const name of ['KeyBg_Default_Latin', 'KeyBg_Default', 'KeyBg_Function_Qwerty', 'KeyBg_Space']) {
    assert.ok(parseSsfImage(skin.get(name, 'NORMAL')), `${name} 缺少图片`)
  }
  // The 480-wide template's glyphs grow to Sogou's 1080-wide pixels (×9/4).
  const glyph = pkg.keys('light').get('Foground_Key_Q', 'NORMAL')
  assert.ok(decodePng(pkg.file('light', glyph)).height > 73, '字形应放大到搜狗像素')
  assert.equal(skin.get('CandidateCodeView', 'BG_IMAGE'), 'BgCodeView')
  assert.ok(parseSsfImage(skin.get('BgCodeView', 'NORMAL')))
  assert.match(new TextDecoder().decode(pkg.files.get('phoneTheme.ini')), /^skin_name=default$/m)
})

test('BDA → ssf goes through the official BDS base and keeps the panel background', async () => {
  const { bytes, warnings } = await exportSsf(bdaTemplate, bdaBase)
  assert.deepEqual(warnings, [])
  const pkg = await SsfPackage.open(bytes)
  const skin = pkg.skin('light')
  assert.ok(skin.get('RootView', 'BG_IMAGE'))
  assert.ok(pkg.skin('light').sections().includes('Key_Q'))
  await assert.rejects(exportSsf(bdaTemplate, undefined), /基础布局/)
})

test('BDA → BDS keeps portrait styles when landscape exists', () => {
  const portrait = decodeBdaAppearance(bdaTemplate.getBytes('light/skin/port/appearanceConfig'))
  const { archive } = convertBdaArchive(bdaTemplate, bdaBase)
  const css = new Set(IniDocument.parse(archive.getText('light/skin/res/default.css')).sections())
  const missing = [...portrait.imageStyles.keys()].filter((key) => !css.has(`STYLE${1_000_000 + key}`))
  assert.deepEqual(missing, [])
})

test('ssf → BDS: an extreme FG_RECT stays inside the target key without a giant canvas', async () => {
  const files = unzipSync(ssfFixture())
  const keys = IniDocument.parse(strFromU8(files['1080/status1/keys.ini']))
  keys.set('Key_Q', 'FG_RECT', '0,0,0.001,0.001')
  files['1080/status1/keys.ini'] = strToU8(keys.toString())
  const { archive } = convertSsfToBaidu(await SsfPackage.open(zipSync(files)), bdsTemplate)
  const fore = baiduKeyStyle(archive, 'light', 'port', 'py_26', 'q', 'FORE_STYLE').image
  assert.deepEqual([fore.width, fore.height], [44, 73])
  assert.equal(fore.data.filter((value, index) => index % 4 === 3 && value > 0).length, 1)
  keys.set('Key_Q', 'FG_RECT', '0,0,-1,0.5')
  files['1080/status1/keys.ini'] = strToU8(keys.toString())
  const invalid = convertSsfToBaidu(await SsfPackage.open(zipSync(files)), bdsTemplate).archive
  const fallback = baiduKeyStyle(invalid, 'light', 'port', 'py_26', 'q', 'FORE_STYLE').image
  assert.deepEqual([fallback.width, fallback.height], [44, 40])
})

test('ssf → BDS: sound names cannot leave the res folder', async () => {
  const files = unzipSync(ssfFixture())
  files['default/sound_android.ini'] = strToU8('[Key]\nsound=sub/s_code\n')
  files['default/sub/s_code.wav'] = files['default/s_code.wav']
  const { archive } = convertSsfToBaidu(await SsfPackage.open(zipSync(files)), bdsTemplate)
  assert.ok(archive.getBytes('light/skin/res/s_code.wav'))
  assert.ok(!archive.names().some((name) => name.includes('sub/')))
})

test('BDS → ssf: the OGG key sound becomes WAV and a SOURCE_RECT past its atlas is clipped', async () => {
  const files = unzipSync(bdsTemplate.toBytes())
  const gen = IniDocument.parse(strFromU8(files['port/gen.ini']))
  const css = IniDocument.parse(strFromU8(files['res/default.css']))
  css.appendSection('STYLE99999', [{ key: 'PRESS_SOUND_PATH', value: '../click.ogg' }])
  gen.set('PANEL', 'SOUND_STYLE', '99999')
  files['port/gen.ini'] = strToU8(gen.toString())
  files['res/default.css'] = strToU8(css.toString())
  files['res/click.ogg'] = read('./fixtures/click.ogg')
  // Point the q key's background at a slice reaching far outside its atlas.
  const py26 = IniDocument.parse(strFromU8(files['port/py_26.ini']))
  const q = py26.sections().find((name) => py26.get(name, 'CENTER') === 'q')
  const [image] = css.get(`STYLE${py26.get(q, 'BACK_STYLE')}`, 'NM_IMG').split(',')
  files[`res/${image}.til`] = strToU8('[GLOBAL]\nTILE_NUM=1\n\n[IMG1]\nSOURCE_RECT=0,0,99999,99999\n')
  const { bytes, warnings } = await convertBaiduToSsf(SkinArchive.open(zipSync(files)))
  assert.deepEqual(warnings, [])
  const pkg = await SsfPackage.open(bytes)
  const wav = pkg.files.get('default/click.wav')
  assert.equal(strFromU8(wav.subarray(0, 4)), 'RIFF')
  assert.ok(wav.length > 44)
  assert.match(strFromU8(pkg.files.get('default/sound_android.ini')), /^sound=click$/m)
  const atlas = decodePng(files[`res/${image}.png`])
  const back = decodePng(pkg.file('light', parseSsfImage(pkg.skin('light').get(pkg.skin('light').get('Key_Q', 'BG_IMAGES'), 'NORMAL')).file))
  assert.deepEqual([back.width, back.height], [atlas.width, atlas.height])
})

test('ssf files are recognised by content when the path has no extension', async () => {
  assert.ok(looksLikeSsf(ssfFixture()))
  assert.ok(looksLikeSsf(await skinContainer({ 'skin.ini': strToU8('') })))
  assert.ok(!looksLikeSsf(bdsTemplate.toBytes()))
  assert.ok(!looksLikeSsf(new Uint8Array([1, 2, 3])))
})

// —— Real skins (local only: third-party skins are not committed) ——

const realDir = process.env.SSF_SAMPLES_DIR ?? '/Users/kaze/work/ssf'
const realSkins = existsSync(realDir) ? readdirSync(realDir).filter((name) => name.endsWith('.ssf')) : []

test('real Sogou skins convert to every format and back', { skip: realSkins.length ? false : `没有 ${realDir}` }, async () => {
  for (const name of realSkins) {
    const bytes = new Uint8Array(readFileSync(join(realDir, name)))
    for (const format of ['bds', 'bdi', 'bda']) {
      const { bytes: converted, warnings } = await convertSsfBytes(bytes, format)
      assert.ok(!warnings.some((warning) => /缺少图片|无法解码/.test(warning)), `${name} → ${format}: ${warnings.join('；')}`)
      const archive = SkinArchive.open(converted, format)
      const back = await exportSsf(archive, bdaBase)
      assert.ok(!back.warnings.some((warning) => /没有可转换的键盘背景/.test(warning)), `${name} ${format} → ssf: ${back.warnings.join('；')}`)
      await SsfPackage.open(back.bytes)
    }
  }
})
