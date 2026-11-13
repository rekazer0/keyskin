import { test } from 'node:test'
import assert from 'node:assert/strict'
import { strToU8, zipSync } from 'fflate'
import { bdiMenuIcons, bdiToolbarIcons } from '../src/ios-toolbar-menu.ts'
import { AtlasResolver } from '../src/atlas.ts'
import { SkinArchive } from '../src/skin.ts'

const labels = ['键盘类型', '移动光标', '表情', 'AI搜索', '皮肤壁纸', '键盘字体', '次遇', '剪贴板', '灵感语录', '快捷翻译', '超会写', '神句配图', '文字扫描', '语音输入', '音效与振动', '游戏键盘', '多语言设置', '切换繁体', '键盘手写', '调整高度', '单手模式', '夜间模式', '特技字体', 'Emoji密语', '语音速记', '滑行输入', '同步', '详细设置', '定制工具栏']
const item = (id, title, path, position = 'menu') => `<dict><key>Name</key><string>${id}</string><key>Position</key><string>${position}</string><key>Titles</key><dict><key>Normal</key><dict><key>Normal</key><string>${title}</string></dict></dict><key>Images</key><dict><key>Normal</key><dict><key>Normal</key><string>${path}</string></dict></dict></dict>`
const plist = entries => strToU8(`<plist><array>${entries.join('')}</array></plist>`)

test('BDI inspector lists all 29 screenshot functions even without a menu plist', () => {
  const icons = bdiMenuIcons()
  assert.deepEqual(icons.map(icon => icon.label), labels)
  assert.equal(new Set(icons.map(icon => icon.id)).size, 29)
  assert.ok(icons.every(icon => icon.icon && icon.path))
  assert.deepEqual(icons.slice(0, 4).map(icon => icon.position), ['toolbar', 'toolbar', 'toolbar', 'toolbar'])
  assert.ok(icons.slice(4).every(icon => icon.position === 'menu'))
})

test('BDI menu functions match by ID even with obfuscated labels, custom filenames, or menu position', () => {
  const bytes = plist([
    item('55', 'a'.repeat(64), '/jyx/55dq.png'),
    item('45', 'AI侃侃', 'custom/ai'),
    item('26', '搜索', 'custom/search', 'toolbar'),
    item('55', 'duplicate', 'other/ciyu', 'toolbar'),
    item('99', '扩展 &amp; 功能', 'custom/extension'),
    item('98', 'b'.repeat(64), 'custom/unknown'),
  ])
  const icons = bdiMenuIcons(bytes)
  assert.equal(icons.length, 31)
  assert.deepEqual(icons.slice(0, 29).map(icon => icon.label), labels)
  assert.deepEqual(icons.find(icon => icon.id === '55'), { id: '55', label: '次遇', path: 'jyx/55dq', icon: 'smile-plus', position: 'menu' })
  assert.equal(icons.find(icon => icon.id === '45').path, 'custom/ai')
  assert.equal(icons.find(icon => icon.id === '99').label, '功能 99')
  assert.equal(icons.at(-1).label, '功能 98')
})

test('BDI files without function IDs can match canonical image names and known aliases', () => {
  const icons = bdiMenuIcons(plist([
    item('', '旧标题', '1.0/toolbarMenuItem_KBSwitch_Normal'),
    item('', 'OCR', '1.0/toolbarMenuItem_OCR_Normal').replace('<key>Name</key><string></string>', ''),
  ]))
  assert.equal(icons.length, 29)
  assert.equal(icons.find(icon => icon.id === '43').path, '1.0/toolbarMenuItem_OCR_Normal')
})

test('BDI ignores invalid function records and replaces obfuscated extension titles with IDs', () => {
  const icons = bdiMenuIcons(plist([
    item('54', `${'c7d8e9f0'.repeat(8)}MjI1MzI3Nzk4OQ==`, '/dq/54'),
    item('139', 'MjI1MzI3Nzk4OQ==', '/dq/139'),
    item('98', 'undefined', '/dq/98'),
    item('undefined', 'undefined', '/dq/2'),
    item('undefined', 'undefined', '/dq/3'),
    item('undefined', 'undefined', '/dq/1'),
    item('undefined', '旧标题', '1.0/toolbarMenuItem_KBSwitch_Normal'),
    item('0', '混淆标题', '/dq/0').replace('<string>0</string>', '<integer>0</integer>'),
  ]))
  assert.deepEqual(icons.slice(29).map(icon => icon.label), ['功能 54', '功能 139', '功能 98'])
  assert.equal(icons.find(icon => icon.id === '17').path, '1.0/toolbarMenuItem_KBSwitch_Normal')
  assert.equal(icons.find(icon => icon.id === '0').path, 'dq/0')
})

test('BDI labels depend on function IDs for arbitrary titles and resource paths', () => {
  for (const title of ['自定义名称', 'plain English title', 'undefined', '!!!混淆内容!!!', 'z'.repeat(100)]) {
    const icons = bdiMenuIcons(plist([item('17', title, 'arbitrary/image'), item('99', title, 'other/image')]))
    assert.equal(icons.find(icon => icon.id === '17').label, '键盘类型')
    assert.equal(icons.find(icon => icon.id === '99').label, '功能 99')
  }
})

