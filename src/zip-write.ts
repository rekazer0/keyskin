// ZIP 写入的底层助手：CRC32、本地/中央目录头与整数字段写入。
// 只有 skin-zip 的导出路径用到，单独成文件避免主模块超过 800 行。

const LOCAL_SIGNATURE = 0x04034b50
const CENTRAL_SIGNATURE = 0x02014b50
const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

const crc32Table = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < table.length; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1
    table[index] = value >>> 0
  }
  return table
})()

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let index = 0; index < bytes.length; index += 1) crc = crc32Table[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

// 文件名统一按 UTF-8 存储；打包时间固定成 1980-01-01，同一个皮肤两次导出的字节完全一致。
const ZIP_UTF8_FLAG = 0x800
const ZIP_VERSION = 20
const ZIP_DOS_DATE = 33

export function zipLocalHeader(name: Uint8Array, method: number, crc: number, compressedSize: number, size: number): Uint8Array {
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

export function zipCentralHeader(name: Uint8Array, method: number, crc: number, compressedSize: number, size: number, offset: number): Uint8Array {
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

export function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  view(bytes).setUint32(offset, value, true)
}

export function writeUint16(bytes: Uint8Array, offset: number, value: number): void {
  view(bytes).setUint16(offset, value, true)
}

