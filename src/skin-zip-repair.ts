import { CENTRAL_SIGNATURE, ENCRYPTION_FLAGS, LOCAL_SIGNATURE, MAX_ARCHIVE_BYTES, MAX_FILES, findEnd, view } from "./skin-zip.ts"

/** 本地文件头里的条目信息；中央目录被防解包工具写坏时，它是唯一可信的来源。 */
type LocalEntry = {
  offset: number
  flags: number
  method: number
  crc: number
  compressed: number
  uncompressed: number
}

/** 顺序扫描本地文件头，按文件名建立索引。 */
function scanLocalHeaders(bytes: Uint8Array, centralOffset: number, data: DataView): Map<string, LocalEntry> {
  const decoder = new TextDecoder()
  const entries = new Map<string, LocalEntry>()
  for (let offset = 0; offset + 30 <= centralOffset && data.getUint32(offset, true) === LOCAL_SIGNATURE;) {
    const nameLength = data.getUint16(offset + 26, true)
    const extraLength = data.getUint16(offset + 28, true)
    const compressed = data.getUint32(offset + 18, true)
    // 本地头也被写成 0xFFFFFFFF 时无法顺序扫描，交给中央目录的 ZIP64 分支。
    if (compressed === 0xffffffff) break
    try {
      entries.set(decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength)), {
        offset,
        flags: data.getUint16(offset + 6, true),
        method: data.getUint16(offset + 8, true),
        crc: data.getUint32(offset + 14, true),
        compressed,
        uncompressed: data.getUint32(offset + 22, true),
      })
    } catch {
      // 忽略无法解码的文件名
    }
    offset += 30 + nameLength + extraLength + compressed
  }
  return entries
}

/**
 * 防解包工具会把中央目录里的大小和本地头偏移全写成 0xFFFFFFFF（又没有 ZIP64 记录），
 * 还给条目打上假的“加密”标记；本地文件头则是完好的。
 * 按本地头把中央目录的字段补回，包才能被常规解包器和目标输入法读取。
 */
function rebuildCentralDirectory(
  bytes: Uint8Array,
  data: DataView,
  endOffset: number,
  centralOffset: number,
  total: number,
  decoder: TextDecoder,
): { bytes: Uint8Array; complete: boolean } | undefined {
  const locals = scanLocalHeaders(bytes, centralOffset, data)
  if (!locals.size) return
  const wide: Array<[number, number]> = []
  const narrow: Array<[number, number]> = []
  let matched = 0
  let complete = total > 0
  let central = centralOffset
  for (let index = 0; index < total && central + 46 <= endOffset; index++) {
    if (data.getUint32(central, true) !== CENTRAL_SIGNATURE) break
    const nameLength = data.getUint16(central + 28, true)
    const extraLength = data.getUint16(central + 30, true)
    const local = locals.get(decoder.decode(bytes.subarray(central + 46, central + 46 + nameLength)))
    if (local) {
      matched++
      // 带数据描述符且头里大小为 0 的条目补不回来，留给本地头顺序解包。
      const sized = (local.flags & 8) === 0 || local.compressed > 0
      const fields: Array<[number, number]> = [[20, local.compressed], [24, local.uncompressed], [42, local.offset]]
      for (const [field, value] of fields) {
        if (data.getUint32(central + field, true) !== 0xffffffff) continue
        if (!sized || value === 0xffffffff) {
          complete = false
          continue
        }
        wide.push([central + field, value])
      }
      if ((local.flags & 8) === 0 && data.getUint32(central + 16, true) !== local.crc) wide.push([central + 16, local.crc])
      if (data.getUint16(central + 8, true) !== local.flags) narrow.push([central + 8, local.flags])
      if (data.getUint16(central + 10, true) !== local.method) narrow.push([central + 10, local.method])
    } else {
      complete = false
    }
    central += 46 + nameLength + extraLength + data.getUint16(central + 32, true)
  }
  if (matched < total || locals.size < total) complete = false
  const countsWrong = data.getUint16(endOffset + 4, true) !== 0
    || data.getUint16(endOffset + 6, true) !== 0
    || data.getUint16(endOffset + 8, true) !== total
    || data.getUint16(endOffset + 10, true) !== total
  if (!wide.length && !narrow.length && !countsWrong) return
  const normalized = bytes.slice()
  const target = view(normalized)
  target.setUint16(endOffset + 4, 0, true)
  target.setUint16(endOffset + 6, 0, true)
  target.setUint16(endOffset + 8, total, true)
  target.setUint16(endOffset + 10, total, true)
  for (const [offset, value] of wide) target.setUint32(offset, value, true)
  for (const [offset, value] of narrow) target.setUint16(offset, value, true)
  return { bytes: normalized, complete }
}

/**
 * 少数第三方打包器（如微光 9.0）在中央目录给每个条目都打上“加密”标记，本地文件头却是干净的，
 * 数据也能正常解开——这是防解包用的假标记。ZIP 解压时以本地文件头为准，所以按本地头清掉中央目录里的假标记，
 * 让保存和转换出的包不再带着会让其它工具误判为加密的字段。
 */
