import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IniDocument } from '../src/ini.ts'
import { SsfMotion } from '../src/ssf/ssf-motion.ts'

// A 43px decoration, as in 森 · 花溪间; raw pixels must not expand with the skin's layout.
async function decoration(screenWidth, fields = '', boardWidth = 1080, imageWidth = 43) {
  const styles = {
    pkg: { path: () => undefined }, theme: 'light', sogouWidth: 1080,
    skin: IniDocument.parse(''), keys: IniDocument.parse(''),
    file: async () => ({ source: [0, 0, imageWidth, imageWidth] }),
  }
  const anim = IniDocument.parse(`[Anim_Style_Key]
DECO_ANIM=Animation_deco
DECO_ANIM_NUMBER=-1
[Animation_deco]
DOWN_ANIM_OBJ=Obj_deco
[Obj_deco]
IMG=01.png
ANIM=Anim_fly
${fields}
[Anim_fly]
TYPE=1
DURATION=400
START_VALUE=0,0
VELOCITY=0,-500
ACCELERATION=0,0
`)
  const motion = await SsfMotion.load(styles, { width: boardWidth, height: boardWidth / 2 }, anim, screenWidth)
  const effects = motion.effects([{ section: 'KEY2', rect: { x: 100, y: 0, width: 200, height: 120 }, binding: { sections: [], defaults: [], keyClass: 'char' } }])
  return { sprite: effects.press('KEY2', 200, 1).sprites[0], after: effects.press('KEY2', 401, 1).sprites }
}

test('SSF decorations keep intrinsic physical pixels at different screen and layout widths', async () => {
  for (const [screen, board, expected] of [[2160, 1080, 21.5], [1080, 1080, 43], [2160, 720, 43 / 3]]) {
    const { sprite, after } = await decoration(screen, '', board)
    assert.ok(Math.abs(sprite.rect.width - expected) < 1e-9)
    assert.ok(Math.abs(sprite.rect.height - expected) < 1e-9)
    assert.equal(sprite.overlay, true)
    assert.deepEqual(after, [])
  }
})

test('SSF explicitly sized decorations keep key and panel proportions', async () => {
  for (const screen of [1080, 2160]) {
    const key = (await decoration(screen, 'RATE_KEY_W=0.5\nRATE_KEY_H=0.5')).sprite
    assert.equal(key.rect.width, 60)
    assert.equal(key.rect.height, 60)
    const panel = (await decoration(screen, 'RATE_W=0.1\nRATE_H=0.2')).sprite
    assert.equal(panel.rect.width, 108)
    assert.equal(panel.rect.height, 108)
  }
})
