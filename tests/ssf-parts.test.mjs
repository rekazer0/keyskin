// Which Sogou sections the inspector edits for a key: they must be the ones the preview draws.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IniDocument } from '../src/ini.ts'
import { SsfPackage } from '../src/ssf/ssf-package.ts'
import { ssfKeyBinding } from '../src/ssf/ssf-keymap.ts'
import { ssfBackground, ssfForeground, ssfForegroundLayout, ssfLabelStyle, ssfSoundSection, ssfTextSections } from '../src/ssf/ssf-parts.ts'
import { ssfSectionLabel } from '../src/ssf/ssf-labels.ts'
import { unzipSync } from 'fflate'
import { ssfFixture } from './helpers/ssf-fixture.mjs'

const pkg = SsfPackage.fromFiles(new Map(Object.entries(unzipSync(ssfFixture()))))
const skin = pkg.skin('light')
const keys = pkg.keys('light')
const sounds = pkg.ini('default/sound_android.ini')

test('ssf parts: a key class names its own background, other letters fall back to the shared default', () => {
  assert.deepEqual(ssfBackground(skin, ssfKeyBinding('py_26.ini', 'q', false)), { owner: 'Key_Q', images: 'SMA_Key26Bg_Q' })
  assert.deepEqual(ssfBackground(skin, ssfKeyBinding('py_26.ini', 'w', false)), { images: 'KeyBg_Default_Latin' })
  assert.deepEqual(ssfBackground(skin, ssfKeyBinding('py_9.ini', 'F36', false)), { images: 'KeyBg_Function' })
  // Converters also require the file to exist; a missing file moves on to the next candidate.
  assert.deepEqual(ssfBackground(skin, ssfKeyBinding('py_26.ini', 'q', false), (ref) => ref.file !== '26keyq.png'), { images: 'KeyBg_Default_Latin' })
})

test('ssf parts: foregrounds come from keys.ini first, then a phoneSkin icon; transparent icons keep their owner', () => {
  assert.deepEqual(ssfForeground(skin, keys, ssfKeyBinding('py_26.ini', 'q', false)), { kind: 'keys', owner: 'Key_Q', images: 'Foground_key_Q', rect: [0, 0.25, 1, 0.75] })
  assert.deepEqual(ssfForeground(skin, keys, ssfKeyBinding('py_26.ini', 'F36', false)), { kind: 'icon', owner: 'Key_Backspace_Qwerty' })
  assert.deepEqual(ssfForeground(skin, keys, ssfKeyBinding('py_26.ini', 'F38', false)), { kind: 'icon', owner: 'Key_Space' })
})

test('ssf parts: label colours and sounds are looked up from the key class to the shared styles', () => {
  // Sogou reads no TEXT_COLOR from a key's own section, only from text styles.
  assert.deepEqual(ssfTextSections(ssfKeyBinding('py_26.ini', 'q', false), true), ['TextStyle_Qwerty', 'TextStyle'])
  assert.deepEqual(ssfTextSections(ssfKeyBinding('py_9.ini', 'F36', false), false), ['TextStyle_FuncKey_T9', 'TextStyle'])
  // Sogou reads key text through FG_STYLE → LABEL_STYLE, ahead of the class defaults.
  const labelled = IniDocument.parse('[Key_Q]\nFG_STYLE=FGStyle_Q,FGStyle_2\n[FGStyle_Q]\nLABEL_STYLE=TextStyle_Q\n')
  assert.deepEqual(ssfLabelStyle(labelled, ssfKeyBinding('py_26.ini', 'q', false)), { fgStyle: 'FGStyle_Q', owner: 'Key_Q', style: 'TextStyle_Q' })
  assert.deepEqual(ssfTextSections(ssfKeyBinding('py_26.ini', 'q', false), true, labelled), ['TextStyle_Q', 'TextStyle_Qwerty', 'TextStyle'])
  assert.equal(ssfLabelStyle(labelled, ssfKeyBinding('py_26.ini', 'w', false)), undefined)
  assert.equal(ssfSoundSection(sounds, ssfKeyBinding('py_26.ini', 'F36', false)), 'Key_Backspace_Qwerty')
  assert.equal(ssfSoundSection(sounds, ssfKeyBinding('py_26.ini', 'q', false)), undefined)
  assert.equal(ssfSoundSection(sounds, undefined), 'Key')
  assert.equal(ssfSoundSection(IniDocument.parse(''), undefined), undefined)
})

