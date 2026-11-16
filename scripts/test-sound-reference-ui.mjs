import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const server = await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'error', server: { host: '127.0.0.1', port: 41872, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage()
const errors = []
page.on('pageerror', error => errors.push(error.message))
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/picker.html`)
  await page.evaluate(async () => {
    const { styleReferenceCard, soundStyleSample, setSoundSamplePlaying, styleKindIcon } = await import('/src/style-card.ts')
    const { element } = await import('/src/dom-element.ts')
    const root = element('section', 'ui-section')
    window.soundActions = { choose: 0, play: 0, remove: 0, change: 0 }
    for (const [index, value] of ['s_input', '12', 'a_very_long_reference_name_for_overflow_testing', 'missing'].entries()) {
      const name = element('input', index === 1 ? '' : 'ui-style-ref-name')
      name.value = value
      name.setAttribute('aria-label', `引用 ${index}`)
      name.addEventListener('change', () => window.soundActions.change++)
      root.append(styleReferenceCard({
        name, kind: styleKindIcon('sound'),
        states: [{ label: '选择音效', onClick: () => window.soundActions.choose++,
          content: soundStyleSample(`${value}.wav`, index === 3 ? undefined : sample => {
            window.soundActions.play++
            setSoundSamplePlaying(sample, sample.dataset.playing !== 'true')
          }),
        }],
        remove: { label: '移除音效', run: () => window.soundActions.remove++ },
      }))
    }
    const name = element('input')
    name.value = '1'
    root.append(styleReferenceCard({ name, states: [{ label: '图片', content: '图片预览' }] }))
    document.body.replaceChildren(root)
  })
  const cards = page.locator('.ui-style-ref[data-variant="sound"]')
  assert.equal(await cards.count(), 4)
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme })
    await page.evaluate(theme => { document.documentElement.dataset.appTheme = theme }, theme)
    for (const width of [240, 390, 694]) {
      await page.setViewportSize({ width, height: 650 })
      const layout = await page.locator('.ui-style-ref').evaluateAll(cards => cards.map(card => {
        const box = card.getBoundingClientRect()
        return { height: box.height, overflow: card.scrollWidth > card.clientWidth + 1,
          childrenOverflow: [...card.querySelectorAll('.ui-style-sound, .ui-style-sound-info')].some(el => el.scrollWidth > el.clientWidth + 1),
        }
      }))
      assert.equal(new Set(layout.slice(0, 4).map(item => item.height)).size, 1, `${theme}/${width}: 音效引用卡等高`)
      assert.equal(Math.round(layout[0].height), 60, '音效卡采用 Pen 的 60px 高度')
      assert.equal(layout.some(item => item.overflow || item.childrenOverflow), false, `${theme}/${width}: 长名称与缺失提示无溢出`)
    }
    if (process.env.PI_SCRATCH_DIR) {
      mkdirSync(process.env.PI_SCRATCH_DIR, { recursive: true })
      await page.setViewportSize({ width: 390, height: 650 })
      await page.screenshot({ path: `${process.env.PI_SCRATCH_DIR}/sound-reference-${theme}.png` })
    }
  }
  const first = cards.first()
  const name = first.getByRole('textbox')
  await name.click()
  await name.fill('s_click')
  await name.press('Tab')
  assert.equal(await page.evaluate(() => window.soundActions.choose), 0, '编辑名称不打开选择器')
  assert.equal(await page.evaluate(() => window.soundActions.change), 1)
  await first.getByRole('button', { name: '试听', exact: true }).click()
  assert.equal(await first.locator('.ui-style-sound').getAttribute('data-playing'), 'true')
  await first.getByRole('button', { name: '停止试听', exact: true }).click()
  assert.equal(await first.locator('.ui-style-sound').getAttribute('data-playing'), 'false')
  assert.equal(await page.evaluate(() => window.soundActions.choose), 0, '试听不打开选择器')
  await first.locator('.ui-style-state').click({ position: { x: 4, y: 4 } })
  await first.locator('.ui-style-sound-info > strong').click()
  await first.locator('.ui-style-state').focus()
  await page.keyboard.press('Enter')
  assert.equal(await page.evaluate(() => window.soundActions.choose), 3, '卡片空白、文件名与键盘均可打开选择器')
  await first.getByRole('button', { name: '移除音效', exact: true }).focus()
  await page.keyboard.press('Enter')
  assert.equal(await page.evaluate(() => window.soundActions.remove), 1)
  assert.equal(await cards.last().getByRole('button', { name: '试听', exact: true }).isDisabled(), true)
  assert.equal(await cards.last().locator('small').textContent(), '文件缺失')
  assert.deepEqual(errors, [])
  console.log('PASS sound references: unified layout, equal height, light/dark, 240/390/694px, editable names, audition, picker, keyboard, remove and missing files')
} finally {
  await browser.close()
  await server.close()
}
