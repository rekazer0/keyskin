import { test } from 'node:test'
import assert from 'node:assert/strict'
import { zipSync, strToU8 } from 'fflate'
import { readFileSync } from 'node:fs'
import { SkinArchive } from '../src/skin.ts'
import { IniDocument } from '../src/ini.ts'
import { convertBdaArchive } from '../src/bda-convert.ts'
import { bdaAnimationFixture } from './helpers/bda-animation-fixture.mjs'

for (const format of ['bdi', 'bds']) for (const dual of [false, true]) test(`${format} ${dual ? 'dual' : 'single'} animation config/resources survive editing and repacking`, async () => {
  const anim = '; retained comment\r\n[GLOBAL]\r\nANIM_NUM=1\r\n[ANIM1]\r\nCATEGORY=0\r\nTYPE=3\r\nDURATION=180\r\nFROM=80,80\r\nTO=100,100\r\nPRIVATE_KEY=keep\r\n'
  const css = '[GLOBAL]\nSTYLE_NUM=1\n[STYLE1]\nPRESS_ANIM=1\nSHOW_ANIM=1\nNM_IMG=frame,1\n'
  const files = { [format === 'bdi' ? 'skin/Info.txt' : 'Info.txt']: strToU8('Name=motion\n') }
  const prefix = (theme) => format === 'bdi' ? dual ? `skin/${theme}/skin/` : 'skin/' : dual ? `${theme}/` : ''
  for (const theme of dual ? ['light', 'dark'] : ['light']) {
    files[`${prefix(theme)}port/py_26.ini`] = strToU8('[PANEL]\nSIZE=480,320\n')
    files[`${prefix(theme)}res/anim.ini`] = strToU8(anim)
    files[`${prefix(theme)}res/default.css`] = strToU8(css)
    files[`${prefix(theme)}res/frame.png`] = Uint8Array.from([0, 12, 34, 255])
    files[`${prefix(theme)}res/private.motion`] = Uint8Array.from([255, 45, 0, 1])
  }
  const bytes = zipSync(files)
  const archive = SkinArchive.open(bytes, format)
  assert.deepEqual(await archive.toBytesAsync(), bytes)
  const path = 'light/skin/res/anim.ini'
  const document = IniDocument.parse(archive.getText(path))
  document.set('ANIM1', 'DURATION', '320')
  archive.setText(path, document.toString())
  assert.equal(archive.getText(path), anim.replace('DURATION=180', 'DURATION=320'))
  for (const target of ['bdi', 'bds']) {
    const saved = SkinArchive.open(await archive.toBytesAsync(target), target)
    for (const name of archive.names().filter((name) => !name.endsWith('Info.txt'))) assert.deepEqual(saved.getBytes(name), archive.getBytes(name), `${target}:${name}`)
  }
})

test('BDA conversion warns for transform-only, numbered and light animation configs instead of silent loss', () => {
  const source = SkinArchive.open(bdaAnimationFixture(), 'bda')
  const base = SkinArchive.open(new Uint8Array(readFileSync(new URL('../public/bda-base.bds', import.meta.url))), 'bds')
  for (const format of ['bdi', 'bds']) {
    const { warnings } = convertBdaArchive(source, base, format)
    const motionWarnings = warnings.filter((warning) => /保留动效请使用 BDA/.test(warning))
    assert.equal(motionWarnings.length, 12)
    assert.ok(motionWarnings.some((warning) => warning.includes('1animationConfig')))
    assert.ok(motionWarnings.some((warning) => warning.includes('lightAnimationConfig')))
    assert.ok(motionWarnings.every((warning) => warning.includes('alpha')))
  }
})
