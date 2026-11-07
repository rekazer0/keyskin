import { test } from 'node:test'
import assert from 'node:assert/strict'
import { strToU8, zipSync } from 'fflate'
import { SkinArchive } from '../src/skin.ts'
import { AtlasResolver } from '../src/atlas.ts'
import { toolbarImageRect } from '../src/preview-draw.ts'

function resolver(format) {
  const prefix = format === 'bds' ? 'light/' : 'skin/'
  return new AtlasResolver(SkinArchive.open(zipSync({
    [`${prefix}Info.txt`]: strToU8('AtomSkinName=test'),
    [`${prefix}res/default.css`]: strToU8('[GLOBAL]\nFONT_PATH=W5.ttf\n[STYLE1603]\nFONT_SIZE=55\nNM_COLOR=FFFFFF\nHL_COLOR=FF0000\n[STYLE1]\nSHOW=ABC\nFONT_SIZE=50\n'),
    [`${prefix}res/W5.ttf`]: new Uint8Array([0, 1, 2, 3]),
  }), format), 'light', 'port')
}

test('Android fixed LIST uses its own default paint and 1.2x size, without changing key fonts', () => {
  const atlas = resolver('bds')
  assert.match(atlas.resolveText('1603', false).fontName, /^BdiEmbeddedFont/)
  const list = atlas.resolveListText('1603', false)
  assert.equal(list.fontName, undefined)
  assert.equal(list.fontSize, 66)
  assert.equal(list.color, '#FFFFFF')
  assert.equal(atlas.resolveListText('1603', true).color, '#FF0000')
  assert.match(atlas.resolveStyleText('1', false).fontName, /^BdiEmbeddedFont/)
  assert.equal(atlas.resolveStyleText('1', false).fontSize, 50)
  assert.equal(atlas.resolveListText('99999', false).fontSize, undefined)
  assert.equal(atlas.resolveListText('99999', false).fontName, undefined)
})

test('iOS LIST retains the skin font and configured size', () => {
  const atlas = resolver('bdi')
  assert.deepEqual(atlas.resolveListText('1603', false), atlas.resolveText('1603', false))
  assert.equal(atlas.resolveListText('1603', false).fontSize, 55)
})

const slot = { x: 100, y: 12, width: 120, height: 88 }
test('Android normal toolbar scales an 88px atlas tile to 72px and centers it', () => {
  assert.deepEqual(toolbarImageRect({ imagePath: 'dark/skin/res/logo/pop_menu_icons.png', source: [264, 264, 88, 88] }, slot, 1125, 375),
    { x: 124, y: 20, width: 72, height: 72 })
})

test('toolbar fitting preserves iOS point sizing and contains large Android images', () => {
  const ios = { imagePath: 'light/skin/res/logo/icon_iphone@3x.png', source: [0, 0, 88, 88] }
  assert.deepEqual(toolbarImageRect(ios, slot, 1125, 375), { x: 116, y: 12, width: 88, height: 88 })
  assert.equal(toolbarImageRect(ios, slot, 1125, 500).width, 66)
  const large = { imagePath: 'light/skin/res/logo/pop_menu_icons.png', source: [0, 0, 400, 200] }
  assert.deepEqual(toolbarImageRect(large, slot, 1125), { x: 100, y: 26, width: 120, height: 60 })
})
