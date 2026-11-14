import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const server = await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'error', server: { host: '127.0.0.1', port: 41873, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage()
const errors = []
page.on('pageerror', error => errors.push(error.message))
await page.addInitScript(() => {
  window.pickerEvents = []
  addEventListener('message', event => { if (event.data?.pickerEvent) window.pickerEvents.push(event.data) })
})
const sounds = ['keyboard_start_sound_with_a_long_name', 's_cands_icon', 's_clear', 's_code', 's_del', 's_enter', 's_fuhao', 's_input', 's_qiehuan', 's_shuzi', 's_space']
const payload = {
  sliceBack: false, editable: true, canAdd: false, soundOnly: true, foreground: false, bda: false,
  kind: 'sound', currentID: 's_input', imagesCompatible: false, bitmaps: {}, animationText: '', animationFiles: {}, particleVisuals: {}, styles: [], images: [],
  sounds: sounds.map((value, index) => ({ styleID: value, label: value, filename: `${value}.wav`, playable: index !== 0, uses: index === 7 ? 3 : 0 })),
}
const send = payload => page.evaluate(payload => window.postMessage({ pickerEvent: 'style-library-data', payload }, location.origin), payload)
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/picker.html`)
  await page.waitForFunction(() => window.pickerEvents.some(item => item.pickerEvent === 'picker-window-ready'))
  await send(payload)
  const cards = page.locator('#style-library-grid > .ui-style-card')
  const preview = page.locator('#style-library-preview')
  await preview.waitFor()
  assert.equal(await page.locator('#style-library-modes').isVisible(), false, '纯音效选择收起不可用的类型切换')
  assert.equal(await page.locator('.style-library-bar').isVisible(), false, '空工具栏不占高度')
  assert.equal(await cards.count(), sounds.length)
  assert.equal(await cards.locator('.ui-style-card-kind').count(), 0, '不重复显示音效类型图标')
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme })
    for (const width of [320, 390, 1100]) {
      await page.setViewportSize({ width, height: 760 })
      await page.locator('#style-library-grid [data-style-id="s_input"]').click()
      const layout = await page.evaluate(() => {
        const preview = document.querySelector('#style-library-preview')
        return {
          pageOverflow: document.documentElement.scrollWidth > innerWidth,
          overflow: [...document.querySelectorAll('.ui-style-card, .ui-style-sound-info, .style-library-preview-info')].some(el => el.scrollWidth > el.clientWidth + 1),
          footerHeight: preview.getBoundingClientRect().height,
          heights: [...document.querySelectorAll('.ui-style-card')].map(el => el.getBoundingClientRect().height),
          buttonInside: [...preview.querySelectorAll('button:not([hidden])')].every(el => {
            const a = el.getBoundingClientRect(), b = preview.getBoundingClientRect()
            return a.left >= b.left && a.right <= b.right && a.bottom <= b.bottom
          }),
        }
      })
      assert.equal(layout.pageOverflow || layout.overflow, false, `${theme}/${width}: 长名称无溢出`)
      assert.equal(layout.buttonInside, true, `${theme}/${width}: 操作不越界`)
      assert.equal(new Set(layout.heights).size, 1, `${theme}/${width}: 缺失音效与正常卡片等高，虚拟滚动行高稳定`)
      assert.ok(layout.footerHeight < (width > 640 ? 80 : 140), `${theme}/${width}: 紧凑预览栏`)
      assert.equal(await preview.locator('.ui-checker').count(), 0, '音效不显示棋盘格')
      assert.equal(await preview.locator('.ui-style-sound-info').isVisible(), false, '底栏文件信息只显示一次')
      if (process.env.PI_SCRATCH_DIR) {
        mkdirSync(process.env.PI_SCRATCH_DIR, { recursive: true })
        await page.screenshot({ path: `${process.env.PI_SCRATCH_DIR}/sound-picker-${theme}-${width}.png` })
      }
    }
  }
  const current = page.locator('#style-library-grid [data-style-id="s_input"]')
  await current.getByRole('button', { name: '试听', exact: true }).click()
  assert.equal(await current.getAttribute('aria-selected'), 'true')
  await page.waitForFunction(() => window.pickerEvents.some(item => item.pickerEvent === 'style-library-play'))
  await page.locator('#resource-search').fill('s_del')
  assert.equal(await cards.count(), 1)
  await cards.first().click()
  await preview.getByRole('button', { name: '应用', exact: true }).click()
  await page.waitForFunction(() => window.pickerEvents.some(item => item.pickerEvent === 'style-library-apply' && item.payload.styleID === 's_del'))
  await page.locator('#resource-search').press('Escape')
  assert.equal(await cards.count(), sounds.length)
  await current.focus()
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.pickerEvents.some(item => item.pickerEvent === 'style-library-apply' && item.payload.styleID === 's_input'))
  await page.keyboard.press('Escape')
  assert.equal(await preview.isVisible(), false)
  // 同一窗口切回普通样式时，恢复工具栏与视觉预览。
  await send({ ...payload, soundOnly: false, kind: 'all', currentID: '12', sounds: [], styles: [
    { styleID: '12', label: '12', kind: 'color', categories: [], compatible: true, imagePaths: [], visuals: [null, null] },
  ] })
  await preview.waitFor()
  assert.equal(await page.locator('#style-library-modes').isVisible(), true)
  assert.equal(await preview.getAttribute('data-variant'), '')
  assert.equal(await preview.locator('.ui-checker').count(), 1)
  assert.deepEqual(errors, [])
  console.log('PASS sound picker: unified cards, compact footer, light/dark, 320/390/1100px, search, audition, apply, keyboard and switching back to visual styles')
} finally {
  await browser.close()
  await server.close()
}
