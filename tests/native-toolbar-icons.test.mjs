import { test } from 'node:test'
import assert from 'node:assert/strict'
import { strToU8, zipSync, unzipSync } from 'fflate'
import { PalmStyles } from '../src/palm/palm-styles.ts'
import { SsfStyles } from '../src/ssf/ssf-scene.ts'
import { SsfPackage } from '../src/ssf/ssf-package.ts'
import { SkinArchive } from '../src/skin.ts'
import { ssfFixture } from './helpers/ssf-fixture.mjs'

test('SSF toolbar exposes missing native artwork without writing files and preserves legacy logo lookup', async () => {
  const files = unzipSync(ssfFixture())
  const original = globalThis.createImageBitmap
  globalThis.createImageBitmap = async () => ({ width: 8, height: 4 })
  try {
    files['default/ime_function_multimedia.png'] = files['1080/status1/bar.png']
    const archive = SkinArchive.open(zipSync(files), 'ssf')
    const before = archive.toBytes()
    const pkg = SsfPackage.fromFiles(new Map(Object.entries(files)))
    const icons = await new SsfStyles(archive, pkg, 'light').toolbarImages()
    assert.equal(icons.length, 9)
    assert.equal(icons.find(icon => icon.label === '菜单').imagePath, 'default/ime_function_multimedia.png')
    assert.equal(icons.find(icon => icon.label === '剪贴板').imagePath, '1080/status1/ime_function_clipboard.png')
    assert.equal(icons.find(icon => icon.label === '剪贴板').defaultIcon, 'clipboard-paste')
    assert.deepEqual(archive.toBytes(), before)
  } finally { globalThis.createImageBitmap = original }
})

test('SXI toolbar inspector includes menu entries and missing files without changing the canvas function list', async () => {
  const skin = { default: { menu: [[
    { Name: '17', Position: 'toolbar', Images: { Normal: { Normal: 'custom_keyboard' } } },
    { Name: '35', Position: 'menu', Images: { Normal: { Normal: 'clipboard' } } },
  ]] } }
  const archive = SkinArchive.open(zipSync({ 'skin.json': strToU8(JSON.stringify(skin)) }), 'sxi')
  const before = archive.toBytes()
  const styles = new PalmStyles(archive, skin, 'default', 'port')
  assert.deepEqual(await styles.toolbarImages(), [])
  const icons = await styles.resolveToolbarImages(Infinity)
  assert.deepEqual(icons.map(icon => icon.label), ['键盘类型', '剪贴板'])
  assert.deepEqual(icons.map(icon => icon.imagePath), ['light/skin/res/logo/custom_keyboard_iphone@3x.png', 'light/skin/res/logo/clipboard_iphone@3x.png'])
  assert.deepEqual(archive.toBytes(), before)
})
