// 检查器样式引用字段（style-references.ts refreshStyleReferenceThumbnail）：每个编号一张 styleReferenceCard，
// 前景、前景动画可多张、可移除、标签右端追加；动画槽位按位置保留，移除写 0；单击换样式、⌘ 单击编辑。
import assert from 'node:assert/strict'
import vm from 'node:vm'
import ts from 'typescript'
import { combinedSource, withAppState } from '../tests/helpers/app-source.mjs'

const source = combinedSource()
const names = new Set(['refreshStyleReferenceThumbnail', 'styleReferenceForeground'])
const code = source.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text)
  || ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(source) === 'layoutAnimationFields')).map(node => node.getText(source)).join('\n')
class Element {
  children = []
  dataset = {}
  listeners = {}
  value = ''
  disabled = false
  constructor(tag = '') { this.tag = tag }
  replaceChildren(...items) { this.children = items }
  append(...items) { this.children.push(...items) }
  closest() { return null }
  querySelector() { return null }
  setAttribute() {}
  removeAttribute() {}
  addEventListener(name, callback) { this.listeners[name] = callback }
  dispatchEvent(event) { this.listeners[event.type]?.(event) }
  cloneNode() { return Object.assign(new Element('input'), { dataset: { ...this.dataset } }) }
}
const drawn = []
const edited = []
let picker
const context = withAppState(vm.createContext({
  visualResolver: () => ({ resolve: async (id, highlighted) => ({ id, highlighted }) }),
  drawVisualPreview: (canvas, layers) => drawn.push(layers.map(visual => visual.id).join()),
  styleConfigDocument: () => undefined,
  IniDocument: { parse: () => ({}) },
  styleKind: () => 'image',
  styleKindIcon: kind => kind,
  styleReferenceCard: options => ({ options }),
  iconButton: (icon, label, onAdd) => ({ add: onAdd, classList: { add() {} }, dataset: {} }),
  styleAnimationReferenceStates: (styleID, styles, choose) => [{ label: `动画 ${styleID}`, onClick: choose }],
  openStyleReferenceEditor: id => edited.push(id),
  openStylePicker: (target, highlighted) => { picker = { target, highlighted } },
  Event,
}))
vm.runInContext(ts.transpile(code, { target: ts.ScriptTarget.ES2022 }), context)

const field = (key, value) => {
  const input = new Element('input')
  input.value = value
  if (key === 'FORE_STYLE') input.dataset.keyField = key
  input.addEventListener('change', () => context.refreshStyleReferenceThumbnail(list, input, key))
  const list = new Element('span')
  context.refreshStyleReferenceThumbnail(list, input, key)
  const cards = () => list.children.slice(1).filter(card => card.options).map(card => card.options)
  return { input, list, cards, add: () => list.children.find(card => card.add) }
}
const choose = (value) => {
  picker.target.value = value
  picker.target.dispatchEvent(new Event('change'))
}

// 前景：重复编号各占一张；正常、按下两格；单击按状态打开样式库，只改这一张。
const fore = field('FORE_STYLE', '11, 22,11')
assert.deepEqual(fore.cards().map(card => card.name.value), ['11', '22', '11'])
await Promise.all(fore.cards().flatMap(card => card.states.map(state => state.draw({}))))
assert.deepEqual(drawn, ['11', '11', '22', '22', '11', '11'])
fore.cards()[1].states[1].onClick(false)
assert.equal(picker.highlighted, true)
assert.equal(picker.target.value, '22')
choose('33')
assert.equal(fore.input.value, '11,33,11')
fore.cards()[1].states[0].onClick(true)
assert.deepEqual(edited, ['33'], '⌘ 单击编辑这张卡的样式')
// 编号可直接输入
const number = fore.cards()[0].name
number.value = '55'
number.dispatchEvent(new Event('change'))
assert.equal(fore.input.value, '55,33,11')
// 每张都能移除；末尾追加卡打开样式库，选定后追加
assert.ok(fore.cards().every(card => card.remove))
fore.cards()[1].remove.run()
assert.equal(fore.input.value, '55,11')
fore.add().add()
choose('77')
assert.equal(fore.input.value, '55,11,77')

// 背景：单值，可移除（清空），没有追加
const back = field('BACK_STYLE', '44')
assert.equal(back.cards().length, 1)
assert.equal(back.add(), undefined)
back.cards()[0].remove.run()
assert.equal(back.input.value, '')

// 空引用：一张紧凑虚线卡，点了打开样式库
const empty = field('BACK_STYLE', '')
assert.equal(empty.cards()[0].states.length, 0)
empty.cards()[0].empty.onClick()
choose('9')
assert.equal(empty.input.value, '9')

// 动画槽位按位置保留：0 是空槽（clapperboard），移除写 0 不挪动后面的槽位
const anim = field('FORE_ANIM_STYLE', '0,7,8')
assert.deepEqual(anim.cards().map(card => card.states.length), [0, 1, 1])
assert.equal(anim.cards()[0].empty.icon, 'clapperboard')
assert.equal(anim.cards()[0].remove, undefined)
anim.cards()[1].remove.run()
assert.equal(anim.input.value, '0,0,8')
// 前景动画也有追加；移除最后一层时去掉末尾的空槽位
assert.ok(anim.add())
anim.cards()[2].remove.run()
assert.equal(anim.input.value, '0')
console.log('Style reference rows: per-slot cards, state click opens the picker, ⌘ click edits, typed numbers, remove / append and animation slots passed')
