// 搜狗导出缩图：百度皮肤的原图分辨率比官方骨架的按键大，导出时按骨架尺寸等比缩小。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { IniDocument } from '../src/ini.ts'
import { SkinArchive } from '../src/skin.ts'
import { convertBaiduToSsf } from '../src/ssf/baidu-to-ssf.ts'
import { exportSsf } from '../src/ssf/ssf-convert.ts'
import { sogouKeySizes } from '../src/ssf/ssf-key-sizes.ts'
import { SsfPackage } from '../src/ssf/ssf-package.ts'
import { convertSsfToBaidu } from '../src/ssf/ssf-to-baidu.ts'
import { decodePng, encodePng } from '../src/ssf/ssf-png.ts'

const read = (path) => new Uint8Array(readFileSync(new URL(path, import.meta.url)))
const sogouTemplate = SkinArchive.open(read('../public/sogou-template.bds'))
const baiduTemplate = SkinArchive.open(read('../public/default-template.bds'))

const NINE = [324, 232]
const LETTER = [146, 178]
const COLORS = { nine: [200, 10, 10], ninePressed: [10, 200, 10], letter: [10, 10, 200], frameMiddle: [128, 128, 128] }
const FRAME = { left: 20, top: 10, right: 300, bottom: 220, colors: { left: [255, 0, 0], right: [0, 255, 0], top: [0, 0, 255], bottom: [255, 255, 0] } }

const pixel = (image, x, y) => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)]
const rgb = (image, x, y) => pixel(image, x, y).slice(0, 3)

function solid(width, height, [r, g, b]) {
  const data = new Uint8Array(width * height * 4)
  for (let offset = 0; offset < data.length; offset += 4) data.set([r, g, b, 255], offset)
  return { width, height, data }
}

/** 中间区域可拉伸的九宫格图：四条边各一个颜色，中间一个颜色，导出后能看出边界是否被保留。 */
function frame(width, height) {
  const image = solid(width, height, COLORS.frameMiddle)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const color = x < FRAME.left ? FRAME.colors.left
      : x >= FRAME.right ? FRAME.colors.right
        : y < FRAME.top ? FRAME.colors.top
          : y >= FRAME.bottom ? FRAME.colors.bottom
            : COLORS.frameMiddle
    image.data.set([...color, 255], (y * width + x) * 4)
  }
  return image
}

/** 一个按键图比骨架按键大的 BDS：9 键背景 324×232，26 键背景 146×178，另有一个九宫格背景。 */
function bigArtBds() {
  return zipSync({
    'Info.txt': strToU8('Name=大图皮肤\nAuthor=我\n'),
    'port/gen.ini': strToU8([
      '[PANEL]', 'SIZE=1080,595', 'BACK_STYLE=1',
      '[CAND]', 'LAYOUT_NAME=cand1',
    ].join('\n')),
    'port/py_9.ini': strToU8([
      '[PANEL]', 'SIZE=1080,595', 'KEY_NUM=1',
      '[KEY1]', 'CENTER=b', `VIEW_RECT=0,0,${NINE[0]},${NINE[1]}`, 'BACK_STYLE=2',
    ].join('\n')),
    'port/py_26.ini': strToU8([
      '[PANEL]', 'SIZE=1080,595', 'KEY_NUM=2',
      '[KEY1]', 'CENTER=q', `VIEW_RECT=0,0,${LETTER[0]},${LETTER[1]}`, 'BACK_STYLE=3',
      '[KEY2]', 'CENTER=w', `VIEW_RECT=0,0,${NINE[0]},${NINE[1]}`, 'BACK_STYLE=4',
    ].join('\n')),
    'res/default.css': strToU8([
      '[STYLE1]', 'NM_COLOR=FF202020',
      '[STYLE2]', 'NM_IMG=nine,1', 'HL_IMG=nine_pressed,1',
      '[STYLE3]', 'NM_IMG=letter,1', 'HL_IMG=letter,1',
      '[STYLE4]', 'NM_IMG=frame,1', 'HL_IMG=frame,1',
    ].join('\n')),
    'res/nine.til': strToU8(`[IMG1]\nSOURCE_RECT=0,0,${NINE[0]},${NINE[1]}\n`),
    'res/nine.png': encodePng(solid(NINE[0], NINE[1], COLORS.nine)),
    'res/nine_pressed.til': strToU8(`[IMG1]\nSOURCE_RECT=0,0,${NINE[0]},${NINE[1]}\n`),
    'res/nine_pressed.png': encodePng(solid(NINE[0], NINE[1], COLORS.ninePressed)),
    'res/letter.til': strToU8(`[IMG1]\nSOURCE_RECT=0,0,${LETTER[0]},${LETTER[1]}\n`),
    'res/letter.png': encodePng(solid(LETTER[0], LETTER[1], COLORS.letter)),
    'res/frame.til': strToU8(`[IMG1]\nSOURCE_RECT=0,0,${NINE[0]},${NINE[1]}\nINNER_RECT=${FRAME.left},${FRAME.top},${FRAME.right - FRAME.left},${FRAME.bottom - FRAME.top}\n`),
    'res/frame.png': encodePng(frame(NINE[0], NINE[1])),
  })
}

