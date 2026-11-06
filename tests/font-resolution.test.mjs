// 预览按 CSS 的 res 目录解析 FONT_PATH / FONT_NAME，并和真机一样按皮肤格式区分：
// BDS（Android 旧 CSS）只解析 [GLOBAL] FONT_PATH（CssLoader.t()），样式字体只能靠导出时切片，
// 所以只认指向皮肤字体文件的 FONT_NAME / FONT_PATH；BDI（iOS）原生支持 FONT_NAME 与样式级 FONT_PATH。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { strToU8, zipSync } from 'fflate'
import { SkinArchive } from '../src/skin.ts'
import { AtlasResolver, canvasFontFamily } from '../src/atlas.ts'
import { IniDocument } from '../src/ini.ts'
import { resolveCandidateInputTextVisual, resolveCandidateTextVisuals } from '../src/candidate-style.ts'

const css = [
  '[GLOBAL]',
  'FONT_PATH=../../res/benxu.ttf',
  '[STYLE1]',
  'SHOW=A',
  'FONT_SIZE=40',
  '[STYLE2]',
  'SHOW=B',
  'FONT_NAME=benxu',
  '[STYLE3]',
  'SHOW=C',
  'FONT_NAME=PingFang SC',
  '[STYLE4]',
  'SHOW=D',
  'FONT_PATH=symbols.ttf',
  '',
].join('\n')

// Android 旧包：CSS 直接放在主题目录下，字体按主题根 res 共用。
const bdsArchive = SkinArchive.open(zipSync({
  'Info.txt': strToU8('AtomSkinName=test'),
  'light/port/res/default.css': strToU8(css),
  'light/res/benxu.ttf': new Uint8Array([0, 1, 2, 3]),
  'light/port/res/symbols.ttf': new Uint8Array([4, 5, 6]),
  'light/port/py_9.ini': strToU8('[PANEL]\nSIZE=480,320\n[CAND]\nFORE_STYLE=2\n[INPUT]\nFORE_STYLE=3'),
}, { level: 0 }))

// iOS 包：CSS 在外层 skin/ 目录里。
const bdiArchive = SkinArchive.open(zipSync({
  'skin/Info.txt': strToU8('AtomSkinName=test'),
  'skin/port/res/default.css': strToU8(css),
  'skin/res/benxu.ttf': new Uint8Array([0, 1, 2, 3]),
  'skin/port/res/symbols.ttf': new Uint8Array([4, 5, 6]),
  'skin/port/py_9.ini': strToU8('[PANEL]\nSIZE=480,320'),
}, { level: 0 }))

function resolverFor(archive) {
  return new AtlasResolver(archive, 'light', 'port')
}

test('BDS GLOBAL FONT_PATH is embedded and used as the default text font', async () => {
  assert.equal(bdsArchive.format, 'bds')
  const resolver = resolverFor(bdsArchive)
  await resolver.ready()
  const fontName = resolver.resolveStyleText('1', false)?.fontName
  assert.match(fontName ?? '', /^BdiEmbeddedFont\d+$/)
  assert.match(canvasFontFamily(fontName), /BdiEmbeddedFont/)
})

test('BDS previews [STYLE*] FONT_NAME / FONT_PATH that name skin fonts, like the exported font slices', () => {
  const resolver = resolverFor(bdsArchive)
  const globalFamily = resolver.resolveStyleText('1', false)?.fontName
  // 真机不解析样式字体，但导出 BDS 时会按皮肤字体文件切片，预览与导出一致。
  assert.match(resolver.resolveStyleText('2', false)?.fontName ?? '', /^BdiEmbeddedFont\d+$/)
  assert.match(resolver.resolveStyleText('4', false)?.fontName ?? '', /^BdiEmbeddedFont\d+$/)
  assert.notEqual(resolver.resolveStyleText('4', false)?.fontName, globalFamily)
  // 系统字体名无法切片，真机也不认：落回 GLOBAL 字体。
  assert.equal(resolver.resolveStyleText('3', false)?.fontName, globalFamily)
})

test('BDI embeds [STYLE*] FONT_NAME with and without an extension', async () => {
  assert.equal(bdiArchive.format, 'bdi')
  const resolver = resolverFor(bdiArchive)
  await resolver.ready()
  const globalFamily = resolver.resolveStyleText('1', false)?.fontName
  assert.match(globalFamily ?? '', /^BdiEmbeddedFont\d+$/)
  // benxu 与 GLOBAL 的 ../../res/benxu.ttf 是同一个文件，共用同一份内嵌字体。
  assert.equal(resolver.resolveStyleText('2', false)?.fontName, globalFamily)
  // 未知 FONT_NAME 保持系统字体名。
  assert.equal(resolver.resolveStyleText('3', false)?.fontName, 'PingFang SC')
})

test('BDI supports the iOS-only per-style FONT_PATH', () => {
  const resolver = resolverFor(bdiArchive)
  const globalFamily = resolver.resolveStyleText('1', false)?.fontName
  const symbolsFamily = resolver.resolveStyleText('4', false)?.fontName
  assert.match(symbolsFamily ?? '', /^BdiEmbeddedFont\d+$/)
  // symbols.ttf 与 GLOBAL 的 benxu.ttf 不是同一份字体，样式级 FONT_PATH 生效。
  assert.notEqual(symbolsFamily, globalFamily)
})

test('BDS candidate words and input code stay on the user font', () => {
  const general = IniDocument.parse(bdsArchive.getText('light/port/py_9.ini'))
  const resolver = resolverFor(bdsArchive)
  // 真机候选字/输入码文字固定用用户字体（TypefaceUtils.getCusTypeface()），皮肤 FONT_NAME 不参与。
  assert.equal(resolveCandidateTextVisuals(general, general, resolver).normal?.fontName, undefined)
  assert.equal(resolveCandidateInputTextVisual(general, resolver)?.fontName, undefined)
  assert.equal(resolveCandidateInputTextVisual(general, resolver, general, true)?.fontName, undefined)
})
