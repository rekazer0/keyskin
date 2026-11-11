import test from 'node:test'
import assert from 'node:assert/strict'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { SkinArchive } from '../src/skin.ts'
import { buildSxiZip, buildSxiZipAsync } from '../src/palm/palm-export.ts'
import { encodePng } from '../src/ssf/ssf-png.ts'

// 一张带内边距的按键底图：正常 / 按下两态各一块，用于生成多个烘焙背景。
function keyPng() {
  const data = new Uint8Array(16 * 8 * 4)
  for (let y = 1; y < 7; y++) for (let x = 1; x < 7; x++) {
    data.set([40, 80, 120, 255], (y * 16 + x) * 4)
    data.set([120, 80, 40, 255], (y * 16 + x + 8) * 4)
  }
  return encodePng({ width: 16, height: 8, data })
}

function fixture() {
  const files = { 'Info.txt': 'Name=Async export\n' }
  for (const theme of ['light', 'dark']) {
    files[`${theme}/skin/res/default.css`] = '[STYLE1]\nNM_IMG=key,1\nHL_IMG=key,2\n'
    files[`${theme}/skin/res/key.png`] = keyPng()
    files[`${theme}/skin/res/key.til`] = '[IMG1]\nSOURCE_RECT=0,0,8,8\nINNER_RECT=2,2,4,4\n[IMG2]\nSOURCE_RECT=8,0,8,8\nINNER_RECT=10,2,4,4\n'
    for (const orientation of ['port', 'land']) {
      const keys = Array.from({ length: 12 }, (_, index) => [
        `[KEY${index + 1}]`,
        'BACK_STYLE=1',
        `VIEW_RECT=${(index % 4) * 30},${Math.floor(index / 4) * 24},${20 + index * 2},${16 + index % 3 * 2}`,
        `CENTER=${'qwertyuiopas'[index]}`,
      ].join('\n')).join('\n')
      files[`${theme}/skin/${orientation}/gen.ini`] = '[PANEL]\nSIZE=200,120\n'
      files[`${theme}/skin/${orientation}/py_26.ini`] = keys
    }
  }
  return SkinArchive.open(zipSync(Object.fromEntries(Object.entries(files).map(([path, value]) =>
    [path, typeof value === 'string' ? strToU8(value) : value]))), 'bds')
}

test('async export yields to the event loop and reports increasing progress', async () => {
  let ticks = 0
  const timer = setInterval(() => { ticks += 1 }, 1)
  const reports = []
  let result
  try {
    result = await buildSxiZipAsync(fixture(), async (fraction, detail) => {
      reports.push([fraction, detail])
    })
  } finally {
    clearInterval(timer)
  }
  assert.ok(ticks >= 3, `awaiting the export let the 1ms timer fire ${ticks} times`)
  assert.ok(reports.length >= 3, 'progress is reported through the export')
  assert.equal(reports[0][0], 0)
  assert.equal(reports.at(-1)[0], 1)
  for (let index = 1; index < reports.length; index += 1) {
    assert.ok(reports[index][0] > reports[index - 1][0], `progress increases at report ${index}`)
  }
  assert.ok(reports.every(([, detail]) => typeof detail === 'string' && detail.length > 0), 'every report names the current stage')
})

test('async export writes the same files and skin.json as the sync export', async () => {
  const source = fixture()
  const sync = buildSxiZip(source)
  const asyncResult = await buildSxiZipAsync(source)
  const syncFiles = unzipSync(sync.bytes)
  const asyncFiles = unzipSync(asyncResult.bytes)
  assert.deepEqual(Object.keys(asyncFiles), Object.keys(syncFiles), 'the async export writes the same entry names')
  const decode = (bytes) => JSON.parse(new TextDecoder().decode(bytes))
  assert.deepEqual(decode(asyncFiles['skin.json']), decode(syncFiles['skin.json']), 'the async export writes the same skin.json')
  assert.deepEqual(asyncResult.warnings, sync.warnings)
  for (const path of Object.keys(syncFiles)) {
    assert.deepEqual(asyncFiles[path], syncFiles[path], `same bytes for ${path}`)
  }
})
