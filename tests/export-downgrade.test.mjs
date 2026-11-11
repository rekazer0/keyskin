import assert from 'node:assert/strict'
import test from 'node:test'
import { declarations, run } from './helpers/app-source.mjs'

test('multi-stage BDA → SXI opens progress first, then confirms unique warnings in that window', async () => {
  const warnings = Array.from({ length: 20 }, (_, i) => `降级提示 ${i + 1}`)
  const events = []
  const context = run(declarations('exportArchive', 'exportArchiveBytes', 'acceptDowngrade', 'conversionProgress', 'exportTargetLabel'), {
    archive: { format: 'bda' }, bdaBase: {},
    canExport: () => true,
    updateFileOperationProgress: () => {}, waitForInterfacePaint: async () => {},
    convertBdaArchive: () => {
      assert.deepEqual(events, ['progress'], 'progress opens before conversion starts')
      return { archive: {}, warnings: warnings.slice(0, 10) }
    },
    buildSxiZipAsync: async () => ({ bytes: new Uint8Array([1]), warnings: [...warnings.slice(10), ...warnings.slice(0, 5)] }),
    clientLog: { info: () => {} },
    showFileOperationResult: detail => assert.equal(detail, warnings.join('\n')),
    fileOperationResult: {},
    waitForTap: async (_, label) => {
      events.push('confirm')
      assert.equal(label, '继续导出')
      return true
    },
    showFileOperationProgress: () => events.push('progress'),
  })
  const result = await context.exportArchive('sxi')
  assert.deepEqual(Array.from(result.warnings), warnings)
  assert.deepEqual(events, ['progress', 'confirm'])
  assert.equal(context.fileOperationResult.hidden, true)
  assert.equal(context.fileOperationResult.textContent, '')
})

for (const native of [false, true]) for (const platform of [undefined, 'ios']) {
  test(`${native ? 'native' : 'browser'} ${platform ?? 'standard'} export confirms before choosing or writing a file`, async () => {
    const events = []
    const archive = { markSaved: () => assert.fail('conversion must not mark source as saved') }
    const context = run(declarations('saveArchive', 'saveNative', 'downloadArchive', 'exportForSave', 'exportArchive', 'acceptDowngrade', 'exportTargetLabel'), {
      archive, currentPath: '', documentName: { textContent: '测试' },
      flushNumberInputWheel: () => {}, exportName: (_, format) => `测试.${format}`,
      isTauri: () => native, clientLog: { info: () => {} },
      exportArchiveBytes: async () => ({ bytes: new Uint8Array([1]), converted: true, warnings: ['内容将降级'] }),
      showFileOperationProgress: () => events.push('progress'),
      waitForInterfacePaint: async () => {},
      showFileOperationResult: () => {}, fileOperationResult: {},
      waitForTap: async () => { events.push('confirm'); return true },
      writeToChosenFile: async (_, bytes) => { events.push('save'); assert.ok(bytes instanceof Uint8Array); return '测试.sxi' },
    })
    assert.equal(await context.saveArchive(true, 'sxi', platform), true)
    assert.deepEqual(events, ['progress', 'confirm', 'save'])
    events.length = 0
    context.waitForTap = async () => { events.push('cancel'); return false }
    assert.equal(await context.saveArchive(true, 'sxi', platform), false)
    assert.deepEqual(events, ['progress', 'cancel'])
  })
}

test('an expired browser activation opens the save picker inside the next tap', async () => {
  const events = []
  const context = run(declarations('writeToChosenFile'), {
    Uint8Array, DOMException,
    isTauri: () => false,
    navigator: { userActivation: { isActive: false } },
    window: { showSaveFilePicker: async () => {
      events.push('picker')
      return { name: '测试.sxi', createWritable: async () => ({
        write: async () => events.push('write'), close: async () => events.push('close'),
      }) }
    } },
    waitForTap: async (_, label, tap) => { events.push(label); return tap() },
    updateFileOperationProgress: () => {},
    showFileOperationResult: detail => events.push(detail),
  })
  assert.equal(await context.writeToChosenFile('测试.sxi', new Uint8Array([1])), '测试.sxi')
  assert.deepEqual(events, ['保存', 'picker', 'write', 'close', '文件：测试.sxi\n保存位置：浏览器中选择的文件夹'])
  events.length = 0
  context.waitForTap = async () => false
  assert.equal(await context.writeToChosenFile('测试.sxi', new Uint8Array([1])), undefined)
  assert.deepEqual(events, [])
})

for (const path of ['/Users/test/皮肤/保存.bds', 'content://provider/document/42']) {
  test(`native writes report the actual destination only after success: ${path}`, async () => {
    const events = []
    const context = run(declarations('writeNativePath'), {
      updateFileOperationProgress: () => {},
      invoke: async (command, data) => { assert.equal(command, 'write_file'); assert.equal(data.path, path); events.push('write') },
      writeFile: async destination => { assert.equal(destination, path); events.push('write') },
      showFileOperationResult: detail => events.push(detail),
    })
    await context.writeNativePath(path, new Uint8Array([1]))
    assert.deepEqual(events, ['write', `保存位置：${path}`])
    events.length = 0
    context.invoke = context.writeFile = async () => { throw new Error('磁盘已满') }
    await assert.rejects(context.writeNativePath(path, new Uint8Array([1])), /磁盘已满/)
    assert.deepEqual(events, [])
  })
}
