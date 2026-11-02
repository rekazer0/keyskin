import test from 'node:test'
import assert from 'node:assert/strict'
import { IniDocument } from '../src/ini.ts'
import { readAnimationBinding, writeAnimationBindings } from '../src/legacy-animation-binding.ts'

const layout = '[PANEL]\nANIM_STYLE=7\n[KEY1]\nFORE_ANIM_STYLE=7,0,, 7 ,\nBACK_ANIM_STYLE=7\nSTAT_STYLE=S11_4\n[KEY2]\nBACK_ANIM_STYLE=7\n[TIP4]\nCENTER=x\n'
const styles = '[GLOBAL]\nSTYLE_NUM=9\n[STYLE7]\nINFO=shared\nPRESS_ANIM=1\nRELEASE_ANIM=3\nCUSTOM=opaque value\nEMPTY=\n[STYLE8]\nINFO=shared\nPRESS_ANIM=2\nRELEASE_ANIM=3\nCUSTOM=different\nEMPTY=\n[STYLE9]\nINFO=shared\nPRESS_ANIM=2\nRELEASE_ANIM=3\nCUSTOM=opaque value\nEMPTY=\n'
const read = (value, section, key) => IniDocument.parse(value).get(section, key)
const key = (field, index, state) => ({ section: 'KEY1', field, index, state })
const write = (l, s, targets, event, anim) => writeAnimationBindings(l, s, targets, event, anim, '按下')

test('foreground slots retain empty/zero/trailing entries and full-field reuse', () => {
  const target = key('FORE_ANIM_STYLE', 3)
  const result = write(layout, styles, [target], 'PRESS_ANIM', '2')
  assert.equal(read(result.layout, 'KEY1', 'FORE_ANIM_STYLE'), '7,0,,9,')
  assert.equal(result.styles, styles, 'reuse STYLE9, not STYLE8 with a different unknown field')
  assert.equal(read(result.layout, 'KEY2', 'BACK_ANIM_STYLE'), '7')
  assert.equal(read(result.styles, 'STYLE7', 'PRESS_ANIM'), '1')
  const empty = write(result.layout, result.styles, [key('FORE_ANIM_STYLE', 2)], 'PRESS_ANIM', '2')
  assert.match(read(empty.layout, 'KEY1', 'FORE_ANIM_STYLE'), /^7,0,\d+,9,$/)
  assert.equal(readAnimationBinding(IniDocument.parse(empty.layout), IniDocument.parse(empty.styles), key('FORE_ANIM_STYLE', 1), 'PRESS_ANIM').style, undefined)
})

test('copy-on-write preserves shared style, other events, unknown and empty fields; repeat is no-op', () => {
  const result = write(layout, styles, [key('BACK_ANIM_STYLE')], 'SHOW_ANIM', '5')
  const id = read(result.layout, 'KEY1', 'BACK_ANIM_STYLE')
  assert.notEqual(id, '7')
  for (const [field, value] of [['INFO', 'shared'], ['PRESS_ANIM', '1'], ['RELEASE_ANIM', '3'], ['CUSTOM', 'opaque value'], ['EMPTY', ''], ['SHOW_ANIM', '5']]) assert.equal(read(result.styles, `STYLE${id}`, field), value)
  assert.equal(read(result.styles, 'STYLE7', 'SHOW_ANIM'), undefined)
  assert.equal(read(result.layout, 'KEY2', 'BACK_ANIM_STYLE'), '7')
  assert.deepEqual(write(result.layout, result.styles, [key('BACK_ANIM_STYLE')], 'SHOW_ANIM', '5'), result)
})

test('detach clones and preserves unrelated fields and events; absent binding is no-op', () => {
  const target = key('FORE_ANIM_STYLE', 3)
  const result = write(layout, styles, [target], 'PRESS_ANIM', undefined)
  const id = read(result.layout, 'KEY1', 'FORE_ANIM_STYLE').split(',')[3]
  assert.equal(read(result.layout, 'KEY1', 'FORE_ANIM_STYLE'), `7,0,,${id},`)
  assert.equal(read(result.styles, `STYLE${id}`, 'PRESS_ANIM'), undefined)
  assert.equal(read(result.styles, `STYLE${id}`, 'RELEASE_ANIM'), '3')
  assert.equal(read(result.styles, `STYLE${id}`, 'CUSTOM'), 'opaque value')
  assert.deepEqual(write(result.layout, result.styles, [target], 'PRESS_ANIM', undefined), result)
})

test('effective state inherits source field then overrides only the effective section', () => {
  const target = key('FORE_ANIM_STYLE', 3, 11)
  const before = readAnimationBinding(IniDocument.parse(layout), IniDocument.parse(styles), target, 'PRESS_ANIM')
  assert.equal(before.section, 'TIP4')
  assert.equal(before.sourceSection, 'KEY1')
  const result = write(layout, styles, [target], 'PRESS_ANIM', '2')
  assert.equal(read(result.layout, 'TIP4', 'FORE_ANIM_STYLE'), '7,0,,9,')
  assert.equal(read(result.layout, 'KEY1', 'FORE_ANIM_STYLE'), '7,0,, 7 ,')
})

test('panel applies and detaches one event from its current shared style', () => {
  const target = { section: 'PANEL', field: 'ANIM_STYLE' }
  const result = write(layout, styles, [target], 'SHOW_ANIM', '4')
  const id = read(result.layout, 'PANEL', 'ANIM_STYLE')
  assert.equal(read(result.styles, `STYLE${id}`, 'PRESS_ANIM'), '1')
  assert.equal(read(result.styles, `STYLE${id}`, 'RELEASE_ANIM'), '3')
  assert.equal(read(result.styles, `STYLE${id}`, 'CUSTOM'), 'opaque value')
  const detached = write(result.layout, result.styles, [target], 'SHOW_ANIM', undefined)
  assert.equal(read(detached.layout, 'PANEL', 'ANIM_STYLE'), '7')
  assert.equal(read(detached.layout, 'KEY2', 'BACK_ANIM_STYLE'), '7')
})

