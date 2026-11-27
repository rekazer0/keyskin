import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deflateSync, strToU8, zipSync } from 'fflate'
import { SkinArchive } from "../src/skin.ts"
import { isZipEntryEncrypted, parseZip, readArchiveEntry } from "../src/skin-zip.ts"
import { AtlasResolver } from "../src/atlas.ts"
import { encodePng } from "../src/ssf/ssf-png.ts"

const LOCAL_SIGNATURE = 0x04034b50
const CENTRAL_SIGNATURE = 0x02014b50
const END_SIGNATURE = 0x06054b50

test('直接从文件建档保持格式、隔离输入，首次同步和异步导出都写入完整文件', async () => {
  const files = new Map([
    ['Info.txt', strToU8('Name=from files\n')],
    ['light/port/py_26.ini', strToU8('[KEY1]\nCENTER=a\n')],
  ])
  const archive = SkinArchive.fromFiles(files, 'bds')
  files.get('Info.txt')[0] = 0
  assert.equal(archive.format, 'bds')
  assert.equal(archive.infoField('Name'), 'from files')
  assert.equal(archive.changed.size, 0)
  for (const bytes of [archive.toBytes(), await archive.toBytesAsync()]) {
    const opened = SkinArchive.open(bytes, 'bds')
    assert.equal(opened.infoField('Name'), 'from files')
    assert.equal(opened.getText('light/skin/port/py_26.ini'), '[KEY1]\nCENTER=a\n')
  }
  archive.setText('Info.txt', 'Name=edited\n')
  const saved = await archive.toBytesAsync()
  archive.markSaved(saved)
  assert.equal(archive.changed.size, 0)
  assert.equal(SkinArchive.open(await archive.toBytesAsync(), 'bds').infoField('Name'), 'edited')
  assert.throws(() => SkinArchive.fromFiles(new Map([['../bad', new Uint8Array()]])), /不安全路径/)
  assert.throws(() => SkinArchive.fromFiles(new Map(Array.from({ length: 5001 }, (_, i) => [`file${i}`, new Uint8Array()]))), /过多文件/)
})

test('unpacked source files use the unpacked byte limit, not a temporary ZIP limit', () => {
  const tile = new Uint8Array(1024 * 1024).fill(7)
  const files = Array.from({ length: 65 }, (_, i) => ({ path: `light/res/tile${i}.png`, data: tile }))
  const archive = SkinArchive.fromSourceFiles(files)
  tile[0] = 0
  assert.equal(archive.format, 'bds')
  assert.equal(archive.sourceByteLength(), 65 * 1024 * 1024)
  assert.equal(archive.getBytes('light/skin/res/tile64.png')[0], 7)
})

function sampleArchive() {
  return zipSync({
    'Info.txt': strToU8('AtomSkinName=test'),
    'light/port/gen.ini': strToU8('[PANEL]\nSIZE=480,320'),
    'light/port/py_9.ini': strToU8('[PANEL]\nSIZE=480,320'),
    'light/port/res/default.css': strToU8('[GLOBAL]\n'),
  }, { level: 0 })
}

function dataView(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function endOffset(bytes) {
  const view = dataView(bytes)
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset--) {
    if (view.getUint32(offset, true) === END_SIGNATURE) return offset
  }
  throw new Error('missing EOCD')
}

// Some Android packers write 0 into the per-disk entry count and leave the total intact.
function clearPerDiskCount(bytes) {
  const view = dataView(bytes)
  const offset = endOffset(bytes)
  view.setUint16(offset + 4, 1, true)
  view.setUint16(offset + 6, 1, true)
  view.setUint16(offset + 8, 0, true)
}

// Third-party "encrypted" packers keep valid local headers but break the central directory.
function breakCentralMethods(bytes) {
  const view = dataView(bytes)
  for (let offset = 0; offset + 46 <= bytes.length; offset++) {
    if (view.getUint32(offset, true) === CENTRAL_SIGNATURE) view.setUint16(offset + 10, 0xffff, true)
  }
}

