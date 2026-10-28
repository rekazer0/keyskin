import { zipSync, Unzip, UnzipInflate, inflateSync, unzipSync } from "fflate"

export const MAX_FILES = 5_000

export const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024

export const MAX_UNPACKED_BYTES = 256 * 1024 * 1024

export const LOCAL_SIGNATURE = 0x04034b50

export const CENTRAL_SIGNATURE = 0x02014b50

export const END_SIGNATURE = 0x06054b50

type ZipEntry = {
  name: string
  central: Uint8Array
  local: Uint8Array
  method: number
  compressedSize: number
  uncompressedSize: number
}

export const view = (bytes: Uint8Array) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

function findEnd(bytes: Uint8Array): number {
  const data = view(bytes)
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset--) {
    if (data.getUint32(offset, true) === END_SIGNATURE) return offset
  }
  throw new Error("无效的 ZIP：找不到中央目录")
}

export function parseZip(bytes: Uint8Array): { entries: ZipEntry[]; end: Uint8Array } {
  const data = view(bytes)
  const endOffset = findEnd(bytes)
  const centralOffset = data.getUint32(endOffset + 16, true)
  const count = data.getUint16(endOffset + 10, true)
  const decoder = new TextDecoder()
  const partial: Array<Omit<ZipEntry, "local"> & { localOffset: number }> = []
  let offset = centralOffset
  for (let index = 0; index < count; index++) {
    if (data.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
      throw new Error("无效的 ZIP 中央目录")
    }
    const nameLength = data.getUint16(offset + 28, true)
    const extraLength = data.getUint16(offset + 30, true)
    const commentLength = data.getUint16(offset + 32, true)
    const length = 46 + nameLength + extraLength + commentLength
    const central = bytes.subarray(offset, offset + length)
    partial.push({
      name: decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)),
      central,
      localOffset: data.getUint32(offset + 42, true),
      method: data.getUint16(offset + 10, true),
      compressedSize: data.getUint32(offset + 20, true),
      uncompressedSize: data.getUint32(offset + 24, true),
    })
    offset += length
  }
  const byOffset = [...partial].sort((a, b) => a.localOffset - b.localOffset)
  const localEnds = new Map<string, number>()
  byOffset.forEach((entry, index) => {
    localEnds.set(entry.name, byOffset[index + 1]?.localOffset ?? centralOffset)
  })
  return {
    entries: partial.map(({ localOffset, ...entry }) => {
      if (data.getUint32(localOffset, true) !== LOCAL_SIGNATURE) {
        throw new Error(`无效的 ZIP 本地条目：${entry.name}`)
      }
      return { ...entry, local: bytes.subarray(localOffset, localEnds.get(entry.name)) }
    }),
    end: bytes.subarray(endOffset),
  }
}

/**
 * Sets `name` after an entry for each folder above it. Sogou's installer finds the resolution folders
 * (`1080/`) only through such entries; ZIP writers like fflate add none on their own.
 */
export function addZipEntry(output: Map<string, Uint8Array>, name: string, data: Uint8Array): void {
  const parts = name.split("/")
  for (let index = 1; index < parts.length; index++) {
    const directory = `${parts.slice(0, index).join("/")}/`
    if (!output.has(directory)) output.set(directory, new Uint8Array())
  }
  output.set(name, data)
}

/** The same files, each folder listed as its own entry ahead of its contents. */
export function withDirectoryEntries(files: Iterable<[string, Uint8Array]>): Map<string, Uint8Array> {
  const output = new Map<string, Uint8Array>()
  for (const [name, data] of files) addZipEntry(output, name, data)
  return output
}

export function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  view(bytes).setUint32(offset, value, true)
}

export function writeUint16(bytes: Uint8Array, offset: number, value: number): void {
  view(bytes).setUint16(offset, value, true)
}

function compressedPayload(data: Uint8Array, level: 0 | 6): {
  crc: number
  compressed: Uint8Array
} {
  const packed = zipSync({ x: [data, { level, mtime: new Date(1980, 0, 1) }] })
  const packedView = view(packed)
  const nameLength = packedView.getUint16(26, true)
  const extraLength = packedView.getUint16(28, true)
  const size = packedView.getUint32(18, true)
  const start = 30 + nameLength + extraLength
  return { crc: packedView.getUint32(14, true), compressed: packed.slice(start, start + size) }
}

