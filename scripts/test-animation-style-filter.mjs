// 动效设计 / 粒子设计（DESIGN.md §10）：左侧栏分动画与样式两份列表，样式只列引用了当前入口动画的样式；
// 点一个样式回到动画列表，只看它播放的动画，可以清除。
import assert from 'node:assert/strict'
import { strToU8, strFromU8, unzipSync, zipSync } from 'fflate'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { bdsFixture } from '../tests/helpers/baidu-fixture.mjs'
import { bdaAnimatedSkinBytes } from '../tests/helpers/bda-animation-fixture.mjs'
import { sxiAnimationFixture } from '../tests/helpers/sxi-animation-fixture.mjs'

const files = unzipSync(bdsFixture())
const skin = zipSync({
  ...files,
  'light/port/py_26.ini': strToU8(strFromU8(files['light/port/py_26.ini']).replace('[KEY1]', '[KEY1]\nANIM_STYLE=7')),
  'light/res/default.css': strToU8([
    strFromU8(files['light/res/default.css']),
    '[STYLE7]', 'PRESS_ANIM=1',
    '[STYLE8]', 'PRESS_ANIM=2', 'RELEASE_ANIM=1',
    // 只改了颜色、没有动效指针的样式不进样式列表。
    '[STYLE9]', 'NM_COLOR=FF00FF00',
    '[STYLE10]', 'PRESS_ANIM=3',
  ].join('\n')),
  'light/res/anim.ini': strToU8([
    '[ANIM1]', 'CATEGORY=0', 'TYPE=1', 'DURATION=200', 'FROM=100,100', 'TO=80,80',
    '[ANIM2]', 'CATEGORY=0', 'TYPE=0', 'DURATION=300', 'FROM=255', 'TO=0',
    '[ANIM3]', 'CATEGORY=3', 'TYPE=0', 'PARTICLE_IMAGE=2', 'TOTAL_NUMBER=10', 'BIRTH_RATE=20', 'LIFE=300,600',
    'EMIT_REGION=0,0,1,1', 'VELOCITY=50,100', 'VELOCITY_DIRECTION=0,360',
  ].join('\n')),
})
const ANIM = 'light/skin/res/anim.ini'
const server = await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'error', server: { port: 41870, strictPort: false, host: '127.0.0.1', hmr: false } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

const listed = () => page.locator('#animation-library .ui-listbox:has([data-animation-id]) [data-animation-id]').evaluateAll((nodes) => nodes.map((node) => node.dataset.animationId))
const listedStyles = () => page.locator('#animation-library .ui-listbox:has([data-style-id]) [data-style-id]').evaluateAll((nodes) => nodes.map((node) => node.dataset.styleId))
const tab = (name) => page.locator('.animation-library-tabs').getByRole('button', { name, exact: true })
const open = async (mode) => {
  if (await page.locator('body.animation-workspace').count()) await page.locator('#animation-library button[aria-label="返回布局"]').click()
  await page.evaluate(async ({ path, mode }) => (await import('/src/app/navigation.ts')).selectFile(path, 'overview', mode), { path: ANIM, mode })
  await page.locator('#animation-library [data-animation-id]').first().waitFor()
}

