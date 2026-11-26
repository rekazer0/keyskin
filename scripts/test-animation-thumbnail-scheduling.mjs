// Count real canvas paints at mount and when an in-flight sample finishes after scrolling away.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 41885, strictPort: false, hmr: false } })
await server.listen()
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 480, height: 240 } })
  await page.route('**/fixture', route => route.fulfill({ contentType: 'text/html', body:
    '<!doctype html><link rel="stylesheet" href="/src/tokens.css"><link rel="stylesheet" href="/src/components.css"><div id="spacer"></div>' }))
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/fixture`)
  await page.evaluate(async () => {
    const { animationPlayer } = await import('/src/animation-player.ts')
    const { iniPreviewClip } = await import('/src/animation-preview-model.ts')
    const { IniDocument } = await import('/src/ini.ts')
    const ini = IniDocument.parse('[ANIM1]\nTYPE=0\nFROM=255\nTO=160\nDURATION=1000')
    const sample = Promise.withResolvers()
    window.finishSample = sample.resolve
    window.draws = Array(24).fill(0)
    window.firstCardPaintTimes = []
    window.samples = Array(24).fill(0)
    window.loads = Array(24).fill(0)
    document.querySelector('#spacer').style.height = `${innerHeight * 4}px`
    for (let i = 0; i < window.draws.length; ++i) {
      const clip = iniPreviewClip(ini, 'ANIM1')
      const value = clip.tracks[0].value
      clip.tracks[0].value = at => { ++window.samples[i]; return value(at) }
      const player = animationPlayer({ key: String(i), thumbnail: true, clip, sample() { ++window.loads[i]; return sample.promise } })
      const ctx = player.querySelector('canvas').getContext('2d')
      const clear = ctx.clearRect.bind(ctx)
      ctx.clearRect = (...args) => {
        ++window.draws[i]
        if (i === 0) window.firstCardPaintTimes.push(performance.now())
        clear(...args)
      }
      document.body.append(player)
    }
  })
  const card = page.locator('.ui-animation-player').first()
  const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await frames()
  const mounted = await page.evaluate(() => ({ paints: window.draws.reduce((a, b) => a + b), loads: window.loads.reduce((a, b) => a + b) }))
  await card.scrollIntoViewIfNeeded()
  await page.waitForFunction(() => window.loads[0] === 1)
  await page.evaluate(() => scrollTo(0, 0))
  await frames()
  const counts = () => page.evaluate(() => [window.draws[0], window.samples[0]])
  const [before, samples] = await counts()
  await page.evaluate(() => window.finishSample())
  await card.locator('[aria-busy="false"]').waitFor({ state: 'attached' })
  const [after, sampled] = await counts()
  const latePaints = after - before, lateSamples = sampled - samples
  await card.scrollIntoViewIfNeeded()
  await page.waitForFunction(n => window.draws[0] >= n + 2, after)
  const keyWidth = await card.locator('canvas').evaluate(c => {
    const { data } = c.getContext('2d').getImageData(0, Math.floor(c.height / 2), c.width, 1)
    return data.filter((alpha, i) => i % 4 === 3 && alpha > 0).length
  })
  console.log({ mounted, latePaints, lateSamples, keyWidth })
  assert.deepEqual(mounted, { paints: 0, loads: 0 })
  assert.equal(latePaints, 0)
  assert.equal(lateSamples, 0)
  assert.ok(keyWidth > 100, 'returning to the card paints the fitted thumbnail, not the unscaled 64-unit key')
  const replayGap = await (await page.waitForFunction(() => window.firstCardPaintTimes
    .map((time, i, times) => time - times[i - 1]).find(gap => gap >= 350), null, { timeout: 4000 })).jsonValue()
  assert.ok(replayGap >= 495 && replayGap < 600, `thumbnail holds the final frame for 500 ms before replaying (${replayGap} ms)`)
} finally { await browser.close(); await server.close() }
