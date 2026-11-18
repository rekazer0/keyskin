import test from 'node:test'
import assert from 'node:assert/strict'
import { zipSync, unzipSync, strToU8, Zip, ZipDeflate } from 'fflate'
import { parseZip, patchZip, view } from '../src/skin-zip.ts'

for (const level of [0, 6]) test(`ZIP patch 增删改和空文件，原样保留其他条目（level=${level}）`, () => {
  const bytes = zipSync({ '中文.ini': strToU8('before'), 'remove': strToU8('x'), 'resource': new Uint8Array(4096).fill(42) }, { level })
  const source = parseZip(bytes)
  const original = bytes.slice()
  const output = patchZip(source, new Map([
    ['中文.ini', strToU8('after')], ['remove', undefined], ['new/', new Uint8Array()], ['new/empty', new Uint8Array()],
  ]))
  assert.deepEqual(unzipSync(output), {
    '中文.ini': strToU8('after'), 'resource': new Uint8Array(4096).fill(42), 'new/': new Uint8Array(), 'new/empty': new Uint8Array(),
  })
  const resource = (zip) => zip.entries.find(({ name }) => name === 'resource').local
  assert.deepEqual(resource(parseZip(output)), resource(source))
  assert.deepEqual(bytes, original)
  assert.deepEqual(unzipSync(patchZip(source, new Map(source.entries.map(({ name }) => [name, undefined])))), {})
})

test('ZIP patch 更新流式条目的数据描述符及中央目录', () => {
  const chunks = []
  const zip = new Zip((error, chunk) => { assert.ifError(error); chunks.push(chunk) })
  const file = new ZipDeflate('stream.ini')
  zip.add(file)
  file.push(strToU8('before'), true)
  zip.end()
  const bytes = new Uint8Array(Buffer.concat(chunks))
  const output = patchZip(parseZip(bytes), new Map([['stream.ini', strToU8('after after')]]))
  assert.deepEqual(unzipSync(output)['stream.ini'], strToU8('after after'))
  assert.equal(parseZip(output).entries[0].uncompressedSize, 11)
})

test('ZIP patch 修复普通条目缺失的数据描述符，不重压其他条目', () => {
  const source = parseZip(zipSync({ 'cand.cnd': strToU8('before'), resource: strToU8('unchanged') }))
  const [candidate, resource] = source.entries
  view(candidate.local).setUint16(6, 8, true)
  view(candidate.central).setUint16(8, 8, true)
  const edited = strToU8('after after')
  const output = patchZip(source, new Map([['cand.cnd', edited]]))
  assert.deepEqual(unzipSync(output), { 'cand.cnd': edited, resource: strToU8('unchanged') })
  const [updated, preserved] = parseZip(output).entries
  assert.equal(view(updated.local).getUint16(6, true) & 8, 0)
  assert.equal(view(updated.central).getUint16(8, true) & 8, 0)
  assert.deepEqual(preserved.local, resource.local)
})

test('ZIP patch 不尝试重写标记为加密的条目', () => {
  const source = parseZip(zipSync({ 'protected.ini': strToU8('before') }))
  view(source.entries[0].central).setUint16(8, 1, true)
  assert.throws(() => patchZip(source, new Map([['protected.ini', strToU8('after')]])), /加密.*protected\.ini/)
})
