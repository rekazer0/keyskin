// 面板复制、替换键盘样式、适配 iOS 26 for Palm (.sxi) and Sogou (.ssf): the parts that rewrite each
// format's own files, checked without a browser.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { strFromU8, unzipSync } from 'fflate'
import { IniDocument } from '../src/ini.ts'
import { SkinArchive } from '../src/skin.ts'
import { archiveCopyPaths } from '../src/panel-tools.ts'
import { adaptSxiForIos26 } from '../src/palm/sxi-ios26.ts'
import { applySxiCopies, scaleSxiPart, sxiCopyParts, sxiFolderParts, sxiPartAddresses } from '../src/palm/sxi-panel-copy.ts'
import { applySxiLayoutImage } from '../src/palm/sxi-layout-image.ts'
import { encodeSkinJson } from '../src/palm/sxi-json.ts'
import { adaptSsfSkinForIos26, isSsfSkinFile } from '../src/ssf/ssf-ios26.ts'
import { scaleSsfLook } from '../src/ssf/ssf-resolutions.ts'
import { listSsfResolutionInTheme, listSsfResolutionInTime, ssfResolutionFolder } from '../src/ssf/ssf-panel-copy.ts'
import { applySsfBackgroundImage, applySsfKeyImage } from '../src/ssf/ssf-layout-image.ts'
import { ssfKeyBinding } from '../src/ssf/ssf-keymap.ts'
import { ssfFixture } from './helpers/ssf-fixture.mjs'

const template = SkinArchive.open(new Uint8Array(readFileSync(new URL('../public/templates/palm-harmony.sxi', import.meta.url))), 'sxi')
const templateText = template.getText('skin.json')
const templateSkin = JSON.parse(templateText)

test('Palm iOS 26: keyboards and the symbol panel almost transparent, the candidate bar fully, other pages kept', () => {
  const skin = JSON.parse(adaptSxiForIos26(templateText))
  for (const theme of ['default', 'night']) {
    const styles = skin[theme].s_info.ss_1
    for (const layout of ['port_layout', 'land_layout']) {
      const boards = skin[theme][layout].b
      const before = templateSkin[theme][layout].b
      for (const type of ['full26Pinyin', 't9Pinyin', 'stroke', 'handwritingGrid', 'symbol']) {
        assert.deepEqual(styles[boards[type].board.b.base_b].s_1, { c_hl: '01D0D4DB', c_normal: '01D0D4DB', for_back: true }, `${theme} ${layout} ${type}`)
      }
      for (const type of ['logo', 'selChinese', 'defaultGlobal']) assert.deepEqual(boards[type].board, before[type].board, `${type} keeps its page background`)
      assert.equal(styles[boards.defaultGlobal.cand.b.base_b].s_1.c_normal, '00D0D4DB')
      assert.deepEqual(boards.defaultGlobal.cand.b.base_f, before.defaultGlobal.cand.b.base_f)
    }
  }
  // Two styles per theme, reused when adapting again.
  assert.equal(Object.keys(skin.default.s_info.ss_1).length, Object.keys(templateSkin.default.s_info.ss_1).length + 2)
  assert.equal(adaptSxiForIos26(encodeSkinJson(skin)), encodeSkinJson(skin))
  assert.throws(() => adaptSxiForIos26('{"info":{}}'), /手心键盘布局/)
})

test('Palm iOS 26: a .cnd with its own background carries the bar; new style ids are free in every table', () => {
  const skin = {
    default: {
      port_layout: { b: { full26Pinyin: { keys: [] }, defaultGlobal: { board: { b: { base_b: 1, base_pa: 7 }, size: [720, 400] } } }, c: { cand1: { b: { base_b: 2 } } } },
      s_info: { ss_1: { 1: { f: 0, id: 'STYLE1' } } },
      s_port: { ss_1: { 5: { f: 0, id: 'STYLE5' } } },
    },
  }
  const adapted = JSON.parse(adaptSxiForIos26(encodeSkinJson(skin)))
  const layout = adapted.default.port_layout
  assert.deepEqual(layout.c.cand1.b, { base_b: 6 })
  assert.deepEqual(layout.b.full26Pinyin.board, { b: { base_b: 7, base_pa: 7 } }, 'only the background changes; the size still falls back')
  assert.equal(layout.b.defaultGlobal.cand, undefined)
})

