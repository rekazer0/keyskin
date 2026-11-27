import test from 'node:test'
import assert from 'node:assert/strict'
import { zipSync, unzipSync, strToU8 } from 'fflate'
import { SkinArchive } from '../src/skin.ts'
import { completeBdsPackage } from '../src/bds-package.ts'
import { summarizeWarnings } from '../src/export.ts'
import { IniDocument } from '../src/ini.ts'
import { encodePng } from '../src/ssf/ssf-png.ts'
import { declarations, run } from './helpers/app-source.mjs'

test('BDS 导出只解包和写包一次，保留原背景、切片和布局引用', async () => {
  const css = '[GLOBAL]\nSTYLE_NUM=2\n[STYLE1]\nNM_IMG=key,1\n[STYLE2]\nFONT_SIZE=24\n'
  const png = encodePng({ width: 4, height: 4, data: new Uint8Array(64).fill(255) })
  const til = '[IMG1]\nSOURCE_RECT=0,0,4,4\nINNER_RECT=1,1,2,2\n'
  const bytes = zipSync({
    'Info.txt': strToU8('Name=export\n'),
    'light/res/default.css': strToU8(css),
    'light/res/key.png': png,
    'light/res/key.til': strToU8(til),
    'light/port/py_26.ini': strToU8('[KEY1]\nBACK_STYLE=1\nFORE_STYLE=2\nVIEW_RECT=0,0,10,10\n'),
  })
  let opens = 0
  let writes = 0
  const context = run(declarations('exportArchive'), {
    SkinArchive: { open: (...args) => {
      opens++
      const archive = SkinArchive.open(...args)
      const write = archive.toBytesAsync.bind(archive)
      archive.toBytesAsync = (...args) => { writes++; return write(...args) }
      return archive
    } },
    showFileOperationProgress() {}, waitForInterfacePaint: async () => {}, updateFileOperationProgress() {},
    exportArchiveBytes: async () => ({ bytes, converted: false, warnings: [] }),
    summarizeWarnings, logShareExport() {},
    bakeExportedFonts: async (archive) => archive.setText('light/skin/res/default.css', css.replace('FONT_SIZE=24', 'NM_IMG=keyskin_font,1')),
    completeBdsPackage,
    composeAtlasPng: () => assert.fail('无需合图'),
  })
  const result = await context.exportArchive('bds')
  assert.equal(opens, 1)
  assert.equal(writes, 1)
  assert.equal(result.document, bytes)
  assert.deepEqual(result.document, bytes)
  const output = SkinArchive.open(result.bytes, 'bds')
  assert.match(output.getText('light/skin/res/default.css'), /NM_IMG=keyskin_font,1/)
  assert.match(output.getText('light/skin/port/py_26.ini'), /\[CAND\]/)
  assert.equal(IniDocument.parse(output.getText('light/skin/port/py_26.ini')).get('KEY1', 'BACK_STYLE'), '1')
  assert.equal(IniDocument.parse(output.getText('light/skin/res/default.css')).get('STYLE1', 'NM_IMG'), 'key,1')
  assert.deepEqual(output.getBytes('light/skin/res/key.png'), png)
  assert.equal(output.getText('light/skin/res/key.til'), til)
  assert.ok(!output.names().some(path => /\/keyskin_bds_/.test(path)))
  assert.doesNotMatch(new TextDecoder().decode(unzipSync(bytes)['light/res/default.css']), /keyskin_font/)
})
