// Palm Android looks up styles globally and images by basename, even for orientation overrides.
import { palmStyleReference } from "./palm-labels.ts"
import { asObject, type Json, type JsonObject } from "./sxi-ini.ts"

type Resource = { path: string; bytes?: Uint8Array; directory: boolean }

export function separateOrientationResources(skin: JsonObject, entries: Resource[]): void {
  const shared = structuredClone(asObject(skin.s_info) ?? {})
  skin.s_info = shared
  const styles = asObject(shared.ss_1) ?? {}
  const tiles = asObject(shared.info) ?? {}
  const originalStyles = { ...styles }
  const namesInUse = new Set(entries.map(({ path }) => path.slice(path.lastIndexOf("/") + 1)))
  let nextStyle = Math.max(0, ...[shared, asObject(skin.s_port), asObject(skin.s_land)].flatMap((set) => Object.keys(asObject(set?.ss_1) ?? {}).map(Number).filter(Number.isFinite))) + 1
  for (const orientation of ["port", "land"]) {
    const own = asObject(skin[`s_${orientation}`])
    if (!own) continue
    const resources = Array.isArray(skin[`r_${orientation}`]) ? skin[`r_${orientation}`] as Json[] : []
    const names = new Map<string, string>()
    const extra: string[] = []
    for (const value of resources) {
      if (typeof value !== "string" || !value.includes(`/${orientation}/res/`) || !/\.png$/i.test(value)) continue
      const name = value.slice(value.lastIndexOf("/") + 1, -4)
      let unique = `${orientation}_${name}`
      while (namesInUse.has(`${unique}.png`)) unique = `_${unique}`
      const renamed = value.replace(/[^/]+$/, `${unique}.png`)
      const source = entries.find(({ path }) => path === value)
      if (!source) continue
      names.set(name, unique)
      entries.push({ ...source, path: renamed })
      namesInUse.add(`${unique}.png`)
      extra.push(renamed)
      const ownTiles = asObject(own.info) ?? {}
      const map = ownTiles[name]
      if (map !== undefined) tiles[unique] = map
      delete ownTiles[name]
      resources[resources.indexOf(value)] = renamed
    }
    const effective = { ...originalStyles, ...asObject(own.ss_1) }
    const remap = new Map<string, number>()
    const renamedStyles: JsonObject = {}
    for (const [id, value] of Object.entries(effective)) {
      const style = asObject(value)
      if (!style) continue
      const image = asObject(style.s_2)
      const hasImage = [image?.normal, image?.hl].some((ref) => typeof ref === "string" && names.has(ref.split(",")[0].trim()))
      if (!hasImage) continue
      const next = nextStyle++
      remap.set(id, next)
      const copy = structuredClone(style)
      copy.id = `STYLE${next}`
      const images = asObject(copy.s_2)
      for (const state of ["normal", "hl"]) {
        const ref = images?.[state]
        if (typeof ref !== "string") continue
        const [name, tile] = ref.split(",").map((part) => part.trim())
        if (names.has(name)) images![state] = `${names.get(name)},${tile}`
      }
      renamedStyles[String(next)] = copy
    }
    remapLayout(skin[`${orientation}_layout`], remap)
    Object.assign(styles, renamedStyles)
    Object.assign(asObject(own.ss_1) ?? {}, renamedStyles)
    const globalResources = Array.isArray(skin.r_info) ? skin.r_info as Json[] : []
    globalResources.push(...extra)
    skin.r_info = globalResources
  }
  shared.ss_1 = styles
  shared.info = tiles
}

function remapLayout(value: Json, ids: Map<string, number>): void {
  if (Array.isArray(value)) {
    for (const child of value) remapLayout(child, ids)
    return
  }
  const object = asObject(value)
  if (!object) return
  for (const [key, child] of Object.entries(object)) {
    if (palmStyleReference(key) || key === "a" && "r" in object) {
      const replace = (id: Json) => ids.get(String(id)) ?? id
      object[key] = Array.isArray(child) ? child.map(replace) : replace(child)
    } else remapLayout(child, ids)
  }
}