test('百度单外观新增深色后，保存和重开保留两套独立资源', async () => {
  for (const [format, prefix, file, platform] of [
    ['bdi', 'skin/', 'port/py_26.ini', 'I'],
    ['bds', '', 'port/py_26.ini', 'A'],
    ['bda', '', 'port/appearanceConfig', 'A'],
    ['bda', 'skin_light/', 'port/appearanceConfig', 'I'],
  ]) {
    const archive = SkinArchive.open(zipSync({
      [`${prefix}${file}`]: strToU8('light'),
      [`${format === 'bdi' ? 'skin/' : ''}Info.txt`]: strToU8(`SupportPlatform=${platform}\n`),
    }), format)
    const light = `light/skin/${file}`
    const dark = `dark/skin/${file}`
    archive.setBytes(dark, strToU8('dark'))
    assert.equal(archive.canonicalSourcePath(archive.sourcePath(dark)), dark)
    assert.deepEqual(archive.getBytes(light), strToU8('light'))
    for (const bytes of [archive.toBytes(format), await archive.toBytesAsync(format)]) {
      const reopened = SkinArchive.open(bytes, format)
      assert.deepEqual(reopened.getBytes(light), strToU8('light'))
      assert.deepEqual(reopened.getBytes(dark), strToU8('dark'))
      assert.match(reopened.getText('Info.txt'), /SupportDarkMode=1/)
    }
    archive.markSaved(await archive.toBytesAsync(format), format)
    archive.delete(dark)
    const undone = SkinArchive.open(await archive.toBytesAsync(format), format)
    assert.deepEqual(undone.getBytes(light), strToU8('light'))
    assert.equal(undone.getBytes(dark), undefined)
  }
})

test('opens a well formed archive', async () => {
  const archive = await SkinArchive.openAsync(sampleArchive())
  assert.deepEqual(archive.names(), [
    'Info.txt',
    'light/skin/port/gen.ini',
    'light/skin/port/py_9.ini',
    'light/skin/port/res/default.css',
  ])
})

test('opens an archive whose EOCD per-disk entry count is zero', async () => {
  const bytes = sampleArchive()
  clearPerDiskCount(bytes)
  const archive = await SkinArchive.openAsync(bytes)
  assert.equal(archive.names().length, 4)
  assert.equal(archive.getText('light/skin/port/py_9.ini'), '[PANEL]\nSIZE=480,320')
})

test('falls back to local file headers when the central directory is unusable', async () => {
  const bytes = sampleArchive()
  clearPerDiskCount(bytes)
  breakCentralMethods(bytes)
  const archive = await SkinArchive.openAsync(bytes)
  assert.equal(archive.names().length, 4)
  assert.equal(archive.getText('light/skin/port/gen.ini'), '[PANEL]\nSIZE=480,320')
})

// The 塔塔 BDI packer flags every entry "encrypted + data descriptor" (9) yet writes no descriptor;
// fflate's streaming Unzip then dropped the last 12 bytes of each file and the key sounds broke.
function flagMissingDataDescriptors(bytes) {
  const view = dataView(bytes)
  for (let offset = 0; offset + 46 <= bytes.length; offset++) {
    const signature = view.getUint32(offset, true)
    if (signature === LOCAL_SIGNATURE) view.setUint16(offset + 6, 9, true)
    if (signature === CENTRAL_SIGNATURE) view.setUint16(offset + 8, 9, true)
  }
}

test('keeps whole files when entries claim a data descriptor that is not there', async () => {
  for (const breakCentral of [false, true]) {
    const bytes = sampleArchive()
    flagMissingDataDescriptors(bytes)
    if (breakCentral) breakCentralMethods(bytes)
    const archive = await SkinArchive.openAsync(bytes, undefined, () => {})
    assert.equal(archive.getText('light/skin/port/py_9.ini'), '[PANEL]\nSIZE=480,320')
    assert.equal(archive.getText('light/skin/port/res/default.css'), '[GLOBAL]\n')
  }
})

