import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function load(name, globals = {}) {
  const context = vm.createContext({ exports: {}, URL, ...globals })
  const text = readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8')
  vm.runInContext(ts.transpile(text, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }), context)
  return context.exports
}
const providers = load('model-providers')
const { validateModelProviders, groupModelConfigurations, flattenModelProviders } = load('model-settings', { require: (id) => id.includes('model-providers') ? providers : {} })
const model = (patch = {}) => ({ provider: 'openai', protocol: 'openai-chat', apiUrl: 'https://api.openai.com/v1', model: 'gpt-5', apiKey: 'sk', ...patch })
const group = (patch = {}) => ({ provider: 'openai', protocol: 'openai-chat', apiUrl: 'https://api.openai.com/v1', apiKey: 'sk', models: ['gpt-5'], ...patch })

test('saved models group by provider account and flatten back in order', () => {
  const saved = [model(), model({ provider: 'deepseek', apiUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }), model({ model: 'gpt-5-mini' })]
  const groups = JSON.parse(JSON.stringify(groupModelConfigurations(saved)))
  assert.deepEqual(groups.map((g) => g.models), [['gpt-5', 'gpt-5-mini'], ['deepseek-chat']])
  assert.deepEqual(flattenModelProviders(groups).map((m) => m.model), ['gpt-5', 'gpt-5-mini', 'deepseek-chat'])
  assert.equal(groupModelConfigurations([model(), model({ apiKey: 'other' })]).length, 2)
})

test('provider validation points at the first incomplete or duplicate entry', () => {
  assert.equal(validateModelProviders([group(), group({ provider: 'deepseek' })]), undefined)
  assert.equal(validateModelProviders([]), undefined)
  assert.deepEqual({ ...validateModelProviders([group(), group({ apiKey: '' })]) }, { index: 1, message: '请填写 API 密钥' })
  assert.equal(validateModelProviders([group({ apiUrl: 'ftp://x' })]).index, 0)
  assert.equal(validateModelProviders([group({ models: [] })]).message, '请至少选择一个模型')
  assert.equal(validateModelProviders([group(), group({ apiKey: 'other' })]).index, 1)
})

test('image model validation requires address, key and model only when one is configured', () => {
  const { validateImageModel } = load('model-settings', { require: (id) => id.includes('model-providers') ? providers : {} })
  const image = { provider: 'volcengine-image', protocol: 'openai-chat', apiUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seedream-4-0-250828', apiKey: 'k', kind: 'image' }
  assert.equal(validateImageModel(undefined), undefined)
  assert.equal(validateImageModel(image), undefined)
  assert.match(validateImageModel({ ...image, apiKey: '' }), /密钥/)
  assert.match(validateImageModel({ ...image, apiUrl: 'ark' }), /http/)
  assert.equal(providers.imageModelPreset('minimax-image').model, 'image-01')
})

test('legacy credentials are removed only after the migrated configuration is saved', () => {
  const text = readFileSync(new URL('../src/model-settings.ts', import.meta.url), 'utf8')
  const persist = text.slice(text.indexOf('async function persist'), text.indexOf('async function load'))
  assert.ok(persist.indexOf('save_model_configuration') < persist.indexOf('localStorage.removeItem'))
  assert.match(text.slice(text.indexOf('async function load')), /catch \(error\)[\s\S]*?读取配置失败/)
})

test('subscriptions need a signed-in account instead of an API key', () => {
  const { validateModelProviders } = load('model-settings', { require: (id) => id.includes('model-providers') ? providers : {} })
  const claude = group({ provider: 'claude-subscription', protocol: 'anthropic', apiUrl: 'https://api.anthropic.com/v1', apiKey: '', models: ['claude-sonnet-5'] })
  assert.match(validateModelProviders([claude]).message, /请先登录 Claude/)
  assert.equal(validateModelProviders([claude], new Map([['claude-subscription', '']])), undefined)
  assert.equal(providers.modelProviderPreset('chatgpt-subscription').protocol, 'openai-codex')
  assert.equal(providers.modelProviderPreset('removed-preset').id, 'openai')
})

test('the ChatGPT subscription image model reuses the chat sign-in and needs no key', () => {
  const { validateImageModel } = load('model-settings', { require: (id) => id.includes('model-providers') ? providers : {} })
  const image = { provider: 'chatgpt-subscription', protocol: 'openai-codex', apiUrl: 'https://chatgpt.com/backend-api', model: 'gpt-image-2.5', apiKey: '', kind: 'image' }
  assert.match(validateImageModel(image), /请先登录 ChatGPT/)
  assert.equal(validateImageModel(image, new Map([['chatgpt-subscription', 'me@example.com']])), undefined)
  assert.equal(providers.imageModelPreset('chatgpt-subscription').id, providers.modelProviderPreset('chatgpt-subscription').id)
})

test('image model listings keep only image models', () => {
  const { imageModelIds } = load('model-settings', { require: (id) => id.includes('model-providers') ? providers : {} })
  const listed = ['gpt-5', 'gpt-image-1', 'dall-e-3', 'doubao-seedream-4-0-250828', 'deepseek-chat', 'imagen-4.0-generate-001', 'gemini-2.5-flash-image', 'image-01', 'cogview-4']
  assert.deepEqual([...imageModelIds(listed)], ['gpt-image-1', 'dall-e-3', 'doubao-seedream-4-0-250828', 'imagen-4.0-generate-001', 'gemini-2.5-flash-image', 'image-01', 'cogview-4'])
})
