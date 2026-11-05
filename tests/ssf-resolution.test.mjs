// BDI/BDS exports preserve the actual SSF canvas instead of substituting a Baidu layout.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { strFromU8, strToU8 } from 'fflate'
import { IniDocument } from '../src/ini.ts'
import { adaptPackageSounds } from '../src/sounds.ts'
import { SkinArchive } from '../src/skin.ts'
import { convertSsfDocument, documentPackage, ssfDocumentBytes } from '../src/ssf/ssf-convert.ts'
import { ssfToBaiduFiles } from '../src/ssf/ssf-to-baidu.ts'
import { convertBdaArchive } from '../src/bda-convert.ts'
import { convertSsfToBaidu } from '../src/ssf/ssf-to-baidu.ts'
import { syncKeyStateTips } from '../src/ssf/ssf-state-tips.ts'
import { SsfPackage } from '../src/ssf/ssf-package.ts'
import { ssfFixture } from './helpers/ssf-fixture.mjs'

const read = (path) => new Uint8Array(readFileSync(new URL(path, import.meta.url)))
const bda = SkinArchive.open(read('../public/default-template.bda'), 'bda')
const skeleton = convertBdaArchive(bda, SkinArchive.open(read('../public/bda-base.bds'))).archive
const templates = { bda, sogou: SkinArchive.open(read('../public/sogou-template.bds')) }
const open = async (bytes) => SkinArchive.open(await ssfDocumentBytes(bytes), 'ssf')
const size = (archive, path) => IniDocument.parse(archive.getText(path)).get('PANEL', 'SIZE')
const layouts = (output) => output.names()
  .filter((name) => /\/(?:port|land)\/[^/]+\.ini$/.test(name) && !/\/(?:gen|logo)\.ini$/.test(name))
  .map((name) => [name, IniDocument.parse(output.getText(name))])

test('SSF export uses the Sogou canvas skeleton at 1080', () => {
  assert.equal(size(templates.sogou, 'light/skin/port/gen.ini'), '1080,642')
  assert.equal(size(templates.sogou, 'light/skin/land/gen.ini'), '1920,559')
  const legacy = SkinArchive.open(read('../public/default-template.bds'))
  assert.equal(size(legacy, 'light/skin/port/gen.ini'), '480,312')
})