export function changedLocal(entry: ZipEntry, data: Uint8Array): {
  local: Uint8Array
  crc: number
  compressedSize: number
} {
  const localView = view(entry.local)
  const nameLength = localView.getUint16(26, true)
  const extraLength = localView.getUint16(28, true)
  const dataOffset = 30 + nameLength + extraLength
  const trailerOffset = dataOffset + entry.compressedSize
  const { crc, compressed } = compressedPayload(data, entry.method === 0 ? 0 : 6)
  const header = entry.local.slice(0, dataOffset)
  const trailer = entry.local.slice(trailerOffset)
  if (localView.getUint16(6, true) & 8) {
    const descriptorOffset = view(trailer).getUint32(0, true) === 0x08074b50 ? 4 : 0
    writeUint32(trailer, descriptorOffset, crc)
    writeUint32(trailer, descriptorOffset + 4, compressed.length)
    writeUint32(trailer, descriptorOffset + 8, data.length)
  } else {
    writeUint32(header, 14, crc)
    writeUint32(header, 18, compressed.length)
    writeUint32(header, 22, data.length)
  }
  const output = new Uint8Array(header.length + compressed.length + trailer.length)
  output.set(header)
  output.set(compressed, header.length)
  output.set(trailer, header.length + compressed.length)
  return { local: output, crc, compressedSize: compressed.length }
}

export function safePath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.startsWith("\\") &&
    !/^[A-Za-z]:/.test(path) &&
    !path.split(/[\\/]/).includes("..")
  )
}

export function validateArchiveLimits(bytes: Uint8Array): void {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) throw new Error("皮肤文件超过 64 MB")
  const data = view(bytes)
  const endOffset = findEnd(bytes)
  const count = data.getUint16(endOffset + 10, true)
  if (count > MAX_FILES) throw new Error(`皮肤包含过多文件（${count}）`)
  const decoder = new TextDecoder()
  let offset = data.getUint32(endOffset + 16, true)
  let total = 0
  for (let index = 0; index < count; index++) {
    if (offset + 46 > endOffset || data.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
      throw new Error("无效的 ZIP 中央目录")
    }
    const nameLength = data.getUint16(offset + 28, true)
    const extraLength = data.getUint16(offset + 30, true)
    const commentLength = data.getUint16(offset + 32, true)
    const length = 46 + nameLength + extraLength + commentLength
    if (offset + length > endOffset) throw new Error("无效的 ZIP 中央目录")
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
    if (!safePath(name)) throw new Error(`皮肤包含不安全路径：${name}`)
    total += data.getUint32(offset + 24, true)
    if (total > MAX_UNPACKED_BYTES) throw new Error("皮肤解压后超过 256 MB")
    offset += length
  }
}

/**
 * 部分 Android 打包工具（以及少数第三方皮肤）会把 EOCD 里的“本磁盘条目数”留成 0，
 * 只把总条目数写对。fflate 只读前者，会把整包解出 0 个文件，皮肤因此打不开或预览失败。
 * 这里按中央目录把 EOCD 的计数补齐，顺带把磁盘号归零，得到常规单磁盘 ZIP。
 * 防解包工具还会把中央目录里的大小和本地头偏移全写成 0xFFFFFFFF（又没有 ZIP64 记录），
 * 解包按它算会报“超过 256 MB”或读出垃圾；这时按顺序用对应的本地文件头把这三个值补回。
 */
