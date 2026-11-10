import test from 'node:test'
import assert from 'node:assert/strict'
import { strToU8, zipSync } from 'fflate'
import { SkinArchive } from '../src/skin.ts'
import { buildSxiZip } from '../src/palm/palm-export.ts'
import { parseSkinJson } from '../src/palm/sxi-json.ts'
import { PalmBoard } from '../src/palm/palm-board.ts'
import { animationsIni } from '../src/palm/sxi-style.ts'
import { IniDocument } from '../src/ini.ts'
import { decodePng, encodePng } from '../src/ssf/ssf-png.ts'
import { plist, toolbarMenuItem } from '../src/ios-toolbar.ts'

function convert(files, format = 'bdi') {
  const source = SkinArchive.open(zipSync(Object.fromEntries(Object.entries({
    'Info.txt': 'Name=Issue 30 regression\n', ...files,
  }).map(([path, value]) => [path, typeof value === 'string' ? strToU8(value) : value]))), format)
  const before = source.toBytes()
  const result = buildSxiZip(source)
  assert.deepEqual(source.toBytes(), before, 'conversion leaves the source archive untouched')
  const archive = SkinArchive.open(result.bytes, 'sxi')
  return { ...result, archive, skin: parseSkinJson(archive.getText('skin.json')) }
}

test('English enter fills the hidden redundant suggestion key and keeps its language-key gesture', () => {
  const files = {}
  const image = encodePng({ width: 8, height: 8, data: new Uint8Array(8 * 8 * 4).fill(255) })
  const layout = [
    '[KEY1]', 'VIEW_RECT=0,0,60,20', 'CENTER=F15', 'UP=F25',
    '[KEY2]', 'VIEW_RECT=60,0,10,20', 'CENTER=F25',
    '[KEY3]', 'VIEW_RECT=70,0,30,20', 'TOUCH_RECT=70,0,30,20', 'CENTER=F39', 'UP=F76', 'BACK_STYLE=1',
    '[KEY4]', 'VIEW_RECT=68,0,34,22', 'BACK_STYLE=1',
  ].join('\n')
  for (const theme of ['light', 'dark']) {
    files[`${theme}/skin/res/default.css`] = '[STYLE1]\nNM_IMG=key,1\n'
    files[`${theme}/skin/res/key.png`] = image
    files[`${theme}/skin/res/key.til`] = '[IMG1]\nSOURCE_RECT=0,0,8,8\nINNER_RECT=2,2,4,4\n'
    for (const orientation of ['port', 'land']) {
      files[`${theme}/skin/${orientation}/gen.ini`] = '[PANEL]\nSIZE=100,20\n'
      for (const name of ['en_26', 'en_26s', 'py_26']) files[`${theme}/skin/${orientation}/${name}.ini`] = layout
    }
  }
  const { skin, archive } = convert(files, 'bds')
  for (const theme of ['default', 'night']) for (const orientation of ['port', 'land']) {
    const boards = skin[theme][`${orientation}_layout`].b
    for (const type of ['full26EnglishLower', 'full26EnglishUpper']) {
      const keys = boards[type].keys
      assert.equal(keys.length, 3)
      const enter = keys.find((key) => key.id === '3')
      assert.deepEqual(enter.rect, [[60, 0], [40, 20]])
      assert.deepEqual(enter.hit_rect, [[60, 0], [40, 20]])
      assert.deepEqual(enter.values, [0, 'startClipboardBoard', 4, 'enter'])
      assert.deepEqual(keys.find((key) => key.id === '1').values, [0, 'toggleLettersSuggestions', 4, 'switchToChinese'])
      assert.deepEqual(keys.find((key) => key.id === '4').rect, [[58, 0], [44, 22]])
      const [name] = skin[theme].s_info.ss_1[enter.b.base_b].s_2.normal.split(',')
      const png = decodePng(archive.getBytes(`${theme === 'night' ? 'dark' : 'light'}/skin/res/${name}.png`))
      assert.deepEqual([png.width, png.height], [40, 20], 'background is baked after the key grows')
    }
    assert.deepEqual(boards.full26Pinyin.keys.find((key) => key.id === '3').rect, [[70, 0], [30, 20]])
  }
  const noAlternative = convert({
    'light/skin/port/gen.ini': '[PANEL]\nSIZE=100,20\n',
    'light/skin/port/en_26.ini': layout.replace('UP=F25\n', ''),
  }, 'bds').skin.default.port_layout.b.full26EnglishLower
  assert.equal(noAlternative.keys.length, 4, 'a unique suggestion action is never removed')
  for (const extra of ['UP=F76', 'STAT_STYLE=S4_1\n[TIP1]\nCENTER=F76']) {
    const withUniqueAction = convert({
      'light/skin/port/gen.ini': '[PANEL]\nSIZE=100,20\n',
      'light/skin/port/en_26.ini': layout.replace('CENTER=F25\n', `CENTER=F25\n${extra}\n`),
    }, 'bds').skin.default.port_layout.b.full26EnglishLower
    assert.equal(withUniqueAction.keys.length, 4, 'other gestures and conditional actions are never discarded')
  }
})

