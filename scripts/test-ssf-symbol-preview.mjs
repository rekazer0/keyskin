import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { IniDocument } from '../src/ini.ts'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { ssfFixture } from '../tests/helpers/ssf-fixture.mjs'
import { acceptAskDialogs } from '../tests/helpers/ask-dialogs.mjs'

const files = unzipSync(ssfFixture())
for (const folder of ['status1', 'status2']) {
  const path = `1080/${folder}/phoneSkin.ini`
  const skin = IniDocument.parse(strFromU8(files[path]))
  const set = (section, key, value) => {
    if (!skin.sections().includes(section)) skin.appendSection(section, [])
    skin.set(section, key, value)
  }
  set('Key_UDSymbol1_Qwerty', 'LABEL', '、')
  set('Key_UDSymbol1_Qwerty', 'FG_STYLE', 'SymbolPreview')
  set('SymbolPreview', 'LABEL_STYLE', 'SymbolText')
  set('SymbolPreview', 'LABEL_POSITION', '0.2,0.3,0.8,0.9')
  set('SymbolText', 'TEXT_SIZE', '0.05')
  set('SymbolText', 'TEXT_COLOR', '0xFF123456')
  set('SymbolText', 'TEXT_COLOR_PRESSED', '0xFF654321')
  set('Key_CommaEn_T', 'ICON', 'transparent.png')
  set('Key_PeriodEn_T', 'FG_STYLE', 'HiddenSymbol')
  set('HiddenSymbol', 'LABEL_VISIBLE', '0')
  files[path] = strToU8(skin.toString())
}
const server = await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'error', server: { host: '127.0.0.1', port: 41843, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, bypassCSP: true })
const errors = []
page.on('pageerror', error => errors.push(error.message))
await acceptAskDialogs(page)
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  const sample = process.env.SSF_SYMBOL_SAMPLE
  await page.locator('#browser-open').setInputFiles({ name: 'symbols.ssf', mimeType: 'application/octet-stream', buffer: sample ? readFileSync(sample) : Buffer.from(zipSync(files)) })
  await page.waitForFunction(() => !document.querySelector('#open').disabled)
  await page.waitForFunction(() => !document.querySelector('#file-operation-dialog')?.open || !document.querySelector('#file-operation-close')?.disabled, null, { timeout: 60000 })
  const close = page.locator('#file-operation-dialog[open] #file-operation-close')
  if (await close.isVisible()) await close.click()
  for (const theme of ['light', 'dark']) for (const orientation of ['port', 'land']) for (const board of ['py_26', 'py_14', 'en_26']) {
    await page.locator(`[data-theme-choice="${theme}"]`).click()
    await page.locator(`[data-orientation-choice="${orientation}"]`).click()
    const result = await page.evaluate(async ({ theme, orientation, board }) => {
      const { selectFile } = await import('/src/app/navigation.ts')
      const { preview } = await import('/src/app/canvas-interaction.ts')
      selectFile(`${theme}/skin/${orientation}/${board}.ini`)
      const built = await preview.sceneForState()
      await preview.whenDrawn()
      return preview.keys.filter(key => ['，', '。', ',', '.'].includes(key.center)).map(key => {
        const item = built.keys.find(item => item.section === key.section)
        const texts = pressed => item.layers(pressed).fore.flatMap(layer => layer.kind === 'text' ? [layer.text] : [])
        return { action: key.center, rect: item.rect, normal: texts(false), pressed: texts(true) }
      })
    }, { theme, orientation, board })
    assert.equal(result.length, 2, `${theme}/${orientation}/${board}: both symbols exist`)
    for (const key of result) {
      const hidden = !sample && board === 'en_26'
      for (const state of ['normal', 'pressed']) {
        assert.equal(key[state].length, hidden ? 0 : 1, `${theme}/${orientation}/${board} ${key.action} ${state}`)
        if (hidden) continue
        const text = key[state][0]
        assert.equal(text.text, !sample && key.action === '，' ? '、' : key.action)
        assert.ok(text.size > 0 && text.x >= key.rect.x && text.x <= key.rect.x + key.rect.width)
        assert.ok(text.y >= key.rect.y && text.y <= key.rect.y + key.rect.height)
        if (!sample && key.action === '，') {
          assert.equal(text.color, state === 'normal' ? 'rgba(18, 52, 86, 1)' : 'rgba(101, 67, 33, 1)')
          assert.ok(Math.abs(text.y - (key.rect.y + key.rect.height * 0.6)) < 0.001)
        }
      }
    }
  }
  if (process.env.SSF_SYMBOL_SCREENSHOT) {
    await page.locator('[data-theme-choice="light"]').click()
    await page.locator('[data-orientation-choice="port"]').click()
    await page.evaluate(async () => {
      const { selectFile } = await import('/src/app/navigation.ts')
      const { preview } = await import('/src/app/canvas-interaction.ts')
      selectFile('light/skin/port/py_26.ini')
      await preview.sceneForState()
      await preview.whenDrawn()
    })
    await page.screenshot({ path: process.env.SSF_SYMBOL_SCREENSHOT })
  }
  assert.deepEqual(errors, [])
  console.log('SSF native symbol preview: pinyin/full, 14-key and English; both themes/orientations/states; labels, placement, colours and hidden artwork passed')
} finally {
  await browser.close()
  await server.close()
}
