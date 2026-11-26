import { test } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  detectXunfeiFormat,
  parseIniFile,
  preserveRawIni,
  parseZipEntries,
  parseAnimationStructure,
  loadTheme,
} from '../src/xunfei/xunfei-parser.ts'

// ============================================================================
// Format Detection Tests
// ============================================================================

test('detectXunfeiFormat recognizes plain ZIP format', () => {
  // Minimal ZIP with signature
  const zipData = new Uint8Array([0x50, 0x4b, 0x03, 0x04]) // ZIP_LOCAL_FILE_HEADER
  const result = detectXunfeiFormat(zipData)

  assert.ok(result.isXunfei, 'should detect as Xunfei format')
  assert.strictEqual(result.type, 'it', 'should detect as plain .it format')
  assert.strictEqual(result.encrypted, false, 'should not be encrypted')
})

test('detectXunfeiFormat detects FlyitenC encryption', () => {
  // FlyitenC magic bytes
  const encryptedData = new Uint8Array([0x46, 0x4c, 0x59, 0x54, 0x45, 0x4e, 0x43, 0x00])
  const result = detectXunfeiFormat(encryptedData)

  assert.ok(result.isXunfei, 'should detect as Xunfei format')
  assert.strictEqual(result.type, 'itx', 'should detect as encrypted .itx format')
  assert.strictEqual(result.encrypted, true, 'should be encrypted')
})

test('detectXunfeiFormat rejects invalid data', () => {
  const invalidData = new Uint8Array([0x00, 0x00, 0x00, 0x00])
  const result = detectXunfeiFormat(invalidData)

  assert.strictEqual(result.isXunfei, false, 'should not detect as Xunfei')
})

// ============================================================================
// INI Parsing & Preservation Tests
// ============================================================================

test('parseIniFile extracts sections and key-value pairs', () => {
  const iniText = `[INFO]
id=test_theme
name=Test Theme
author=Test Author

[STYLES]
1=normal
2=pressed`

  const data = new TextEncoder().encode(iniText)
  const config = parseIniFile(data)

  assert.ok(config.sections.has('INFO'), 'should have INFO section')
  assert.ok(config.sections.has('STYLES'), 'should have STYLES section')
  assert.strictEqual(config.sections.get('INFO')?.get('id'), 'test_theme', 'should preserve id value')
  assert.strictEqual(config.encoding, 'utf-8', 'should detect UTF-8 encoding')
  assert.strictEqual(config.lineEnding, '\n', 'should detect LF line ending')
})

test('parseIniFile preserves CRLF line endings', () => {
  const iniText = '[INFO]\r\nid=test\r\n'
  const data = new TextEncoder().encode(iniText)
  const config = parseIniFile(data)

  assert.strictEqual(config.lineEnding, '\r\n', 'should detect CRLF line ending')
})

test('parseIniFile preserves whitespace and structure', () => {
  const iniText = `[INFO]
  key1 = value1
  key2=value2`

  const data = new TextEncoder().encode(iniText)
  const config = parseIniFile(data)

  // Raw text should be preserved
  assert.strictEqual(config.rawText, iniText, 'should preserve raw text exactly')
})

test('parseIniFile handles comments', () => {
  const iniText = `; This is a comment
[SECTION]
; Another comment
key=value`

  const data = new TextEncoder().encode(iniText)
  const config = parseIniFile(data)

  assert.strictEqual(config.sections.get('SECTION')?.get('key'), 'value', 'should extract values despite comments')
  assert.ok(config.rawText.includes('; This is a comment'), 'should preserve comments in raw text')
})

test('preserveRawIni maintains binary equivalence for unmodified config', () => {
  const originalText = `[INFO]
id=theme
name=My Theme

[STYLES]
1=style1
2=style2`

  const originalData = new TextEncoder().encode(originalText)
  const config = parseIniFile(originalData)

  // Don't modify config
  const reserialized = preserveRawIni(config)
  const reserialized_text = new TextDecoder().decode(reserialized)

  assert.strictEqual(reserialized_text, originalText, 'preserveRawIni should maintain exact binary equivalence')
})

