import { IniDocument } from "./ini.ts"
import { decodeWav } from "./wav.ts"

export const SOUND_ACCEPT = ".ogg,.wav,.aiff,.aif,.mp3,audio/ogg,audio/wav,audio/x-aiff,audio/mpeg"

type DecodedSound = {
  channelData: Float32Array[]
  samplesDecoded: number
  sampleRate: number
}

export function isSoundPath(path: string): boolean {
  return /\.(?:ogg|wav|aiff?|caf|mp3)$/i.test(path)
}

export function soundMimeType(path: string): string {
  if (/\.ogg$/i.test(path)) return "audio/ogg"
  if (/\.wav$/i.test(path)) return "audio/wav"
  if (/\.aiff?$/i.test(path)) return "audio/x-aiff"
  if (/\.caf$/i.test(path)) return "audio/x-caf"
  if (/\.mp3$/i.test(path)) return "audio/mpeg"
  return "application/octet-stream"
}

export function decodeAiffPcm(bytes: Uint8Array): DecodedSound {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const text = (offset: number, length: number) => new TextDecoder("ascii").decode(bytes.subarray(offset, offset + length))
  if (bytes.length < 12 || text(0, 4) !== "FORM" || !/^AIF[FC]$/.test(text(8, 4))) {
    throw new Error("不是有效的 AIFF 文件")
  }
  let channels = 0
  let frames = 0
  let bits = 0
  let sampleRate = 0
  let littleEndian = false
  let float = false
  let soundOffset = -1
  let soundLength = 0
  // Watermark tools append data (e.g. a "JSONMETA" block) after the FORM; stop at the declared end.
  const formEnd = Math.min(bytes.length, 8 + view.getUint32(4))
  for (let offset = 12; offset + 8 <= formEnd;) {
    const id = text(offset, 4)
    const size = view.getUint32(offset + 4)
    const start = offset + 8
    if (start + size > bytes.length) throw new Error("AIFF 数据块不完整")
    if (id === "COMM" && size >= 18) {
      channels = view.getUint16(start)
      frames = view.getUint32(start + 2)
      bits = view.getUint16(start + 6)
      const exponent = ((bytes[start + 8] & 0x7f) << 8) | bytes[start + 9]
      const mantissa = view.getUint32(start + 10) * 2 ** 32 + view.getUint32(start + 14)
      sampleRate = mantissa * 2 ** (exponent - 16383 - 63)
      const compression = size >= 22 ? text(start + 18, 4) : "NONE"
      // Float AIFC (fl32/fl64) is what macOS tools such as afconvert write by default.
      float = /^fl(?:32|64)$/i.test(compression)
      if (float) bits = compression.endsWith("32") ? 32 : 64
      else if (compression !== "NONE" && compression !== "sowt") throw new Error(`不支持的 AIFC 编码：${compression}`)
      littleEndian = compression === "sowt"
    } else if (id === "SSND" && size >= 8) {
      const dataOffset = view.getUint32(start)
      soundOffset = start + 8 + dataOffset
      soundLength = size - 8 - dataOffset
    }
    offset = start + size + (size & 1)
  }
  if (!channels || !frames || !sampleRate || soundOffset < 0 || ![8, 16, 24, 32].includes(bits) && !(float && bits === 64)) {
    throw new Error("AIFF 缺少可播放的 PCM 数据")
  }
  const bytesPerSample = bits / 8
  const samplesDecoded = Math.min(frames, Math.floor(soundLength / (channels * bytesPerSample)))
  const channelData = Array.from({ length: channels }, () => new Float32Array(samplesDecoded))
  for (let frame = 0; frame < samplesDecoded; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      const offset = soundOffset + (frame * channels + channel) * bytesPerSample
      let sample: number
      if (float) sample = bits === 32 ? view.getFloat32(offset) : view.getFloat64(offset)
      else if (bits === 8) sample = view.getInt8(offset) / 128
      else if (bits === 16) sample = view.getInt16(offset, littleEndian) / 32768
      else if (bits === 24) {
        const value = littleEndian
          ? bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16
          : bytes[offset] << 16 | bytes[offset + 1] << 8 | bytes[offset + 2]
        sample = ((value & 0x800000) ? value | 0xff000000 : value) / 8388608
      } else sample = view.getInt32(offset, littleEndian) / 2147483648
      channelData[channel][frame] = sample
    }
  }
  return { channelData, samplesDecoded, sampleRate }
}

