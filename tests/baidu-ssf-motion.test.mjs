import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IniDocument } from '../src/ini.ts'
import { BaiduSsfMotion } from '../src/ssf/baidu-anim-to-ssf.ts'

function convert(anim, style = 'PRESS_ANIM=1') {
  const warnings = []
  const output = IniDocument.parse('')
  const motion = new BaiduSsfMotion(IniDocument.parse(anim), IniDocument.parse(`[STYLE7]\n${style}\n`), warnings, 2,
    () => ({ file: 'particle.png', width: 20, height: 20 }), output)
  const id = motion.press(IniDocument.parse('[KEY1]\nBACK_ANIM_STYLE=7\n'), 'KEY1', { width: 100, height: 50 }, { width: 500, height: 300 })
  return { output, warnings, id }
}

test('Baidu basic and sequential group effects become Sogou keyframe tracks', () => {
  const { output, warnings, id } = convert('[ANIM1]\nBUILD_LIST=2,3\nBUILD_METHOD=1\n[ANIM2]\nTYPE=4\nFROM=100,100\nTO=80,90\nDURATION=120\nPIVOT=50,50\n[ANIM3]\nTYPE=2\nFROM_PX=0,0\nTO_PX=25,-30\nDURATION=200\n')
  assert.ok(id)
  assert.deepEqual(warnings, [])
  assert.ok(output.sections().some(s => output.get(s, 'ANIM_SET') && output.get(s, 'PLAY_METHOD') === '1'))
  assert.ok(output.sections().some(s => output.get(s, 'VALUE') === '1,0.8'))
  assert.ok(output.sections().some(s => output.get(s, 'VALUE') === '0,0.05'))
  assert.ok(output.sections().some(s => output.get(s, 'VALUE') === '0,-0.1'))
  assert.ok(output.sections().some(s => output.get(s, 'DURATION') === '120'))
})

test('Baidu particles keep their image reference, count and velocity as Sogou decorations', () => {
  const { output, id } = convert('[ANIM1]\nCATEGORY=3\nPARTICLE_IMAGE=9\nTOTAL_NUMBER=2\nEMIT_TYPE=1\nLIFE=500,500\nVELOCITY=100,100\nVELOCITY_DIRECTION=0,0\nINIT_SCALE=1,1\n')
  assert.ok(id)
  const objects = output.sections().filter(s => output.get(s, 'IMG'))
  assert.equal(objects.length, 2)
  assert.equal(output.get(objects[0], 'IMG'), 'particle.png')
  assert.ok(output.sections().some(s => output.get(s, 'VELOCITY') === '200,0'))
})

test('unrepresentable GIF and 3D effects are reported, not silently converted', () => {
  const gif = convert('[ANIM1]\nANIM_PATH=spark.gif\n')
  assert.equal(gif.id, undefined)
  assert.ok(gif.warnings.some(w => w.includes('spark.gif')))
  const rotate = convert('[ANIM1]\nTYPE=5\nDURATION=200\n')
  assert.equal(rotate.id, undefined)
  assert.ok(rotate.warnings.some(w => w.includes('TYPE=5')))
})
