import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const server = await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'error', server: { host: '127.0.0.1', port: 41879, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
try {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/picker.html`)
  await page.evaluate(async () => {
    const { styleCard } = await import('/src/style-card.ts')
    const { animationPlayer } = await import('/src/animation-player.ts')
    const { iniPreviewClip } = await import('/src/animation-preview-model.ts')
    const { IniDocument } = await import('/src/ini.ts')
    const clip = () => iniPreviewClip(IniDocument.parse('[ANIM1]\nCATEGORY=0\nTYPE=0\nDURATION=1000\nFROM=100\nTO=100\n'), 'ANIM1')
    const library = document.createElement('div')
    library.id = 'visual-library'
    library.className = 'style-library-grid'
    const list = document.createElement('div')
    list.id = 'visual-list'
    list.className = 'ui-listbox'
    list.dataset.size = 'fill'
    for (const grid of [library, list]) {
      for (let i = 0; i < 6; i++) {
        const card = styleCard({ id: `${grid.id}-${i}`, label: i ? `STYLE${i}` : '动画 1', kind: i ? 'color' : 'anim', kindLabel: i ? '颜色' : '透明度', kindIcon: i ? 'palette' : 'blend',
          info: i ? '样式 INFO' : '真实 INFO：按键轻轻出现，超长说明应该单行省略而非扩张卡片', summary: '1000 ms', animation: () => [animationPlayer({ key: grid.id, clip: clip(), thumbnail: true })] })
        grid.append(card)
      }
    }
    const editor = animationPlayer({ key: 'full-editor', clip: clip() })
    editor.id = 'full-editor'
    document.body.replaceChildren(library, list, editor)
  })
  await page.waitForSelector('.ui-animation-player[data-variant="thumbnail"][data-playing="true"]')
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.appTheme = theme }, theme)
    for (const width of [180, 320, 440, 694, 1000]) {
      await page.setViewportSize({ width, height: 1200 })
      const grids = await page.locator('#visual-library, #visual-list').evaluateAll(grids => grids.map(grid => {
        const styles = getComputedStyle(grid)
        const available = grid.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight)
        const cards = [...grid.children]
        return { available, columns: styles.gridTemplateColumns.split(' ').length, widths: cards.map(card => card.getBoundingClientRect().width), overflow: grid.scrollWidth > grid.clientWidth + 1 }
      }))
      for (const grid of grids) {
        // 卡片最小 160px，随容器拉伸填满每一列（--style-card-width 是最小宽度）。
        const fill = (grid.available - 8 * (grid.columns - 1)) / grid.columns
        assert.ok(grid.widths.every(value => Math.abs(value - fill) < 1 && value >= Math.min(160, grid.available) - 1), `${theme}/${width}: cards fill their column, narrow-container fallback`)
        assert.equal(grid.columns, Math.max(1, Math.floor((grid.available + 8) / 168)), `${theme}/${width}: responsive columns`)
        assert.equal(grid.overflow, false, `${theme}/${width}: no horizontal overflow`)
      }
      const visual = await page.locator('#visual-library .ui-style-card').first().evaluate(card => {
        const subtitle = card.querySelector('.ui-style-card-info')
        const heading = card.querySelector('.ui-style-card-heading')
        const icon = card.querySelector('.ui-style-card-kind > .ui-icon')
        const stage = card.querySelector('.ui-animation-stage')
        return { subtitle: subtitle.textContent, subtitleY: subtitle.getBoundingClientRect().y, headingY: heading.getBoundingClientRect().y, ellipsis: getComputedStyle(subtitle).textOverflow, icon: icon.getBoundingClientRect().width, checker: getComputedStyle(stage).backgroundImage }
      })
      assert.match(visual.subtitle, /^真实 INFO/)
      assert.doesNotMatch(visual.subtitle, /1000 ms/)
      assert.ok(Math.abs(visual.subtitleY - visual.headingY) < 8, 'INFO shares the heading row')
      assert.equal(visual.ellipsis, 'ellipsis')
      assert.equal(visual.icon, 14)
      assert.match(visual.checker, /conic-gradient/)
    }
  }
  await page.setViewportSize({ width: 1000, height: 1200 })
  const sampledWidth = selector => page.locator(selector).evaluate(canvas => {
    const { data, width, height } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
    let left = width, right = 0
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 200) { left = Math.min(left, x); right = Math.max(right, x) }
    }
    return (right - left + 1) / (width / 320)
  })
  const full = await sampledWidth('#full-editor .ui-animation-stage canvas')
  const thumbnail = await sampledWidth('#visual-library .ui-animation-stage canvas')
  assert.ok(full >= 63 && full <= 68, `full editor keeps its 64-unit key: ${full}`)
  assert.ok(thumbnail > full * 1.6, `thumbnail key is larger without changing editor: ${thumbnail}/${full}`)
  const first = page.locator('#visual-library .ui-style-card').first()
  // 列表选中只用 aria-selected（DESIGN §7）。
  await first.evaluate(card => card.setAttribute('aria-selected', 'true'))
  const before = await first.evaluate(card => getComputedStyle(card).backgroundColor)
  await first.hover()
  assert.equal(await first.evaluate(card => getComputedStyle(card).backgroundColor), before, 'selected state survives hover')
  assert.deepEqual(errors, [])
  console.log('animation-card visuals passed: 160px-minimum stretching cards, 1–4 responsive columns, narrow fallback, both themes, INFO on heading row, 14px icons, checkerboard, thumbnail-only zoom, selection state')
} finally { await browser.close(); await server.close() }
