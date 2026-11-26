import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runAiSkinDesign } from '../src/ai-design.ts'

const config = { provider: 'openai-compatible', protocol: 'openai-chat', apiUrl: 'https://example.test/v1', apiKey: 'test', model: 'test-chat' }
const path = 'skin.ini'
const project = {
  format: 'bds', skinName: 'Test', skinPath: '', theme: 'light', orientation: 'portrait', layout: '', keyboard: '', panelPath: path,
  panelScope: 'panel', selectedKey: { label: '', sections: [], values: {} }, files: [{ path, syntax: 'ini', text: '[STYLE1]\nSHOW=Before\n' }],
}

function mockModel(t, ...replies) {
  const requests = []
  const send = (delta, finishReason = null) => `data: ${JSON.stringify({ id: 'test', choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`
  const fetch = globalThis.fetch
  globalThis.window = { __TAURI_INTERNALS__: {
    transformCallback: () => 0,
    invoke: async (command, { request, events }) => {
      assert.equal(command, 'model_http_request')
      requests.push(JSON.parse(request.body))
      const reply = replies.shift()
      const body = reply?.map(([delta, reason]) => send(delta, reason)).join('') ?? ''
      events.onmessage({ type: 'headers', status: reply ? 200 : 400, headers: [['content-type', 'text/event-stream']] })
      events.onmessage({ type: 'chunk', body: [...new TextEncoder().encode(`${body}data: [DONE]\n\n`)] })
      events.onmessage({ type: 'end' })
    },
  } }
  t.after(() => {
    assert.equal(globalThis.fetch, fetch)
    delete globalThis.window
  })
  return requests
}

const tool = (name, args, id = name) => [[{ tool_calls: [{ index: 0, type: 'function', id, function: { name, arguments: JSON.stringify(args) } }] }, 'tool_calls']]
const read = tool('read_ini_sections', { path, sections: ['STYLE1'] })
const edit = tool('set_ini_value', { path, section: 'STYLE1', key: 'SHOW', value: 'After' })
const interrupted = [[{ reasoning_content: 'Thinking' }]]

test('retries only the interrupted model turn and keeps previous tool results', async t => {
  const requests = mockModel(t, read, edit, interrupted, [[{ content: '文字已调整。' }, 'stop']])
  const result = await runAiSkinDesign(config, project, '修改文字')
  assert.equal(requests.length, 4)
  assert.deepEqual(requests[3].messages, requests[2].messages)
  assert.equal(requests[3].messages.at(-1).role, 'tool')
  assert.equal(result.toolCalls, 2)
  assert.match(result.changes[0].after, /SHOW=After/)
  assert.equal(result.response, '文字已调整。')
  assert.equal(result.notice, undefined)
})

test('keeps reviewable changes after a second interruption', async t => {
  const requests = mockModel(t, read, edit, interrupted, interrupted)
  const result = await runAiSkinDesign(config, project, '修改文字')
  assert.equal(requests.length, 4)
  assert.match(result.notice, /回复中断.*部分草稿/)
  assert.equal(result.changes[0].before, project.files[0].text)
  assert.match(result.changes[0].after, /SHOW=After/)
  assert.ok(result.conversation.every(message => message.role !== 'assistant'))
})

test('does not replay streamed text or execute a tool call from an unfinished response', async t => {
  const incomplete = [[{ content: '未结束', tool_calls: edit[0][0].tool_calls }]]
  const requests = mockModel(t, read, incomplete)
  const text = []
  await assert.rejects(runAiSkinDesign(config, project, '修改文字', { onTextDelta: value => { text.push(value) } }), /回复中断.*没有生成草稿/)
  assert.deepEqual(text, ['未结束'])
  assert.equal(requests.length, 2)
})
