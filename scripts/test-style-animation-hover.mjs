// 动画样式卡片（DESIGN.md §10）：悬停时在画布上播放它；旧版按键按下时，动画样式引用的粒子从按键上发射。
import assert from 'node:assert/strict'
import { strToU8, strFromU8, unzipSync, zipSync } from 'fflate'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { bdsFixture } from '../tests/helpers/baidu-fixture.mjs'

const files = unzipSync(bdsFixture())
const skin = zipSync({
  ...files,
  'light/port/py_26.ini': strToU8(strFromU8(files['light/port/py_26.ini'])
    .replace('NO_BLUR=1', 'NO_BLUR=1\nANIM_STYLE=8')
    .replace('CENTER=q', 'CENTER=q\nBACK_ANIM_STYLE=7')),
  'light/res/default.css': strToU8(`${strFromU8(files['light/res/default.css'])}\n[STYLE7]\nPRESS_ANIM=2\n[STYLE8]\nPRESS_ANIM=2\n`),
  'light/res/anim.ini': strToU8([
    '[ANIM2]', 'CATEGORY=3', 'TYPE=0', 'PARTICLE_IMAGE=2', 'TOTAL_NUMBER=10', 'BIRTH_RATE=20', 'LIFE=300,600',
    'EMIT_REGION=0,0,1,1', 'VELOCITY=50,100', 'VELOCITY_DIRECTION=0,360',
  ].join('\n')),
})
const server = await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'error', server: { port: 41863, strictPort: false, host: '127.0.0.1', hmr: false } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const state = () => page.evaluate(async () => {
  const { preview } = await import('/src/app/canvas-interaction.ts')
  return { panelStartedAt: preview.legacyPanelAnimationStartedAt, pressed: preview.legacyAnimationState?.key.section }
})

try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.locator('#browser-open').setInputFiles({ name: 'hover.bds', mimeType: 'application/octet-stream', buffer: Buffer.from(skin) })
  await page.waitForFunction(() => !document.querySelector('#open').disabled)
  const close = page.locator('#file-operation-dialog[open] #file-operation-close')
  if (await close.isVisible()) await close.click()
  await page.evaluate(async () => (await import('/src/app/navigation.ts')).selectFile('light/skin/port/py_26.ini'))

  // 悬停面板的整体动画样式：没有按键用它，面板重新播放。
  const card = page.locator('#document-fields [data-document-key="ANIM_STYLE"] .style-reference-input')
  await card.waitFor()
  const before = (await state()).panelStartedAt
  await page.waitForTimeout(20)
  await card.hover()
  assert.ok((await state()).panelStartedAt > before, '悬停后面板重新播放')

  // 按键按下：BACK_ANIM_STYLE 引用的粒子让按键动画持续到粒子消失，并从按键上发射。
  const frames = await page.evaluate(async () => {
    const { preview } = await import('/src/app/canvas-interaction.ts')
    const key = preview.keys.find((candidate) => candidate.section === 'KEY1')
    await preview.playAnimation(key)
    await new Promise((resolve) => setTimeout(resolve, 200))
    return preview.legacyAnimationState?.key.section
  })
  assert.equal(frames, 'KEY1', '粒子还在发射时按键动画没有结束')
  assert.deepEqual(errors, [])
  console.log('style animation hover: panel replay on hover and key-press particles passed')
} finally {
  await browser.close()
  await server.close()
}
