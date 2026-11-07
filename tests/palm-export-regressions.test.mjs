import test from 'node:test'
import assert from 'node:assert/strict'
import { strToU8, zipSync } from 'fflate'
import { SkinArchive } from '../src/skin.ts'
import { buildSxiZip } from '../src/palm/palm-export.ts'
import { parseSkinJson } from '../src/palm/sxi-json.ts'
import { PalmBoard } from '../src/palm/palm-board.ts'
import { animationsIni } from '../src/palm/sxi-style.ts'
import { IniDocument } from '../src/ini.ts'
import { encodePng } from '../src/ssf/ssf-png.ts'
import { plist, toolbarMenuItem } from '../src/ios-toolbar.ts'

function convert(files) {
  const source = SkinArchive.open(zipSync(Object.fromEntries(Object.entries({
    'Info.txt': 'Name=Issue 30 regression\n', ...files,
  }).map(([path, value]) => [path, typeof value === 'string' ? strToU8(value) : value]))), 'bdi')
  const before = source.toBytes()
  const result = buildSxiZip(source)
  assert.deepEqual(source.toBytes(), before, 'conversion leaves the source archive untouched')
  const archive = SkinArchive.open(result.bytes, 'sxi')
  return { ...result, archive, skin: parseSkinJson(archive.getText('skin.json')) }
}

test('Baidu toolbar preserves its authored region while fitting oversized edge hit boxes (issue 30)', () => {
  const image = encodePng({ width: 80, height: 80, data: new Uint8Array(80 * 80 * 4).fill(255) })
  const files = {}
  for (const theme of ['light', 'dark']) {
    files[`${theme}/skin/res/logo/com.baidu.inputmethod.toolbarMenuItems.plist`] = plist([
      toolbarMenuItem('17', '键盘类型', 'toolbar', '1.0/keyboard', '1.0/keyboard'),
    ])
    files[`${theme}/skin/res/logo/1.0/keyboard_iphone@3x.png`] = image
    for (const orientation of ['port', 'land']) {
      files[`${theme}/skin/${orientation}/gen.ini`] = '[PANEL]\nSIZE=1125,592\n[CAND]\nLAYOUT_NAME=cand1\nVIEW_RECT=0,0,1125,124\n'
      files[`${theme}/skin/${orientation}/cand1.cnd`] = [
        '[CAND]', 'BACK_STYLE=1101',
        '[ICON1]', 'FORE_STYLE=1301', 'SIZE=229,186', 'ANCHOR_TYPE=1', 'POS=0,20', 'KEY=F31', 'PERSIST=1', 'FIX_SIZE=50,52',
        '[ICON2]', 'SIZE=229,186', 'ANCHOR_TYPE=3', 'POS=-229,0', 'KEY=F8', 'PERSIST=1', 'FIX_SIZE=50,52',
        '[ICON3]', 'SIZE=105,104', 'ANCHOR_TYPE=3', 'POS=-105,20', 'KEY=F9', 'PERSIST=2',
        '[ICON4]', 'SIZE=780,58', 'ANCHOR_TYPE=2', 'POS=-390,43', 'KEY=F14', 'PERSIST=1',
      ].join('\n')
    }
  }
  const { skin, archive } = convert(files)
  for (const theme of ['default', 'night']) for (const orientation of ['port', 'land']) {
    const board = new PalmBoard(skin, theme, orientation, 'defaultGlobal')
    const icons = board.icons()
    assert.equal(icons.length, 4)
    for (const { rect, fixed } of icons) {
      assert.ok(rect.y >= 0 && rect.y + rect.height <= 124)
      if (fixed) assert.ok(fixed[1] <= rect.height && fixed[0] <= rect.width)
    }
    assert.deepEqual(icons[2].rect, { x: 1020, y: 20, width: 105, height: 104 }, 'valid icon placement is preserved')
    assert.deepEqual(icons[3].rect, { x: 172.5, y: 33, width: 780, height: 58 }, 'F14 retains its authored size and centres in the Palm bar, independent of artwork size')
    assert.deepEqual(skin[theme][`${orientation}_layout`].c.cand1.icon_list.map((icon) => icon.keep), [1, 1, 2, 1])
  }
  assert.deepEqual(archive.getBytes('light/skin/res/logo/1.0/keyboard_iphone@3x.png'), image)
})

test('valid anchored icons and layouts without candidate geometry are preserved', () => {
  const icons = '[CAND]\n[ICON1]\nSIZE=40,40\nANCHOR_TYPE=9\nPOS=-40,-40\nFIX_SIZE=10,10\nKEY=F8\n[ICON2]\nSIZE=100,40\nANCHOR_TYPE=2\nPOS=-50,18\nKEY=F14\n'
  for (const rect of ['', 'VIEW_RECT=0,0,500,120\n']) {
    const { skin } = convert({
      'light/port/gen.ini': `[PANEL]\nSIZE=500,300\n[CAND]\nLAYOUT_NAME=cand1\n${rect}`,
      'light/port/cand1.cnd': icons,
    })
    const icon = skin.default.port_layout.c.cand1.icon_list[0]
    assert.deepEqual(icon.s, [40, 40])
    assert.deepEqual(icon.p, [-40, -40])
    assert.deepEqual(icon.f_size, [10, 10])
    const toolbar = skin.default.port_layout.c.cand1.icon_list[1]
    assert.deepEqual(toolbar.s, [100, 40])
    assert.deepEqual(toolbar.p, [-50, 18], "a toolbar without oversized hit boxes keeps its authored placement")
  }
})

test('panel show particles keep their binding and scalar parameter ranges (issue 30)', () => {
  const { skin, warnings } = convert({
    'dark/port/gen.ini': '[PANEL]\nSIZE=1125,592\n',
    'dark/port/py_26.ini': '[PANEL]\nANIM_STYLE=813\nANIM_LEVEL=1\n',
    'dark/port/en_26.ini': '[PANEL]\nANIM_STYLE=813\nPANEL_ANIM_STYLE=814\n',
    'dark/port/res/default.css': '[STYLE813]\nSHOW_ANIM=1101\n',
    'dark/port/res/anim.ini': '[ANIM1101]\nCATEGORY=3\nTYPE=1\nPARTICLE_IMAGE=1523,1521\nLIFE=600000,600000\nSCALE_SPEED=0\nALPHA_SPEED=50\nVELOCITY=15,20\n',
  })
  const night = skin.night
  assert.equal(night.port_layout.b.full26Pinyin.board.b.base_pa, 813)
  assert.equal(night.port_layout.b.full26EnglishLower.board.b.base_pa, 814, 'explicit panel binding takes precedence')
  const animation = night.s_port.ss_2[String(night.s_port.ss_1['813'].s_5['3'])]
  assert.deepEqual(animation.a4.i_p, [1523, 1521])
  assert.deepEqual(animation.a4.s_scale, [0, 0])
  assert.deepEqual(animation.a4.s_alpha, [50, 50])
  assert.deepEqual(animation.a4.velocity, [15, 20])
  assert.deepEqual(warnings, [], 'scalar ranges do not produce spurious loss warnings')
  const ini = IniDocument.parse(animationsIni(night.s_port.ss_2).toString())
  assert.equal(ini.get('ANIM1101', 'ALPHA_SPEED'), '50,50')
})