test('BDI keeps declared toolbar order and recognises full native filenames without IDs', () => {
  const icons = bdiToolbarIcons(plist([
    item('35', 'title', 'custom/clipboard', 'toolbar'),
    item('', 'title', '/custom/toolbarMenuItem_Emoji_Normal_iphone@3x.png', 'toolbar'),
    item('', 'title', '/toolbarMenuItem_OCR_Normal@3x.png', 'toolbar'),
    item('17', 'title', 'custom/keyboard', 'toolbar'),
    item('18', 'title', 'custom/cursor', 'toolbar'),
    item('23', 'title', 'custom/voice', 'menu'),
  ]))
  assert.deepEqual(icons.map(icon => icon.id), ['35', '19', '43', '17'])
  assert.equal(icons[1].path, 'custom/toolbarMenuItem_Emoji_Normal_iphone@3x')
})

test('menu-only BDI can preview functions outside the usual four and deduplicates by function', () => {
  const icons = bdiToolbarIcons(plist([
    item('23', 'title', 'voice'), item('23', 'duplicate', 'other-voice'),
    item('35', 'title', 'clipboard'), item('99', 'title', 'extension'),
  ]))
  assert.deepEqual(icons.map(icon => icon.id), ['23', '35', '99'])
  assert.equal(icons[0].path, 'voice')
  assert.deepEqual(bdiToolbarIcons(strToU8('invalid')), [])
})

test('menu-only BDI previews common function artwork and leaves the archive unchanged', async () => {
  const archive = SkinArchive.open(zipSync({
    'skin/light/skin/res/logo/com.baidu.inputmethod.toolbarMenuItems.plist': plist([
      item('13', '特技字体', '/dq/13'),
      ...['26', '19', '18', '17'].map(id => item(id, '混淆标题', `/dq/${id}`)),
    ]),
    ...Object.fromEntries(['13', '26', '19', '18', '17'].map(id => [`skin/light/skin/res/logo/dq/${id}.png`, new Uint8Array([1])])),
  }), 'bdi')
  const before = archive.toBytes()
  const original = globalThis.createImageBitmap
  globalThis.createImageBitmap = async () => ({ width: 80, height: 80 })
  try {
    const resolver = new AtlasResolver(archive, 'light', 'port')
    const icons = await resolver.resolveToolbarImages()
    assert.deepEqual(icons.map(icon => icon.label), labels.slice(0, 4))
    assert.deepEqual(icons.map(icon => icon.imagePath), ['17', '18', '19', '26'].map(id => `light/skin/res/logo/dq/${id}.png`))
    assert.equal((await resolver.resolveToolbarImages(2)).length, 2)
    assert.deepEqual(archive.toBytes(), before)
  } finally { globalThis.createImageBitmap = original }
})

test('BDI resolves declared PNG, @3x and full iPhone image references in either theme', async () => {
  const original = globalThis.createImageBitmap
  globalThis.createImageBitmap = async () => ({ width: 60, height: 60 })
  try {
    for (const theme of ['light', 'dark']) {
      for (const filename of ['custom.png', 'custom@3x.png', 'custom_iphone@3x.png']) {
        const root = `skin/${theme}/skin/res/logo/`
        const archive = SkinArchive.open(zipSync({
          [`${root}com.baidu.inputmethod.toolbarMenuItems.plist`]: plist([item('17', '任意标题', `/nested/${filename}`, 'toolbar')]),
          [`${root}nested/${filename}`]: new Uint8Array([1]),
        }), 'bdi')
        const resolver = new AtlasResolver(archive, theme, 'port')
        const [icon] = await resolver.resolveToolbarImages()
        assert.equal(icon.imagePath, `${theme}/skin/res/logo/nested/${filename}`)
        assert.ok(icon.image)
        assert.equal(icon.label, '键盘类型')
        assert.equal(archive.revision, 0)
      }
    }
  } finally { globalThis.createImageBitmap = original }
})

test('BDI full icon resolution retains missing or corrupt PNGs as defaults without mutating the archive', async () => {
  const archive = SkinArchive.open(zipSync({
    'skin/light/skin/res/logo/com.baidu.inputmethod.toolbarMenuItems.plist': plist([item('55', 'bad title', 'missing'), item('23', '语音输入', 'broken')]),
    'skin/light/skin/res/logo/broken.png': strToU8('not a png'),
  }), 'bdi')
  const before = archive.toBytes()
  const original = globalThis.createImageBitmap
  globalThis.createImageBitmap = async () => { throw new Error('invalid png') }
  try {
    const resolver = new AtlasResolver(archive, 'light', 'port')
    const icons = await resolver.resolveToolbarImages(Number.POSITIVE_INFINITY)
    assert.equal(icons.length, 29)
    assert.ok(icons.every(icon => !icon.image && icon.defaultIcon && icon.menu))
    assert.equal(icons.find(icon => icon.menu.id === '55').imagePath, 'light/skin/res/logo/missing_iphone@3x.png')
    assert.equal(icons.find(icon => icon.menu.id === '23').imagePath, 'light/skin/res/logo/broken.png')
    assert.deepEqual(archive.toBytes(), before, 'viewing defaults never adds configuration or image files')
  } finally {
    globalThis.createImageBitmap = original
  }
})
