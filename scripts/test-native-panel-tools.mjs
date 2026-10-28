// 面板复制、替换键盘样式、适配 iOS 26 on Palm (.sxi) and Sogou (.ssf) skins, driven through the
// menus and dialogs like a user: each result is checked in the format's own files, on the canvas,
// through undo / redo, and after saving and reopening the package.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { SkinArchive } from '../src/skin.ts'
import { SsfPackage } from '../src/ssf/ssf-package.ts'
import { buildSxiZip } from '../src/palm/palm-export.ts'
import { encodePng } from '../src/ssf/ssf-png.ts'
import { bdsFixture } from '../tests/helpers/baidu-fixture.mjs'
import { solid, ssfFixture } from '../tests/helpers/ssf-fixture.mjs'

const RED = [230, 20, 20]
const BLUE = [20, 40, 230]
const png = (width, height, rgb) => Buffer.from(encodePng(solid(width, height, rgb)))
const palmFixture = buildSxiZip(SkinArchive.open(bdsFixture())).bytes
const palmTemplate = readFileSync(new URL('../public/templates/palm-harmony.sxi', import.meta.url))

const server = await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'error', server: { port: 41831, strictPort: false, host: '127.0.0.1', hmr: false } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('dialog', (dialog) => dialog.accept())

async function open(name, bytes) {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.locator('#browser-open').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) })
  await page.waitForFunction(() => !document.querySelector('#open').disabled)
  const close = page.locator('#file-operation-dialog[open] #file-operation-close')
  if (await close.isVisible().catch(() => false)) await close.click()
  await page.getByRole('button', { name: '编辑模式', exact: true }).click()
}
const selectLayout = (path) => page.evaluate(async (path) => {
  const { selectFile } = await import('/src/app/navigation.ts')
  selectFile(path)
}, path)
const text = (path) => page.evaluate(async (path) => {
  const { appState } = await import('/src/app/state.ts')
  return appState.archive.isText(path) ? appState.archive.getText(path) : undefined
}, path)
const skinJson = async () => JSON.parse(await text('skin.json'))
const names = () => page.evaluate(async () => (await import('/src/app/state.ts')).appState.archive.names())
const pngSize = (path) => page.evaluate(async (path) => {
  const { appState } = await import('/src/app/state.ts')
  const bitmap = await createImageBitmap(new Blob([appState.archive.getBytes(path)], { type: 'image/png' }))
  return [bitmap.width, bitmap.height]
}, path)
const history = (action) => page.evaluate(async (action) => (await import('/src/app/edit-history.ts'))[action](), action)
const undoDepth = () => page.evaluate(async () => (await import('/src/app/state.ts')).appState.undoStack.length)
const savedFiles = () => page.evaluate(async () => [...(await import('/src/app/state.ts')).appState.archive.toBytes()])
  .then((bytes) => unzipSync(Uint8Array.from(bytes)))
