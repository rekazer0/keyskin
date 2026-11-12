// Old SSF skins rely on the input method's default labels and icon groups.
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync } from 'node:fs'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { ssfFixture } from '../tests/helpers/ssf-fixture.mjs'

const sample = process.env.SSF_SKIN_PATH
const files = unzipSync(ssfFixture({ single: true }))
files['1080/phoneSkin.ini'] = strToU8(strFromU8(files['1080/phoneSkin.ini']).replace('ICON=transparent.png', '')
  + '\n[General]\nSPACE_ICON_COLOR=0xFF627285,0xFFFFFFFF\n[TextStyle_Space_Label]\nTEXT_COLOR=0xFF123456\n')
const server = await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'error', server: { host: '127.0.0.1', port: 41853, strictPort: false } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, bypassCSP: true })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.locator('#browser-open').setInputFiles({ name: sample?.split('/').pop() ?? '默认前景.ssf', mimeType: 'application/octet-stream', buffer: sample ? readFileSync(sample) : Buffer.from(zipSync(files)) })
  await page.waitForFunction(() => !document.querySelector('#open').disabled)
  const close = page.locator('#file-operation-dialog[open] #file-operation-close')
  if (await close.isVisible()) await close.click()
  for (const orientation of ['port', 'land']) for (const board of ['py_9', 'py_26']) {
    const path = `light/skin/${orientation}/${board}.ini`
    await page.evaluate(async (path) => {
      const { switchSsfPreviewLayout } = await import('/src/app/ssf-preview.ts')
      switchSsfPreviewLayout(path)
    }, path)
    const result = await page.evaluate(async () => {
      const { preview } = await import('/src/app/canvas-interaction.ts')
      const { appState } = await import('/src/app/state.ts')
      const scene = await preview.sceneForState()
      await preview.whenDrawn()
      const foreground = (action, pressed = false) => {
        const key = preview.keys.find((key) => key.center === action)
        return key && scene.keys.find((item) => item.section === key.section).layers(pressed).fore
      }
      const space = (pressed) => {
        const layers = foreground('F38', pressed)
        const image = layers.find((layer) => layer.kind === 'image')
        if (!image) return
        const [x, y, width, height] = image.visual.source
        const canvas = new OffscreenCanvas(width, height)
        const context = canvas.getContext('2d')
        context.drawImage(image.visual.image, x, y, width, height, 0, 0, width, height)
        const { data } = context.getImageData(0, 0, width, height)
        for (let at = 0; at < data.length; at += 4) if (data[at + 3] === 255) return [...data.slice(at, at + 3)]
      }
      return {
        labels: Object.fromEntries(['F40', 'F6', 'F16'].map((action) => [action, foreground(action)?.filter((layer) => layer.kind === 'text').map((layer) => layer.text.text)])),
        space: [space(false), space(true)], changed: [...appState.archive.changed],
      }
    })
    if (board === 'py_9') {
      assert.deepEqual(result.labels.F40, ['重输'], `${path}: clear label`)
      assert.deepEqual(result.labels.F6, ['123'], `${path}: digit label`)
      assert.deepEqual(result.labels.F16, ['中', '/英'], `${path}: switch keeps its own labels`)
    }
    assert.deepEqual(result.space, [[98, 114, 133], [255, 255, 255]], `${path}: microphone state colours`)
    assert.deepEqual(result.changed, [], 'preview keeps original SSF files unchanged')
    if (orientation === 'port' && board === 'py_9') {
      mkdirSync('artifacts/ssf-default-foreground', { recursive: true })
      await page.screenshot({ path: `artifacts/ssf-default-foreground/${sample ? 'blue-classic' : 'fixture'}.png` })
    }
  }
  assert.deepEqual(errors, [])
  console.log(`SSF default foreground: composite labels, space icons and state colours, both boards/orientations, unchanged source passed${sample ? ` (${sample})` : ''}`)
} finally {
  await browser.close()
  await server.close()
}
