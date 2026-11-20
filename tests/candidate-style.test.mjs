import { test } from 'node:test'
import assert from 'node:assert/strict'
import { drawInputBarBackground } from '../src/preview-draw.ts'
import { IniDocument } from '../src/ini.ts'
import { candidateInputBackgroundStyle, inputBarBox, resolveCandidateInputStyle, resolveCandidateInputTextVisual, resolveCandidateTextVisuals } from '../src/candidate-style.ts'

test('input code background comes from the candidate layout, then the general config', () => {
  const general = IniDocument.parse('[INPUT]\nBACK_STYLE=127\nFORE_STYLE=128\n')
  assert.equal(candidateInputBackgroundStyle(general), '127')
  assert.equal(candidateInputBackgroundStyle(general, IniDocument.parse('[INPUT]\nBACK_STYLE=200,201\n')), '200')
  assert.equal(candidateInputBackgroundStyle(general, IniDocument.parse('[CAND]\nBACK_STYLE=117\n')), '127')
  assert.equal(candidateInputBackgroundStyle(IniDocument.parse('[INPUT]\nFORE_STYLE=128\n')), '')
  assert.equal(candidateInputBackgroundStyle(undefined), '')
})

// Baidu Android InputBarView: L = trunc(2.5dp), the code starts 6dp in and ends two Ls before the edge.
function skinModel(styles, images = new Map()) {
  return {
    styles: new Map(Object.entries(styles).map(([id, layers]) => [id, { normal: layers }])),
    images,
    resourceIndex: new Map(),
  }
}

const textLayer = (style) => ({ kind: 'text', style })
const imageLayer = (image) => ({ kind: 'image', image })

test('input code bar wraps the code and fills the panel when the code is wider', () => {
  const model = skinModel({ '128': [textLayer({ fontSize: 28 })], '': [textLayer({ fontSize: 28 })] })
  const metrics = resolveCandidateInputStyle(IniDocument.parse('[INPUT]\nFORE_STYLE=128\n'), model, 480)
  assert.deepEqual({ height: metrics.height, inset: metrics.inset, textLeft: metrics.textLeft }, { height: 34, inset: 3, textLeft: 9 })
  assert.deepEqual(inputBarBox(100, metrics, 480), { width: 115, paddingStart: 9, paddingEnd: 6 })
  assert.deepEqual(inputBarBox(470, metrics, 480), { width: 480, paddingStart: 3, paddingEnd: 3 })
  const wide = resolveCandidateInputStyle(undefined, model, 1080)
  assert.deepEqual({ inset: wide.inset, textLeft: wide.textLeft }, { inset: 8, textLeft: 19 })
})

function backgroundCalls(visual) {
  const calls = []
  const context = Object.fromEntries(['fillRect', 'drawImage', 'beginPath', 'moveTo', 'lineTo', 'stroke'].map((name) => [name, (...args) => calls.push([name, ...args])]))
  drawInputBarBackground(context, visual, 120, 40)
  return calls
}

test('input background uses nonzero ARGB colour before an image, including transparent nonblack', () => {
  const image = { image: {}, source: [0, 0, 12, 4] }
  assert.deepEqual(backgroundCalls({ ...image, color: '#123456' }), [['fillRect', 0, 0, 120, 40]])
  assert.deepEqual(backgroundCalls({ ...image, color: 'rgba(255, 0, 0, 0)' }), [])
  for (const color of [undefined, 'rgba(0, 0, 0, 0)']) {
    const calls = backgroundCalls({ ...image, color })
    assert.equal(calls.length, 1)
    assert.equal(calls[0][0], 'drawImage')
    assert.deepEqual(calls[0].slice(2), [0, 0, 12, 4, 0, 0, 120, 40])
  }
})

test('input background has a border on the left, top and right, with no bottom edge', () => {
  assert.deepEqual(backgroundCalls({ borderColor: '#123456' }), [
    ['beginPath'], ['moveTo', 0.5, 40], ['lineTo', 0.5, 0.5],
    ['lineTo', 119.5, 0.5], ['lineTo', 119.5, 40], ['stroke'],
  ])
  assert.deepEqual(backgroundCalls({ borderColor: 'rgba(0, 0, 0, 0)' }), [])
  assert.deepEqual(backgroundCalls(undefined), [])
})


test('iPhone inline input uses SCAND artwork and colour with INPUT text size', () => {
  const general = IniDocument.parse('[INPUT]\nBACK_STYLE=3\nFORE_STYLE=1\n[SCAND]\nBACK_STYLE=514\nINPUT_STYLE=6\n')
  const model = skinModel({
    '1': [textLayer({ fontSize: 45, font: 'BdiEmbeddedFont1', color: '#7a7f82' })],
    '6': [textLayer({ fontSize: 90, font: 'BdiEmbeddedFont1', color: '#92b5bf' })],
    '514': [imageLayer('bg')],
  }, new Map([['bg', { width: 1080, height: 70 }]]))
  assert.equal(candidateInputBackgroundStyle(general), '3')
  assert.equal(candidateInputBackgroundStyle(general, undefined, true), '514')
  assert.equal(resolveCandidateInputTextVisual(general, model)?.fontSize, 90)
  assert.deepEqual(resolveCandidateInputTextVisual(general, model, undefined, true), { fontSize: 45, font: undefined, color: '#92b5bf' })
  assert.equal(resolveCandidateInputStyle(general, model, 1080).height, 106)
  assert.equal(resolveCandidateInputStyle(general, model, 1080, undefined, true).height, 70)
})

test('iPhone input keeps the INPUT background when no SCAND artwork is configured', () => {
  const general = IniDocument.parse('[INPUT]\nBACK_STYLE=7\nFORE_STYLE=8\n')
  const model = skinModel({ '8': [textLayer({ fontSize: 45 })], '': [textLayer({ fontSize: 45 })] })
  assert.equal(candidateInputBackgroundStyle(general, undefined, true), '7')
  assert.equal(resolveCandidateInputStyle(general, model, 1125, undefined, true).height, 61)
  assert.equal(resolveCandidateInputStyle(undefined, model, 1080, undefined, true).height, 61)
})

test('candidate words keep skin size and colour but use the user font, not the skin font', () => {
  const candidate = IniDocument.parse('[CAND]\nFORE_STYLE=160\nFIRST_FORE=210\n')
  const model = skinModel({
    '160': [textLayer({ fontSize: 57, font: 'BdiEmbeddedFont1', color: '#36383c' })],
    '210': [textLayer({ fontSize: 57, font: 'BdiEmbeddedFont1', color: '#3482ff' })],
  })
  assert.deepEqual(resolveCandidateTextVisuals(candidate, undefined, model), {
    normal: { fontSize: 57, font: undefined, color: '#36383c' },
    first: { fontSize: 57, font: undefined, color: '#3482ff' },
  })
})