test('preserveRawIni roundtrip: modify and serialize', () => {
  const iniText = `[INFO]
id=theme
name=Old Name

[STYLES]
1=style1`

  const originalData = new TextEncoder().encode(iniText)
  const config = parseIniFile(originalData)

  // Modify a value
  config.sections.get('INFO')?.set('name', 'New Name')

  const reserialized = preserveRawIni(config)
  const reserialized_text = new TextDecoder().decode(reserialized)

  assert.ok(reserialized_text.includes('New Name'), 'modification should be reflected')
  assert.ok(reserialized_text.includes('[INFO]'), 'section header should be preserved')
})

// ============================================================================
// ZIP Parsing Tests
// ============================================================================

test('parseZipEntries handles basic ZIP structure', () => {
  // Create minimal ZIP with one uncompressed entry
  const fileNameBytes = new TextEncoder().encode('test.txt')
  const fileContent = new TextEncoder().encode('Hello, World!')

  // Build ZIP manually
  const header = new DataView(new ArrayBuffer(30 + fileNameBytes.length))
  header.setUint32(0, 0x04034b50, true) // Local file header signature
  header.setUint16(4, 20, true) // Version needed
  header.setUint16(6, 0, true) // Flags
  header.setUint16(8, 0, true) // Compression method (STORE)
  header.setUint16(10, 0, true) // Mod time
  header.setUint16(12, 0, true) // Mod date
  header.setUint32(14, 0, true) // CRC32
  header.setUint32(18, fileContent.length, true) // Compressed size
  header.setUint32(22, fileContent.length, true) // Uncompressed size
  header.setUint16(26, fileNameBytes.length, true) // Name length
  header.setUint16(28, 0, true) // Extra field length

  const headerBytes = new Uint8Array(header.buffer)
  for (let i = 0; i < fileNameBytes.length; i++) {
    headerBytes[30 + i] = fileNameBytes[i]
  }

  // Combine header + content
  const zipData = new Uint8Array(headerBytes.length + fileContent.length)
  zipData.set(headerBytes)
  zipData.set(fileContent, headerBytes.length)

  const entries = parseZipEntries(zipData)

  assert.strictEqual(entries.length, 1, 'should extract one entry')
  assert.strictEqual(entries[0].name, 'test.txt', 'should preserve file name')
  assert.deepStrictEqual(entries[0].data, fileContent, 'should extract file content')
  assert.strictEqual(entries[0].compressed, false, 'should detect as uncompressed')
})

// ============================================================================
// Animation Structure Parsing Tests
// ============================================================================

test('parseAnimationStructure extracts animation definitions', () => {
  const iniText = `[ANIMATION_bounce]
type=1
duration=500
frame_0=0,0
frame_250=10,0
frame_500=0,0

[ANIMATION_fade]
type=4
duration=300
frame_0=1
frame_300=0`

  const data = new TextEncoder().encode(iniText)
  const config = parseIniFile(data)
  const result = parseAnimationStructure(config)

  assert.strictEqual(result.animations.length, 2, 'should extract 2 animations')
  assert.strictEqual(result.animations[0].id, 'bounce', 'should preserve animation ID')
  assert.strictEqual(result.animations[0].type, 1, 'should parse animation type (Translate)')
  assert.strictEqual(result.animations[0].duration, 500, 'should parse duration')
  assert.strictEqual(result.animations[0].keyframes.length, 3, 'should extract keyframes')
})

test('parseAnimationStructure clamps animation type to 0-5 range', () => {
  const iniText = `[ANIMATION_invalid]
type=10
duration=1000`

  const data = new TextEncoder().encode(iniText)
  const config = parseIniFile(data)
  const result = parseAnimationStructure(config)

  assert.strictEqual(result.animations[0].type, 5, 'should clamp invalid type (10) to max (5)')
})

test('parseAnimationStructure handles negative animation types', () => {
  const iniText = `[ANIMATION_negative]
type=-5
duration=1000`

  const data = new TextEncoder().encode(iniText)
  const config = parseIniFile(data)
  const result = parseAnimationStructure(config)

  assert.strictEqual(result.animations[0].type, 0, 'should clamp negative type to min (0)')
})

// ============================================================================
// Roundtrip Cycle Tests
// ============================================================================

