import { deflateSync, strToU8, zipSync, Unzip, UnzipInflate, inflateSync, unzipSync } from "fflate"

export const MAX_FILES = 5_000

export const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024

export const MAX_UNPACKED_BYTES = 256 * 1024 * 1024

export const LOCAL_SIGNATURE = 0x04034b50

export const CENTRAL_SIGNATURE = 0x02014b50

export const END_SIGNATURE = 0x06054b50

const DATA_DESCRIPTOR_FLAG = 1 << 3
const ENCRYPTION_FLAGS = (1 << 0) | (1 << 6) | (1 << 13)

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

export function isZipEntryEncrypted(entry: ZipEntry): boolean {
  const localFlags = entry.local.byteLength >= 8 ? view(entry.local).getUint16(6, true) : 0
  return Boolean((localFlags | view(entry.central).getUint16(8, true)) & ENCRYPTION_FLAGS)
}

function findEnd(bytes: Uint8Array): number {
  const data = view(bytes)
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset--) {
    if (data.getUint32(offset, true) === END_SIGNATURE) return offset
  }
  throw new Error("无效的 ZIP：找不到中央目录")
}

/** 恢复损坏的 ZIP 中所有本地头偏移都是 0xFFFFFFFF 的情况：通过扫描本地头签名来恢复 */
function recoverLocalHeaders(bytes: Uint8Array, centralOffset: number): Map<string, number> {
  const decoder = new TextDecoder()
  const localOffsets = new Map<string, number>()

  // 第一遍：扫描所有本地头及其文件名
  let offset = 0
  const localHeaders: Array<{ offset: number; name: string }> = []

  while (offset < centralOffset && offset < bytes.length - 4) {
    // 寻找本地头签名 PK\x03\x04
    if (bytes[offset] === 0x50 && bytes[offset + 1] === 0x4b && bytes[offset + 2] === 0x03 && bytes[offset + 3] === 0x04) {
      if (offset + 30 <= Math.min(centralOffset, bytes.length)) {
        const nameLength = view(bytes).getUint16(offset + 26, true)
        const extraLength = view(bytes).getUint16(offset + 28, true)

        if (nameLength > 0 && nameLength < 300 && extraLength < 10000) {
          const headerEnd = offset + 30 + nameLength + extraLength
          if (headerEnd <= centralOffset) {
            try {
              const name = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength))
              localHeaders.push({ offset, name })
            } catch {
              // 忽略解码失败
            }
          }
        }
      }
    }
    offset += 1
  }

  // 第二遍：匹配中央目录中的文件名到本地头
  // 使用贪心算法：按文件名字节特征匹配
  for (const { offset: localOffset, name } of localHeaders) {
    localOffsets.set(name, localOffset)
  }

  return localOffsets
}

