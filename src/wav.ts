// RIFF/WAVE PCM and IEEE float key sounds, decoded without a browser AudioContext.
export function decodeWav(bytes: Uint8Array): { channelData: Float32Array[]; samplesDecoded: number; sampleRate: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const text = (offset: number, length: number) => new TextDecoder("ascii").decode(bytes.subarray(offset, offset + length))
  if (bytes.length < 12 || text(0, 4) !== "RIFF" || text(8, 4) !== "WAVE") throw new Error("不是有效的 WAV 文件")
  const end = 8 + view.getUint32(4, true)
  if (end > bytes.length || end < 12) throw new Error("WAV 数据不完整")
  let encoding = 0
  let channels = 0
  let sampleRate = 0
  let bits = 0
  let alignment = 0
  let data: Uint8Array | undefined
  for (let offset = 12; offset + 8 <= end;) {
    const size = view.getUint32(offset + 4, true)
    const start = offset + 8
    if (start + size > end) throw new Error("WAV 数据块不完整")
    const id = text(offset, 4)
    if (id === "fmt " && size >= 16) {
      encoding = view.getUint16(start, true)
      channels = view.getUint16(start + 2, true)
      sampleRate = view.getUint32(start + 4, true)
      alignment = view.getUint16(start + 12, true)
      bits = view.getUint16(start + 14, true)
      if (encoding === 0xfffe && size >= 40) {
        // WAVE_FORMAT_EXTENSIBLE: only PCM / IEEE float with the standard subtype GUID.
        const guid = [...bytes.subarray(start + 26, start + 40)].join(",")
        if (guid !== "0,0,0,0,16,0,128,0,0,170,0,56,155,113") throw new Error("不支持的 WAV 子编码")
        encoding = view.getUint16(start + 24, true)
        if (view.getUint16(start + 18, true) !== bits) throw new Error("不支持的 WAV 有效位深")
      }
    } else if (id === "data" && !data) data = bytes.subarray(start, start + size)
    offset = start + size + (size & 1)
  }
  if (![1, 3].includes(encoding)) throw new Error(`不支持的 WAV 编码：${encoding}`)
  if (!(channels > 0 && channels <= 32 && sampleRate > 0 && sampleRate <= 384000) || !data) throw new Error("WAV 缺少有效音频数据")
  if (!(encoding === 1 ? [8, 16, 24, 32] : [32, 64]).includes(bits) || alignment !== channels * bits / 8) throw new Error("不支持的 WAV 位深或帧大小")
  if (!data.length || data.length % alignment) throw new Error("WAV 音频帧不完整")
  const samplesDecoded = data.length / alignment
  if (samplesDecoded * channels * 4 > 256 * 1024 * 1024) throw new Error("WAV 解码后超过 256 MB")
  const pcm = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const channelData = Array.from({ length: channels }, () => new Float32Array(samplesDecoded))
  for (let frame = 0; frame < samplesDecoded; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      const offset = frame * alignment + channel * bits / 8
      let value: number
      if (encoding === 3) value = bits === 32 ? pcm.getFloat32(offset, true) : pcm.getFloat64(offset, true)
      else if (bits === 8) value = (pcm.getUint8(offset) - 128) / 128
      else if (bits === 16) value = pcm.getInt16(offset, true) / 32768
      else if (bits === 24) value = (pcm.getUint8(offset) | pcm.getUint8(offset + 1) << 8 | pcm.getInt8(offset + 2) << 16) / 8388608
      else value = pcm.getInt32(offset, true) / 2147483648
      if (!Number.isFinite(value)) throw new Error("WAV 包含无效采样值")
      channelData[channel][frame] = Math.max(-1, Math.min(1, value))
    }
  }
  return { channelData, samplesDecoded, sampleRate }
}
