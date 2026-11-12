// Palm `.sxi` and Sogou `.ssf` documents are drawn from their own files (skin.json, phoneSkin.ini),
// not from Baidu styles: a Palm canvas lists skin.json's keys, a Sogou canvas the official skeleton's
// with no converted look. Scenes must name exactly the keys the canvas lists, follow the keyboard
// state, and draw what the skin's own data says; presses and bubbles play the skins' own animations.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { encodePng } from '../src/ssf/ssf-png.ts'
import { COLORS, solid, ssfFixture } from '../tests/helpers/ssf-fixture.mjs'
import { acceptAskDialogs } from "../tests/helpers/ask-dialogs.mjs"

// The harmony template with a press animation on KEY2's background: shrink to half towards the top
// left corner in 100 ms and back (`back`), as `a1` writes it.
function animatedPalm() {
  const files = unzipSync(readFileSync(new URL('../public/templates/palm-harmony.sxi', import.meta.url)))
  const skin = JSON.parse(strFromU8(files['skin.json']))
  const key = skin.default.port_layout.b.t9Pinyin.keys.find((item) => String(item.id) === '2')
  key.b.base_ba = 9001
  const info = skin.default.s_info
  info.ss_1['9001'] = { id: 'STYLE9001', s_5: { 1: 9002 } }
  info.ss_2 = { ...info.ss_2, 9002: { id: 'ANIM9002', a1: { b: { t: 4, count: 1, back: true, clear: true, c: 0 }, duration: 100, from_p: [100, 100], to_p: [50, 50], pp: [0, 0], style: 0, c_delay: 0 } } }
  files['skin.json'] = strToU8(JSON.stringify(skin))
  return zipSync(files)
}

function particlePalm() {
  const files = unzipSync(readFileSync(new URL('../public/templates/palm-harmony.sxi', import.meta.url)))
  const skin = JSON.parse(strFromU8(files['skin.json']))
  const theme = skin.default
  theme.port_layout.b.defaultGlobal.board.b.base_pa = 9010
  theme.port_layout.b.t9Pinyin.board = { b: {} }
  theme.s_info.ss_1['9010'] = { s_5: { 1: 9011, 3: 9011 } }
  theme.s_info.ss_1['9012'] = { s_2: { normal: 'issue30_particle,1' } }
  theme.s_info.ss_2 = { 9011: { a4: {
    b: { c: 3, t: 1 }, count: 1, rate: 1, life: [1000, 1000],
    i_p: [9012], aera: [[0.5, 0.5], [0, 0]], velocity: [40, 40], v_direction: [0, 0],
    scale: [1, 1], alpha: [255, 255],
  } } }
  theme.s_info.info.issue30_particle = [{ id: 'IMG1', rect1: [[0, 0], [12, 12]] }]
  theme.r_info.push('light/skin/res/issue30_particle.png')
  files['light/skin/res/issue30_particle.png'] = encodePng(solid(12, 12, [245, 5, 5]))
  files['skin.json'] = strToU8(JSON.stringify(skin))
  return zipSync(files)
}

// The Sogou fixture with an anim.ini that squeezes every key and throws a decoration straight up,
// and a popup background.
const SOGOU_ANIM = `[Anim_Style_Key]
BG_ANIM=Animation_fun
DECO_ANIM=Animation_deco
DECO_ANIM_NUMBER=-1
[Animation_fun]
DOWN_ANIM_OBJ=Obj_fun
[Obj_fun]
ANIM=Anim_fun
[Anim_fun]
TYPE=2
DURATION=200
KEYFRAME=Keyframe_fun,Keyframe_fun
[Keyframe_fun]
TIME=0,0.5,1
VALUE=1,0.5,1
[Animation_deco]
DOWN_ANIM_OBJ=Obj_deco
[Obj_deco]
IMG=deco.png
POS_ANCHOR=0
NEW_POS_X=0,0
NEW_POS_Y=0,0
RATE_KEY_W=0.5
RATE_KEY_H=0.5
RELATETO=1,1
ANIM=Anim_fly
[Anim_fly]
TYPE=1
DURATION=400
START_VALUE=0,0
EVALUATOR=1,1
VELOCITY=0,-500
ACCELERATION=0,0
`
function animatedSogou() {
  const files = unzipSync(ssfFixture())
  const folder = '1080/status1/'
  files[`${folder}anim.ini`] = strToU8(SOGOU_ANIM)
  files[`${folder}phoneSkin.ini`] = strToU8(`${strFromU8(files[`${folder}phoneSkin.ini`])}\n[BgPopup_Rect]\nNORMAL=pop.png\n[PopupBG]\nBG_IMAGE=BgPopup_Rect\n[TextStyle_Popup]\nTEXT_COLOR=0xFF112233\n`)
  files[`${folder}pop.png`] = encodePng(solid(160, 184, [9, 9, 9]))
  files[`${folder}deco.png`] = encodePng(solid(60, 60, [200, 10, 10]))
  return zipSync(files)
}

