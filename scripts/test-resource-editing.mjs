import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { IniDocument } from '../src/ini.ts'
import { SkinArchive } from '../src/skin.ts'
import { boundedTileRect, nextTileIndex, updateTileSlice, removeTileSlice, tileSlices } from '../src/tiles.ts'
import { applyCandidateImageStyles, applyLayoutImageStyles, planLayoutImage } from '../src/layout-image.ts'
import { combinedSource, withAppState } from '../tests/helpers/app-source.mjs'

test('new slices reserve IDs even when an existing section has no valid rectangle', () => {
  const doc = IniDocument.parse('[IMG1]\nCUSTOM=keep\n[img02]\nSOURCE_RECT=invalid\n')
  assert.equal(nextTileIndex(doc), 3)
})

test('editing and deleting a slice preserve its original section spelling', () => {
  const doc = IniDocument.parse('[img001]\nSOURCE_RECT=0,0,10,10\nCUSTOM=keep\n')
  updateTileSlice(doc, { index: 1, source: [1, 2, 8, 7] })
  assert.deepEqual(doc.sections(), ['img001'])
  assert.deepEqual(tileSlices(doc), [{ index: 1, source: [1, 2, 8, 7] }])
  assert.equal(doc.get('img001', 'CUSTOM'), 'keep')
  assert.equal(removeTileSlice(doc, 1), true)
  assert.deepEqual(doc.sections(), [])
})

test('drag rectangles use rounded endpoints and discard zero-pixel selections', () => {
  assert.deepEqual(boundedTileRect({ x: 0.6, y: 0.6 }, { x: 1.4, y: 2.4 }, 10, 10), undefined)
  assert.deepEqual(boundedTileRect({ x: 0.6, y: 0.6 }, { x: 2.4, y: 3.4 }, 10, 10), [1, 1, 1, 2])
  assert.deepEqual(boundedTileRect({ x: 12, y: 12 }, { x: -2, y: -2 }, 10, 10), [0, 0, 10, 10])
})

test('panel and candidate image replacement retain the referenced background style', () => {
  for (const [target, section] of [['panel', 'PANEL'], ['candidate', 'CAND']]) {
    const styles = IniDocument.parse('[STYLE7]\nNM_COLOR=FF112233\nCUSTOM=keep\nNM_IMG=old,1\n')
    const config = IniDocument.parse(`[${section}]\nBACK_STYLE=7\n`)
    const plan = planLayoutImage(target, [], IniDocument.parse(''), 100, 50)
    if (target === 'panel') applyLayoutImageStyles(target, config, styles, plan, 'new')
    else applyCandidateImageStyles(styles, config, plan, 'new')
    const cloned = `STYLE${config.get(section, 'BACK_STYLE')}`
    assert.equal(styles.get(cloned, 'NM_COLOR'), 'FF112233')
    assert.equal(styles.get(cloned, 'CUSTOM'), 'keep')
    assert.equal(styles.get(cloned, 'NM_IMG'), 'new,1')
    assert.equal(styles.get(cloned, 'HL_IMG'), 'new,1')
    assert.equal(styles.get('STYLE7', 'NM_IMG'), 'old,1')
  }
})

test('undoing image and sound creation removes new files; redo restores their bytes', async () => {
  const source = combinedSource()
  const names = new Set(['commitBytes', 'commitBatch', 'applyChangeSnapshot', 'applyBytesSnapshot', 'historyLeaves', 'refreshBinaryViews', 'refreshSnapshotViews', 'uploadKeySound'])
  const code = source.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text)).map(node => node.getText(source)).join('\n')
  const archive = SkinArchive.fromSourceFiles([{ path: 'port/main.ini', data: new TextEncoder().encode('[PANEL]\n') }])
  const originalNames = archive.names()
  const noop = () => {}
  const context = withAppState(vm.createContext({ acceptAiDraftPreview: () => {}, recordChange: (stack, change) => stack.push(change), numberInputGesture: () => undefined,
    archive, undoStack: [], redoStack: [], Uint8Array, sourceHistoryHighlight: undefined,
    scheduleSourceAutosave: noop, updateHistoryButtons: noop, refreshBdaLayout: noop, refreshSelectedBdaSource: noop,
    refreshPreview: noop, populateKeyInspector: noop, updateDirty: noop,
    resourceConfigActive: false, selectedPath: '', selectedSoundID: '',
    isSoundPath: () => true, isEditing: () => true, currentSoundEntries: () => [], soundResourcePaths: () => [],
    theme: { value: 'light' }, orientation: { value: 'port' }, keySoundBuffers: new Map(),
    releaseKeySound: noop, renderResourceInspector: noop, showStatus: noop,
  }))
  vm.runInContext(ts.transpile(code, { target: ts.ScriptTarget.ES2022 }), context)
  const checkUndoRedo = () => {
    const saved = archive.sourceFiles()
    const change = context.undoStack.pop()
    assert.ok(change)
    context.applyChangeSnapshot(change, 'before')
    assert.deepEqual(archive.names(), originalNames)
    assert.equal(archive.changed.size, 0)
    context.applyChangeSnapshot(change, 'after')
    assert.deepEqual(archive.sourceFiles(), saved)
    context.applyChangeSnapshot(change, 'before')
  }
  await context.uploadKeySound({ name: 'new.ogg', arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer })
  checkUndoRedo()

  // Evaluate the actual history payloads from both image replacement branches.
  let imageBranches = 0
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'commitBatch' && node.arguments[0]?.getText(source).includes('path: pngPath')) {
      const doc = IniDocument.parse('')
      Object.assign(context, {
        pngPath: 'light/skin/res/new.png', tilPath: 'light/skin/res/new.til',
        source: new Uint8Array([4]), layoutImageBytes: new Uint8Array([4]), tilesBytes: new Uint8Array([5]),
        candPath: 'light/skin/port/main.ini', targetPath: 'light/skin/port/main.ini', stylePath: 'unused',
        cand: doc, candDoc: doc, layout: doc, layoutDoc: doc, styles: doc, stylesDoc: doc,
      })
      const changes = vm.runInContext(node.arguments[0].getText(source), context)
      context.commitBatch(changes.filter(change => change.kind === 'bytes'))
      checkUndoRedo()
      imageBranches++
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.equal(imageBranches, 2)

  const emptyPath = 'light/skin/res/empty.ogg'
  archive.setBytes(emptyPath, new Uint8Array())
  context.commitBytes(emptyPath, archive.getBytes(emptyPath), new Uint8Array([9]))
  context.applyChangeSnapshot(context.undoStack.pop(), 'before')
  assert.deepEqual(archive.getBytes(emptyPath), new Uint8Array(), 'an existing empty file must remain present')
})

