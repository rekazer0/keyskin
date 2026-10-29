type UpdateResult =
  | { status: "latest"; currentVersion: string; latestVersion: string }
  | { status: "available"; currentVersion: string; latestVersion: string; url: string }

const releaseApiUrl = "https://api.github.com/repos/rekazer0/BdiEditor/releases/latest"

/** `2.0.0-beta6` as its numbers and its pre-release label (`beta6`; empty for a release). */
function versionParts(value: string): { core: number[]; pre: string } | undefined {
  const match = value.trim().replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)(?:-?([0-9A-Za-z.]+))?/)
  return match ? { core: match.slice(1, 4).map(Number), pre: match[4] ?? "" } : undefined
}

/** Semantic-version order: a release follows its pre-releases, and `beta10` follows `beta9`. */
function compareVersions(left: string, right: string): number {
  const a = versionParts(left) ?? { core: [0, 0, 0], pre: "" }
  const b = versionParts(right) ?? { core: [0, 0, 0], pre: "" }
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] > b.core[index] ? 1 : -1
  }
  if (a.pre === b.pre) return 0
  if (!a.pre || !b.pre) return a.pre ? -1 : 1
  return Math.sign(a.pre.localeCompare(b.pre, "en", { numeric: true }))
}

export async function checkForUpdate(currentVersion: string, fetcher = fetch): Promise<UpdateResult> {
  const response = await fetcher(releaseApiUrl)
  if (!response.ok) throw new Error(`GitHub 返回 ${response.status}`)
  const body = await response.text()
  let apiVersion: string | undefined
  try {
    const payload = JSON.parse(body) as { tag_name?: unknown }
    if (typeof payload.tag_name === "string") apiVersion = payload.tag_name
  } catch {
    // The desktop bridge returns the releases HTML instead of GitHub API JSON.
  }
  const versions = [
    ...(apiVersion ? [apiVersion] : []),
    ...[...body.matchAll(/\/rekazer0\/BdiEditor\/releases\/tag\/(v?\d+\.\d+\.\d+(?:-?[0-9A-Za-z.]+)?)(?=["'/?#])/gi)]
      .map((match) => match[1].replace(/^v/i, "")),
  ]
    .map((version) => version.replace(/^v/i, ""))
    .filter((version, index, values) => values.indexOf(version) === index && Boolean(versionParts(version)))
  const latestVersion = versions.sort((left, right) => compareVersions(right, left))[0]
  if (!latestVersion) throw new Error("GitHub Release 数据无效")
  const release = `https://github.com/rekazer0/BdiEditor/releases/tag/v${latestVersion}`
  if (compareVersions(latestVersion, currentVersion) <= 0) {
    return { status: "latest", currentVersion, latestVersion }
  }
  return { status: "available", currentVersion, latestVersion, url: release }
}