/** The canvas pixel at a panel point, after the current scene is drawn. */
const pixel = (point) => page.evaluate(async (point) => {
  const { preview } = await import('/src/app/canvas-interaction.ts')
  await preview.sceneForState()
  await preview.whenDrawn()
  return [...preview.canvas.getContext('2d').getImageData(
    Math.round(point[0] * preview.canvas.width / preview.panelWidth),
    Math.round(point[1] * preview.canvas.height / preview.surfaceHeight), 1, 1).data]
}, point)
const keyCenter = (match) => page.evaluate(async (match) => {
  const { preview } = await import('/src/app/canvas-interaction.ts')
  const key = preview.keys.find((item) => item.section === match || item.center === match)
  // `corner` is inside the key, clear of its centred label.
  return { section: key.section, point: [key.rect.x + key.rect.width / 2, key.rect.y + key.rect.height / 2], corner: [key.rect.x + 4, key.rect.y + 4] }
}, match)
async function selectKey(match) {
  const { section, point, corner } = await keyCenter(match)
  const box = await page.locator('#preview').boundingBox()
  const size = await page.evaluate(async () => {
    const { preview } = await import('/src/app/canvas-interaction.ts')
    return [preview.panelWidth, preview.surfaceHeight]
  })
  await page.mouse.click(box.x + point[0] / size[0] * box.width, box.y + point[1] / size[1] * box.height)
  await page.waitForFunction(async (section) => {
    const { appState } = await import('/src/app/state.ts')
    return appState.selectedKeySections.join() === section && !appState.selectionInspectorSyncPending
  }, section)
  return { section, point, corner }
}
async function clearSelection() {
  await page.evaluate(async () => {
    const { appState } = await import('/src/app/state.ts')
    const { preview } = await import('/src/app/canvas-interaction.ts')
    appState.selectedKeySections = []
    preview.setSelected([])
  })
}
/** The three tools live in the file menu. */
async function menuItem(id) {
  const menu = page.locator('.pen-file-menu')
  if (!(await menu.evaluate((node) => node.open))) await menu.locator('> summary').click()
  await page.locator(id).click()
}
/** Tool operations report on the status line when they end. */
const waitIdle = async () => {
  await page.waitForFunction(() => !/^正在/.test(document.querySelector('#event-log').textContent))
  const status = await page.locator('#event-log').textContent()
  if (/失败|错误/.test(status)) throw new Error(status)
}

async function adaptIos26(steps = 1) {
  const depth = await undoDepth()
  await menuItem('#adapt-ios26')
  await page.locator('#ios26-dialog[open]').waitFor()
  await page.locator('#ios26-form button[value="apply"]').click()
  await waitIdle()
  const close = page.locator('#file-operation-dialog[open] #file-operation-close')
  if (await close.isVisible().catch(() => false)) await close.click()
  assert.equal(await undoDepth(), depth + steps, 'iOS 26 adaptation is one undo step')
}

/** `size` maps the source panel size the dialog shows to the target size. */
async function copyPanel(source, target, size) {
  await menuItem('#panel-scale')
  await page.locator('#panel-scale-dialog[open]').waitFor()
  await page.locator('#panel-copy-source').fill(source)
  await page.locator('#panel-copy-source').dispatchEvent('input')
  await page.locator('#panel-copy-target').fill(target)
  await page.locator('#panel-copy-target').dispatchEvent('input')
  if (size) {
    await page.locator('#panel-scale-enabled').check()
    const [width, height] = size([Number(await page.locator('#panel-source-width').inputValue()), Number(await page.locator('#panel-source-height').inputValue())])
    await page.locator('#panel-target-width').fill(String(width))
    await page.locator('#panel-target-height').fill(String(height))
  }
  await page.locator('#panel-scale-form button[value="copy"]').click()
  await waitIdle()
  const close = page.locator('#file-operation-dialog[open] #file-operation-close')
  if (await close.isVisible().catch(() => false)) await close.click()
}

async function replaceStyle(target, bytes, { config = 'none' } = {}) {
  await menuItem('#replace-layout-image')
  await page.locator('#layout-image-dialog[open]').waitFor()
  await page.locator('#layout-image-open').setInputFiles({ name: 'style.png', mimeType: 'image/png', buffer: bytes })
  await page.locator(`input[name="layout-image-target"][value="${target}"]`).check()
  if (config !== 'none') await page.locator(`[data-layout-image-config="${config}"]`).click()
  await page.waitForFunction(() => !document.querySelector('#layout-image-apply').disabled)
  await page.locator('#layout-image-apply').click()
  await page.waitForFunction(() => !document.querySelector('#layout-image-dialog').open || !document.querySelector('#layout-image-error').hidden)
  const error = page.locator('#layout-image-error')
  if (await error.isVisible()) throw new Error(await error.textContent())
}

const near = (actual, expected, tolerance = 3) => expected.every((value, index) => Math.abs(actual[index] - value) <= tolerance)