const server = await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'error', server: { port: 41833, strictPort: false, host: '127.0.0.1', hmr: false } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, bypassCSP: true })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
await acceptAskDialogs(page)

const open = async (name, bytes) => {
  await page.locator('#browser-open').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) })
  await page.waitForFunction(() => !document.querySelector('#open').disabled)
  const close = page.locator('#file-operation-dialog[open] #file-operation-close')
  if (await close.isVisible().catch(() => false)) await close.click()
}
const selectLayout = (path) => page.evaluate(async (path) => {
  const { selectFile } = await import('/src/app/navigation.ts')
  selectFile(path)
}, path)
const history = (action) => page.evaluate(async (action) => (await import('/src/app/edit-history.ts'))[action](), action)
const enter = async (input, value) => { await input.fill(value); await input.press('Enter') }
const bubbleGroup = () => page.locator('#document-fields [data-inspector-group-label="气泡"]')
const popup = () => page.evaluate(async () => {
  const { preview } = await import('/src/app/canvas-interaction.ts')
  const bar = (await preview.sceneForState()).keys.find((key) => key.section === 'KEY2').holdPopup
  return bar?.layers(bar.selected)
})
async function pressBubble(hold = false) {
  const point = await page.evaluate(async () => {
    const { preview } = await import('/src/app/canvas-interaction.ts')
    await preview.whenDrawn()
    window.__nativePreview = preview
    const context = preview.hintCanvas.getContext('2d')
    if (!window.__bubbleHooked) {
      window.__bubbleHooked = true
      const fillText = context.fillText.bind(context)
      const clearRect = context.clearRect.bind(context)
      context.clearRect = (...args) => { window.__bubbleTexts = []; clearRect(...args) }
      context.fillText = (text, ...args) => { window.__bubbleTexts.push({ text, font: context.font, color: context.fillStyle }); fillText(text, ...args) }
    }
    const key = preview.keys.find((key) => key.section === 'KEY2')
    const box = preview.canvas.getBoundingClientRect()
    return { x: box.left + (key.rect.x + key.rect.width / 2) * box.width / preview.panelWidth, y: box.top + (key.rect.y + key.rect.height / 2) * box.height / preview.surfaceHeight }
  })
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.waitForFunction((hold) => window.__nativePreview.hintVisible && (!hold || window.__nativePreview.active?.direction === 'hold' && window.__nativePreview.active?.hintCellWidth > 0), hold)
  const result = await page.evaluate(() => ({ texts: window.__bubbleTexts, width: window.__nativePreview.active?.hintCellWidth }))
  await page.mouse.up()
  await page.waitForFunction(() => !window.__nativePreview.active && !window.__nativePreview.hintVisible)
  return result
}
/** The panel scene for the current state: its texts, whether its sections match the canvas, and a pixel. */
const scene = (state, point) => page.evaluate(async ({ state, point }) => {
  const { preview } = await import('/src/app/canvas-interaction.ts')
  const { applySkinState } = await import('/src/app/canvas-interaction.ts')
  applySkinState(state)
  const built = await preview.sceneForState()
  await preview.whenDrawn()
  const sections = new Set(preview.keys.map((key) => key.section))
  const texts = Object.fromEntries(built.keys.map((key) => [key.section, key.layers(false).fore.flatMap((layer) => layer.kind === 'text' ? [{ text: layer.text.text, weight: layer.text.weight, color: layer.text.color }] : [])]))
  const pixel = point && [...preview.canvas.getContext('2d').getImageData(
    Math.round(point[0] * preview.canvas.width / preview.panelWidth),
    Math.round(point[1] * preview.canvas.height / preview.surfaceHeight), 1, 1).data]
  return { unknown: built.keys.map((key) => key.section).filter((section) => !sections.has(section)), texts, pixel, background: built.background.length }
}, { state, point })