// Anti-extraction packers (seen in 赫本有只喵の极简绿m.bds) write 0xFFFFFFFF for every central
// directory size and local offset without a ZIP64 record; the skin used to fail with "超过 256 MB".
function poisonCentralSizes(bytes) {
  const view = dataView(bytes)
  for (let offset = 0; offset + 46 <= bytes.length; offset++) {
    if (view.getUint32(offset, true) !== CENTRAL_SIGNATURE) continue
    for (const field of [20, 24, 42]) view.setUint32(offset + field, 0xffffffff, true)
  }
}

test('recovers central directory sizes and offsets from local headers', async () => {
  const bytes = sampleArchive()
  poisonCentralSizes(bytes)
  for (const archive of [SkinArchive.open(bytes), await SkinArchive.openAsync(bytes), await SkinArchive.openAsync(bytes, undefined, () => {})]) {
    assert.equal(archive.names().length, 4)
    assert.equal(archive.getText('light/skin/port/py_9.ini'), '[PANEL]\nSIZE=480,320')
  }
  const archive = await SkinArchive.openAsync(bytes)
  archive.setText('Info.txt', 'AtomSkinName=changed')
  const saved = await SkinArchive.openAsync(await archive.toBytesAsync('bds'))
  assert.equal(saved.getText('Info.txt'), 'AtomSkinName=changed')
})

// Some anti-extraction packers poison the central directory and also flag every entry "encrypted";
// the local headers stay sane, so the flag is a decoy (seen in JM馨-萌度可爱.bds).
function markCentralEncrypted(bytes, local = false) {
  const view = dataView(bytes)
  for (let offset = 0; offset + 46 <= bytes.length; offset++) {
    const signature = view.getUint32(offset, true)
    if (local && signature === LOCAL_SIGNATURE) view.setUint16(offset + 6, view.getUint16(offset + 6, true) | 1, true)
    if (signature === CENTRAL_SIGNATURE) view.setUint16(offset + 8, view.getUint16(offset + 8, true) | 1, true)
  }
}

test('recovers a poisoned central directory whose entries fake an encryption flag', async () => {
  const bytes = sampleArchive()
  poisonCentralSizes(bytes)
  markCentralEncrypted(bytes)
  for (const archive of [SkinArchive.open(bytes), await SkinArchive.openAsync(bytes)]) {
    assert.equal(archive.names().length, 4)
    assert.equal(archive.getText('light/skin/port/py_9.ini'), '[PANEL]\nSIZE=480,320')
  }
  const archive = await SkinArchive.openAsync(bytes)
  // The repaired ZIP must be readable and free of the decoy encryption bits, even without edits.
  for (const saved of [archive.toBytes('bds'), await archive.toBytesAsync('bds')]) {
    const entries = parseZip(saved).entries
    assert.equal(entries.length, 4)
    assert.equal(entries.filter(isZipEntryEncrypted).length, 0)
    assert.equal(SkinArchive.open(saved, 'bds').getText('light/skin/port/py_9.ini'), '[PANEL]\nSIZE=480,320')
  }
  const bdi = SkinArchive.open(await archive.toBytesAsync('bdi'), 'bdi')
  assert.equal(bdi.format, 'bdi')
  assert.equal(bdi.getText('light/skin/port/py_9.ini'), '[PANEL]\nSIZE=480,320')
  assert.equal(bdi.getText('light/skin/port/res/default.css'), '[GLOBAL]\n')
})

