import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { readFileSync } from 'node:fs'
import { unzipSync, zipSync, strToU8 } from 'fflate'
import { sxiAnimationFixture } from '../tests/helpers/sxi-animation-fixture.mjs'
import { bdaAnimationFixture } from '../tests/helpers/bda-animation-fixture.mjs'

const server = await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'error', server: { port: 41841, strictPort: false, host: '127.0.0.1', hmr: false } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('dialog', (dialog) => dialog.accept())
const files = unzipSync(readFileSync(new URL('../public/default-template.bds', import.meta.url)))
files['res/anim.ini'] = strToU8('[ANIM1]\nCATEGORY=0\nTYPE=2\nDURATION=1500\nFROM_PX=0,0\nTO_PX=80,0\n[ANIM2]\nCATEGORY=3\nPARTICLE_IMAGE=1\nTOTAL_NUMBER=12\nBIRTH_RATE=4\nLIFE=1000,1000\n')
const fingerprint = () => page.evaluate(async () => {
  const { appState } = await import('/src/app/state.ts')
  return { undo: appState.undoStack.length, revision: appState.archive.revision, dirty: [...appState.dirtyPaths ?? []] }
})
const choose = (mode) => page.locator(`.sidebar-overview button[data-nav-mode="${mode}"]`).first().click()
const seek = async (player, value) => {
  await player.getByRole('slider', { name: '预览时间' }).evaluate((node, value) => {
    node.value = String(value)
    node.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}
const sample = (player) => player.locator('canvas').evaluate((canvas) => canvas.toDataURL())

try {
  for (const [format, bytes, selector, editableField] of [
    ['bds', zipSync(files), '[data-animation-section="ANIM1"]', '持续时间'],
    ['sxi', sxiAnimationFixture(), '.sxi-animation-section', '持续时间'],
    ['bda', bdaAnimationFixture(), '[data-animation-effect="alpha:fade"]', '持续时间'],
  ]) {
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
    await page.locator('#browser-open').setInputFiles({ name: `preview.${format}`, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) })
    await page.waitForFunction(() => !document.querySelector('#open').disabled)
    const close = page.locator('#file-operation-dialog[open] #file-operation-close')
    if (await close.isVisible()) await close.click()
    await choose('motion')
    const section = page.locator(selector).first()
    const player = section.locator('.ui-animation-player')
    await player.getByRole('button', { name: '播放预览', exact: true }).waitFor()
    await page.waitForFunction((selector) => !document.querySelector(`${selector} .ui-animation-transport button`).disabled, selector)
    assert.equal(await section.getByRole('spinbutton', { name: editableField, exact: true }).isDisabled(), true)
    const before = await fingerprint()
    const initial = await sample(player)
    await player.getByRole('button', { name: '播放预览', exact: true }).click()
    await page.waitForFunction((selector) => Number(document.querySelector(`${selector} .ui-slider`).value) > 30, selector)
    await player.getByRole('button', { name: '暂停预览', exact: true }).click()
    const paused = await player.getByRole('slider').inputValue()
    await page.waitForTimeout(80)
    assert.equal(await player.getByRole('slider').inputValue(), paused)
    const max = Number(await player.getByRole('slider').getAttribute('max'))
    await seek(player, Math.floor(max / 4))
    assert.equal(await player.getByRole('slider').inputValue(), String(Math.floor(max / 4)))
    assert.notEqual(await sample(player), initial, `${format}: the canvas really changes with time`)
    await player.getByRole('slider').focus()
    await page.keyboard.press('ArrowRight')
    assert.equal(await player.getByRole('slider').inputValue(), String(Math.floor(max / 4) + 1))
    await player.getByRole('button', { name: '重新播放', exact: true }).click()
    assert.equal(await player.getAttribute('data-playing'), 'true')
    await player.evaluate((node) => { window.__oldAnimationPlayer = node })
    await choose('particle')
    await page.waitForFunction(() => window.__oldAnimationPlayer.dataset.playing === 'false')
    const particle = page.locator('.ui-animation-player').first()
    await particle.getByRole('button', { name: '播放预览', exact: true }).click()
    await page.waitForFunction(() => Number(document.querySelector('.ui-animation-player .ui-slider').value) > 30)
    await particle.getByRole('button', { name: '暂停预览', exact: true }).click()
    await seek(particle, 1000)
    assert.ok((await sample(particle)).length > 100)
    assert.deepEqual(await fingerprint(), before, `${format}: playback is read-only`)
    await choose('motion')
    await page.getByRole('button', { name: '编辑模式', exact: true }).click()
    await section.getByRole('spinbutton', { name: editableField, exact: true }).fill('1200')
    await section.getByRole('spinbutton', { name: editableField, exact: true }).press('Tab')
    assert.equal(await player.getByRole('slider').inputValue(), '0', 'parameter edits reset preview')
    assert.equal(await player.getAttribute('data-playing'), 'false')
    console.log(`${format}: playback/pause/replay, real canvas sampling, mouse/keyboard seek, category cleanup, readonly and reset passed`)
  }
  assert.deepEqual(errors, [])
} finally { await browser.close(); await server.close() }
