import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { SkinArchive } from '../src/skin.ts'
import { convertSsfDocument } from '../src/ssf/ssf-convert.ts'
import { decodeBdaAnimation } from '../src/bda-decode.ts'
import { ssfFixture } from './helpers/ssf-fixture.mjs'

const read = name => new Uint8Array(readFileSync(new URL(`../public/${name}`, import.meta.url)))

test('Sogou to BDA retains both key bounce and the decoration resource', async () => {
  const files = unzipSync(ssfFixture({ single: true }))
  files['1080/anim.ini'] = strToU8(`[Anim_Style_Key_Qwertys]\nBG_ANIM=Animation_back\nDECO_ANIM=Animation_deco\nDECO_ANIM_NUMBER=-1\n[Animation_back]\nDOWN_ANIM_OBJ=Object_back\n[Object_back]\nANIM=Scale\n[Scale]\nTYPE=2\nDURATION=200\nKEYFRAME=Track,Track\n[Track]\nTIME=0,1\nVALUE=1,0.8\n[Animation_deco]\nDOWN_ANIM_OBJ=Object_deco\n[Object_deco]\nIMG=26key.png\nANIM=Fade\n[Fade]\nTYPE=4\nDURATION=200\nKEYFRAME=Alpha\n[Alpha]\nTIME=0,1\nVALUE=255,0\n`)
  const templates = { bda: SkinArchive.open(read('default-template.bda'), 'bda'), sogou: SkinArchive.open(read('sogou-template.bds')) }
  const result = await convertSsfDocument(SkinArchive.open(zipSync(files), 'ssf'), 'bda', templates)
  const output = SkinArchive.open(result.bytes, 'bda')
  const animation = decodeBdaAnimation(output.getBytes('light/skin/port/animationConfig'))
  const bindings = animation.targetBindings.get('KEY_Q')
  assert.ok(bindings.some(binding => ['scale', 'group'].includes(binding.kind)))
  assert.ok(bindings.some(binding => binding.kind === 'emitter'))
  const emitter = [...animation.effects.values()].find(effect => effect.kind === 'emitter')
  assert.ok(output.getBytes(`light/skin/res/${emitter.resources[0].resourceID}`))
  assert.ok(!result.warnings.some(w => w.includes('暂不转换为 BDA')))
})