test('SSF → BDI and BDS reopen with every preview layout, toolbar, image and font unchanged', async () => {
  const fixture = await open(ssfFixture())
  const preview = ssfToBaiduFiles(documentPackage(fixture), templates.sogou, Number(documentPackage(fixture).resolution)).files
  for (const format of ['bdi', 'bds']) {
    const { bytes } = await convertSsfDocument(fixture, format, templates)
    const output = SkinArchive.open(bytes, format)
    for (const theme of ['light', 'dark']) {
      assert.equal(size(output, `${theme}/skin/port/gen.ini`), '1080,642', `${format} ${theme} port`)
      assert.equal(size(output, `${theme}/skin/land/gen.ini`), '1920,570', `${format} ${theme} land`)
      for (const orientation of ['port', 'land']) {
        const directory = `${theme}/skin/${orientation}`
        const gen = IniDocument.parse(output.getText(`${directory}/gen.ini`))
        assert.equal(gen.get('CAND', 'TYPE'), '4', `${format} ${directory}: Baidu candidate type`)
        const candidate = IniDocument.parse(output.getText(`${directory}/${gen.get('CAND', 'LAYOUT_NAME')}.cnd`))
        assert.ok(candidate.sections().includes('CAND'), `${format} ${directory}: candidate layout`)
        assert.ok(gen.get('CAND', 'VIEW_RECT'), `${format} ${directory}: candidate bounds`)
        assert.ok(candidate.sections().includes('SWITCH'), `${format} ${directory}: required toolbar configuration`)
        const css = IniDocument.parse(output.getText(`${theme}/skin/res/default.css`))
        for (const field of ['NML_FONT_STYLE', 'SEL_FONT_STYLE']) for (const color of ['NM_COLOR', 'HL_COLOR']) {
          assert.equal(css.get(`STYLE${candidate.get('SWITCH', field)}`, color), css.get(`STYLE${candidate.get('CAND', 'FORE_STYLE')}`, color))
        }
        const offsets = gen.sections().filter((name) => /^OFFSET\d+$/.test(name))
        assert.ok(offsets.length > 0, `${directory}: language switch label offsets`)
        assert.equal(Number(gen.get('PANEL', 'OFFSET_NUM')), offsets.length)
        for (const [path, document] of layouts(output).filter(([path]) => path.startsWith(`${directory}/`))) {
          assert.ok(!document.entries().some(({ key }) => key === 'FORE_OFFSET'), `${path}: use portable POS_TYPE offsets`)
          for (const { section, value } of document.entries().filter(({ key }) => key === 'POS_TYPE')) {
            assert.equal(value.split(',').length, document.get(section, 'FORE_STYLE').split(',').length, `${path} ${section}`)
            for (const id of value.split(',')) assert.ok(gen.get(`OFFSET${id}`, 'POS'), `${path} ${section}: OFFSET${id}`)
          }
        }
      }
    }
    for (const [path, bytes] of preview) {
      // Both platforms use Baidu's native F14 container; the CND is checked in ssf-native-toolbar.test.mjs.
      if (path.endsWith('.cnd')) continue
      if (/\.(?:ini|cnd)$/.test(path)) {
        const expected = IniDocument.parse(strFromU8(bytes))
        for (const { section, key } of expected.entries()) if (key.startsWith('SSF_')) expected.remove(section, key)
        if (path.endsWith('/gen.ini')) expected.appendSection('LOGO', [{ key: 'LAYOUT_NAME', value: 'logo' }])
        assert.deepEqual(output.getBytes(path), strToU8(expected.toString()), `${format}: ${path}`)
        assert.ok(!output.getText(path).includes('SSF_'), `${path}: editor metadata must not become exported properties`)
      } else if (path.endsWith('/default.css')) {
        // The export only adds the LOGO menu background colour after the canvas styles.
        const added = IniDocument.parse(output.getText(path))
        const id = added.get('GLOBAL', 'STYLE_NUM')
        added.removeSections([`STYLE${id}`])
        added.set('GLOBAL', 'STYLE_NUM', String(Number(id) - 1))
        const expectedFiles = new Map(preview)
        await adaptPackageSounds(expectedFiles, format)
        assert.equal(added.toString(), IniDocument.parse(strFromU8(expectedFiles.get(path))).toString(), `${format}: ${path}`)
      } else if (/\.(?:png|til|ttf)$/.test(path)) assert.deepEqual(output.getBytes(path), bytes, `${format}: ${path}`)
    }
    const toolbar = IniDocument.parse(output.getText('light/skin/port/cand1.cnd'))
    const iconCount = 4
    assert.equal(toolbar.get('CAND', 'ICON_NUM'), String(iconCount))
    for (let i = 1; i <= iconCount; i++) {
      assert.ok(toolbar.get(`ICON${i}`, 'KEY'))
      assert.ok(toolbar.get(`ICON${i}`, 'SIZE'))
    }
    const board = IniDocument.parse(output.getText('light/skin/port/py_9.ini'))
    const portraitWidth = Math.max(...board.sections().filter((name) => /^KEY\d+$/.test(name))
      .map((name) => board.get(name, 'VIEW_RECT').split(',').map(Number)).map(([x, , width]) => x + width))
    assert.ok(portraitWidth > 720 && portraitWidth <= 1080, `${format}: ${portraitWidth}`)
  }
})

