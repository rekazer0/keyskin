// Rebuild the preview skeleton from the official APK. No Baidu layout or artwork is used.
// node scripts/extract-sogou-template.mjs /path/to/SogouInput.apk [output.bds]
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate'
import { IniDocument } from '../src/ini.ts'
import { pngSize } from '../src/ssf/ssf-png.ts'

const input = process.argv[2]
if (!input) throw new Error('Usage: node scripts/extract-sogou-template.mjs SogouInput.apk [output.bds]')
const bytes = readFileSync(input)
const apk = unzipSync(bytes)
const root = 'assets/theme/theme_default/1080/'
const foreign = 'assets/foreign/1/theme/1080/phone/'
const sources = new Set()
function ini(path) {
  assert.ok(apk[path], `Missing official layout: ${path}`)
  sources.add(path)
  return IniDocument.parse(strFromU8(apk[path]))
}
function merge(...docs) {
  const sections = new Map()
  for (const doc of docs) for (const { section, key, value } of doc.entries()) {
    if (!sections.has(section)) sections.set(section, new Map())
    sections.get(section).set(key, value)
  }
  return IniDocument.parse([...sections].map(([section, entries]) => `[${section}]\n${[...entries].map(([key, value]) => `${key}=${value}`).join('\n')}`).join('\n'))
}

const template = ini(root + 'layout/template.ini')
const english = ini(foreign + 'layout/template.ini')
const images = ini(root + 'layout/images_config.ini')
const imageList = ini(root + 'layout/image_list.ini')
const cands = ini(root + 'layout/cands.ini')
const css = IniDocument.parse('')
const files = {}
let nextStyle = 1
const resourceNames = new Map()
function style(entries) {
  const id = String(nextStyle++)
  css.appendSection(`STYLE${id}`, Object.entries(entries).map(([key, value]) => ({ key, value: String(value) })))
  return id
}
/**
 * A switch key's label and minor label ("中" "/英") as Baidu text layers, which Baidu centres on the key
 * plus each FORE_OFFSET. Measured on Sogou's own skin previews: with LABEL_ORIENTATION=1 the two sit in
 * one bottom-aligned row centred on the key, the label centred at LABEL_BASELINE's height, and the font
 * sizes come out at 3/4 of the INI values (sized for a 1440-wide screen).
 */
