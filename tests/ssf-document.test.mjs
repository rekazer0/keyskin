// A Sogou skin opened as an editor document: its own files, saved in place, drawn on the official
// skeleton (a package of its own, never part of the document), and converted to Baidu only on export.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { IniDocument } from '../src/ini.ts'
import { SkinArchive } from '../src/skin.ts'
import { AtlasResolver } from '../src/atlas.ts'
import { parseZip } from '../src/skin-zip.ts'
import { documentPackage, ssfDocumentBytes, ssfSkeleton } from '../src/ssf/ssf-convert.ts'
import { ssfToBaiduFiles } from '../src/ssf/ssf-to-baidu.ts'
import { exportFormatFromPath } from '../src/export.ts'
import { decodePng, encodePng } from '../src/ssf/ssf-png.ts'
import { SIZES, skinContainer, solid, ssfFixture } from './helpers/ssf-fixture.mjs'

const template = SkinArchive.open(new Uint8Array(readFileSync(new URL('../public/default-template.bds', import.meta.url))))
const sogouTemplate = SkinArchive.open(new Uint8Array(readFileSync(new URL('../public/sogou-template.bds', import.meta.url))))
const open = async (bytes) => SkinArchive.open(await ssfDocumentBytes(bytes), 'ssf')
/** The Baidu skin an export starts from: the skin's look painted onto the skeleton at its resolution. */
const converted = (archive, base) => {
  const pkg = documentPackage(archive)
  return ssfToBaiduFiles(pkg, base, Number(pkg.resolution))
}
const skeleton = (archive, base) => ssfSkeleton(documentPackage(archive), base)
const ini = (archive, path) => IniDocument.parse(archive.getText(path))

test('ssf document: opens as its own format with the package paths as they are', async () => {
  const archive = await open(ssfFixture())
  assert.equal(archive.format, 'ssf')
  assert.ok(archive.names().includes('1080/status1/phoneSkin.ini'))
  assert.equal(`${documentPackage(archive).folder('light')}phoneSkin.ini`, '1080/status1/phoneSkin.ini')
  assert.equal(exportFormatFromPath('a/皮肤.ssf'), 'ssf')
  assert.equal(exportFormatFromPath('皮肤.MSSF'), 'ssf')
  // Detected from the files alone too, e.g. a content:// URI without a name.
  assert.equal(SkinArchive.open(ssfFixture()).format, 'ssf')
})

test('ssf document: a ZIP is kept byte for byte, an encrypted container becomes a ZIP, PC skins are refused', async () => {
  const zip = ssfFixture()
  assert.deepEqual(await ssfDocumentBytes(zip), zip)
  const fromContainer = await ssfDocumentBytes(await skinContainer(unzipSync(zip)))
  const files = Object.keys(unzipSync(fromContainer))
  assert.deepEqual(files.filter((name) => !name.endsWith('/')).sort(), Object.keys(unzipSync(zip)).sort())
  // Sogou's installer finds the resolution folder only through its directory entry.
  assert.ok(files.includes('1080/'))
  await assert.rejects(ssfDocumentBytes(zipSync({ 'skin.ini': strToU8('[General]') })), /电脑版/)
})

test('ssf document: saving rewrites only the edited entry', async () => {
  const original = ssfFixture()
  const archive = await open(original)
  const path = '1080/status1/phoneSkin.ini'
  const skin = IniDocument.parse(archive.getText(path))
  skin.set('TextStyle_Candidate', 'TEXT_COLOR', '0xFF123456')
  archive.setText(path, skin.toString())
  assert.deepEqual([...archive.changed], [path])
  const saved = archive.toBytes('ssf')
  const before = new Map(parseZip(original).entries.map((entry) => [entry.name, entry.local]))
  for (const entry of parseZip(saved).entries) {
    if (entry.name === path) assert.match(strFromU8(unzipSync(saved)[path]), /0xFF123456/)
    else assert.deepEqual(entry.local, before.get(entry.name), entry.name)
  }
  archive.markSaved(saved)
  assert.equal(archive.changed.size, 0)
  assert.equal(archive.format, 'ssf')
})