test('custom panel jumps report the Android limitation once while preserving their source actions', () => {
  const files = {}
  for (const theme of ['light', 'dark']) for (const orientation of ['port', 'land']) {
    files[`${theme}/skin/${orientation}/gen.ini`] = '[PANEL]\nSIZE=100,100\n'
    files[`${theme}/skin/${orientation}/py_9.ini`] = '[KEY1]\nVIEW_RECT=0,0,20,20\nCENTER=y\nDOWN=Z+9tool4\nSTAT_STYLE=S4_1\n[TIP1]\nDOWN=Z+9tool4\n'
    files[`${theme}/skin/${orientation}/9tool4.ini`] = '[KEY1]\nVIEW_RECT=0,0,20,20\nCENTER=1\n'
  }
  const { skin, warnings } = convert(files, 'bds')
  assert.equal(warnings.filter((warning) => warning.includes('Z+')).length, 1)
  assert.match(warnings[0], /手心 Android.*无法在 Android 调起/)
  assert.deepEqual(skin.default.port_layout.b.t9Pinyin.keys[0].values, [1, 'Z+9tool4', 4, 'y'])
  assert.ok(skin.default.port_layout.b['9tool4'], 'unsupported Android routing does not destroy the authored panel')
})

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
        '[CAND]', 'BACK_STYLE=1101', 'CELL_W=62',
        '[ICON1]', 'FORE_STYLE=1301', 'SIZE=229,186', 'ANCHOR_TYPE=1', 'POS=0,20', 'KEY=F31', 'PERSIST=1', 'FIX_SIZE=50,52',
        '[ICON2]', 'SIZE=229,186', 'ANCHOR_TYPE=3', 'POS=-229,0', 'KEY=F8', 'PERSIST=1', 'FIX_SIZE=50,52',
        '[ICON3]', 'SIZE=105,104', 'ANCHOR_TYPE=3', 'POS=-105,20', 'KEY=F9', 'PERSIST=2',
        '[ICON4]', 'SIZE=780,58', 'ANCHOR_TYPE=2', 'POS=-390,43', 'KEY=F14', 'PERSIST=1',
      ].join('\n')
    }
  }
  const { skin, archive, warnings } = convert(files)
  for (const theme of ['default', 'night']) for (const orientation of ['port', 'land']) {
    const board = new PalmBoard(skin, theme, orientation, 'defaultGlobal')
    const icons = board.icons()
    assert.equal(icons.length, 4)
    for (const { rect, fixed } of icons) {
      assert.ok(rect.y >= 0 && rect.y + rect.height <= 124)
      if (fixed) assert.ok(fixed[1] <= rect.height && fixed[0] <= rect.width)
    }
    const models = skin[theme][`${orientation}_layout`].c.cand1.icon_list
    assert.deepEqual(models.map((icon) => icon.k), ['logoMenu', 'switchContainer', 'hideBoard', 'moreCandidates'])
    const byAction = Object.fromEntries(models.map((icon, index) => [icon.k, icons[index]]))
    assert.deepEqual(byAction.moreCandidates.rect, { x: 1020, y: 20, width: 105, height: 104 }, 'valid icon placement is preserved')
    assert.deepEqual(byAction.switchContainer.rect, { x: 172.5, y: 33, width: 780, height: 58 }, 'F14 retains its authored size and centres in the Palm bar, independent of artwork size')
    assert.equal(byAction.logoMenu.rect.width, 129, 'logo width includes room for the CELL_W/2 Android adds to each native slot')
    assert.equal(byAction.hideBoard.rect.width, 129, 'hide key fits the last native toolbar slot')
    assert.ok(7 * (byAction.logoMenu.rect.width + 62 / 2) <= 1125, 'native slots cannot crowd out the final function')
    assert.deepEqual(models.map((icon) => icon.keep), [1, 1, 1, 2])
  }
  // Android ignores F14's height, so all device images must fit its authored 58px region themselves.
  for (const suffix of ['_ipad.png', '_ipad@2x.png', '_iphone@3x.png']) {
    const bytes = archive.getBytes(`light/skin/res/logo/1.0/keyboard${suffix}`)
    assert.ok(bytes, `图标补齐了 ${suffix}`)
    const size = decodePng(bytes)
    assert.deepEqual([size.width, size.height], [58, 58])
  }
})

