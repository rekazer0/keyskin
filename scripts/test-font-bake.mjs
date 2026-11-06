import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { bdsFixture } from '../tests/helpers/baidu-fixture.mjs'

const server = await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'error', server: { host: '127.0.0.1', port: 41871, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage()
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  const progress = await page.evaluate(async (bytes) => {
    const { SkinArchive } = await import('/src/skin.ts')
    const { appState } = await import('/src/app/state.ts')
    const { exportArchive } = await import('/src/app/archive-io.ts')
    const archive = SkinArchive.open(new Uint8Array(bytes), 'bds')
    archive.setText('light/skin/res/default.css', '[GLOBAL]\n[STYLE900]\nSHOW=Test\nFONT_SIZE=24\nFONT_WEIGHT=700\n')
    archive.setText('light/skin/port/py_9.ini', '[KEY1]\nFORE_STYLE=900\n')
    appState.archive = archive
    const seen = []
    let running = true
    const sample = () => {
      if (!running) return
      if (document.querySelector('#file-operation-dialog').open) seen.push(document.querySelector('#file-operation-detail').textContent)
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
    const result = await exportArchive('bdi')
    running = false
    document.querySelector('#file-operation-dialog').close()
    return { seen, css: SkinArchive.open(result.bytes, 'bdi').getText('light/skin/res/default.css') }
  }, [...bdsFixture()])
  assert.ok(progress.seen.includes('正在打包 BDI 皮肤包…'))
  assert.ok(progress.seen.includes('正在把按键文字切成字体图片…'))
  assert.match(progress.css, /BAKED_SHOW=Test/)
  for (const format of ['bdi', 'bds']) {
    const result = await page.evaluate(async ({ bytes, format }) => {
      const { SkinArchive } = await import('/src/skin.ts')
      const { bakeExportedFonts } = await import('/src/app/font-bake-export.ts')
      const archive = SkinArchive.open(new Uint8Array(bytes), 'bds')
      const cssPath = 'light/skin/res/default.css'
      const layoutPath = 'light/skin/port/py_9.ini'
      archive.setText(cssPath, '[GLOBAL]\n[STYLE900]\nSHOW=Test\nFONT_SIZE=24\nFONT_WEIGHT=700\nNM_COLOR=ffffff\n')
      archive.setText(layoutPath, '[KEY1]\nFORE_STYLE=900\n')
      const source = await archive.toBytesAsync(format)
      const baked = await bakeExportedFonts(source, format)
      const opened = SkinArchive.open(baked, format)
      window.fontBakeArchive = opened
      return { format: opened.format, css: opened.getText(cssPath), names: opened.names(), sourceCss: archive.getText(cssPath) }
    }, { bytes: [...bdsFixture()], format })
    assert.equal(result.format, format)
    assert.match(result.css, /BAKED_SHOW=Test/)
    assert.match(result.css, /NM_IMG=keyskin_font,1/)
    assert.match(result.sourceCss, /SHOW=Test/)
    assert.ok(result.names.includes('light/skin/res/keyskin_font.png'))
    assert.ok(result.names.includes('light/skin/res/keyskin_font.til'))

    for (const choice of ['保留图片', '还原文字']) {
      await page.evaluate(() => {
        window.restoreDone = import('/src/app/font-bake-export.ts').then(({ offerBakedFontRestore }) => offerBakedFontRestore(window.fontBakeArchive))
      })
      const dialog = page.locator('dialog[open]').filter({ hasText: '还原按键文字？' })
      await dialog.waitFor()
      assert.match(await dialog.textContent(), new RegExp(`导出 ${format.toUpperCase()} 时会重新切片`))
      await dialog.getByRole('button', { name: choice }).click()
      await page.evaluate(() => window.restoreDone)
      const state = await page.evaluate(() => ({ css: window.fontBakeArchive.getText('light/skin/res/default.css'), names: window.fontBakeArchive.names() }))
      if (choice === '保留图片') assert.match(state.css, /BAKED_SHOW=Test/)
      else {
        assert.match(state.css, /SHOW=Test/)
        assert.doesNotMatch(state.css, /BAKED_SHOW|NM_IMG=keyskin_font/)
        assert.ok(!state.names.includes('light/skin/res/keyskin_font.png'))
        assert.ok(!state.names.includes('light/skin/res/keyskin_font.til'))
      }
    }
  }
} finally {
  await browser.close()
  await server.close()
}