test('Sogou iOS 26: RootView almost transparent, every candidate view fully, keys untouched', () => {
  const files = unzipSync(ssfFixture())
  const paths = Object.keys(files).filter(isSsfSkinFile)
  assert.deepEqual(paths.sort(), ['1080/status1/phoneSkin.ini', '1080/status2/phoneSkin.ini'])
  assert.equal(isSsfSkinFile('720/phoneSkin.ini'), true)
  assert.equal(isSsfSkinFile('default/phoneSkin.ini'), false)
  const before = strFromU8(files['1080/status1/phoneSkin.ini']).replace('[CandidateView]', '[CandidateViewLand]\nBG_STYLE=1\nBG_IMAGE=BgCandidate1\n[CandidateView]')
  const after = IniDocument.parse(adaptSsfSkinForIos26(before))
  assert.deepEqual(after.entries('RootView').map(({ key, value }) => `${key}=${value}`), ['BG_STYLE=2', 'BG_COLOR=0x01D0D4DB'])
  for (const view of ['CandidateView', 'CandidateViewLand']) {
    assert.deepEqual(after.entries(view).map(({ key, value }) => `${key}=${value}`), ['BG_STYLE=2', 'BG_COLOR=0x00D0D4DB'])
  }
  const original = IniDocument.parse(before)
  for (const section of original.sections().filter((name) => !/^(?:RootView|CandidateView)/.test(name))) {
    assert.deepEqual(after.entries(section), original.entries(section), section)
  }
  assert.equal(adaptSsfSkinForIos26(after.toString()), after.toString())
  // A skin without the views gets them.
  assert.equal(IniDocument.parse(adaptSsfSkinForIos26('[General]\nX=1\n')).get('CandidateView', 'BG_COLOR'), '0x00D0D4DB')
})

test('Palm panel copy: skin.json parts are listed by address, package folders stand for their parts', () => {
  const addresses = sxiPartAddresses(templateText)
  assert.ok(addresses.includes('skin.json/default/port_layout/b/full26Pinyin'))
  assert.ok(addresses.includes('skin.json/night/land_layout/c/cand1'))
  assert.ok(addresses.includes('skin.json/default/s_info/ss_1'))
  assert.ok(addresses.some((path) => path.startsWith('skin.json/default/s_info/info/')))
  assert.ok(!addresses.some((path) => /\.(?:ini|css|til|cnd|pop)$/.test(path)), 'no Baidu file names')
  assert.deepEqual(sxiFolderParts('light/skin/'), [['default']])
  assert.deepEqual(sxiFolderParts('dark/skin/land'), [['night', 'land_layout'], ['night', 's_land'], ['night', 'r_land']])
  assert.deepEqual(sxiFolderParts('light/skin/port/res/'), [['default', 's_port'], ['default', 'r_port']])
  assert.equal(sxiFolderParts('light/skin/res/logo/'), undefined)
})

