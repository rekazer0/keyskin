import { test } from 'node:test'
import assert from 'node:assert/strict'
import { strToU8, zipSync } from 'fflate'
import { SkinArchive } from '../src/skin.ts'
import { IniDocument } from '../src/ini.ts'
import { completeBdsPackage } from '../src/bds-package.ts'

const noAtlas = () => { throw new Error('no atlas needed') }

test('BDS 压缩 BDA 样式编号，同步横竖屏、候选栏、气泡与粒子引用，保留状态和动画编号', async () => {
  const css = '[GLOBAL]\nSTYLE_NUM=2\n[STYLE1010001]\nNM_IMG=key,1\nPRESS_ANIM=100\n[STYLE3010002]\nFONT_SIZE=28\n'
  const layout = '[PANEL]\nBACK_STYLE=1010001\n[KEY1]\nFORE_STYLE=3010002,0\nANIM_STYLE=1010001\nSTAT_STYLE=S17_1\n'
  const input = zipSync(Object.fromEntries(Object.entries({
    'Info.txt': 'Name=中文皮肤\nSupportDarkMode=0\n',
    'light/res/default.css': css,
    'light/port/res/default.css': css,
    'light/land/res/default.css': css,
    'light/port/py_26.ini': layout,
    'light/land/py_26.ini': layout,
    'light/port/cand1.cnd': '[CAND]\nFIRST_FORE=3010002\n',
    'light/port/hint1.pop': '[HINT]\nBACK_STYLE=1010001\n',
    'light/port/anim.ini': '[ANIM100]\nPARTICLE_IMAGE=1010001\n',
  }).map(([path, text]) => [path, strToU8(text)])))
  const bytes = await completeBdsPackage(input, noAtlas)
  const archive = SkinArchive.open(bytes, 'bds')
  for (const orientation of ['port', 'land']) {
    const document = IniDocument.parse(archive.getText(`light/skin/${orientation}/py_26.ini`))
    assert.equal(document.get('PANEL', 'BACK_STYLE'), '1')
    assert.equal(document.get('KEY1', 'FORE_STYLE'), '2,0')
    assert.equal(document.get('KEY1', 'ANIM_STYLE'), '1')
    assert.equal(document.get('KEY1', 'STAT_STYLE'), 'S17_1')
    const styles = IniDocument.parse(archive.getText(`light/skin/${orientation}/res/default.css`))
    assert.equal(styles.get('GLOBAL', 'STYLE_NUM'), '2')
    assert.equal(styles.get('STYLE1', 'PRESS_ANIM'), '100')
    assert.equal(styles.get('STYLE1', 'NM_IMG'), 'key,1')
  }
  assert.equal(IniDocument.parse(archive.getText('light/skin/port/cand1.cnd')).get('CAND', 'FIRST_FORE'), '2')
  assert.equal(IniDocument.parse(archive.getText('light/skin/port/hint1.pop')).get('HINT', 'BACK_STYLE'), '1')
  assert.equal(IniDocument.parse(archive.getText('light/skin/port/anim.ini')).get('ANIM100', 'PARTICLE_IMAGE'), '1')
  assert.equal(archive.infoField('SupportDarkMode'), '1')
  assert.deepEqual(await completeBdsPackage(bytes, noAtlas), bytes)
})

test('平铺 BDS 修正双主题声明，普通样式编号不重排并修复 STYLE_NUM', async () => {
  const archive = SkinArchive.open(await completeBdsPackage(zipSync({
    'Info.txt': strToU8('Name=test\r\nSupportDarkMode=1\r\n'),
    'res/default.css': strToU8('[GLOBAL]\nSTYLE_NUM=1\n[STYLE9]\nNM_COLOR=FFFFFFFF\n'),
  }), noAtlas), 'bds')
  assert.equal(archive.infoField('SupportDarkMode'), '0')
  assert.equal(IniDocument.parse(archive.getText('light/skin/res/default.css')).get('GLOBAL', 'STYLE_NUM'), '9')
})
