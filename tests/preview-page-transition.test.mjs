import { test } from 'node:test'
import assert from 'node:assert/strict'
import { previewPageTransition } from '../src/actions.ts'

const LAYOUTS = [
  'py_9.ini', 'py_26.ini', 'bh.ini',
  'en_9.ini', 'en_26.ini',
  'num_9.ini', 'num_26.ini',
  'symbol.ini', 'sym_9_cn.ini', 'sym_26_cn.ini',
]

test('F16 opens the 26-key English board from a 9-key Chinese board', () => {
  assert.deepEqual(
    previewPageTransition('F16', 'py_9.ini', 'py_9.ini', LAYOUTS),
    { target: 'en_26.ini', returnName: 'py_9.ini' },
  )
  assert.deepEqual(
    previewPageTransition('F16', 'big_9.ini', 'py_9.ini', [...LAYOUTS, 'big_9.ini']),
    { target: 'en_26.ini', returnName: 'big_9.ini' },
  )
})

test('F16 prefers the 26-key English board when the skin also ships a 9-key one', () => {
  const layouts = ['py_9.ini', 'en_9.ini', 'en_26.ini']
  assert.equal(previewPageTransition('F16', 'py_9.ini', 'py_9.ini', layouts).target, 'en_26.ini')
  assert.equal(previewPageTransition('F16', 'py_26.ini', 'py_26.ini', layouts).target, 'en_26.ini')
  assert.equal(previewPageTransition('F16', 'py_14.ini', 'py_14.ini', layouts).target, 'en_26.ini')
})

test('F16 falls back to the 9-key English board when the skin has no 26-key one', () => {
  const layouts = ['py_9.ini', 'en_9.ini']
  assert.deepEqual(
    previewPageTransition('F16', 'py_9.ini', 'py_9.ini', layouts),
    { target: 'en_9.ini', returnName: 'py_9.ini' },
  )
})

test('F15 on the English board returns to the Chinese board it came from', () => {
  const entered = previewPageTransition('F16', 'py_9.ini', 'py_9.ini', LAYOUTS)
  assert.deepEqual(
    previewPageTransition('F15', entered.target, entered.returnName, LAYOUTS),
    { target: 'py_9.ini', returnName: 'py_9.ini' },
  )
})

test('number and symbol boards still follow the 9/26 pairing of the source layout', () => {
  assert.equal(previewPageTransition('F6', 'py_9.ini', 'py_9.ini', LAYOUTS).target, 'num_9.ini')
  assert.equal(previewPageTransition('F6', 'py_26.ini', 'py_26.ini', LAYOUTS).target, 'num_26.ini')
  assert.equal(previewPageTransition('F1', 'py_9.ini', 'py_9.ini', LAYOUTS).target, 'symbol.ini')
})
