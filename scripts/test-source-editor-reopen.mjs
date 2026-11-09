import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium, webkit } from 'playwright'
import { createServer } from 'vite'
import { SkinArchive } from '../src/skin.ts'

// More than seven million estimated pixels triggers CodeMirror's large-document height scaler.
const largeJson = process.env.SOURCE_EDITOR_SAMPLE
  ? SkinArchive.open(new Uint8Array(readFileSync(process.env.SOURCE_EDITOR_SAMPLE)), 'sxi').getText('skin.json')
  : JSON.stringify({ values: Array.from({ length: 510000 }, (_, i) => i) }, null, 2)
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 41860, strictPort: false } })
await server.listen()
try {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, bypassCSP: true })
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
      const result = await page.evaluate(async largeJson => {
        const { SourceCodeEditor } = await import('/src/source-editor.ts')
        const host = document.querySelector('#source')
        const pane = document.querySelector('#source-editor')
        pane.hidden = false
        const editor = new SourceCodeEditor(host)
        let inputs = 0, commits = 0, cursorMoves = 0
        editor.addEventListener('input', () => inputs++)
        editor.addEventListener('change', () => commits++)
        editor.addEventListener('cursormove', () => cursorMoves++)
        const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        try {
          editor.value = '[KEY1]\nCENTER=q'
          await settle()
          pane.hidden = true
          for (let i = 0; i < 3; i++) {
            editor.value = largeJson
            editor.setLanguage('json')
            editor.setDecorations({ searchRanges: [[0, 1]] })
            editor.readOnly = true
            await settle()
            if (editor.value !== largeJson) throw new Error('large JSON changed on replacement')
            if (editor.renderedLineCount > 1000) throw new Error('the hidden editor rendered the whole JSON')
            pane.hidden = false
            editor.requestMeasure()
            await settle()
            pane.hidden = true
            editor.value = '[KEY1]\nCENTER=q\n[KEY2]\nCENTER=w'
            editor.setLanguage('ini')
            await settle()
          }
          const programmatic = { inputs, commits, cursorMoves }
          const sections = host.querySelectorAll('.source-section-scrollbar button').length
          pane.hidden = false
          editor.disabled = false
          editor.readOnly = false
          editor.setSelectionRange(editor.value.length, editor.value.length, false)
          editor.replaceRange(editor.value.length, editor.value.length, '\nSHOW=测')
          editor.commit()
          await settle()
          return { programmatic, sections, inputs, commits, value: editor.value }
        } finally {
          editor.destroy()
        }
      }, largeJson)
      assert.deepEqual(result.programmatic, { inputs: 0, commits: 0, cursorMoves: 0 }, 'loading source must not emit edits or move canvas selection')
      assert.equal(result.sections, 2, 'INI section navigation survives document replacements')
      assert.equal(result.inputs, 1)
      assert.equal(result.commits, 1)
      assert.ok(result.value.endsWith('\nSHOW=测'), 'source remains editable after reopening')
      assert.deepEqual(errors, [])
      console.log(`${engine.name()}: visible/hidden source repeatedly switches large JSON and INI; text, editing, sections and virtualization preserved`)
    } finally {
      await browser.close()
    }
  }
} finally {
  await server.close()
}