try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)

  // Palm: the harmony template's keyboard image is transparent, so the Palm backdrop shows through.
  await open('palm-harmony.sxi', readFileSync(new URL('../public/templates/palm-harmony.sxi', import.meta.url)))
  await selectLayout('skin.json/default/port_layout/b/t9Pinyin')
  const palm = await scene(undefined, [3, 300])
  assert.deepEqual(palm.unknown, [], 'every Palm scene key is a canvas key section')
  // The canvas lists skin.json's own keys; there is no Baidu layout behind it.
  const listed = await page.evaluate(async () => {
    const { preview } = await import('/src/app/canvas-interaction.ts')
    const { appState } = await import('/src/app/state.ts')
    const board = JSON.parse(appState.archive.getText('skin.json')).default.port_layout.b.t9Pinyin
    return {
      document: preview.stateDocument === undefined,
      keys: preview.keys.filter((key) => /^KEY/.test(key.section)).map((key) => key.section).sort(),
      skin: board.keys.filter((key) => key.rect).map((key) => `KEY${key.id}`).sort(),
    }
  })
  assert.ok(listed.document, 'the Palm canvas has no layout document')
  assert.deepEqual(listed.keys, listed.skin)
  assert.deepEqual(palm.pixel.slice(0, 3), [208, 211, 217], 'transparent board shows the Palm backdrop')
  assert.deepEqual(palm.texts.KEY2.map(({ text }) => text), ['ABC', '2'])
  // `f_w` is Palm-only (Baidu export drops it); the scene keeps the skin's light weight.
  assert.equal(palm.texts.KEY2[0].weight, 300)
  assert.deepEqual(palm.texts.KEY12.map(({ text }) => text), ['清空'])
  const palmToolbar = await page.evaluate(async () => {
    const { toolbarPreview } = await import('/src/app/canvas-interaction.ts')
    const built = await toolbarPreview.sceneForState()
    await toolbarPreview.whenDrawn()
    const layers = built.keys.find((key) => key.section === 'BUILTIN_TOOLBAR').layers(false).fore
    return { height: toolbarPreview.panelHeight, layers: layers.map(({ rect }) => rect), keys: toolbarPreview.keys.map(({ section }) => section), background: built.background.length }
  })
  assert.equal(palmToolbar.height, 70, 'input-code inset is not an empty toolbar row')
  assert.equal(palmToolbar.background, 0, 'toolbar icons are not an always-visible background')
  assert.ok(palmToolbar.keys.includes('BUILTIN_TOOLBAR'))
  assert.equal(palmToolbar.layers.length, 5)
  for (const rect of palmToolbar.layers) {
    assert.equal(rect.y + rect.height / 2, 35, 'toolbar icons are vertically centred')
    assert.ok(rect.height > 40 && rect.height < 50, 'toolbar icons match the compact bar')
  }
  // 9-key pinyin swaps 123 for 分 while composing (fix_a S4 → key_fix 10).
  const composing = await scene(4)
  assert.deepEqual(composing.texts.KEY14.map(({ text }) => text), ['分'])
  assert.equal(await page.evaluate(async () => {
    const { toolbarPreview, setSimulatedComposition } = await import('/src/app/canvas-interaction.ts')
    const { refreshSimulationState } = await import('/src/app/preview-render.ts')
    setSimulatedComposition('ni')
    refreshSimulationState()
    await toolbarPreview.whenDrawn()
    return toolbarPreview.keys.some(({ section }) => section === 'BUILTIN_TOOLBAR')
  }), false, 'built-in toolbar does not overlap composing candidates')
  await page.evaluate(async () => {
    const { setSimulatedComposition } = await import('/src/app/canvas-interaction.ts')
    const { refreshSimulationState } = await import('/src/app/preview-render.ts')
    setSimulatedComposition('')
    refreshSimulationState()
  })
  const toolbar = await page.evaluate(async () => {
    const { candidateBackgroundPreview } = await import('/src/app/canvas-interaction.ts')
    return (await candidateBackgroundPreview.sceneForState()).background.length
  })
  assert.ok(toolbar > 0, 'the candidate bar draws its own backdrop')

  // Sogou: nine-key labels are upper case on pinyin boards (S_FLAG); keys.ini glyphs replace them.
  await open('fixture.ssf', ssfFixture())
  await selectLayout('light/skin/port/py_9.ini')
  const sogou = await scene(undefined)
  assert.deepEqual(sogou.unknown, [], 'every Sogou scene key is a canvas key section')
  assert.ok(sogou.background > 0, 'the Sogou keyboard background is drawn')
  // The skeleton laid over the skin carries no converted copy of its look.
  const converted = await page.evaluate(async () => {
    const { appState } = await import('/src/app/state.ts')
    return appState.archive.names().filter((name) => /\/res\/ssf\d+\.png$/.test(name))
  })
  assert.deepEqual(converted, [])
  // KEY2 carries the fixture's keys.ini glyph, so it draws no built-in label.
  assert.deepEqual(sogou.texts.KEY2, [])
  assert.deepEqual(sogou.texts.KEY3.map(({ text }) => text), ['DEF'])
  assert.deepEqual(sogou.texts.KEY16.map(({ text }) => text), ['中', '/英'])
  assert.deepEqual(sogou.texts['LIST:1'].map(({ text }) => text), ['，'])
  const keyboard = await scene(undefined, [3, 3])
  assert.ok(keyboard.pixel[3] > 0, 'the keyboard background covers the panel')
  assert.notDeepEqual(keyboard.pixel.slice(0, 3), COLORS.light.letterKey)

  // Palm presses play skin.json's own `ss_2`; bubbles come from its `h` model.
  await open('animated.sxi', animatedPalm())
  await selectLayout('skin.json/default/port_layout/b/t9Pinyin')
  const palmPress = await page.evaluate(async () => {
    const { preview } = await import('/src/app/canvas-interaction.ts')
    const effects = (await preview.sceneForState()).effects
    return {
      duration: effects.pressDuration('KEY2', 1),
      half: effects.press('KEY2', 100, 1).back,
      back: effects.press('KEY2', 150, 1).back,
      after: effects.press('KEY2', 250, 1).back,
      hints: preview.shortHint?.icons.size ?? 0,
    }
  })
  assert.equal(palmPress.duration, 200, 'a1 with `back` plays there and back')
  assert.deepEqual(palmPress.half, { scale: [0.5, 0.5], pivot: [0, 0] })
  assert.deepEqual(palmPress.back.scale, [0.75, 0.75])
  assert.equal(palmPress.after, undefined)
  assert.ok(palmPress.hints > 0, 'the board’s `h` bubble layout is read')
  assert.deepEqual((await pressBubble(true)).texts.map(({ text }) => text), ['A', 'B', 'C', '2', 'a', 'b', 'c'], 'Palm shows its implicit long-press candidates')
  await page.getByRole('button', { name: '编辑模式', exact: true }).click()
  await selectLayout('skin.json/default/port_layout/h/hint1')
  const icons = page.locator('#document-fields [data-inspector-group-label="图标"]')
  await enter(icons.locator('[data-document-key="pos"] input[type=number]').last(), '-50')
  const palmPosition = () => page.evaluate(async () => (await import('/src/app/canvas-interaction.ts')).preview.longHint.icons.get('2').position[1])
  assert.equal(await palmPosition(), -50, 'Palm icon edits rebuild the active board hint')
  await history('undo')
  assert.equal(await palmPosition(), -30)
  await history('redo')
  assert.equal(await palmPosition(), -50)
  await enter(icons.locator('[data-document-key="c_size"] input[type=number]').nth(2), '60')
  await enter(icons.locator('[data-document-key="c_size"] input[type=number]').last(), '32')
  const bubbleText = page.locator('#document-fields [data-inspector-group-label="气泡文字"]')
  await enter(bubbleText.locator('[data-document-key="f_s"] input[type=number]').last(), '26')
  await page.getByRole('button', { name: '交互预览', exact: true }).click()
  await selectLayout('skin.json/default/port_layout/b/t9Pinyin')
  const editedPalm = await pressBubble(true)
  assert.equal(editedPalm.width, 60, 'Palm reads CELL_SIZE from the bar icon')
  assert.ok(editedPalm.texts.every(({ font }) => font.includes('26px')), 'Palm bubble text edits reach the canvas')
  for (let index = 0; index < 4; index++) await history('undo')

  await open('particles.sxi', particlePalm())
  await selectLayout('skin.json/default/port_layout/b/t9Pinyin')
  const palmParticles = await page.evaluate(async () => {
    const { preview } = await import('/src/app/canvas-interaction.ts')
    const effects = (await preview.sceneForState()).effects
    const start = effects.panel(0)[0]
    const moved = effects.panel(500)[0]
    const realNow = Date.now
    const now = realNow()
    Date.now = () => now
    try {
      preview.nativeShownAt = now - 500
      await preview.whenDrawn()
      const pixel = [...preview.canvas.getContext('2d').getImageData(
        Math.floor((moved.rect.x + moved.rect.width / 2) * preview.canvas.width / preview.panelWidth),
        Math.floor((moved.rect.y + moved.rect.height / 2) * preview.canvas.height / preview.surfaceHeight), 1, 1).data]
      return { distance: moved.rect.x - start.rect.x, source: moved.visual.source, pixel,
        pressing: effects.press('KEY2', 500, 1).sprites.length, ended: effects.panel(1100).length }
    } finally {
      Date.now = realNow
    }
  })
  assert.equal(palmParticles.distance, 20, 'SXI particles move by their actual velocity')
  assert.deepEqual(palmParticles.source, [0, 0, 12, 12], 'the real particle image is loaded')
  assert.deepEqual(palmParticles.pixel, [245, 5, 5, 255], 'panel particles are painted onto the canvas')
  assert.equal(palmParticles.pressing, 1, 'press events emit particles too')
  assert.equal(palmParticles.ended, 0, 'particles disappear at the end of their life')

  // Sogou taps only play anim.ini; long presses show the native character bar.
  await open('animated.ssf', animatedSogou())
  await selectLayout('light/skin/port/py_9.ini')
  const sogouPress = await page.evaluate(async () => {
    const { preview } = await import('/src/app/canvas-interaction.ts')
    const scene = await preview.sceneForState()
    const key = scene.keys.find((item) => item.section === 'KEY2')
    const press = scene.effects.press('KEY2', 200, 1)
    const sprite = press.sprites[0]
    return {
      duration: scene.effects.pressDuration('KEY2', 1),
      squeeze: scene.effects.press('KEY2', 100, 1).back?.scale,
      key: key.rect,
      sprite: sprite && { rect: sprite.rect, translation: sprite.motion?.translation, overlay: sprite.overlay },
    }
  })
  assert.equal(sogouPress.duration, 400)
  assert.deepEqual(sogouPress.squeeze, [0.5, 0.5], 'the keyframes reach 0.5 halfway')
  // RATE_KEY 0.5 fits the square image into half the key; POS_ANCHOR 0 centres it.
  const side = Math.min(sogouPress.key.width, sogouPress.key.height) / 2
  assert.deepEqual(sogouPress.sprite.rect, { x: sogouPress.key.x + (sogouPress.key.width - side) / 2, y: sogouPress.key.y + (sogouPress.key.height - side) / 2, width: side, height: side })
  assert.deepEqual(sogouPress.sprite.translation, [0, -100], 'v·t after 200 ms')
  assert.equal(sogouPress.sprite.overlay, true, 'decorations use the layer above the candidate bar')
  // Sample the real animation beyond the panel's upper edge, inside the candidate bar.
  const decoration = await page.evaluate(async () => {
    const { preview } = await import('/src/app/canvas-interaction.ts')
    await preview.whenDrawn()
    const realNow = Date.now
    const now = realNow()
    Date.now = () => now
    try {
      preview.nativePress = { section: 'KEY2', startedAt: now - 350, seed: 1 }
      await preview.whenDrawn()
      const sprite = preview.drawnScene.effects.press('KEY2', 350, 1).sprites[0]
      const panel = preview.canvas.getBoundingClientRect()
      const overlay = preview.hintCanvas.getBoundingClientRect()
      const x = panel.left + (sprite.rect.x + sprite.rect.width / 2) * panel.width / preview.panelWidth
      const y = panel.top + (sprite.rect.y + sprite.rect.height / 2 + sprite.motion.translation[1]) * panel.height / preview.surfaceHeight
      const candidate = document.querySelector('#candidate-area').getBoundingClientRect()
      const context = preview.hintCanvas.getContext('2d')
      const pixel = [...context.getImageData(Math.round((x - overlay.left) * preview.hintCanvas.width / overlay.width), Math.round((y - overlay.top) * preview.hintCanvas.height / overlay.height), 1, 1).data]
      // The overlay ignores pointer events; temporarily enable them to check the painted stacking order.
      preview.hintCanvas.style.pointerEvents = 'auto'
      const top = document.elementFromPoint(x, y) === preview.hintCanvas
      preview.hintCanvas.style.removeProperty('pointer-events')
      const visible = preview.nativeOverlayVisible
      preview.nativePress = undefined
      await preview.whenDrawn()
      const cleared = [...context.getImageData(0, 0, preview.hintCanvas.width, preview.hintCanvas.height).data].every(value => value === 0)
      return { pixel, top, visible, cleared, hint: preview.hintVisible, abovePanel: y < panel.top, inCandidates: y >= candidate.top && y < candidate.bottom }
    } finally { Date.now = realNow; preview.nativePress = undefined }
  })
  assert.ok(decoration.abovePanel && decoration.inCandidates, 'the decoration flies over the candidate bar')
  assert.deepEqual(decoration.pixel, [200, 10, 10, 255], 'the decoration remains painted outside the panel')
  assert.ok(decoration.top && decoration.visible, 'the candidate bar cannot cover the decoration')
  assert.ok(decoration.cleared && !decoration.hint, 'ending the effect clears the overlay without showing a tap bubble')
  assert.deepEqual((await pressBubble(true)).texts.map(({ text }) => text), ['A', 'B', 'C', '2', 'a', 'b', 'c'], 'Sogou long presses draw the native character bar')
  await page.getByRole('button', { name: '编辑模式', exact: true }).click()
  const beforeSogou = await popup()
  await enter(bubbleGroup().locator('[data-document-key="POPUP_OFFSET_VERTICAL"] input[type=number]'), '-24')
  assert.equal((await popup())[0].rect.y, beforeSogou[0].rect.y - 24, 'Sogou offset edits update the scene immediately')
  await history('undo')
  assert.equal((await popup())[0].rect.y, beforeSogou[0].rect.y)
  await history('redo')
  assert.equal((await popup())[0].rect.y, beforeSogou[0].rect.y - 24)
  await page.evaluate(async () => {
    const { editSsfFile, setSsfValue } = await import('/src/app/ssf-fields.ts')
    editSsfFile('1080/status1/phoneSkin.ini', document => {
      setSsfValue(document, 'TextStyle_Popup_Phone_LongPress', 'TEXT_SIZE', '52')
      setSsfValue(document, 'TextStyle_Popup_Phone_Minor_LongPress', 'TEXT_SIZE', '52')
    })
  })
  assert.ok((await popup()).filter((layer) => layer.kind === 'text').every(({ text }) => text.size === 52))
  // Long-press bars use their own foreground reference and the authored background colour.
  await page.evaluate(async () => {
    const { editSsfFile, setSsfValue } = await import('/src/app/ssf-fields.ts')
    editSsfFile('1080/status1/phoneSkin.ini', (document) => {
      setSsfValue(document, 'PopupBG', 'BG_IMAGE', '')
      setSsfValue(document, 'General', 'POPUP_BG_COLOR', '0xFF225588')
      setSsfValue(document, 'FGStyle_Phone_Popup_LongPress', 'LABEL_STYLE', 'TextStyle_CustomPopup')
      setSsfValue(document, 'TextStyle_CustomPopup', 'TEXT_COLOR', '0xFF778899')
    })
  })
  const colorPopup = await popup()
  assert.equal(colorPopup[0].kind, 'fill')
  assert.equal(colorPopup[0].color, 'rgba(34, 85, 136, 1)')
  assert.equal(colorPopup.find(layer => layer.kind === 'text' && layer.text.text === '2').text.color, 'rgba(119, 136, 153, 1)', 'Sogou respects the popup foreground’s text-style reference')
  await page.getByRole('button', { name: '交互预览', exact: true }).click()
  assert.ok((await pressBubble(true)).texts.some(({ color }) => color === '#778899'))
  await page.getByRole('button', { name: '编辑模式', exact: true }).click()
  await page.evaluate(async () => {
    const { editSsfFile, setSsfValue } = await import('/src/app/ssf-fields.ts')
    editSsfFile('1080/status1/phoneSkin.ini', (document) => {
      setSsfValue(document, 'PopupBG', 'BG_IMAGE', 'pop.png')
      setSsfValue(document, 'FGStyle_Phone_Popup', 'LABEL_VISIBLE', '0')
      setSsfValue(document, 'FGStyle_Phone_Popup', 'MINOR_LABEL_HORIZONTAL_OFFSET', '12')
    })
  })
  assert.equal((await popup())[0].kind, 'fill', 'single-key PopupBG does not replace the long-press bar')
  await page.getByRole('button', { name: '交互预览', exact: true }).click()
  await page.evaluate(async () => {
    const { hintPreviewEnabled } = await import('/src/app/dom.ts')
    hintPreviewEnabled.checked = false
    hintPreviewEnabled.dispatchEvent(new Event('change'))
  })
  assert.equal(await popup(), undefined, 'the popup switch also disables Sogou scenes')

  assert.deepEqual(errors, [])
  console.log('native preview: Palm and Sogou scenes, animations, pointer bubbles, native bubble fields, editing and undo/redo passed')
} finally {
  await browser.close()
  await server.close()
}
