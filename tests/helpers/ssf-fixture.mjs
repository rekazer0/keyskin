// A small but complete Sogou phone skin built in code, so tests need no third-party skins.
// Every part has its own colour, which lets tests follow it through a conversion.
import { strToU8, zipSync, zlibSync } from 'fflate'
import { encodePng } from '../../src/ssf/ssf-png.ts'

export const SIZES = {
  key26: [98, 142], key9: [234, 160], icon: [40, 40], fgQ: [98, 90], background: [1080, 846], bar: [1080, 126],
}

/** Solid RGBA image; `alpha` 0–255. */
export function solid(width, height, [r, g, b], alpha = 255) {
  const data = new Uint8Array(width * height * 4)
  for (let offset = 0; offset < data.length; offset += 4) data.set([r, g, b, alpha], offset)
  return { width, height, data }
}

const png = (width, height, rgb, alpha) => encodePng(solid(width, height, rgb, alpha))

/** Two horizontal bands: the top `split` rows in `top`, the rest in `bottom`. */
function bands(width, height, split, top, bottom) {
  const image = solid(width, height, bottom)
  for (let y = 0; y < split; y++) for (let x = 0; x < width; x++) image.data.set([...top, 255], (y * width + x) * 4)
  return encodePng(image)
}

export function wav(samples = 32) {
  const bytes = new Uint8Array(44 + samples * 2)
  const view = new DataView(bytes.buffer)
  const ascii = (offset, text) => [...text].forEach((char, index) => { bytes[offset + index] = char.charCodeAt(0) })
  ascii(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); ascii(8, 'WAVE')
  ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  ascii(36, 'data'); view.setUint32(40, samples * 2, true)
  for (let index = 0; index < samples; index++) view.setInt16(44 + index * 2, index % 2 ? 6000 : -6000, true)
  return bytes
}

/** Colours per theme; dark mirrors light so tests can tell the two statuses apart. */
export const COLORS = {
  light: {
    letterKey: [200, 10, 10], qKey: [10, 200, 10], qKeyPressed: [10, 120, 10], nineKey: [10, 10, 200], functionKey: [120, 120, 0],
    space: [0, 120, 120], qGlyph: [250, 250, 0], icon: [255, 0, 255], abcGlyph: [0, 255, 255], barTop: [30, 30, 30], keyboard: [90, 90, 90],
    codeBack: [5, 6, 7], codeCell: [8, 9, 10],
  },
  dark: {
    letterKey: [100, 0, 0], qKey: [0, 100, 0], qKeyPressed: [0, 60, 0], nineKey: [0, 0, 100], functionKey: [60, 60, 0],
    space: [0, 60, 60], qGlyph: [125, 125, 0], icon: [128, 0, 128], abcGlyph: [0, 128, 128], barTop: [15, 15, 15], keyboard: [45, 45, 45],
    codeBack: [11, 12, 13], codeCell: [14, 15, 16],
  },
}

export const TEXT = {
  light: { qwerty: '0xFF112233', qwertyPressed: '0xFF445566', candidate: '0xFF010203', candidateHighlight: '0xFFAA0000' },
  dark: { qwerty: '0xFFDDEEFF', qwertyPressed: '0xFFCCBBAA', candidate: '0xFFF0F0F0', candidateHighlight: '0xFFFF8080' },
}

function statusFiles(theme) {
  const c = COLORS[theme]
  const t = TEXT[theme]
  const [kw, kh] = SIZES.key26
  const [nw, nh] = SIZES.key9
  const phoneSkin = `[RootView]
BG_STYLE=1
BG_IMAGE=bg.png
[CandidateView]
BG_STYLE=1
BG_IMAGE=BgCandidate1
[BgCandidate1]
NORMAL=bar.png,0,1,1,0,1,1
[ComposingView]
BG_STYLE=2
BG_COLOR=0xFFE9E9E9
[CandidateCodeView]
BG_IMAGE=BgCode
BG_IMAGES=KeyBg_UserSym
[BgCode]
NORMAL=code_bg.png,1,9,1,9
[KeyBg_UserSym]
NORMAL=code_cell.png
PRESSED=code_cell.png
[KeyBg_Default_Latin]
NORMAL=26key.png,1,${kw - 1},1,${kh - 1}
PRESSED=26key.png,1,${kw - 1},1,${kh - 1}
[KeyBg_Default]
NORMAL=9key.png,1,${nw - 1},1,${nh - 1}
PRESSED=9key.png,1,${nw - 1},1,${nh - 1}
[KeyBg_Function_Qwerty]
NORMAL=26fn.png,1,${kw - 1},1,${kh - 1}
[KeyBg_Function]
NORMAL=9fn.png,1,${nw - 1},1,${nh - 1}
[KeyBg_Space_Qwerty]
NORMAL=26space.png,1,271,1,141
[KeyBg_Space]
NORMAL=9space.png,1,349,1,151
[Key_Q]
BG_IMAGES=SMA_Key26Bg_Q
[SMA_Key26Bg_Q]
NORMAL=26keyq.png,2,${kw - 2},3,${kh - 3}
PRESSED=26keyq_press.png,2,${kw - 2},3,${kh - 3}
[Key_Backspace_Qwerty]
BG_IMAGES=SMA_Key26Bg_Backspace_Qwerty
ICON=delf_26.png
[SMA_Key26Bg_Backspace_Qwerty]
NORMAL=26fn.png,1,${kw - 1},1,${kh - 1}
[Key_Space]
ICON=transparent.png
[TextStyle_Qwerty]
TEXT_COLOR=${t.qwerty}
TEXT_COLOR_PRESSED=${t.qwertyPressed}
[TextStyle_Candidate]
TEXT_COLOR=${t.candidate}
[TextStyle_Candidate_Highlight]
TEXT_COLOR=${t.candidateHighlight}
`
  const keys = `[Key_Q]
ANIM_STYLE=Anim_Style_Key_Qwertys
FG_IMAGES=Foground_key_Q
FG_RECT=0,0.25,1,0.75
[Foground_key_Q]
NORMAL=26q_x.png
PRESSED=26q_x.png
[Key_ABC]
FG_IMAGES=Foground_key_ABC
FG_RECT=0,0,1,1
[Foground_key_ABC]
NORMAL=902.png
PRESSED=902.png
`
  return {
    'phoneSkin.ini': strToU8(phoneSkin),
    'keys.ini': strToU8(keys),
    'anim.ini': strToU8('[Anim_Style_Key]\nTYPE=1\n'),
    'bg.png': bands(...SIZES.background, SIZES.bar[1], c.barTop, c.keyboard),
    'bar.png': png(...SIZES.bar, [255, 255, 255], 128),
    '26key.png': png(kw, kh, c.letterKey),
    '26keyq.png': png(kw, kh, c.qKey),
    '26keyq_press.png': png(kw, kh, c.qKeyPressed),
    '9key.png': png(nw, nh, c.nineKey),
    '26fn.png': png(kw, kh, c.functionKey),
    '9fn.png': png(nw, nh, c.functionKey),
    '26space.png': png(272, 142, c.space),
    '9space.png': png(350, 152, c.space),
    '26q_x.png': png(...SIZES.fgQ, c.qGlyph),
    'delf_26.png': png(...SIZES.icon, c.icon),
    '902.png': png(nw, 154, c.abcGlyph),
    'code_bg.png': png(10, 10, c.codeBack),
    'code_cell.png': png(10, 10, c.codeCell),
  }
}

