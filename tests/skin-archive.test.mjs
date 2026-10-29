import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deflateSync, strToU8, zipSync } from 'fflate'
import { SkinArchive } from "../src/skin.ts"
import { readArchiveEntry } from "../src/skin-zip.ts"

const LOCAL_SIGNATURE = 0x04034b50
const CENTRAL_SIGNATURE = 0x02014b50
const END_SIGNATURE = 0x06054b50

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

// Palm 的打包器把真实大小写进中央目录的 ZIP64 extra 字段，却不写 ZIP64 结束记录，
// fflate 因此不会去读它（拒绝摆烂-乱17.sxi 就报“超过 256 MB”）。
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
