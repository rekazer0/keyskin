import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import vm from 'node:vm'

const providerSource = readFileSync(new URL('../src/model-providers.ts', import.meta.url), 'utf8')
const providers = vm.createContext({})
vm.runInContext(stripTypeScriptTypes(providerSource).replace(/^export /gm, ''), providers)

test('Zhipu presets use GLM 4.7 and retain the separate standard and Coding Plan URLs', () => {
  for (const [id, path] of [
    ['zhipu-ai', '/api/paas/v4'],
    ['zhipu-coding-plan', '/api/coding/paas/v4'],
    ['zhipu-coding-plan-team', '/api/coding/paas/v4'],
  ]) {
    const preset = providers.modelProviderPreset(id)
    assert.equal(preset.model, 'glm-4.7')
    assert.equal(preset.protocol, 'openai-chat')
    assert.equal(preset.apiUrl, `https://open.bigmodel.cn${path}`)
  }
})

// Execute the real nested request function with controlled IPC and time, without a WebView.
const settingsSource = readFileSync(new URL('../src/model-settings.ts', import.meta.url), 'utf8')
const requestSource = stripTypeScriptTypes(settingsSource.slice(
  settingsSource.indexOf('  async function request<T>'),
  settingsSource.indexOf('  async function fetchModels()'),
))
function setup(invoke) {
  let group = { provider: 'zhipu-ai', protocol: 'openai-chat', apiUrl: 'https://open.bigmodel.cn/api/paas/v4', apiKey: 'test-key', models: ['glm-4.7'] }
  const status = [], busy = [], timers = new Map()
  const context = vm.createContext({
    current: () => group,
    options: { desktop: true },
    setStatus: (...args) => status.push(args),
    setBusy: value => busy.push(value),
    invoke,
    setTimeout: (callback, delay) => { timers.set(1, { callback, delay }); return 1 },
    clearTimeout: id => timers.delete(id),
  })
  vm.runInContext(requestSource, context)
  return {
    context, status, busy, timers,
    switchProvider: () => { group = { ...group, provider: 'other' } },
    run: () => context.request('testing', '连接失败', 'test_model_connection', 'glm-4.7'),
  }
}

test('connection test passes the selected model and credentials, then clears its deadline', async () => {
  const calls = []
  const result = { message: '连接成功，模型 glm-4.7 可用' }
  const s = setup(async (...args) => { calls.push(args); return result })
  assert.equal(await s.run(), result)
  assert.equal(calls[0][0], 'test_model_connection')
  assert.equal(calls[0][1].configuration.model, 'glm-4.7')
  assert.equal(calls[0][1].configuration.apiKey, 'test-key')
  assert.equal('models' in calls[0][1].configuration, false)
  assert.deepEqual(s.busy, [true, false])
  assert.equal(s.timers.size, 0)
})

test('a native error reaches the UI and restores the connection buttons', async () => {
  const s = setup(async () => { throw new Error('HTTP 401: invalid API key') })
  assert.equal(await s.run(), undefined)
  assert.match(s.status.at(-1)[0], /连接失败.*HTTP 401/)
  assert.equal(s.status.at(-1)[1], 'error')
  assert.deepEqual(s.busy, [true, false])
  assert.equal(s.timers.size, 0)
})

test('an IPC reply that never arrives times out and permits retry; late success is ignored', async () => {
  let finish
  const s = setup(() => new Promise(resolve => { finish = resolve }))
  const pending = s.run()
  assert.equal(s.timers.get(1).delay, 20_000)
  s.timers.get(1).callback()
  assert.equal(await pending, undefined)
  assert.match(s.status.at(-1)[0], /连接失败.*超时/)
  assert.equal(s.status.at(-1)[1], 'error')
  assert.deepEqual(s.busy, [true, false])
  assert.equal(s.timers.size, 0)
  const statuses = s.status.length
  finish({ message: 'late success' })
  await Promise.resolve()
  assert.equal(s.status.length, statuses)
  s.context.invoke = async () => ({ message: 'retry succeeded' })
  assert.equal((await s.run()).message, 'retry succeeded')
})

test('late native rejection after the UI deadline stays handled', async () => {
  let fail
  const s = setup(() => new Promise((_, reject) => { fail = reject }))
  const pending = s.run()
  s.timers.get(1).callback()
  await pending
  fail(new Error('late failure'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(s.status.length, 2)
})

test('switching providers suppresses the previous connection result or error', async () => {
  for (const reject of [false, true]) {
    let settle
    const s = setup(() => new Promise((resolve, fail) => { settle = reject ? fail : resolve }))
    const pending = s.run()
    s.switchProvider()
    settle(reject ? new Error('old error') : { message: 'old success' })
    assert.equal(await pending, undefined)
    assert.equal(s.status.length, 1)
    assert.deepEqual(s.busy, [true, false])
    assert.equal(s.timers.size, 0)
  }
})

test('the browser-only guard finishes without starting IPC or a deadline', async () => {
  const s = setup(() => { throw new Error('must not invoke') })
  s.context.options.desktop = false
  assert.equal(await s.run(), undefined)
  assert.equal(s.status.length, 1)
  assert.equal(s.timers.size, 0)
  assert.deepEqual(s.busy, [])
})
