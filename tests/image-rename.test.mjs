import assert from 'node:assert/strict'
import test from 'node:test'
import { strToU8, zipSync } from 'fflate'
import { SkinArchive } from '../src/skin.ts'
import { imageRenameChanges } from '../src/image-rename.ts'
import { encodeSkinJson, parseSkinJson } from '../src/palm/sxi-json.ts'
import { encodedField, encodeVarint, join } from '../src/bda-encode.ts'
import { decodedBdaEditorSource } from '../src/bda-source.ts'

const archiveOf = (files, format) => SkinArchive.open(zipSync(Object.fromEntries(Object.entries(files)
  .map(([path, value]) => [path, typeof value === 'string' ? strToU8(value) : value]))), format)
const apply = (archive, changes, side = 'after') => {
  for (const change of side === 'before' ? [...changes].reverse() : changes) {
    if (change.kind === 'text') archive.setText(change.path, change[side])
    else if (change[side]) archive.setBytes(change.path, change[side])
    else archive.delete(change.path)
  }
}
const files = {
  'light/res/btn.png': new Uint8Array([1, 2]),
  'light/res/btn.til': '[IMG0]\nSOURCE_RECT=0,0,2,2\n',
  'light/res/default.css': '[STYLE1]\nNM_IMG=btn,0\nHL_IMG=btn,1\nINFO=btn\n[STYLE2]\nNM_IMG=btn_other,0\n',
  'dark/res/btn.png': new Uint8Array([3]),
  'dark/res/default.css': '[STYLE1]\nNM_IMG=btn,0\n',
}
const image = 'light/skin/res/btn.png'

test('rename moves the image and slices, updates exact references in its theme, and reverses without loss', () => {
  const archive = archiveOf(files, 'bds')
  const original = archive.sourceFiles()
  const changes = imageRenameChanges(archive, image, '新名称.png')
  assert.deepEqual(archive.sourceFiles(), original, 'planning must not mutate the archive')
  apply(archive, changes)
  assert.equal(archive.getBytes(image), undefined)
  assert.deepEqual(archive.getBytes('light/skin/res/新名称.png'), new Uint8Array([1, 2]))
  assert.equal(archive.getText('light/skin/res/新名称.til'), files['light/res/btn.til'])
  const css = archive.getText('light/skin/res/default.css')
  assert.match(css, /NM_IMG=新名称,0\nHL_IMG=新名称,1/)
  assert.match(css, /INFO=btn/)
  assert.match(css, /NM_IMG=btn_other,0/)
  assert.equal(archive.getText('dark/skin/res/default.css'), files['dark/res/default.css'])
  apply(archive, changes, 'before')
  assert.deepEqual(archive.sourceFiles().sort((a, b) => a.path.localeCompare(b.path)), original.sort((a, b) => a.path.localeCompare(b.path)))
  assert.equal(archive.changed.size, 0)
  apply(archive, changes)
  assert.ok(archive.getBytes('light/skin/res/新名称.png'))
})

test('invalid names and image, orphan slice, directory or case-insensitive collisions never mutate data', () => {
  const archive = archiveOf({ ...files, 'light/res/taken.png': new Uint8Array([4]), 'light/res/orphan.til': '', 'light/res/folder.png/child': '' }, 'bds')
  for (const name of ['', '../btn.png', 'a/b.png', 'a\\b.png', 'a\u0000.png', 'a,b.png', 'a .png', ' a.png', '.png', '.hidden.png', 'btn.jpg', 'Btn.png', 'TAKEN.png', 'orphan.png', 'folder.png']) {
    assert.throws(() => imageRenameChanges(archive, image, name), undefined, name)
    assert.equal(archive.changed.size, 0)
  }
  assert.deepEqual(imageRenameChanges(archive, image, 'btn.png'), [])
})

test('orientation-specific references preserve the other direction and ambiguous shared references are rejected', () => {
  const archive = archiveOf({ ...files,
    'light/port/res/btn.png': new Uint8Array([5]),
    'light/port/res/default.css': '[STYLE1]\nNM_IMG=btn,0\n',
  }, 'bds')
  assert.throws(() => imageRenameChanges(archive, image, 'new.png'), /横竖屏/)
  archive.delete('light/skin/res/default.css')
  apply(archive, imageRenameChanges(archive, 'light/skin/port/res/btn.png', 'new.png'))
  assert.match(archive.getText('light/skin/port/res/default.css'), /NM_IMG=new,0/)
  assert.ok(archive.getBytes(image))
})

