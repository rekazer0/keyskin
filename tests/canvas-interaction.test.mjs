import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { strToU8, zipSync } from 'fflate'
import { SkinArchive } from '../src/skin.ts'
import { appSource, declarations, run } from './helpers/app-source.mjs'


test('key selection paints the canvas before the inspector is rebuilt', async () => {
  const frames = [], timers = [], calls = []
  let renderDone
  const preview = { rendered: () => new Promise(resolve => { renderDone = resolve }) }
  const context = run(declarations('afterNextPaint', 'selectionInspectorSyncPending', 'scheduleSelectionInspectorSync'), {
    requestAnimationFrame: cb => frames.push(cb), window: { setTimeout: cb => timers.push(cb) },
    populateKeyInspector: () => calls.push('inspector'), updateSourceHighlight: () => calls.push('highlight'), scrollSelectedSource: () => calls.push('scroll'),
  })
  context.scheduleSelectionInspectorSync(preview)
  context.scheduleSelectionInspectorSync(preview)
  assert.equal(frames.length, 1, 'rapid selections coalesce into one rebuild')
  assert.deepEqual(calls, [], 'nothing heavy runs inside pointerdown')
  frames.shift()()
  assert.deepEqual(calls, [], 'not inside the frame either')
  timers.shift()()
  await Promise.resolve()
  assert.deepEqual(calls, [], 'waits for the canvas render in flight')
  renderDone()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, ['inspector', 'highlight', 'scroll'])
  context.scheduleSelectionInspectorSync(preview)
  assert.equal(frames.length, 1, 'a later selection schedules again')
})

function crosshairSetup(snapPoint) {
  const vars = {}
  const previewCoordinates = { hidden: true, dataset: {}, style: { setProperty: (k, v) => { vars[k] = v } } }
  const previewCanvas = { width: 1080, height: 600 }
  const bounds = { left: 100, top: 50, right: 640, bottom: 350, width: 540, height: 300 }
  const context = run(`let pointerOverlayGeometry, previewPanStart; ${declarations('updatePointerCoordinates')}`, {
    editorCrosshair: { checked: true }, editorCoordinateSnap: { checked: true }, isEditing: () => true,
    previewCoordinates, previewCoordinateX: { textContent: '' }, previewCoordinateY: { textContent: '' },
    canvasWrap: { getBoundingClientRect: () => ({ left: 0, top: 0 }), clientWidth: 800, clientHeight: 500, scrollLeft: 0, scrollTop: 0 },
    previewCanvas, toolbarCanvas: {}, toolbarPreview: {},
    preview: { logicalSize: () => ({ width: 1080, height: 600 }), snapPoint },
  })
  const move = (clientX, clientY) => context.updatePointerCoordinates({ clientX, clientY, pointerType: 'mouse' }, { getBoundingClientRect: () => bounds }, previewCanvas)
  return { move, vars, previewCoordinates, context }
}

test('crosshair lines follow the pointer while the readout snaps to the edge', () => {
  const edge = 400
  const s = crosshairSetup(p => ({ x: Math.abs(p.x - edge) <= 16 ? edge : p.x, y: p.y }))
  s.move(305, 120) // logical x = 410, within the snap threshold of 400
  assert.equal(s.vars['--crosshair-x'], '305px', 'line stays under the pointer')
  assert.equal(s.vars['--crosshair-y'], '120px')
  assert.equal(s.context.previewCoordinateX.textContent, '400', 'readout snaps')
  assert.equal(s.previewCoordinates.dataset.snapX, 'true')
  assert.equal(s.previewCoordinates.dataset.snapY, 'false')
  assert.equal(s.vars['--snap-x'], '300px', 'guide marks the snapped edge')
  s.move(340, 120) // logical x = 480, free
  assert.equal(s.vars['--crosshair-x'], '340px')
  assert.equal(s.context.previewCoordinateX.textContent, '480')
  assert.equal(s.previewCoordinates.dataset.snapX, 'false')
  s.move(20, 20) // outside the canvas: no guide
  assert.equal(s.vars['--crosshair-x'], '20px')
  assert.equal(s.previewCoordinates.dataset.snapX, 'false')
})

test('unchanged style thumbnails are not rebuilt on every selection', () => {
  class HTMLInputElement { constructor(value) { this.value = value } }
  // 每个引用字段是一个 .ui-style-ref-list，第一个子元素是隐藏的引用输入框（音效字段也一样）。
  const input = new HTMLInputElement('118'), list = { firstElementChild: input }
  const soundList = { firstElementChild: new HTMLInputElement('1001') }
  // 不是引用输入框的列表跳过
  const other = { firstElementChild: {} }
  const refreshed = []
  const globals = {
    HTMLInputElement, document: { querySelectorAll: () => [list, soundList, other] }, theme: { value: 'light' }, orientation: { value: 'port' },
    archive: { revision: 1 }, styleReferenceKey: () => 'BACK_STYLE', visualResolver: () => ({}),
    refreshStyleReferenceThumbnail: (target) => refreshed.push(target),
  }
  const context = run(declarations('styleReferenceThumbnailInputs', 'refreshStyleReferenceThumbnails'), globals)
  context.refreshStyleReferenceThumbnails()
  assert.deepEqual(refreshed, [list, soundList], 'sound rows refresh too')
  context.refreshStyleReferenceThumbnails()
  assert.equal(refreshed.length, 2)
  input.value = '119'
  context.refreshStyleReferenceThumbnails()
  assert.equal(refreshed.length, 3, 'a different style reference redraws')
  context.archive.revision = 2
  context.refreshStyleReferenceThumbnails()
  assert.equal(refreshed.length, 5, 'an edited archive redraws')
  context.archive = { revision: 2 }
  context.refreshStyleReferenceThumbnails()
  assert.equal(refreshed.length, 7, 'another archive redraws')
})

test('archive revision changes only when contents change', () => {
  const archive = SkinArchive.open(zipSync({ 'light/port/py_9.ini': strToU8('[PANEL]\nSIZE=480,320') }, { level: 0 }))
  const start = archive.revision
  archive.setText('light/port/py_9.ini', '[PANEL]\nSIZE=480,320')
  assert.equal(archive.revision, start, 'identical bytes are a no-op')
  archive.setText('light/port/py_9.ini', '[PANEL]\nSIZE=480,330')
  assert.equal(archive.revision, start + 1)
  archive.delete('light/port/py_9.ini')
  assert.equal(archive.revision, start + 2)
})