export function normalizeEntryCounts(bytes: Uint8Array): Uint8Array {
  let endOffset: number
  try {
    if (bytes.byteLength > MAX_ARCHIVE_BYTES) return bytes
    endOffset = findEnd(bytes)
  } catch {
    return bytes
  }
  const data = view(bytes)
  const total = data.getUint16(endOffset + 10, true)
  const repairs: Array<[number, number]> = [
    [endOffset + 4, 0],
    [endOffset + 6, 0],
    [endOffset + 8, total],
  ]
  const wideRepairs: Array<[number, number]> = []
  // 本地文件头的顺序可以和中央目录不同，按文件名对应。
  const decoder = new TextDecoder()
  const locals = new Map<string, number>()
  for (let local = 0; local + 30 <= bytes.length && data.getUint32(local, true) === LOCAL_SIGNATURE;) {
    locals.set(decoder.decode(bytes.subarray(local + 30, local + 30 + data.getUint16(local + 26, true))), local)
    local += 30 + data.getUint16(local + 26, true) + data.getUint16(local + 28, true) + data.getUint32(local + 18, true)
  }
  // ZIP64 把 8 字节大小放在中央目录的 extra 字段（id 1）里；值按“未压缩、压缩、偏移”的顺序出现。
  const zip64Values = (central: number, nameLength: number, extraLength: number): number[] | undefined => {
    let extra = central + 46 + nameLength
    const end = extra + extraLength
    while (extra + 4 <= end) {
      const content = extra + 4
      const size = data.getUint16(extra + 2, true)
      if (data.getUint16(extra, true) === 1) {
        const values: number[] = []
        for (let cursor = content; cursor + 8 <= content + size; cursor += 8) {
          const low = data.getUint32(cursor, true)
          const high = data.getUint32(cursor + 4, true)
          values.push(high === 0 ? low : Number.POSITIVE_INFINITY)
        }
        return values
      }
      extra = content + size
    }
    return
  }
  let central = data.getUint32(endOffset + 16, true)
  for (let index = 0; index < total && central + 46 <= endOffset && data.getUint32(central, true) === CENTRAL_SIGNATURE; index++) {
    const nameLength = data.getUint16(central + 28, true)
    const extraLength = data.getUint16(central + 30, true)
    const sentinel = new Set(
      [20, 24, 42].filter((field) => data.getUint32(central + field, true) === 0xffffffff),
    )
    if (sentinel.size) {
      const zipped = zip64Values(central, nameLength, extraLength)
      const order = [24, 20, 42].filter((field) => sentinel.has(field))
      for (const [position, field] of order.entries()) {
        const value = zipped?.[position]
        if (value === undefined || value >= 0xffffffff) continue
        wideRepairs.push([central + field, value])
        sentinel.delete(field)
      }
      const local = locals.get(decoder.decode(bytes.subarray(central + 46, central + 46 + nameLength)))
      // 带数据描述符且头里大小为 0 的条目补不回来，保持原样交给后面的本地文件头解包。
      if (local !== undefined && !(data.getUint16(local + 6, true) & 8 && !data.getUint32(local + 18, true))) {
        const fallback: Array<[number, number]> = [[24, data.getUint32(local + 22, true)], [20, data.getUint32(local + 18, true)], [42, local]]
        for (const [field, value] of fallback) {
          if (!sentinel.has(field) || value === 0xffffffff) continue
          wideRepairs.push([central + field, value])
        }
      }
    }
    central += 46 + nameLength + extraLength + data.getUint16(central + 32, true)
  }
  if (!wideRepairs.length && repairs.every(([offset, value]) => data.getUint16(offset, true) === value)) return bytes
  const normalized = bytes.slice()
  const normalizedView = view(normalized)
  for (const [offset, value] of repairs) normalizedView.setUint16(offset, value, true)
  for (const [offset, value] of wideRepairs) normalizedView.setUint32(offset, value, true)
  return normalized
}

/**
 * 部分“加密”打包工具会给每个条目都打上“数据描述符”标志（bit 3），实际却把大小写在本地文件头里、
 * 数据后面也没有描述符。fflate 的流式 Unzip 看到这个标志就忽略头里的大小，把下一个文件头前的
 * 12 字节当描述符吃掉，每个文件都少了结尾 12 字节（音效因此损坏、转换后没声音）。
 * 这里顺序扫本地文件头，只给“数据后面紧跟下一个 PK 头”的条目清掉这个标志，返回修正后的副本。
 */
function clearMissingDataDescriptorFlags(bytes: Uint8Array): Uint8Array {
  const data = view(bytes)
  const repairs: number[] = []
  let offset = 0
  while (offset + 30 <= bytes.length && data.getUint32(offset, true) === LOCAL_SIGNATURE) {
    const compressedSize = data.getUint32(offset + 18, true)
    const end = offset + 30 + data.getUint16(offset + 26, true) + data.getUint16(offset + 28, true) + compressedSize
    if (end + 4 > bytes.length) break
    const next = data.getUint32(end, true)
    if (next !== LOCAL_SIGNATURE && next !== CENTRAL_SIGNATURE) break
    if (data.getUint16(offset + 6, true) & 8 && compressedSize) repairs.push(offset + 6)
    offset = end
  }
  if (!repairs.length) return bytes
  const repaired = bytes.slice()
  const repairedView = view(repaired)
  for (const flagOffset of repairs) repairedView.setUint16(flagOffset, repairedView.getUint16(flagOffset, true) & ~8, true)
  return repaired
}

