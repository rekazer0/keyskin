import { openEditorTemplate } from "../tests/helpers/open-editor-template.mjs"
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { mkdirSync } from 'node:fs'

const server = await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'error', server: { host: '127.0.0.1', port: 41766, strictPort: false, hmr: false } })
await server.listen()
let browser
try {
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, bypassCSP: true, reducedMotion: 'reduce' })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/src/ai-design.ts', route => route.fulfill({
    contentType: 'application/javascript',
    body: `export { generateAiImagePreview } from '/src/ai-design.ts?image-test-real';
    export async function runAiSkinDesign(config, project, prompt, options) {
      if (window.sessionMode) {
        await options.onStatus('reading', '读取测试文件');
        await options.onThinking('测试思考');
        await options.onTextDelta('回答 ' + prompt);
        return { response: '回答 ' + prompt, conversation: [], changes: [] };
      }
      window.designStarted = true;
      if (window.delayDesign) await new Promise(resolve => { window.finishDesign = resolve });
      const file = project.files.find(file => file.syntax === 'ini');
      return { response: '测试设计建议', conversation: [{ role: 'user', content: prompt, timestamp: 1 }],
        changes: [{ path: file.path, syntax: file.syntax, before: file.text, after: file.text + '\\n; AI draft\\n' }] };
    }`,
  }))
  const thinkingRequests = []
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/src/model-thinking.ts') thinkingRequests.push(request.url())
  })
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await openEditorTemplate(page, 'official-android-bds')
  await page.waitForFunction(() => !document.querySelector('#open').disabled && !document.querySelector('#file-operation-dialog').open)
  await page.evaluate(async () => {
    const { appState } = await import('/src/app/state.ts')
    window.modelCalls = []
    window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' } }, invoke: async (command, args) => {
      window.modelCalls.push({ command, args })
      if (command === 'plugin:window|set_theme') return
      if (command === 'model_http_request') {
        const canvas = document.createElement('canvas')
        const encoded = canvas.toDataURL('image/png').split(',')[1]
        args.events.onmessage({ type: 'headers', status: 200, headers: [['content-type', 'application/json']] })
        args.events.onmessage({ type: 'chunk', body: [...new TextEncoder().encode(JSON.stringify({ data: [{ b64_json: encoded }] }))] })
        args.events.onmessage({ type: 'end' })
        return
      }
      if (command === 'fetch_model_thinking_levels') return args.configuration.model === 'deepseek-flash'
        ? ['off', 'low', 'high', 'max'] : ['low', 'medium', 'high', 'xhigh']
      if (command === 'model_oauth_accounts') return [{ provider: 'chatgpt-subscription', email: 'test@example.com' }]
      if (command === 'save_model_configuration') {
        window.savedModelConfigurations = args.configurations
        return { path: 'test.json', configurations: args.configurations }
      }
      if (command === 'load_model_configuration') return { path: 'test.json', configurations: window.savedModelConfigurations ?? [
        { provider: 'chatgpt-subscription', protocol: 'openai-codex', apiUrl: 'https://chatgpt.com/backend-api/codex', apiKey: '', model: 'gpt-image-test', kind: 'image' },
        { provider: 'openai-compatible', protocol: 'openai-chat', apiUrl: 'https://example.com/v1', apiKey: 'test', model: 'custom-test' },
        { provider: 'openai-compatible', protocol: 'openai-chat', apiUrl: 'https://example.com/v1', apiKey: 'test', model: 'another-model' },
      ] }
      if (command === 'fetch_model_list') {
        if (window.failImageList) throw new Error('test API unavailable')
        return ['gpt-6', 'gpt-image-official', 'gpt-image-next']
      }
      throw new Error(`Unexpected command: ${command}`)
    } }
    appState.savedModels = [
      { provider: 'chatgpt-subscription', protocol: 'openai-codex', model: 'account-model', apiUrl: '', apiKey: '' },
      { provider: 'openai', protocol: 'openai-chat', model: 'gpt-4o', apiUrl: '', apiKey: '' },
      { provider: 'deepseek', protocol: 'openai-chat', model: 'deepseek-flash', apiUrl: 'https://api.deepseek.com/v1', apiKey: 'test' },
      { provider: 'openai-compatible', protocol: 'openai-chat', model: 'custom-test', apiUrl: 'https://example.com/v1', apiKey: 'test', thinkingOverride: ['off', 'xhigh'] },
    ]
    const select = document.querySelector('#ai-design-model')
    select.replaceChildren(...appState.savedModels.map((model, index) => new Option(model.model, String(index))))
    select.hidden = false
    document.querySelector('#ai-design-thinking').hidden = false
    document.querySelector('#ai-design-intensity').hidden = false
    document.querySelector('.ai-design-toolbar .ai-design-settings').hidden = true
    document.querySelector('[data-inspector-tab="ai"]').hidden = false
  })
  assert.equal(thinkingRequests.length, 0, 'opening a skin does not load model thinking catalogs')
  await page.locator('[data-inspector-tab="ai"]').dispatchEvent("click")
  await page.locator('#ai-design-chat .ai-resize').waitFor()
  await page.waitForFunction(() => !document.querySelector('#ai-design-thinking').disabled)
  assert.equal(thinkingRequests.length, 1, 'opening AI loads the catalog once')
  const thinking = page.locator('#ai-design-thinking')
  assert.deepEqual(await thinking.locator('option').allTextContents(), ['low', 'medium', 'high', 'xhigh'])
  assert.equal(await thinking.inputValue(), 'medium')
  await page.locator('#ai-design-model').selectOption('1')
  assert.deepEqual(await thinking.locator('option').allTextContents(), ['off'])
  await page.locator('#ai-design-model').selectOption('2')
  assert.deepEqual(await thinking.locator('option').allTextContents(), ['off', 'low', 'high', 'max'])
  assert.equal(await thinking.inputValue(), 'high')
  await page.locator('#ai-design-model').selectOption('3')
  assert.deepEqual(await thinking.locator('option').allTextContents(), ['off', 'xhigh'])
  assert.equal(await thinking.inputValue(), 'xhigh')
  await page.locator('#ai-design-model').selectOption('0')
  assert.equal(await thinking.inputValue(), 'medium')
  assert.equal(await page.locator('#ai-sessions').isVisible(), false)
  const composer = page.locator('#ai-design-chat #text-input-container')
  const send = page.getByRole('button', { name: '发送消息', exact: true })
  assert.ok(await send.isDisabled(), 'empty composer must not advertise an active send action')
  await composer.screenshot({ path: '/tmp/keyskin-ai-composer-empty.png' })

  // The welcome starts at the top even in a tall inspector; choosing a sample only fills the composer.
  const welcome = page.locator('#ai-design-chat .ai-welcome')
  const heading = await welcome.locator('h2').boundingBox()
  const bar = await page.locator('#ai-design-panel .ai-bar').boundingBox()
  assert.ok(heading.y >= bar.y + bar.height && heading.y < bar.y + bar.height + 48)
  const samples = welcome.locator('button[data-palette]')
  assert.equal(await samples.count(), 6)
  await samples.first().click()
  assert.equal(await page.locator('#ai-design-chat #text-input').innerText(), await samples.first().getAttribute('data-ai-prompt'))
  assert.equal(await page.locator('#ai-design-chat .ai-run').count(), 0)

  // Run the real panel request with a model result that proposes a file change.
  const archiveBefore = await page.evaluate(async () => {
    const { appState } = await import('/src/app/state.ts')
    document.querySelector('#mode').value = 'preview'
    return appState.archive.names().map(path => [path, Array.from(appState.archive.getBytes(path))])
  })
  await page.evaluate(async () => {
    const { appState } = await import('/src/app/state.ts')
    window.__TAURI_INTERNALS__.transformCallback = () => 1
    appState.savedImageModel = { provider: 'openai', protocol: 'openai-chat', apiUrl: 'https://example.com/v1', apiKey: 'test', model: 'gpt-image-test', kind: 'image' }
  })
  await page.locator('#ai-design-chat #text-input').fill('测试生图模型：画一个橙色按键')
  await send.click()
  const generatedImage = page.locator('#ai-design-chat img[src^="data:image/png;base64,"]')
  await generatedImage.waitFor()
  await page.waitForFunction(() => document.querySelector('#ai-design-chat').shadowRoot.querySelector('img[src^="data:image/png;base64,"]')?.naturalWidth > 0)
  await page.locator('#ai-design-chat .ai-run[data-state="done"]').waitFor()
  assert.deepEqual(await page.evaluate(() => window.modelCalls.filter(call => call.command === 'model_http_request').map(({ args }) => [args.request.url, JSON.parse(args.request.body).prompt])), [
    ['https://example.com/v1/images/generations', '画一个橙色按键'],
  ])
  await page.evaluate(async () => {
    const { appState } = await import('/src/app/state.ts')
    if (appState.aiDesignDraft || appState.aiDesignConversation.length) throw new Error('A model test must not change the skin or the design conversation')
    appState.savedImageModel = undefined
  })
  await page.locator('#ai-design-chat #text-input').fill('试试生图模型')
  await send.click()
  await page.getByText(/未配置生图模型，请在设置/).waitFor()
  assert.equal(await page.evaluate(() => window.modelCalls.filter(call => call.command === 'model_http_request').length), 1)
  await page.locator('#ai-design-chat #text-input').fill('分析当前设计')
  assert.equal(await send.getAttribute('data-variant'), 'primary')
  await composer.screenshot({ path: '/tmp/keyskin-ai-composer-send.png' })
  await send.click()
  await page.waitForFunction(() => document.querySelector('#ai-design-status').textContent.includes('不能修改皮肤'))
  assert.deepEqual(await page.evaluate(async () => {
    const { appState } = await import('/src/app/state.ts')
    return appState.archive.names().map(path => [path, Array.from(appState.archive.getBytes(path))])
  }), archiveBefore)
  assert.equal(await page.evaluate(async () => {
    const { appState } = await import('/src/app/state.ts')
    return !appState.aiDesignDraft && !appState.aiDraftPreview && appState.aiDesignConversation[0].content === '分析当前设计'
  }), true)
  assert.equal(await page.locator('#ai-draft-apply').isDisabled(), true)
  await page.evaluate(async () => {
    const { appState } = await import('/src/app/state.ts')
    appState.aiChatController.clear()
    document.querySelector('#mode').value = 'edit'
    window.delayDesign = true
    window.designStarted = false
  })
  await page.locator('#ai-design-chat #text-input').fill('请求期间切回预览')
  await page.locator('#ai-design-chat #text-input').press('Enter')
  await page.waitForFunction(() => window.designStarted)
  await page.evaluate(() => {
    document.querySelector('#mode').value = 'preview'
    window.finishDesign()
  })
  await page.waitForFunction(() => document.querySelector('#ai-design-panel').dataset.state === 'error')
  assert.equal(await page.evaluate(async () => {
    const { appState } = await import('/src/app/state.ts')
    return !appState.aiDesignDraft && !appState.aiDraftPreview
  }), true)

  await page.waitForFunction(() => document.querySelector('#ai-design-send').getAttribute('aria-label') === '发送消息')
  await page.evaluate(() => { window.designStarted = false })
  await page.locator('#ai-design-chat #text-input').fill('测试停止生成')
  await page.locator('#ai-design-chat #text-input').press('Enter')
  await page.waitForFunction(() => window.designStarted)
  const stop = page.getByRole('button', { name: '停止生成', exact: true })
  assert.equal(await stop.getAttribute('data-variant'), 'filled')
  await composer.screenshot({ path: '/tmp/keyskin-ai-composer-stop.png' })
  await stop.focus()
  await stop.press('Space')
  assert.ok(await stop.isDisabled(), 'stop is disabled while cancellation settles')
  await page.evaluate(() => window.finishDesign())
  await page.getByRole('status').filter({ hasText: '已停止 · 未应用任何修改' }).waitFor()
  await send.waitFor()
  assert.ok(await send.isDisabled())

  // Exercise real deep-chat messages, timeline nodes, attachments and typed input across switches.
  await page.evaluate(async () => {
    const { appState } = await import('/src/app/state.ts')
    appState.aiChatController.clear()
    window.sessionMode = true
    document.querySelector('#mode').value = 'edit'
  })
  const chat = page.locator('#ai-design-chat')
  await chat.locator('.ai-resize').waitFor()
  await chat.locator('#text-input').fill('第一个会话。请保留布局，只调整配色')
  await chat.locator('#text-input').press('Enter')
  await chat.locator('.ai-run[data-state="done"]').waitFor()
  await page.evaluate(async () => {
    const { appState } = await import('/src/app/state.ts')
    appState.aiDesignConversation = [{ role: 'user', content: '保留模型上下文', timestamp: 1 }]
    appState.aiChatController.setInput('未发送内容')
    const transfer = new DataTransfer()
    transfer.items.add(new File(['attachment'], 'notes.txt', { type: 'text/plain' }))
    document.querySelector('#ai-design-chat').shadowRoot.querySelector('#text-input')
      .dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true }))
  })
  await page.getByRole('button', { name: '会话', exact: true }).click()
  await page.locator('#ai-sessions').waitFor()
  assert.ok(await page.getByRole('button', { name: '清理记录', exact: true }).isDisabled())
  await page.locator('[data-session-filter="applied"]').click()
  assert.equal(await page.locator('#ai-session-list').innerText(), '暂无已应用的会话')
  await page.locator('[data-session-filter="all"]').click()
  assert.equal(await page.locator('#ai-session-list [role="option"]').count(), 1)
  assert.equal(await page.locator('#ai-session-list [role="option"] strong').innerText(), '第一个会话')
  assert.equal(await page.locator('#ai-new-session [data-icon="message-square"]').count(), 1)
  await page.locator('#ai-design-panel').click({ position: { x: 8, y: 8 } })
  assert.equal(await page.locator('#ai-sessions').isVisible(), false)
  assert.equal(await page.locator('#ai-new-session').getAttribute('aria-expanded'), 'false')
  await page.getByRole('button', { name: '会话', exact: true }).click()
  await page.getByRole('button', { name: '新建会话', exact: true }).click()
  assert.equal(await chat.locator('.ai-run').count(), 0)
  assert.equal(await chat.locator('#text-input').innerText(), '')
  await page.getByRole('button', { name: '会话', exact: true }).click()
  await page.getByRole('option', { name: '第一个会话', exact: true }).click()
  assert.match(await chat.locator('#messages').innerText(), /回答 第一个会话/)
  assert.equal(await chat.locator('.ai-run').count(), 1)
  assert.equal(await chat.locator('#text-input').innerText(), '未发送内容')
  assert.match(await chat.locator('.ai-attachments').innerText(), /notes.txt/)
  assert.equal(await page.evaluate(async () => (await import('/src/app/state.ts')).appState.aiDesignConversation[0].content), '保留模型上下文')
  await page.locator('#ai-session-list').press('Home')
  assert.equal(await chat.locator('.ai-run').count(), 0)
  await page.locator('#ai-session-list').press('End')
  assert.equal(await chat.locator('.ai-run').count(), 1)
  await page.screenshot({ path: '/tmp/keyskin-ai-sessions.png' })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.waitForFunction(() => document.documentElement.dataset.appTheme === 'dark')
  await page.screenshot({ path: '/tmp/keyskin-ai-sessions-dark.png' })
  await page.emulateMedia({ colorScheme: 'light' })
  await page.waitForFunction(() => document.documentElement.dataset.appTheme === 'light')
  await page.locator('#ai-session-list [aria-selected="true"]').press('Escape')
  assert.equal(await page.locator('#ai-sessions').isVisible(), false)
  assert.equal(await page.getByRole('button', { name: '会话', exact: true }).evaluate(el => el === document.activeElement), true)
  await page.evaluate(async () => {
    const { appState } = await import('/src/app/state.ts')
    const { syncAiDesignControls } = await import('/src/app/ai-panel.ts')
    appState.aiDesignBusy = true
    syncAiDesignControls()
  })
  assert.equal(await page.getByRole('button', { name: '会话', exact: true }).isDisabled(), true)

  // Select files independently: preview, deselection, partial apply and undo share the real archive.
  await page.evaluate(async () => {
    const { appState } = await import('/src/app/state.ts')
    const panel = await import('/src/app/ai-panel.ts')
    appState.aiDesignBusy = false
    document.querySelector('#mode').value = 'edit'
    const { IniDocument } = await import('/src/ini.ts')
    const drafts = panel.aiEditableProjectFiles(appState.archive).filter(file => file.syntax === 'ini').slice(0, 2)
      .map((file, index) => {
        const document = IniDocument.parse(file.text)
        if (index === 0) {
          window.reviewSection = document.sections()[0]
          document.set(window.reviewSection, 'MOBILE_REVIEW_ROUND', '14')
          document.set(window.reviewSection, 'MOBILE_REVIEW_SIZE', '18')
        }
        return { path: file.path, syntax: file.syntax, before: file.text, after: index === 0 ? document.toString() : file.text + '\n; selected AI review\n' }
      })
    window.reviewDrafts = drafts
    window.reviewUndoLength = appState.undoStack.length
    panel.setAiDesignDraft({ target: appState.archive, drafts, changes: panel.validatedAiChanges(appState.archive, drafts), sections: [], conversation: [], response: '移动端审阅' })
  })
  const boxes = page.locator('#ai-draft-files > li > details > summary input[type="checkbox"]')
  assert.equal(await boxes.count(), 2)
  await boxes.nth(1).uncheck()
  assert.deepEqual(await page.evaluate(async () => {
    const { appState } = await import('/src/app/state.ts')
    return window.reviewDrafts.map(file => appState.archive.getText(file.path) === file.after)
  }), [true, false])
  const field = page.getByRole('checkbox', { name: /MOBILE_REVIEW_SIZE 的修改$/ })
  await field.uncheck()
  assert.deepEqual(await page.evaluate(async () => {
    const { appState } = await import('/src/app/state.ts')
    const { IniDocument } = await import('/src/ini.ts')
    const document = IniDocument.parse(appState.archive.getText(window.reviewDrafts[0].path))
    return [document.get(window.reviewSection, 'MOBILE_REVIEW_ROUND'), document.get(window.reviewSection, 'MOBILE_REVIEW_SIZE')]
  }), ['14', undefined], 'field selection restores only the excluded property')
  await field.check()
  await boxes.nth(0).uncheck()
  assert.equal(await page.locator('#ai-draft-apply').isDisabled(), true)
  await boxes.nth(0).check()
  await page.locator('#ai-draft-compare').click()
  assert.equal(await page.evaluate(async () => {
    const { appState } = await import('/src/app/state.ts')
    return window.reviewDrafts.every(file => appState.archive.getText(file.path) === file.before)
  }), true)
  await page.locator('#ai-draft-compare').click()
  assert.deepEqual(await page.evaluate(async () => {
    const { appState } = await import('/src/app/state.ts')
    return window.reviewDrafts.map(file => appState.archive.getText(file.path) === file.after)
  }), [true, false])
  mkdirSync('.ui-current/mobile-visual', { recursive: true })
  for (const width of [320, 393, 430]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : width === 430 ? 932 : 852 })
    await page.emulateMedia({ colorScheme: theme })
    await page.evaluate(async () => { (await import('/src/app/mobile-layout.ts')).setMobilePane('inspector') })
    await page.waitForFunction(theme => document.documentElement.dataset.appTheme === theme, theme)
    await page.waitForFunction(() => {
      const keyboard = document.querySelector('#device-shell').getBoundingClientRect()
      const canvas = document.querySelector('.canvas-wrap').getBoundingClientRect()
      return keyboard.width > 0 && keyboard.left >= canvas.left - 1 && keyboard.right <= canvas.right + 1
        && keyboard.top >= canvas.top - 1 && keyboard.bottom <= canvas.bottom + 1
    })
    await page.evaluate(async () => {
      await (await import('/src/app/canvas-interaction.ts')).preview.whenDrawn()
    })
    await page.locator('#ai-draft-files > li details').first().evaluate(node => { node.open = true })
    for (const selector of ['#ai-draft-apply', '#ai-draft-cancel', '#ai-draft-compare']) {
      const box = await page.locator(selector).boundingBox()
      assert.ok(box && box.y >= 0 && box.y + box.height <= (width === 320 ? 568 : width === 430 ? 932 : 852), `${width}-${theme}: draft action clipped`)
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}-${theme}: AI overflow`)
    await page.screenshot({ path: `.ui-current/mobile-visual/${width}-${theme}-ai-review.png` })
    const reviewSpace = await page.locator('#ai-draft-files').evaluate(node => node.clientHeight)
    assert.ok(reviewSpace >= 44, `${width}-${theme}: review leaves only ${reviewSpace}px for a field`)
    await field.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `.ui-current/mobile-visual/${width}-${theme}-ai-fields.png` })
  }
  await page.locator('#ai-draft-apply').click()
  assert.equal(await page.evaluate(async () => (await import('/src/app/state.ts')).appState.undoStack.length === window.reviewUndoLength + 1), true)
  await page.evaluate(async () => { (await import('/src/app/edit-history.ts')).undo() })
  assert.equal(await page.evaluate(async () => {
    const { appState } = await import('/src/app/state.ts')
    return window.reviewDrafts.every(file => appState.archive.getText(file.path) === file.before)
  }), true)
  await page.getByRole('button', { name: '会话', exact: true }).click()
  await page.locator('[data-session-filter="applied"]').click()
  assert.equal(await page.locator('#ai-session-list [role="option"]').count(), 1)
  assert.match(await page.locator('#ai-session-list').innerText(), /已应用 1 个文件/)
  await page.screenshot({ path: '.ui-current/mobile-visual/430-dark-ai-history.png' })
  await page.getByRole('button', { name: '清理记录', exact: true }).click()
  await page.getByRole('dialog', { name: '清理 AI 历史？' }).getByRole('button', { name: '清理记录', exact: true }).click()
  await page.waitForFunction(async () => (await import('/src/app/state.ts')).appState.aiSessions.length === 1)
  if (await page.locator('#ai-sessions').isVisible()) await page.locator('#ai-sessions-close').click()
  await page.setViewportSize({ width: 320, height: 568 })
  await chat.locator('#text-input').fill('调整配色')
  const touch = await send.boundingBox()
  const input = await composer.boundingBox()
  const model = await page.locator('#ai-design-model').boundingBox()
  assert.ok(touch.width >= 44 && touch.height >= 44)
  assert.ok(touch.x >= model.x + model.width && touch.x + touch.width < input.x + input.width)
  await composer.screenshot({ path: '/tmp/keyskin-ai-composer-mobile-dark.png' })
  await page.setViewportSize({ width: 1440, height: 1000 })

  // A desktop settings instance uses API results for subscriptions as well as API-key providers.
  await page.evaluate(async () => {
    delete window.__TAURI_INTERNALS__.transformCallback
    const old = document.querySelector('#settings-model-section')
    const section = old.cloneNode(true)
    old.replaceWith(section)
    const { initializeModelSettings } = await import('/src/model-settings.ts')
    window.desktopModelSettings = initializeModelSettings(section, { desktop: true, icon: () => document.createElement('span'), onSaved() {} })
    document.querySelector('#workspace-navigation [data-settings-entry=settings]').click()
    document.querySelector('#settings-model-nav').hidden = false
    ;(await import('/src/app/preferences.ts')).showSettingsPage('model')
    section.hidden = false
  })
  await page.waitForFunction(() => document.querySelector('#image-model-name').value === 'gpt-image-test')
  const thinkingTarget = page.locator('#model-thinking-target')
  const thinkingOverride = page.locator('#model-thinking-override')
  await thinkingTarget.selectOption('custom-test')
  await thinkingOverride.fill('off, high, max')
  await thinkingTarget.selectOption('another-model')
  assert.equal(await thinkingOverride.inputValue(), '')
  await page.evaluate(() => window.desktopModelSettings.save())
  assert.deepEqual(await page.evaluate(() => window.savedModelConfigurations.find(model => model.model === 'custom-test').thinkingOverride), ['off', 'high', 'max'])
  await page.evaluate(() => window.desktopModelSettings.begin())
  await thinkingTarget.selectOption('custom-test')
  assert.equal(await thinkingOverride.inputValue(), 'off, high, max')
  await page.locator('#refresh-image-model-list').click()
  await page.waitForFunction(() => document.querySelector('#image-model-status').textContent.includes('2 个生图模型'))
  assert.deepEqual(await page.locator('#image-model-options option').evaluateAll(items => items.map(item => item.value)), ['gpt-image-official', 'gpt-image-next'])
  assert.equal(await page.evaluate(() => modelCalls.findLast(call => call.command === 'fetch_model_list').args.configuration.kind), 'image')
  assert.equal(await page.locator('#image-model-api-key').isVisible(), false)
  await page.evaluate(() => { window.failImageList = true })
  await page.locator('#refresh-image-model-list').click()
  await page.waitForFunction(() => document.querySelector('#image-model-status').textContent.includes('test API unavailable'))
  assert.equal(await page.locator('#refresh-image-model-list').isDisabled(), false)
  assert.deepEqual(errors, [])
  console.log('PASS: model efforts/default, image test preview, preview read-only and mode switch, send and stop controls, session title/icon/dismiss/transcript/input/attachments/context/keyboard, subscription image API list and errors')
} finally {
  await browser?.close()
  await server.close()
}
