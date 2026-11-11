// Android NinePatchDrawable keeps atlas borders in device pixels; bake them at the layout's scale.
import { decodePng, encodePng, MAX_PIXELS, nineSliceImage, type RgbaImage } from "../ssf/ssf-png.ts"
import { fingerprint } from "../ssf/ssf-cache.ts"
import { numbers } from "./palm-board.ts"
import { candidateDimensions } from "./palm-export-layout.ts"
import { asObject, rectParts, type Json, type JsonObject } from "./sxi-ini.ts"

type Resource = { path: string; bytes?: Uint8Array; directory: boolean }

/** 像素完全相同的成品只写一份；同一个主题里样式、图集和资源声明共用第一次写出的文件。 */
type Baked = { name: string; image: RgbaImage }

function samePixels(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return false
  return true
}

/** `replace()` 的调用次数：进度按处理过的背景报告，和真实的工作量同步。 */
function bakeStepCount(theme: JsonObject): number {
  let steps = 0
  for (const orientation of ["port", "land"]) {
    const layout = asObject(theme[`${orientation}_layout`])
    const boards = asObject(layout?.b) ?? {}
    for (const value of Object.values(boards)) {
      const board = asObject(value)
      if (!board || !Array.isArray(board.keys)) continue
      const fixes = asObject(board.key_fix) ?? {}
      for (const entry of board.keys) {
        const key = asObject(entry)
        if (!key || !rectParts(key.rect)) continue
        steps += 1
        const tips = numbers(key.fix_a)
        for (let at = 1; tips !== undefined && at < tips.length; at += 2) {
          if (asObject(asObject(fixes[String(tips[at])])?.b)?.base_b !== undefined) steps += 1
        }
      }
    }
    for (const [name, value] of Object.entries(asObject(layout?.c) ?? {})) {
      const candidate = asObject(value)
      if (candidate && candidateDimensions(boards, candidate, name)) steps += 1
    }
  }
  return Math.max(1, steps)
}

/**
 * Retain key geometry, shadows and gestures; only replace stretchable background artwork.
 * 每处理一个背景让出一次，产出 0–1 的完成比例，供异步导出驱动。
 * `resFolder` 是主题共享的 `res` 目录：同主题里相同的成品只在其中写一份。
 */