// Anti-extraction packers (seen in 微光 9.0.bdi) leave the central directory otherwise intact
// but flag every entry "encrypted"; the local headers and the data are clean.
test('clears decoy encryption flags that the packer writes only into the central directory', async () => {
  const bytes = sampleArchive()
  markCentralEncrypted(bytes)
  for (const archive of [SkinArchive.open(bytes), await SkinArchive.openAsync(bytes)]) {
    assert.equal(archive.names().length, 4)
    assert.deepEqual(archive.zipEncryptedPaths(), [])
  }
  const archive = await SkinArchive.openAsync(bytes)
  archive.setText('Info.txt', 'AtomSkinName=decoy')
  // Same-format save reuses the untouched entries: the decoy must not be written back either.
  for (const saved of [archive.toBytes('bds'), await archive.toBytesAsync('bds')]) {
    const entries = parseZip(saved).entries
    assert.equal(entries.filter(isZipEntryEncrypted).length, 0)
    assert.equal(SkinArchive.open(saved, 'bds').getText('Info.txt'), 'AtomSkinName=decoy')
  }
  // Converting to another format works without any edit.
  const converted = SkinArchive.open(await archive.toBytesAsync('bdi'), 'bdi')
  assert.equal(converted.format, 'bdi')
  assert.equal(converted.getText('light/skin/port/py_9.ini'), '[PANEL]\nSIZE=480,320')
})

test('rebuilds from the opened content when the local headers also carry an encryption marker', async () => {
  const bytes = sampleArchive()
  poisonCentralSizes(bytes)
  markCentralEncrypted(bytes, true)
  const archive = await SkinArchive.openAsync(bytes)
  // 能打开说明内容已经解出来了：导出按解包结果重新压缩，不再被源包标记挡住。
  const bdi = await archive.toBytesAsync('bdi')
  assert.deepEqual(parseZip(bdi).entries.filter(isZipEntryEncrypted), [])
  assert.equal(SkinArchive.open(bdi, 'bdi').getText('light/skin/port/py_9.ini'), '[PANEL]\nSIZE=480,320')
})

// Palm 的打包器把真实大小写进中央目录的 ZIP64 extra 字段，却不写 ZIP64 结束记录，
// fflate 因此不会读到实际大小，可能误报“超过 256 MB”。
function zip64Archive() {
  const entries = [
    ['Info.txt', strToU8('AtomSkinName=zip64')],
    ['light/port/py_9.ini', strToU8('[PANEL]\nSIZE=480,320')],
  ]
  const parts = []
  const centrals = []
  let offset = 0
  for (const [name, data] of entries) {
    const nameBytes = strToU8(name)
    const compressed = deflateSync(data)
    const header = new Uint8Array(30 + nameBytes.length + 20)
    const headerView = dataView(header)
    headerView.setUint32(0, LOCAL_SIGNATURE, true)
    headerView.setUint16(4, 45, true)
    headerView.setUint16(6, 0x08, true)
    headerView.setUint16(8, 8, true)
    headerView.setUint32(18, 0xffffffff, true)
    headerView.setUint32(22, 0xffffffff, true)
    headerView.setUint16(26, nameBytes.length, true)
    headerView.setUint16(28, 20, true)
    header.set(nameBytes, 30)
    // 本地头里的 ZIP64 占位全是 0，真实大小在数据描述符里。
    headerView.setUint16(30 + nameBytes.length, 1, true)
    headerView.setUint16(32 + nameBytes.length, 16, true)
    const descriptor = new Uint8Array(24)
    const descriptorView = dataView(descriptor)
    descriptorView.setUint32(0, 0x08074b50, true)
    descriptorView.setUint32(8, compressed.length, true)
    descriptorView.setUint32(16, data.length, true)
    const central = new Uint8Array(46 + nameBytes.length + 20)
    const centralView = dataView(central)
    centralView.setUint32(0, CENTRAL_SIGNATURE, true)
    centralView.setUint16(4, 45, true)
    centralView.setUint16(6, 45, true)
    centralView.setUint16(8, 0x08, true)
    centralView.setUint16(10, 8, true)
    centralView.setUint32(20, 0xffffffff, true)
    centralView.setUint32(24, 0xffffffff, true)
    centralView.setUint32(42, offset, true)
    centralView.setUint16(28, nameBytes.length, true)
    centralView.setUint16(30, 20, true)
    central.set(nameBytes, 46)
    const extra = 46 + nameBytes.length
    centralView.setUint16(extra, 1, true)
    centralView.setUint16(extra + 2, 16, true)
    centralView.setUint32(extra + 4, data.length, true)
    centralView.setUint32(extra + 12, compressed.length, true)
    parts.push(header, compressed, descriptor)
    centrals.push(central)
    offset += header.length + compressed.length + descriptor.length
  }
  const end = new Uint8Array(22)
  const endView = dataView(end)
  endView.setUint32(0, END_SIGNATURE, true)
  endView.setUint16(8, entries.length, true)
  endView.setUint16(10, entries.length, true)
  endView.setUint32(12, centrals.reduce((total, part) => total + part.length, 0), true)
  endView.setUint32(16, offset, true)
  const all = [...parts, ...centrals, end]
  const bytes = new Uint8Array(all.reduce((total, part) => total + part.length, 0))
  let position = 0
  for (const part of all) {
    bytes.set(part, position)
    position += part.length
  }
  return bytes
}

