import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import vm from 'node:vm'
import { stopLegacyPanelAnimation } from '../src/preview-playback.ts'
const ast = ts.createSourceFile('preview.ts', fs.readFileSync(new URL('../src/preview.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
const preview = ast.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'Preview')
for (const [method, property, same, changed] of [
  ['setMode', 'mode', 'edit', 'preview'],
  ['setEditTool', 'editTool', 'select', 'move'],
]) test(`${method} preserves interaction and skips rendering for unchanged state`, () => {
  const body = preview.members.find(n => n.name?.getText(ast) === method).body.getText(ast)
  const calls = []
  const target = { [property]: same, cancelDragDraw: () => calls.push('cancel'), clearPress() {}, cancelEditTouch() {}, cancelEditDrag() {}, updateCursor() {}, restartLegacyPanelAnimation: () => calls.push('restart'), draw: () => calls.push('draw') }
  const fn = vm.runInNewContext(ts.transpile(`(function(${method === 'setMode' ? 'mode' : 'tool'}) ${body})`), { stopLegacyPanelAnimation })
  fn.call(target, same)
  assert.deepEqual(calls, [])
  fn.call(target, changed)
  assert.equal(target[property], changed)
  assert(calls.includes('draw'))
})
