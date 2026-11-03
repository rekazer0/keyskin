import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { SkinArchive } from '../src/skin.ts'
import { AtlasResolver } from '../src/atlas.ts'
import { bdaPlatform, convertBdaPlatform } from '../src/bda-platform.ts'
import { decodeBdaAppearance, decodeBdaSoundConfig } from '../src/bda-decode.ts'
import { encodedField, encodeVarint, join } from '../src/bda-encode.ts'
import { documentPackage } from '../src/ssf/ssf-convert.ts'
import { ssfFixture } from './helpers/ssf-fixture.mjs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const ast = path => ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true)
const field = (number, value) => encodedField(number, 0, encodeVarint(value))
const text = (number, value) => encodedField(number, 2, strToU8(value))
const message = (number, value) => encodedField(number, 2, value)
const appearance = join([field(6, 1080), message(4, join([
  text(1, 'py_9'), message(2, message(10, new Uint8Array([8, 1]))),
]))])
const sound = message(1, join([text(1, 'click'), message(2, join([field(1, 4), text(2, 'Click.WAV')]))]))
const source = (root = '') => SkinArchive.open(zipSync({
  'INFO.TXT': strToU8('Name=Original\r\nSupportPlatform=A\r\nAtomSkinName=light,dark\r\n'),
  [`${root}port/appearanceConfig`]: appearance,
  [`${root}port/soundConfig`]: sound,
  [`${root}port/switchConfig`]: Uint8Array.of(8, 1),
  [`${root}res/Click.WAV`]: Uint8Array.of(1, 2, 3),
  [`${root}res/Empty.BIN`]: new Uint8Array(),
  [`${root}res/`]: new Uint8Array(),
  'Extras/MixedCase.BIN': Uint8Array.of(9, 8),
  'Extras/': new Uint8Array(),
  'skin/Legacy.INI': strToU8('legacy'),
  'SKIN/Legacy2.INI': strToU8('legacy'),
  'skinny/Keep.BIN': Uint8Array.of(4),
}), 'bda')

for (const root of ['', 'light/']) test(`BDA Android → iOS → Android retains raw paths and never mutates source (${root || 'flat'})`, () => {
  const original = source(root)
  original.setBytes('Extras/MixedCase.BIN', Uint8Array.of(7, 6, 5))
  const before = original.normalizedBytes()
  const revision = original.revision
  const changed = [...original.changed]
  const ios = convertBdaPlatform(original, 'ios')
  assert.equal(bdaPlatform(ios), 'ios')
  assert.deepEqual(original.normalizedBytes(), before)
  assert.equal(original.revision, revision)
  assert.deepEqual([...original.changed], changed)
  const iosBefore = ios.normalizedBytes()
  const iosRoot = root ? 'skin_light/' : ''
  const files = unzipSync(iosBefore)
  assert.ok(files['INFO.TXT'])
  assert.equal(files['Info.txt'], undefined)
  assert.match(strFromU8(files['INFO.TXT']), /SupportPlatform=I\r\n/)
  assert.match(strFromU8(files['INFO.TXT']), /AtomSkinName=skin_light,skin_dark/)
  assert.equal(files[`${iosRoot}port/switchConfig`], undefined)
  assert.equal(files['skin/Legacy.INI'], undefined)
  assert.equal(files['SKIN/Legacy2.INI'], undefined)
  assert.deepEqual(files['skinny/Keep.BIN'], Uint8Array.of(4))
  assert.deepEqual(files['Extras/MixedCase.BIN'], Uint8Array.of(7, 6, 5))
  assert.ok(files['Extras/'])
  assert.ok(files[`${iosRoot}res/`])
  assert.ok(files[`${iosRoot}res/Empty.BIN`])
  assert.equal(decodeBdaAppearance(files[`${iosRoot}port/appearanceConfig`]).designWidth, 1242)
  assert.equal(decodeBdaSoundConfig(files[`${iosRoot}port/soundConfig`]).iosKeySounds.size, 1)

  const android = convertBdaPlatform(ios, 'android')
  assert.equal(bdaPlatform(android), 'android')
  assert.deepEqual(ios.normalizedBytes(), iosBefore)
  assert.equal(ios.revision, 0)
  const roundtrip = unzipSync(android.normalizedBytes())
  assert.match(strFromU8(roundtrip['INFO.TXT']), /SupportPlatform=A\r\n/)
  assert.match(strFromU8(roundtrip['INFO.TXT']), /AtomSkinName=light,dark/)
  assert.equal(decodeBdaAppearance(roundtrip[`${root}port/appearanceConfig`]).designWidth, 1080)
  assert.equal(decodeBdaSoundConfig(roundtrip[`${root}port/soundConfig`]).keySounds.size, 1)
  for (const path of [`${root}res/Click.WAV`, `${root}res/Empty.BIN`, `${root}res/`, 'Extras/', 'Extras/MixedCase.BIN', 'skinny/Keep.BIN']) {
    assert.deepEqual(roundtrip[path], unzipSync(before)[path], path)
  }
})

test('BDA conversion only packs and opens the final archive once', () => {
  let packs = 0
  let opens = 0
  const exports = {}
  const context = vm.createContext({ exports, require: name => {
    if (name === 'fflate') return { strFromU8, strToU8, zipSync: (...args) => { packs++; return zipSync(...args) } }
    if (name === './skin.ts') return { SkinArchive: { open: (...args) => { opens++; return SkinArchive.open(...args) } } }
    if (name === './bda-encode.ts') return { convertBdaAppearancePlatform: encode.convertBdaAppearancePlatform, convertBdaSoundPlatform: encode.convertBdaSoundPlatform, IOS_BDA_PANELS: encode.IOS_BDA_PANELS }
    if (name === './bda-decode.ts') return { decodeBdaAppearance, decodeBdaSoundConfig }
    throw new Error(name)
  } })
  vm.runInContext(ts.transpile(read('src/bda-platform.ts'), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }), context)
  const archive = source('light/')
  archive.normalizedBytes = () => { throw new Error('must not repack source') }
  exports.convertBdaPlatform(archive, 'ios')
  assert.equal(packs, 1)
  assert.equal(opens, 1)
})
import * as encode from '../src/bda-encode.ts'

