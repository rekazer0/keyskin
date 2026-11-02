import assert from 'node:assert/strict'
import test from 'node:test'
import { IniDocument } from '../src/ini.ts'
import { animationHandles, moveAnimationHandle, animationHandlePoint, animationHandleValue } from '../src/animation-direct-model.ts'

const source = '[GLOBAL]\nANIM_NUM=1\n[ANIM1]\nTYPE=4\nFROM=100,100\nTO=85,85\nDURATION=70\nREPEAT_MODE=1\nPIVOT=-100,105\nUNKNOWN=keep\n'
const handles = (text = source) => animationHandles(IniDocument.parse(text), 'ANIM1')
test('direct controls write only the requested component and preserve unknown fields', () => {
  const handle = handles().find(h => h.label === '缩放 X')
  const next = IniDocument.parse(moveAnimationHandle(source, 'ANIM1', handle, 91.234))
  assert.equal(next.get('ANIM1', 'TO'), '91.23,85')
  assert.equal(next.get('ANIM1', 'PIVOT'), '-100,105')
  assert.equal(next.get('ANIM1', 'UNKNOWN'), 'keep')
  assert.equal(next.get('ANIM1', 'REPEAT_MODE'), '1')
  assert.equal(moveAnimationHandle(source, 'ANIM1', handle, Infinity), source)
})
test('outside pivots and edge pivots round-trip through handle geometry without clamping', () => {
  const key = { x: 128, y: 48, width: 64, height: 64 }
  for (const pivot of [[-1, 1.05], [0, 1], [0.5, 0.5]]) for (const handle of handles().filter(h => h.field === 'TO')) {
    const point = animationHandlePoint(handle, key, pivot, 85)
    assert.ok(Math.abs(animationHandleValue(handle, point, key, pivot) - 85) < 0.0001)
  }
})
test('random expressions never become sampled literals through direct manipulation', () => {
  const text = source.replace('TO=85,85', 'TO=rand(90,70),85')
  assert.equal(handles(text).some(h => h.field === 'TO'), false)
  assert.equal(moveAnimationHandle(text, 'ANIM1', handles()[0], 50), text)
})
test('particle range handles preserve the other bound and unrelated timing', () => {
  const text = '[ANIM1]\nCATEGORY=3\nTYPE=0\nPARTICLE_IMAGE=1818\nVELOCITY=30,100\nVELOCITY_DIRECTION=-120,-60\nLIFE=1000,1500\nDURATION=200\nEMIT_REGION=20,50,70,40\nALPHA_CURVE=255,0\n'
  const handle = handles(text).find(h => h.label === '速度下限')
  const next = IniDocument.parse(moveAnimationHandle(text, 'ANIM1', handle, 150))
  assert.equal(next.get('ANIM1', 'VELOCITY'), '100,100')
  assert.equal(next.get('ANIM1', 'LIFE'), '1000,1500')
  assert.equal(next.get('ANIM1', 'EMIT_REGION'), '20,50,70,40')
  assert.equal(next.get('ANIM1', 'ALPHA_CURVE'), '255,0')
  assert.equal(handles(text).some(h => h.field === 'DURATION'), false, 'particle LIFE is not animation duration')
})