test('recovers ZIP64 central directory sizes without a ZIP64 end record', async () => {
  const bytes = zip64Archive()
  for (const archive of [SkinArchive.open(bytes), await SkinArchive.openAsync(bytes)]) {
    assert.equal(archive.names().length, 2)
    assert.equal(archive.getText('Info.txt'), 'AtomSkinName=zip64')
    assert.equal(archive.getText('light/port/py_9.ini'), '[PANEL]\nSIZE=480,320')
  }
  const archive = await SkinArchive.openAsync(bytes)
  archive.setText('Info.txt', 'AtomSkinName=saved')
  const saved = await SkinArchive.openAsync(await archive.toBytesAsync('bds'))
  assert.equal(saved.getText('Info.txt'), 'AtomSkinName=saved')
})

test('keeps edits made after the saved bytes were produced dirty', async () => {
  const archive = SkinArchive.open(sampleArchive())
  archive.setText('Info.txt', 'AtomSkinName=first')
  const revision = archive.revision
  const savedBytes = await archive.toBytesAsync('bds')
  archive.setText('Info.txt', 'AtomSkinName=second')
  archive.markSaved(savedBytes, 'bds', revision)
  assert.ok(archive.changed.has('Info.txt'))
  assert.equal(archive.getText('Info.txt'), 'AtomSkinName=second')
  assert.equal(SkinArchive.open(savedBytes, 'bds').getText('Info.txt'), 'AtomSkinName=first')
})
test('undo during a save compares against the written archive rather than leaving a false dirty mark', async () => {
  const archive = SkinArchive.open(sampleArchive())
  archive.setText('Info.txt', 'AtomSkinName=first')
  const revision = archive.revision
  const savedBytes = await archive.toBytesAsync('bds')
  archive.setText('Info.txt', 'AtomSkinName=second')
  archive.setText('Info.txt', 'AtomSkinName=first')
  archive.markSaved(savedBytes, 'bds', revision)
  assert.equal(archive.changed.size, 0)
})

test('opens an archive without any entries', async () => {
  const archive = await SkinArchive.openAsync(zipSync({}))
  assert.deepEqual(archive.names(), [])
})

test('reports progress while unpacking the fallback path', async () => {
  const bytes = sampleArchive()
  clearPerDiskCount(bytes)
  breakCentralMethods(bytes)
  const seen = []
  const archive = await SkinArchive.openAsync(bytes, undefined, (value) => seen.push(value))
  assert.equal(archive.names().length, 4)
  assert.equal(seen.at(-1), 1)
})

test('reads one entry straight from its local file header', () => {
  const bytes = zipSync({
    'Info.txt': strToU8('AtomSkinName=test'),
    '__MACOSX/._demo.png': strToU8('junk'),
    'dark/skin/demo.png': strToU8('demo-bytes'),
  }, { level: 6 })
  const entry = readArchiveEntry(bytes, (name) => name === 'dark/skin/demo.png')
  assert.equal(entry?.name, 'dark/skin/demo.png')
  assert.equal(new TextDecoder().decode(entry.data), 'demo-bytes')
})

