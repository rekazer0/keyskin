// 同一会话里连续保存 BDS：第二次保存必须和第一次一样完整。写出的文件里有切好的文字图片和图集，
// 它们不属于文档；以前保存后把写出的包当成文档的来源，再保存时这些图片被丢掉而样式仍然引用它们。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { strFromU8, unzipSync } from 'fflate'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { IniDocument } from '../src/ini.ts'

const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 41873, strictPort: false } })
await server.listen()
let browser
try {
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    window.savedFiles = []
    window.showSaveFilePicker = async () => ({ name: '连续保存.bds', createWritable: async () => ({
      write: async bytes => { window.savedFiles.push(Array.from(bytes)) },
      close: async () => {},
    }) })
  })
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.locator('#browser-open').setInputFiles({ name: '连续保存.bds', mimeType: 'application/octet-stream', buffer: readFileSync(new URL('../public/sogou-template.bds', import.meta.url)) })
  await page.waitForFunction(() => !document.querySelector('#save').disabled)
  await page.waitForFunction(() => !document.querySelector('#file-operation-dialog').open)
  await page.getByRole('button', { name: '编辑模式', exact: true }).click()
  const canvas = await page.locator('#preview').boundingBox()
  await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2)
  const width = page.locator('.ui-input:visible', { hasText: /^W/ }).locator('input:visible').first()
  await width.waitFor()

  const dialog = page.locator('#file-operation-dialog')
  const save = async (value) => {
    if (value) {
      await width.fill(value)
      await width.press('Enter')
      await page.locator('.ui-badge:visible', { hasText: '未保存' }).waitFor()
    }
    await page.keyboard.press('ControlOrMeta+s')
    await dialog.getByText('保存完成').first().waitFor()
    await dialog.locator('#file-operation-close').click()
    await page.waitForFunction(() => !document.querySelector('#file-operation-dialog').open)
    return unzipSync(new Uint8Array(await page.evaluate(() => window.savedFiles.at(-1))))
  }
  const first = await save()
  const second = await save('301')
  const third = await save('302')
  assert.equal(await page.locator('.ui-badge:visible', { hasText: '未保存' }).count(), 0, '⌘/Ctrl+S saves and clears the unsaved mark')

  const dangling = (files) => {
    const missing = []
    for (const path of Object.keys(files).filter(name => name.endsWith('default.css'))) {
      const css = IniDocument.parse(strFromU8(files[path]))
      const roots = [path.replace(/default\.css$/, ''), path.replace(/(?:port|land)\/res\/default\.css$/, 'res/')]
      for (const { key, value } of css.entries()) {
        if (key !== 'NM_IMG' && key !== 'HL_IMG') continue
        const name = value.split(',')[0].trim()
        if (!roots.some(root => files[`${root}${name}.til`] && files[`${root}${name}.png`])) missing.push(`${path} ${key}=${value}`)
      }
    }
    return missing
  }
  const baked = (files) => Object.keys(files).filter(name => /keyskin_/.test(name)).length
  for (const [label, files] of [['first', first], ['second', second], ['third', third]]) {
    assert.ok(baked(files) > 0, `${label} save carries the baked images`)
    assert.deepEqual(dangling(files), [], `${label} save: every style image exists`)
  }
  assert.deepEqual(errors, [])
  console.log(`PASS: three saves in one session each write a complete package (${Object.keys(third).length} files, every style image present)`)
} finally {
  await browser?.close()
  await server.close()
}