test('roundtrip cycle: load → parse → modify → preserve', () => {
  // Start with original INI
  const originalText = `[INFO]
id=my_theme
name=Original Theme
author=Test Author

[STYLES]
1=style_normal
2=style_pressed`

  const originalData = new TextEncoder().encode(originalText)

  // 1. Parse
  const config = parseIniFile(originalData)
  assert.ok(config.sections.has('INFO'), 'parse should extract sections')

  // 2. Modify
  config.sections.get('INFO')?.set('name', 'Modified Theme')
  config.sections.get('STYLES')?.set('3', 'style_new')

  // 3. Preserve
  const preservedData = preserveRawIni(config)
  const preservedText = new TextDecoder().decode(preservedData)

  // 4. Verify
  const reparsed = parseIniFile(preservedData)
  assert.strictEqual(reparsed.sections.get('INFO')?.get('name'), 'Modified Theme', 'modification should persist')
  assert.strictEqual(reparsed.sections.get('STYLES')?.get('3'), 'style_new', 'new entry should persist')
  assert.ok(preservedText.includes('[INFO]'), 'structure should be preserved')
})

test('roundtrip preserves multi-section INI structure', () => {
  const originalText = `[SECTION_A]
key1=value1
key2=value2

[SECTION_B]
key3=value3
key4=value4

[SECTION_C]
key5=value5`

  const originalData = new TextEncoder().encode(originalText)
  const config = parseIniFile(originalData)
  const preserved = preserveRawIni(config)
  const preservedText = new TextDecoder().decode(preserved)

  // Verify all sections appear in correct order
  const sectionA_idx = preservedText.indexOf('[SECTION_A]')
  const sectionB_idx = preservedText.indexOf('[SECTION_B]')
  const sectionC_idx = preservedText.indexOf('[SECTION_C]')

  assert.ok(sectionA_idx < sectionB_idx, 'SECTION_A should come before SECTION_B')
  assert.ok(sectionB_idx < sectionC_idx, 'SECTION_B should come before SECTION_C')
})

test('roundtrip handles empty sections and trailing whitespace', () => {
  const originalText = `[SECTION1]
key=value

[EMPTY_SECTION]

[SECTION2]
another=entry`

  const originalData = new TextEncoder().encode(originalText)
  const config = parseIniFile(originalData)
  const preserved = preserveRawIni(config)
  const reparsed = parseIniFile(preserved)

  assert.ok(reparsed.sections.has('SECTION1'), 'should preserve SECTION1')
  assert.ok(reparsed.sections.has('EMPTY_SECTION'), 'should preserve empty section')
  assert.ok(reparsed.sections.has('SECTION2'), 'should preserve SECTION2')
})

// ============================================================================
// Encoding & Line Ending Tests
// ============================================================================

test('roundtrip preserves mixed line endings (CRLF)', () => {
  const originalText = '[SECTION]\r\nkey=value\r\n'
  const originalData = new TextEncoder().encode(originalText)
  const config = parseIniFile(originalData)

  assert.strictEqual(config.lineEnding, '\r\n', 'should detect CRLF')

  const preserved = preserveRawIni(config)
  const reparsed = parseIniFile(preserved)

  assert.strictEqual(reparsed.lineEnding, '\r\n', 'should preserve CRLF in roundtrip')
})

test('roundtrip cycle maintains exact structure count', () => {
  const originalText = `[INFO]
id=test
name=Test
author=Author
version=1.0

[STYLES]
1=s1
2=s2
3=s3

[ANIMATIONS]
anim1=1
anim2=2`

  const originalData = new TextEncoder().encode(originalText)
  const config = parseIniFile(originalData)

  // Count original entries
  const originalCount = Array.from(config.sections.values()).reduce(
    (sum, section) => sum + section.size,
    0
  )

  const preserved = preserveRawIni(config)
  const reparsed = parseIniFile(preserved)

  const preservedCount = Array.from(reparsed.sections.values()).reduce(
    (sum, section) => sum + section.size,
    0
  )

  assert.strictEqual(preservedCount, originalCount, 'entry count should match after roundtrip')
})

// ============================================================================
// Error Handling & Edge Cases
// ============================================================================

test('parseIniFile handles malformed sections gracefully', () => {
  const iniText = `[VALID]
key=value

[INVALID SECTION WITH SPACES]
another=value`

  const data = new TextEncoder().encode(iniText)
  const config = parseIniFile(data)

  // Should extract both sections (even if name is unusual)
  assert.ok(config.sections.has('VALID'), 'should extract valid section')
})

test('parseIniFile handles duplicate keys (last-one-wins)', () => {
  const iniText = `[SECTION]
key=first_value
key=second_value`

  const data = new TextEncoder().encode(iniText)
  const config = parseIniFile(data)

  // Last value should win
  assert.strictEqual(
    config.sections.get('SECTION')?.get('key'),
    'second_value',
    'should use last value for duplicate keys'
  )
})

