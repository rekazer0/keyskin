import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions'

const source = readFileSync(new URL('../src/model-thinking.ts', import.meta.url), 'utf8')
const modules = new Map()
for (const [, name] of source.matchAll(/from "(@earendil-works\/pi-ai[^\"]*)"/g)) modules.set(name, await import(name))
modules.set('./model-providers.ts', await import('../src/model-providers.ts'))
const context = vm.createContext({ exports: {}, URL, require: name => modules.get(name) })
vm.runInContext(ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }), context)
const { modelThinking, modelThinkingLevel } = context.exports
const model = (id, provider = 'openai') => ({ model: id, provider })
const levels = configuration => Array.from(modelThinking(configuration).levels)

test('different models expose their catalog efforts without duplicate aliases', () => {
  assert.deepEqual(levels(model('gpt-4o')), ['off'])
  assert.deepEqual(levels(model('gpt-5.3-codex-spark', 'chatgpt-subscription')), ['off', 'low', 'medium', 'high', 'xhigh'])
  assert.ok(levels(model('claude-fable-5', 'anthropic')).includes('max'))
  assert.ok(!levels(model('claude-fable-5', 'anthropic')).includes('off'))
  assert.deepEqual(levels(model('unlisted-model')), ['off'])
})
test('official capabilities override catalog, default to medium and constrain requests', () => {
  const configuration = { ...model('gpt-6.1-sol', 'chatgpt-subscription'), thinkingLevels: ['xhigh', 'low', 'medium', 'medium', 'invalid'] }
  assert.deepEqual(levels(configuration), ['low', 'medium', 'xhigh'])
  assert.equal(modelThinkingLevel(configuration), 'medium')
  assert.equal(modelThinkingLevel(configuration, 'max'), 'medium')
  assert.equal(modelThinkingLevel(model('gpt-4o'), 'high'), 'off')
  assert.equal(modelThinking(configuration).thinkingLevelMap.high, null)
})

test('provider endpoints distinguish identical IDs and recognize new and gateway models', () => {
  const chat = (id, apiUrl) => ({ ...model(id, 'openai-compatible'), apiUrl, protocol: 'openai-chat' })
  assert.deepEqual(levels(chat('deepseek-flash', 'https://api.deepseek.com/v1')), ['off', 'low', 'high', 'max'])
  assert.equal(modelThinking(chat('deepseek-flash', 'https://api.deepseek.com/v1')).compat.thinkingFormat, 'deepseek')
  assert.deepEqual(levels(chat('deepseek-v4-pro', 'https://api.deepseek.com/v1')), ['off', 'low', 'high', 'max'])
  assert.equal(modelThinking(chat('deepseek-v4-flash', 'https://opencode.ai/zen/go/v1')).known.provider, 'opencode-go')
  assert.equal(modelThinking(chat('deepseek-v4-flash', 'https://opencode.ai/zen/v1')).known.provider, 'opencode')
  assert.equal(modelThinking(chat('deepseek/deepseek-v4-flash', 'https://openrouter.ai/api/v1')).compat.thinkingFormat, 'openrouter')
  assert.deepEqual(levels(chat('glm-5.3', 'https://open.bigmodel.cn/api/coding/paas/v4')), ['low', 'high', 'max'])
  const qwen = chat('qwen3.6-plus', 'https://dashscope.aliyuncs.com/compatible-mode/v1')
  assert.deepEqual(levels(qwen), ['off', 'low', 'medium', 'high'])
  assert.equal(modelThinking(qwen).compat.thinkingTokenBudgetField, 'thinking_budget')
  assert.deepEqual(levels(chat('doubao-seed-2-1-pro-260915', 'https://ark.cn-beijing.volces.com/api/v3')), ['off', 'low', 'medium', 'high'])
  assert.equal(modelThinking(chat('my-model', 'https://example.com/v1')).identified, false)
})

test('custom levels override auto detection and work for private model IDs', () => {
  const config = { ...model('endpoint-123'), thinkingLevels: ['high'], thinkingOverride: ['xhigh', 'off'] }
  assert.deepEqual(levels(config), ['off', 'xhigh'])
  assert.equal(modelThinkingLevel(config), 'xhigh')
  assert.equal(modelThinking(config).thinkingLevelMap.off, 'none')
  assert.equal(modelThinking(config).thinkingLevelMap.high, null)
})

test('inferred and custom levels reach the provider in the expected wire format', async () => {
  const chat = (model, apiUrl, thinkingOverride) => ({ model, apiUrl, thinkingOverride, protocol: 'openai-chat', provider: 'openai-compatible' })
  const payload = async (configuration, level) => {
    const { compat, reasoning, thinkingLevelMap } = modelThinking(configuration)
    let request
    const result = await streamSimple({
      id: configuration.model, api: 'openai-completions', provider: 'keyskin',
      baseUrl: configuration.apiUrl, input: ['text'], reasoning, compat, thinkingLevelMap, maxTokens: 32768,
    }, { messages: [] }, {
      apiKey: 'test', reasoning: level, onPayload(value) {
        request = value
        throw new Error('Stop before network I/O')
      },
    }).result()
    assert.ok(request, result.errorMessage)
    return request
  }
  const deepseek = chat('deepseek-flash', 'https://api.deepseek.com/v1')
  assert.deepEqual((await payload(deepseek, 'off')).thinking, { type: 'disabled' })
  const flash = await payload(deepseek, 'max')
  assert.deepEqual(flash.thinking, { type: 'enabled' })
  assert.equal(flash.reasoning_effort, 'max')
  const qwen = await payload(chat('qwen3.6-plus', 'https://dashscope.aliyuncs.com/compatible-mode/v1'), 'high')
  assert.equal(qwen.enable_thinking, true)
  assert.ok(qwen.thinking_budget > 0)
  assert.equal(qwen.reasoning_effort, undefined)
  const custom = await payload(chat('my-model', 'https://example.com/v1', ['off', 'xhigh']), 'xhigh')
  assert.equal(custom.reasoning_effort, 'xhigh')
})
