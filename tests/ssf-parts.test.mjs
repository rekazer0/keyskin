// Which Sogou sections the inspector edits for a key: they must be the ones the preview draws.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IniDocument } from '../src/ini.ts'
import { SsfPackage } from '../src/ssf/ssf-package.ts'
import { ssfKeyBinding } from '../src/ssf/ssf-keymap.ts'
import { ssfBackground, ssfForeground, ssfLabelStyle, ssfSoundSection, ssfTextSections } from '../src/ssf/ssf-parts.ts'
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