test('BDS atlas becomes Palm menu images in both themes without moving or resizing the toolbar', () => {
  const tiles = [26, 27, 29, 31, 25, 50]
  const files = {}
  for (const [theme, green] of [['light', 30], ['dark', 90]]) {
    const data = new Uint8Array(78 * 78 * tiles.length * 4)
    tiles.forEach((tile, index) => {
      for (let pixel = index * 78 * 78; pixel < (index + 1) * 78 * 78; pixel++) data.set([tile, green, 0, 255], pixel * 4)
    })
    files[`${theme}/res/logo/pop_menu_icons.png`] = encodePng({ width: 78, height: 78 * tiles.length, data })
    // A rectangular icon must retain its aspect ratio inside Palm's square device images.
    files[`${theme}/res/logo/pop_menu_icons.til`] = tiles.map((tile, index) => `[IMG${tile}]\nSOURCE_RECT=0,${index * 78},${tile === 27 ? 39 : 78},78\n`).join('')
    for (const [orientation, width, height, side] of [['port', 1080, 120, 154], ['land', 1920, 122, 274]]) {
      files[`${theme}/${orientation}/gen.ini`] = `[PANEL]\nSIZE=${width},600\n[CAND]\nLAYOUT_NAME=cand1\nVIEW_RECT=0,0,${width},${height}\n`
      files[`${theme}/${orientation}/cand1.cnd`] = [
        '[CAND]', '[ICON1]', `SIZE=${side},${height}`, 'POS=0,0', 'KEY=F31', 'PERSIST=1',
        '[ICON2]', `SIZE=${width - side * 2},${height}`, `POS=${-(width - side * 2) / 2},${-height / 2}`, 'ANCHOR_TYPE=5', 'KEY=F14', 'PERSIST=1',
        '[ICON3]', `SIZE=${side},${height}`, `POS=${-side},0`, 'ANCHOR_TYPE=3', 'KEY=F8', 'PERSIST=1',
      ].join('\n')
    }
  }
  const { skin, archive, warnings } = convert(files, 'bds')
  assert.deepEqual(warnings, [])
  for (const [theme, directory, green] of [['default', 'light', 30], ['night', 'dark', 90]]) {
    const [menu] = skin[theme].menu
    assert.deepEqual(menu.map(({ Name }) => Name), ['19', '17', '23', '26', '18', '35'])
    // Palm's toolbar looks its buttons up by these function names (Baidu iOS uses the same ones).
    const palmNames = { 26: 'Emoji', 27: 'KBSwitch', 29: 'Voice', 31: 'Search', 25: 'MoveCursor', 50: 'pasteBoard' }
    assert.deepEqual(menu.map(({ Images }) => Images.Normal.Normal), tiles.map((tile) => `1.0/toolbarMenuItem_${palmNames[tile]}_Normal`))
    assert.equal(menu.length, tiles.length)
    for (const [index, entry] of menu.entries()) {
      assert.equal(entry.Position, 'toolbar')
      for (const suffix of ['_iphone@3x', '_ipad', '_ipad@2x']) {
        const image = decodePng(archive.getBytes(`${directory}/skin/res/logo/${entry.Images.Normal.Normal}${suffix}.png`))
        assert.deepEqual([image.width, image.height], [88, 88])
        assert.deepEqual([...image.data.slice((44 * 88 + 44) * 4, (44 * 88 + 44) * 4 + 4)], [tiles[index], green, 0, 255])
        if (tiles[index] === 27) {
          const painted = Array.from({ length: 88 }, (_, x) => image.data[(44 * 88 + x) * 4 + 3]).filter(Boolean).length
          assert.equal(painted, 44, 'rectangular icon stays centred and keeps its 1:2 aspect ratio')
          assert.equal(image.data[(44 * 88 + 21) * 4 + 3], 0)
          assert.equal(image.data[(44 * 88 + 66) * 4 + 3], 0)
        }
      }
    }
    assert.ok(archive.getBytes(`${directory}/skin/res/logo/pop_menu_icons.png`), 'the source atlas is kept')
    for (const [orientation, width, height, side] of [['port', 1080, 120, 154], ['land', 1920, 122, 274]]) {
      const icons = new PalmBoard(skin, theme, orientation, 'defaultGlobal').icons()
      assert.deepEqual(icons.map(({ rect }) => rect), [
        { x: 0, y: 0, width: side, height },
        { x: side, y: 0, width: width - side * 2, height },
        { x: width - side, y: 0, width: side, height },
      ])
    }
  }
})