export function parseZip(bytes: Uint8Array): { entries: ZipEntry[]; end: Uint8Array } {
  const data = view(bytes)
  const endOffset = findEnd(bytes)
  const centralOffset = data.getUint32(endOffset + 16, true)
  const count = data.getUint16(endOffset + 10, true)
  const decoder = new TextDecoder()
  const partial: Array<Omit<ZipEntry, "local"> & { localOffset: number }> = []
  let offset = centralOffset

  // 检测是否所有本地头偏移都是 0xFFFFFFFF（损坏的 ZIP）
  let allOffsetsInvalid = true
  for (let checkOffset = centralOffset, checkIndex = 0; checkIndex < Math.min(count, 10); checkIndex++) {
    if (data.getUint32(checkOffset, true) !== CENTRAL_SIGNATURE) break
    const nameLength = data.getUint16(checkOffset + 28, true)
    const extraLength = data.getUint16(checkOffset + 30, true)
    const commentLength = data.getUint16(checkOffset + 32, true)
    const localOffset = data.getUint32(checkOffset + 42, true)
    if (localOffset !== 0xFFFFFFFF) {
      allOffsetsInvalid = false
      break
    }
    checkOffset += 46 + nameLength + extraLength + commentLength
  }

  // 如果本地头偏移都损坏，尝试从本地头扫描恢复
  const recoveredOffsets = allOffsetsInvalid ? recoverLocalHeaders(bytes, centralOffset) : new Map()

  for (let index = 0; index < count; index++) {
    if (data.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
      throw new Error("无效的 ZIP 中央目录")
    }
    const nameLength = data.getUint16(offset + 28, true)
    const extraLength = data.getUint16(offset + 30, true)
    const commentLength = data.getUint16(offset + 32, true)
    const length = 46 + nameLength + extraLength + commentLength
    const central = bytes.subarray(offset, offset + length)

    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
    let compressedSize = data.getUint32(offset + 20, true)
    let uncompressedSize = data.getUint32(offset + 24, true)
    let localOffset = data.getUint32(offset + 42, true)

    // 处理 ZIP64：如果大小值为 0xFFFFFFFF，从扩展字段中读取实际大小
    if ((compressedSize === 0xFFFFFFFF || uncompressedSize === 0xFFFFFFFF || localOffset === 0xFFFFFFFF) && extraLength > 0) {
      let extraOffset = offset + 46 + nameLength
      let extraEnd = extraOffset + extraLength
      while (extraOffset + 4 <= extraEnd) {
        const headerId = data.getUint16(extraOffset, true)
        const headerSize = data.getUint16(extraOffset + 2, true)
        extraOffset += 4

        // ZIP64 扩展字段标签为 0x0001
        if (headerId === 0x0001 && headerSize >= 24) {
          if (uncompressedSize === 0xFFFFFFFF) {
            uncompressedSize = Number(data.getBigUint64(extraOffset, true))
          }
          if (compressedSize === 0xFFFFFFFF) {
            compressedSize = Number(data.getBigUint64(extraOffset + 8, true))
          }
          if (localOffset === 0xFFFFFFFF) {
            localOffset = Number(data.getBigUint64(extraOffset + 16, true))
          }
          break
        }
        extraOffset += headerSize
      }
    }

    // 如果仍然无法获得本地头偏移，尝试从扫描恢复
    if (localOffset === 0xFFFFFFFF && recoveredOffsets.has(name)) {
      localOffset = recoveredOffsets.get(name)!
      // 从恢复的本地头中读取大小
      if (localOffset + 30 <= bytes.length) {
        if (compressedSize === 0xFFFFFFFF) {
          compressedSize = data.getUint32(localOffset + 18, true)
        }
        if (uncompressedSize === 0xFFFFFFFF) {
          uncompressedSize = data.getUint32(localOffset + 22, true)
        }
      }
    }

    partial.push({
      name,
      central,
      localOffset,
      method: data.getUint16(offset + 10, true),
      compressedSize,
      uncompressedSize,
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
      if (localOffset === 0xFFFFFFFF) {
        throw new Error(`无效的 ZIP 本地头偏移：${entry.name}（无法恢复）`)
      }
      if (data.getUint32(localOffset, true) !== LOCAL_SIGNATURE) {
        throw new Error(`无效的 ZIP 本地条目：${entry.name}`)
      }

      // 从本地头中读取实际大小（如果中央目录中的大小是 0xFFFFFFFF）
      let compressedSize = entry.compressedSize
      let uncompressedSize = entry.uncompressedSize
      if ((compressedSize === 0xFFFFFFFF || uncompressedSize === 0xFFFFFFFF) && localOffset + 30 < bytes.length) {
        const localCompressed = data.getUint32(localOffset + 18, true)
        const localUncompressed = data.getUint32(localOffset + 22, true)
        if (compressedSize === 0xFFFFFFFF && localCompressed !== 0xFFFFFFFF) {
          compressedSize = localCompressed
        }
        if (uncompressedSize === 0xFFFFFFFF && localUncompressed !== 0xFFFFFFFF) {
          uncompressedSize = localUncompressed
        }
      }

      return { ...entry, compressedSize, uncompressedSize, local: bytes.subarray(localOffset, localEnds.get(entry.name)) }
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

const crc32Table = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < table.length; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1
    table[index] = value >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let index = 0; index < bytes.length; index += 1) crc = crc32Table[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

// 文件名统一按 UTF-8 存储；打包时间固定成 1980-01-01，同一个皮肤两次导出的字节完全一致。
const ZIP_UTF8_FLAG = 0x800
const ZIP_VERSION = 20
const ZIP_DOS_DATE = 33

function zipLocalHeader(name: Uint8Array, method: number, crc: number, compressedSize: number, size: number): Uint8Array {
  const header = new Uint8Array(30 + name.length)
  const data = view(header)
  data.setUint32(0, LOCAL_SIGNATURE, true)
  data.setUint16(4, ZIP_VERSION, true)
  data.setUint16(6, ZIP_UTF8_FLAG, true)
  data.setUint16(8, method, true)
  data.setUint16(12, ZIP_DOS_DATE, true)
  data.setUint32(14, crc, true)
  data.setUint32(18, compressedSize, true)
  data.setUint32(22, size, true)
  data.setUint16(26, name.length, true)
  header.set(name, 30)
  return header
}

function zipCentralHeader(name: Uint8Array, method: number, crc: number, compressedSize: number, size: number, offset: number): Uint8Array {
  const header = new Uint8Array(46 + name.length)
  const data = view(header)
  data.setUint32(0, CENTRAL_SIGNATURE, true)
  data.setUint16(4, ZIP_VERSION, true)
  data.setUint16(6, ZIP_VERSION, true)
  data.setUint16(8, ZIP_UTF8_FLAG, true)
  data.setUint16(10, method, true)
  data.setUint16(14, ZIP_DOS_DATE, true)
  data.setUint32(16, crc, true)
  data.setUint32(20, compressedSize, true)
  data.setUint32(24, size, true)
  data.setUint16(28, name.length, true)
  data.setUint32(42, offset, true)
  header.set(name, 46)
  return header
}

/**
 * 逐文件压缩、按文件让出主线程的 ZIP 写入，用于长任务导出。
 * 不用 fflate 的异步 `zip`：它把大文件丢给 blob worker，页面 CSP 会拦掉且不再回调。
 */
export async function zipArchiveAsync(
  files: Record<string, Uint8Array>,
  onProgress?: (fraction: number) => void | Promise<void>,
): Promise<Uint8Array> {
  const names = Object.keys(files)
  const chunks: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  let last = performance.now()
  await onProgress?.(0)
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  for (const [index, name] of names.entries()) {
    const data = files[name]
    const method = data.length === 0 ? 0 : 8
    const payload = method === 0 ? data : deflateSync(data, { level: 6 })
    const crc = crc32(data)
    const nameBytes = strToU8(name)
    const local = zipLocalHeader(nameBytes, method, crc, payload.length, data.length)
    chunks.push(local, payload)
    centrals.push(zipCentralHeader(nameBytes, method, crc, payload.length, data.length, offset))
    offset += local.length + payload.length
    if (performance.now() - last >= 12) {
      last = performance.now()
      await onProgress?.((index + 1) / names.length)
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
  }
  const centralSize = centrals.reduce((total, chunk) => total + chunk.length, 0)
  const end = new Uint8Array(22)
  const endView = view(end)
  endView.setUint32(0, END_SIGNATURE, true)
  endView.setUint16(8, names.length, true)
  endView.setUint16(10, names.length, true)
  endView.setUint32(12, centralSize, true)
  endView.setUint32(16, offset, true)
  const output = new Uint8Array(offset + centralSize + end.length)
  let written = 0
  for (const chunk of [...chunks, ...centrals, end]) {
    output.set(chunk, written)
    written += chunk.length
  }
  await onProgress?.(1)
  return output
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  view(bytes).setUint32(offset, value, true)
}

function writeUint16(bytes: Uint8Array, offset: number, value: number): void {
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

function changedLocal(entry: ZipEntry, data: Uint8Array): {
  local: Uint8Array
  crc: number
  compressedSize: number
  removedDescriptorFlag: boolean
} {
  const localView = view(entry.local)
  if (entry.local.length < 30) throw new Error(`ZIP 条目的文件头不完整：${entry.name}`)
  const flags = localView.getUint16(6, true)
  if (isZipEntryEncrypted(entry)) {
    throw new Error(`无法重写标记为加密的 ZIP 条目：${entry.name}。请使用未加密的原始皮肤包`)
  }
  const nameLength = localView.getUint16(26, true)
  const extraLength = localView.getUint16(28, true)
  const dataOffset = 30 + nameLength + extraLength
  const trailerOffset = dataOffset + entry.compressedSize
  if (trailerOffset > entry.local.length) throw new Error(`ZIP 条目的压缩数据不完整：${entry.name}`)
  const { crc, compressed } = compressedPayload(data, entry.method === 0 ? 0 : 6)
  const header = entry.local.slice(0, dataOffset)
  let trailer = entry.local.slice(trailerOffset)
  const hasDescriptor = (flags & DATA_DESCRIPTOR_FLAG) !== 0
  const descriptorOffset = hasDescriptor && trailer.length >= 4 && view(trailer).getUint32(0, true) === 0x08074b50 ? 4 : 0
  const removedDescriptorFlag = hasDescriptor && trailer.length < descriptorOffset + 12
  if (hasDescriptor && !removedDescriptorFlag) {
    writeUint32(trailer, descriptorOffset, crc)
    writeUint32(trailer, descriptorOffset + 4, compressed.length)
    writeUint32(trailer, descriptorOffset + 8, data.length)
  } else {
    if (removedDescriptorFlag) {
      // 新数据的 CRC 和大小已知，直接写入文件头，不再依赖不完整的数据描述符。
      writeUint16(header, 6, flags & ~DATA_DESCRIPTOR_FLAG)
      trailer = trailer.subarray(0, 0)
    }
    writeUint32(header, 14, crc)
    writeUint32(header, 18, compressed.length)
    writeUint32(header, 22, data.length)
  }
  const output = new Uint8Array(header.length + compressed.length + trailer.length)
  output.set(header)
  output.set(compressed, header.length)
  output.set(trailer, header.length + compressed.length)
  return { local: output, crc, compressedSize: compressed.length, removedDescriptorFlag }
}

/** 只压缩新增或改动的条目，其他本地文件头和压缩数据原样复用。undefined 表示删除。 */
export function patchZip(source: ReturnType<typeof parseZip>, changes: ReadonlyMap<string, Uint8Array | undefined>): Uint8Array {
  const sourceNames = new Set(source.entries.map((entry) => entry.name))
  const added = [...changes].flatMap(([name, data]) => !sourceNames.has(name) && data
    ? [parseZip(zipSync({ [name]: [data, { level: 6, mtime: new Date(1980, 0, 1) }] })).entries[0]]
    : [])
  const entries = [...source.entries.filter((entry) => !changes.has(entry.name) || changes.get(entry.name)), ...added]
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let localOffset = 0
  for (const entry of entries) {
    const data = sourceNames.has(entry.name) ? changes.get(entry.name) : undefined
    const changed = data ? changedLocal(entry, data) : undefined
    const local = changed?.local ?? entry.local
    const central = entry.central.slice()
    writeUint32(central, 42, localOffset)
    if (changed && data) {
      if (changed.removedDescriptorFlag) writeUint16(central, 8, view(central).getUint16(8, true) & ~DATA_DESCRIPTOR_FLAG)
      writeUint32(central, 16, changed.crc)
      writeUint32(central, 20, changed.compressedSize)
      writeUint32(central, 24, data.length)
    }
    locals.push(local)
    centrals.push(central)
    localOffset += local.length
  }
  const centralSize = centrals.reduce((total, bytes) => total + bytes.length, 0)
  const end = source.end.slice()
  writeUint16(end, 8, entries.length)
  writeUint16(end, 10, entries.length)
  writeUint32(end, 12, centralSize)
  writeUint32(end, 16, localOffset)
  const output = new Uint8Array(localOffset + centralSize + end.length)
  let offset = 0
  for (const part of [...locals, ...centrals, end]) {
    output.set(part, offset)
    offset += part.length
  }
  return output
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