function clearDecoyCentralEncryption(bytes: Uint8Array): Uint8Array {
  let endOffset: number
  try {
    endOffset = findEnd(bytes)
  } catch {
    return bytes
  }
  const data = view(bytes)
  const repairs: Array<[number, number]> = []
  let central = data.getUint32(endOffset + 16, true)
  // 不看 EOCD 的条目数：计数被写坏时中央目录本身仍然可读，假加密标记也要清掉。
  for (let index = 0; index < MAX_FILES && central + 46 <= endOffset; index++) {
    if (data.getUint32(central, true) !== CENTRAL_SIGNATURE) break
    const nameLength = data.getUint16(central + 28, true)
    const flags = data.getUint16(central + 8, true)
    const localOffset = data.getUint32(central + 42, true)
    if ((flags & ENCRYPTION_FLAGS) && localOffset + 30 <= bytes.length && data.getUint32(localOffset, true) === LOCAL_SIGNATURE) {
      const localFlags = data.getUint16(localOffset + 6, true)
      const localNameLength = data.getUint16(localOffset + 26, true)
      if ((localFlags & ENCRYPTION_FLAGS) === 0 && localNameLength === nameLength) {
        const centralName = bytes.subarray(central + 46, central + 46 + nameLength)
        const localName = bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength)
        if (localName.every((byte, position) => byte === centralName[position])) {
          repairs.push([central + 8, flags & ~ENCRYPTION_FLAGS])
        }
      }
    }
    central += 46 + nameLength + data.getUint16(central + 30, true) + data.getUint16(central + 32, true)
  }
  if (!repairs.length) return bytes
  const normalized = bytes.slice()
  const normalizedView = view(normalized)
  for (const [offset, value] of repairs) normalizedView.setUint16(offset, value, true)
  return normalized
}

/**
 * 部分 Android 打包工具（以及少数第三方皮肤）会把 EOCD 里的“本磁盘条目数”留成 0，
 * 只把总条目数写对。fflate 只读前者，会把整包解出 0 个文件，皮肤因此打不开或预览失败。
 * 这里按中央目录把 EOCD 的计数补齐，顺带把磁盘号归零，得到常规单磁盘 ZIP。
 * 防解包工具还会把中央目录里的大小和本地头偏移全写成 0xFFFFFFFF（又没有 ZIP64 记录），
 * 解包按它算会报“超过 256 MB”或读出垃圾；这时按顺序用对应的本地文件头把这三个值补回。
 */
export function normalizeArchive(bytes: Uint8Array): Uint8Array {
  let endOffset: number
  try {
    if (bytes.byteLength > MAX_ARCHIVE_BYTES) return bytes
    endOffset = findEnd(bytes)
  } catch {
    return bytes
  }
  const data = view(bytes)
  const decoder = new TextDecoder()
  const total = data.getUint16(endOffset + 10, true)
  const centralOffset = data.getUint32(endOffset + 16, true)

  // 检测是否所有本地头偏移都是 0xFFFFFFFF（防解包工具情况）
  let allOffsetsInvalid = true
  let checkOffset = centralOffset
  for (let i = 0; i < Math.min(total, 10); i++) {
    if (checkOffset + 46 > endOffset || data.getUint32(checkOffset, true) !== CENTRAL_SIGNATURE) break
    const localOffset = data.getUint32(checkOffset + 42, true)
    if (localOffset !== 0xFFFFFFFF) {
      allOffsetsInvalid = false
      break
    }
    const nameLen = data.getUint16(checkOffset + 28, true)
    const extraLen = data.getUint16(checkOffset + 30, true)
    const commentLen = data.getUint16(checkOffset + 32, true)
    checkOffset += 46 + nameLen + extraLen + commentLen
  }

  if (allOffsetsInvalid) {
    const rebuilt = rebuildCentralDirectory(bytes, data, endOffset, centralOffset, total, decoder)
    if (rebuilt) return clearDecoyCentralEncryption(rebuilt.bytes)
  }

  // 中央目录只有个别字段是 0xFFFFFFFF：优先读 ZIP64 extra，其次读对应的本地文件头。
  const repairs: Array<[number, number]> = [
    [endOffset + 4, 0],
    [endOffset + 6, 0],
    [endOffset + 8, total],
  ]
  const wideRepairs: Array<[number, number]> = []
  // 本地文件头的顺序可以和中央目录不同，按文件名对应。
  const locals = new Map<string, number>()
  for (let local = 0; local + 30 <= centralOffset && data.getUint32(local, true) === LOCAL_SIGNATURE;) {
    locals.set(decoder.decode(bytes.subarray(local + 30, local + 30 + data.getUint16(local + 26, true))), local)
    local += 30 + data.getUint16(local + 26, true) + data.getUint16(local + 28, true) + data.getUint32(local + 18, true)
  }
  // ZIP64 把 8 字节大小放在中央目录的 extra 字段（id 1）里；值按”未压缩、压缩、偏移”的顺序出现。
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
  let central = centralOffset
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
  if (!wideRepairs.length && repairs.every(([offset, value]) => data.getUint16(offset, true) === value)) {
    return clearDecoyCentralEncryption(bytes)
  }
  const normalized = bytes.slice()
  const normalizedView = view(normalized)
  for (const [offset, value] of repairs) normalizedView.setUint16(offset, value, true)
  for (const [offset, value] of wideRepairs) normalizedView.setUint32(offset, value, true)
  return clearDecoyCentralEncryption(normalized)
}
