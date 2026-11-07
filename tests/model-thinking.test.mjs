import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../src/model-thinking.ts', import.meta.url), 'utf8')
const modules = new Map()
for (const [, name] of source.matchAll(/from "(@earendil-works\/pi-ai[^\"]*)"/g)) modules.set(name, await import(name))
const context = vm.createContext({ exports: {}, require: name => modules.get(name) })
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
