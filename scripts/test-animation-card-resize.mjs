import assert from 'node:assert/strict'
import { chromium, webkit } from 'playwright'
import { createServer } from 'vite'

const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } })
await server.listen()
try {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1160, height: 680 } })
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/picker.html`)
      await page.evaluate(async () => {
        const { styleCard } = await import('/src/style-card.ts')
        const { animationPlayer } = await import('/src/animation-player.ts')
        const { iniPreviewClip } = await import('/src/animation-preview-model.ts')
        const { IniDocument } = await import('/src/ini.ts')
        const clip = iniPreviewClip(IniDocument.parse('[ANIM1]\nCATEGORY=0\nTYPE=0\nDURATION=400\nFROM=100\nTO=100\n'), 'ANIM1')
        const list = document.createElement('div')
        list.className = 'ui-listbox'
        for (let i = 0; i < 24; i++) list.append(styleCard({ id: String(i), label: `动画 ${i}`, kind: 'anim',
          info: i % 2 ? '动画说明' : undefined, note: '接续 · 2 个子动画 · 400 ms',
          animation: () => [animationPlayer({ key: String(i), clip, thumbnail: true })] }))
        document.body.replaceChildren(list)
      })
      const list = page.locator('.ui-listbox')
      await list.locator('canvas').first().waitFor()
      for (const width of [512, 430, 660, 550, 240, 660, 512]) {
        await page.setViewportSize({ width, height: 680 })
        const cards = await list.locator('.ui-style-card').evaluateAll(cards => cards.map(card => {
          const box = selector => card.querySelector(selector).getBoundingClientRect()
          const preview = box('.ui-style-preview'), caption = box('.ui-style-card-caption'), summary = box('.ui-list-item-meta')
          return { ratioError: preview.height - preview.width * 3 / 4, titleGap: caption.top - preview.bottom,
            summaryGap: summary.top - caption.bottom, bottomGap: card.getBoundingClientRect().bottom - summary.bottom }
        }))
        for (const card of cards) {
          assert.ok(Math.abs(card.ratioError) < 1, `${engine.name()}/${width}: preview keeps its 4:3 ratio`)
          assert.ok(card.titleGap > 0, `${engine.name()}/${width}: preview overlaps the title by ${-card.titleGap}px`)
          assert.ok(card.summaryGap > 0 && card.bottomGap > 0, `${engine.name()}/${width}: summary fits beneath the title`)
        }
      }
      console.log(`PASS ${engine.name()}: animation card previews, titles and summaries fit after resizing`)
    } finally { await browser.close() }
  }
} finally { await server.close() }