export function soundResourcePaths(
  names: readonly string[],
  theme: string,
  orientation: string,
): string[] {
  const roots = [`${theme}/skin/${orientation}/res/`, `${theme}/skin/res/`]
  const relative = new Set<string>()
  return roots.flatMap((root) => names
    .filter((path) => path.startsWith(root) && isSoundPath(path))
    .sort()
    .flatMap((path) => {
      const name = path.slice(root.length)
      if (relative.has(name)) return []
      relative.add(name)
      return [path]
    }))
}

export function soundPathForFilename(
  names: readonly string[],
  theme: string,
  orientation: string,
  filename: string,
): string | undefined {
  const clean = filename.trim().split(/[\\/]/).pop()
  if (!clean) return
  const stem = clean.replace(/\.(?:ogg|wav|aiff?|caf|mp3)$/i, "").toLowerCase()
  const paths = soundResourcePaths(names, theme, orientation)
  const name = (path: string) => (path.split("/").pop() ?? path).toLowerCase()
  return paths.find((path) => name(path) === clean.toLowerCase())
    ?? paths.find((path) => name(path).replace(/\.(?:ogg|wav|aiff?|caf|mp3)$/i, "") === stem)
}

export function soundStyleForKey(
  layout: IniDocument,
  section: string,
  general?: IniDocument,
): string | undefined {
  return layout.get(section, "SOUND_STYLE")?.trim()
    || layout.get("PANEL", "SOUND_STYLE")?.trim()
    || general?.get("PANEL", "SOUND_STYLE")?.trim()
    || undefined
}

export function soundFilenameForKey(
  layout: IniDocument,
  section: string,
  styles: IniDocument,
  general?: IniDocument,
): string | undefined {
  const styleID = soundStyleForKey(layout, section, general)
  return styleID ? styles.get(`STYLE${styleID}`, "PRESS_SOUND_PATH")?.trim() || undefined : undefined
}

function encodeAiffPcm16(sound: DecodedSound): Uint8Array {
  const channels = sound.channelData.length
  const frames = sound.samplesDecoded
  const dataLength = frames * channels * 2
  const bytes = new Uint8Array(54 + dataLength)
  const view = new DataView(bytes.buffer)
  const ascii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++) bytes[offset + index] = value.charCodeAt(index)
  }
  ascii(0, "FORM")
  view.setUint32(4, bytes.length - 8)
  ascii(8, "AIFF")
  ascii(12, "COMM")
  view.setUint32(16, 18)
  view.setUint16(20, channels)
  view.setUint32(22, frames)
  view.setUint16(26, 16)
  // Sample rate as an 80-bit IEEE 754 extended float.
  const rate = Math.round(sound.sampleRate)
  const exponent = Math.floor(Math.log2(rate))
  view.setUint16(28, 16383 + exponent)
  const mantissa = rate * 2 ** (63 - exponent)
  view.setUint32(30, Math.floor(mantissa / 2 ** 32))
  view.setUint32(34, mantissa % 2 ** 32)
  ascii(38, "SSND")
  view.setUint32(42, 8 + dataLength)
  let offset = 54
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      const sample = Math.max(-1, Math.min(1, sound.channelData[channel][frame] ?? 0))
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff)
      offset += 2
    }
  }
  return bytes
}