test('unlabelled complete style is reused; INFO and duplicate unknown fields are significant', () => {
  const l = '[KEY1]\nBACK_ANIM_STYLE=1\n'
  const s = '[STYLE1]\nPRESS_ANIM=1\nX=a\nX=b\n[STYLE2]\nPRESS_ANIM=2\nX=a\nX=b\n[STYLE3]\nPRESS_ANIM=2\nX=b\nX=a\n'
  const result = write(l, s, [key('BACK_ANIM_STYLE')], 'PRESS_ANIM', '2')
  assert.equal(read(result.layout, 'KEY1', 'BACK_ANIM_STYLE'), '2')
  assert.equal(result.styles, s)
  const otherInfo = s.replace('[STYLE2]\n', '[STYLE2]\nINFO=other\n')
  const changed = write(l, otherInfo, [key('BACK_ANIM_STYLE')], 'PRESS_ANIM', '2')
  assert.notEqual(read(changed.layout, 'KEY1', 'BACK_ANIM_STYLE'), '2')
  assert.notEqual(read(changed.layout, 'KEY1', 'BACK_ANIM_STYLE'), '3')
  assert.deepEqual(IniDocument.parse(changed.styles).entries(`STYLE${read(changed.layout, 'KEY1', 'BACK_ANIM_STYLE')}`).filter(({ key }) => key === 'X').map(({ value }) => value), ['a', 'b'])
})

test('multi-key and inherited detach keep independent state and slots', () => {
  const result = write(layout, styles, [key('BACK_ANIM_STYLE'), { section: 'KEY2', field: 'BACK_ANIM_STYLE' }], 'SHOW_ANIM', '5')
  assert.equal(read(result.layout, 'KEY1', 'BACK_ANIM_STYLE'), read(result.layout, 'KEY2', 'BACK_ANIM_STYLE'))
  const simpleLayout = '[KEY1]\nSTAT_STYLE=S11_4\nFORE_ANIM_STYLE=7,0,,\n[TIP4]\nCENTER=x\n'
  const simpleStyles = '[STYLE7]\nPRESS_ANIM=1\n'
  const target = key('FORE_ANIM_STYLE', 0, 11)
  const detached = write(simpleLayout, simpleStyles, [target], 'PRESS_ANIM', undefined)
  assert.equal(read(detached.layout, 'TIP4', 'FORE_ANIM_STYLE'), '0,0,,')
  assert.equal(read(detached.layout, 'KEY1', 'FORE_ANIM_STYLE'), '7,0,,')
  assert.equal(detached.styles, simpleStyles)
})

test('shared TIP is cloned only for the selected key and active state', () => {
  const source = '[PANEL]\nTIP_NUM=1\n[KEY1]\nSTAT_STYLE=S11_4|S12_4\nBACK_ANIM_STYLE=7\n[KEY2]\nSTAT_STYLE=S11_4\nBACK_ANIM_STYLE=7\n[TIP4]\nCENTER=x\nCUSTOM=keep\n'
  const target = key('BACK_ANIM_STYLE', 0, 11)
  const result = write(source, styles, [target], 'PRESS_ANIM', '2')
  const doc = IniDocument.parse(result.layout)
  assert.equal(doc.get('KEY1', 'STAT_STYLE'), 'S11_5|S12_4')
  assert.equal(doc.get('KEY2', 'STAT_STYLE'), 'S11_4')
  assert.equal(doc.get('TIP4', 'BACK_ANIM_STYLE'), undefined)
  assert.equal(doc.get('TIP5', 'BACK_ANIM_STYLE'), '9')
  assert.equal(doc.get('TIP5', 'CUSTOM'), 'keep')
  assert.equal(doc.get('PANEL', 'TIP_NUM'), '2')
  assert.deepEqual(write(result.layout, result.styles, [target], 'PRESS_ANIM', '2'), result)
})

test('missing trailing foreground slots inherit first style; explicit empty/zero slots do not', () => {
  const source = '[KEY1]\nFORE_ANIM_STYLE=7\n'
  const target = key('FORE_ANIM_STYLE', 3)
  assert.equal(readAnimationBinding(IniDocument.parse(source), IniDocument.parse(styles), target, 'PRESS_ANIM').animation, '1')
  const result = write(source, styles, [target], 'SHOW_ANIM', '4')
  const slots = read(result.layout, 'KEY1', 'FORE_ANIM_STYLE').split(',')
  assert.deepEqual(slots.slice(0, 3), ['7', '7', '7'])
  assert.equal(read(result.styles, `STYLE${slots[3]}`, 'PRESS_ANIM'), '1')
  assert.equal(read(result.styles, `STYLE${slots[3]}`, 'RELEASE_ANIM'), '3')
  const detached = write(source, styles, [target], 'PRESS_ANIM', undefined)
  assert.equal(read(detached.styles, `STYLE${read(detached.layout, 'KEY1', 'FORE_ANIM_STYLE').split(',')[3]}`, 'PRESS_ANIM'), undefined)
  for (const raw of ['7,', '7,0']) assert.equal(readAnimationBinding(IniDocument.parse(`[KEY1]\nFORE_ANIM_STYLE=${raw}\n`), IniDocument.parse(styles), key('FORE_ANIM_STYLE', 1), 'PRESS_ANIM').animation, undefined)
})
