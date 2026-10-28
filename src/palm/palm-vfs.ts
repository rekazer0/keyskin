// A read-only directory tree mirroring the converter's temporary input folder.
//
// The Swift reference implementation copies the skin payload into a temp directory and
// then walks it with `FileManager`. Zip archives only give us a flat list of entries, so
// this class rebuilds that tree (files plus directories) from the archive path list.

type PalmRootEntry = { path: string; bytes?: Uint8Array }

// The converter addresses every file through `URL`, and CFURL decomposes file paths to
// NFD, so names that reach the exported JSON are always decomposed. Storing the tree in
// the same form keeps lookups (which are normalisation insensitive on disk) working.
export function normalizePalmPath(path: string): string {
  const parts = path.split("/").filter((part) => part !== "" && part !== ".")
  return parts.join("/").normalize("NFD")
}

export function palmBaseName(path: string): string {
  const normalized = normalizePalmPath(path)
  const separator = normalized.lastIndexOf("/")
  return separator < 0 ? normalized : normalized.slice(separator + 1)
}

export function palmJoinPath(parent: string, name: string): string {
  return normalizePalmPath(`${parent}/${name}`)
}

// `FileManager.contentsOfDirectory` hands back directory entries in file system order
// rather than sorted. On APFS a directory is a B-tree keyed by the entry name, so that
// order is reproducible from the names alone: hash the NFD, case folded name as UTF-32LE
// with CRC-32C, keep the low 22 bits, and pack them above the UTF-8 byte length. Ties fall
// back to a byte wise name comparison (`apfs_strncmp`).
const APFS_HASH_MASK = 0x3fffff
const APFS_LENGTH_MASK = 0x3ff

const crc32cTable = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < table.length; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? (value >>> 1) ^ 0x82f63b78 : value >>> 1
    table[index] = value >>> 0
  }
  return table
})()

type ApfsEntryKey = { packed: number; bytes: Uint8Array }

const apfsEntryKeys = new Map<string, ApfsEntryKey>()

function apfsEntryKey(name: string): ApfsEntryKey {
  const cached = apfsEntryKeys.get(name)
  if (cached !== undefined) return cached
  const bytes = new TextEncoder().encode(name)
  let crc = 0xffffffff
  for (const character of name.normalize("NFD").toLowerCase()) {
    const code = character.codePointAt(0) ?? 0
    for (let shift = 0; shift < 32; shift += 8) {
      crc = ((crc >>> 8) ^ crc32cTable[(crc ^ ((code >>> shift) & 0xff)) & 0xff]) >>> 0
    }
  }
  const packed = (((crc & APFS_HASH_MASK) << 10) | (bytes.length & APFS_LENGTH_MASK)) >>> 0
  const key = { packed, bytes }
  apfsEntryKeys.set(name, key)
  return key
}

function comparePalmDirectoryNames(left: string, right: string): number {
  const a = apfsEntryKey(left)
  const b = apfsEntryKey(right)
  if (a.packed !== b.packed) return a.packed < b.packed ? -1 : 1
  const shared = Math.min(a.bytes.length, b.bytes.length)
  for (let index = 0; index < shared; index += 1) {
    if (a.bytes[index] !== b.bytes[index]) return a.bytes[index] < b.bytes[index] ? -1 : 1
  }
  return 0
}

// Directory relative path comparison, so a filtered subset of `allFiles()` keeps the walk
// order the converter saw. Only the `menu` field needs it: its outer array is positional
// (the source ships several toolbar plists and the converter numbers them by directory
// order), so the reference values only line up when the same order is replayed.
export function comparePalmDirectoryPaths(left: string, right: string): number {
  const a = normalizePalmPath(left).split("/")
  const b = normalizePalmPath(right).split("/")
  const shared = Math.min(a.length, b.length)
  for (let index = 0; index < shared; index += 1) {
    const order = comparePalmDirectoryNames(a[index], b[index])
    if (order !== 0) return order
  }
  return 0
}

export class PalmVirtualRoot {
  private readonly files = new Map<string, Uint8Array>()
  private readonly directories = new Set<string>([""])
  private readonly childNames = new Map<string, Set<string>>()

  constructor(entries: PalmRootEntry[]) {
    for (const entry of entries) {
      const path = normalizePalmPath(entry.path)
      if (!path) continue
      const parts = path.split("/")
      let parent = ""
      for (let index = 0; index < parts.length - 1; index += 1) {
        const directory = palmJoinPath(parent, parts[index])
        this.directories.add(directory)
        this.linkChild(parent, parts[index])
        parent = directory
      }
      const name = parts[parts.length - 1]
      if (entry.bytes) this.files.set(path, entry.bytes)
      this.linkChild(parent, name)
    }
  }

  private linkChild(parent: string, name: string): void {
    const existing = this.childNames.get(parent)
    if (existing) existing.add(name)
    else this.childNames.set(parent, new Set([name]))
  }

  exists(path: string): boolean {
    const normalized = normalizePalmPath(path)
    return this.files.has(normalized) || this.directories.has(normalized)
  }

  isDirectory(path: string): boolean {
    return this.directories.has(normalizePalmPath(path))
  }

  bytes(path: string): Uint8Array | undefined {
    return this.files.get(normalizePalmPath(path))
  }

  // Mirrors `FileManager.contentsOfDirectory`: immediate children, files and folders alike.
  childPaths(path: string): string[] {
    const normalized = normalizePalmPath(path)
    const names = this.childNames.get(normalized)
    if (!names) return []
    return [...names].sort().map((name) => palmJoinPath(normalized, name))
  }

  // Mirrors `FileManager.filesInDirectory`: nil when the folder is missing, and folder
  // entries are included because the Swift helper does not filter them out.
  filesInDirectory(path: string): string[] | undefined {
    if (!this.isDirectory(path)) return undefined
    return this.childPaths(path)
  }

  // Mirrors `FileManager.allFiles(atPath:)`: recursive, files only.
  allFiles(path: string): string[] {
    if (!this.isDirectory(path)) return []
    const result: string[] = []
    const walk = (directory: string): void => {
      for (const child of this.childPaths(directory)) {
        if (this.isDirectory(child)) walk(child)
        else result.push(child)
      }
    }
    walk(path)
    return result
  }
}