try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.locator('#browser-open').setInputFiles({ name: 'keys.bds', mimeType: 'application/octet-stream', buffer: Buffer.from(skin) })
  await page.waitForFunction(() => !document.querySelector('#open').disabled)
  const close = page.locator('#file-operation-dialog[open] #file-operation-close')
  if (await close.isVisible()) await close.click()
  await page.evaluate(async (path) => (await import('/src/app/navigation.ts')).selectFile(path), 'light/skin/port/py_26.ini')
  await open('motion')

  // 两份列表同在左侧栏，用分段开关切换；默认看动画。
  assert.deepEqual(await listed(), ['ANIM1', 'ANIM2'])
  assert.equal(await page.locator('.animation-library-tabs > button').count(), 2, '动画 | 样式 两个开关')
  assert.equal(await tab('动画').getAttribute('aria-pressed'), 'true')
  assert.equal(await page.locator('.animation-library-count').textContent(), '2 个')

  // 样式只列引用了当前入口动效的样式：STYLE9 没有动效，STYLE10 只引用了粒子。
  await tab('样式').click()
  assert.equal(await tab('样式').getAttribute('aria-pressed'), 'true')
  assert.deepEqual(await listedStyles(), ['7', '8'])
  assert.equal(await page.locator('.animation-library-count').textContent(), '2 个', '头部数量跟随当前列表')
  const row8 = page.locator('#animation-library [data-style-id="8"]')
  assert.equal(await row8.locator(':scope > small').textContent(), '2 个动画 · 按下 · 抬起')
  assert.equal(await row8.locator('.ui-animation-player[data-variant="thumbnail"]').count(), 2)
  assert.equal(await page.locator('#animation-library [data-animation-id].ui-style-card').count(), 2)

  // 点样式留在样式列表，右侧直接编辑同一个样式，并解析各事件与应用来源。
  await page.locator('#animation-library [data-style-id="7"]').click()
  assert.equal(await tab('样式').getAttribute('aria-pressed'), 'true')
  assert.equal(await page.locator('#selected-key').textContent(), 'STYLE7')
  assert.equal(await page.locator('#document-fields [data-document-key="PRESS_ANIM"] input').inputValue(), '1')
  assert.ok(await page.locator('#document-fields .style-animation-links button').evaluate(node => node.clientWidth > 100), '事件链接未被双列网格挤压')
  assert.match(await page.locator('#document-fields [data-inspector-group-label="应用于"]').textContent(), /py_26.ini · \[KEY1\] ANIM_STYLE/)
  await page.getByRole('button', { name: '编辑模式', exact: true }).click()
  const eventInput = page.locator('#document-fields [data-document-key="PRESS_ANIM"] input')
  const listsBeforeStyleEdit = await page.locator('#animation-library .ui-listbox').elementHandles()
  const selectedStyle = page.locator('#animation-library [data-style-id="7"]')
  assert.equal(await selectedStyle.getAttribute('aria-selected'), 'true')
  await page.waitForFunction(() => {
    const card = document.querySelector('#animation-library [data-style-id="7"]')
    if (!card) return false
    const probe = document.createElement('span')
    probe.style.backgroundColor = 'var(--accent-soft)'
    card.append(probe)
    const matches = getComputedStyle(card).backgroundColor === getComputedStyle(probe).backgroundColor
    probe.remove()
    return matches
  })
  assert.equal(await selectedStyle.evaluate(el => getComputedStyle(el).backgroundColor), await selectedStyle.evaluate(el => { const probe = document.createElement('span'); probe.style.backgroundColor = 'var(--accent-soft)'; el.append(probe); const color = getComputedStyle(probe).backgroundColor; probe.remove(); return color }), '选中卡片显示强调底色')
  await eventInput.fill('2')
  await eventInput.press('Tab')
  assert.equal(await eventInput.inputValue(), '2')
  assert.equal(await page.locator('#selected-key').textContent(), 'STYLE7')
  for (const list of listsBeforeStyleEdit) assert.equal(await list.evaluate(el => el.isConnected), true, '样式属性写回保留列表节点')
  await page.keyboard.press('ControlOrMeta+z')
  assert.equal(await eventInput.inputValue(), '1')
  assert.equal(await page.locator('#selected-key').textContent(), 'STYLE7')
  const releaseInput = page.locator('#document-fields [data-document-key="RELEASE_ANIM"] input')
  assert.equal(await releaseInput.inputValue(), '', '未配置释放事件也可编辑')
  await releaseInput.fill('2')
  await releaseInput.press('Tab')
  assert.equal(await page.evaluate(async () => { const { appState } = await import('/src/app/state.ts'); return appState.archive.getText('light/skin/res/default.css').includes('RELEASE_ANIM=2') }), true)
  for (const list of listsBeforeStyleEdit) assert.equal(await list.evaluate(el => el.isConnected), true, '新增释放事件不重建列表')
  await page.keyboard.press('ControlOrMeta+z')
  assert.equal(await releaseInput.inputValue(), '')
  await page.locator('#document-fields .style-animation-links button').click()
  assert.equal(await page.locator('#document-fields [data-document-key="PRESS_ANIM"]').count(), 0)
  await tab('动画').click()
  assert.deepEqual(await listed(), ['ANIM1'])
  assert.equal(await page.locator('.animation-style-filter-note').textContent(), 'STYLE7 的动效')
  assert.equal(await page.locator('.animation-library-count').textContent(), '1 个')
  const listsBeforeAnimationEdit = await page.locator('#animation-library .ui-listbox').elementHandles()
  const duration = page.locator('#document-fields [data-document-key="DURATION"] input[type="number"]')
  await duration.fill('240')
  await duration.press('Tab')
  for (const list of listsBeforeAnimationEdit) assert.equal(await list.evaluate(el => el.isConnected), true, '动画属性写回保留列表节点')
  assert.equal(await page.locator('#animation-library [data-animation-id="ANIM1"]').getAttribute('aria-selected'), 'true')

  // 样式列表仍然记着选中项，清除筛选后恢复全部。
  await tab('样式').click()
  assert.equal(await page.locator('#animation-library [data-style-id="7"]').getAttribute('aria-selected'), 'true')
  await tab('动画').click()
  await page.locator('.animation-style-filter').getByRole('button', { name: '清除STYLE7筛选' }).click()
  await page.locator('.animation-style-filter').waitFor({ state: 'detached' })
  assert.deepEqual(await listed(), ['ANIM1', 'ANIM2'])

  // 粒子设计只列引用了粒子的样式。
  await open('particle')
  await tab('样式').click()
  assert.deepEqual(await listedStyles(), ['10'])
  await page.locator('#animation-library [data-style-id="10"]').click()
  await tab('动画').click()
  assert.deepEqual(await listed(), ['ANIM3'])
  assert.equal(await page.locator('.animation-style-filter-note').textContent(), 'STYLE10 的粒子')

  // 搜索框同时过滤两份列表。
  await tab('样式').click()
  await page.locator('#animation-library input[role="searchbox"]').fill('style1')
  assert.deepEqual(await listedStyles(), ['10'])


  /* —— BDA：没有样式上的动画指针，第二份列表是绑定了效果的目标 —— */
  const bdaPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  bdaPage.on('pageerror', (error) => errors.push(error.message))
  await bdaPage.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await bdaPage.locator('#browser-open').setInputFiles({ name: '动效.bda', mimeType: 'application/octet-stream', buffer: Buffer.from(bdaAnimatedSkinBytes()) })
  await bdaPage.waitForFunction(() => !document.querySelector('#open').disabled)
  const bdaClose = bdaPage.locator('#file-operation-dialog[open] #file-operation-close')
  if (await bdaClose.isVisible()) await bdaClose.click()
  await bdaPage.evaluate(async () => (await import('/src/app/navigation.ts')).selectFile('light/skin/port/animationConfig', 'overview', 'motion'))
  await bdaPage.locator('#animation-library [data-animation-id]').first().waitFor()
  const bdaTargetTab = bdaPage.locator('.animation-library-tabs').getByRole('button', { name: '目标', exact: true })
  assert.equal(await bdaTargetTab.count(), 1, 'BDA 的第二份列表叫「目标」')
  await bdaTargetTab.click()
  const targets = await bdaPage.locator('#animation-library [data-style-id]').evaluateAll((nodes) => nodes.map((node) => node.dataset.styleId))
  assert.ok(targets.length > 0, '目标列表列出绑定了效果的目标')
  await bdaPage.locator(`#animation-library [data-style-id="${targets[0]}"]`).click()
  await bdaPage.locator('.animation-library-tabs').getByRole('button', { name: '动画', exact: true }).click()
  await bdaPage.locator('.animation-style-filter').waitFor()
  assert.equal(await bdaPage.locator('.animation-style-filter-note').textContent(), `${targets[0]} 的动效`)
  await bdaPage.close()

  const palmPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  palmPage.on('pageerror', error => errors.push(error.message))
  await palmPage.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await palmPage.locator('#browser-open').setInputFiles({ name: 'motion.sxi', mimeType: 'application/octet-stream', buffer: Buffer.from(sxiAnimationFixture()) })
  await palmPage.waitForFunction(() => !document.querySelector('#open').disabled)
  const palmClose = palmPage.locator('#file-operation-dialog[open] #file-operation-close')
  if (await palmClose.isVisible()) await palmClose.click()
  await palmPage.locator('.sidebar-overview button[data-nav-mode="motion"]').click()
  await palmPage.locator('.animation-library-tabs').getByRole('button', { name: '样式', exact: true }).click()
  await palmPage.locator('#animation-library [data-style-id="9001"]').click()
  const triggers = palmPage.locator('#document-fields [data-inspector-group-label="触发动画"]')
  assert.match(await triggers.textContent(), /按下动画 100松开显示动画 102隐藏长按/)
  await palmPage.getByRole('button', { name: '编辑模式', exact: true }).click()
  const palmLists = await palmPage.locator('#animation-library .ui-listbox').elementHandles()
  const palmRelease = triggers.getByRole('spinbutton', { name: '松开动画编号', exact: true })
  await palmRelease.fill('100')
  await palmRelease.press('Tab')
  assert.equal(await palmRelease.inputValue(), '100')
  for (const list of palmLists) assert.equal(await list.evaluate(el => el.isConnected), true, '手心事件写回保留列表节点')
  await palmPage.keyboard.press('ControlOrMeta+z')
  assert.equal(await palmRelease.inputValue(), '')
  await triggers.getByRole('button', { name: '动画 100', exact: true }).click()
  assert.equal(await palmPage.locator('#document-fields [data-inspector-group-label="触发动画"]').count(), 0)
  await palmPage.setViewportSize({ width: 900, height: 1000 })
  await palmPage.locator('#document-fields [data-style-id="9001"]').click()
  assert.equal(await palmPage.locator('#selected-key').textContent(), 'STYLE9001')
  assert.ok(await palmPage.locator('#document-fields [data-animation-id]').count() > 0, '窄屏编辑样式仍保留动画列表')
  const narrowLists = await palmPage.locator('#document-fields .ui-listbox').elementHandles()
  await palmRelease.fill('100')
  await palmRelease.press('Tab')
  for (const list of narrowLists) assert.equal(await list.evaluate(el => el.isConnected), true, '窄屏事件写回保留列表节点')
  await palmPage.keyboard.press('ControlOrMeta+z')
  assert.equal(await palmRelease.inputValue(), '')
  await palmPage.locator('#document-fields [data-animation-id="100"]').click()
  assert.equal(await palmPage.locator('#document-fields [data-inspector-group-label="触发动画"]').count(), 0)
  await palmPage.close()

  assert.deepEqual(errors, [])
  console.log('animation style filter: only styles with animations, switch, filter list, clear passed')
} finally {
  await browser.close()
  await server.close()
}
