import assert from 'node:assert/strict'
import test from 'node:test'
import { invokeBinary } from '../src/native-binary.ts'

test('native binary IPC keeps the byte view and escapes Unicode metadata for HTTP headers', async () => {
  const previousWindow = globalThis.window
  const data = new Uint8Array([99, 0, 127, 255, 98]).subarray(1, 4)
  const args = { path: '/tmp/皮肤😀.bds', settings: { executable: 'C:\\中文\\adb.exe' }, progress: { toJSON: () => '__CHANNEL__:42' } }
  globalThis.window = { __TAURI_INTERNALS__: { invoke: async (command, body, options) => {
    assert.equal(command, 'binary-test')
    assert.equal(body, data, '不复制或展开二进制视图')
    const header = options.headers['x-keyskin-args']
    assert.match(header, /^[\x20-\x7e]*$/)
    assert.deepEqual(JSON.parse(header), { ...args, progress: '__CHANNEL__:42' })
    return 'written'
  } } }
  try { assert.equal(await invokeBinary('binary-test', data, args), 'written') }
  finally { globalThis.window = previousWindow }
})
