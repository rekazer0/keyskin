export function prefixedSourcePath(path: string, prefix: string): string {
  return /^(?:info\.txt|demo\.png)$/i.test(path) ? path : prefix + path
}

export function sourcePathLookup(paths: readonly string[], prefix: string): (path: string) => string {
  const exact = new Set(paths)
  const folded = new Map(paths.map(path => [path.toLowerCase(), path]))
  return path => {
    const candidate = prefixedSourcePath(path, prefix)
    return exact.has(candidate) ? candidate : folded.get(candidate.toLowerCase()) ?? candidate
  }
}

export type SourceWriteSnapshot = Uint8Array | null

export function consumeSourceWriteSnapshot(
  snapshots: Map<string, SourceWriteSnapshot[]>,
  path: string,
  data: SourceWriteSnapshot,
): boolean {
  const candidates = snapshots.get(path)
  const index = candidates?.findIndex((candidate) =>
    candidate === null || data === null
      ? candidate === data
      : candidate.length === data.length && candidate.every((byte, offset) => byte === data[offset]),
  ) ?? -1
  if (index < 0 || !candidates) return false
  candidates.splice(0, index + 1)
  if (!candidates.length) snapshots.delete(path)
  return true
}

export async function writePendingSourcePaths(
  pending: Set<string>,
  write: (paths: string[]) => Promise<void>,
): Promise<void> {
  const paths = [...pending]
  if (!paths.length) return
  pending.clear()
  try {
    await write(paths)
  } catch (error) {
    for (const path of paths) pending.add(path)
    throw error
  }
}
