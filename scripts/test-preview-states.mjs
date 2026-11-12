import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { strToU8, zipSync } from 'fflate'

const files = {
  'skin/port/gen.ini': '[PANEL]\nSIZE=320,200\n',
  'skin/port/py_26.ini': '[PANEL]\nKEY_NUM=4\n[KEY1]\nVIEW_RECT=0,0,160,200\nCENTER=q\nBACK_STYLE=1\nSTAT_STYLE=S0_1\n[KEY2]\nVIEW_RECT=0,0,160,200\nCENTER=q\nBACK_STYLE=1\n[KEY3]\nVIEW_RECT=160,0,160,200\nCENTER=F39\nBACK_STYLE=2\nSTAT_STYLE=S27_2|S0_1\n[KEY4]\nVIEW_RECT=160,0,160,200\nCENTER=F39\nBACK_STYLE=2\n[TIP1]\nCENTER=F39\nBACK_STYLE=3\n[TIP2]\nCENTER=F39\nBACK_STYLE=4\n',
  'skin/res/default.css': '[STYLE1]\nNM_COLOR=00FF00\nHL_COLOR=00FF00\n[STYLE2]\nNM_COLOR=0000FF\nHL_COLOR=0000FF\n[STYLE3]\nNM_COLOR=FF0000\n[STYLE4]\nNM_COLOR=FFFF00\nHL_COLOR=FFFF00\n',
}
const server = await createServer({ logLevel: 'silent', server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.locator('#browser-open').setInputFiles({ name: 's0-layers.bdi', mimeType: 'application/octet-stream', buffer: Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([path, text]) => [path, strToU8(text)])))) })
  await page.waitForFunction(() => !document.querySelector('#open').disabled && !document.querySelector('.canvas-wrap').classList.contains('empty'))
  await page.locator('#file-operation-dialog').waitFor({ state: 'hidden' })
  await page.evaluate(async () => (await import('/src/app/navigation.ts')).selectFile('light/skin/port/py_26.ini'))
  const inspect = () => page.evaluate(async () => {
    const { preview } = await import('/src/app/canvas-interaction.ts')
    const { appState } = await import('/src/app/state.ts')
    await preview.rendered()
    const canvas = preview.canvas
    const pixel = x => Array.from(canvas.getContext('2d').getImageData(Math.floor(x * canvas.width / preview.panelWidth), Math.floor((100 + preview.panelTopInset) * canvas.height / preview.surfaceHeight), 1, 1).data)
    const box = canvas.getBoundingClientRect()
    return {
      colors: [pixel(80), pixel(240)], revision: appState.archive.revision,
      point: { x: box.left + 80 * box.width / preview.panelWidth, y: box.top + (100 + preview.panelTopInset) * box.height / preview.surfaceHeight },
    }
  })
  const idle = await inspect()
  assert.deepEqual(idle.colors, [[0, 255, 0, 255], [0, 0, 255, 255]], 'S0 layers retain their own backgrounds instead of the red enter TIP')
  await page.getByRole('button', { name: '交互预览', exact: true }).click()
  await page.mouse.click(idle.point.x, idle.point.y)
  await page.waitForFunction(() => document.querySelector('#event-log').textContent.includes('CENTER · q'))
  for (const [state, color] of [['27', [255, 255, 0, 255]], ['0', [0, 0, 255, 255]], ['', [0, 0, 255, 255]]]) {
    await page.locator('#skin-state').selectOption(state, { force: true })
    const current = await inspect()
    assert.deepEqual(current.colors, [[0, 255, 0, 255], color], `state ${state || 'default'} changes only the enter key`)
    assert.equal(current.revision, idle.revision, 'previewing states leaves the archive unchanged')
  }
  assert.deepEqual(errors, [])
  console.log('S0 layers, real key input, S27 and default-state rendering checks passed')
} finally {
  await browser.close()
  await server.close()
}
