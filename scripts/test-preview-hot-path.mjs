// Run with: node scripts/test-preview-hot-path.mjs
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: false } })
await server.listen()
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  // Exercise a real canvas without starting the editor or its background work.
  await page.route('**/fixture', route => route.fulfill({ contentType: 'text/html', body: '<main><canvas></canvas></main>' }))
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/fixture`)
  const result = await page.evaluate(async () => {
    const { Preview } = await import('/src/preview.ts')
    const { IniDocument } = await import('/src/ini.ts')
    const canvas = document.querySelector('canvas')
    const p = new Preview(canvas, () => {}, () => {})
    const doc = IniDocument.parse(Array.from({ length: 64 }, (_, i) =>
      `[KEY${i + 1}]\nVIEW_RECT=${i % 8 * 50},${Math.floor(i / 8) * 50},50,50\nCENTER=a`).join('\n'))
    p.setDocument(doc)
    p.setGuides(true)
    await p.whenDrawn()
    const initial = p.keys
    p.setNativeItems(undefined)
    const redundantRebuild = initial !== p.keys
    await p.whenDrawn()
    const overlay = p.guidesOverlay
    let svgMutations = 0, addedGroups = 0
    const observer = new MutationObserver(records => {
      svgMutations += records.length
      for (const record of records) if (record.target === overlay) addedGroups += record.addedNodes.length
    })
    observer.observe(overlay, { childList: true, attributes: true, subtree: true })
    for (let i = 0; i < 20; ++i) await p.whenDrawn()
    observer.disconnect()
    p.keys[0].rect.x += 7
    p.setSelected(['KEY1'])
    await p.whenDrawn()
    const first = overlay.firstElementChild
    const moved = [first.classList.contains('selected'), first.querySelector('rect').getAttribute('x'), first.querySelector('text').getAttribute('x')]
    initial[0].rect.y = p.panelHeight + 10
    const fullHeight = initial[0].rect.y + initial[0].rect.height
    let nativeLists = 0
    p.setNativeItems((_, persistent) => { nativeLists++; return persistent ? [] : [initial[0]] })
    const nativeListsOnInstall = nativeLists
    const reduced = p.keys.length
    await p.whenDrawn()
    const reducedGuides = overlay.childElementCount
    p.setPersistentOnly(true)
    const persistentHeight = p.surfaceHeight
    p.setNativeItems(undefined)
    p.setPersistentOnly(false)
    await p.whenDrawn()
    const restored = overlay.childElementCount
    p.destroy()
    return { redundantRebuild, nativeListsOnInstall, svgMutations, addedGroups, moved, reduced, reducedGuides, fullHeight, persistentHeight, restored }
  })
  console.log(result)
  assert.equal(result.redundantRebuild, false)
  assert.equal(result.nativeListsOnInstall, 1)
  assert.equal(result.svgMutations, 0)
  assert.equal(result.addedGroups, 0)
  assert.deepEqual(result.moved, [true, '7', '11'])
  assert.equal(result.reduced, 1)
  assert.equal(result.reducedGuides, 1)
  assert.equal(result.persistentHeight, result.fullHeight)
  assert.equal(result.restored, 64)
} finally {
  await browser.close()
  await server.close()
}
