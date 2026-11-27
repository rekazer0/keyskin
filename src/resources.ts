export function firstExistingPath(
  names: readonly string[],
  directory: string,
  candidates: readonly string[],
): string | undefined {
  return candidates.map((name) => `${directory}/${name}`).find((path) => names.includes(path))
}

export function resourceImagePaths(
  names: readonly string[],
  theme: string,
  orientation: string,
): string[] {
  const roots = [`${theme}/skin/${orientation}/res/`, `${theme}/skin/res/`]
  const relative = new Set<string>()
  return roots.flatMap((root) => names
    .filter((path) => path.startsWith(root) && path.toLowerCase().endsWith(".png"))
    .sort()
    .flatMap((path) => {
      const name = path.slice(root.length)
      if (relative.has(name)) return []
      relative.add(name)
      return [path]
    }))
}

/** Keep direct logo images separate from each first-level subfolder. */
export function logoImageFolder(path: string): string | undefined {
  return /^[^/]+\/skin\/res\/(logo(?:\/[^/]+)?)\//.exec(path)?.[1]
}