function labelRow(label, minor, field, width, height) {
  const sizes = [Number(field('LABEL_FONT_SIZE')) || 42, Number(field('MINOR_FONT_SIZE')) || 31].map((size) => Math.round(size * 0.75))
  // CJK glyphs are about 1em wide, Latin and punctuation about half that.
  const widths = [label, minor].map((text, index) => [...text].reduce((sum, char) => sum + (char.charCodeAt(0) > 0x2e80 ? 1 : 0.5), 0) * sizes[index])
  const centreY = (Number(field('LABEL_BASELINE')?.split(',')[1]) || 0.5) * height
  let x = (width - widths[0] - widths[1]) / 2
  return [label, minor].map((text, index) => {
    const centreX = x + widths[index] / 2
    x += widths[index]
    const y = centreY + (sizes[0] - sizes[index]) * 0.45
    return { style: style({ SHOW: text, FONT_SIZE: sizes[index], NM_COLOR: 'FF373737', HL_COLOR: 'FF373737' }), offset: `${Math.round(centreX - width / 2)},${Math.round(y - height / 2)}` }
  })
}
function image(ref) {
  if (!ref) return
  const spec = images.get(ref, 'IMAGE') ?? ref
  const [filename, ...stretch] = spec.split(',')
  const path = root + 'res/white/' + filename
  const data = apk[path]
  const size = data && pngSize(data)
  if (!size) return
  sources.add(path)
  let name = resourceNames.get(path)
  if (!name) {
    name = `sg${resourceNames.size + 1}`
    resourceNames.set(path, name)
    files[`res/${name}.png`] = data
    const [w, h] = size
    const band = stretch.slice(0, 4).map(Number)
    const inner = band.length === 4 && band[0] < band[1] && band[2] < band[3]
      ? `INNER_RECT=${band[0]},${band[2]},${band[1] - band[0]},${band[3] - band[2]}\n` : ''
    files[`res/${name}.til`] = strToU8(`[GLOBAL]\nTILE_NUM=1\n[IMG1]\nSOURCE_RECT=0,0,${w},${h}\n${inner}`)
  }
  return `${name},1`
}
function imageStyle(normal, pressed) {
  const nm = image(normal)
  return nm ? style({ NM_IMG: nm, HL_IMG: image(pressed) ?? nm }) : undefined
}
function background(ref) {
  return imageStyle(imageList.get(ref, 'NORMAL'), imageList.get(ref, 'PRESSED'))
}
// Composite slots inherit their initial display from the selected child; geometry stays on the slot.
function foregroundField(doc, real, section) {
  const toggle = doc.get(real, 'T_KEYS')?.split(',')[Number(doc.get(real, 'T_FLAG')) || 0]
  const selected = doc.get(real, 'S_KEY') ?? doc.get(real, 'S_KEYS')?.split(',')[Number(doc.get(real, 'S_FLAG')) || 0]
  const ownDisplay = ['ICON', 'ICONS', 'LABEL', 'TEXT'].some((key) => doc.get(real, key)?.trim())
  const owners = ownDisplay ? [real] : [...new Set([real, toggle, selected, section].filter(Boolean))]
  return (key) => owners.map((owner) => doc.get(owner, key)).find((value) => value?.trim())
}
const panelStyle = background('Background')
const candStyle = background('BgCandidate1')
const textStyle = style({ NM_COLOR: 'FF373737', HL_COLOR: 'FF373737', FONT_SIZE: 48 })
const aliases = { Key_ClearInput_NewLine: 'Key_Clear_Input', Key_Apostrophe_Shift: 'Key_Separator', Key_Space_py9: 'Key_Space', Key_Space_Qwerty: 'Key_Space', Key_Edits: 'Key_0_py9', Key_Edits_en9: 'Key_0_py9', Key_EnPreSwitchToCH: 'Key_EnSwitchToCH', Key_EnPreSwitchToCH_Qwerty: 'Key_EnSwitchToCH_Qwerty' }
const actions = { Key_Backspace: 'F36', Key_Backspace_Qwerty: 'F36', Key_Clear_Input: 'F40', Key_SymbolTable: 'F1', Key_SymbolTable_Qwerty: 'F1', Key_Digits: 'F6', Key_Symbols_Qwerty: 'F6', Key_Space: 'F38', Key_Space_Digit: 'F38', Key_Space_HW: 'F38', Key_Enter: 'F39', Key_Enter_Qwerty: 'F39', Key_SwitchToEN: 'F16', Key_SwitchToEN_Qwerty: 'F16', Key_BHSwitchToEn: 'F16', Key_EnSwitchToCH: 'F15', Key_EnSwitchToCH_Qwerty: 'F15', Key_Shift: 'F10', Key_Shift_Qwerty: 'F10', Key_Separator: "'", Key_PinyinLock: "'", Key_PunctPY: "'", Key_Punct: '…', Key_0_py9: '0', Key_Return: 'F4', Key_Prediction_En9: 'F25', Key_UDSymbol1_Qwerty: '，', Key_UDSymbol2_Qwerty: '。', Key_CommaEn_T: ',', Key_PeriodEn_T: '.', Key_One: 'B1', Key_Two: 'B2', Key_Three: 'B3', Key_Four: 'B4', Key_Five: 'B5', Key_Wildcard: 'B6', Key_Separator_bh_S: "'", Key_Eight_S: '：', Key_Nine_S: '；', Key_BackSpace: 'F36', Key_HWSwitchToEN: 'F16', Key_Separator_DP: "'", Key_Separator_LAND_DP: "'", Key_PeriodEn_P: '.', Key_Return_Korean: 'F4' }
const groups = { ABC: 'b', DEF: 'e', GHI: 'h', JKL: 'k', MNO: 'n', PQRS: 'q', TUV: 'u', WXYZ: 'x' }
function action(section, doc) {
  const canonical = section.replace(/_Land/g, '').replace(/_(PY|EN)$/, '')
  if (canonical === 'Key_Space_py9_DP') return 'F38'
  if (canonical === 'Key_PunctPY_DP') return "'"
  if (actions[canonical]) return actions[canonical]
  if (canonical === 'Key_Return_Symbol') return 'F4'
  if (canonical === 'Key_Space_Korean_Symbol') return 'F38'
  if (canonical === 'Key_SymbolTable_Qwerty_SD') return 'F1'
  if (doc.get(section, 'TEXT')) return doc.get(section, 'TEXT')
  // Double-pinyin, English-with-digits and 26-key digit classes are plain letters and digits.
  const token = canonical.replace(/^Key_/, '').replace(/_(?:PY_DP|DP|EN_DIGIT|Qwerty)$/, '')
  if (groups[token]) return groups[token]
  if (token.length === 1 && !/[A-Z]/.test(token)) return token
  if (/^[A-Z]$/.test(token)) return token.toLowerCase()
  const code = Number(doc.get(section, 'CODES')?.split(',')[0])
  if (Number.isInteger(code) && code > 0) return String.fromCodePoint(code)
  // Keys with no Baidu action (handwriting setting, voice) keep their Sogou class as a function command.
  unmapped.add(canonical)
  return `Z+${canonical}`
}
const unmapped = new Set()
// Each board stacks official files like the app does: base keyboard, then its deltas. `f/` is the
// English package; `port|land` picks a file per orientation, and an empty side skips that orientation.
const boards = [
  ['py_9', '9', 'py_9'], ['def_9', '9', 'py_9'], ['py_26', '26', 'py_26'], ['def_26', '26', 'py_26', 'wubi'],
  ['py_14', 'py_14'], ['py_26_double_input', '26', 'py_26', 'py_26_double_input'],
  ['py_9_double_input', '9', 'py_9', 'py_9_double_input'], ['py_9_big_enter', '9', 'py_9', 'py_9_big_enter'],
  ['py_9_big_enter_double_input', '9', 'py_9', 'py_9_double_input', 'py_9_big_enter_double_input'],
  ['big_9', '9', 'py_9', 'big_9'], ['cantonese_9', '9', 'py_9', 'cantonese_9'],
  ['cantonese_9_big_enter', '9', 'py_9', 'cantonese_9', 'cantonese_9_big_enter'], ['cantonese_26', '26', 'py_26', 'cantonese_26'],
  ['bh', '9', 'bh'], ['bh_big_enter', '9', 'bh', 'bh_big_enter'], ['num_9', '9', 'digit_9'], ['num_26_1', '26', 'cn_symbol_digit_26'],
  ['foreign_digit', 'foreign_digit'],
  ['handwriting', 'handwriting|handwriting_landscape'], ['handwriting_full', 'handwriting_portait_full|handwriting_landscape_full'],
  ['handwriting_grid', 'handwriting|', 'handwriting_grid|'], ['handwriting_frosted_glass', 'handwriting|', 'handwriting_frosted_glass|'],
  ['handwriting_ink_printing', 'handwriting|', 'handwriting_ink_printing|'], ['voice', 'voice'],
  ['en_26', 'f/65536'], ['en_26s', 'f/65536'], ['en_9', 'f/9', 'f/65537'], ['en_9s', 'f/9', 'f/65537'],
  ['en_symbol', 'f/65538'], ['en_digit', 'f/9', 'f/65539'], ['en_26_digits', 'f/65540'], ['en_9_multi', 'f/9', 'f/65541'],
  ['en_26_pro', 'f/65544'], ['en_26_pro_digits', 'f/65545'],
]
for (const orientation of ['port', 'land']) {
  const offsets = new Map()
  const width = orientation === 'port' ? 1080 : 1920
  const genHeight = Math.round(width * Number(ini(root + orientation + '/9.ini').get('Keyboard', 'H')))
  const candHeight = Math.round(1080 * Number(cands.get('CandidateView', 'H')))
  // Baidu's gen.ini identifies the normal candidate layout with TYPE=4.
  files[`${orientation}/gen.ini`] = strToU8(`[PANEL]\nSIZE=${width},${genHeight}\nBACK_STYLE=${panelStyle}\n[CAND]\nTYPE=4\nLAYOUT_NAME=cand1\nVIEW_RECT=0,0,${width},${candHeight}\n[INPUT]\nFORE_STYLE=${textStyle}\n`)
  const cand = IniDocument.parse(`[CAND]\nBACK_STYLE=${candStyle}\nFORE_STYLE=${textStyle}\nPADDING=12,0,12,0\nFIRST_GAP=12\nCELL_W=60\n`)
  // The Baidu skin manual requires SWITCH even when custom icons replace the F14 container.
  cand.appendSection('SWITCH', [
    { key: 'NML_FONT_STYLE', value: textStyle }, { key: 'SEL_FONT_STYLE', value: textStyle },
    { key: 'PADDING', value: '0' },
  ])
  // Sogou 20.x's default toolbar (the order its own skin previews show); the app sets it in code, not in an INI.
  const toolbar = ['logo_png', 'ime_function_expression_png', 'ime_function_switch_png', 'ime_function_voice_png', 'ime_function_sousou_png', 'ime_function_fanlingxi_png', 'close_png']
  const toolbarActions = ['F31', 'F7', 'F13', 'F72', 'F82', 'F68', 'F8']
  cand.set('CAND', 'ICON_NUM', String(toolbar.length))
  toolbar.forEach((ref, index) => {
    const fore = imageStyle(ref, ref)
    // SSF_IMAGE names the official file, so a skin's same-named icon replaces it on the canvas.
    if (fore) cand.appendSection(`ICON${index + 1}`, [
      { key: 'FORE_STYLE', value: fore }, { key: 'SSF_IMAGE', value: (images.get(ref, 'IMAGE') ?? ref).split(',')[0] },
      { key: 'VIEW_RECT', value: `${Math.round(index * width / toolbar.length)},0,${Math.round(width / toolbar.length)},${candHeight}` },
      { key: 'SIZE', value: `${Math.round(width / toolbar.length)},${candHeight}` },
      { key: 'POS', value: `${Math.round(index * width / toolbar.length)},0` }, { key: 'ANCHOR_TYPE', value: '1' },
      { key: 'KEY', value: toolbarActions[index] }, { key: 'PERSIST', value: '1' },
    ])
  })
  files[`${orientation}/cand1.cnd`] = strToU8(cand.toString())
  for (const [name, ...layers] of boards) {
    const parts = layers.map((layer) => layer.includes('|') ? layer.split('|')[orientation === 'port' ? 0 : 1] : layer)
    if (parts.some((file) => !file)) continue
    const isForeign = parts.some((file) => file.startsWith('f/'))
    const docs = parts.map((file) => ini(file.startsWith('f/') ? foreign + orientation + '/' + file.slice(2) + '.ini' : root + orientation + '/' + file + '.ini'))
    const doc = merge(template, isForeign ? english : IniDocument.parse(''), ...docs)
    const height = Math.round(width * Number(doc.get('Keyboard', 'H')))
    assert.ok(width > 0 && height > 0, `${orientation}/${name}: ${doc.get('Keyboard', 'H')}`)
    const layout = IniDocument.parse(`[PANEL]\nSIZE=${width},${height}\n`)
    const gap = Number(doc.get('Keyboard', 'H_GAP_QWERTY') ?? 0) * width
    let count = 0
    // Paged boards (foreign_digit) show their first page.
    const rows = doc.get('Keyboard', 'ROWS') ?? doc.get(doc.get('Keyboard', 'PAGES')?.split(',')[0], 'ROWS')
    assert.ok(rows, `${orientation}/${name}: no ROWS`)
    let nextY = 0
    for (const row of rows.split(',')) {
      assert.ok(doc.get(row, 'KEYS'), `${orientation}/${name}: ${row} has no KEYS`)
      // Rows without H_OFFSET start inside the keyboard's left padding.
      let x = Number(doc.get(row, 'H_OFFSET') ?? doc.get('Keyboard', 'PADDINGS')?.split(',')[0] ?? 0) * width
      // Rows without V_OFFSET stack under the previous one.
      const y = doc.get(row, 'V_OFFSET') ? Number(doc.get(row, 'V_OFFSET')) * height : nextY
      for (const slot of doc.get(row, 'KEYS').split(',')) {
        const real = doc.get(slot, 'REAL_KEY') ?? slot
        const canonical = real.replace(/_Land/g, '')
        const section = aliases[canonical] ?? real
        const kw = Number(doc.get(slot, 'W') ?? doc.get('Key', 'W')) * width
        const kh = Number(doc.get(slot, 'H') ?? doc.get('Key', 'H')) * height
        if (kw === 0 || kh === 0) continue // hidden placeholder slots (py_14's Key_EMPTY_Fourteen_Keys)
        // X shifts only this key; rows still end where rows without X do.
        const rect = [x + Number(doc.get(slot, 'X') ?? 0) * width, y, kw, kh].map(Math.round)
        assert.ok(rect.every(Number.isFinite) && rect[2] > 0 && rect[3] > 0, `${name} ${slot}`)
        const back = background(doc.get(real, 'BG_IMAGES') ?? doc.get('Key', 'BG_IMAGES'))
        const field = foregroundField(doc, real, section)
        const label = field('LABEL')?.split(',')[0] ?? field('TEXT') ?? ''
        // Language switches supply both labels and optional icon groups; their default display is text.
        const iconGroup = !label ? field('ICONS')?.split(',')[0] : undefined
        const icon = field('ICON')?.split(',')[0] ?? imageList.get(iconGroup, 'NORMAL') ?? iconGroup
        const pressedIcon = field('ICON_PRESSED')?.split(',')[0] ?? imageList.get(iconGroup, 'PRESSED')
        const fgStyle = field('FG_STYLE')?.split(',')[0]
        const fontSize = Number(doc.get(fgStyle, 'LABEL_FONT_SIZE')) || 42
        const minor = field('MINOR_LABEL')?.split(',')[0]
        // shortcut: only the language switch keys get their minor label ("中/英"); add other FG styles when their previews need it.
        const texts = !icon && label && minor && /Switch/.test(fgStyle ?? '') && doc.get(fgStyle, 'MINOR_LABEL_VISIBLE') === '1' && doc.get(fgStyle, 'LABEL_ORIENTATION') === '1'
          ? labelRow(label, minor, (key) => doc.get(fgStyle, key), kw, kh)
          : undefined
        const positions = texts?.map(({ offset }) => {
          if (!offsets.has(offset)) offsets.set(offset, offsets.size + 1)
          return offsets.get(offset)
        })
        const fore = icon ? imageStyle(icon, pressedIcon)
          : texts ? texts.map((text) => text.style).join(',')
            : label ? style({ SHOW: label, FONT_SIZE: fontSize, NM_COLOR: 'FF373737', HL_COLOR: 'FF373737' }) : undefined
        layout.appendSection(`KEY${++count}`, [
          { key: 'CENTER', value: action(section, doc) }, { key: 'SSF_SECTION', value: section },
          // The background class the app names for this key, which a skin may restyle on its own.
          ...(doc.get(real, 'BG_IMAGES') ? [{ key: 'SSF_BG', value: doc.get(real, 'BG_IMAGES').split(',')[0] }] : []),
          { key: 'VIEW_RECT', value: rect.join(',') },
          ...(back ? [{ key: 'BACK_STYLE', value: back }] : []), ...(fore ? [{ key: 'FORE_STYLE', value: fore }] : []),
          ...(positions ? [{ key: 'POS_TYPE', value: positions.join(',') }] : []),
        ])
        x += kw + gap
        nextY = Math.max(nextY, y + kh)
      }
    }
    layout.set('PANEL', 'KEY_NUM', String(count))
    if (parts[0] === '9' || parts[0] === 'f/9') {
      const list = (key) => Number(doc.get('CandidateCodeView', key))
      const rows = list('ROWS')
      layout.appendSection('LIST', [
        { key: 'POS', value: `${Math.round(list('X') * width)},${Math.round(list('Y') * height)}` },
        { key: 'CELL_SIZE', value: `${Math.round(list('W') * width)},${Math.round(list('H') * height / rows)}` },
        { key: 'LIST_NUM', value: String(rows) }, { key: 'TYPE', value: '0' }, { key: 'NAMES', value: '， 。 ？ ！' },
        { key: 'BACK_STYLE', value: background('BgCode') },
        { key: 'CELL_STYLE', value: background('KeyBg_UserSym') },
        { key: 'SSF_TEXT_STYLE', value: cands.get('CandidateCodeView', 'TEXT_STYLE') },
        { key: 'FORE_STYLE', value: style({ FONT_SIZE: Math.round(width * Number(template.get('TextStyle_Text', 'TEXT_SIZE'))), NM_COLOR: 'FF373737', HL_COLOR: 'FF373737' }) },
      ])
    }
    files[`${orientation}/${name}.ini`] = strToU8(layout.toString())
  }
  const gen = IniDocument.parse(strFromU8(files[`${orientation}/gen.ini`]))
  gen.set('PANEL', 'OFFSET_NUM', String(offsets.size))
  for (const [pos, id] of offsets) gen.appendSection(`OFFSET${id}`, [{ key: 'POS', value: pos }])
  files[`${orientation}/gen.ini`] = strToU8(gen.toString())
}
css.appendSection('GLOBAL', [{ key: 'STYLE_NUM', value: String(nextStyle - 1) }])
files['res/default.css'] = strToU8(css.toString())
files['Info.txt'] = strToU8('Name=搜狗官方键盘骨架\nAuthor=搜狗\n')
files['sogou-source.json'] = strToU8(JSON.stringify({ apk: input.split('/').pop(), sha256: createHash('sha256').update(bytes).digest('hex'), sources: [...sources].sort() }, null, 2))
const output = process.argv[3] ?? new URL('../public/sogou-template.bds', import.meta.url)
writeFileSync(output, zipSync(files, { level: 9, mtime: new Date('2026-01-01T00:00:00Z') }))
if (unmapped.size) console.log(`Function commands: ${[...unmapped].sort().join(' ')}`)
console.log(`Generated ${Object.keys(files).length} files from ${sources.size} official assets`)
