import assert from 'node:assert/strict'
import { strToU8, strFromU8, unzipSync, zipSync } from 'fflate'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { bdsFixture } from '../tests/helpers/baidu-fixture.mjs'

const files = unzipSync(bdsFixture())
const text = (path) => strFromU8(files[path])
const keyboard = text('light/port/py_26.ini').replaceAll('BACK_STYLE=2', 'BACK_STYLE=2\nBACK_ANIM_STYLE=7')
const skin = zipSync({
  ...files,
  'light/port/gen.ini': strToU8(text('light/port/gen.ini').replace('BACK_STYLE=1', 'BACK_STYLE=1\nANIM_STYLE=7')),
  'light/port/py_26.ini': strToU8(keyboard),
  'light/port/en_26.ini': strToU8(keyboard.replace('CENTER=q', 'CENTER=a')),
  'light/res/default.css': strToU8(`${text('light/res/default.css')}\n[STYLE7]\nPRESS_ANIM=2\n`),
  'light/res/anim.ini': strToU8('[ANIM2]\nCATEGORY=3\nPARTICLE_IMAGE=2\nTOTAL_NUMBER=3\nBIRTH_RATE=1\nLIFE=1500,1500\nEMIT_REGION=0,0,1,1'),
})
const server = await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'error', server: { port: 41867, strictPort: false, host: '127.0.0.1', hmr: false } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, hasTouch: true })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const state = () => page.evaluate(async () => {
  const { preview } = await import('/src/app/canvas-interaction.ts')
  return { panel: preview.legacyPanelAnimationStartedAt, style: preview.panelAnimationStyle, keys: [...preview.legacyAnimationStates.keys()], starts: Object.fromEntries([...preview.legacyAnimationStates].map(([section, value]) => [section, value.startedAt])) }
})
const open = async (name) => {
  await page.evaluate(async (name) => {
    const { selectFile } = await import('/src/app/navigation.ts')
    selectFile(`light/skin/port/${name}.ini`)
    const { preview } = await import('/src/app/canvas-interaction.ts')
    await preview.whenDrawn()
  }, name)
}
const point = (section) => page.evaluate(async (section) => {
  const { preview } = await import('/src/app/canvas-interaction.ts')
  const key = preview.keys.find((key) => key.section === section)
  const box = preview.canvas.getBoundingClientRect()
  return { x: box.left + (key.rect.x + key.rect.width / 2) / preview.panelWidth * box.width, y: box.top + (key.rect.y + key.rect.height / 2) / preview.surfaceHeight * box.height }
}, section)
const click = async (section, touch = false) => {
  const p = await point(section)
  if (touch) await page.touchscreen.tap(p.x, p.y)
  else await page.mouse.click(p.x, p.y)
}
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.locator('#browser-open').setInputFiles({ name: 'trigger.bds', mimeType: 'application/octet-stream', buffer: Buffer.from(skin) })
  await page.waitForFunction(() => !document.querySelector('#open').disabled)
  const close = page.locator('#file-operation-dialog[open] #file-operation-close')
  if (await close.isVisible()) await close.click()
  await open('py_26')
  assert.deepEqual(await state(), { panel: 0, style: '7', keys: [], starts: {} }, '打开布局不播放，且继承 gen.ini 面板动画')
  await page.waitForTimeout(150)
  assert.equal((await state()).panel, 0, '静置不自动发射')
  // Count actual sprite draw calls, not just the state that schedules them.
  await page.evaluate(async () => {
    const { preview } = await import('/src/app/canvas-interaction.ts')
    const context = preview.canvas.getContext('2d')
    const draw = context.drawImage.bind(context)
    const translate = context.translate.bind(context)
    let origin
    context.translate = (x, y) => { origin = { x, y }; translate(x, y) }
    window.__particleOrigins = []
    window.__particleDraws = 0
    context.drawImage = (...args) => {
      if (args.length === 9 && args[5] < 0 && args[6] < 0) {
        window.__particleDraws++
        window.__particleOrigins.push(origin)
      }
      draw(...args)
    }
  })
  await click('KEY1')
  assert.equal((await state()).panel, 0, '面板按压粒子不在面板原点单独发射')
  assert.deepEqual((await state()).keys, ['KEY1'])
  await page.waitForFunction(() => window.__particleDraws > 0, { timeout: 2000 })
  const drawn = await page.evaluate(async () => {
    const { preview } = await import('/src/app/canvas-interaction.ts')
    const now = Date.now
    try {
      const started = now()
      Date.now = () => started
      preview.legacyAnimationStates.clear()
      const key = preview.keys.find((item) => item.section === 'KEY2')
      await preview.playAnimation(key)
      await preview.whenDrawn()
      window.__particleDraws = 0
      window.__particleOrigins = []
      preview.draw()
      await preview.whenDrawn()
      return { count: window.__particleDraws, origins: window.__particleOrigins, rect: key.rect }
    } finally { Date.now = now }
  })
  assert.equal(drawn.count, 1, '面板与按键重复绑定只绘制一组粒子，不能在 LIST 额外绘制')
  assert.ok(drawn.origins.every(({ x, y }) => x >= drawn.rect.x && x <= drawn.rect.x + drawn.rect.width && y >= drawn.rect.y && y <= drawn.rect.y + drawn.rect.height), '初生粒子中心必须位于点击的 KEY2 内')
  await click('KEY1')
  await click('KEY2')
  assert.deepEqual((await state()).keys.sort(), ['KEY1', 'KEY2'], '连点不同键不互相取消')
  const before = (await state()).starts.KEY1
  await click('KEY1')
  assert.ok((await state()).starts.KEY1 > before, '重复点击从头重播')
  await open('en_26')
  assert.equal((await state()).panel, 0, '切换布局清理发射')
  assert.deepEqual((await state()).keys, [], '切换布局清理旧按键')
  await click('KEY1')
  assert.equal((await state()).panel, 0, '其他布局也由当前按键继承面板粒子')
  assert.deepEqual((await state()).keys, ['KEY1'], '其他布局的按键粒子可点击触发')
  await page.getByRole('button', { name: '编辑模式', exact: true }).click()
  await click('KEY2')
  assert.ok((await state()).keys.includes('KEY2'), '编辑模式也播放按下动画')
  const mouseStart = (await state()).starts.KEY1
  await click('KEY1', true)
  assert.ok((await state()).starts.KEY1 > mouseStart, '触摸点按也播放动画')
  await page.evaluate(async () => {
    const { preview } = await import('/src/app/canvas-interaction.ts')
    preview.setParticlePreview(preview.legacyAnimation.get('7').particles[0])
    preview.restartLegacyPanelAnimation()
  })
  assert.ok((await state()).panel > 0, '显式临时粒子预览仍可播放')
  await click('KEY2')
  assert.equal((await state()).panel, 0, '普通按键停止临时整面板粒子，不向 LIST 串发射')
  assert.ok((await state()).keys.includes('KEY2'), '按键自身的粒子仍播放')
  await page.evaluate(async () => {
    const { preview } = await import('/src/app/canvas-interaction.ts')
    preview.setParticlePreview()
  })
  await open('py_26')
  await page.waitForTimeout(100)
  assert.equal((await state()).panel, 0, '返回布局后仍不自动播放')
  assert.deepEqual(errors, [])
  console.log('preview animation trigger: idle load, inherited panel particles, real sprites, rapid clicks, layout changes, edit clicks and touch taps passed')
} finally {
  await browser.close()
  await server.close()
}