test('valid anchored icons and layouts without candidate geometry are preserved', () => {
  const icons = '[CAND]\n[ICON1]\nSIZE=40,40\nANCHOR_TYPE=9\nPOS=-40,-40\nFIX_SIZE=10,10\nKEY=F8\n[ICON2]\nSIZE=100,40\nANCHOR_TYPE=2\nPOS=-50,18\nKEY=F14\n'
  for (const rect of ['', 'VIEW_RECT=0,0,500,120\n']) {
    const { skin } = convert({
      'light/port/gen.ini': `[PANEL]\nSIZE=500,300\n[CAND]\nLAYOUT_NAME=cand1\n${rect}`,
      'light/port/cand1.cnd': icons,
    })
    const models = skin.default.port_layout.c.cand1.icon_list
    const icon = models.find((icon) => icon.k === 'hideBoard')
    assert.deepEqual(icon.s, [40, 40])
    assert.deepEqual(icon.p, [-40, -40])
    assert.deepEqual(icon.f_size, [10, 10])
    const toolbar = models.find((icon) => icon.k === 'switchContainer')
    assert.deepEqual(toolbar.s, [100, 40])
    assert.deepEqual(toolbar.p, [-50, 18], "a toolbar without oversized hit boxes keeps its authored placement")
  }
})

