// 皮肤字体路径 / 命名逻辑（src/font-files.ts）：真机按 CSS 所在 res 目录解析 FONT_PATH。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  fontNameCandidates,
  fontSearchDirectories,
  isFontFile,
  normalizeArchivePath,
  relativeArchivePath,
  resolveFontReference,
  sanitizeFontFileName,
  skinFontFiles,
  skinStylePaths,
  themeOfPath,
  uniqueFontFileName,
  withFontReferencesCleared,
  withGlobalFontPath,
} from '../src/font-files.ts'

const names = [
  'light/skin/port/res/default.css',
  'light/skin/land/res/default.css',
  'light/skin/res/default.css',
  'dark/skin/port/res/default.css',
  'dark/res/default.css',
  'light/skin/res/benxu.ttf',
  'light/skin/res/DROIDSANSFALLBACK.TTF',
  'dark/skin/res/symbols.otf',
  'light/skin/port/res/broken.png',
]

test('font files are found by extension regardless of case', () => {
  assert.equal(isFontFile('a.ttf'), true)
  assert.equal(isFontFile('a.TTC'), true)
  assert.equal(isFontFile('a.otf'), true)
  assert.equal(isFontFile('a.woff2'), false)
  assert.deepEqual(skinFontFiles(names), [
    'dark/skin/res/symbols.otf',
    'light/skin/res/benxu.ttf',
    'light/skin/res/DROIDSANSFALLBACK.TTF',
  ])
})

test('every CSS variant of the skin is listed, light first', () => {
  assert.deepEqual(skinStylePaths(names), [
    'light/skin/land/res/default.css',
    'light/skin/port/res/default.css',
    'light/skin/res/default.css',
    'dark/skin/port/res/default.css',
  ])
  assert.equal(themeOfPath('dark/skin/port/res/default.css'), 'dark')
})

test('archive paths allow .. but never escape the archive root', () => {
  assert.equal(normalizeArchivePath('light/skin/port/res', '../../res/benxu.ttf'), 'light/skin/res/benxu.ttf')
  assert.equal(normalizeArchivePath('light/skin/res', './benxu.ttf'), 'light/skin/res/benxu.ttf')
  assert.equal(normalizeArchivePath('light/res', '../skin/res/a.ttf'), 'light/skin/res/a.ttf')
  assert.equal(normalizeArchivePath('light/res', '../../../outside.ttf'), undefined)
  assert.equal(normalizeArchivePath('light/res', '/etc/font.ttf'), undefined)
  assert.equal(normalizeArchivePath('light/res', 'C:/font.ttf'), undefined)
  assert.equal(normalizeArchivePath('light/res', 'a\\b.ttf'), 'light/res/a/b.ttf')
})

test('relative FONT_PATH points from each CSS directory to the theme font', () => {
  assert.equal(
    relativeArchivePath('light/skin/port/res/default.css', 'light/skin/res/benxu.ttf'),
    '../../res/benxu.ttf',
  )
  assert.equal(
    relativeArchivePath('light/skin/land/res/default.css', 'light/skin/res/benxu.ttf'),
    '../../res/benxu.ttf',
  )
  assert.equal(relativeArchivePath('light/skin/res/default.css', 'light/skin/res/benxu.ttf'), 'benxu.ttf')
  assert.equal(
    relativeArchivePath('dark/skin/port/res/default.css', 'light/skin/res/benxu.ttf'),
    '../../../../light/skin/res/benxu.ttf',
  )
})

test('FONT_NAME resolves with or without an extension', () => {
  assert.deepEqual(fontNameCandidates('benxu'), ['benxu', 'benxu.ttf', 'benxu.otf', 'benxu.ttc'])
  assert.deepEqual(fontNameCandidates('DROIDSANSFALLBACK.ttf'), ['DROIDSANSFALLBACK.ttf'])
  const directories = fontSearchDirectories('light/skin/port/res/default.css')
  assert.deepEqual(directories.slice(0, 2), ['light/skin/port/res', 'light/skin/res'])
  assert.equal(resolveFontReference(names, 'benxu', directories, { extensions: true }), 'light/skin/res/benxu.ttf')
  assert.equal(
    resolveFontReference(names, 'droidsansfallback.ttf', directories, { extensions: true }),
    'light/skin/res/DROIDSANSFALLBACK.TTF',
  )
  assert.equal(resolveFontReference(names, 'PingFang SC', directories, { extensions: true }), undefined)
})