test('reads a stored entry without touching the bytes around it', () => {
  const bytes = zipSync({ 'demo.png': strToU8('demo-bytes') }, { level: 0 })
  const entry = readArchiveEntry(bytes, (name) => name === 'demo.png')
  assert.equal(new TextDecoder().decode(entry?.data), 'demo-bytes')
})

test('gives up when a local header defers sizes to a data descriptor', () => {
  const bytes = zipSync({ 'demo.png': strToU8('demo-bytes') }, { level: 0 })
  const view = dataView(bytes)
  for (let offset = 0; offset + 30 <= bytes.length; offset++) {
    if (view.getUint32(offset, true) === LOCAL_SIGNATURE) view.setUint16(offset + 6, 0x08, true)
  }
  assert.equal(readArchiveEntry(bytes, (name) => name === 'demo.png'), undefined)
})

test('returns nothing when no entry matches', () => {
  assert.equal(readArchiveEntry(sampleArchive(), (name) => name === 'demo.png'), undefined)
})

test('sxi thumbnails use the root preview.png over per-appearance demo images', async () => {
  globalThis.window ??= globalThis
  const { archiveDemoImage } = await import('../src/template-preview.ts')
  const bytes = zipSync({
    'dark/skin/demo.png': strToU8('dark-demo'),
    'preview.png': strToU8('sxi-preview'),
  }, { level: 0 })
  assert.equal(await (await archiveDemoImage(bytes)).text(), 'sxi-preview')
})

test('BDI → BDS preserves the normal, pressed and panel artwork of an out-of-order atlas', async () => {
  const til = '\uFEFF[GLOBAL]\r\nTILE_NUM=12\r\n[IMG12]\r\nSOURCE_RECT=0,0,1,1\r\n[IMG3]\r\nSOURCE_RECT=1,0,1,1\r\n[IMG1]\r\nSOURCE_RECT=0,1,2,1\r\n'
  const view = '[PANEL]\nSIZE=2,1\nBACK_STYLE=2\n[KEY1]\nVIEW_RECT=0,0,1,1\nBACK_STYLE=1\nCENTER=a\n'
  const css = '[STYLE1]\nNM_IMG=atlas,1\nHL_IMG=atlas,2\n[STYLE2]\nNM_IMG=atlas,3\n'
  const png = encodePng({ width: 2, height: 2, data: new Uint8Array([
    255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255,
  ]) })
  const path = 'light/skin/res/atlas'
  const source = SkinArchive.open(zipSync({
    'skin/Info.txt': strToU8('Name=plain synthetic atlas'),
    'skin/light/skin/port/py_26.ini': strToU8(view),
    'skin/light/skin/res/default.css': strToU8(css),
    [`skin/${path}.til`]: strToU8(til),
    [`skin/${path}.png`]: png,
  }), 'bdi')
  const rects = (archive) => {
    const atlas = new AtlasResolver(archive, 'light', 'port')
    return [atlas.sourceRect('1', false), atlas.sourceRect('1', true), atlas.sourceRect('2', false)]
  }
  assert.deepEqual(rects(source), [[0, 0, 1, 1], [1, 0, 1, 1], [0, 1, 2, 1]])
  for (const bytes of [source.toBytes('bds'), await source.toBytesAsync('bds')]) {
    const result = SkinArchive.open(bytes, 'bds')
    assert.deepEqual(rects(result), rects(source))
    assert.deepEqual(result.getBytes(`${path}.png`), png)
    assert.equal(result.getText('light/skin/port/py_26.ini'), view)
    assert.equal(result.getText('light/skin/res/default.css'), css)
    assert.deepEqual(result.getBytes(`${path}.til`), strToU8(
      '\uFEFF[GLOBAL]\r\nTILE_NUM=3\r\n[IMG1]\r\nSOURCE_RECT=0,0,1,1\r\n[IMG2]\r\nSOURCE_RECT=1,0,1,1\r\n[IMG3]\r\nSOURCE_RECT=0,1,2,1\r\n',
    ))
  }
  assert.deepEqual(source.getBytes(`${path}.til`), strToU8(til))
})

