import { test } from 'node:test'
import assert from 'node:assert/strict'
import { strToU8, zipSync } from 'fflate'
import { bdiMenuIcons } from '../src/ios-toolbar-menu.ts'
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
  assert.equal(icons.find(icon => icon.id === '99').label, '扩展 & 功能')
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
