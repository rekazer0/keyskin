import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import vm from 'node:vm'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('only Windows registers the material focus recovery hook', () => {
  const source = ts.createSourceFile('startup.ts', read('src/app/wiring/resources-and-startup.ts'), ts.ScriptTarget.Latest, true)
  let focusGuard
  function visit(node) {
    if (ts.isIfStatement(node) && node.thenStatement.getText(source).includes('.onFocusChanged(')) focusGuard = node
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert(focusGuard)
  for (const windows of [false, true]) {
    let registered = 0
    vm.runInNewContext(focusGuard.getText(source), {
      document: { documentElement: { classList: { contains: name => name === 'windows' && windows } } },
      getCurrentWindow: () => ({ onFocusChanged() { registered++ } }),
    })
    assert.equal(registered, windows ? 1 : 0)
  }
})

test('Android stops its source observer and shuts down workers on Activity destruction without aborting saves', () => {
  const source = read('src-tauri/native-share/android/src/main/java/SharePlugin.kt')
  const destroy = source.slice(source.indexOf('override fun onDestroy('), source.indexOf('\n  @Command', source.indexOf('override fun onDestroy(')))
  assert.match(destroy, /onDestroy\(activity: AppCompatActivity\)/)
  assert.match(destroy, /try\s*\{\s*clearSourceObserver\(\)/)
  assert.match(destroy, /finally\s*\{[\s\S]*sourcePollExecutor\.shutdownNow\(\)/)
  assert.match(destroy, /sourceExecutor\.shutdown\(\)/)
  assert.doesNotMatch(destroy, /sourceExecutor\.shutdownNow/)
  const clear = source.slice(source.indexOf('private fun clearSourceObserver()'), source.indexOf('\n  @Command', source.indexOf('private fun clearSourceObserver()')))
  assert.match(clear, /unregisterContentObserver/)
  assert.match(clear, /sourceObserver = null/)
  assert.match(clear, /sourcePoll\?\.cancel\(false\)/)
  assert.match(clear, /sourcePoll = null/)
})
