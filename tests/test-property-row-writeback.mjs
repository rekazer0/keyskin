import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { bdsFixture } from '../tests/helpers/baidu-fixture.mjs'
import { dismissStartupDisclaimer } from '../tests/helpers/open-editor-template.mjs'

test('通用属性行：键盘编辑与皮肤写回', async t => {
  const server = await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'error', server: { port: 41982, strictPort: false, hmr: false } })
  await server.listen()
  t.after(() => server.close())
  const browser = await chromium.launch()
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.route('**/row-test', route => route.fulfill({ contentType: 'text/html', body: '<body></body>' }))
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/row-test`)
  const mount = (spec, editable = true) => page.evaluate(async ({ spec, editable }) => {
    const { field } = await import('/src/app/property-rows.ts')
    window.writes = []
    document.body.replaceChildren(field({ key: 'VALUE', label: '属性', editable, spec, commit: value => window.writes.push(value) }))
  }, { spec, editable })
  const writes = () => page.evaluate(() => window.writes)
  const incomplete = async input => {
    await input.press('ControlOrMeta+a')
    await input.press('-')
    assert.equal(await input.evaluate(el => el.validity.badInput), true)
    await input.press('Tab')
  }
  for (const [kind, spec] of [
    ['单值', { kind: 'number', value: '30', range: 'duration' }],
    ['分量', { kind: 'parts', affixes: ['X', 'Y'], values: ['30', '5'] }],
  ]) await t.test(`${kind}：未输完的负数不等于清空`, async () => {
    await mount(spec)
    const input = page.getByRole('spinbutton').first()
    await incomplete(input)
    assert.deepEqual(await writes(), [])
    assert.equal(await input.inputValue(), '30')
    await input.fill(''); await input.press('Tab')
    assert.deepEqual(await writes(), [spec.kind === 'parts' ? ['', '5'] : ''])
  })
  await t.test('只校验编辑的分量，保留另一格原始写法', async () => {
    await mount({ kind: 'parts', expression: true, affixes: ['X', 'Y'], values: ['1e-3', '2'] })
    const y = page.getByRole('textbox', { name: '属性Y' })
    await y.fill('rand(-2, 2)'); await y.press('Tab')
    await y.fill('rand(,)'); await y.press('Tab')
    assert.equal(await y.inputValue(), 'rand(-2, 2)')
    assert.deepEqual(await writes(), [['1e-3', 'rand(-2, 2)']])
  })
  await t.test('有范围的表达式字段：普通数字可滑动，rand / inf 不被滑块转成零', async () => {
    await mount({ kind: 'number', value: '30', expression: true, range: 'alpha' })
    const slider = page.getByRole('slider'), text = page.getByRole('textbox')
    assert.equal(await slider.count(), 1)
    await slider.press('ArrowRight')
    for (const value of ['rand(2,5)', 'inf']) {
      await text.fill(value); await text.press('Tab')
      assert.equal(await slider.isDisabled(), true)
    }
    await text.fill('42'); await text.press('Tab')
    assert.equal(await slider.isEnabled(), true)
    assert.equal(await slider.inputValue(), '42')
    assert.deepEqual(await writes(), ['31', 'rand(2,5)', 'inf', '42'])
  })
  await t.test('只读行不接受数值 change 通知', async () => {
    await mount({ kind: 'number', value: '30', range: 'duration' }, false)
    assert.equal(await page.getByRole('slider').isDisabled(), true)
    const input = page.getByRole('spinbutton')
    assert.equal(await input.isDisabled(), true)
    await input.evaluate(el => { el.value = '44'; el.dispatchEvent(new Event('change', { bubbles: true })) })
    assert.deepEqual(await writes(), [])
  })
  await t.test('禁用的开关收到 change 也不写入皮肤', async () => {
    await mount({ kind: 'switch', checked: false }, false)
    const toggle = page.getByRole('switch')
    assert.equal(await toggle.isDisabled(), true)
    await toggle.evaluate(el => { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })) })
    assert.deepEqual(await writes(), [])
  })
  await t.test('BDS 动画：错误输入不删时长，表达式原样写回 anim.ini', async () => {
    const path = 'light/skin/res/anim.ini'
    const source = () => page.evaluate(async path => (await import('/src/app/state.ts')).appState.archive.getText(path), path)
    await page.goto(new URL('/', page.url()).href)
    await dismissStartupDisclaimer(page)
    await page.locator('#browser-open').setInputFiles({ name: 'row.bds', mimeType: 'application/octet-stream', buffer: Buffer.from(bdsFixture()) })
    await page.waitForFunction(() => !document.querySelector('#open').disabled)
    const close = page.locator('#file-operation-dialog[open] #file-operation-close')
    if (await close.isVisible()) await close.click()
    await page.getByRole('button', { name: '编辑模式', exact: true }).click()
    await page.evaluate(async path => (await import('/src/app/navigation.ts')).selectFile(path), path)
    const fields = page.locator('#document-fields')
    const before = await source()
    assert.match(before, /DURATION=200/)
    await incomplete(fields.getByRole('spinbutton', { name: '时长', exact: true }))
    assert.equal(await source(), before)
    const angle = fields.getByRole('textbox', { name: '起始角度', exact: true })
    await angle.fill('rand(-2,5)'); await angle.press('Tab')
    assert.match(await source(), /^FROM=rand\(-2,5\)$/m)
  })
})
