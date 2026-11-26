import assert from 'node:assert/strict'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { encodePng } from '../src/ssf/ssf-png.ts'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { dismissStartupDisclaimer } from '../tests/helpers/open-editor-template.mjs'
import { bdaAnimatedSkinBytes } from '../tests/helpers/bda-animation-fixture.mjs'
import { sxiAnimationFixture } from '../tests/helpers/sxi-animation-fixture.mjs'

const sx = unzipSync(sxiAnimationFixture())
const skin = JSON.parse(strFromU8(sx['skin.json']))
Object.assign(skin.default.s_info.ss_2['106'].a11, {
  g: 0, v: [200, 0], a_vel: 0, rest: 1, resist: 0, fric: 0,
  collision_rect: [[0, 0], [100, 30]], launch_point: [20, 15], duration: 800,
})
sx['skin.json'] = strToU8(JSON.stringify(skin))
sx['light/res/ball.png'] = encodePng({ width: 12, height: 12, data: Uint8Array.from({ length: 12 * 12 * 4 }, (_, i) => [255, 0, 255, 255][i % 4]) })

const server = await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'error', server: { host: '127.0.0.1', port: 41877, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
const formats = [
  { format: 'bda', bytes: bdaAnimatedSkinBytes(), path: 'light/skin/port/animationConfig', motion: 'scale:enter', particle: 'emitter:spark', duration: 300, scale: 100, direction: [0, 90] },
  { format: 'sxi', bytes: zipSync(sx), path: 'skin.json/default/s_info/ss_2', motion: '100', particle: '104', duration: 160, scale: 92, direction: [0, 180] },
]
try {
  for (const { format, bytes, path, motion, particle, duration, scale, direction } of formats) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
    await dismissStartupDisclaimer(page)
    await page.locator('#browser-open').setInputFiles({ name: `animation.${format}`, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) })
    await page.waitForFunction(() => !document.querySelector('#open').disabled)
    const close = page.locator('#file-operation-dialog[open] #file-operation-close')
    if (await close.isVisible()) await close.click()
    const open = async (id, mode) => {
      await page.evaluate(async ({ path, id, mode }) => {
        const { appState } = await import('/src/app/state.ts')
        appState.selectedAnimations[`${path}|${mode}`] = id
        const { selectFile } = await import('/src/app/navigation.ts')
        selectFile(path, 'overview', mode)
      }, { path, id, mode })
      await page.locator(`[data-animation-id="${id}"][aria-selected="true"]`).filter({ visible: true }).first().waitFor()
    }
    const stage = page.locator('#animation-stage')
    const handle = name => stage.getByRole('slider', { name, exact: true })
    const snapshot = () => page.evaluate(async ({ format, path }) => {
      const { appState } = await import('/src/app/state.ts')
      const archive = appState.archive
      if (format === 'bda') {
        const { decodeBdaAnimation } = await import('/src/bda-decode.ts')
        const bytes = archive.getBytes(path)
        const effects = decodeBdaAnimation(bytes).effects
        const motion = effects.get('scale:enter')
        return { source: Array.from(bytes), undo: appState.undoStack.length, duration: motion.duration, to: motion.to, direction: effects.get('emitter:spark').velocityDirection }
      }
      const source = archive.getText('skin.json')
      const table = JSON.parse(source).default.s_info.ss_2
      return { source, undo: appState.undoStack.length, duration: table['100'].a1.duration, to: table['100'].a1.to_p, direction: table['104'].a4.v_direction }
    }, { format, path })
    const history = action => page.evaluate(async action => (await import('/src/app/edit-history.ts'))[action](), action)

    await open(motion, 'motion')
    await stage.getByRole('slider', { name: '预览时间', exact: true }).waitFor()
    assert.equal(await stage.locator('.ui-animation-handle').count(), 0, `${format}: preview is read-only`)
    await page.getByRole('button', { name: '编辑模式', exact: true }).click()
    const x = handle('缩放 X')
    await x.waitFor()
    if (format === 'bda') assert.equal(await handle('缩放 Y').count(), 0, 'BDA random endpoint remains a range')
    const original = await snapshot()
    const previewImage = () => stage.locator('.ui-animation-stage > canvas').evaluate(canvas => canvas.toDataURL())
    const beforePreview = await previewImage()
    const box = await x.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 16, box.y + box.height / 2, { steps: 4 })
    assert.notEqual(await x.getAttribute('aria-valuenow'), String(scale), `${format}: drag updates the live draft`)
    assert.notEqual(await previewImage(), beforePreview, `${format}: drag updates the sampled stage`)
    assert.deepEqual(await snapshot(), original, `${format}: draft does not write or create history`)
    await page.keyboard.press('Escape')
    await page.mouse.up()
    assert.equal(await x.getAttribute('aria-valuenow'), String(scale), `${format}: Esc restores handle`)
    assert.deepEqual(await snapshot(), original)
    assert.equal(await previewImage(), beforePreview, `${format}: Esc restores the sampled stage`)

    await x.press('ArrowRight')
    const edited = await snapshot()
    assert.deepEqual(edited.to, format === 'bda' ? [[scale + 1, scale + 1], original.to[1]] : [scale + 1, original.to[1]])
    assert.equal(edited.undo, original.undo + 1)
    await history('undo')
    assert.deepEqual(await snapshot(), original)
    await history('redo')
    assert.deepEqual(await snapshot(), edited)
    await handle('单程时长').press('Shift+ArrowRight')
    const timed = await snapshot()
    assert.equal(timed.duration, duration + 100)
    assert.equal(timed.undo, edited.undo + 1)
    const tail = handle('单程时长')
    const tailBox = await tail.boundingBox()
    await page.mouse.move(tailBox.x + tailBox.width / 2, tailBox.y + tailBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(tailBox.x + tailBox.width / 2 + 23, tailBox.y + tailBox.height / 2, { steps: 4 })
    assert.deepEqual(await snapshot(), timed, `${format}: duration drag is still a draft`)
    await page.mouse.up()
    const dragged = await snapshot()
    assert.ok(dragged.duration > timed.duration, `${format}: releasing the tail commits duration`)
    assert.equal(dragged.undo, timed.undo + 1)

    await open(particle, 'particle')
    await handle('方向下限').press('ArrowRight')
    const emitted = await snapshot()
    const saved = await page.evaluate(async ({ format, path }) => {
      const { appState } = await import('/src/app/state.ts')
      const { SkinArchive } = await import('/src/skin.ts')
      const reopened = SkinArchive.open(await appState.archive.toBytesAsync(), format)
      return format === 'bda' ? Array.from(reopened.getBytes(path)) : reopened.getText('skin.json')
    }, { format, path })
    assert.deepEqual(saved, emitted.source, `${format}: save and reopen preserve the native edits`)
    assert.deepEqual(emitted.direction, [direction[0] + 1, direction[1]])
    assert.equal(emitted.undo, dragged.undo + 1)
    if (format === 'sxi') {
      await open('106', 'motion')
      const seek = handle('预览时间')
      await stage.locator('.ui-animation-note').filter({ hasText: '碰撞物理为近似预览' }).waitFor()
      await page.waitForFunction(() => !document.querySelector('#animation-stage input[aria-label="预览时间"]')?.disabled)
      assert.equal(await seek.getAttribute('max'), '800')
      const spriteX = () => stage.locator('.ui-animation-stage > canvas').evaluate(canvas => {
        const { width, height } = canvas
        const { data } = canvas.getContext('2d').getImageData(0, 0, width, height)
        let sum = 0, count = 0
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] > 225 && data[i + 1] < 35 && data[i + 2] > 225 && data[i + 3] > 225) {
            sum += i / 4 % width
            count++
          }
        }
        return count ? sum / count : null
      })
      const start = await spriteX()
      await seek.fill('400')
      const edge = await spriteX()
      await seek.fill('700')
      const rebound = await spriteX()
      assert.ok(start !== null && edge !== null && rebound !== null, 'stage draws the actual collision image throughout')
      assert.ok(edge > rebound && rebound > start, 'the image moves right and rebounds when scrubbing')
      await seek.fill('0')
      assert.equal(await spriteX(), start, 'collision preview is deterministic when seeking back')
      await open('105', 'motion')
      await stage.locator('.ui-empty').filter({ hasText: '找不到路径文件「path.json」' }).waitFor()
      assert.equal(await stage.getByRole('button', { name: '播放预览', exact: true }).isDisabled(), true)
      assert.deepEqual(await snapshot(), emitted, 'special previews do not write skin.json or add undo entries')
      console.log('sxi: collision image moves and rebounds while scrubbing; missing paths remain unplayable')
    }
    assert.deepEqual(errors, [])
    await page.close()
    console.log(`${format}: direct edits, draft, Esc, undo/redo, duration and particles passed`)
  }
} finally {
  await browser.close()
  await server.close()
}
