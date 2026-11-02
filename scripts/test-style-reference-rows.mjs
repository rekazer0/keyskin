import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { combinedSource, withAppState } from '../tests/helpers/app-source.mjs'

const source = combinedSource()
const names = new Set(['renderStyleReferenceRows', 'refreshStyleReferenceThumbnail', 'styleReferenceForeground'])
const code = source.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text)
  || ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(source) === 'layoutAnimationFields')).map(node => node.getText(source)).join('\n')
class Element {
  children = []
  dataset = {}
  classList = { toggle() {} }
  listeners = {}
  isConnected = true
  value = ''
  constructor(tag = '') { this.tag = tag }
  append(...items) { this.children.push(...items) }
  replaceChildren() { this.children = [] }
  setAttribute() {}
  removeAttribute() {}
  addEventListener(name, callback) { this.listeners[name] = callback }
  dispatchEvent(event) { this.listeners[event.type]?.(event) }
  closest() { return this }
  cloneNode() { return new Element('input') }
  querySelectorAll(tag) {
    if (tag === '.style-picker-state > canvas') return this.children.flatMap(child => [...(child.tag === 'canvas' && this.className === 'style-picker-state' ? [child] : []), ...child.querySelectorAll(tag)])
    return this.children.flatMap(child => [...(child.tag === tag ? [child] : []), ...child.querySelectorAll(tag)])
  }
}
const drawn = []
let pickerTarget
const sliceCalls = []
const context = withAppState(vm.createContext({
  document: { createElement: tag => new Element(tag) },
  retinaThumbnail: canvas => canvas,
  styleReferenceDrawIDs: new WeakMap(),
  styleStateVisuals: new WeakMap(),
  styleStateCanvasObserver: { observe() {}, unobserve() {} },
  releaseOnRemove() {},
  scheduleStyleStateSizing: canvas => { const meta = context.styleStateVisuals.get(canvas); drawn.push([meta.visual]) },
  visualResolver: () => ({ resolve: async (id, highlighted) => ({ id, highlighted }) }),
  drawVisualPreview: (canvas, layers) => drawn.push(layers),
  styleConfigDocument: () => undefined,
  styleKind: () => 'image',
  styleKindBadge: () => new Element('span'),
  openStyleReferenceEditor: () => {},
  openStylePicker: target => { pickerTarget = target },
  openStyleReferenceStateImage: async (target, styleKey, highlighted) => {
    sliceCalls.push({ styleID: target.value, key: styleKey, highlighted })
  },
  Event,
}))
vm.runInContext(ts.transpile(code, { target: ts.ScriptTarget.ES2022 }), context)
for (const key of ['FORE_STYLE', 'BACK_STYLE']) {
  const input = new Element('input')
  input.value = '11, 22,11'
  const button = new Element('span')
  drawn.length = 0
  await context.refreshStyleReferenceThumbnail(button, input, key)
  assert.equal(button.children.length, 3)
  assert.deepEqual(drawn.map(layers => layers.map(visual => visual.id).join(',')), ['11', '11', '22', '22', '11', '11'])
  // 卡片：左侧 meta（编号 + 类型），右侧两个状态预览
  assert.deepEqual(Array.from(button.children, row => row.children[0].children[0].value), ['11', '22', '11'])
  const stateCard = button.children[1].children[1].children[0]
  // 预览图点击打开该状态图片的切片选择器，而不是样式选择器。
  stateCard.listeners.click({})
  assert.deepEqual(sliceCalls.at(-1), { styleID: '22', key, highlighted: false })
  // 样式选择器保留在 Alt 点击上。
  stateCard.listeners.click({ altKey: true })
  assert.equal(pickerTarget.value, '22')
  pickerTarget.value = '33'
  pickerTarget.dispatchEvent(new Event('change'))
  assert.equal(input.value, '11,33,11')
  const numberInput = button.children[0].children[0].children[0]
  numberInput.value = '55'
  numberInput.dispatchEvent(new Event('change'))
  assert.equal(input.value, '55,33,11')
  input.value = '44'
  await context.refreshStyleReferenceThumbnail(button, input, key)
  assert.equal(button.children.length, 1)
}
console.log('Style reference rows: foreground/background, duplicate refs, independent replacement, slice picker on preview click and row refresh passed')
