import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const server = await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'error', server: { host: '127.0.0.1', port: 41871, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 694, height: 1022 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/picker.html`)
  await page.evaluate(async () => {
    const { styleCard } = await import('/src/style-card.ts')
    const { element, iconButton } = await import('/src/dom-element.ts')
    const { animationPlayer } = await import('/src/animation-player.ts')
    const { iniPreviewClip } = await import('/src/animation-preview-model.ts')
    const { IniDocument } = await import('/src/ini.ts')
    const grid = element('div')
    grid.id = 'card-test-grid'
    Object.assign(grid.style, { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px', padding: '12px' })
    const sound = () => {
      const root = element('span', 'ui-style-sound')
      const info = element('span', 'ui-style-sound-info')
      const name = element('strong')
      name.textContent = 'a_fun.aiff'
      info.append(name)
      root.append(iconButton('play', '试听音效', event => { event.stopPropagation(); root.dataset.playing = String(root.dataset.playing !== 'true') }), info)
      return root
    }
    const doc = IniDocument.parse('[ANIM1]\nCATEGORY=0\nTYPE=3\nDURATION=240\nFROM=50,50\nTO=100,100\n')
    for (const [i, [kind, label, icon]] of [['color', '颜色', 'palette'], ['anim', '动画', 'clapperboard'], ['sound', '音效', 'volume-2'], ['image', '图片', 'image'], ['text', '文字', 'type'], ['empty', '空', 'square-dashed']].entries()) {
      const card = styleCard({
        id: String(i), label: `STYLE${1000 + i}`, kind, kindLabel: label, kindIcon: icon,
        summary: '动画 1 · 缩放',
        animation: () => [0, 1].map(n => animationPlayer({ key: `card-test-${n}`, thumbnail: true, clip: iniPreviewClip(doc, 'ANIM1') })),
        sound: kind === 'sound' || kind === 'text' ? sound : undefined,
        draw: (canvas, pressed) => {
          const ctx = canvas.getContext('2d')
          ctx.fillStyle = getComputedStyle(canvas).getPropertyValue('--secondary')
          if (kind === 'text') { ctx.font = '24px sans-serif'; ctx.fillText('键设 Aa', 24, 52) }
          else ctx.fillRect(16, 16, pressed ? 100 : 120, 56)
        },
      })
      card.addEventListener('click', () => { card.dataset.clicked = 'true' })
      grid.append(card)
    }
    document.body.replaceChildren(grid)
  })
  await page.waitForSelector('.ui-animation-player[data-playing="true"]')
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.appTheme = theme }, theme)
    for (const width of [320, 390, 694]) {
      await page.setViewportSize({ width, height: 1022 })
      const boxes = await page.locator('.ui-style-card').evaluateAll(cards => cards.map(card => {
        const box = card.getBoundingClientRect()
        return { width: Math.round(box.width), height: Math.round(box.height), overflow: [...card.querySelectorAll('.ui-style-preview, .ui-style-state, .ui-animation-stage')].some(el => el.scrollHeight > el.clientHeight + 1), horizontal: card.scrollWidth > card.clientWidth + 1 }
      }))
      assert.equal(new Set(boxes.map(box => box.width)).size, 1, `${theme}/${width}: 等宽`)
      assert.equal(new Set(boxes.map(box => box.height)).size, 1, `${theme}/${width}: 等高`)
      assert.equal(boxes.some(box => box.overflow || box.horizontal), false, `${theme}/${width}: 无溢出`)
      assert.equal(await page.locator('.ui-style-caption').count(), 0)
      const kindColors = await page.locator('.ui-style-card-kind').evaluateAll(items => items.map(el => getComputedStyle(el).color))
      assert.equal(new Set(kindColors).size, 1, '类型标识统一弱化，不使用强调色')
    }
  }
  const soundCard = page.locator('.ui-style-card[data-style-kind="sound"]')
  await soundCard.getByRole('button', { name: '试听音效', exact: true }).click()
  assert.equal(await soundCard.getAttribute('data-clicked'), null, '试听不触发卡片选中')
  const textCard = page.locator('.ui-style-card[data-style-kind="text"]')
  await textCard.focus()
  await page.keyboard.press('Enter')
  assert.equal(await textCard.getAttribute('data-clicked'), 'true', '保留键盘选中')
  assert.deepEqual(errors, [])
  console.log('style-card UI: all six types equal-sized, no overflow at 320/390/694px in both themes; multi-animation, attached sound and keyboard selection passed')
} finally {
  await browser.close()
  await server.close()
}
