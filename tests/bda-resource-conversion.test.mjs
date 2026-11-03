import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SkinArchive } from '../src/skin.ts'
import { IniDocument } from '../src/ini.ts'
import { addBdaStyle, updateBdaStyle, updateBdaImageInnerRect } from '../src/bda-encode.ts'
import { convertBdaArchive } from '../src/bda-convert.ts'
import { encodePng } from '../src/ssf/ssf-png.ts'
import { bdaAnimatedSkinBytes, bdsBaseArchive } from './helpers/bda-animation-fixture.mjs'

const css = (archive, orientation) => IniDocument.parse(archive.getText(`light/skin/${orientation}/res/default.css`))

test('BDA image styles sharing one PNG retain their different stretch regions', () => {
  const source = SkinArchive.open(bdaAnimatedSkinBytes(), 'bda')
  const path = 'light/skin/port/appearanceConfig'
  let bytes = source.getBytes(path)
  const refs = []
  for (const rect of [[0, 0, 1, 1], [1, 1, 2, 2]]) {
    const added = addBdaStyle(bytes, 'image')
    bytes = updateBdaStyle(added.bytes, added.ref, 'NM_IMG', 'stretch')
    bytes = updateBdaImageInnerRect(bytes, added.ref, false, rect)
    refs.push(added.ref)
  }
  source.setBytes(path, bytes)
  source.setBytes('light/skin/res/stretch.png', encodePng({ width: 4, height: 4, data: new Uint8Array(64).fill(100) }))
  const { archive } = convertBdaArchive(source, bdsBaseArchive())
  const styles = css(archive, 'port')
  const resources = refs.map(ref => styles.get(`STYLE${1000000 + ref.key}`, 'NM_IMG').split(',')[0])
  assert.notEqual(resources[0], resources[1])
  const inner = resources.map(name => IniDocument.parse(archive.getText(`light/skin/res/${name}.til`)).get('IMG1', 'INNER_RECT'))
  assert.deepEqual(inner, ['0,0,1,1', '1,1,2,2'])
})

test('BDA frame animation copies the current orientation GIF, never another theme or orientation', () => {
  const source = SkinArchive.open(bdaAnimatedSkinBytes(), 'bda')
  const port = new TextEncoder().encode('GIF89aPORT')
  const land = new TextEncoder().encode('GIF89aLAND')
  source.setBytes('light/skin/port/res/spark.gif', port)
  source.setBytes('light/skin/land/res/spark.gif', land)
  const { archive } = convertBdaArchive(source, bdsBaseArchive())
  assert.deepEqual(archive.getBytes('light/skin/port/res/spark.gif'), port)
  assert.deepEqual(archive.getBytes('light/skin/land/res/spark.gif'), land)
  for (const orientation of ['port', 'land']) assert.ok(css(archive, orientation).entries().some(entry => entry.key === 'SHOW_ANIM'))
})