test('ssf labels: sections read as key names', () => {
  assert.equal(ssfSectionLabel('Key_A'), '按键 A')
  assert.equal(ssfSectionLabel('Key_H_Land_PY'), '按键 H')
  assert.equal(ssfSectionLabel('Key_Backspace_Qwerty'), '按键 删除')
  assert.equal(ssfSectionLabel('SMA_Key9Bg_ABC'), 'ABC 背景')
  assert.equal(ssfSectionLabel('KeyBg_Default_Latin'), '全键默认背景')
  assert.equal(ssfSectionLabel('status2'), '外观 2')
  assert.equal(ssfSectionLabel('Mystery'), 'Mystery')
})

test('SSF enter icons inherit the board foreground layout without an explicit FG_STYLE', () => {
  const skin = IniDocument.parse('[Key_Enter]\nICON=send.png\n')
  for (const landscape of [false, true]) {
    const suffix = landscape ? '_Land' : ''
    for (const board of ['py_9', 'def_9', 'cantonese_9', 'big_9']) {
      assert.deepEqual(ssfForegroundLayout(skin, ssfKeyBinding(board, 'F39', landscape), board, landscape), { fgStyle: `FGStyle_Enter_Py9${suffix}` })
    }
    assert.deepEqual(ssfForegroundLayout(skin, ssfKeyBinding('py_26', 'F39', landscape), 'py_26', landscape), { fgStyle: `FGStyle_Enter_Py26${suffix}` })
    assert.deepEqual(ssfForegroundLayout(skin, ssfKeyBinding('py_9_big_enter', 'F39', landscape), 'py_9_big_enter', landscape), { fgStyle: `FGStyle_Enter_Py9${suffix}` })
  }
  skin.set('Key_Enter', 'FG_STYLE', 'CustomEnter')
  assert.deepEqual(ssfForegroundLayout(skin, ssfKeyBinding('py_9', 'F39', true), 'py_9', true), { fgStyle: 'CustomEnter' })
})

test('SSF foreground and label styles inherit the exact official board binding, with explicit overrides first', () => {
  const skin = IniDocument.parse('[FGStyle_Clear_Py9]\nLABEL_STYLE=CustomClearText\nICON_RECT=0.6,0,1,0.3\n')
  const binding = ssfKeyBinding('big_9', 'F40', false, 'Key_Clear_Input', undefined, 'FGStyle_Clear_Py9')
  assert.deepEqual(ssfForegroundLayout(skin, binding, 'big_9', false), { fgStyle: 'FGStyle_Clear_Py9' })
  assert.deepEqual(ssfTextSections(binding, false, skin), ['CustomClearText', 'TextStyle_FuncKey_T9', 'TextStyle'])
  skin.appendSection('Key_Clear_Input', [{ key: 'FG_STYLE', value: 'OwnClear' }])
  assert.deepEqual(ssfForegroundLayout(skin, binding, 'big_9', false), { fgStyle: 'OwnClear' })
})

test('SSF inherited switch foregrounds keep their built-in label styles when the skin only changes geometry', () => {
  const skin = IniDocument.parse('[FGStyle_Switch_Py9]\nLABEL_POSITION=0,0,1,1\n')
  const binding = ssfKeyBinding('py_9', 'F16', false, 'Key_SwitchToEN', undefined, 'FGStyle_Switch_Py9')
  assert.deepEqual(ssfForegroundLayout(skin, binding, 'py_9', false), {
    fgStyle: 'FGStyle_Switch_Py9', label: 'TextStyle_Switch', minor: 'TextStyle_MinorLabel_Switch',
  })
  skin.set('FGStyle_Switch_Py9', 'LABEL_STYLE', 'CustomSwitch')
  assert.equal(ssfForegroundLayout(skin, binding, 'py_9', false).label, 'CustomSwitch')
  skin.appendSection('Key_SwitchToEN', [{ key: 'FG_STYLE', value: 'ExplicitSwitch' }])
  assert.deepEqual(ssfForegroundLayout(skin, binding, 'py_9', false), { fgStyle: 'ExplicitSwitch' })
})
