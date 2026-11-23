import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { sxiAnimationFixture } from '../tests/helpers/sxi-animation-fixture.mjs'
import { dismissStartupDisclaimer } from '../tests/helpers/open-editor-template.mjs'
import { bdsFixture } from '../tests/helpers/baidu-fixture.mjs'

const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
page.setDefaultTimeout(9000)
const errors = []
page.on('pageerror', e => { errors.push(e.message); console.error(e.message) })
const card = page.locator('#animation-library [data-animation-id="ANIM1"]'), dialog = page.getByRole('dialog', { name: '应用动画', exact: true })
const layout = 'light/skin/port/py_26.ini', bars = 'light/skin/port/cand1.cnd'
const snapshot = () => page.evaluate(async ([layout, bars]) => {
  const { appState: s } = await import('/src/app/state.ts')
  return [layout, bars, 'light/skin/res/default.css'].map(p => s.archive.getText(p)).concat(s.undoStack.length)
}, [layout, bars])
const position = async (selector, x = .5, y = .5) => {
  const box = await page.locator(selector).boundingBox(); assert.ok(box, selector)
  return { x: box.x + box.width*x, y: box.y + box.height*y }
}
const markers = page.locator('.animation-drop-target')
const drag = async (to, label, count = 1) => {
  await card.scrollIntoViewIfNeeded()
  const from = await position('#animation-library [data-animation-id="ANIM1"]')
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 12 })
  assert.equal(await markers.count(), count)
  assert.equal(await markers.locator('.ui-badge').innerText(), label)
  await page.mouse.up()
}
const key = i => position('#preview', (i === 1 ? 60 : 170)/1080, 60/600)
try {
  await page.addInitScript(() => localStorage.setItem('onboarding-tour-v1', 'done'))
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
  await dismissStartupDisclaimer(page)
  await page.locator('#browser-open').setInputFiles({name:'drop.bds', mimeType:'application/octet-stream', buffer:Buffer.from(bdsFixture())})
  await page.waitForFunction(() => !document.querySelector('#open').disabled)
  const close = page.locator('#file-operation-dialog[open] #file-operation-close'); if (await close.isVisible()) await close.click()
  await page.evaluate(async path => { const { selectFile } = await import('/src/app/navigation.ts'); selectFile(path); selectFile('light/skin/res/anim.ini','overview','motion') }, layout)
  await card.waitFor()
  await drag(await key(1), '按键 1'); await page.getByRole('button', {name:'切换至编辑模式',exact:true}).click()
  await page.waitForFunction(() => !document.querySelector('dialog[open]'))
  const initial = await snapshot()
  await drag(await key(1), '按键 1'); await dialog.waitFor(); await page.keyboard.press('Escape'); await dialog.waitFor({state:'detached'})
  assert.deepEqual(await snapshot(), initial)
  for (const i of [1,2]) { const p = await key(i); if(i===2) await page.keyboard.down('Control'); await page.mouse.click(p.x,p.y); if(i===2) await page.keyboard.up('Control') }
  await drag(await key(2), '已选的 2 个按键', 2); await dialog.getByRole('radio',{name:/松开/}).check()
  await mkdir('.ui-current',{recursive:true}); await dialog.screenshot({path:'.ui-current/animation-drop-trigger.png',animations:'disabled'})
  await dialog.getByRole('button',{name:'应用',exact:true}).click(); await dialog.waitFor({state:'detached'})
  const applied = await snapshot(); assert.equal(applied[3],initial[3]+1); assert.match(applied[2], /RELEASE_ANIM=1/); assert.equal((applied[0].match(/^ANIM_STYLE=/gm)||[]).length,2)
  await page.locator('#desktop-undo').click(); assert.deepEqual(await snapshot(),initial)
  for(const [section,label,selector] of [['PANEL','键盘背景','#preview'],['SWITCH','工具栏','#toolbar-preview'],['CAND','候选栏','#candidate-words']]) {
    if(section==='CAND') await page.evaluate(async()=>{ (await import('/src/app/canvas-interaction.ts')).setSimulatedComposition('ni'); (await import('/src/app/preview-render.ts')).refreshSimulationState() })
    const to = await position(selector); await page.mouse.click(to.x,to.y)
    await card.focus(); await page.keyboard.press('Alt+Enter'); await dialog.waitFor(); assert.match(await dialog.innerText(),new RegExp(label)); await page.keyboard.press('Escape'); await dialog.waitFor({state:'detached'})
    if (section === 'CAND') {
      const blank = await position('#preview')
      await page.mouse.click(blank.x, blank.y)
      assert.equal(await page.locator('.canvas-wrap').getAttribute('data-animation-component'), null, 'empty panel space clears CAND without selecting PANEL')
      await card.focus(); await page.keyboard.press('Alt+Enter')
      assert.equal(await dialog.count(), 0, 'cleared selection cannot receive a keyboard binding')
      await page.mouse.click(to.x, to.y)
    }
    await drag(to,label); await dialog.getByRole('button',{name:'应用',exact:true}).click(); await dialog.waitFor({state:'detached'})
    const result = await snapshot(); assert.match(result[section==='PANEL'?0:1],new RegExp(`\\[${section}\\][^\\[]*ANIM_STYLE=`)); assert.match(result[2],/SHOW_ANIM=1/)
  }
  // 回归：SXI 的卡片编号为纯数字，顶栏的布局选择器不能把其他控件挤到第二行。
  await page.reload()
  await page.locator('#browser-open').setInputFiles({name:'drag.sxi', mimeType:'application/octet-stream', buffer:sxiAnimationFixture()})
  await page.waitForFunction(() => !document.querySelector('#open').disabled)
  if (await close.isVisible()) await close.click()
  await page.evaluate(async () => { const {selectFile}=await import('/src/app/navigation.ts'); selectFile('skin.json/default/port_layout/b/full18Pinyin'); selectFile('skin.json/default/s_info/ss_2','overview','motion') })
  await page.getByRole('button',{name:'编辑模式',exact:true}).click()
  const palmCard = page.locator('#animation-library [data-animation-id="101"]'); await palmCard.waitFor()
  for(const width of [1440,1024]) {
    await page.setViewportSize({width,height:900})
    assert.ok(await page.locator('.preview-toolbar').evaluate(el=>{ const bar=el.getBoundingClientRect(); return [...el.querySelectorAll('select,button')].filter(n=>n.offsetWidth&&n.offsetHeight).every(n=>{ const r=n.getBoundingClientRect();return r.top>=bar.top-1&&r.bottom<=bar.bottom+1&&r.left>=bar.left-1&&r.right<=bar.right+1 }) }),`顶栏越界 @ ${width}`)
  }
  await page.setViewportSize({width:1440,height:900})
  const keyCenters = await page.evaluate(async () => {
    const { preview } = await import('/src/app/canvas-interaction.ts'), box = preview.canvas.getBoundingClientRect()
    return preview.keys.flatMap(({ section, rect }) => {
      const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2
      return section.startsWith('KEY') && preview.hit({ x, y })?.section === section
        ? [{ section, x: box.left + x * box.width / preview.panelWidth, y: box.top + y * box.height / preview.surfaceHeight }] : []
    })
  })
  const [pick] = keyCenters
  assert.ok(keyCenters.length >= 10)
  const skinText = () => page.evaluate(async()=> (await import('/src/app/state.ts')).appState.archive.getText('skin.json'))
  const before = await skinText()
  await palmCard.scrollIntoViewIfNeeded();const start=await palmCard.boundingBox()
  await page.mouse.move(start.x+start.width/2,start.y+start.height/2);await page.mouse.down();await page.mouse.move(pick.x,pick.y,{steps:12})
  assert.equal(await palmCard.getAttribute('aria-selected'),'true');assert.equal(await palmCard.getAttribute('data-dragging'),'');assert.match(await page.locator('.animation-drop-target').innerText(),/按键/);assert.equal(await page.locator('.animation-drag-ghost').innerText(),'动画 101')
  await page.screenshot({path:'.ui-current/sxi-animation-drag.png',animations:'disabled'});await page.mouse.up()
  await dialog.getByRole('radio',{name:/长按/}).check();await dialog.getByRole('button',{name:'应用',exact:true}).click();await dialog.waitFor({state:'detached'})
  const theme=JSON.parse(await skinText()).default, boundKey=theme.port_layout.b.full18Pinyin.keys.find(k=>`KEY${k.id}`===pick.section)
  assert.equal(theme.s_info.ss_1[String(boundKey.b.asi)].s_5['5'],101)
  await page.locator('#desktop-undo').click();assert.equal(await skinText(),before)
  const outside = keyCenters[1], group = keyCenters.filter(k => k !== outside).slice(0, 9)
  await page.mouse.click(pick.x, pick.y)
  await page.keyboard.down('Control')
  for (const k of group.slice(1)) await page.mouse.click(k.x, k.y)
  await page.keyboard.up('Control')
  if (!await palmCard.isVisible()) await page.locator('.animation-key-filter').getByRole('button', { name: '全部', exact: true }).click()
  await palmCard.hover(); await page.mouse.down(); await page.mouse.move(pick.x, pick.y, { steps: 12 })
  assert.equal(await markers.locator('.ui-badge').innerText(), '已选的 9 个按键')
  const checkCenters = async keys => {
    const centers = await markers.evaluateAll(nodes => nodes.map(node => {
      const r = node.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    }))
    assert.equal(centers.length, keys.length)
    for (const k of keys) assert.ok(centers.some(c => Math.hypot(c.x - k.x, c.y - k.y) < 1), k.section)
  }
  await checkCenters(group)
  await page.screenshot({path:'.ui-current/animation-nine-key-drag.png', animations:'disabled'})
  await page.mouse.move(outside.x, outside.y); await checkCenters([outside])
  await page.mouse.move(pick.x, pick.y); await checkCenters(group)
  await page.keyboard.press('Escape'); await page.mouse.up()
  assert.equal(await markers.count(), 0); assert.equal(await dialog.count(), 0); assert.equal(await skinText(), before)
  assert.deepEqual(errors,[]); console.log('动画拖放：只读、取消、批量应用与撤销、三类组件及预选通过')
} finally { await browser.close(); await server.close() }