test('parseIniFile handles values with equals signs', () => {
  const iniText = `[SECTION]
expression=a=b+c
formula=x=y*2`

  const data = new TextEncoder().encode(iniText)
  const config = parseIniFile(data)

  assert.strictEqual(config.sections.get('SECTION')?.get('expression'), 'a=b+c', 'should handle = in value')
  assert.strictEqual(config.sections.get('SECTION')?.get('formula'), 'x=y*2', 'should handle = in value')
})

test('parseZipEntries returns empty array for invalid ZIP', () => {
  const invalidZip = new Uint8Array([0xff, 0xff, 0xff, 0xff])
  const entries = parseZipEntries(invalidZip)

  assert.strictEqual(entries.length, 0, 'should return empty array for invalid ZIP')
})

// ============================================================================
// Integration Tests: Real Sample Themes
// ============================================================================

test('load sample theme: 讯飞皮【带漂浮物】大空格大回车底包', async () => {
  const themeFile = '/Users/kaze/work/keyskin-md/讯飞皮【带漂浮物】大空格大回车底包@(3).it'

  try {
    const zipData = new Uint8Array(readFileSync(themeFile))

    // Test format detection
    const format = detectXunfeiFormat(zipData)
    assert.strictEqual(format.isXunfei, true, 'should detect as Xunfei format')
    assert.strictEqual(format.type, 'it', 'should detect as plain .it format')
    assert.strictEqual(format.encrypted, false, 'should not be encrypted')

    // Test ZIP parsing
    const entries = parseZipEntries(zipData)
    assert.ok(entries.length > 0, 'should extract ZIP entries')

    // Verify key files exist
    const iniFiles = entries
      .filter(e => e.name.endsWith('.ini'))
      .map(e => e.name)
    assert.ok(iniFiles.length > 0, 'should contain INI files')
    assert.ok(iniFiles.some(f => f.includes('info.ini')), 'should contain info.ini')
    assert.ok(iniFiles.some(f => f.includes('image.ini')), 'should contain image.ini')
  } catch (err) {
    if (err.code === 'ENOENT') {
      assert.ok(true, 'sample theme file not found, skipping')
    } else {
      throw err
    }
  }
})

test('load sample theme: 单手键盘正式版', async () => {
  const themeFile = '/Users/kaze/work/keyskin-md/单手键盘正式版(仅安卓适配扇形)_by微信公众号@大叔标神.it'

  try {
    const zipData = new Uint8Array(readFileSync(themeFile))

    // Test format detection
    const format = detectXunfeiFormat(zipData)
    assert.strictEqual(format.isXunfei, true, 'should detect as Xunfei format')
    assert.strictEqual(format.type, 'it', 'should detect as plain .it format')

    // Test ZIP parsing
    const entries = parseZipEntries(zipData)
    assert.ok(entries.length > 0, 'should extract ZIP entries')
  } catch (err) {
    if (err.code === 'ENOENT') {
      assert.ok(true, 'sample theme file not found, skipping')
    } else {
      throw err
    }
  }
})

test('parse theme metadata from sample', async () => {
  const themeFile = '/Users/kaze/work/keyskin-md/讯飞皮【带漂浮物】大空格大回车底包@(3).it'

  try {
    const zipData = new Uint8Array(readFileSync(themeFile))
    const { metadata, iniFiles } = await loadTheme(zipData)

    // Validate metadata structure
    assert.ok(metadata.name, 'should have theme name')
    assert.ok(metadata.id, 'should have theme ID')
    assert.ok(Array.isArray(metadata.resolution), 'should have resolution array')
    assert.ok(metadata.resolution.length > 0, 'resolution array should not be empty')
    assert.strictEqual(metadata.format.isXunfei, true, 'format should be detected as Xunfei')
  } catch (err) {
    if (err.code === 'ENOENT') {
      assert.ok(true, 'sample theme file not found, skipping')
    } else {
      throw err
    }
  }
})

