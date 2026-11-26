// Run: node --experimental-strip-types scripts/test-performance-regressions.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { combinedSource, withAppState } from '../tests/helpers/app-source.mjs'

const source = combinedSource()
const scheduler = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'scheduleAtlasDraw').getText(source)
const draw = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'drawAtlas')
// Run the production scheduling/cancellation with a lightweight draw sink.
const cancellation = draw.body.statements.slice(0, 2).map(n => n.getText(source)).join('\n')
const frames = new Map()
let id = 0
const context = withAppState(vm.createContext({
  requestAnimationFrame: cb => { frames.set(++id, cb); return id },
  cancelAnimationFrame: id => frames.delete(id),
}))
vm.runInContext(ts.transpile(`let atlasDrawFrame = 0; let state = 0; let rendered = []; ${scheduler}
function drawAtlas() { ${cancellation}; rendered.push(state) }`, { target: ts.ScriptTarget.ES2022 }), context)
vm.runInContext('for (let i = 1; i <= 100; i++) { state = i; scheduleAtlasDraw() }', context)
assert.equal(frames.size, 1, 'pointer bursts share a frame')
const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(cb => cb())
assert.equal(vm.runInContext('rendered.join()', context), '100', 'render the newest drag position')
vm.runInContext('state = 101; scheduleAtlasDraw(); state = 102; drawAtlas()', context)
assert.equal(frames.size, 0, 'commit/cancel clears stale pending work')
assert.equal(vm.runInContext('rendered.join()', context), '100,102')
console.log('Performance regression checks passed')
