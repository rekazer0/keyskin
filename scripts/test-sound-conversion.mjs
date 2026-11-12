import assert from 'node:assert/strict'
import { realpathSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { createMp3Encoder } from 'wasm-media-encoders'
import { wav } from '../tests/helpers/ssf-fixture.mjs'

const encoder = await createMp3Encoder()
encoder.configure({ channels: 1, sampleRate: 44100, vbrQuality: 5 })
const pcm = Float32Array.from({ length: 4410 }, (_, i) => Math.sin(i * 2 * Math.PI * 440 / 44100) * 0.5)
const chunks = [encoder.encode([pcm]).slice(), encoder.finalize().slice()]
const mp3 = Buffer.concat(chunks)
assert.ok(mp3.length > 100)

const root = new URL('..', import.meta.url).pathname
const server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 41852, strictPort: false, hmr: false, fs: { allow: [root, realpathSync(new URL('../node_modules', import.meta.url))] } } })
await server.listen()
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  const results = await page.evaluate(async ({ mp3, wav }) => {
    const { adaptPackageSounds, decodeAiffPcm, isSoundPath, soundAsWav, soundMimeType, soundPathForFilename } = await import('/src/sounds.ts')
    const { decodeWav } = await import('/src/wav.ts')
    const { SkinArchive } = await import('/src/skin.ts')
    const { buildSxiZipAsync } = await import('/src/palm/palm-export.ts')
    const { convertBaiduToSsf } = await import('/src/ssf/baidu-to-ssf.ts')
    const { SsfPackage } = await import('/src/ssf/ssf-package.ts')
    const text = new TextEncoder()
    const head = bytes => new TextDecoder().decode(bytes?.subarray(0, 4))
    const results = []
    for (const [extension, values] of [['mp3', mp3], ['wav', wav]]) {
      const bytes = new Uint8Array(values)
      const decoded = decodeWav(await soundAsWav(bytes))
      if (!decoded.channelData[0].some(sample => Math.abs(sample) > 0.01)) throw new Error(`${extension}: converted sound is silent`)
      for (const format of ['bds', 'bdi']) {
        const files = new Map([
          ['res/default.css', text.encode(`[STYLE1]\nPRESS_SOUND_PATH=tap.${extension}\n`)],
          [`res/tap.${extension}`, bytes],
        ])
        const converted = await adaptPackageSounds(files, format)
        const target = format === 'bdi' ? 'aiff' : 'ogg'
        if (converted.warnings.length) throw new Error(converted.warnings.join('\n'))
        const output = files.get(`res/tap.${target}`)
        if (format === 'bdi') {
          if (decodeAiffPcm(output).samplesDecoded !== decoded.samplesDecoded) throw new Error('AIFF duration changed')
        } else {
          if (head(output) !== 'OggS') throw new Error('not OGG')
          const sound = decodeWav(await soundAsWav(output))
          if (!sound.samplesDecoded || !sound.channelData[0].some(sample => Math.abs(sample) > 0.01)) throw new Error('OGG is silent')
        }
        if (!new TextDecoder().decode(files.get('res/default.css')).includes(`tap.${target}`)) throw new Error('reference unchanged')
        results.push(`${extension} → ${format}: ${head(output)}`)
      }
      const source = SkinArchive.fromSourceFiles([
        { path: 'Info.txt', data: text.encode('Name=Audio test\n') },
        { path: 'port/gen.ini', data: text.encode('[PANEL]\nSIZE=300,120\nSOUND_STYLE=1\n') },
        { path: 'port/py_26.ini', data: text.encode('[PANEL]\nKEY_NUM=1\n[KEY1]\nCENTER=q\nVIEW_RECT=0,0,100,120\n') },
        { path: 'res/default.css', data: text.encode(`[STYLE1]\nPRESS_SOUND_PATH=tap.${extension}\n`) },
        { path: `res/tap.${extension}`, data: bytes },
      ])
      const result = await buildSxiZipAsync(source)
      if (result.warnings.length) throw new Error(result.warnings.join('\n'))
      const palm = SkinArchive.open(result.bytes, 'sxi')
      const skin = JSON.parse(palm.getText('skin.json'))
      if (skin.default.s_info.ss_1['1'].s_4.path_1 !== 'tap.aiff') throw new Error('Palm reference unchanged')
      if (!decodeAiffPcm(palm.getBytes('light/skin/res/tap.aiff')).samplesDecoded) throw new Error('Palm AIFF is empty')
      results.push(`${extension} → sxi: AIFF`)
      const sogou = await SsfPackage.open((await convertBaiduToSsf(source)).bytes)
      const name = sogou.ini('default/sound_android.ini').get('Key', 'sound')
      if (!name || !decodeWav(sogou.files.get(`default/${name}.wav`)).samplesDecoded) throw new Error('Sogou WAV is empty')
      results.push(`${extension} → ssf: WAV`)
    }
    if (!isSoundPath('tap.mp3') || soundMimeType('tap.mp3') !== 'audio/mpeg') throw new Error('MP3 is not recognized')
    if (soundPathForFilename(['light/skin/res/tap.mp3'], 'light', 'port', 'tap.mp3') !== 'light/skin/res/tap.mp3') throw new Error('MP3 lookup failed')
    const invalid = new Map([
      ['res/default.css', text.encode('[STYLE1]\nPRESS_SOUND_PATH=broken.mp3\n')],
      ['res/broken.mp3', text.encode('ID3 broken')],
    ])
    const failed = await adaptPackageSounds(invalid, 'bdi')
    if (failed.warnings.length !== 1 || invalid.has('res/broken.aiff')) throw new Error('invalid MP3 was not reported')
    if (!new TextDecoder().decode(invalid.get('res/default.css')).includes('broken.mp3')) throw new Error('failed conversion lost the source reference')
    return results
  }, { mp3: [...mp3], wav: [...wav(1024)] })
  assert.equal(results.length, 8)
  console.log('PASS browser audio conversion:', results.join('; '))
} finally {
  await browser.close()
  await server.close()
}
