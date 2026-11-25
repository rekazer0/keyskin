import assert from 'node:assert/strict'
import test from 'node:test'
import { declarations, run } from './helpers/app-source.mjs'

const { bindFieldReset } = run(declarations('bindFieldReset'))
const row = () => Object.assign(new EventTarget(), { dataset: {} })

for (const [name, original] of [
  ['通用组合字段', [['0', '']]],
  ['SXI 多目标', [null, false, 0, [[1, 2], [3, 4]]]],
  ['SSF 原生键', [{ path: 'phoneSkin.ini', section: 'BG', exists: true, values: { NORMAL: 'a.png', PRESSED: null } }]],
]) test(`${name}：重建后重置交回初次快照，不取当前行的值`, () => {
  const first = row(), rebuilt = row(), restored = []
  bindFieldReset(first, original, () => assert.fail('旧行不应收到重置'))
  assert.equal(first.dataset.inspectorValue, JSON.stringify(original))
  bindFieldReset(rebuilt, [], value => restored.push(JSON.stringify(value)))
  const reset = new CustomEvent('inspector-reset', { cancelable: true, detail: first.dataset.inspectorValue })
  rebuilt.dispatchEvent(reset)
  assert.equal(reset.defaultPrevented, true)
  assert.deepEqual(restored, [JSON.stringify(original)])
})
