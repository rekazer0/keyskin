import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { chromium } from 'playwright'
import ts from 'typescript'

const source = ts.transpile(readFileSync(new URL('../src/webview-compat.ts', import.meta.url), 'utf8'), { target: ts.ScriptTarget.ES2019 })

test('WebView startup retains native APIs and supplies missing file and DOM APIs', {
  skip: !existsSync(chromium.executablePath()) && 'Playwright Chromium not installed',
}, async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.evaluate(() => {
      window.runtimeAPIs = [
        [Array.prototype, 'at'], [Object, 'hasOwn'], [String.prototype, 'replaceAll'], [Promise, 'allSettled'],
        [Blob.prototype, 'arrayBuffer'], [Blob.prototype, 'stream'], [Element.prototype, 'replaceChildren'],
        [Element.prototype, 'checkVisibility'], [Element.prototype, 'getAnimations'], [CanvasRenderingContext2D.prototype, 'roundRect'],
        [HTMLFormElement.prototype, 'requestSubmit'], [window, 'SubmitEvent'], [Crypto.prototype, 'randomUUID'],
      ].map(([target, name]) => [target, name, Object.getOwnPropertyDescriptor(target, name)])
    })
    await page.addScriptTag({ content: source })
    assert.deepEqual(await page.evaluate(() => window.runtimeAPIs.flatMap(([target, name, desc]) => {
      const current = Object.getOwnPropertyDescriptor(target, name)
      return desc && (current.value !== desc.value || current.get !== desc.get) ? [name] : []
    })), [])
    await page.evaluate(() => window.runtimeAPIs.forEach(([target, name]) => Reflect.deleteProperty(target, name)))
    await page.addScriptTag({ content: source })

    const result = await page.evaluate(async () => {
      const file = new File([new Uint8Array([0, 128, 255])], 'small.bds')
      const bytes = new Uint8Array(8 * 1024 * 1024)
      bytes[bytes.length - 1] = 255
      const reader = new File([bytes], 'large.bds').stream().getReader()
      let size = 0, chunks = 0, last = 0
      for (let item; !(item = await reader.read()).done;) {
        size += item.value.length
        chunks++
        last = item.value[item.value.length - 1]
      }
      const dialog = document.createElement('dialog')
      dialog.innerHTML = '<form method="dialog"><input required><button value="save"><span>Save</span></button></form>'
      document.body.append(dialog)
      const form = dialog.querySelector('form'), button = form.querySelector('button')
      let submitter
      form.addEventListener('submit', event => { submitter = event.submitter })
      dialog.showModal()
      form.requestSubmit(button)
      const validates = dialog.open
      form.querySelector('input').value = 'name'
      form.requestSubmit(button)
      const submit = [validates, dialog.open, dialog.returnValue, submitter === button]
      const el = document.createElement('div')
      el.append(button, 'old')
      el.replaceChildren('<tag>', button)
      return {
        small: [...new Uint8Array(await file.arrayBuffer())], large: [size, chunks > 1, last],
        children: [el.innerHTML, el.lastChild === button], submit,
        at: [1, 2].at(-1), own: Object.hasOwn({ hasOwnProperty: 0 }, 'hasOwnProperty'),
        replace: 'a.b.c'.replaceAll('.', '[$&]'),
        settled: await Promise.allSettled([42, Promise.reject('failed')]),
        uuid: /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/.test(crypto.randomUUID()),
      }
    })
    assert.deepEqual(result, {
      small: [0, 128, 255], large: [8 * 1024 * 1024, true, 255],
      children: ['&lt;tag&gt;<button value="save"><span>Save</span></button>', true], submit: [true, false, 'save', true],
      at: 2, own: true, replace: 'a[.]b[.]c', settled: [{ status: 'fulfilled', value: 42 }, { status: 'rejected', reason: 'failed' }],
      uuid: true,
    })
  } finally {
    await browser.close()
  }
})
