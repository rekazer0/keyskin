import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sourceValueRanges } from '../src/source-value-ranges.ts'

test('style and color ranges carry the key they belong to', () => {
  const ini = sourceValueRanges('[KEY3]\nFORE_STYLE=73,193\nNM_COLOR=FF112233\n[EMOJI]\nPANEL_BACK_STYLE_INDEX=17\n', 'ini')
  assert.deepEqual(ini.map(({ value, kind, key }) => [value, kind, key]), [
    ['73', 'style', 'FORE_STYLE'],
    ['193', 'style', 'FORE_STYLE'],
    ['FF112233', 'color', 'NM_COLOR'],
    ['17', 'style', 'PANEL_BACK_STYLE_INDEX'],
  ])
  const json = sourceValueRanges('{"backStyle": 1000003}', 'json')
  assert.deepEqual(json.map(({ kind, key }) => [kind, key]), [['style', 'backStyle']])
})
