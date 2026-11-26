// 动画播放器（DESIGN.md §10「播放预览」）：手心、百度 anim.ini 与 BDA animationConfig 各打开一次，
// 在动效设计 / 粒子设计里真实播放、暂停、重播、拖动时间轴、循环与慢放；确认只改预览不改文件，
// 编辑参数后回到起点，开着循环时按新参数继续播放，切换入口时停止播放。
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { sxiAnimationFixture } from '../tests/helpers/sxi-animation-fixture.mjs'
import { bdaAnimatedSkinBytes, bdsBaseArchive } from '../tests/helpers/bda-animation-fixture.mjs'
import { SkinArchive } from '../src/skin.ts'
import { convertBdaArchive } from '../src/bda-convert.ts'
import { acceptAskDialogs } from "../tests/helpers/ask-dialogs.mjs"

const bda = bdaAnimatedSkinBytes()
const bds = await convertBdaArchive(SkinArchive.open(bda, 'bda'), bdsBaseArchive()).archive.platformBytesAsync('bds')
const server = await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'error', server: { port: 41841, strictPort: false, host: '127.0.0.1', hmr: false } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
await acceptAskDialogs(page)
const fingerprint = () => page.evaluate(async () => {
  const { appState } = await import('/src/app/state.ts')
  return { undo: appState.undoStack.length, revision: appState.archive.revision, dirty: [...appState.dirtyPaths ?? []] }
})
// 从全局导航进入动画工作区，再切换动画分类。
const choose = async (mode) => {
  if (!await page.locator('body.animation-workspace').count()) await page.locator('[data-workspace-page="animation"]').click()
  await page.locator(`#animation-library [data-animation-mode="${mode}"]`).click()
}
const player = page.locator('#animation-stage .ui-animation-player').first()
const slider = player.getByRole('slider', { name: '预览时间' })
const seek = (value) => slider.evaluate((node, value) => {
  node.value = String(value)
  node.dispatchEvent(new Event('input', { bubbles: true }))
}, value)
const sample = () => player.locator('.ui-animation-stage > canvas').evaluate((canvas) => canvas.toDataURL())
const ready = () => page.waitForFunction(() => !document.querySelector('#animation-stage .ui-animation-player .ui-animation-transport button')?.disabled)
const pick = async (id) => {
  if (id) await page.locator(`[data-animation-id="${id}"]`).click()
  await ready()
}