test('SSF references retain stretch parameters and other status folders', () => {
  const archive = archiveOf({
    'phoneTheme.ini': '[General]\nskin_name=test\n',
    '1080/status1/key.png': new Uint8Array([1]),
    '1080/status1/phoneSkin.ini': '[Image]\nNORMAL=key.png,1,2,3,4\nPRESSED=key.png\n',
    '1080/status2/key.png': new Uint8Array([2]),
    '1080/status2/phoneSkin.ini': '[Image]\nNORMAL=key.png\n',
  }, 'ssf')
  apply(archive, imageRenameChanges(archive, '1080/status1/key.png', 'renamed.png'))
  assert.match(archive.getText('1080/status1/phoneSkin.ini'), /NORMAL=renamed.png,1,2,3,4\nPRESSED=renamed.png/)
  assert.match(archive.getText('1080/status2/phoneSkin.ini'), /NORMAL=key.png/)
})

test('SXI renames the tile map, style references and resource paths while preserving other themes', () => {
  const skin = { default: { s_info: { info: { btn: [{ id: 'IMG0', rect1: [[0, 0], [2, 2]] }] }, ss_1: { 1: { s_2: { normal: 'btn,0', hl: 'btn,0' } } } }, res: ['light/res/btn.png'] }, night: { s_info: { ss_1: { 1: { s_2: { normal: 'btn,0' } } } } } }
  const archive = archiveOf({ ...files, 'skin.json': encodeSkinJson(skin) }, 'sxi')
  const changes = imageRenameChanges(archive, image, 'new.png')
  apply(archive, changes)
  const next = parseSkinJson(archive.getText('skin.json'))
  assert.deepEqual(next.default.s_info.info.new, skin.default.s_info.info.btn)
  assert.equal(next.default.s_info.info.btn, undefined)
  assert.equal(next.default.s_info.ss_1[1].s_2.normal, 'new,0')
  assert.equal(next.default.s_info.ss_1[1].s_2.hl, 'new,0')
  assert.deepEqual(next.default.res, ['light/res/new.png'])
  assert.equal(next.night.s_info.ss_1[1].s_2.normal, 'btn,0')
  apply(archive, changes, 'before')
  assert.equal(archive.getText('skin.json'), encodeSkinJson(skin))
  apply(archive, imageRenameChanges(archive, image, '__proto__.png'))
  const reserved = parseSkinJson(archive.getText('skin.json'))
  assert.equal(Object.hasOwn(reserved.default.s_info.info, '__proto__'), true)
  assert.deepEqual(reserved.default.s_info.info.__proto__, skin.default.s_info.info.btn)
})

test('BDA updates protobuf image resources and preserves unknown fields', () => {
  const resource = join([encodedField(1, 0, encodeVarint(0)), encodedField(2, 2, strToU8('btn'))])
  const atom = encodedField(1, 2, resource)
  const style = encodedField(1, 2, atom)
  const entry = join([encodedField(1, 0, encodeVarint(1)), encodedField(2, 2, style)])
  const unknown = encodedField(99, 0, encodeVarint(42))
  const appearance = join([encodedField(1, 2, entry), unknown])
  const archive = archiveOf({ 'light/port/appearanceConfig': appearance, 'light/res/btn.png': new Uint8Array([1]) }, 'bda')
  const config = 'light/skin/port/appearanceConfig'
  const before = JSON.parse(decodedBdaEditorSource(config, archive.getBytes(config)))
  assert.equal(before.imageStyles[1].normalImage.resource.resourceID, 'btn')
  apply(archive, imageRenameChanges(archive, image, 'new.png'))
  const after = JSON.parse(decodedBdaEditorSource(config, archive.getBytes(config)))
  assert.equal(after.imageStyles[1].normalImage.resource.resourceID, 'new')
  assert.deepEqual(archive.getBytes(config).slice(-unknown.length), unknown)
})