test('GLOBAL FONT_PATH resolves theme-root fonts through ..', () => {
  const directories = fontSearchDirectories('light/skin/port/res/default.css')
  assert.equal(resolveFontReference(names, '../../res/benxu.ttf', directories), 'light/skin/res/benxu.ttf')
  assert.equal(resolveFontReference(names, 'benxu.ttf', directories), 'light/skin/res/benxu.ttf')
  assert.equal(
    resolveFontReference(names, 'benxu.ttf', fontSearchDirectories('light/skin/res/default.css')),
    'light/skin/res/benxu.ttf',
  )
})

test('imported font names are sanitized and made unique', () => {
  assert.equal(sanitizeFontFileName('BenXu.ttf'), 'BenXu.ttf')
  assert.equal(sanitizeFontFileName('我的 字体 (1).TTF'), 'font-1.ttf')
  assert.equal(sanitizeFontFileName('a b.ttc'), 'a-b.ttc')
  assert.throws(() => sanitizeFontFileName('font.woff2'), /ttf/)
  assert.equal(uniqueFontFileName('benxu.ttf', names), 'benxu-2.ttf')
  assert.equal(uniqueFontFileName('benxu.ttf', ['x/other.ttf']), 'benxu.ttf')
})

test('GLOBAL FONT_PATH writes, updates and clears without touching other sections', () => {
  assert.equal(
    withGlobalFontPath('[STYLE1]\nFONT_SIZE=40\n', '../../res/benxu.ttf'),
    '[GLOBAL]\nFONT_PATH=../../res/benxu.ttf\n[STYLE1]\nFONT_SIZE=40\n',
  )
  assert.equal(
    withGlobalFontPath('[GLOBAL]\nFONT_PATH=a.ttf\n[STYLE1]\nFONT_SIZE=40\n', '../../res/benxu.ttf'),
    '[GLOBAL]\nFONT_PATH=../../res/benxu.ttf\n[STYLE1]\nFONT_SIZE=40\n',
  )
  assert.equal(withGlobalFontPath('[GLOBAL]\nFONT_PATH=a.ttf\n', 'a.ttf'), undefined)
  assert.equal(withGlobalFontPath('[GLOBAL]\nFONT_PATH=a.ttf\n', ''), '[GLOBAL]\n')
  assert.equal(withGlobalFontPath('[STYLE1]\n', ''), undefined)
})

test('removing a font clears its references but leaves system font names alone', () => {
  const text = [
    '[GLOBAL]',
    'FONT_PATH=../../res/benxu.ttf',
    '[STYLE1]',
    'FONT_NAME=benxu',
    '[STYLE2]',
    'FONT_NAME=DROIDSANSFALLBACK.ttf',
    '[STYLE3]',
    'FONT_NAME=PingFang SC',
    '[STYLE4]',
    'FONT_PATH=../../res/benxu.ttf',
    '',
  ].join('\n')
  const removed = new Set(['light/skin/res/benxu.ttf'])
  const after = withFontReferencesCleared(text, 'light/skin/port/res/default.css', names, removed, 'benxu')
  assert.equal(after, [
    '[GLOBAL]',
    '[STYLE1]',
    '[STYLE2]',
    'FONT_NAME=DROIDSANSFALLBACK.ttf',
    '[STYLE3]',
    'FONT_NAME=PingFang SC',
    '[STYLE4]',
    '',
  ].join('\n'))
  // 已经删掉的文件也按文件名清引用。
  assert.equal(
    withFontReferencesCleared('[GLOBAL]\nFONT_PATH=../../res/lost.ttf\n', 'light/skin/port/res/default.css', names, new Set(), 'lost'),
    '[GLOBAL]\n',
  )
})

test('removing a font preserves references to a same-name file in the other mode', () => {
  const paths = ['light/skin/res/shared.ttf', 'dark/skin/res/shared.ttf']
  const text = '[GLOBAL]\nFONT_PATH=shared.ttf\n[STYLE1]\nFONT_NAME=shared\n'
  const removed = new Set([paths[0]])
  assert.equal(withFontReferencesCleared(text, 'dark/skin/res/default.css', paths, removed, 'shared'), undefined)
  assert.equal(withFontReferencesCleared(text, 'light/skin/res/default.css', paths, removed, 'shared'), '[GLOBAL]\n[STYLE1]\n')
})
