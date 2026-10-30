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

const bda = bdaAnimatedSkinBytes()
const bds = await convertBdaArchive(SkinArchive.open(bda, 'bda'), bdsBaseArchive()).archive.platformBytesAsync('bds')
const server = await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'error', server: { port: 41841, strictPort: false, host: '127.0.0.1', hmr: false } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('dialog', (dialog) => dialog.accept())
const fingerprint = () => page.evaluate(async () => {
  const { appState } = await import('/src/app/state.ts')
  return { undo: appState.undoStack.length, revision: appState.archive.revision, dirty: [...appState.dirtyPaths ?? []] }
})
// 进入后概览让位给动画列表，先点列表顶部的返回再从概览切换。
const choose = async (mode) => {
  if (await page.locator('body.animation-workspace').count()) await page.locator('#animation-library button[aria-label="返回布局"]').click()
  await page.locator(`.sidebar-overview button[data-nav-mode="${mode}"]`).first().click()
}
const player = page.locator('.ui-animation-player').first()
const slider = player.getByRole('slider', { name: '预览时间' })
const seek = (value) => slider.evaluate((node, value) => {
  node.value = String(value)
  node.dispatchEvent(new Event('input', { bubbles: true }))
}, value)
const sample = () => player.locator('canvas').evaluate((canvas) => canvas.toDataURL())
const ready = () => page.waitForFunction(() => !document.querySelector('.ui-animation-player .ui-animation-transport button')?.disabled)
const pick = async (id) => {
  if (id) await page.locator(`[data-animation-id="${id}"]`).click()
  await ready()
}

try {
  for (const [format, bytes, motionID, field] of [
    ['sxi', sxiAnimationFixture(), '100', '持续时间'],
    ['bds', bds, 'ANIM1', '时长'],
    ['bda', bda, 'alpha:press', '时长（毫秒）'],
  ]) {
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
    await page.locator('#browser-open').setInputFiles({ name: `preview.${format}`, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) })
    await page.waitForFunction(() => !document.querySelector('#open').disabled)
    const close = page.locator('#file-operation-dialog[open] #file-operation-close')
    if (await close.isVisible()) await close.click()
    await choose('motion')
    await pick(motionID)
    assert.equal(await page.locator('#animation-stage .ui-animation-player').count(), 1, `${format}: 播放器在画布上`)
    const editable = page.getByRole('spinbutton', { name: field, exact: true })
    assert.equal(await editable.isDisabled(), true, `${format}: 交互预览里参数只读，播放仍可用`)
    const before = await fingerprint()
    const initial = await sample()
    await player.getByRole('button', { name: '播放预览', exact: true }).click()
    await page.waitForFunction(() => Number(document.querySelector('.ui-animation-player .ui-slider').value) > 30)
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
    await page.waitForFunction(() => Number(document.querySelector('.ui-animation-player .ui-slider').value) > 30)
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
      const root = document.querySelector('.ui-animation-player')
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
  assert.deepEqual(errors, [])
} finally { await browser.close(); await server.close() }
