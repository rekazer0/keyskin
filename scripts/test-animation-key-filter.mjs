// 动效设计 / 粒子设计（DESIGN.md §10）：编辑模式下在画布上选按键（和普通画布一样多选、再点取消），列表筛出它们按下时播放的动画；
// 交互预览里点按键只播放、不筛选。
import assert from 'node:assert/strict'
import { strToU8, strFromU8, unzipSync, zipSync } from 'fflate'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { bdsFixture } from '../tests/helpers/baidu-fixture.mjs'

const files = unzipSync(bdsFixture())
const skin = zipSync({
  ...files,
  'light/port/py_26.ini': strToU8(strFromU8(files['light/port/py_26.ini']).replace('CENTER=q', 'CENTER=q\nBACK_ANIM_STYLE=7')),
  'light/res/default.css': strToU8(`${strFromU8(files['light/res/default.css'])}\n[STYLE7]\nPRESS_ANIM=1\n`),
  'light/res/anim.ini': strToU8([
    '[ANIM1]', 'CATEGORY=0', 'TYPE=1', 'DURATION=200', 'FROM=100,100', 'TO=80,80',
    '[ANIM2]', 'CATEGORY=0', 'TYPE=0', 'DURATION=300', 'FROM=255', 'TO=0',
    '[ANIM3]', 'CATEGORY=3', 'TYPE=0', 'PARTICLE_IMAGE=2', 'TOTAL_NUMBER=10', 'BIRTH_RATE=20', 'LIFE=300,600',
    'EMIT_REGION=0,0,1,1', 'VELOCITY=50,100', 'VELOCITY_DIRECTION=0,360',
  ].join('\n')),
})
const ANIM = 'light/skin/res/anim.ini'
const LAYOUT = 'light/skin/port/py_26.ini'
const server = await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'error', server: { port: 41865, strictPort: false, host: '127.0.0.1', hmr: false } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

const listed = () => page.locator('#animation-library [data-animation-id]').evaluateAll((nodes) => nodes.map((node) => node.dataset.animationId))
const clickKey = async (section, modifiers = []) => {
  const [point, size] = await page.evaluate(async (section) => {
    const { preview } = await import('/src/app/canvas-interaction.ts')
    const key = preview.keys.find((item) => item.section === section)
    return [[key.rect.x + key.rect.width / 2, key.rect.y + key.rect.height / 2], [preview.panelWidth, preview.surfaceHeight]]
  }, section)
  const box = await page.locator('#preview').boundingBox()
  for (const key of modifiers) await page.keyboard.down(key)
  await page.mouse.click(box.x + point[0] / size[0] * box.width, box.y + point[1] / size[1] * box.height)
  for (const key of modifiers) await page.keyboard.up(key)
}
const selectedKeys = () => page.evaluate(async () => [...(await import('/src/app/canvas-interaction.ts')).preview.selected])
const open = async (mode) => {
  await page.evaluate(async ({ path, mode }) => (await import('/src/app/navigation.ts')).selectFile(path, 'overview', mode), { path: ANIM, mode })
  await page.locator('#animation-library [data-animation-id]').first().waitFor()
}

try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.locator('#browser-open').setInputFiles({ name: 'keys.bds', mimeType: 'application/octet-stream', buffer: Buffer.from(skin) })
  await page.waitForFunction(() => !document.querySelector('#open').disabled)
  const close = page.locator('#file-operation-dialog[open] #file-operation-close')
  if (await close.isVisible()) await close.click()
  await page.evaluate(async (path) => (await import('/src/app/navigation.ts')).selectFile(path), LAYOUT)
  await open('motion')
  assert.deepEqual(await listed(), ['ANIM1', 'ANIM2'])

  // 交互预览：点按键只播放，不筛选。
  await clickKey('KEY1')
  assert.equal(await page.locator('.animation-key-filter').count(), 0)

  // 编辑模式：点按键筛出它播放的动画，右侧显示第一个。
  await page.getByRole('button', { name: '编辑模式', exact: true }).click()
  await clickKey('KEY1')
  await page.locator('.animation-key-filter').waitFor()
  assert.deepEqual(await listed(), ['ANIM1'])
  assert.equal(await page.locator('.animation-library-count').textContent(), '1 / 2 个', '按键筛选时头部显示筛出 / 总数')
  assert.equal(await page.locator('#animation-library [aria-selected="true"]').getAttribute('data-animation-id'), 'ANIM1')
  assert.deepEqual(await selectedKeys(), ['KEY1'], '按键在画布上标为选中')

  // 再点一次取消选中；⌘ 点两个按键多选。
  await clickKey('KEY1')
  await page.locator('.animation-key-filter').waitFor({ state: 'detached' })
  assert.deepEqual(await selectedKeys(), [])
  await clickKey('KEY1')
  await clickKey('KEY2', ['Meta'])
  await page.locator('.animation-key-filter').getByRole('button', { name: '2 个按键 的动效', exact: true }).waitFor()
  assert.deepEqual(await selectedKeys(), ['KEY1', 'KEY2'])
  assert.deepEqual(await listed(), ['ANIM1'], '多选时列出任一按键播放的动画')
  await clickKey('KEY2', ['Meta'])
  await page.locator('.animation-key-filter').getByRole('button', { name: '按键 1 的动效', exact: true }).waitFor()

  // 「全部」里可以挑别的动画看它的预览。
  await page.locator('.animation-key-filter').getByRole('button', { name: '全部', exact: true }).click()
  assert.deepEqual(await listed(), ['ANIM1', 'ANIM2'])
  await page.locator('#animation-library [data-animation-id="ANIM2"]').click()
  assert.equal(await page.locator('#animation-library [aria-selected="true"]').getAttribute('data-animation-id'), 'ANIM2')

  // 点空白处取消选中按键，列表恢复全部。
  await page.locator('.animation-key-filter').getByRole('button', { name: '取消选中按键 1' }).click()
  await page.locator('.animation-key-filter').waitFor({ state: 'detached' })
  assert.deepEqual(await listed(), ['ANIM1', 'ANIM2'])

  // 粒子：按键 2 没有粒子，提示切到「全部」。
  await page.locator('#animation-library button[aria-label="返回布局"]').click()
  await open('particle')
  await clickKey('KEY2')
  await page.locator('.animation-key-filter').waitFor()
  assert.deepEqual(await listed(), ['ANIM3'], '按键 2 没有粒子时直接列全部')
  const onlyKey2 = page.locator('.animation-key-filter').getByRole('button', { name: '按键 2 的粒子', exact: true })
  assert.equal(await onlyKey2.isDisabled(), true)
  assert.equal(await onlyKey2.getAttribute('title'), '按键 2 按下时没有播放粒子')

  assert.deepEqual(errors, [])
  console.log('animation key filter: pick key in edit mode, filtered list, multi-select, clear passed')
} finally {
  await browser.close()
  await server.close()
}