try {
  // ---------- Palm: iOS 26 on Palm's own template ----------
  await open('palm-harmony.sxi', palmTemplate)
  await selectLayout('skin.json/default/port_layout/b/full26Pinyin')
  const palmOriginal = await skinJson()
  await adaptIos26()
  let skin = await skinJson()
  const fill = (theme, id) => skin[theme].s_info.ss_1[id].s_1
  for (const theme of ['default', 'night']) {
    for (const layout of ['port_layout', 'land_layout']) {
      const boards = skin[theme][layout].b
      assert.deepEqual(fill(theme, boards.full26Pinyin.board.b.base_b), { c_hl: '01D0D4DB', c_normal: '01D0D4DB', for_back: true }, `${theme} ${layout} keyboard is almost transparent`)
      assert.equal(boards.symbol.board.b.base_b, boards.full26Pinyin.board.b.base_b, 'the symbol panel follows')
      assert.equal(boards.logo.board.b.base_b, palmOriginal[theme][layout].b.logo.board.b.base_b, 'the logo page keeps its background')
      assert.equal(fill(theme, boards.defaultGlobal.cand.b.base_b).c_normal, '00D0D4DB', 'the candidate bar is fully transparent')
      // Only the background changes: the size still falls back to defaultGlobal and text styles stay.
      assert.equal(boards.full26Pinyin.board.size, undefined)
      assert.deepEqual(boards.defaultGlobal.cand.b.base_f, palmOriginal[theme][layout].b.defaultGlobal.cand.b.base_f)
    }
  }
  assert.ok(near(await pixel([1, 1]), [208, 211, 217]), 'the canvas shows the Palm backdrop through the panel')
  await adaptIos26(0)
  assert.deepEqual(await skinJson(), skin, 'adapting again reuses the transparent styles')
  await history('undo')
  assert.deepEqual(await skinJson(), palmOriginal, 'undo restores skin.json')
  await history('redo')
  assert.deepEqual(await skinJson(), skin, 'redo applies it again')

  // ---------- Palm: panel copy (a whole layout part of skin.json, scaled) ----------
  const beforeCopy = await skinJson()
  await copyPanel('skin.json/default/port_layout/', 'skin.json/default/land_layout/', ([width, height]) => [width * 2, height])
  skin = await skinJson()
  const port = skin.default.port_layout.b.full26Pinyin.keys[0]
  const land = skin.default.land_layout.b.full26Pinyin.keys[0]
  assert.deepEqual(land.rect, [[port.rect[0][0] * 2, port.rect[0][1]], [port.rect[1][0] * 2, port.rect[1][1]]], 'key rects are scaled')
  assert.deepEqual(skin.default.land_layout.b.defaultGlobal.board.size, [1440, 392], 'the panel size is scaled')
  assert.deepEqual(Object.keys(skin.default.land_layout.b).sort(), Object.keys(skin.default.port_layout.b).sort())
  assert.deepEqual(skin.default.port_layout, beforeCopy.default.port_layout, 'the source is unchanged')
  assert.equal(await page.locator('#orientation').inputValue(), 'land', 'the canvas shows the copy')
  const landKeys = await page.evaluate(async () => (await import('/src/app/canvas-interaction.ts')).preview.panelWidth)
  assert.equal(landKeys, 1440)
  await history('undo')
  assert.deepEqual(await skinJson(), beforeCopy, 'undo restores the target')

  // ---------- Palm: panel copy of a single board to the other theme ----------
  await selectLayout('skin.json/default/port_layout/b/full26Pinyin')
  await copyPanel('skin.json/default/port_layout/b/full26Pinyin', 'skin.json/night/port_layout/b/py_26_copy')
  skin = await skinJson()
  assert.deepEqual(skin.night.port_layout.b.py_26_copy, skin.default.port_layout.b.full26Pinyin, 'a board copies to a new board of the other theme')
  assert.equal(await page.evaluate(async () => (await import('/src/app/state.ts')).appState.layoutPath), 'skin.json/night/port_layout/b/py_26_copy', 'the canvas shows the copy')
  assert.ok(!(await names()).some((name) => /\.(?:ini|css|til|cnd|pop)$/.test(name)), 'nothing but skin.json changes')
  await history('undo')

  // ---------- Palm: panel copy of a whole theme with its images ----------
  await open('fixture.sxi', palmFixture)
  const fixtureSkin = await skinJson()
  const fixtureNames = await names()
  const images = fixtureNames.filter((path) => /^light\/skin\/res\/[^/]+\.png$/.test(path))
  assert.ok(images.length > 0)
  await copyPanel('light/skin/', 'dark/skin/')
  skin = await skinJson()
  const moved = (list) => list?.map((path) => path.replace(/^light\//, 'dark/'))
  assert.deepEqual({ ...skin.night, r_info: undefined, r_logo: undefined, r_port: undefined, r_land: undefined },
    { ...fixtureSkin.default, r_info: undefined, r_logo: undefined, r_port: undefined, r_land: undefined }, 'the theme is copied whole')
  assert.deepEqual(skin.night.r_info, moved(fixtureSkin.default.r_info), 'its resource list names the copies')
  const copied = await names()
  for (const image of images) assert.ok(copied.includes(image.replace(/^light\//, 'dark/')), `${image} is copied`)
  await history('undo')
  assert.deepEqual(await skinJson(), fixtureSkin)
  assert.deepEqual(await names(), fixtureNames, 'undo removes the copied images')

  // ---------- Palm: replace keyboard style ----------
  await open('fixture.sxi', palmFixture)
  await selectLayout('skin.json/default/port_layout/b/full26Pinyin')
  const board = fixtureSkin.default.port_layout.b.full26Pinyin
  const panelSize = board.board?.size ?? fixtureSkin.default.port_layout.b.defaultGlobal.board.size
  await replaceStyle('panel', png(...panelSize, RED))
  skin = await skinJson()
  const panelStyle = skin.default.s_info.ss_1[skin.default.port_layout.b.full26Pinyin.board.b.base_b]
  assert.deepEqual(panelStyle.s_2, { hl: 'replace_image,1', normal: 'replace_image,1' })
  assert.deepEqual(skin.default.s_info.info.replace_image, [{ alpha: 1, id: 'IMG1', rect1: [[0, 0], panelSize], scales: [] }])
  assert.ok((await names()).includes('light/skin/res/replace_image.png'), JSON.stringify((await names()).filter((path) => path.includes('replace'))))
  assert.deepEqual(await pngSize('light/skin/res/replace_image.png'), panelSize)
  if (Array.isArray(fixtureSkin.default.r_info)) assert.ok(skin.default.r_info.some((path) => path.endsWith('res/replace_image.png')), 'the picture is listed in r_info')
  const panelPixel = await pixel([1, 1])
  assert.ok(near(panelPixel, RED), `the canvas shows the new keyboard background: ${panelPixel} ${await page.evaluate(async () => { const { appState } = await import('/src/app/state.ts'); return [appState.layoutPath, document.querySelector('#theme').value] })}`)
  // Other boards sharing the old background keep it.
  assert.equal(skin.default.port_layout.b.defaultGlobal.board?.b?.base_b, fixtureSkin.default.port_layout.b.defaultGlobal.board?.b?.base_b)

  const key = await selectKey('KEY1')
  const keyBefore = (await skinJson()).default.port_layout.b.full26Pinyin.keys.find((item) => `KEY${item.id}` === key.section)
  await replaceStyle('key-normal', png(...panelSize, BLUE))
  skin = await skinJson()
  const keys = skin.default.port_layout.b.full26Pinyin.keys
  const keyAfter = keys.find((item) => `KEY${item.id}` === key.section)
  assert.notEqual(keyAfter.b.base_b, keyBefore.b.base_b, 'the key gets its own background style')
  assert.equal(skin.default.s_info.ss_1[keyAfter.b.base_b].s_2.normal, 'replace_image2,1')
  assert.deepEqual(keys.filter((item) => item !== keyAfter).map((item) => item.b), board.keys.filter((item) => `KEY${item.id}` !== key.section).map((item) => item.b), 'other keys are untouched')
  await clearSelection()
  const keyPixel = await pixel(key.corner)
  assert.ok(near(keyPixel, BLUE), `the canvas shows the key slice: ${keyPixel}`)

  await selectKey('KEY1')
  await replaceStyle('fore-normal', png(...panelSize, RED))
  skin = await skinJson()
  const fores = skin.default.port_layout.b.full26Pinyin.keys.find((item) => `KEY${item.id}` === key.section).b.base_f
  assert.deepEqual(fores.slice(0, -1), keyBefore.b.base_f ?? [], 'existing foregrounds are kept')
  assert.equal(skin.default.s_info.ss_1[fores.at(-1)].s_2.normal, 'replace_image3,1')
  await clearSelection()

  await replaceStyle('candidate', png(100, 10, BLUE))
  skin = await skinJson()
  const candidateBoard = skin.default.port_layout.b
  const candBack = [candidateBoard.defaultGlobal.cand, ...Object.values(skin.default.port_layout.c ?? {})].map((model) => model?.b?.base_b).filter((value) => value !== undefined)
  assert.ok(candBack.some((id) => skin.default.s_info.ss_1[id]?.s_2?.normal === 'replace_image4,1'), 'the candidate bar gets the picture')

  // Saved and reopened, the package carries skin.json and the pictures.
  const palmSaved = await savedFiles()
  const reopened = SkinArchive.open(zipSync(palmSaved), 'sxi')
  assert.deepEqual(JSON.parse(reopened.getText('skin.json')), skin)
  for (const name of ['replace_image', 'replace_image2', 'replace_image3', 'replace_image4']) assert.ok(reopened.getBytes(`light/skin/res/${name}.png`), `${name}.png is saved`)
  for (let step = 0; step < 4; step++) await history('undo')
  assert.deepEqual(await skinJson(), fixtureSkin, 'every replacement is one undo step')
  assert.ok(!(await names()).includes('light/skin/res/replace_image.png'))
  console.log('Palm: iOS 26, panel copy (folder, board, theme, scaled) and style replacement (panel, key, foreground, candidate)')

  // ---------- Sogou ----------
  const ssfFiles = unzipSync(ssfFixture())
  for (const name of Object.keys(ssfFiles)) if (name.startsWith('1080/status1/')) ssfFiles[name.replace('1080/', '720/')] = ssfFiles[name]
  ssfFiles['time.ini'] = strToU8(strFromU8(ssfFiles['time.ini']).replace('SUPPORT_SCREEN=1080', 'SUPPORT_SCREEN=1080,720'))
  await open('fixture.ssf', zipSync(ssfFiles))
  await selectLayout('light/skin/port/py_26.ini')
  const looks = ['1080/status1/phoneSkin.ini', '1080/status2/phoneSkin.ini', '720/status1/phoneSkin.ini']
  const ssfOriginal = Object.fromEntries(await Promise.all(looks.map(async (path) => [path, await text(path)])))
  const ini = async (path) => {
    const source = await text(path)
    return (section, key) => {
      let current = ''
      for (const line of source.split(/\r?\n/)) {
        const header = /^\[(.+)\]$/.exec(line)
        if (header) current = header[1]
        else if (current === section && line.startsWith(`${key}=`)) return line.slice(key.length + 1)
      }
    }
  }
  await adaptIos26()
  for (const path of looks) {
    const get = await ini(path)
    assert.equal(get('RootView', 'BG_STYLE'), '2', `${path}: keyboard background is a colour`)
    assert.equal(get('RootView', 'BG_COLOR'), '0x01D0D4DB')
    assert.equal(get('RootView', 'BG_IMAGE'), undefined)
    assert.equal(get('CandidateView', 'BG_STYLE'), '2')
    assert.equal(get('CandidateView', 'BG_COLOR'), '0x00D0D4DB')
    assert.equal(get('CandidateView', 'BG_IMAGE'), undefined)
    assert.equal(get('KeyBg_Default_Latin', 'NORMAL'), ssfOriginal[path].match(/\[KeyBg_Default_Latin\]\nNORMAL=(.*)/)[1], 'key backgrounds are kept')
  }
  const gap = [2, 2]
  assert.ok((await pixel(gap))[3] < 8, 'the canvas keyboard background is almost transparent')
  await history('undo')
  for (const path of looks) assert.equal(await text(path), ssfOriginal[path], `undo restores ${path}`)

  // Panel copy: a new resolution folder, scaled, listed in time.ini.
  await copyPanel('720/', '480/', ([width, height]) => [480, Math.round(height * 480 / width)])
  const listed = await text('time.ini')
  assert.match(listed, /SUPPORT_SCREEN=1080,720,480/)
  assert.match(listed, /\[480\]\r?\nLOOP_TYPE=1\r?\nSTATUS_LIST=status2,status1/)
  assert.match(await text('phoneTheme.ini'), /supports-screens=1080,720,480/)
  const scaledLook = await ini('480/status1/phoneSkin.ini')
  assert.equal(scaledLook('KeyBg_Default_Latin', 'NORMAL'), '26key.png,1,65,1,94', 'stretch bands follow the resized images')
  assert.deepEqual(await pngSize('480/status1/26key.png'), [65, 95])
  const copiedSsf = await names()
  assert.ok(!copiedSsf.some((path) => /^480\/.*\b(?:gen|py_26)\.ini$/.test(path)), 'the preview skeleton is not copied')
  const resolutions = SsfPackage.fromFiles(new Map(Object.entries(await savedFiles()))).files
  assert.ok(resolutions.has('480/status1/phoneSkin.ini'), 'the saved skin carries the new resolution')
  await history('undo')
  assert.ok(!(await names()).some((path) => path.startsWith('480/')), 'undo removes the copied folder')

  // Replace keyboard style: the keyboard background in every resolution folder of the look.
  await selectLayout('light/skin/port/py_26.ini')
  await replaceStyle('panel', png(1080, 720, RED))
  for (const folder of ['1080/status1/', '720/status1/']) {
    const get = await ini(`${folder}phoneSkin.ini`)
    assert.equal(get('RootView', 'BG_IMAGE'), 'replace_image.png', `${folder}: RootView shows the picture`)
    assert.equal(get('RootView', 'BG_STYLE'), '1')
  }
  const [bgWidth, bgHeight] = await pngSize('1080/status1/replace_image.png')
  assert.equal(bgWidth, 1080)
  assert.deepEqual(await pngSize('720/status1/replace_image.png'), [720, Math.round(bgHeight * 720 / 1080)])
  assert.equal((await ini('1080/status2/phoneSkin.ini'))('RootView', 'BG_IMAGE'), 'bg.png', 'the night look is untouched')
  // RootView sits behind the bar too: the old background keeps the bar's strip, the picture fills the rest.
  const imagePixel = (path, point) => page.evaluate(async ({ path, point }) => {
    const { appState } = await import('/src/app/state.ts')
    const bitmap = await createImageBitmap(new Blob([appState.archive.getBytes(path)], { type: 'image/png' }))
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    canvas.getContext('2d').drawImage(bitmap, 0, 0)
    return [...canvas.getContext('2d').getImageData(...point, 1, 1).data]
  }, { path, point })
  assert.ok(near(await imagePixel('1080/status1/replace_image.png', [2, 2]), [30, 30, 30]), 'the bar strip keeps the old background')
  assert.ok(near(await imagePixel('1080/status1/replace_image.png', [2, bgHeight - 2]), RED))
  const bgPixel = await pixel([2, 600])
  assert.ok(near(bgPixel, RED), `the canvas shows the new keyboard background: ${bgPixel}`)

  const q = await selectKey('q')
  await replaceStyle('key-normal', png(1080, 720, BLUE))
  const qSkin = await ini('1080/status1/phoneSkin.ini')
  const own = qSkin('Key_Q', 'BG_IMAGES')
  assert.notEqual(own, 'SMA_Key26Bg_Q', 'Q gets its own image section')
  assert.match(qSkin(own, 'NORMAL'), /^replace_image2_\d+\.png$/)
  assert.equal(qSkin(own, 'PRESSED'), '26keyq_press.png,2,96,3,139', 'the pressed image is kept')
  assert.equal(qSkin('KeyBg_Default_Latin', 'NORMAL'), ssfOriginal['1080/status1/phoneSkin.ini'].match(/\[KeyBg_Default_Latin\]\nNORMAL=(.*)/)[1], 'the shared class is kept')
  assert.ok((await names()).includes(`720/status1/${qSkin(own, 'NORMAL')}`), 'the slice is written for 720 too')
  assert.equal((await ini('720/status1/phoneSkin.ini'))((await ini('720/status1/phoneSkin.ini'))('Key_Q', 'BG_IMAGES'), 'NORMAL'), qSkin(own, 'NORMAL'))
  await clearSelection()
  const qPixel = await pixel(q.corner)
  assert.ok(near(qPixel, BLUE), `the canvas shows the key slice: ${qPixel}`)

  await selectKey('q')
  await replaceStyle('fore-normal', png(1080, 720, RED))
  const qKeys = await ini('1080/status1/keys.ini')
  const fore = qKeys('Key_Q', 'FG_IMAGES')
  assert.notEqual(fore, 'Foground_key_Q')
  assert.match(qKeys(fore, 'NORMAL'), /^replace_image3_\d+\.png$/)
  assert.equal(qKeys(fore, 'PRESSED'), '26q_x.png', 'the pressed foreground is kept')
  assert.equal(qKeys('Key_Q', 'FG_RECT'), '0,0,1,1')
  await clearSelection()

  await replaceStyle('candidate', png(1080, 120, BLUE))
  const barSkin = await ini('1080/status1/phoneSkin.ini')
  const bar = barSkin('CandidateView', 'BG_IMAGE')
  assert.equal(barSkin(bar, 'NORMAL'), 'replace_image4.png')
  assert.equal(barSkin('CandidateView', 'BG_STYLE'), '1')

  // Layout-follows-image is not offered: Sogou places the keys.
  await menuItem('#replace-layout-image')
  await page.locator('#layout-image-dialog[open]').waitFor()
  await page.locator('input[name="layout-image-target"][value="key-normal"]').check()
  assert.equal(await page.locator('[data-layout-image-config="layout-follows-image"]').isVisible(), false)
  await page.keyboard.press('Escape')

  const ssfSaved = await savedFiles()
  const pkg = SsfPackage.fromFiles(new Map(Object.entries(ssfSaved)))
  assert.equal(pkg.skin('light').get('RootView', 'BG_IMAGE'), 'replace_image.png')
  assert.ok(pkg.file('light', 'replace_image4.png'), 'saved pictures reopen with the skin')
  assert.ok(!Object.keys(ssfSaved).some((path) => /^(?:light|dark)\//.test(path)), 'no Baidu preview files are saved')
  for (let step = 0; step < 4; step++) await history('undo')
  for (const path of looks) assert.equal(await text(path), ssfOriginal[path], `every replacement is one undo step (${path})`)
  console.log('Sogou: iOS 26 in every look, resolution copy with time.ini, style replacement in every resolution folder')

  assert.deepEqual(errors, [])
} finally {
  await browser.close()
  await server.close()
}
