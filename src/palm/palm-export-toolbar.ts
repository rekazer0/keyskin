import { writeIosToolbarMenu } from "../ios-toolbar.ts"
import { decodePng, encodePng, placeImage, resizeImage } from "../ssf/ssf-png.ts"
import { numbers } from "./palm-board.ts"
import { asObject, type JsonObject } from "./sxi-ini.ts"
import { candidateDimensions } from "./palm-export-layout.ts"

type Resource = { path: string; bytes?: Uint8Array; directory: boolean }

/** Palm needs a menu and all three device filenames before its resource lists are built. */
export function prepareToolbarIcons(entries: Resource[]): void {
  const files = new Map(entries.flatMap((entry) => entry.bytes ? [[entry.path, entry.bytes] as const] : []))
  for (const path of [...files.keys()]) {
    if (!path.endsWith("res/logo/pop_menu_icons.til")) continue
    const root = path.slice(0, -"res/logo/pop_menu_icons.til".length)
    if ([...files.keys()].some((name) => name.startsWith(`${root}res/logo/`) && name.includes("toolbarMenuItems"))) continue
    writeIosToolbarMenu(files, root)
  }
  for (const [path, bytes] of [...files]) {
    if (!/\/res\/logo\/.+_iphone@3x\.png$/.test(path)) continue
    for (const suffix of ["_ipad", "_ipad@2x"]) {
      const variant = path.replace(/_iphone@3x\.png$/, `${suffix}.png`)
      if (!files.has(variant)) files.set(variant, bytes)
    }
  }
  const existing = new Set(entries.map((entry) => entry.path))
  for (const [path, bytes] of files) {
    if (!existing.has(path)) entries.push({ path, bytes, directory: path.endsWith("/") })
  }
}

/** Android ignores F14's height and draws each menu bitmap at its own size. */
export function fitToolbarArtwork(theme: JsonObject, entries: Resource[]): void {
  const heights = ["port", "land"].map((orientation) => {
    const layout = asObject(theme[`${orientation}_layout`])
    const candidates = asObject(layout?.c) ?? {}
    return Object.entries(candidates).flatMap(([name, value]) => {
      const candidate = asObject(value)
      const dimensions = candidate && candidateDimensions(asObject(layout?.b) ?? {}, candidate, name)
      const icons = candidate?.icon_list
      if (!Array.isArray(icons)) return []
      return icons.flatMap((value) => {
        const icon = asObject(value)
        if (dimensions && icon) {
          const [x, y] = numbers(icon.p) ?? [0, 0]
          const [w, h] = numbers(icon.s) ?? [0, 0]
          const anchor = typeof icon.anchor === "number" ? icon.anchor : 1
          const left = (anchor - 1) % 3 * dimensions.width / 2 + x
          const top = (Math.ceil(anchor / 3) - 1) * dimensions.height / 2 + y
          if (left + w <= 0 || left >= dimensions.width || top + h <= 0 || top >= dimensions.height) return []
        }
        const height = icon?.k === "switchContainer" ? numbers(icon.s)?.[1] : undefined
        return typeof height === "number" && Number.isFinite(height) && height > 0 ? [height] : []
      })
    })
  }).find((heights) => heights.length) ?? []
  // Palm's native icon canvas is 88px; a smaller authored F14 must also shrink the bitmap itself.
  const size = Math.max(1, Math.floor(Math.min(88, ...heights)))
  const resources = new Set(Array.isArray(theme.r_logo) ? theme.r_logo : [])
  for (const entry of entries) {
    if (!entry.bytes || !resources.has(`/${entry.path}`) || !/_(?:iphone@3x|ipad(?:@2x)?)\.png$/.test(entry.path)) continue
    const image = decodePng(entry.bytes)
    const scale = size / Math.max(image.width, image.height)
    const width = Math.max(1, Math.round(image.width * scale))
    const height = Math.max(1, Math.round(image.height * scale))
    entry.bytes = encodePng(placeImage(resizeImage(image, width, height), size, size,
      Math.floor((size - width) / 2), Math.floor((size - height) / 2)))
  }
}