test('Atlas exact file lookups do not enumerate names, including empty files and missing images', async () => {
  const archive = SkinArchive.open(zipSync({
    'light/res/default.css': strToU8('[STYLE1]\nNM_IMG=key,1\n[STYLE2]\nNM_IMG=missing,1\n'),
    'light/res/key.til': strToU8('[IMG1]\nSOURCE_RECT=0,0,12,24\n'),
    'light/res/key.png': new Uint8Array(),
  }))
  const names = archive.names.bind(archive)
  let scans = 0
  archive.names = () => { scans++; return names() }
  const resolver = new AtlasResolver(archive, 'light', 'port')
  const baseline = scans // Font references may legitimately enumerate the archive.
  assert.deepEqual(resolver.sourceSize('1', false), { width: 12, height: 24 })
  assert.equal(resolver.sourceSize('2', false), undefined)
  resolver.bitmap = () => undefined
  await resolver.resolve('1', false)
  await resolver.resolve('2', false)
  assert.equal(scans, baseline)
})

const declarations = (path, names) => ast(path).statements
  .filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
  .map(node => node.getText().replace(/^export /, '')).join('\n')

test('SSF document and preview share the same package, invalidating by revision and archive identity', () => {
  const archive = SkinArchive.open(ssfFixture(), 'ssf')
  const appState = { archive }
  let parses = 0
  const context = vm.createContext({ appState, documentPackage: archive => { parses++; return documentPackage(archive) } })
  vm.runInContext(ts.transpile(declarations('src/app/ssf-documents.ts', ['ssfDocumentPackage', 'ssfPackage']), { target: ts.ScriptTarget.ES2022 }), context)
  const first = context.ssfPackage()
  assert.equal(context.ssfDocumentPackage(archive), first)
  assert.equal(context.ssfPackage(), first)
  assert.equal(parses, 1)
  archive.setText('phoneTheme.ini', `${archive.getText('phoneTheme.ini')}\n; edit`)
  const next = context.ssfDocumentPackage(archive)
  assert.notEqual(next, first)
  assert.equal(context.ssfPackage(), next)
  assert.equal(parses, 2)
  appState.archive = SkinArchive.open(ssfFixture(), 'ssf')
  assert.notEqual(context.ssfPackage(), next)
  assert.equal(parses, 3)
  appState.archive = { format: 'bda' }
  assert.equal(context.ssfPackage(), undefined)
  appState.archive = SkinArchive.open(zipSync({ 'phoneTheme.ini': new Uint8Array() }), 'ssf')
  assert.equal(context.ssfPackage(), undefined)
  assert.throws(() => context.ssfDocumentPackage(appState.archive))
  assert.match(read('src/app/ssf-preview.ts'), /export \{ ssfDocumentPackage \} from "\.\/ssf-documents"/)
})

test('preview refresh reuses decoded BDA animations and preserves playback until bytes actually change', () => {
  const source = ast('src/app/preview-render.ts')
  const refresh = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'refreshPreview')
  const statements = [...refresh.body.statements]
  const start = statements.findIndex(node => node.getText(source).startsWith('const animationPath ='))
  const end = statements.findIndex(node => node.getText(source).startsWith('const layouts ='))
  const cache = source.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(decl => decl.name.getText(source) === 'previewAnimations'))
  let decodes = 0
  let sets = 0
  const preview = { animation: undefined, startedAt: 42, setAnimation(value) { sets++; this.animation = value; this.startedAt = 0 } }
  const archive = SkinArchive.open(zipSync({
    'port/appearanceConfig': appearance,
    'port/animationConfig': new Uint8Array(),
    'land/animationConfig': Uint8Array.of(8, 0),
  }), 'bda')
  const appState = { archive }
  let selectedPath = 'light/skin/port/animationConfig'
  const context = vm.createContext({ appState, preview, theme: { value: 'light' }, orientation: { value: 'port' }, bdaConfigPath: () => selectedPath,
    decodeBdaAnimation: bytes => { decodes++; return { bytes } } })
  vm.runInContext(ts.transpile(`${cache.getText(source)}\nfunction update() { ${statements.slice(start, end).map(node => node.getText(source)).join('\n')} }`, { target: ts.ScriptTarget.ES2022 }), context)
  context.update()
  preview.startedAt = 42
  context.update()
  archive.setText('Info.txt', 'Name=unrelated edit')
  context.update()
  assert.equal(decodes, 1)
  assert.equal(sets, 1)
  assert.equal(preview.startedAt, 42)
  archive.setBytes(selectedPath, Uint8Array.of(8, 1))
  context.update()
  assert.equal(decodes, 2)
  assert.equal(sets, 2)
  selectedPath = 'light/skin/land/animationConfig'
  context.update()
  assert.equal(decodes, 3)
  selectedPath = 'light/skin/port/animationConfig'
  context.update()
  assert.equal(decodes, 3)
  assert.equal(sets, 4)
  archive.delete(selectedPath)
  context.update()
  assert.equal(preview.animation, undefined)
  assert.equal(sets, 5)
  context.update()
  assert.equal(sets, 5)
  preview.animation = {} // Another native preview may replace animation state.
  context.update()
  assert.equal(sets, 6)
})
