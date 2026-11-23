import { test } from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/ai-chat.ts', import.meta.url), 'utf8')
  .replace(/^import .*$/gm, '').replace('export async function connectAiChat', 'async function connectAiChat')
const code = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None })
const frames = []
const runFrames = () => frames.splice(0).forEach(callback => callback())
async function setup(run) {
  const context = vm.createContext({
    iconMarkup: (name) => `<svg data-icon="${name}"></svg>`,
    requestAnimationFrame: callback => frames.push(callback), cancelAnimationFrame: () => {},
    exports: {}, AbortController, DOMException,
    customElements: { whenDefined: async () => {} },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    setInterval: () => 0, clearInterval: () => {},
  })
  vm.runInContext(code, context)
  const chat = { closest: () => null, clearMessages() {}, focusInput() {}, disableSubmitButton() {} }
  const attributes = new Map()
  const send = { dataset: {}, getAttribute: key => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value) }
  const controller = await context.connectAiChat(chat, run, send)
  const responses = []
  let closes = 0
  const signals = { onOpen() {}, onClose() { closes++ }, onResponse: async ({ text }) => responses.push(text), stopClicked: {} }
  return { chat, controller, send, responses, signals, closes: () => closes }
}
const flush = () => new Promise(resolve => setImmediate(resolve))
test('native stream preserves markdown and appends summary once', async () => {
  const s = await setup(async (_, hooks) => {
    await hooks.onTextDelta('**Hello**')
    return { fallback: 'duplicate', summary: 'Done' }
  })
  s.chat.connect.handler({ messages: [{ text: 'hello' }] }, s.signals)
  await flush()
  assert.deepEqual(s.responses, ['**Hello**', '\n\nDone'])
  assert.equal(s.closes(), 1)
})
test('clear closes the stream and ignores late results', async () => {
  let finish
  const s = await setup(() => new Promise(resolve => { finish = resolve }))
  s.chat.connect.handler({ messages: [{ text: 'hello' }] }, s.signals)
  s.controller.clear()
  finish({ fallback: 'stale' })
  await flush()
  assert.deepEqual(s.responses, [])
  assert.equal(s.closes(), 1)
})
test('cancel suppresses successful completion', async () => {
  let finish
  const s = await setup(() => new Promise(resolve => { finish = resolve }))
  s.chat.connect.handler({ messages: [{ text: 'hello' }] }, s.signals)
  s.signals.stopClicked.listener()
  finish({ fallback: 'success', summary: 'applied' })
  await flush()
  assert.equal(s.responses.length, 1)
  assert.match(s.responses[0], /取消/)
  assert.equal(s.closes(), 1)
})
test('service failure is visible and closes the stream', async () => {
  const s = await setup(async () => { throw new Error('Unavailable') })
  s.chat.connect.handler({ messages: [{ text: 'hello' }] }, s.signals)
  await flush()
  assert.match(s.responses[0], /Unavailable/)
  assert.equal(s.closes(), 1)
})
test('thinking updates preserve expanded state and render untrusted text literally', async () => {
  let hooks, finish
  const s = await setup((_, value) => { hooks = value; return new Promise(resolve => { finish = resolve }) })
  const head = { dataset: {}, addEventListener() {}, attributes: {}, getAttribute(k) { return this.attributes[k] }, setAttribute(k, v) { this.attributes[k] = v } }
  const label = { textContent: '' }
  const steps = { childElementCount: 0, replaceChildren() {} }
  const think = { hidden: true, open: false }
  const thinkText = { textContent: '', scrollHeight: 100, scrollTop: 100, clientHeight: 100 }
  const section = { dataset: {}, querySelector: sel => ({ '.ai-run-head': head, '.ai-run-label': label, '.ai-run-steps': steps, '.ai-run-think': think, '.ai-run-think-text': thinkText })[sel] ?? null }
  const messages = { children: [], append() {}, querySelector: sel => (sel === '#ai-run-1' ? section : null) }
  s.chat.shadowRoot = { querySelector: sel => (sel === '#messages' ? messages : sel === '#ai-run-1' ? section : null) }
  s.chat.connect.handler({ messages: [{ text: 'hello' }] }, s.signals)
  await hooks.onThinking('First')
  runFrames()
  assert.equal(think.hidden, false)
  think.open = true
  await hooks.onThinking('First <script>')
  await hooks.onThinking('First <script>alert(1)</script>')
  assert.equal(frames.length, 1, 'token bursts coalesce into one repaint')
  runFrames()
  assert.equal(think.open, true)
  assert.equal(thinkText.textContent, 'First <script>alert(1)</script>')
  finish({ fallback: 'Answer' })
  await flush()
  assert.equal(head.getAttribute('aria-expanded'), 'false')
})
test('late thinking events after clear are ignored', async () => {
  let hooks, finish
  const s = await setup((_, value) => { hooks = value; return new Promise(resolve => { finish = resolve }) })
  s.chat.connect.handler({ messages: [{ text: 'hello' }] }, s.signals)
  s.controller.clear()
  await hooks.onThinking('stale')
  finish({ fallback: 'stale' })
  await flush()
})
