import { test } from 'node:test'
import assert from 'node:assert/strict'
import { strToU8 } from 'fflate'
import { IniDocument } from '../src/ini.ts'
import { SkinArchive } from '../src/skin.ts'
import { declarations, run } from './helpers/app-source.mjs'

function setup(texts, stylePath = 'light/skin/port/res/default.css') {
  let context
  context = run(declarations('usageIndex', 'styleUsageIndex', 'legacyStyleReferencePaths', 'replaceStyleReferences', 'styleUsages', 'missingStyleReferences', 'isStyleReferenceKey', 'legacyAnimationConfigPath'), {
    IniDocument,
    archive: SkinArchive.fromFiles(new Map(Object.entries(texts).map(([path, text]) => [path, strToU8(text)])), 'bds'),
    theme: { value: 'light' },
    orientation: { value: 'port' },
    styleConfigPath: () => stylePath,
    isEditing: () => true,
    commitTextChanges: changes => { for (const { path, after } of changes) context.archive.setText(path, after) },
    layoutSource: () => context.archive,
    availableStyleIDs: () => IniDocument.parse(context.archive.getText(stylePath)).sections().flatMap(section => /^STYLE(\d+)$/.exec(section)?.[1] ?? []),
  })
  return context
}

test('direction styles retain particle images referenced by shared animations', () => {
  const context = setup({
    'light/skin/port/res/default.css': '[STYLE1]\nNM_IMG=particle,1\n[STYLE2]\nPRESS_ANIM=1\n[STYLE3]\nNM_IMG=unused,1\n',
    'light/skin/port/py_9.ini': '[KEY1]\nFORE_ANIM_STYLE=2\n',
    'light/skin/res/anim.ini': '[ANIM1]\nPARTICLE_IMAGE=1,4\n',
    'dark/skin/res/anim.ini': '[ANIM1]\nPARTICLE_IMAGE=3\n',
  })
  assert.deepEqual(Array.from(context.styleUsages('1')), ['light/skin/res/anim.ini · [ANIM1] PARTICLE_IMAGE'])
  assert.equal(context.styleUsages('2').length, 1)
  assert.equal(context.styleUsages('3').length, 0, 'other themes do not keep an unused style alive')
  assert.deepEqual(Array.from(context.missingStyleReferences(), item => item.id), ['4'])
})

test('direction animation overrides exclude the shared animation references', () => {
  const context = setup({
    'light/skin/port/res/default.css': '[STYLE1]\nNM_IMG=particle,1\n[STYLE2]\nNM_IMG=old,1\n[STYLE3]\nNM_IMG=land,1\n',
    'light/skin/land/res/default.css': '[STYLE3]\nNM_IMG=land,1\n',
    'light/skin/port/anim.ini': '[ANIM1]\nPARTICLE_IMAGE=1\n',
    'light/skin/res/anim.ini': '[ANIM1]\nPARTICLE_IMAGE=2\n',
    'light/skin/land/anim.ini': '[ANIM1]\nPARTICLE_IMAGE=3\n',
  })
  assert.equal(context.styleUsages('1').length, 1)
  assert.equal(context.styleUsages('2').length, 0, 'the shared animation is overridden')
  assert.equal(context.styleUsages('3').length, 0, 'a separate direction has its own stylesheet')
})

test('shared styles retain references across applicable layouts and refresh after edits', () => {
  const path = 'light/skin/res/default.css'
  const context = setup({
    [path]: '[STYLE1]\nNM_IMG=port,1\n[STYLE2]\nNM_IMG=land,1\n[STYLE3]\nNM_IMG=particle,1\n[STYLE4]\nNM_IMG=other,1\n',
    'light/skin/port/py_9.ini': '[KEY1]\nBACK_STYLE=1\n',
    'light/skin/land/py_9.ini': '[KEY1]\nBACK_STYLE=2\n',
    'light/skin/res/anim.ini': '[ANIM1]\nPARTICLE_IMAGE=3\n',
    'dark/skin/port/py_9.ini': '[KEY1]\nBACK_STYLE=4\n',
  }, path)
  for (const id of ['1', '2', '3']) assert.equal(context.styleUsages(id).length, 1)
  assert.equal(context.styleUsages('4').length, 0)
  context.archive.setText('light/skin/res/anim.ini', '[ANIM1]\nPARTICLE_IMAGE=4\n')
  assert.equal(context.styleUsages('3').length, 0)
  assert.equal(context.styleUsages('4').length, 1)
})

test('large-library usage counts retain direct and numeric text fallback references', () => {
  const layout = 'light/skin/port/py_9.ini'
  const context = setup({
    'light/skin/port/res/default.css': '[STYLE1]\nSHOW=a\n',
    [layout]: '[KEY1]\nFORE_STYLE=199,100,1,0100\n',
  })
  assert.equal(context.styleUsages('1').length, 3, 'direct reference plus both ends of the fallback range')
  assert.equal(context.styleUsages('0100').length, 1, 'noncanonical IDs still match directly')
  context.archive.setText(layout, '[KEY1]\nFORE_STYLE=200\n')
  assert.equal(context.styleUsages('1').length, 0)
  assert.equal(context.styleUsages('2').length, 1)
})


test('bulk replacement rewrites exact ids across layouts sharing the original stylesheet', () => {
  const stylePath = 'light/skin/res/default.css'
  const port = 'light/skin/port/py_9.ini'
  const land = 'light/skin/land/py_9.ini'
  const dark = 'dark/skin/port/py_9.ini'
  const styles = '[STYLE1]\nNM_IMG=old,0\n[STYLE2]\nNM_IMG=new,0\n'
  const key = '[KEY1]\nBACK_STYLE=1\nFORE_STYLE=11, 1,,0, 100,1\nPOS=1,1\n'
  const context = setup({ [stylePath]: styles, [port]: key, [land]: key, [dark]: key }, stylePath)
  assert.equal(context.replaceStyleReferences('1', '2'), true)
  const expected = '[KEY1]\nBACK_STYLE=2\nFORE_STYLE=11, 2,,0, 100,2\nPOS=1,1\n'
  assert.equal(context.archive.getText(port), expected)
  assert.equal(context.archive.getText(land), expected)
  assert.equal(context.archive.getText(dark), key)
  assert.equal(context.archive.getText(stylePath), styles)

  context.archive.setText('light/skin/land/res/default.css', styles)
  context.replaceStyleReferences('2', '1')
  assert.equal(context.archive.getText(port), key)
  assert.equal(context.archive.getText(land), expected, 'a direction with its own stylesheet is not changed')
})