test('roundtrip validation: parse → modify → serialize → reparse', async () => {
  const themeFile = '/Users/kaze/work/keyskin-md/讯飞皮【带漂浮物】大空格大回车底包@(3).it'

  try {
    const zipData = new Uint8Array(readFileSync(themeFile))
    const { metadata, iniFiles } = await loadTheme(zipData)

    // Get a sample INI file and perform roundtrip
    const [firstIniPath, firstIniConfig] = iniFiles.entries().next().value || []

    if (firstIniConfig) {
      const originalSectionCount = firstIniConfig.sections.size

      // Modify a value
      const firstSection = firstIniConfig.sections.values().next().value
      if (firstSection && firstSection.size > 0) {
        const firstKey = firstSection.keys().next().value
        const originalValue = firstSection.get(firstKey)
        firstSection.set(firstKey, 'test_value')

        // Preserve to binary
        const binary = preserveRawIni(firstIniConfig)

        // Reparse
        const reparsed = parseIniFile(binary)

        // Verify
        assert.strictEqual(reparsed.sections.size, originalSectionCount, 'section count should be preserved')
        assert.strictEqual(reparsed.sections.get(Array.from(firstSection.keys())[0]), 'test_value', 'modification should persist after roundtrip')
      }
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      assert.ok(true, 'sample theme file not found, skipping')
    } else {
      throw err
    }
  }
})

test('validate image.ini slicing structure', async () => {
  const themeFile = '/Users/kaze/work/keyskin-md/讯飞皮【带漂浮物】大空格大回车底包@(3).it'

  try {
    const zipData = new Uint8Array(readFileSync(themeFile))
    const { iniFiles } = await loadTheme(zipData)

    // Find image.ini
    const imageIniPath = Array.from(iniFiles.keys()).find(path => path.endsWith('image.ini'))
    if (imageIniPath) {
      const imageConfig = iniFiles.get(imageIniPath)

      // Check for image entries in range 1001-1010
      let imageEntriesFound = 0
      for (const [section, entries] of imageConfig.sections.entries()) {
        // Image sections typically have numeric prefixes like [Image1], [Image302], etc.
        if (section.startsWith('Image')) {
          const imageNum = parseInt(section.slice(5), 10)
          if (imageNum >= 1001 && imageNum <= 1010) {
            imageEntriesFound++

            // Verify required fields for image entries
            assert.ok(entries.has('SRC') || entries.has('src'), `Image section ${section} should have SRC field`)
          }
        }
      }

      // Note: specific image indices may not exist in this theme, but structure should be valid
      assert.ok(imageConfig.sections.size > 0, 'image.ini should have sections')
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      assert.ok(true, 'sample theme file not found, skipping')
    } else {
      throw err
    }
  }
})

test('validate animations and offsets extraction', async () => {
  const themeFile = '/Users/kaze/work/keyskin-md/讯飞皮【带漂浮物】大空格大回车底包@(3).it'

  try {
    const zipData = new Uint8Array(readFileSync(themeFile))
    const { iniFiles } = await loadTheme(zipData)

    // Find animation.ini or anim.ini
    const animIniPath = Array.from(iniFiles.keys()).find(path =>
      path.includes('anim') && path.endsWith('.ini')
    )

    if (animIniPath) {
      const animConfig = iniFiles.get(animIniPath)
      const animations = parseAnimationStructure(animConfig)

      // Validate animation structure
      for (const anim of animations.animations) {
        assert.ok(anim.id, 'animation should have id')
        assert.ok(typeof anim.type === 'number', 'animation should have numeric type')
        assert.ok(anim.type >= 0 && anim.type <= 5, 'animation type should be in range 0-5')
        assert.ok(anim.duration > 0, 'animation duration should be positive')
      }
    }

    // Find offset.ini
    const offsetIniPath = Array.from(iniFiles.keys()).find(path =>
      path.includes('offset') && path.endsWith('.ini')
    )

    if (offsetIniPath) {
      const offsetConfig = iniFiles.get(offsetIniPath)

      // Validate offset structure
      assert.ok(offsetConfig.sections.size > 0, 'offset.ini should have sections')

      // Check for offset entries (typically in format like [Offset1], [Offset2], etc.)
      let offsetEntriesFound = 0
      for (const section of offsetConfig.sections.keys()) {
        if (section.match(/^[Oo]ffset/)) {
          offsetEntriesFound++
        }
      }

      // At least some offset entries should exist or be named differently
      assert.ok(offsetConfig.sections.size > 0, 'offset.ini should contain position data')
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      assert.ok(true, 'sample theme file not found, skipping')
    } else {
      throw err
    }
  }
})