/** The fixture as `.ssf` bytes. `single` builds a one-look skin without time.ini. */
export function ssfFixture({ single = false } = {}) {
  const files = {
    'phoneTheme.ini': strToU8('[General]\nskin_type=1\nskin_name=测试皮肤\nskin_author=测试作者\nskin_version=10000\nsupports-screens=1080,720\n'),
    'square_preview.png': png(16, 16, [1, 2, 3]),
    'default/sound_android.ini': strToU8(';默认按键\n[Key]\nsound=s_code\n[Key_Backspace_Qwerty]\nsound=s_del\n'),
    'default/s_code.wav': wav(),
    'default/s_del.wav': wav(48),
    'default/res/day_keyboard_start.webp': strToU8('RIFF0000WEBP'),
  }
  if (single) {
    for (const [name, bytes] of Object.entries(statusFiles('light'))) files[`1080/${name}`] = bytes
  } else {
    // Listed night first: the day look is the status shown at noon, not the first one.
    files['time.ini'] = strToU8('[General]\nSUPPORT_SCREEN=1080\nVERSION=1\n[1080]\nLOOP_TYPE=1\nSTATUS_LIST=status2,status1\n[status1]\nSTART=7\nEND=18\n[status2]\nSTART=0,19\nEND=6,23\n')
    for (const theme of ['light', 'dark']) {
      const folder = theme === 'light' ? 'status1' : 'status2'
      for (const [name, bytes] of Object.entries(statusFiles(theme))) files[`1080/${folder}/${name}`] = bytes
    }
  }
  return zipSync(files)
}

const hex = (value) => Uint8Array.from(value.match(/../g), (pair) => Number.parseInt(pair, 16))

/**
 * Packs files into Sogou's encrypted "Skin" container, written straight from the unSSF / ssf-extractor
 * layout so the reader is checked against the format rather than against itself.
 */
export async function skinContainer(files, { version = 3, declared } = {}) {
  const entries = Object.entries(files).map(([name, body]) => {
    const nameBytes = new Uint8Array(name.length * 2)
    for (let index = 0; index < name.length; index++) new DataView(nameBytes.buffer).setUint16(index * 2, name.charCodeAt(index), true)
    const entry = new Uint8Array(8 + nameBytes.length + body.length)
    const view = new DataView(entry.buffer)
    view.setUint32(0, nameBytes.length, true)
    entry.set(nameBytes, 4)
    view.setUint32(4 + nameBytes.length, body.length, true)
    entry.set(body, 8 + nameBytes.length)
    return entry
  })
  const tableBytes = entries.length * 4
  const raw = new Uint8Array(8 + tableBytes + entries.reduce((total, entry) => total + entry.length, 0))
  const view = new DataView(raw.buffer)
  view.setUint32(0, raw.length, true)
  view.setUint32(4, tableBytes, true)
  let offset = 8 + tableBytes
  entries.forEach((entry, index) => {
    view.setUint32(8 + index * 4, offset, true)
    raw.set(entry, offset)
    offset += entry.length
  })
  const compressed = zlibSync(raw)
  const plain = new Uint8Array(4 + compressed.length)
  new DataView(plain.buffer).setUint32(0, declared ?? raw.length, true)
  plain.set(compressed, 4)
  const key = await crypto.subtle.importKey('raw', hex('5236461AD38503669045162879033623DDBE6F03FF04E3CAD57FFCA350E49ED9'), 'AES-CBC', false, ['encrypt'])
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv: hex('E07AAD35E090AA038A51FD05DF8C5D0F') }, key, plain))
  const out = new Uint8Array(8 + encrypted.length)
  out.set(strToU8('Skin'))
  new DataView(out.buffer).setUint32(4, version, true)
  out.set(encrypted, 8)
  return out
}