try {
  for (const [format, bytes, motionID, nextID, field] of [
    ['sxi', sxiAnimationFixture(), '100', '101', '时长'],
    ['bds', bds, 'ANIM1', 'ANIM2', '时长'],
    ['bda', bda, 'alpha:press', 'scale:enter', '时长'],
  ]) {
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
    await page.locator('#browser-open').setInputFiles({ name: `preview.${format}`, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) })
    await page.waitForFunction(() => !document.querySelector('#open').disabled)
    const close = page.locator('#file-operation-dialog[open] #file-operation-close')
    if (await close.isVisible()) await close.click()
    await choose('motion')
    await pick(motionID)
    assert.equal(await page.locator('#animation-stage .ui-animation-player').count(), 1, `${format}: 播放器停靠在画布下方`)
    assert.equal(await page.locator('.animation-stage-trigger').count(), 0, `${format}: 不显示画布触发提示`)
    assert.equal(await page.locator('#preview-zoom-fit').isVisible(), false, `${format}: 隐藏适配窗口按钮`)
    assert.equal(await player.locator('.ui-animation-curve').count(), 0, `${format}: 时间轴不显示曲线面板`)
    assert.equal(await page.locator('#animation-library').getByRole('button', { name: '动效预设', exact: true }).count(), 0, `${format}: 侧栏不显示动效预设`)
    const transport = await player.locator('.ui-animation-transport').boundingBox()
    const ruler = await player.locator('.ui-animation-timeline').boundingBox()
    assert.ok(transport && ruler && transport.y >= ruler.y + ruler.height, `${format}: 播放控件在时间轴下方`)
    const stage = await player.locator('.ui-animation-stage').boundingBox()
    assert.ok(stage.y <= ruler.y && stage.y + stage.height >= transport.y + transport.height, `${format}: 预览铺满左栏`)
    assert.ok(Math.abs(stage.width / (stage.width + ruler.width) - 0.3) < 0.005, `${format}: 预览和轨道分栏为 30:70`)
    assert.ok(Math.abs(transport.x + transport.width / 2 - (ruler.x + ruler.width / 2)) < 1, `${format}: 播放控件在右栏居中`)
    const editable = page.getByRole('spinbutton', { name: field, exact: true })
    assert.equal(await editable.isDisabled(), true, `${format}: 交互预览里参数只读，播放仍可用`)
    const before = await fingerprint()
    const header = page.locator('.animation-object-header')
    assert.equal(await header.getByRole('button').count(), 1, `${format}: 对象头只保留源代码按钮`)
    assert.doesNotMatch(await header.textContent(), /未使用|处引用/)
    const list = await page.locator('#animation-library .ui-listbox:has([data-animation-id])').elementHandle()
    await header.getByRole('button', { name: '查看源代码' }).press('Enter')
    const editor = page.locator('.source > #source-editor')
    await editor.getByRole('textbox').waitFor()
    const highlight = id => page.waitForFunction(id => {
      const editor = document.querySelector('#source-editor').getBoundingClientRect()
      return [...document.querySelectorAll('#source-editor .cm-source-selected')].some(line => {
        const rect = line.getBoundingClientRect()
        return rect.bottom > editor.top && rect.top < editor.bottom && [`[${id}]`, `"${id}":`].some(key => line.textContent.includes(key))
      })
    }, id)
    await highlight(motionID)
    assert.equal(await page.locator('[data-workspace-page="animation"]').getAttribute('aria-current'), 'page')
    assert.equal(await editable.isVisible(), false, `${format}: 源码替换属性而不是切换工作区`)
    assert.equal(await player.isVisible(), true)
    const text = () => page.evaluate(async () => (await import('/src/app/canvas-interaction.ts')).source.value)
    const full = await text()
    await pick(nextID)
    await highlight(nextID)
    assert.equal(await text(), full, `${format}: 切换动画只更新定位，不替换完整文件`)
    await pick(motionID)
    await highlight(motionID)
    if (process.env.ANIMATION_SCREENSHOTS) await page.screenshot({ path: `${process.env.ANIMATION_SCREENSHOTS}/animation-source-${format}.png`, animations: "disabled" })
    await header.getByRole('button', { name: '返回属性' }).click()
    assert.equal(await editor.isVisible(), false)
    assert.equal(await editable.isVisible(), true)
    assert.equal(await list.evaluate(node => node.isConnected), true, `${format}: 保留动画列表节点`)
    assert.deepEqual(await fingerprint(), before, `${format}: 浏览源代码不写入皮肤`)
    await ready()
    const initial = await sample()
    await player.getByRole('button', { name: '播放预览', exact: true }).click()
    await page.waitForFunction(() => Number(document.querySelector('#animation-stage .ui-animation-player .ui-slider').value) > 30)
    await player.getByRole('button', { name: '暂停预览', exact: true }).click()
    const paused = await slider.inputValue()
    await page.waitForTimeout(80)
    assert.equal(await slider.inputValue(), paused)
    const max = Number(await slider.getAttribute('max'))
    await seek(Math.floor(max / 4))
    assert.equal(await slider.inputValue(), String(Math.floor(max / 4)))
    assert.notEqual(await sample(), initial, `${format}: the canvas really changes with time`)
    await slider.focus()
    await page.keyboard.press('ArrowRight')
    assert.equal(await slider.inputValue(), String(Math.floor(max / 4) + 1))
    // 时间轴本身也能拖：点在轨道中间就跳到一半。
    const lanes = await player.locator('.ui-animation-lanes').boundingBox()
    await page.mouse.click(lanes.x + lanes.width / 2, lanes.y + 4)
    assert.ok(Math.abs(Number(await slider.inputValue()) - max / 2) <= max * 0.02, `${format}: 点击时间轴跳到对应时刻`)
    // 慢放：同样的时间只走四分之一。
    await player.getByRole('button', { name: '慢放 ¼×', exact: true }).click()
    assert.equal(await player.getByRole('button', { name: '慢放 ¼×', exact: true }).getAttribute('aria-pressed'), 'true')
    await player.getByRole('button', { name: '重新播放', exact: true }).click()
    await page.waitForTimeout(200)
    assert.ok(Number(await slider.inputValue()) < 120, `${format}: ¼× 慢放`)
    await player.getByRole('button', { name: '慢放 ¼×', exact: true }).click()
    assert.equal(await player.getAttribute('data-playing'), 'true')
    await player.evaluate((node) => { window.__oldAnimationPlayer = node })
    await choose('particle')
    await page.waitForFunction(() => window.__oldAnimationPlayer.dataset.playing === 'false')
    await ready()
    await player.getByRole('button', { name: '播放预览', exact: true }).click()
    await page.waitForFunction(() => Number(document.querySelector('#animation-stage .ui-animation-player .ui-slider').value) > 30)
    await player.getByRole('button', { name: '暂停预览', exact: true }).click()
    // 粒子同时画在示例舞台和画布的键盘上；舞台停着时也有整段弹道可看。
    assert.equal(await player.locator('.ui-animation-stage').isVisible(), true, `${format}: 粒子有示例舞台`)
    await seek(0)
    const stageAtStart = await sample()
    const keyboard = () => page.locator('#preview').evaluate((canvas) => canvas.toDataURL())
    await page.waitForTimeout(80)
    const emptyKeyboard = await keyboard()
    const at = Math.min(1000, Number(await slider.getAttribute('max')))
    await seek(at)
    assert.equal(await page.evaluate(async () => {
      const { preview } = await import('/src/app/canvas-interaction.ts')
      return preview.playerParticles?.particles.length ? preview.playerParticles.elapsed : -1
    }), at, `${format}: 键盘画布按播放器时间画粒子`)
    await page.waitForFunction((before) => document.querySelector('#preview').toDataURL() !== before, emptyKeyboard)
    assert.notEqual(await sample(), stageAtStart, `${format}: 舞台上的粒子随时间变化`)
    assert.ok(await player.locator('.ui-animation-lane').count() >= 1, `${format}: 粒子有发射轨道`)
    assert.deepEqual(await fingerprint(), before, `${format}: playback is read-only`)

    // 编辑参数：预览回到起点、停下；开着循环预览时按新参数继续播放。
    await choose('motion')
    await page.getByRole('button', { name: '编辑模式', exact: true }).click()
    await ready()
    const timeText = () => player.locator('.ui-animation-time').textContent()
    const untilTime = (previous, playing) => page.waitForFunction(({ previous, playing }) => {
      const root = document.querySelector('#animation-stage .ui-animation-player')
      return root?.querySelector('.ui-animation-time')?.textContent.split(' / ')[1] !== previous.split(' / ')[1]
        && (!playing || root.dataset.playing === 'true')
    }, { previous, playing })
    const original = await timeText()
    await editable.fill('1200')
    await editable.press('Tab')
    await untilTime(original, false)
    assert.equal(await slider.inputValue(), '0', `${format}: parameter edits reset preview`)
    assert.equal(await player.getAttribute('data-playing'), 'false')
    await player.getByRole('button', { name: '循环预览', exact: true }).click()
    await player.getByRole('button', { name: '播放预览', exact: true }).click()
    const edited = await timeText()
    await editable.fill('900')
    await editable.press('Tab')
    await untilTime(edited, true)
    assert.equal(await player.getByRole('button', { name: '循环预览', exact: true }).getAttribute('aria-pressed'), 'true')
    await player.getByRole('button', { name: '循环预览', exact: true }).click()
    await player.getByRole('button', { name: '暂停预览', exact: true }).click()
    console.log(`${format}: play/pause/replay, canvas sampling, slider/keyboard/lane seek, slow motion, particle view, read-only playback, edit reset and live loop passed`)
  }
  await page.setViewportSize({ width: 820, height: 740 })
  const play = player.getByRole('button', { name: '播放预览', exact: true })
  await play.focus()
  await play.press('Enter')
  await page.waitForFunction(() => document.querySelector('#animation-stage .ui-animation-player')?.dataset.playing === 'true')
  const bar = await player.locator('.ui-animation-transport').boundingBox()
  const dock = await page.locator('#animation-stage').boundingBox()
  assert.ok(bar && dock && bar.x >= dock.x && bar.x + bar.width <= dock.x + dock.width, '窄桌面窗口不裁切播放控件')
  await page.locator('[data-workspace-page="overview"]').click()
  assert.equal(await page.locator('#preview-zoom-fit').isVisible(), true, '退出动画页后恢复适配窗口按钮')
  assert.deepEqual(errors, [])
} finally { await browser.close(); await server.close() }
