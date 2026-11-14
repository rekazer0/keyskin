import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { strFromU8, strToU8, zipSync, unzipSync } from 'fflate'
import { prepareSogouShare, prepareShouXinShare } from '../src/adb-package.ts'
import { parseZip } from '../src/skin-zip.ts'

test('搜狗分享只改元数据和目录，保留资源的原始压缩数据', () => {
  const input = zipSync({
    'phoneTheme.ini': strToU8('[General]\nskin_name=中文😀\nskin_type=2051\noperational_skin=32\n'),
    '1080/resource.bin': new Uint8Array(1024 * 1024).fill(123),
  }, { level: 0 })
  const result = prepareSogouShare(input)
  const files = unzipSync(result.bytes)
  assert.match(result.name, /^keyskin-[a-z0-9]+\.ssf$/)
  const theme = strFromU8(files['phoneTheme.ini'])
  assert.match(theme, /skin_name=中文😀/)
  assert.match(theme, /skin_type=3/)
  assert.match(theme, /local_ugc=true/)
  assert.ok(theme.includes(`skin_id=${result.name.slice(0, -4)}`))
  assert.doesNotMatch(theme, /operational_skin/)
  assert.ok(files['1080/'])
  assert.ok(Object.keys(files).indexOf('1080/') < Object.keys(files).indexOf('1080/resource.bin'), '目录位于内容之前')
  const resource = (bytes) => parseZip(bytes).entries.find(({ name }) => name === '1080/resource.bin').local
  assert.deepEqual(resource(result.bytes), resource(input), '不解压或重新编码大资源')
  assert.doesNotMatch(strFromU8(unzipSync(input)['phoneTheme.ini']), /local_ugc/, '原文件不被修改')
  assert.throws(() => prepareSogouShare(zipSync({})), /phoneTheme.ini/)
})

test('手心分享补齐导入文件，保留 SXI 资源、预览优先级和压缩数据', async () => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => {
    const bytes = await readFile(new URL('../public/templates/palm-harmony.sxi', import.meta.url))
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  } })
  const previousDocument = globalThis.document
  globalThis.document = { baseURI: 'http://localhost/' }
  try {
    const preview = new Uint8Array([1, 2, 3])
    const input = zipSync({
      'skin.json': strToU8('{"info":{"name":"手心"}}'),
      'light/preview.png': preview,
      'dark/preview.png': new Uint8Array([4]),
      'light/res/asset.dat': new Uint8Array(1024 * 1024).fill(41),
    }, { level: 0 })
    const result = await prepareShouXinShare(input)
    const files = unzipSync(result.bytes)
    assert.match(result.name, /^keyskin-[a-z0-9]+\.piska$/)
    assert.deepEqual(files['preview.png'], preview)
    assert.deepEqual(files['preview_small.png'], preview)
    assert.ok(files['skin.proto'].length)
    assert.match(strFromU8(files['skin.ini']), /name = KeySkin/)
    assert.equal(strFromU8(files['skin.json']), '{"info":{"name":"手心"}}')
    assert.ok(files['light/'] && files['light/res/'])
    assert.ok(Object.keys(files).indexOf('light/res/') < Object.keys(files).indexOf('light/res/asset.dat'))
    const resource = (bytes) => parseZip(bytes).entries.find(({ name }) => name === 'light/res/asset.dat').local
    assert.deepEqual(resource(result.bytes), resource(input))
    await assert.rejects(prepareShouXinShare(zipSync({})), /skin.json/)
  } finally {
    globalThis.fetch = previousFetch
    globalThis.document = previousDocument
  }
})
