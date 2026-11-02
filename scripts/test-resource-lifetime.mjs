import assert from 'node:assert/strict'
import { chromium, webkit } from 'playwright'
import { createServer } from 'vite'

const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 41946, strictPort: false, hmr: false } })
await server.listen()
try {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch()
    try {
      for (const mobile of [false, true]) {
        const context = await browser.newContext({ viewport: { width: mobile ? 390 : 1440, height: 1000 }, isMobile: mobile, hasTouch: mobile, bypassCSP: true })
        const page = await context.newPage()
        const errors = []
        page.on('pageerror', error => errors.push(error.message))
        await page.addInitScript(() => {
          const records = []
          for (const name of ['MutationObserver', 'ResizeObserver', 'IntersectionObserver']) {
            const Native = window[name]
            window[name] = class extends Native {
              constructor(callback, options) { super(callback, options); this.targets = new Set(); records.push({ name, targets: this.targets }) }
              observe(target, options) { this.targets.add(target); return super.observe(target, options) }
              unobserve(target) { this.targets.delete(target); return super.unobserve(target) }
              disconnect() { this.targets.clear(); return super.disconnect() }
            }
          }
          const listeners = new Set()
          const add = document.addEventListener.bind(document), remove = document.removeEventListener.bind(document)
          document.addEventListener = (type, callback, options) => {
            if (type === 'visibilitychange') {
              listeners.add(callback)
              options?.signal?.addEventListener('abort', () => listeners.delete(callback), { once: true })
            }
            return add(type, callback, options)
          }
          document.removeEventListener = (type, callback, options) => {
            if (type === 'visibilitychange') listeners.delete(callback)
            return remove(type, callback, options)
          }
          window.resourceLifetime = () => ({
            observers: Object.fromEntries(['MutationObserver', 'ResizeObserver', 'IntersectionObserver'].map(name => [name, {
              active: records.filter(r => r.name === name && r.targets.size).length,
              detached: records.filter(r => r.name === name).flatMap(r => [...r.targets]).filter(node => !node.isConnected).length,
            }])), visibilityListeners: listeners.size,
          })
        })
        try {
          await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
          await page.locator('.template-card[data-template="xiaomi-unified-rounded-blur"]').click()
          await page.waitForSelector('.canvas-wrap:not(.empty)')
          await page.waitForFunction(() => document.querySelector('#preview')?.getBoundingClientRect().height > 60)
          await page.waitForFunction(() => !document.querySelector('#open').disabled && !document.querySelector('#file-operation-dialog').open)
          const result = await page.evaluate(async () => {
            const { renderFiles } = await import('/src/app/file-tree.ts')
            const { selectFile } = await import('/src/app/navigation.ts')
            const { preview } = await import('/src/app/canvas-interaction.ts')
            const { appState } = await import('/src/app/state.ts')
            const { animationPlayer } = await import('/src/animation-player.ts')
            const { renderStyleReferenceRows, refreshStyleReferenceThumbnail } = await import('/src/app/style-references.ts')
            const settle = async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); await new Promise(resolve => setTimeout(resolve, 160)) }
            await settle()
            const before = resourceLifetime()
            const paths = [...document.querySelectorAll('.sidebar-overview .nav-layout')].map(node => node.dataset.path)
            for (let i = 0; i < 40; i++) {
              selectFile(paths[i % paths.length])
              await preview.whenDrawn()
              renderFiles()
            }
            selectFile(paths[0])
            await settle()
            const afterTree = resourceLifetime()
            const clip = { duration: 200, tracks: [{ kind: 'scale', start: 0, duration: 200, passes: 1, value: () => [1, 1] }], particles: [], images: [], lanes: [], notes: [] }
            const abandoned = []
            for (let i = 0; i < 40; i++) {
              const root = animationPlayer({ clip, key: `lifetime:${i}`, thumbnail: true })
              abandoned.push(root.querySelector('canvas'))
              if (i % 3 === 0) { root.hidden = true; document.body.append(root) }
              else if (i % 3 === 1) document.body.append(root)
              await new Promise(requestAnimationFrame)
              root.remove()
            }
            let resolveSample
            const loading = animationPlayer({ clip, key: 'loading', sample: () => new Promise(resolve => { resolveSample = resolve }) })
            document.body.append(loading)
            loading.remove()
            abandoned.push(loading.querySelector('canvas'))
            await settle()
            resolveSample({ width: 64, height: 64, layers: [], trial: false })
            const direct = animationPlayer({ clip, key: 'curve', direct: {
              text: '[ANIM1]\nCATEGORY=0\nTYPE=3\nDURATION=200\nFROM=50,50\nTO=100,100\nINTPOL=0', section: 'ANIM1', editable: true, commit() {},
            } })
            document.body.append(direct)
            abandoned.push(...direct.querySelectorAll('canvas'))
            if (direct.querySelectorAll('canvas').length !== 2) throw new Error('direct editor includes the curve canvas')
            await settle()
            direct.remove()
            const host = document.createElement('span'), input = document.createElement('input')
            document.body.append(host)
            input.value = ''
            for (let i = 0; i < 40; i++) {
              renderStyleReferenceRows(host, input, 'BACK_STYLE')
              abandoned.push(...host.querySelectorAll('canvas'))
              await new Promise(requestAnimationFrame)
            }
            // Reused canvas must keep its bitmap, not be mistaken for a removed node.
            const reused = host.querySelector('canvas')
            renderStyleReferenceRows(host, input, 'BACK_STYLE')
            await settle()
            const preserved = reused === host.querySelector('canvas') && reused.width > 0
            host.remove()
            const resolveVisuals = []
            const late = document.createElement('span')
            document.body.append(late)
            input.value = '1'
            const pending = refreshStyleReferenceThumbnail(late, input, 'BACK_STYLE', { resolve: () => new Promise(resolve => { resolveVisuals.push(resolve) }) })
            abandoned.push(...late.querySelectorAll('canvas'))
            late.remove()
            await settle()
            resolveVisuals.forEach(resolve => resolve(undefined))
            await pending
            await settle()
            return { before, afterTree, after: resourceLifetime(), preserved, unreleased: abandoned.filter(canvas => canvas.width || canvas.height).length, archive: Boolean(appState.archive) }
          })
          assert.equal(result.archive, true)
          assert.equal(result.preserved, true, 'synchronous canvas reuse keeps its bitmap')
          assert.equal(result.unreleased, 0, 'removed and unused canvas bitmaps are released')
          for (const stats of [result.afterTree, result.after]) {
            for (const name of ['MutationObserver', 'ResizeObserver', 'IntersectionObserver']) {
              assert.equal(stats.observers[name].detached, 0, `${name} must not retain removed nodes`)
              assert(stats.observers[name].active <= result.before.observers[name].active + 1, `${name} count stays bounded`)
            }
            assert.equal(stats.visibilityListeners, result.before.visibilityListeners, 'thumbnail visibility listeners return to baseline')
          }
          assert.deepEqual(errors, [])
          console.log(`${engine.name()} ${mobile ? 'mobile' : 'desktop'}: 40 tree/layout rebuilds, hidden/unused/playing thumbnails, canvas reuse and async disposal passed`)
        } finally { await context.close() }
      }
    } finally { await browser.close() }
  }
} finally { await server.close() }
