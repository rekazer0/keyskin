import assert from 'node:assert/strict'
import test from 'node:test'
import { operationErrorLog } from '../src/operations.ts'

test('operation logs preserve original exception types, stack frames, causes and native strings', () => {
  const cause = new DOMException('Permission denied', 'NotAllowedError')
  const error = new Error('Write failed', { cause })
  error.stack = 'commit@https://example.test/src/archive-io.ts:15:3'
  assert.match(operationErrorLog(error), /^Error: Write failed\ncommit@\[origin\]\/src\/archive-io.ts:15:3\nCaused by: NotAllowedError: Permission denied/)
  assert.equal(operationErrorLog('ADB error:\n  error code 42'), 'ADB error:\n  error code 42')
  assert.equal(operationErrorLog({ code: 'EIO', message: 'Write failed' }), 'code: EIO\nmessage: Write failed')
})

test('operation logs do not include private paths, credentials or attached request data', () => {
  const log = operationErrorLog({
    code: 'EACCES',
    message: 'access_token=fake-secret\nCookie: first=sample; second=example\nfile="/Users/example/Private File.bds"\nEACCES: failed',
    request: { body: 'omitted request payload' },
  })
  assert.match(log, /EACCES: failed/)
  assert.doesNotMatch(log, /fake-secret|first=sample|second=example|\/Users\/example|Private File|omitted request payload/)
})
