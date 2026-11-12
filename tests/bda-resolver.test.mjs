import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SkinArchive } from '../src/skin.ts'
import { BdaResolver } from '../src/bda-resolver.ts'
import { decodeBdaAppearance } from '../src/bda-decode.ts'
import { bdaStyleID } from '../src/bda.ts'
import { addBdaStyle, updateBdaStyle } from '../src/bda-encode.ts'

test('BDA 只有按下颜色的列表和工具栏背景，正常状态保持透明', async () => {
  const archive = SkinArchive.open(new Uint8Array(readFileSync(new URL('../public/default-template.bda', import.meta.url))), 'bda')
  const added = addBdaStyle(archive.getBytes('light/skin/port/appearanceConfig'), 'color')
  const bytes = updateBdaStyle(added.bytes, added.ref, 'HL_COLOR', '1A0079BB')
  const resolver = new BdaResolver(archive, bytes)
  assert.equal((await resolver.resolve(bdaStyleID(added.ref), false)).color, undefined)
  assert.equal((await resolver.resolve(bdaStyleID(added.ref), true)).color, 'rgba(0, 121, 187, 0.102)')
})

test('a BDA image with an empty innerRect stretches whole instead of pinning to a nine-slice corner', async () => {
  const archive = SkinArchive.open(new Uint8Array(readFileSync(new URL('../public/default-template.bda', import.meta.url))), 'bda')
  const appearanceBytes = archive.getBytes('light/skin/port/appearanceConfig')
  const panel = decodeBdaAppearance(appearanceBytes).panels.get('py_9')
  // The official default keyboard background (res/10001.png) carries innerRect 0,0,0,0.
  assert.deepEqual(decodeBdaAppearance(appearanceBytes).imageStyles.get(panel.backStyle.key).normalImage.innerRect, { x: 0, y: 0, width: 0, height: 0 })
  const original = globalThis.createImageBitmap
  globalThis.createImageBitmap = async () => ({ width: 382, height: 249 })
  try {
    const visual = await new BdaResolver(archive, appearanceBytes).resolve(bdaStyleID(panel.backStyle), false)
    assert.deepEqual(visual.source, [0, 0, 382, 249])
    assert.equal(visual.inner, undefined)
  } finally {
    globalThis.createImageBitmap = original
  }
})
