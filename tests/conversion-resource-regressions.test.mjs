import { test } from 'node:test'
import assert from 'node:assert/strict'
import { strToU8, zipSync } from 'fflate'
import { IniDocument } from '../src/ini.ts'
import { SkinArchive } from '../src/skin.ts'
import { BaiduSsfMotion } from '../src/ssf/baidu-anim-to-ssf.ts'
import { convertBaiduToSsf } from '../src/ssf/baidu-to-ssf.ts'
import { SsfPackage } from '../src/ssf/ssf-package.ts'
import { buildSxiZip } from '../src/palm/palm-export.ts'

const archive = files => SkinArchive.open(zipSync(Object.fromEntries(Object.entries(files).map(([path, text]) => [path, strToU8(text)]))))
function motion(anim, layout = 'BACK_ANIM_STYLE=7') {
  const output = IniDocument.parse('')
  const warnings = []
  const writer = new BaiduSsfMotion(IniDocument.parse(anim), IniDocument.parse('[STYLE7]\nPRESS_ANIM=1\n'), warnings, 1,
    () => ({ file: 'particle.png', width: 10, height: 10 }), output)
  const id = writer.press(IniDocument.parse(`[KEY1]\n${layout}\n`), 'KEY1', { width: 100, height: 50 }, { width: 500, height: 300 })
  return { output, warnings, id }
}

test('reverse animation includes the return pass in Sogou repeat counts', () => {
  const { output } = motion('[ANIM1]\nTYPE=4\nFROM=100,100\nTO=80,80\nDURATION=200\nREPEAT_CNT=1\nREPEAT_MODE=1\n')
  const effect = output.sections().find(section => output.get(section, 'DURATION') === '200')
  assert.equal(output.get(effect, 'REPEAT_COUNT'), '1')
  assert.equal(output.get(effect, 'REPEAT_MODE'), '2')
})

test('Palm SOURCE_FILE frames are never fabricated as opacity animations', () => {
  const { output, warnings, id } = motion('[ANIM1]\nCATEGORY=2\nSOURCE_FILE=spark.gif\n')
  assert.equal(id, undefined)
  assert.equal(output.sections().length, 0)
  assert.ok(warnings.some(warning => warning.includes('spark.gif')))
})

test('whole-key animation emits each particle once, not once per visual layer', () => {
  const { output } = motion('[ANIM1]\nCATEGORY=3\nPARTICLE_IMAGE=9\nTOTAL_NUMBER=2\nLIFE=200,200\n', 'ANIM_STYLE=7')
  assert.equal(output.sections().filter(section => output.get(section, 'IMG')).length, 2)
})

test('partial orientation animation overrides preserve shared fields and other definitions', async () => {
  const source = archive({
    'Info.txt': 'Name=motion\n',
    'res/default.css': '[STYLE1]\nNM_COLOR=FF123456\n[STYLE7]\nPRESS_ANIM=1\n[STYLE8]\nPRESS_ANIM=2\n',
    'res/anim.ini': '[ANIM1]\nTYPE=4\nFROM=100,100\nTO=80,80\nDURATION=240\n[ANIM2]\nTYPE=1\nFROM=0\nTO=90\nDURATION=320\n',
    'port/res/anim.ini': '[ANIM1]\nREPEAT_CNT=inf\n',
    'port/gen.ini': '[PANEL]\nSIZE=500,300\nBACK_STYLE=1\n',
    'port/py_26.ini': '[PANEL]\nSIZE=500,300\n[KEY1]\nCENTER=q\nBACK_STYLE=1\nBACK_ANIM_STYLE=7\nVIEW_RECT=0,0,100,50\n[KEY2]\nCENTER=w\nBACK_STYLE=1\nBACK_ANIM_STYLE=8\nVIEW_RECT=100,0,100,50\n',
  })
  const result = await convertBaiduToSsf(source)
  const pkg = await SsfPackage.open(result.bytes)
  const anim = pkg.ini(pkg.path('light', 'anim.ini'))
  assert.ok(anim.sections().some(section => anim.get(section, 'DURATION') === '240' && anim.get(section, 'REPEAT_COUNT') === '-1'))
  assert.ok(anim.sections().some(section => anim.get(section, 'DURATION') === '320'))
  assert.ok(pkg.keys('light').get('Key_W', 'ANIM_STYLE'))
})

test('Palm direction-specific TIL wins over the shared same-name atlas map', () => {
  const source = archive({
    'Info.txt': 'Name=tiles\n',
    'res/default.css': '[STYLE1]\nNM_IMG=a,1\n',
    'res/a.til': '[IMG1]\nSOURCE_RECT=0,0,10,10\n',
    'port/res/a.til': '[IMG1]\nSOURCE_RECT=2,3,4,5\n',
    'port/gen.ini': '[PANEL]\nSIZE=500,300\nBACK_STYLE=1\n',
  })
  const palm = SkinArchive.open(buildSxiZip(source).bytes, 'sxi')
  const skin = JSON.parse(palm.getText('skin.json')).default
  assert.deepEqual(skin.s_info.info.a[0].rect1, [[0, 0], [10, 10]])
  assert.deepEqual(skin.s_port.info.a[0].rect1, [[2, 3], [4, 5]])
})
