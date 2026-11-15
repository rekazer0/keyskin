import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { IniDocument } from '../src/ini.ts'
import { SkinArchive } from '../src/skin.ts'
import { convertSsfDocument, ssfDocumentBytes, ssfSkeleton } from '../src/ssf/ssf-convert.ts'
import { ssfKeyActions } from '../src/ssf/ssf-keymap.ts'
import { SsfPackage } from '../src/ssf/ssf-package.ts'
import { ssfFixture } from './helpers/ssf-fixture.mjs'

const read = path => new Uint8Array(readFileSync(new URL(path, import.meta.url)))
const templates = { sogou: SkinArchive.open(read('../public/sogou-template.bds')), bda: SkinArchive.open(read('../public/default-template.bda'), 'bda') }

test('SSF L_KEY resolves text, built-in digits and functions with landscape precedence', () => {
  const skin = IniDocument.parse('[Key_K]\nL_KEY=Key_1\n[Key_K_Land]\nL_KEY=Key_Custom\n[Key_Custom]\nTEXT=☆\n[Key_J_PY]\nL_KEY=Key_Space\n[Key_Q]\nL_KEY=Key_Unknown\n')
  assert.deepEqual(ssfKeyActions('py_26', 'k', 'Key_K', skin), { UP: '*', LEFT: '*', RIGHT: '*', HOLD: '1' })
  assert.equal(ssfKeyActions('py_26', 'k', 'Key_K', skin, true).HOLD, '☆')
  assert.equal(ssfKeyActions('py_26', 'j', 'Key_J_PY', skin).HOLD, 'F38')
  assert.deepEqual(ssfKeyActions('py_26', 'q', 'Key_Q', skin), { UP: '1', LEFT: '1', RIGHT: '1' })
})

test('SSF preview and packaged BDS/BDI keep skin long presses and every QWERTY swipe', async () => {
  const files = unzipSync(ssfFixture())
  for (const folder of ['status1', 'status2']) {
    const path = `1080/${folder}/phoneSkin.ini`
    files[path] = strToU8(`${strFromU8(files[path])}\n[Key_K]\nL_KEY=Key_1\n[Key_K_Land]\nL_KEY=Key_2\n`)
  }
  const bytes = zipSync(files)
  const pkg = await SsfPackage.open(bytes)
  const source = SkinArchive.open(await ssfDocumentBytes(bytes), 'ssf')
  const archives = [ssfSkeleton(pkg, templates.sogou)]
  for (const format of ['bds', 'bdi']) archives.push(SkinArchive.open((await convertSsfDocument(source, format, templates)).bytes, format))
  const symbols = { py_26: ['1234567890', '~！@#%“”*？', '()-_:;/'], en_26: ['1234567890', "~!@#%'&*?", '()-_:;/'] }
  for (const archive of archives) for (const theme of ['light', 'dark']) for (const orientation of ['port', 'land']) for (const [board, rows] of Object.entries(symbols)) {
    const path = `${theme}/skin/${orientation}/${board}.ini`
    const layout = IniDocument.parse(archive.getText(path))
    for (const [row, letters] of ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'].entries()) for (const [index, letter] of [...letters].entries()) {
      const key = layout.sections().find(section => layout.get(section, 'CENTER') === letter)
      for (const field of ['UP', 'LEFT', 'RIGHT']) assert.equal(layout.get(key, field), rows[row][index], `${archive.format} ${path}: ${letter} ${field}`)
      if (letter === 'k') assert.equal(layout.get(key, 'HOLD'), orientation === 'port' ? '1' : '2', `${archive.format} ${path}: L_KEY`)
    }
  }
})