test('Palm panel copy: an address folder copies its whole part, an address its own part, other targets are refused', () => {
  const names = [...template.names(), ...sxiPartAddresses(templateText)]
  const folders = { source: 'skin.json/default/port_layout/', target: 'skin.json/night/land_layout/' }
  const folder = archiveCopyPaths(names, folders.source, folders.target)
  assert.deepEqual(sxiCopyParts(folder, folders), [{ source: ['default', 'port_layout'], target: ['night', 'land_layout'] }])
  const copied = JSON.parse(applySxiCopies(templateText, sxiCopyParts(folder, folders)))
  assert.deepEqual(copied.night.land_layout, templateSkin.default.port_layout)
  const board = archiveCopyPaths(names, 'skin.json/default/port_layout/b/t9Pinyin', 'skin.json/default/land_layout/b/t9Pinyin')
  assert.deepEqual(sxiCopyParts(board, undefined), [{ source: ['default', 'port_layout', 'b', 't9Pinyin'], target: ['default', 'land_layout', 'b', 't9Pinyin'] }])
  assert.throws(() => sxiCopyParts(archiveCopyPaths(names, 'skin.json/default/port_layout/b/t9Pinyin', 'light/skin/port/py_9.ini'), undefined), /不是 skin\.json 中的位置/)
  // Image files have no part of their own.
  assert.deepEqual(sxiCopyParts([{ source: 'light/skin/res/a.png', target: 'light/skin/res/b.png' }], undefined), [])
  // A whole theme folder takes its resource lists along, flat and nested spellings alike.
  const theme = JSON.parse(applySxiCopies(templateText, sxiCopyParts([], { source: 'light/skin/', target: 'dark/skin/' }), 1, 1, { source: 'light/skin/', target: 'dark/skin/' }))
  assert.deepEqual(theme.night.r_info, templateSkin.default.r_info.map((path) => path.replace(/^light\//, 'dark/')))
  assert.deepEqual(theme.night.port_layout, templateSkin.default.port_layout)
})

test('Palm panel copy: scaling covers rects, sizes, positions and insets, nothing else', () => {
  const part = { keys: [{ rect: [[10, 20], [30, 40]], hit_rect: [[0, 0], [50, 60]], values: [4, 'q'] }], board: { size: [720, 400], b: { base_b: 3 } }, list: { pos: [1, 2], size: [3, 4], insets: { left: 2, top: 2, right: 2, bottom: 2 } }, offset: { 1: { p: [4, 6] } } }
  const scaled = scaleSxiPart(part, 2, 0.5)
  assert.deepEqual(scaled.keys[0], { rect: [[20, 10], [60, 20]], hit_rect: [[0, 0], [100, 30]], values: [4, 'q'] })
  assert.deepEqual(scaled.board, { size: [1440, 200], b: { base_b: 3 } })
  assert.deepEqual(scaled.list, { pos: [2, 1], size: [6, 2], insets: { left: 4, top: 1, right: 4, bottom: 1 } })
  assert.deepEqual(scaled.offset, { 1: { p: [8, 3] } })
})

test('Sogou panel copy: scaled looks and a listed resolution', () => {
  const look = '[KeyBg_Default_Latin]\nNORMAL=26key.png,1,97,1,141\nPRESSED=bar.png,0,1,1,0,1,1\n[Keyboard]\nMARGINS=10,20,10,20\nTEXT_SIZE=0.04\n[TextStyle]\nTEXT_SIZE=36\nTEXT_COLOR=0xFF112233\n'
  const scaled = IniDocument.parse(scaleSsfLook(look, 2 / 3, 0.5))
  assert.equal(scaled.get('KeyBg_Default_Latin', 'NORMAL'), '26key.png,1,65,1,71')
  assert.equal(scaled.get('KeyBg_Default_Latin', 'PRESSED'), 'bar.png,0,1,1,0,1,1', 'values that are not a stretch band stay')
  assert.equal(scaled.get('Keyboard', 'MARGINS'), '7,13,7,13')
  assert.equal(scaled.get('Keyboard', 'TEXT_SIZE'), '0.04', 'fractions of the screen width stay')
  assert.equal(scaled.get('TextStyle', 'TEXT_SIZE'), '24')
  assert.equal(scaled.get('TextStyle', 'TEXT_COLOR'), '0xFF112233')
  assert.equal(ssfResolutionFolder('720/status1/bg.png'), 720)
  assert.equal(ssfResolutionFolder('720'), 720)
  assert.equal(ssfResolutionFolder('default/s.wav'), undefined)
  const time = IniDocument.parse(listSsfResolutionInTime('[General]\nSUPPORT_SCREEN=1080\n[1080]\nSTATUS_LIST=status2,status1\n', '1080', '720'))
  assert.equal(time.get('General', 'SUPPORT_SCREEN'), '1080,720')
  assert.equal(time.get('720', 'STATUS_LIST'), 'status2,status1')
  // A folder without its own statuses copies another resolution's.
  assert.equal(IniDocument.parse(listSsfResolutionInTime(time.toString(), '480', '360')).get('360', 'STATUS_LIST'), 'status2,status1')
  assert.equal(listSsfResolutionInTime(time.toString(), '1080', '720'), time.toString())
  assert.equal(IniDocument.parse(listSsfResolutionInTheme('[General]\nsupports-screens=1080\n', '720')).get('General', 'supports-screens'), '1080,720')
  assert.equal(listSsfResolutionInTheme('[General]\nskin_name=x\n', '720'), '[General]\nskin_name=x\n', 'an unlisted skin stays unlisted')
})

test('Palm style replacement: tiles, cloned styles, foreground layers, candidate bar and rects that follow', () => {
  const skin = {
    default: {
      port_layout: {
        b: {
          defaultGlobal: { board: { b: { base_b: 1 }, size: [100, 50] }, cand: { b: { base_b: 1, base_f: [9] }, file: 'cand1' } },
          full26Pinyin: { keys: [{ id: '1', rect: [[0, 0], [50, 50]], hit_rect: [[0, 0], [50, 50]], b: { base_b: 2, base_f: [3] } }, { id: '2', rect: [[50, 0], [50, 50]], b: { base_b: 2 } }] },
        },
        c: { cand1: { fix: {} } },
      },
      r_info: ['light/res/bg.png'],
      s_info: { info: {}, ss_1: { 1: { f: 0, id: 'STYLE1', s_2: { normal: 'bg,1' } }, 2: { f: 0, id: 'STYLE2', s_1: { c_normal: 'FF000000', for_back: true }, s_2: { normal: 'btn,1', hl: 'btn,2' } }, 3: { f: 0, id: 'STYLE3' } } },
    },
  }
  const text = encodeSkinJson(skin)
  const pointer = ['default', 'port_layout', 'b', 'full26Pinyin']
  const panel = JSON.parse(applySxiLayoutImage(text, pointer, { target: 'panel', keys: [], slices: [{ index: 1, source: [0, 0, 100, 50] }], indices: new Map(), panelIndex: 1 }, { name: 'replace_image', resource: 'light/res/replace_image.png' }))
  const board = panel.default.port_layout.b.full26Pinyin.board
  assert.deepEqual(board, { b: { base_b: 4 } })
  assert.deepEqual(panel.default.s_info.ss_1[4], { f: 0, id: 'STYLE4', s_2: { normal: 'replace_image,1', hl: 'replace_image,1' } })
  assert.deepEqual(panel.default.s_info.info.replace_image, [{ alpha: 1, id: 'IMG1', rect1: [[0, 0], [100, 50]], scales: [] }])
  assert.deepEqual(panel.default.r_info, ['light/res/bg.png', 'light/res/replace_image.png'])
  assert.deepEqual(panel.default.port_layout.b.defaultGlobal, skin.default.port_layout.b.defaultGlobal, 'other boards keep the shared background')

  const keys = { target: 'key-highlight', keys: [{ section: 'KEY1', rect: [0, 0, 50, 50] }], slices: [{ index: 1, source: [0, 0, 50, 50] }], indices: new Map([['KEY1', 1]]) }
  const key = JSON.parse(applySxiLayoutImage(text, pointer, keys, { name: 'k' }))
  const [first, second] = key.default.port_layout.b.full26Pinyin.keys
  assert.deepEqual(key.default.s_info.ss_1[first.b.base_b], { f: 0, id: `STYLE${first.b.base_b}`, s_1: { c_normal: 'FF000000', for_back: true }, s_2: { normal: 'btn,1', hl: 'k,1' } }, 'the old style is cloned, only the pressed image changes')
  assert.equal(second.b.base_b, 2)
  assert.deepEqual(key.default.s_info.ss_1[2], skin.default.s_info.ss_1[2])

  const fore = JSON.parse(applySxiLayoutImage(text, pointer, { ...keys, target: 'fore-normal' }, { name: 'f' }))
  const fores = fore.default.port_layout.b.full26Pinyin.keys[0].b.base_f
  assert.deepEqual(fores.slice(0, 1), [3])
  assert.deepEqual(fore.default.s_info.ss_1[fores[1]], { f: 0, id: `STYLE${fores[1]}`, s_2: { normal: 'f,1' } })

  const candidate = JSON.parse(applySxiLayoutImage(text, pointer, { target: 'candidate', keys: [], slices: [{ index: 1, source: [0, 0, 100, 10] }], indices: new Map(), panelIndex: 1 }, { name: 'c' }))
  const cand = candidate.default.port_layout.b.defaultGlobal.cand
  assert.deepEqual(cand.b.base_f, [9])
  assert.deepEqual(candidate.default.s_info.ss_1[cand.b.base_b].s_2, { normal: 'c,1', hl: 'c,1' })

  const follow = JSON.parse(applySxiLayoutImage(text, pointer, keys, { name: 'k', follow: { rects: new Map([['KEY1', [5, 5, 40, 40]]]), size: [90, 45] } }))
  const moved = follow.default.port_layout.b.full26Pinyin
  assert.deepEqual(moved.keys[0].rect, [[5, 5], [40, 40]])
  assert.deepEqual(moved.keys[0].hit_rect, [[5, 5], [40, 40]], 'a touch area equal to the key moves with it')
  assert.deepEqual(moved.board, { b: { base_b: 1 }, size: [90, 45] })
})

test('Sogou style replacement: per-key image sections, kept states, one foreground and the backgrounds', () => {
  const files = unzipSync(ssfFixture())
  const skinText = strFromU8(files['1080/status1/phoneSkin.ini'])
  const keysText = strFromU8(files['1080/status1/keys.ini'])
  const q = ssfKeyBinding('py_26.ini', 'q', false)
  const w = ssfKeyBinding('py_26.ini', 'w', false)

  let skin = IniDocument.parse(skinText)
  let keys = IniDocument.parse(keysText)
  applySsfKeyImage(skin, keys, w, 'key-normal', 'r_1.png')
  assert.equal(skin.get('Key_W', 'BG_IMAGES'), 'SMA_Key_W', 'a key on a shared class gets its own section')
  assert.equal(skin.get('SMA_Key_W', 'NORMAL'), 'r_1.png')
  assert.equal(skin.get('SMA_Key_W', 'PRESSED'), skin.get('KeyBg_Default_Latin', 'PRESSED'))
  assert.deepEqual(skin.entries('KeyBg_Default_Latin'), IniDocument.parse(skinText).entries('KeyBg_Default_Latin'))
  applySsfKeyImage(skin, keys, q, 'key-highlight', 'r_2.png')
  const own = skin.get('Key_Q', 'BG_IMAGES')
  assert.notEqual(own, 'SMA_Key26Bg_Q')
  assert.equal(skin.get(own, 'PRESSED'), 'r_2.png')
  assert.equal(skin.get(own, 'NORMAL'), skin.get('SMA_Key26Bg_Q', 'NORMAL'))

  skin = IniDocument.parse(skinText)
  keys = IniDocument.parse(keysText)
  applySsfKeyImage(skin, keys, q, 'fore-normal', 'f.png')
  const fore = keys.get('Key_Q', 'FG_IMAGES')
  assert.equal(keys.get(fore, 'NORMAL'), 'f.png')
  assert.equal(keys.get(fore, 'PRESSED'), '26q_x.png')
  assert.equal(keys.get('Key_Q', 'FG_RECT'), '0,0,1,1')
  assert.equal(keys.get('Key_Q', 'ANIM_STYLE'), 'Anim_Style_Key_Qwertys', 'the rest of the key stays')
  // A pressed-only picture on a key without a foreground leaves the normal state empty.
  applySsfKeyImage(skin, keys, w, 'fore-highlight', 'p.png')
  assert.equal(keys.get(keys.get('Key_W', 'FG_IMAGES'), 'NORMAL'), 'transparent.png')
  // An icon key keeps its icon in the normal state.
  applySsfKeyImage(skin, keys, ssfKeyBinding('py_26.ini', 'F36', false), 'fore-highlight', 'd.png')
  assert.equal(keys.get(keys.get('Key_Backspace_Qwerty', 'FG_IMAGES'), 'NORMAL'), 'delf_26.png')

  skin = IniDocument.parse(skinText.replace('BG_STYLE=1\nBG_IMAGE=bg.png', 'BG_STYLE=2\nBG_COLOR=0x01D0D4DB'))
  applySsfBackgroundImage(skin, 'panel', 'bg2.png', false)
  assert.equal(skin.get('RootView', 'BG_STYLE'), '1')
  assert.equal(skin.get('RootView', 'BG_IMAGE'), 'bg2.png')
  applySsfBackgroundImage(skin, 'candidate', 'bar2.png', true)
  const bar = skin.get('CandidateView', 'BG_IMAGE')
  assert.notEqual(bar, 'BgCandidate1')
  assert.equal(skin.get(bar, 'NORMAL'), 'bar2.png')
  assert.equal(skin.get('BgCandidate1', 'NORMAL'), 'bar.png,0,1,1,0,1,1')
})
