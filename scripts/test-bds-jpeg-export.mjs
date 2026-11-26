import assert from 'node:assert/strict'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { bdsFixture } from '../tests/helpers/baidu-fixture.mjs'
import { acceptAskDialogs } from '../tests/helpers/ask-dialogs.mjs'
import { IniDocument } from '../src/ini.ts'
import { SkinArchive } from '../src/skin.ts'
import { decodePng } from '../src/ssf/ssf-png.ts'

const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } })
await server.listen()
let browser
try {
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await acceptAskDialogs(page)
  await page.addInitScript(() => {
    localStorage.setItem('onboarding-tour-v1', 'done')
    window.showSaveFilePicker = async ({ suggestedName }) => ({
      name: suggestedName,
      createWritable: async () => ({ write: async bytes => { window.exported = Array.from(bytes) }, close: async () => {} }),
    })
  })
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  const jpeg = Uint8Array.from(await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 10
    const context = canvas.getContext('2d')
    context.fillStyle = '#808080'
    context.fillRect(0, 0, 10, 10)
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg'))
    return Array.from(new Uint8Array(await blob.arrayBuffer()))
  }))
  const files = unzipSync(bdsFixture())
  files['light/res/bg.png'] = jpeg
  files['light/res/bg.til'] = strToU8('[IMG1]\nSOURCE_RECT=0,0,10,10\n')
  const css = IniDocument.parse(new TextDecoder().decode(files['light/res/default.css']))
  css.set('STYLE6', 'NM_IMG', 'bg,1')
  files['light/res/default.css'] = strToU8(css.toString())
  await page.locator('#browser-open').setInputFiles({ name: 'jpeg-background.bds', mimeType: 'application/octet-stream', buffer: Buffer.from(zipSync(files)) })
  await page.waitForFunction(() => !document.querySelector('#save').disabled && !document.querySelector('#file-operation-dialog').open)
  await page.locator('#workspace-export').click()
  const share = page.locator('#share-dialog')
  await share.locator('input[value="bdi"]').check()
  await share.locator('#share-export').click()
  const operation = page.locator('#file-operation-dialog')
  const prompt = operation.getByRole('button', { name: '保存', exact: true })
  const settled = page.waitForFunction(() => /另存为(完成|未完成)/.test(document.querySelector('#file-operation-title').textContent))
  if (await Promise.race([settled.then(() => false), prompt.waitFor().then(() => true)])) await prompt.click()
  await settled
  assert.equal(await operation.locator('#file-operation-title').textContent(), '另存为完成', await operation.locator('#file-operation-result').textContent())

  const archive = SkinArchive.open(Uint8Array.from(await page.evaluate(() => window.exported)), 'bdi')
  const read = path => IniDocument.parse(archive.getText(`light/skin/${path}`))
  const { width, height } = decodePng(archive.getBytes('light/skin/res/bg.png'))
  assert.deepEqual([width, height], [10, 10])
  const back = read('port/logo.ini').get('PANEL', 'BACK_STYLE')
  assert.equal(read('res/default.css').get(`STYLE${back}`, 'NM_COLOR'), '808080')
  assert.deepEqual(archive.getBytes('light/skin/res/btn.png'), files['light/res/btn.png'])
  const original = await page.evaluate(async () => {
    const { appState } = await import('/src/app/state.ts')
    return Array.from(appState.archive.getBytes('light/skin/res/bg.png'))
  })
  assert.deepEqual(original, Array.from(jpeg), 'conversion does not change the open BDS')
  console.log('PASS: BDS → BDI Save As handles a JPEG candidate background without changing the source')
} finally {
  await browser?.close()
  await server.close()
}