test('sound upload reports cancellation and does not commit after the editing context changes', async () => {
  const source = combinedSource()
  const fn = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'uploadKeySound')
  for (const scenario of ['cancel', 'switch archive', 'leave edit mode', 'success']) {
    let editing = true
    let commits = 0
    const context = withAppState(vm.createContext({ acceptAiDraftPreview: () => {}, recordChange: (stack, change) => stack.push(change), numberInputGesture: () => undefined,
      archive: { names: () => [], getBytes: () => new Uint8Array([1]) },
      isSoundPath: () => true, isEditing: () => editing,
      currentSoundEntries: () => [], selectedSoundID: '', soundResourcePaths: () => [],
      theme: { value: 'light' }, orientation: { value: 'port' },
      window: { confirm: () => scenario !== 'cancel' }, Uint8Array,
      keySoundBuffers: new Map(), releaseKeySound: () => {}, commitBytes: () => { commits++ },
      renderResourceInspector: () => {}, updateDirty: () => {}, showStatus: () => {},
    }))
    vm.runInContext(ts.transpile(fn.getText(source), { target: ts.ScriptTarget.ES2022 }), context)
    const result = await context.uploadKeySound({ name: 'test.ogg', arrayBuffer: async () => {
      if (scenario === 'switch archive') context.archive = {}
      if (scenario === 'leave edit mode') editing = false
      return new Uint8Array([2]).buffer
    } })
    assert.equal(result, scenario === 'success', scenario)
    assert.equal(commits, scenario === 'success' ? 1 : 0, scenario)
  }
})

test('asset replacement uses history and autosave, keeps its target, and rejects invalid images', async () => {
  const source = combinedSource()
  // 启动时的事件绑定在 wire 函数里，按语法树整体查找
  let listener
  const find = (node) => { if (!listener && ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(source) === 'imageOpen.addEventListener') listener = node; ts.forEachChild(node, find) }
  find(source)
  const functions = source.statements.filter(node => ts.isFunctionDeclaration(node) && ['commitBytes', 'applyChangeSnapshot', 'applyBytesSnapshot', 'historyLeaves', 'refreshBinaryViews', 'refreshSnapshotViews'].includes(node.name?.text)).map(node => node.getText(source)).join('\n')
  for (const invalid of [false, true]) {
    const archive = SkinArchive.fromSourceFiles([{ path: 'light/skin/res/a.png', data: new Uint8Array([1]) }])
    let handler
    const autosaved = []
    const noop = () => {}
    const context = withAppState(vm.createContext({ acceptAiDraftPreview: () => {}, recordChange: (stack, change) => stack.push(change), numberInputGesture: () => undefined,
      archive, selectedPath: 'light/skin/res/a.png', undoStack: [], redoStack: [],
      Uint8Array, Blob, isEditing: () => true, sourceHistoryHighlight: undefined,
      scheduleSourceAutosave: paths => autosaved.push(...paths), updateHistoryButtons: noop,
      refreshBdaLayout: noop, refreshSelectedBdaSource: noop, refreshPreview: noop, populateKeyInspector: noop, updateDirty: noop,
      resourceConfigActive: false, showImage: noop,
      createImageBitmap: async () => { if (invalid) throw Error('invalid image'); return { close: noop } },
      runFileOperation: async (_name, operation) => operation(),
      imageOpen: { addEventListener: (_name, callback) => { handler = callback }, value: '', files: [{ arrayBuffer: async () => {
        context.selectedPath = 'light/skin/res/b.png'
        return new Uint8Array([2]).buffer
      } }] },
    }))
    vm.runInContext(ts.transpile(functions + '\n' + listener.getText(source), { target: ts.ScriptTarget.ES2022 }), context)
    if (invalid) {
      await assert.rejects(handler(), /invalid image/)
      assert.equal(context.undoStack.length, 0)
      assert.equal(archive.changed.size, 0)
    } else {
      await handler()
      assert.equal(archive.getBytes('light/skin/res/b.png'), undefined)
      assert.deepEqual(archive.getBytes('light/skin/res/a.png'), new Uint8Array([2]))
      assert.deepEqual(autosaved, ['light/skin/res/a.png'])
      assert.equal(context.undoStack.length, 1)
      context.applyChangeSnapshot(context.undoStack.pop(), 'before')
      assert.deepEqual(archive.getBytes('light/skin/res/a.png'), new Uint8Array([1]))
    }
  }
})
