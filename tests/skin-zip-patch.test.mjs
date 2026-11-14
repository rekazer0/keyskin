import test from 'node:test'
import assert from 'node:assert/strict'
import { zipSync, unzipSync, strToU8, Zip, ZipDeflate } from 'fflate'
import { parseZip, patchZip } from '../src/skin-zip.ts'

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