async function unzipWithProgress(
  input: Uint8Array,
  onProgress?: (value: number) => void,
): Promise<Record<string, Uint8Array>> {
  const bytes = clearMissingDataDescriptorFlags(input)
  const expected = view(bytes).getUint16(findEnd(bytes) + 10, true)
  const files: Record<string, Uint8Array> = {}
  let discovered = 0
  let completed = 0
  let inputProgress = 0
  let inputDone = false
  let settled = false
  let resolveResult!: (files: Record<string, Uint8Array>) => void
  let rejectResult!: (error: unknown) => void
  const result = new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    resolveResult = resolve
    rejectResult = reject
  })
  const finish = () => {
    onProgress?.(inputProgress * 0.7 + (expected ? completed / expected : 1) * 0.3)
    // 以实际读到的条目数为准：EOCD 里的总条目数被写坏时也能正常结束（空包也一样）。
    if (inputDone && completed === discovered && !settled) {
      settled = true
      resolveResult(files)
    }
  }
  const unzipper = new Unzip((file) => {
    discovered++
    const chunks: Uint8Array[] = []
    let length = 0
    file.ondata = (error, chunk, final) => {
      if (settled) return
      if (error) {
        settled = true
        rejectResult(error)
        return
      }
      chunks.push(chunk)
      length += chunk.length
      if (!final) return
      const data = new Uint8Array(length)
      let offset = 0
      for (const part of chunks) {
        data.set(part, offset)
        offset += part.length
      }
      files[file.name] = data
      completed++
      finish()
    }
    file.start()
  })
  unzipper.register(UnzipInflate)
  const chunkSize = 256 * 1024
  try {
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const end = Math.min(bytes.length, offset + chunkSize)
      unzipper.push(bytes.subarray(offset, end), end === bytes.length)
      inputProgress = end / bytes.length
      inputDone = end === bytes.length
      finish()
      // 没有进度回调时不需要让出主线程：分段推送只会白白付出 setTimeout 的钳制开销。
      if (!inputDone && onProgress) await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
  } catch (error) {
    settled = true
    rejectResult(error)
  }
  return result
}

/**
 * 只取出包里的一个文件：顺序扫本地文件头，只解压命中的条目。
 * 缩略图只要一张 demo 图，没必要把整包十几 MB 都解出来。
 * 条目大小写在数据描述符里、或压缩方式不常用时会返回 undefined，由调用方退回整包解压。
 */
export function readArchiveEntry(
  bytes: Uint8Array,
  match: (name: string) => boolean,
): { name: string; data: Uint8Array } | undefined {
  const data = view(bytes)
  const decoder = new TextDecoder()
  let offset = 0
  while (offset + 30 <= bytes.length && data.getUint32(offset, true) === LOCAL_SIGNATURE) {
    if (data.getUint16(offset + 6, true) & 8) return
    const method = data.getUint16(offset + 8, true)
    const compressedSize = data.getUint32(offset + 18, true)
    const nameLength = data.getUint16(offset + 26, true)
    const extraLength = data.getUint16(offset + 28, true)
    const start = offset + 30 + nameLength + extraLength
    const end = start + compressedSize
    if (end > bytes.length) return
    const name = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength))
    if (match(name)) {
      if (method === 0) return { name, data: bytes.slice(start, end) }
      if (method === 8) return { name, data: inflateSync(bytes.subarray(start, end)) }
      return
    }
    offset = end
  }
  return
}

/**
 * 少数第三方“加密”打包工具（如百叶加密）只保证本地文件头正确，中央目录里的压缩方式
 * 会被写成非法值，fflate 的 unzip/unzipSync 依赖中央目录，于是整包解出 0 个文件。
 * 这种情况退回流式解包：它顺序读本地文件头，能把这些皮肤正常读出来。
 */
export async function unpackArchive(
  bytes: Uint8Array,
  onProgress?: (value: number) => void,
): Promise<Record<string, Uint8Array>> {
  const report = onProgress ? (value: number) => onProgress(value * 0.85) : undefined
  try {
    // fflate's async `unzip` inflates big entries in blob workers, which the page CSP blocks
    // without ever calling back; small skins unpack synchronously instead.
    const unpacked = report ? await unzipWithProgress(bytes, report) : unzipSync(bytes)
    if (Object.keys(unpacked).length) return unpacked
  } catch {
    // 中央目录不可用，交给下面的本地文件头解包。
  }
  return unzipWithProgress(bytes)
}
