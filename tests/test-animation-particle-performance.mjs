// Exercise a real workspace with the 1000-particle, 50-second lifetime case. Assert work counts, not FPS.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { bdsFixture } from '../tests/helpers/baidu-fixture.mjs'
import { dismissStartupDisclaimer } from '../tests/helpers/open-editor-template.mjs'
import { SkinArchive } from '../src/skin.ts'

const archive = SkinArchive.open(bdsFixture())
const path = 'light/skin/res/anim.ini'
archive.setText(path, `${archive.getText(path)}
[ANIM1314]
CATEGORY=3
TYPE=1
LIFE=50000,50000
EMIT_REGION=0,0,1,1
TOTAL_NUMBER=1000
BIRTH_RATE=20
PARTICLE_IMAGE=1314
VELOCITY=120,120
VELOCITY_DIRECTION=270,270
ACCELERATION=100,100
ACCELERATION_DIRECTION=90,90
INIT_SCALE=6,6
SCALE_SPEED=-0.1,0.1
INIT_ROTATE=10,20
ROTATE_SPEED=0,360
INIT_ALPHA=200,200
ALPHA_SPEED=-80,-10
REPEAT_CNT=inf
`)
const styles = 'light/skin/res/default.css'
archive.setText(styles, `${archive.getText(styles)}
[STYLE1314]
NM_COLOR=FFFF0000
`)
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 41882, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await dismissStartupDisclaimer(page)
  await page.locator('#browser-open').setInputFiles({ name: 'dense-particles.bds', mimeType: 'application/octet-stream', buffer: Buffer.from(await archive.platformBytesAsync('bds')) })
  await page.waitForFunction(() => !document.querySelector('#open').disabled)
  const close = page.locator('#file-operation-dialog[open] #file-operation-close')
  if (await close.isVisible()) await close.click()
  await page.evaluate(() => {
    const work = window.particleWork = { arcs: 0, builds: 0 }
    const arc = Path2D.prototype.arc
    Path2D.prototype.arc = function (...args) { work.arcs++; return arc.apply(this, args) }
    const fill = CanvasRenderingContext2D.prototype.fill
    CanvasRenderingContext2D.prototype.fill = function (...args) {
      if (args[0] instanceof Path2D && !this.canvas.isConnected) work.builds++
      return fill.apply(this, args)
    }
  })
  await page.locator('[data-workspace-page="animation"]').click()
  const card = page.locator('#animation-library [data-animation-id="ANIM1314"]')
  const thumbnail = card.locator('.ui-animation-player[data-playing="true"] canvas')
  const snapshot = locator => locator.evaluate(canvas => canvas.toDataURL())
  const counts = () => page.evaluate(() => ({ ...window.particleWork }))
  const initialFrame = await snapshot(thumbnail)
  const mounted = await counts()
  assert.equal(mounted.builds, 1, 'mount builds one cached trail for the visible particle card')
  assert.ok(mounted.arcs > 0 && mounted.arcs < 3000, `dense trail coalesces into bitmap cells: ${mounted.arcs} arcs`)
  await page.waitForFunction(initial => document.querySelector('[data-animation-id="ANIM1314"] .ui-animation-player canvas')?.toDataURL() !== initial, initialFrame)
  assert.deepEqual(await counts(), mounted, 'live particles change pixels without rebuilding or refilling the trail')
  await page.evaluate(() => { document.documentElement.dataset.interfaceTheme = 'paper' })
  await page.waitForFunction(() => window.particleWork.builds === 2)
  assert.equal((await counts()).arcs, mounted.arcs, 'a new accent rerasterizes the existing geometry only')

  await card.click()
  const player = page.locator('#animation-stage .ui-animation-player')
  const canvas = player.locator('canvas')
  const scrub = player.getByRole('slider', { name: '预览时间' })
  await scrub.fill('1000')
  const first = await snapshot(canvas)
  const opened = await counts()
  assert.equal(opened.builds, 3, 'selecting the animation builds a separate editor trail')
  await scrub.fill('2500')
  assert.notEqual(await snapshot(canvas), first, 'scrubbing still updates the live particles')
  assert.deepEqual(await counts(), opened, 'scrubbing does not rebuild the editor trail')
  console.log({ thumbnailArcs: mounted.arcs, editorArcs: opened.arcs - mounted.arcs, builds: opened.builds })
} finally {
  await browser.close()
  await server.close()
}