function encodeWavPcm16(sound: DecodedSound): Uint8Array {
  const channels = sound.channelData.length
  const frames = sound.samplesDecoded
  const dataLength = frames * channels * 2
  const bytes = new Uint8Array(44 + dataLength)
  const view = new DataView(bytes.buffer)
  const ascii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++) bytes[offset + index] = value.charCodeAt(index)
  }
  const rate = Math.round(sound.sampleRate)
  ascii(0, "RIFF")
  view.setUint32(4, bytes.length - 8, true)
  ascii(8, "WAVE")
  ascii(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * channels * 2, true)
  view.setUint16(32, channels * 2, true)
  view.setUint16(34, 16, true)
  ascii(36, "data")
  view.setUint32(40, dataLength, true)
  let offset = 44
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      const sample = Math.max(-1, Math.min(1, sound.channelData[channel][frame] ?? 0))
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
      offset += 2
    }
  }
  return bytes
}

async function decodeOggVorbis(bytes: Uint8Array): Promise<DecodedSound> {
  const { OggVorbisDecoder } = await import("@wasm-audio-decoders/ogg-vorbis")
  const decoder = new OggVorbisDecoder()
  await decoder.ready
  try {
    const decoded = await decoder.decodeFile(bytes)
    if (!decoded.samplesDecoded || !decoded.channelData.length) throw new Error("OGG 文件没有可播放的音频")
    return decoded
  } finally {
    decoder.free()
  }
}

async function encodeOggVorbis(sound: DecodedSound): Promise<Uint8Array> {
  const { createEncoder, createOggEncoder } = await import("wasm-media-encoders")
  // In the page, load the bundled .wasm file: the library's embedded data: URL is blocked by the CSP (connect-src).
  const encoder = typeof document === "undefined"
    ? await createOggEncoder()
    : await createEncoder("audio/ogg", (await import("wasm-media-encoders/wasm/ogg?url")).default)
  const channels = sound.channelData.slice(0, 2)
  encoder.configure({ channels: channels.length as 1 | 2, sampleRate: sound.sampleRate, vbrQuality: 5 })
  const chunks: Uint8Array[] = []
  const block = 4096
  for (let start = 0; start < sound.samplesDecoded; start += block) {
    const end = Math.min(sound.samplesDecoded, start + block)
    // encode() returns a view into WASM memory that the next call overwrites.
    chunks.push(encoder.encode(channels.map((channel) => channel.subarray(start, end))).slice())
  }
  chunks.push(encoder.finalize().slice())
  const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}

async function decodeSound(bytes: Uint8Array): Promise<DecodedSound> {
  const head = new TextDecoder("ascii").decode(bytes.subarray(0, 4))
  if (head === "FORM") return decodeAiffPcm(bytes)
  if (head === "OggS") return decodeOggVorbis(bytes)
  if (head === "RIFF") return decodeWav(bytes)
  if (head.startsWith("ID3") || bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    if (typeof AudioContext === "undefined") throw new Error("当前环境不支持 MP3 解码")
    const context = new AudioContext()
    try {
      const decoded = await context.decodeAudioData(new Uint8Array(bytes).buffer)
      if (!decoded.length || !decoded.numberOfChannels) throw new Error("MP3 文件没有可播放的音频")
      return {
        channelData: Array.from({ length: decoded.numberOfChannels }, (_, channel) => decoded.getChannelData(channel)),
        samplesDecoded: decoded.length,
        sampleRate: decoded.sampleRate,
      }
    } finally {
      await context.close()
    }
  }
  throw new Error("不支持的音频编码")
}

/** A key sound as 16-bit PCM WAV, the format Sogou skins use; WAV input is returned unchanged. */
export async function soundAsWav(bytes: Uint8Array): Promise<Uint8Array> {
  if (new TextDecoder("ascii").decode(bytes.subarray(0, 4)) === "RIFF") return bytes
  return encodeWavPcm16(await decodeSound(bytes))
}

/** Baidu skins use AIFF on iOS and Ogg Vorbis on Android; retain originals while adding native copies. */
const NATIVE_SOUND_EXTENSION = { bdi: "aiff", bds: "ogg" } as const