export function* bakeBackgroundsSteps(theme: JsonObject, entries: Resource[], resFolder: string): Generator<number> {
  const shared = asObject(theme.s_info)
  const sharedStyles = asObject(shared?.ss_1)
  const sharedTiles = asObject(shared?.info)
  if (!shared || !sharedStyles || !sharedTiles) return
  let next = Math.max(0, ...[shared, asObject(theme.s_port), asObject(theme.s_land)].flatMap((set) =>
    Object.keys(asObject(set?.ss_1) ?? {}).map(Number).filter(Number.isFinite))) + 1
  const variants = new Map<string, Json>()
  const decoded = new Map<string, RgbaImage>()
  const baked = new Map<string, Baked>()
  const names = new Set(entries.map(({ path }) => path.slice(path.lastIndexOf("/") + 1)))
  // Looked up once per key state; scanning the whole entry list each time is quadratic on large skins.
  const byPath = new Map(entries.map((entry) => [entry.path, entry]))
  const bakedStyles: JsonObject = {}, bakedTiles: JsonObject = {}
  const bakedResources: string[] = []
  const total = bakeStepCount(theme)
  let done = 0
  for (const orientation of ["port", "land"]) {
    const layout = asObject(theme[`${orientation}_layout`])
    const own = asObject(theme[`s_${orientation}`])
    const styles = { ...sharedStyles, ...asObject(own?.ss_1) }
    const tiles = { ...sharedTiles, ...asObject(own?.info) }
    const imagePaths = new Map<string, string>()
    for (const path of [...(Array.isArray(theme[`r_${orientation}`]) ? theme[`r_${orientation}`] as Json[] : []),
      ...(Array.isArray(theme.r_info) ? theme.r_info : [])]) {
      const name = typeof path === "string" ? /\/([^/]+)\.png$/.exec(path)?.[1] : undefined
      if (name && !imagePaths.has(name)) imagePaths.set(name, path as string)
    }
    const replace = function* (base: JsonObject | undefined, width: number, height: number): Generator<number> {
      done += 1
      yield Math.min(0.999, done / total)
      if (!base || !Number.isFinite(width + height) || width <= 0 || height <= 0 || width * height > MAX_PIXELS) return
      const style = asObject(styles[String(base.base_b)])
      const images = asObject(style?.s_2)
      if (!style || !images) return
      const { id: _id, ...appearance } = style
      const key = `${JSON.stringify(appearance)}:${width}:${height}`
      if (variants.has(key)) { base.base_b = variants.get(key); return }
      const copy = structuredClone(style)
      const outputImages = asObject(copy.s_2)!
      let changed = false
      for (const state of ["normal", "hl"]) {
        const reference = images[state]
        if (typeof reference !== "string") continue
        const [name, index] = reference.split(",").map((part) => part.trim())
        const table = tiles[name]
        const tile = Array.isArray(table) ? table.map(asObject).find((tile) => tile?.id === `IMG${index}`) : undefined
        const source = rectParts(tile?.rect1)
        const inner = rectParts(tile?.rect2)
        if (!source || !inner || inner[2] <= 0 || inner[3] <= 0) continue
        if (![...source, ...inner].every(Number.isInteger) || inner[0] < source[0] || inner[1] < source[1]
          || inner[0] + inner[2] > source[0] + source[2] || inner[1] + inner[3] > source[1] + source[3]) continue
        const entry = byPath.get(imagePaths.get(name) ?? "")
        if (!entry?.bytes) continue
        let image = decoded.get(entry.path)
        if (!image) { image = decodePng(entry.bytes); decoded.set(entry.path, image) }
        if (source[0] < 0 || source[1] < 0 || source[2] <= 0 || source[3] <= 0
          || source[0] + source[2] > image.width || source[1] + source[3] > image.height) continue
        const output = nineSliceImage(image, source, inner, width, height)
        // 哈希先筛，像素再比一次：成品按内容去重，不同主题之间不互相复用。
        const hash = `${output.width}x${output.height}:${fingerprint(output.data)}`
        const cached = baked.get(hash)
        if (cached && samePixels(cached.image.data, output.data)) {
          outputImages[state] = `${cached.name},1`
          changed = true
          continue
        }
        let basename = `keyskin_back_${next}_${state}`
        while (names.has(`${basename}.png`)) basename = `_${basename}`
        names.add(`${basename}.png`)
        const outputPath = resFolder ? `${resFolder}/${basename}.png` : `${basename}.png`
        entries.push({ path: outputPath, bytes: encodePng(output), directory: false })
        baked.set(hash, { name: basename, image: output })
        bakedResources.push(outputPath)
        const globalResources = Array.isArray(theme.r_info) ? theme.r_info : []
        globalResources.push(outputPath)
        theme.r_info = globalResources
        // No rect2: both Palm clients scale the completed artwork with the key's rectangle.
        bakedTiles[basename] = sharedTiles[basename] = [{ ...tile, id: "IMG1", rect1: [[0, 0], [width, height]], rect2: undefined }]
        outputImages[state] = `${basename},1`
        changed = true
      }
      if (changed) {
        copy.id = `STYLE${next}`
        bakedStyles[String(next)] = sharedStyles[String(next)] = copy
        variants.set(key, next)
        base.base_b = next++
      }
    }
    const boards = asObject(layout?.b) ?? {}
    for (const value of Object.values(boards)) {
      const board = asObject(value)
      if (!board || !Array.isArray(board.keys)) continue
      const fixes = asObject(board.key_fix) ?? {}
      let nextFix = Math.max(0, ...Object.keys(fixes).map(Number).filter(Number.isFinite)) + 1
      for (const value of board.keys) {
        const key = asObject(value)
        const rect = rectParts(key?.rect)
        if (!key || !rect) continue
        const width = Math.round(rect[2]), height = Math.round(rect[3])
        yield* replace(asObject(key.b), width, height)
        const tips = numbers(key.fix_a)
        if (!tips) continue
        for (let at = 1; at < tips.length; at += 2) {
          const fix = asObject(fixes[String(tips[at])])
          if (asObject(fix?.b)?.base_b === undefined) continue
          const copy = structuredClone(fix!)
          yield* replace(asObject(copy.b), width, height)
          if (asObject(copy.b)?.base_b === asObject(fix?.b)?.base_b) continue
          fixes[String(nextFix)] = copy
          tips[at] = nextFix++
        }
      }
    }
    for (const [name, value] of Object.entries(asObject(layout?.c) ?? {})) {
      const candidate = asObject(value)
      if (!candidate) continue
      const size = candidateDimensions(boards, candidate, name)
      if (size) yield* replace(asObject(candidate.b), Math.round(size.width), Math.round(size.height))
    }
  }
  // Android reads the shared tables; iOS also needs the complete orientation tables and resource lists.
  for (const orientation of ["port", "land"]) {
    const own = asObject(theme[`s_${orientation}`])
    if (!own) continue
    own.ss_1 = { ...asObject(own.ss_1), ...bakedStyles }
    own.info = { ...asObject(own.info), ...bakedTiles }
    theme[`r_${orientation}`] = [...new Set([
      ...(Array.isArray(theme[`r_${orientation}`]) ? theme[`r_${orientation}`] as Json[] : []),
      ...bakedResources,
    ])]
  }
}

/** 同步导出用：一次性把烘焙步骤跑完。 */
export function bakeBackgrounds(theme: JsonObject, entries: Resource[], resFolder: string): void {
  const steps = bakeBackgroundsSteps(theme, entries, resFolder)
  while (!steps.next().done) {
    // 同步导出不需要让出主线程，直接跑完。
  }
}