test('SSF → BDI and BDS share keys and resources and differ only in each platform\'s toolbar artwork', async () => {
  const fixture = await open(ssfFixture())
  const trees = {}
  for (const format of ['bdi', 'bds']) {
    const { bytes } = await convertSsfDocument(fixture, format, templates)
    const output = SkinArchive.open(bytes, format)
    trees[format] = new Map(output.names()
      .filter((name) => /\.(?:ini|cnd|css|til|png|ttf)$/i.test(name))
      .map((name) => [name, output.getBytes(name)]))
  }
  for (const name of trees.bdi.keys()) if (!trees.bds.has(name)) assert.match(name, /\/res\/logo\/ssf-(?:toolbar|menu)-.*\.png$/)
  for (const [name, bytes] of trees.bds) {
    if (trees.bdi.has(name)) continue
    // Android loads direction-local styles: BDS repeats the shared res/default.css in port/ and land/.
    const shared = name.match(/^(.*\/skin\/)(?:port|land)\/res\/default\.css$/)?.[1]
    if (shared) assert.equal(strFromU8(bytes), strFromU8(trees.bds.get(`${shared}res/default.css`)), name)
    else assert.match(name, /\/res\/logo\/pop_menu_icons\.(?:png|til)$/)
  }
  for (const [name, bytes] of trees.bds) {
    const converted = trees.bdi.get(name)
    if (!converted) continue
    if (name.endsWith('.cnd')) {
      // FIX_SIZE is the iOS-only icon size patch (V6 p158).
      const ios = IniDocument.parse(strFromU8(converted))
      for (const { section, key } of ios.entries()) if (key === 'FIX_SIZE') ios.remove(section, key)
      assert.equal(ios.toString(), strFromU8(bytes), name)
    } else if (name.endsWith('.css')) {
      const normalise = value => strFromU8(value).replace(/(_SOUND_PATH=.+)\.(?:aiff|ogg)$/gm, '$1.native')
      assert.equal(normalise(converted), normalise(bytes), name)
    } else assert.ok(converted.length === bytes.length && converted.every((byte, offset) => byte === bytes[offset]), name)
  }
})

test('SSF → BDS paints the Sogou keyboard background on every board', async () => {
  const { bytes } = await convertSsfDocument(await open(ssfFixture()), 'bds', templates)
  const output = SkinArchive.open(bytes, 'bds')
  for (const theme of ['light', 'dark']) for (const orientation of ['port', 'land']) {
    const panel = IniDocument.parse(output.getText(`${theme}/skin/${orientation}/gen.ini`)).get('PANEL', 'BACK_STYLE')
    assert.ok(panel, `${theme}/${orientation}: no background`)
    assert.match(output.getText(`${theme}/skin/res/default.css`), new RegExp(`\\[STYLE${panel}\\]`))
    for (const [path, document] of layouts(output)) {
      if (!path.startsWith(`${theme}/skin/${orientation}/`) || !document.sections().includes('PANEL')) continue
      assert.equal(document.get('PANEL', 'BACK_STYLE'), panel, path)
    }
  }
})

test('legacy Baidu state TIPs show the painted key, not the skeleton artwork', async () => {
  const { archive: output } = convertSsfToBaidu(await SsfPackage.open(ssfFixture()), skeleton)
  syncKeyStateTips(output)
  let checked = 0
  for (const [path, document] of layouts(output)) {
    const sections = document.sections()
    for (const section of sections.filter((name) => /^KEY\d+$/.test(name))) {
      const states = document.get(section, 'STAT_STYLE')
      if (!states) continue
      for (const match of states.matchAll(/S\d+_(\d+)/g)) {
        const tip = `TIP${match[1]}`
        if (!sections.includes(tip)) continue
        assert.equal(document.get(tip, 'BACK_STYLE'), document.get(section, 'BACK_STYLE'), `${path} ${tip} background`)
        assert.equal(document.get(tip, 'FORE_STYLE'), document.get(section, 'FORE_STYLE'), `${path} ${tip} foreground`)
        assert.equal(document.get(tip, 'FORE_OFFSET'), undefined, `${path} ${tip} offset`)
        checked++
      }
    }
  }
  assert.ok(checked > 0)
})
