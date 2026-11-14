import test from 'node:test'
import assert from 'node:assert/strict'
import { zipSync, unzipSync, strToU8 } from 'fflate'
import { SkinArchive } from '../src/skin.ts'
import { bakeBdsBackgrounds } from '../src/bds-backgrounds.ts'
import { completeBdsPackage } from '../src/bds-package.ts'
import { summarizeWarnings } from '../src/export.ts'
import { declarations, run } from './helpers/app-source.mjs'

test('BDS 字体、背景、图集共用一次解包和一次写包，编辑文档保留处理前内容', async () => {
  const bytes = zipSync({
    'Info.txt': strToU8('Name=export\n'),
    'light/res/default.css': strToU8('[GLOBAL]\nSTYLE_NUM=1\n[STYLE1]\nFONT_SIZE=24\n'),
    'light/port/py_26.ini': strToU8('[KEY1]\nFORE_STYLE=1\nVIEW_RECT=0,0,10,10\n'),
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
    summarizeWarnings,
    bakeExportedFonts: async (archive) => archive.setText('light/skin/res/default.css', '[GLOBAL]\nSTYLE_NUM=1\n[STYLE1]\nNM_IMG=keyskin_font,1\n'),
    bakeBdsBackgrounds, completeBdsPackage,
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
  assert.doesNotMatch(new TextDecoder().decode(unzipSync(bytes)['light/res/default.css']), /keyskin_font/)
})