const bds = () => SkinArchive.open(bigArtBds())

/** One status folder (single-theme exports write `1080/` without a status folder). */
function phoneSkin(bytes) {
  const files = unzipSync(bytes)
  const path = Object.keys(files).find((name) => /^\d+\/(?:[^/]+\/)?phoneSkin\.ini$/.test(name))
  assert.ok(path, '导出应该包含 phoneSkin.ini')
  return { files, folder: path.slice(0, path.lastIndexOf('/') + 1), skin: IniDocument.parse(new TextDecoder().decode(files[path])) }
}

/** 背景类 section 的 NORMAL 指向的图片。 */
function background(files, folder, skin, section) {
  const [name, ...stretch] = skin.get(section, 'NORMAL').split(',').map((value) => value.trim())
  const bytes = files[`${folder}${name}`]
  assert.ok(bytes, `${section} 的 NORMAL 指向的 ${name} 应该在包里`)
  return { name, stretch, image: decodePng(bytes) }
}

test('sogouKeySizes: 官方骨架里每个按键类的最大显示尺寸', () => {
  const sizes = sogouKeySizes(sogouTemplate)
  // 9 键竖屏 234×160、横屏 416×141；26 键竖屏 98×142、横屏 180×129。
  assert.deepEqual(sizes.get('Key_ABC'), [234, 160])
  assert.deepEqual(sizes.get('Key_ABC_Land'), [416, 141])
  assert.deepEqual(sizes.get('Key_Q'), [98, 142])
  assert.deepEqual(sizes.get('Key_Q_Land'), [180, 129])
  // 共享默认背景类也参与缩图。
  assert.ok(sizes.has('KeyBg_Default_Latin'))
})

test('百度 → 搜狗：按键背景按骨架尺寸等比缩小，NORMAL/PRESSED 仍能解析', async () => {
  const { bytes } = await convertBaiduToSsf(bds(), { keySizes: sogouKeySizes(sogouTemplate) })
  const { files, folder, skin } = phoneSkin(bytes)

  const nine = background(files, folder, skin, 'SMA_Key9Bg_ABC')
  assert.ok(nine.image.width <= 234 && nine.image.height <= 160, `9 键背景 ${nine.image.width}×${nine.image.height} 应放得进 234×160`)
  assert.deepEqual([nine.image.width, nine.image.height], [223, 160])
  // 正常与按下是两个不同文件，且都还在。
  const pressedFile = skin.get('SMA_Key9Bg_ABC', 'PRESSED').split(',')[0]
  assert.notEqual(pressedFile, nine.name)
  assert.deepEqual(rgb(nine.image, 10, 10), COLORS.nine)
  assert.deepEqual(rgb(decodePng(files[`${folder}${pressedFile}`]), 10, 10), COLORS.ninePressed)
  assert.deepEqual([decodePng(files[`${folder}${pressedFile}`]).width, decodePng(files[`${folder}${pressedFile}`]).height], [223, 160])

  const letter = background(files, folder, skin, 'SMA_Key26Bg_Q')
  assert.deepEqual([letter.image.width, letter.image.height], [98, 119])
  assert.deepEqual(rgb(letter.image, 10, 10), COLORS.letter)

  // 每个按键背景的 NORMAL/PRESSED/DISABLED 等都指向包里存在的图片。
  for (const section of skin.sections()) {
    for (const state of ['NORMAL', 'PRESSED', 'DISABLED', 'NORMAL_ON', 'PRESSED_ON']) {
      const value = skin.get(section, state)
      if (!value) continue
      const [name] = value.split(',')
      assert.ok(files[`${folder}${name}`], `${section}.${state} 指向的 ${name} 应该在包里`)
    }
  }
})