test('Baidu candidate words stay centred without changing horizontal padding or the separate input row', () => {
  const files = {}
  for (const theme of ['light', 'dark']) for (const orientation of ['port', 'land']) {
    files[`${theme}/skin/${orientation}/gen.ini`] = '[PANEL]\nSIZE=1125,592\n[CAND]\nLAYOUT_NAME=cand1\nVIEW_RECT=0,0,1125,151\nPADDING=0,45,0,0\n'
    files[`${theme}/skin/${orientation}/py_9.ini`] = '[INPUT]\n[CAND]\n[KEY1]\nVIEW_RECT=0,0,100,100\nCENTER=q\n'
    files[`${theme}/skin/${orientation}/cand1.cnd`] = '[CAND]\nPADDING=8,25,105,4\nFORE_STYLE=1\nFIRST_FORE=2\nFIRST_GAP=4\nCELL_W=62\n[ICON1]\nSIZE=105,89\nANCHOR_TYPE=3\nPOS=-105,17\nKEY=F9\nPERSIST=2\n'
  }
  const { skin } = convert(files, 'bds')
  for (const theme of ['default', 'night']) for (const orientation of ['port', 'land']) {
    const layout = skin[theme][`${orientation}_layout`]
    const cand = layout.c.cand1
    assert.deepEqual(cand.insets, { left: 8, top: 0, right: 105, bottom: 0 })
    assert.equal(layout.b.defaultGlobal.cand.insets.top, 45, 'the input-code row is kept')
    assert.deepEqual([cand.i_cand, cand.i_f_f, cand.f_gap, cand.gap], [1, 2, 4, 62])
    const board = new PalmBoard(skin, theme, orientation, 't9Pinyin')
    assert.deepEqual(board.candidateSize, { width: 1125, height: 106 })
    assert.deepEqual(board.icons(undefined, true)[0].rect, { x: 1020, y: 17, width: 105, height: 89 })
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

test('off-screen native toolbar remains hidden behind a custom candidate row', () => {
  const { skin } = convert({
    'light/skin/port/gen.ini': '[PANEL]\nSIZE=1080,525\n[CAND]\nLAYOUT_NAME=cand1\nVIEW_RECT=0,0,1080,111\n',
    'light/skin/port/cand1.cnd': '[CAND]\n[ICON1]\nSIZE=700,60\nANCHOR_TYPE=5\nPOS=-1500,-30\nKEY=F14\nPERSIST=1\n',
  })
  assert.deepEqual(skin.default.port_layout.c.cand1.icon_list[0].p, [-1500, -30])
})

test('orientation images and styles remain paired in Palm Android global lookups', () => {
  const png = encodePng({ width: 20, height: 20, data: new Uint8Array(20 * 20 * 4).fill(255) })
  const { skin, archive } = convert({
    'light/skin/res/bj.png': png,
    'light/skin/res/bj.til': '[IMG1]\nSOURCE_RECT=0,0,10,10\n',
    'light/skin/res/default.css': '[STYLE1]\nNM_IMG=bj,1\n',
    'light/skin/land/res/bj.png': png,
    'light/skin/land/res/bj.til': '[IMG1]\nSOURCE_RECT=0,0,20,20\n',
    'light/skin/port/gen.ini': '[PANEL]\nSIZE=100,100\nBACK_STYLE=1\n',
    'light/skin/land/gen.ini': '[PANEL]\nSIZE=200,100\nBACK_STYLE=1\n',
  })
  const theme = skin.default
  assert.equal(theme.port_layout.b.defaultGlobal.board.b.base_b, 1)
  const land = theme.land_layout.b.defaultGlobal.board.b.base_b
  assert.notEqual(land, 1)
  assert.equal(theme.s_info.ss_1[land].s_2.normal, 'land_bj,1')
  assert.ok(archive.getBytes('light/skin/land/res/land_bj.png'))
  assert.deepEqual(theme.s_info.info.land_bj[0].rect1, [[0, 0], [20, 20]])
  assert.deepEqual(theme.s_info.info.bj[0].rect1, [[0, 0], [10, 10]])
  assert.ok(!theme.r_land.includes('light/skin/land/res/bj.png'))
  assert.equal(theme.s_land.info.bj, undefined, 'landscape tiles cannot override the portrait image')
})

test('unsupported custom candidate switches report the native-toolbar fallback once', () => {
  const { warnings } = convert({
    'light/skin/port/gen.ini': '[CAND]\nLAYOUT_NAME=cand1\nVIEW_RECT=0,0,1080,111\n',
    'light/skin/port/cand1.cnd': '[CAND]\n[ICON1]\nKEY=F16\nSIZE=214,91\n[ICON2]\nKEY=F6\nSIZE=214,91\n',
    'light/skin/land/gen.ini': '[CAND]\nLAYOUT_NAME=cand1\nVIEW_RECT=0,0,1920,111\n',
    'light/skin/land/cand1.cnd': '[CAND]\n[ICON1]\nKEY=F15\nSIZE=214,91\n',
  })
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /手心原生工具栏/)
})

test('orientation resource separation keeps a fallback shared table and avoids existing basenames', () => {
  const png = encodePng({ width: 2, height: 2, data: new Uint8Array(16).fill(255) })
  const { skin, archive } = convert({
    'light/skin/res/port_bj.png': png,
    'light/skin/port/res/bj.png': png,
    'light/skin/port/res/bj.til': '[IMG1]\nSOURCE_RECT=0,0,2,2\n',
    'light/skin/port/res/default.css': '[STYLE1]\nNM_IMG=bj,1\n',
    'light/skin/port/gen.ini': '[PANEL]\nSIZE=100,100\nBACK_STYLE=1\n',
    'light/skin/land/gen.ini': '[PANEL]\nSIZE=200,100\nBACK_STYLE=1\n',
  })
  const theme = skin.default
  const port = theme.port_layout.b.defaultGlobal.board.b.base_b
  assert.equal(theme.s_info.ss_1[port].s_2.normal, '_port_bj,1')
  assert.ok(archive.getBytes('light/skin/port/res/_port_bj.png'))
  assert.ok(theme.s_info.info.bj, 'fallback shared tiles remain intact')
  assert.ok(theme.s_info.info._port_bj)
  assert.equal(theme.s_info.ss_1[1].s_2.normal, 'bj,1', 'fallback shared styles remain intact')
})