test('BDI → BDS rebuilds entries whose local headers only carry a fake encryption marker', async () => {
  for (const flag of [1, 64]) {
    const view = '[PANEL]\nSIZE=10,10\n'
    const bytes = zipSync({ 'skin/port/py_26.ini': strToU8(view) }, { level: 0 })
    const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    header.setUint16(6, header.getUint16(6, true) | flag, true)
    // 同步打开和带进度回调的流式解包都要能打开，并记下来源的加密标记。
    for (const source of [SkinArchive.open(bytes, 'bdi'), await SkinArchive.openAsync(bytes, 'bdi', () => {})]) {
      assert.deepEqual(source.zipEncryptedPaths(), ['skin/port/py_26.ini'])
      // 原始字节带标记，导出必须按已解包的内容重新压缩成干净 ZIP。
      for (const output of [source.toBytes('bds'), await source.toBytesAsync('bds')]) {
        assert.deepEqual(parseZip(output).entries.filter(isZipEntryEncrypted), [])
        assert.equal(SkinArchive.open(output, 'bds').getText('light/skin/port/py_26.ini'), view)
      }
    }
  }
})

test('same-format save of a marked archive rebuilds instead of copying the markers', async () => {
  const view = '[PANEL]\nSIZE=10,10\n'
  const bytes = zipSync({ 'skin/port/py_26.ini': strToU8(view) }, { level: 0 })
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  header.setUint16(6, header.getUint16(6, true) | 1, true)
  const source = SkinArchive.open(bytes, 'bdi')
  for (const output of [source.toBytes('bdi'), await source.toBytesAsync('bdi')]) {
    assert.deepEqual(parseZip(output).entries.filter(isZipEntryEncrypted), [])
    assert.equal(SkinArchive.open(output, 'bdi').getText('light/skin/port/py_26.ini'), view)
  }
  source.setText('skin/port/py_26.ini', `${view}[KEY1]\nCENTER=a\n`)
  for (const output of [source.toBytes('bdi'), await source.toBytesAsync('bdi')]) {
    assert.deepEqual(parseZip(output).entries.filter(isZipEntryEncrypted), [])
    assert.equal(SkinArchive.open(output, 'bdi').getText('light/skin/port/py_26.ini'), `${view}[KEY1]\nCENTER=a\n`)
  }
})

test('clears decoy central encryption flags even when the EOCD per-disk count is broken', async () => {
  const bytes = sampleArchive()
  const header = dataView(bytes)
  const central = header.getUint32(bytes.length - 6, true)
  header.setUint16(central + 8, header.getUint16(central + 8, true) | 1, true)
  header.setUint32(bytes.length - 14, 0, true)
  const source = await SkinArchive.openAsync(bytes, 'bds', () => {})
  assert.deepEqual(source.zipEncryptedPaths(), [])
  const bdi = await source.toBytesAsync('bdi')
  assert.equal(parseZip(bdi).entries.filter(isZipEntryEncrypted).length, 0)
  assert.equal(SkinArchive.open(bdi, 'bdi').getText('light/skin/port/py_9.ini'), '[PANEL]\nSIZE=480,320')
})

test('exports a ZIP opened through directory repair instead of refusing to convert', async () => {
  const bytes = zipSync({ 'skin/port/py_26.ini': strToU8('[PANEL]\nSIZE=10,10\n') })
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint16(bytes.length - 14, 0, true)
  const source = await SkinArchive.openAsync(bytes, 'bdi')
  const bds = await source.toBytesAsync('bds')
  assert.equal(SkinArchive.open(bds, 'bds').getText('light/skin/port/py_26.ini'), '[PANEL]\nSIZE=10,10\n')
  // 同格式保存也按解包内容重新压缩，修好的 EOCD 计数不会丢。
  const saved = source.toBytes('bdi')
  assert.equal(parseZip(saved).entries.length, 1)
  assert.equal(SkinArchive.open(saved, 'bdi').getText('light/skin/port/py_26.ini'), '[PANEL]\nSIZE=10,10\n')
})