test('ssf document: the skeleton is a package of its own; the document holds only the skin\'s files', async () => {
  const archive = await open(ssfFixture())
  const names = archive.names()
  const boards = skeleton(archive, template)
  // The canvas reads the skeleton only; the skin's styles stay in its own files.
  assert.ok(!boards.names().some((path) => /\/res\/ssf\d+\.png$/.test(path)))
  assert.equal(ini(boards, 'light/skin/port/gen.ini').get('PANEL', 'SIZE'), '1080,702')
  const land = ini(boards, 'light/skin/land/gen.ini')
  assert.equal(land.get('PANEL', 'SIZE'), '1920,570')
  assert.equal(land.get('CAND', 'VIEW_RECT'), '0,0,1920,128')
  assert.equal(ini(boards, 'light/skin/land/py_9.ini').get('KEY1', 'VIEW_RECT'), '305,12,398,137')
  assert.ok(boards.isText('light/skin/port/py_26.ini') && boards.isText('dark/skin/port/py_26.ini'))
  // Nothing of the skeleton reaches the document: not its file list, its sources or its saved bytes.
  assert.deepEqual(archive.names(), names)
  assert.ok(!names.some((name) => name.startsWith('light/') || name.startsWith('dark/')))
  assert.equal(archive.changed.size, 0)
  assert.ok(!Object.keys(unzipSync(archive.toBytes('ssf'))).some((name) => name.startsWith('light/')))
  assert.ok(!archive.sourceFiles().some((file) => file.path.startsWith('light/')))
})

test('ssf document: the export skeleton is Sogou\'s own layout, with the skin\'s toolbar icons', async () => {
  const files = unzipSync(ssfFixture())
  files['1080/status1/ime_function_voice.png'] = encodePng(solid(90, 90, [9, 8, 7]))
  files['1080/status1/phoneSkin.ini'] = strToU8(`${strFromU8(files['1080/status1/phoneSkin.ini'])}\n[CandidateIMEFunctionView]\nICON_COLOR=0xFF6F3300\n`)
  const { files: preview } = converted(await open(zipSync(files)), sogouTemplate)
  const read = (path) => IniDocument.parse(strFromU8(preview.get(path)))
  for (const orientation of ['port', 'land']) {
    const [width, height] = read(`light/skin/${orientation}/gen.ini`).get('PANEL', 'SIZE').split(',').map(Number)
    for (const board of ['py_9', 'py_26', 'en_26', 'num_9']) {
      const layout = read(`light/skin/${orientation}/${board}.ini`)
      const keys = layout.sections().filter((section) => /^KEY\d+$/.test(section))
      assert.ok(keys.length > 10 && keys.every((key) => layout.get(key, 'SSF_SECTION')), `${orientation}/${board}`)
      for (const key of keys) {
        const [x, y, w, h] = layout.get(key, 'VIEW_RECT').split(',').map(Number)
        assert.ok(x >= 0 && y >= 0 && x + w <= width && y + h <= height, `${orientation}/${board} ${key} overflows`)
      }
    }
  }
  // Sogou 9-key: symbol column on the left, backspace in the right column.
  const py9 = read('light/skin/port/py_9.ini')
  assert.equal(py9.get('KEY1', 'SSF_SECTION'), 'Key_PunctPY')
  assert.equal(py9.get('KEY4', 'CENTER'), 'F36')
  assert.ok(py9.get('LIST', 'POS'))
  const cand = read('light/skin/port/cand1.cnd')
  const icon = (name) => cand.sections().find((section) => cand.get(section, 'SSF_IMAGE') === name)
  const css = read('light/skin/res/default.css')
  const image = (section) => preview.get(`light/skin/res/${css.get(`STYLE${cand.get(section, 'FORE_STYLE')}`, 'NM_IMG').split(',')[0]}.png`)
  assert.deepEqual(decodePng(image(icon('ime_function_voice.png'))).data.slice(0, 3), Uint8Array.of(9, 8, 7))
  // Icons the skin does not ship keep Sogou's built-in artwork, recoloured to the skin's icon colour.
  const logo = decodePng(image(icon('logo.png')))
  const opaque = [...Array(logo.width * logo.height).keys()].map((i) => logo.data.subarray(i * 4, i * 4 + 4)).filter((p) => p[3] > 0)
  assert.ok(opaque.length && opaque.every((p) => p[0] === 0x6f && p[1] === 0x33 && p[2] === 0))
})