test('百度 → 搜狗：九宫格背景保留四边像素，可拉伸的中间压到 1px', async () => {
  const { bytes } = await convertBaiduToSsf(bds(), { keySizes: sogouKeySizes(sogouTemplate) })
  const { files, folder, skin } = phoneSkin(bytes)
  const value = skin.get('SMA_Key26Bg_W', 'NORMAL')
  const [name, ...stretch] = value.split(',').map((part) => part.trim())
  assert.deepEqual(stretch, [String(FRAME.left), String(FRAME.left + 1), String(FRAME.top), String(FRAME.top + 1)])
  const image = decodePng(files[`${folder}${name}`])
  // 四条边各保留原来的像素宽度，中间只剩 1px。
  assert.deepEqual([image.width, image.height], [FRAME.left + 1 + (NINE[0] - FRAME.right), FRAME.top + 1 + (NINE[1] - FRAME.bottom)])
  assert.deepEqual(rgb(image, 0, 5), FRAME.colors.left)
  assert.deepEqual(rgb(image, image.width - 1, 5), FRAME.colors.right)
  assert.deepEqual(rgb(image, FRAME.left, 2), FRAME.colors.top)
  assert.deepEqual(rgb(image, FRAME.left, image.height - 1), FRAME.colors.bottom)
  // 中间那条被压成 1px 后只剩原来的中间色。
  assert.deepEqual(rgb(image, FRAME.left, FRAME.top), COLORS.frameMiddle)
})

test('百度 → 搜狗：不传 keySizes 时保持原图尺寸（老行为不变）', async () => {
  const { bytes } = await convertBaiduToSsf(bds())
  const { files, folder, skin } = phoneSkin(bytes)
  assert.deepEqual([background(files, folder, skin, 'SMA_Key9Bg_ABC').image.width, background(files, folder, skin, 'SMA_Key9Bg_ABC').image.height], NINE)
  assert.deepEqual([background(files, folder, skin, 'SMA_Key26Bg_Q').image.width, background(files, folder, skin, 'SMA_Key26Bg_Q').image.height], LETTER)
})

test('exportSsf 传入官方骨架时缩图，缩过的小图回转眼机观感不变', async () => {
  const big = await exportSsf(bds(), undefined, sogouTemplate)
  const plain = await exportSsf(bds(), undefined)
  assert.ok(big.bytes.length < plain.bytes.length, '缩图后导出应该更小')
  const small = phoneSkin(big.bytes)
  const nine = background(small.files, small.folder, small.skin, 'SMA_Key9Bg_ABC')
  assert.deepEqual([nine.image.width, nine.image.height], [223, 160])

  // 缩小的图转回百度，按键颜色（观感）仍然一致，允许重采样误差。
  const { archive } = convertSsfToBaidu(await SsfPackage.open(big.bytes), baiduTemplate)
  const port = IniDocument.parse(archive.getText('light/skin/port/py_9.ini'))
  const key = port.sections().find((section) => /^KEY\d+$/.test(section) && port.get(section, 'CENTER') === 'b')
  assert.ok(key, '百度骨架应该有 9 键的 b 键')
  const css = IniDocument.parse(archive.getText('light/skin/res/default.css'))
  const [imageName] = css.get(`STYLE${port.get(key, 'BACK_STYLE').split(',')[0]}`, 'NM_IMG').split(',')
  const image = decodePng(archive.getBytes(`light/skin/res/${imageName}.png`))
  const center = rgb(image, Math.floor(image.width / 2), Math.floor(image.height / 2))
  for (const [index, channel] of COLORS.nine.entries()) assert.ok(Math.abs(center[index] - channel) <= 2, `回转眼机颜色 ${center} 应约等于 ${COLORS.nine}`)
})
