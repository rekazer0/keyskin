import assert from 'node:assert/strict'
import { test } from 'node:test'
import { strToU8, zipSync } from 'fflate'
import { AtlasResolver } from '../src/atlas.ts'
import { IniDocument } from '../src/ini.ts'
import { withTileHeader } from '../src/tiles.ts'
import { SkinArchive } from '../src/skin.ts'

for (const format of ['bdi', 'bds']) {
  test(`${format} resolves shuffled tile names using its platform's indexing rule`, async () => {
    const prefix = format === 'bdi' ? 'skin/' : 'light/'
    const archive = SkinArchive.open(zipSync({
      [`${prefix}res/default.css`]: strToU8('[STYLE1]\nNM_IMG=keys,1\nHL_IMG=keys,2\n[STYLE2]\nNM_IMG=keys,0\n[STYLE3]\nNM_IMG=keys,3\n'),
      [`${prefix}res/keys.png`]: new Uint8Array(),
      [`${prefix}res/keys.til`]: strToU8('[GLOBAL]\nTILE_NUM=2\n[IMG2]\nSOURCE_RECT=10,20,100,80\nINNER_RECT=15,26,30,40\nSCALE=1,2,3,4,5\n[METADATA]\nINFO=ignored\n[IMG1]\nSOURCE_RECT=0,0,50,60\n'),
    }), format)
    const original = archive.getText('light/skin/res/keys.til')
    const resolver = new AtlasResolver(archive, 'light', 'port')
    resolver.bitmap = async () => ({})
    const first = { source: [10, 20, 100, 80], inner: [5, 6, 30, 40], scale: [1, 2, 3, 4, 5] }
    const second = { source: [0, 0, 50, 60], inner: undefined, scale: undefined }
    for (const pressed of [false, true]) {
      const expected = (format === 'bdi') !== pressed ? first : second
      const visual = await resolver.resolve('1', pressed)
      assert.deepEqual(visual.source, expected.source)
      assert.deepEqual(visual.inner, expected.inner)
      assert.deepEqual(visual.scale, expected.scale)
      assert.deepEqual(resolver.sourceSize('1', pressed), { width: expected.source[2], height: expected.source[3] })
    }
    for (const id of ['2', '3']) {
      assert.equal((await resolver.resolve(id, false)).source, undefined)
      assert.equal(resolver.sourceSize(id, false), undefined)
    }
    assert.equal(archive.getText('light/skin/res/keys.til'), original)
    assert.equal(archive.revision, 0)
  })
}

for (const format of ['bdi', 'bds']) {
  test(`${format} handles legacy numeric suffixes according to the platform`, async () => {
    const prefix = format === 'bdi' ? 'skin/' : ''
    const til = '[IMG1]\nSOURCE_RECT=0,32日,32日,32\nINNER_RECT=4日,36,24,24\n[IMG2]\nSOURCE_RECT=0,日,32,32\n'
    const archive = SkinArchive.open(zipSync({
      [`${prefix}res/default.css`]: strToU8('[STYLE1]\nNM_IMG=toolbar,1\n[STYLE2]\nNM_IMG=toolbar,2\n'),
      [`${prefix}res/toolbar.png`]: new Uint8Array(),
      [`${prefix}res/toolbar.til`]: strToU8(til),
    }), format)
    const resolver = new AtlasResolver(archive, 'light', 'port')
    resolver.bitmap = async () => ({ width: 32, height: 64 })
    const android = format === 'bds'
    const expected = android ? [0, 32, 32, 32] : undefined
    assert.deepEqual(resolver.sourceRect('1', false), expected)
    const visual = await resolver.resolve('1', false)
    assert.deepEqual(visual.source, expected)
    assert.deepEqual(visual.inner, android ? [4, 4, 24, 24] : undefined)
    assert.equal(resolver.sourceRect('2', false), undefined)
    assert.equal(archive.getText('light/skin/res/toolbar.til'), til)
    assert.equal(archive.revision, 0)
  })
}

test('TIL headers cover the highest slice index and preserve the alpha mode', () => {
  const slice = '[IMG38]\r\nSOURCE_RECT=0,0,1,1\r\n'
  const repaired = withTileHeader(IniDocument.parse(`\uFEFF${slice}`))
  assert.equal(repaired.toString(), `\uFEFF[GLOBAL]\r\nUSE_ALPHA=1\r\nTILE_NUM=38\r\n\r\n${slice}`)
  const existing = withTileHeader(IniDocument.parse(`[GLOBAL]\r\nUSE_ALPHA=2\r\nTILE_NUM=35\r\n\r\n${slice}`))
  assert.equal(existing.toString(), `[GLOBAL]\r\nUSE_ALPHA=2\r\nTILE_NUM=38\r\n\r\n${slice}`)
})