test('ssf document: legacy toolbar logo, symbol text and double-pinyin function keys keep their skin', async () => {
  const files = unzipSync(ssfFixture())
  const skin = IniDocument.parse(strFromU8(files['1080/status1/phoneSkin.ini']))
  skin.appendSection('TextStyle_Text', [
    { key: 'TEXT_COLOR', value: '0xFFFFEADE' },
    { key: 'TEXT_SIZE', value: '0.039' },
    { key: 'TYPEFACE', value: 'symbols.ttf' },
  ])
  files['1080/status1/phoneSkin.ini'] = strToU8(skin.toString())
  files['1080/status1/ime_function_multimedia.png'] = encodePng(solid(78, 78, [70, 80, 90]))
  files['1080/status1/ime_function_multimedia_p.png'] = encodePng(solid(78, 78, [90, 80, 70]))
  files['default/symbols.ttf'] = Uint8Array.of(0, 1, 2, 3)
  const archive = await open(zipSync(files))
  const { files: preview } = converted(archive, sogouTemplate)
  const read = (path) => IniDocument.parse(strFromU8(preview.get(path)))
  const css = read('light/skin/res/default.css')
  for (const orientation of ['port', 'land']) {
    const cand = read(`light/skin/${orientation}/cand1.cnd`)
    const logo = cand.sections().find((section) => cand.get(section, 'SSF_IMAGE') === 'logo.png')
    for (const [state, expected] of [['NM_IMG', [70, 80, 90]], ['HL_IMG', [90, 80, 70]]]) {
      const [name] = css.get(`STYLE${cand.get(logo, 'FORE_STYLE')}`, state).split(',')
      assert.deepEqual([...decodePng(preview.get(`light/skin/res/${name}.png`)).data.slice(0, 3)], expected)
    }
    const py9 = read(`light/skin/${orientation}/py_9.ini`)
    const textStyle = `STYLE${py9.get('LIST', 'FORE_STYLE')}`
    assert.equal(css.get(textStyle, 'NM_COLOR'), 'FFFFEADE')
    assert.equal(css.get(textStyle, 'FONT_SIZE'), '42')
    assert.equal(css.get(textStyle, 'FONT_NAME'), 'symbols.ttf')
    assert.ok(py9.get('LIST', 'CELL_STYLE'))
    for (const board of ['py_9_double_input', 'py_9_big_enter_double_input']) {
      const layout = read(`light/skin/${orientation}/${board}.ini`)
      const keys = layout.sections().filter((section) => /^KEY\d+$/.test(section))
      const space = keys.find((key) => layout.get(key, 'CENTER') === 'F38')
      assert.ok(space, `${orientation}/${board}: missing space action`)
      const base = read(`light/skin/${orientation}/py_9.ini`)
      const baseSpace = base.sections().find((key) => base.get(key, 'CENTER') === 'F38')
      assert.equal(css.get(`STYLE${layout.get(space, 'BACK_STYLE')}`, 'NM_IMG'), css.get(`STYLE${base.get(baseSpace, 'BACK_STYLE')}`, 'NM_IMG'))
      assert.ok(keys.some((key) => layout.get(key, 'CENTER') === "'"))
    }
  }
  const baidu = SkinArchive.fromSourceFiles([...preview].map(([path, data]) => ({ path: path.replace(/^(light|dark)\/skin\//, '$1/'), data })))
  const resolver = new AtlasResolver(baidu, 'light', 'port')
  await resolver.ready()
  const py9 = read('light/skin/port/py_9.ini')
  assert.match(resolver.resolveText(py9.get('LIST', 'FORE_STYLE'), false).fontName, /^BdiEmbeddedFont/)
  assert.deepEqual([...archive.changed], [])
})

for (const [resolution, portSize, landSize, candRect] of [
  [720, '720,468', '1280,380', '0,0,1280,85'],
  [480, '480,312', '854,260', '0,0,854,58'],
]) test(`ssf document: ${resolution} preview uses official Sogou landscape dimensions`, async () => {
  const files = unzipSync(ssfFixture())
  files['time.ini'] = strToU8(`[General]\nSUPPORT_SCREEN=${resolution}\n[${resolution}]\nSTATUS_LIST=status1\n`)
  for (const path of Object.keys(files).filter((name) => name.startsWith('1080/'))) delete files[path]
  for (const [path, bytes] of Object.entries(unzipSync(ssfFixture()))) {
    if (path.startsWith('1080/')) files[path.replace('1080/', `${resolution}/`)] = bytes
  }
  const archive = await open(zipSync(files))
  const boards = skeleton(archive, template)
  assert.equal(ini(boards, 'light/skin/port/gen.ini').get('PANEL', 'SIZE'), portSize)
  const land = ini(boards, 'light/skin/land/gen.ini')
  assert.equal(land.get('PANEL', 'SIZE'), landSize)
  assert.equal(land.get('CAND', 'VIEW_RECT'), candRect)
})

test('ssf document: edits show up in the conversion', async () => {
  const archive = await open(ssfFixture())
  const candidateColor = (files) => {
    const gen = IniDocument.parse(strFromU8(files.get('light/skin/port/gen.ini')))
    const cand = IniDocument.parse(strFromU8(files.get(`light/skin/port/${gen.get('CAND', 'LAYOUT_NAME')}.cnd`)))
    return IniDocument.parse(strFromU8(files.get('light/skin/res/default.css'))).get(`STYLE${cand.get('CAND', 'FORE_STYLE')}`, 'NM_COLOR')
  }
  const path = '1080/status1/phoneSkin.ini'
  const skin = IniDocument.parse(archive.getText(path))
  skin.set('TextStyle_Candidate', 'TEXT_COLOR', '0xFF123456')
  archive.setText(path, skin.toString())
  assert.equal(candidateColor(converted(archive, template).files), 'FF123456')
})

test('ssf document: Baidu and Sogou formats never repackage into each other', async () => {
  const archive = await open(ssfFixture())
  assert.throws(() => archive.toBytes('bds'), /需要经过转换/)
  await assert.rejects(archive.toBytesAsync('bdi'), /需要经过转换/)
  assert.throws(() => template.toBytes('ssf'), /需要经过转换/)
  assert.throws(() => SkinArchive.open(template.toBytes()).toBytes('bda'), /BDA/)
})

test('ssf document: a broken package does not open as a skin, and an explicit Baidu format is never taken for SSF', async () => {
  const files = unzipSync(ssfFixture())
  delete files['phoneTheme.ini']
  assert.throws(() => documentPackage(SkinArchive.open(zipSync(files), 'ssf')), /phoneTheme\.ini/)
  const baidu = unzipSync(template.toBytes())
  baidu['phoneTheme.ini'] = strToU8('[General]')
  assert.equal(SkinArchive.open(zipSync(baidu), 'bds').format, 'bds')
})

test('ssf document: repeated conversions reuse unchanged images but never a replaced one', async () => {
  const archive = await open(ssfFixture())
  const panelPixel = (files) => {
    const gen = IniDocument.parse(strFromU8(files.get('light/skin/port/gen.ini')))
    const css = IniDocument.parse(strFromU8(files.get('light/skin/res/default.css')))
    const [name] = css.get(`STYLE${gen.get('PANEL', 'BACK_STYLE')}`, 'NM_IMG').split(',')
    return [...decodePng(files.get(`light/skin/res/${name}.png`)).data.subarray(0, 3)]
  }
  const first = converted(archive, template).files
  const again = converted(archive, template).files
  assert.deepEqual(panelPixel(again), panelPixel(first))
  archive.setBytes('1080/status1/bg.png', encodePng(solid(...SIZES.background, [9, 8, 7])))
  assert.deepEqual(panelPixel(converted(archive, template).files), [9, 8, 7])
})

// Sogou TEXT_SIZE (a fraction of the screen width up to 1), TYPEFACE and BOLD reach the Baidu styles.
test('ssf conversion: key, candidate and composing text take the skin size, typeface and weight', async () => {
  const files = unzipSync(ssfFixture())
  files['1080/status1/phoneSkin.ini'] = strToU8(strFromU8(files['1080/status1/phoneSkin.ini'])
    .replace('[TextStyle_Qwerty]\n', '[TextStyle_Qwerty]\nTEXT_SIZE=0.05\nTYPEFACE=skin.ttf\nBOLD=true\n')
    .replace('[TextStyle_Candidate]\n', '[TextStyle_Candidate]\nTEXT_SIZE=48\nBOLD=true\n')
    .concat('[TextStyle_Composing]\nTEXT_SIZE=0.03\n'))
  files['default/skin.ttf'] = new Uint8Array([0, 1, 0, 0])
  const { files: preview } = converted(await open(zipSync(files)), sogouTemplate)
  const read = (path) => IniDocument.parse(strFromU8(preview.get(path)))
  const css = read('light/skin/res/default.css')
  const layout = read('light/skin/port/py_26.ini')
  // W has no foreground image, so the template draws its letter as text.
  const w = layout.sections().find((section) => layout.get(section, 'CENTER') === 'w')
  const style = `STYLE${layout.get(w, 'FORE_STYLE').split(',')[0]}`
  assert.equal(css.get(style, 'FONT_SIZE'), '54')
  assert.equal(css.get(style, 'FONT_NAME'), 'skin.ttf')
  assert.equal(css.get(style, 'SSF_BOLD'), '1')
  assert.ok(preview.has('light/skin/res/skin.ttf'))
  const resolver = new AtlasResolver(SkinArchive.open(zipSync({ 'light/skin/res/default.css': strToU8(css.toString()) })), 'light', 'port')
  assert.equal(resolver.resolveText(style.slice(5), false)?.bold, true, 'the canvas draws the label bold')
  const gen = read('light/skin/port/gen.ini')
  const candidates = read(`light/skin/port/${gen.get('CAND', 'LAYOUT_NAME')}.cnd`)
  const candidate = `STYLE${candidates.get('CAND', 'FORE_STYLE')}`
  assert.equal(css.get(candidate, 'FONT_SIZE'), '48')
  assert.equal(css.get(candidate, 'SSF_BOLD'), '1')
  assert.equal(css.get(`STYLE${gen.get('INPUT', 'FORE_STYLE')}`, 'FONT_SIZE'), '32')
})