test('BDS → BDI writes .til slices in IMG order, since iOS numbers them by position', async () => {
  const source = await SkinArchive.openAsync(zipSync({
    'Info.txt': strToU8('AtomSkinName=test'),
    'light/port/gen.ini': strToU8('[PANEL]\nSIZE=480,320'),
    'light/res/back.til': strToU8('[GLOBAL]\nTILE_NUM=3\n\n[IMG3]\nSOURCE_RECT=0,2,1,1\n\n[IMG10]\nSOURCE_RECT=0,9,1,1\n\n[IMG1]\nSOURCE_RECT=0,0,1,1'),
  }))
  const bdi = SkinArchive.open(await source.toBytesAsync('bdi'), 'bdi')
  assert.equal(bdi.getText('light/skin/res/back.til'),
    '[GLOBAL]\nTILE_NUM=3\n\n[IMG1]\nSOURCE_RECT=0,0,1,1\n[IMG3]\nSOURCE_RECT=0,2,1,1\n\n[IMG10]\nSOURCE_RECT=0,9,1,1\n\n')
})

test('BDS → BDI makes empty key offsets explicit without changing actions or nonempty offsets', async () => {
  const layout = '[PANEL]\nKEY_NUM=3\n[KEY1]\nFORE_STYLE=101\nPOS_TYPE=\nSHOW=2\nCENTER=b\n[KEY2]\nFORE_STYLE=102,103\nPOS_TYPE=4,\n[KEY3]\nFORE_STYLE=104\n'
  const source = SkinArchive.open(zipSync({
    'Info.txt': strToU8('Name=offsets'),
    'light/port/py_9.ini': strToU8(layout),
    'dark/land/py_9.ini': strToU8(layout),
  }))
  for (const bytes of [source.toBytes('bdi'), await source.toBytesAsync('bdi')]) {
    const bdi = SkinArchive.open(bytes)
    for (const path of ['light/skin/port/py_9.ini', 'dark/skin/land/py_9.ini']) {
      assert.equal(bdi.getText(path), layout.replace('POS_TYPE=\n', 'POS_TYPE=0\n').replace('POS_TYPE=4,\n', 'POS_TYPE=4,0\n'))
    }
  }
  assert.equal(source.getText('light/skin/port/py_9.ini'), layout)
  assert.equal(SkinArchive.open(source.toBytes('bds')).getText('light/skin/port/py_9.ini'), layout)
})

test('editing a text file keeps its byte order mark, and undoing the edit leaves nothing unsaved', () => {
  const original = new Uint8Array([0xef, 0xbb, 0xbf, ...strToU8('[PANEL]\r\nSIZE=1,2\r\n')])
  const archive = SkinArchive.open(zipSync({
    'port/py_26.ini': original,
    'res/default.css': strToU8('[STYLE1]\n'),
  }), 'bds')
  const path = archive.names().find((name) => name.endsWith('py_26.ini'))
  const before = archive.getText(path)
  assert.equal(before, '[PANEL]\r\nSIZE=1,2\r\n')
  archive.setText(path, before.replace('1,2', '3,4'))
  assert.deepEqual([...archive.getBytes(path).subarray(0, 4)], [0xef, 0xbb, 0xbf, 0x5b])
  assert.equal(archive.getText(path), '[PANEL]\r\nSIZE=3,4\r\n')
  assert.ok(archive.changed.has(path))
  archive.setText(path, before)
  assert.deepEqual(archive.getBytes(path), original)
  assert.equal(archive.changed.size, 0)
  // A file without the mark does not gain one.
  const css = archive.names().find((name) => name.endsWith('default.css'))
  archive.setText(css, '[STYLE2]\n')
  assert.equal(archive.getBytes(css)[0], 0x5b)
})