/** WAV/MP3 sources also need the target platform's native encoding. */
function soundNeedsTranscode(path: string, format: "bdi" | "bds"): boolean {
  return format === "bdi" ? /\.(?:ogg|wav|mp3)$/i.test(path) : /\.(?:aiff?|caf|wav|mp3)$/i.test(path)
}

/**
 * Rewrites every PRESS/PANEL_SHOW/PANEL_HIDE_SOUND_PATH in each theme's default.css (light and dark each have their own)
 * that needs a native copy: Ogg/WAV/MP3 → AIFF for BDI, AIFF/CAF/WAV/MP3 → Ogg for BDS.
 * A same-named file in the target format next to that css is used as is; otherwise the referenced
 * file is transcoded, and a sound the decoder cannot read is reported in `warnings`.
 * Original files are kept, matching official packages that bundle both formats.
 */
export async function adaptPackageSounds(
  files: Map<string, Uint8Array>,
  format: "bdi" | "bds",
): Promise<{ converted: number; warnings: string[] }> {
  const extension = NATIVE_SOUND_EXTENSION[format]
  const warnings: string[] = []
  const transcoded = new Map<string, string | undefined>()
  const lowerNames = new Map([...files.keys()].map((path) => [path.toLowerCase(), path]))
  const find = (path: string) => lowerNames.get(path.toLowerCase())
  let converted = 0

  const nativeFile = async (directories: string[], filename: string): Promise<string | undefined> => {
    const stem = filename.replace(/\.[^.]+$/, "")
    const alternatives = format === "bdi" ? [`${stem}.aiff`, `${stem}.aif`] : [`${stem}.ogg`]
    const source = directories.map((directory) => find(`${directory}${filename}`)).find(Boolean)
    const siblingDirectories = source ? [source.slice(0, source.lastIndexOf("/") + 1)] : directories
    for (const directory of siblingDirectories) {
      for (const name of alternatives) {
        const existing = find(`${directory}${name}`)
        if (existing) return existing
      }
    }
    if (!source) {
      warnings.push(`${directories[0]}${filename} 不存在，无法生成 ${extension.toUpperCase()}`)
      return
    }
    if (!transcoded.has(source)) {
      const target = source.replace(/\.[^./]+$/, `.${extension}`)
      try {
        const decoded = await decodeSound(files.get(source)!)
        files.set(target, format === "bdi" ? encodeAiffPcm16(decoded) : await encodeOggVorbis(decoded))
        lowerNames.set(target.toLowerCase(), target)
        converted++
        transcoded.set(source, target)
      } catch (error) {
        warnings.push(`${source} 无法转换为 ${extension.toUpperCase()}：${error instanceof Error ? error.message : String(error)}`)
        transcoded.set(source, undefined)
      }
    }
    return transcoded.get(source)
  }

  for (const [path, bytes] of [...files]) {
    if (!/\.css$/i.test(path)) continue
    let text: string
    try {
      // Keep the BOM and leave non-UTF-8 (e.g. GBK) files untouched rather than re-encoding them.
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)
    } catch {
      continue
    }
    // Sounds sit next to the css (light/res/) or, for an orientation css (light/port/res/), in the theme's res/.
    const directory = path.slice(0, path.lastIndexOf("/") + 1)
    const directories = [...new Set([directory, directory.replace(/(?:land|port)\/res\/$/, "res/")])]
    let next = ""
    let last = 0
    for (const match of text.matchAll(/^(\s*(?:PRESS|PANEL_SHOW|PANEL_HIDE)_SOUND_PATH\s*=\s*)(.*?)(\s*)$/gim)) {
      const value = match[2].trim()
      const filename = value.split(/[\\/]/).pop() ?? ""
      if (!soundNeedsTranscode(filename, format)) continue
      const target = await nativeFile(directories, filename)
      if (!target) continue
      next += text.slice(last, match.index) + match[1] + value.slice(0, value.length - filename.length) + target.split("/").pop() + match[3]
      last = match.index! + match[0].length
    }
    if (last) files.set(path, new TextEncoder().encode(next + text.slice(last)))
  }
  return { converted, warnings }
}
