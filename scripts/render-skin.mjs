// 指定皮肤与布局出 PNG：消费 IR 与现有绘制流程（paintLayer / paintKey），不依赖浏览器。
//
//   node --import @oxc-node/core/register scripts/render-skin.mjs \
//     --skin <皮肤包> --layout <板 id> --out <png> [--scale 2] [--theme light] [--orientation port]
//   node --import @oxc-node/core/register scripts/render-skin.mjs --skin <皮肤包> --list
//   node --import @oxc-node/core/register scripts/render-skin.mjs --skin <皮肤包> --debug-summary
//
// 这是渲染层的消费方：几何来自 `containerOf`/`boardRenders`，样式与像素来自模型，
// 组合绘制交给 `paintKey`（与浏览器预览同一条链），只画不改。
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, extname } from "node:path"
import { createCanvas, ImageData as CanvasImageData } from "@napi-rs/canvas"

installCanvasEnvironment()

/**
 * `bitmapOf` 用 `createImageBitmap`、`paintLayer` 的九宫格缓冲用 `document.createElement("canvas")`，
 * 两者都是浏览器契约。Node 里用 @napi-rs/canvas 顶上：画布能被 `drawImage` 接受，形状够用。
 */
function installCanvasEnvironment() {
  globalThis.ImageData ??= CanvasImageData
  globalThis.createImageBitmap ??= async (data) => {
    const canvas = createCanvas(data.width, data.height)
    canvas.getContext("2d").putImageData(data, 0, 0)
    return canvas
  }
  globalThis.document ??= {
    createElement(tag) {
      if (tag !== "canvas") throw new Error(`Node 渲染环境不支持 document.createElement("${tag}")`)
      return createCanvas(1, 1)
    },
  }
}

const { SkinArchive } = await import("../src/skin.ts")
const { openSession } = await import("../src/skin-model/session.ts")
const { boardRenders } = await import("../src/paint/board.ts")
const { containerOf } = await import("../src/skin-model/board.ts")
const { paintKey } = await import("../src/paint/key.ts")
const { bitmapOf } = await import("../src/skin-model/image.ts")
const { styleLayers, colorCss } = await import("../src/skin-model/style.ts")

const USAGE = `用法：
  node --import @oxc-node/core/register scripts/render-skin.mjs --skin <包> --layout <板 id> --out <png> [选项]
  node --import @oxc-node/core/register scripts/render-skin.mjs --skin <包> --list
  node --import @oxc-node/core/register scripts/render-skin.mjs --skin <包> --debug-summary

选项：
  --skin <path>         必填，皮肤包路径（.bds/.bda/.ssf/.sxi）
  --layout <id>         板 id；缺省时列出全部板 id 并要求指定
  --theme <light|dark> 默认 light
  --orientation <port|land> 默认 port
  --base <path>         BDA 的骨架包，默认 public/bda-base.bds
  --skeleton <path>     SSF 的官方骨架包，默认 public/sogou-template.bds
  --out <path>          必填，输出 PNG 路径
  --scale <n>           输出缩放倍数，默认 1
  --list                只列出全部板 id
  --debug-summary       打印每块板的 id/kind/容器/按键数/渲染项数，不出图
  -h, --help            显示本说明`

const FORMAT_HINTS = { ".bds": "bds", ".bda": "bda", ".ssf": "ssf", ".sxi": "sxi" }
const DEFAULT_BASE = "public/bda-base.bds"
const DEFAULT_SKELETON = "public/sogou-template.bds"

// 管道被提前关闭（如 `--list | head`）时安静退出，不抛写栈。
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0)
  throw error
})

try {
  await main()
} catch (error) {
  console.error(`渲染失败：${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  process.exit(1)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(USAGE)
    return
  }
  const archive = openArchive(options.skin, "皮肤包")
  const base = baseArchive(archive, options.base)
  const skeleton = skeletonArchive(archive, options.skeleton)
  const hints = { ...(base ? { base } : {}), ...(skeleton ? { skeleton } : {}) }
  const opened = await openSession(archive, hints)
  if (!opened.ok) fail(`打开皮肤失败（${opened.error.kind}）：${opened.error.message}`, 1)
  const model = opened.model

  if (options.list) {
    for (const board of model.boards) console.log(board.id)
    return
  }
  if (options.debugSummary) {
    await printSummary(model)
    return
  }
  if (!options.layout) {
    console.error(`缺少 --layout。可用板 id（共 ${model.boards.length} 块）：`)
    for (const board of model.boards) console.error(`  ${board.id}`)
    process.exit(2)
  }
  const board = selectBoard(model.boards, options)
  await renderBoard(model, board, options)
}

/** 参数解析：缺值、未知参数、非法枚举都在边界处拒绝。 */
function parseArgs(argv) {
  const options = {
    skin: undefined,
    layout: undefined,
    theme: "light",
    orientation: "port",
    base: undefined,
    skeleton: undefined,
    out: undefined,
    scale: 1,
    list: false,
    debugSummary: false,
    help: false,
  }
  const take = (index, name) => {
    const value = argv[index]
    if (value === undefined || value.startsWith("--")) fail(`参数 ${name} 缺少值`)
    return value
  }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    switch (arg) {
      case "--skin": options.skin = take(++index, arg); break
      case "--layout": options.layout = take(++index, arg); break
      case "--theme": options.theme = take(++index, arg); break
      case "--orientation": options.orientation = take(++index, arg); break
      case "--base": options.base = take(++index, arg); break
      case "--skeleton": options.skeleton = take(++index, arg); break
      case "--out": options.out = take(++index, arg); break
      case "--scale": options.scale = Number(take(++index, arg)); break
      case "--list": options.list = true; break
      case "--debug-summary": options.debugSummary = true; break
      case "-h":
      case "--help": options.help = true; break
      default: fail(`未知参数：${arg}\n\n${USAGE}`)
    }
  }
  if (options.help) return options
  if (!options.skin) fail("缺少必填参数 --skin")
  if (!["light", "dark"].includes(options.theme)) fail(`--theme 只能是 light 或 dark，收到：${options.theme}`)
  if (!["port", "land"].includes(options.orientation)) fail(`--orientation 只能是 port 或 land，收到：${options.orientation}`)
  if (!Number.isFinite(options.scale) || options.scale <= 0) fail(`--scale 必须是正数，收到：${options.scale}`)
  if (!options.list && !options.debugSummary && !options.out) fail("缺少必填参数 --out")
  return options
}

/** 读包并解析；格式按扩展名提示，识别失败交给 `detectFormat`。 */
function openArchive(path, label) {
  if (!existsSync(path)) fail(`找不到${label}：${path}`)
  let bytes
  try {
    bytes = readFileSync(path)
  } catch (error) {
    fail(`读取${label}失败：${path}：${error.message}`)
  }
  try {
    return SkinArchive.open(bytes, FORMAT_HINTS[extname(path).toLowerCase()])
  } catch (error) {
    fail(`解析${label}失败：${path}：${error.message}`)
  }
}

/** BDA 需要骨架包；显式给了就一定要能读，没给且不是 BDA 就不读。 */
function baseArchive(archive, explicitPath) {
  if (!explicitPath && archive.format !== "bda") return undefined
  const path = explicitPath ?? DEFAULT_BASE
  if (!existsSync(path)) {
    if (explicitPath) fail(`找不到 --base 指定的骨架包：${path}`)
    // 不伪造骨架：交给 openSession 报「缺少布局骨架」。
    return undefined
  }
  return openArchive(path, "骨架包")
}

/** SSF 需要官方骨架；显式给了就一定要能读，没给且不是 SSF 就不读。 */
function skeletonArchive(archive, explicitPath) {
  if (!explicitPath && archive.format !== "ssf") return undefined
  const path = explicitPath ?? DEFAULT_SKELETON
  if (!existsSync(path)) {
    if (explicitPath) fail(`找不到 --skeleton 指定的骨架包：${path}`)
    return undefined
  }
  return openArchive(path, "骨架包")
}

/** 全部板的数据摘要：容器未知与渲染项为 0 都要如实写出来。 */
async function printSummary(model) {
  let unknown = 0
  for (const board of model.boards) {
    const container = containerOf(board)
    if (!container) unknown++
    const renders = await boardRenders(board)
    const size = container ? `${container.width}x${container.height}` : "unknown"
    console.log([
      board.id,
      board.kind,
      `${board.theme}/${board.orientation}`,
      `container=${size}`,
      `keys=${board.keys.length}`,
      `renders=${renders.length}`,
    ].join("\t"))
  }
  console.error(`共 ${model.boards.length} 块板，其中容器未知 ${unknown} 块`)
}

/** 先按完整 id 找；找不到再按路径后缀匹配，并用 --theme/--orientation 收窄。 */
function selectBoard(boards, options) {
  const id = options.layout
  const exact = boards.find((board) => board.id === id)
  if (exact) return exact
  const suffix = boards.filter((board) => board.id.endsWith(`/${id}`) || board.id.endsWith(`:${id}`))
  const variant = suffix.filter((board) => board.theme === options.theme && board.orientation === options.orientation)
  if (variant.length === 1) return variant[0]
  if (suffix.length === 1) return suffix[0]
  const candidates = variant.length > 1 ? variant : suffix
  console.error(`找不到板「${id}」。可用板 id：`)
  for (const board of boards) console.error(`  ${board.id}`)
  if (candidates.length > 1) {
    console.error(`提示：以下板都能匹配，请写完整 id：\n  ${candidates.map((board) => board.id).join("\n  ")}`)
  }
  process.exit(1)
}

async function renderBoard(model, board, options) {
  const container = containerOf(board)
  if (!container) {
    fail(`板「${board.id}」没有容器尺寸（container=unknown），没有几何可画；不用 0 或默认值凑一张图。`, 2)
  }
  if (!(container.width > 0) || !(container.height > 0)) {
    fail(`板「${board.id}」的容器尺寸无效：${container.width}x${container.height}`, 2)
  }
  const items = await boardRenders(board)
  // 与预览一致：铺满整板的项在底，其余按渲染投影给的顺序叠放。
  const ordered = items
    .filter((item) => item.visible !== false)
    .sort((left, right) => layerRank(left, container) - layerRank(right, container))

  const width = Math.max(1, Math.round(container.width * options.scale))
  const height = Math.max(1, Math.round(container.height * options.scale))
  const canvas = createCanvas(width, height)
  const context = canvas.getContext("2d")
  if (options.scale !== 1) context.scale(options.scale, options.scale)

  const missing = new Set()
  const visuals = new Map()
  for (const item of ordered) {
    visuals.set(item.section, await assembleVisuals(model, board, item, missing))
  }
  const animation = { bdaBack: {}, bdaFore: {}, transformOf: () => ({}) }
  const env = {
    context,
    theme: options.theme,
    panelStyle: "",
    panelWidth: container.width,
    panelHeight: container.height,
    visuals,
    sceneKeys: new Map(),
    pressed: () => false,
    sprites: [],
    strokeSelection: () => {},
  }
  for (const item of ordered) {
    warnOverflow(item, container)
    paintKey(env, item, animation)
  }
  for (const message of missing) console.error(`警告：${message}`)
  if (!ordered.length) console.error(`警告：板「${board.id}」没有可见渲染项，输出是空白画布`)

  mkdirSync(dirname(options.out), { recursive: true })
  writeFileSync(options.out, await encodePng(canvas))
  console.log(`板：${board.id}（${board.kind}，${board.theme}/${board.orientation}）`)
  console.log(`容器：${container.width}x${container.height}，缩放 ${options.scale}，画布 ${width}x${height}px`)
  console.log(`渲染项：${ordered.length}/${items.length}`)
  console.log(`输出：${options.out}（${statSync(options.out).size} 字节）`)
}

/** 铺满整板的项先画；与预览的层级规则一致。 */
function layerRank(item, container) {
  const rect = item.rect
  const full = rect.x <= 0 && rect.y <= 0
    && rect.x + rect.width >= container.width
    && rect.y + rect.height >= container.height
  return full ? 0 : 1
}

/** 超出容器不裁掉也不静默：逐项报到 stderr，画布尺寸仍按容器。 */
function warnOverflow(item, container) {
  const rect = item.rect
  const sides = [
    ["左", Math.max(0, -rect.x)],
    ["上", Math.max(0, -rect.y)],
    ["右", Math.max(0, rect.x + rect.width - container.width)],
    ["下", Math.max(0, rect.y + rect.height - container.height)],
  ]
  const parts = sides
    .filter(([, value]) => value > 0.5)
    .map(([side, value]) => `${side} +${Math.round(value)}px`)
  if (!parts.length) return
  console.error(
    `警告：渲染项 ${item.section}（${Math.round(rect.x)},${Math.round(rect.y)},`
    + `${Math.round(rect.width)}x${Math.round(rect.height)}）超出容器 `
    + `${container.width}x${container.height}：${parts.join("，")}`,
  )
}

/**
 * 一个渲染项的视觉数据：与预览的装配语义一致。
 *
 * 背景与每个前景样式只取第一个 image，没有 image 再取第一个 color（`paintOf` 语义）；
 * 前景样式里的文本层另外给 `styleTexts`，按键自己的文字样式由前景样式的文本层合并而来。
 */
async function assembleVisuals(model, board, item, missing) {
  const back = await paintOf(model, item.backStyle ?? "", missing)
  const foreLayers = await Promise.all(item.foreStyles.map((styleID) => paintOf(model, styleID, missing)))
  const fore = await Promise.all(item.foreStyles.map((styleID) => visualOf(model, styleID, missing)))
  const listCell = item.key?.kind === "list-cell"
  const styleTexts = listCell
    ? []
    : item.foreStyles.map((styleID) => styleTextOf(model, styleID))
  const text = textOf(model, board, item, listCell)
  return {
    ...(back ? { backLayer: back } : {}),
    foreLayers,
    fore,
    styleTexts,
    ...(text ? { text } : {}),
  }
}

/** 第一个 image 层（带位图）；没有 image 时取第一个 color 层。与预览的 `layerPaint` 同义。 */
async function paintOf(model, styleID, missing) {
  if (!styleID) return undefined
  const layers = layersOf(model, styleID, missing)
  const image = layers.find((layer) => layer.kind === "image")
  if (image) {
    const source = model.images.get(image.image)
    if (!source) {
      missing.add(`图片 ${image.image} 不在模型里`)
      return { layer: image }
    }
    const bitmap = await bitmapOf(source)
    if (!bitmap) missing.add(`图片 ${image.image} 无法转成位图`)
    return { layer: image, ...(bitmap ? { bitmap } : {}) }
  }
  const color = layers.find((layer) => layer.kind === "color")
  return color ? { layer: color } : undefined
}

/** 前景的通用视觉：图片带源矩形，文本带自己的样式，颜色给出 CSS。 */
async function visualOf(model, styleID, missing) {
  const layers = layersOf(model, styleID, missing)
  const image = layers.find((layer) => layer.kind === "image")
  if (image) {
    const source = model.images.get(image.image)
    const bitmap = source ? await bitmapOf(source) : undefined
    return bitmap ? { image: bitmap, source: [0, 0, bitmap.width, bitmap.height] } : undefined
  }
  const text = layers.find((layer) => layer.kind === "text")
  if (text) return { text: { text: text.text ?? "", ...textVisual(text.style) } }
  const color = layers.find((layer) => layer.kind === "color")
  return color ? { color: colorCss(color.value) } : undefined
}

/** 样式里的文字层自带字符时才画；没有字符的文本层只是按键文字的样式来源。 */
function styleTextOf(model, styleID) {
  const text = layersOf(model, styleID, new Set()).find((layer) => layer.kind === "text")
  if (!text || text.text === undefined) return undefined
  return { text: text.text, ...textVisual(text.style) }
}

/** 按键文字样式：多个前景样式按逗号合并，先到先得；列表格乘板上的字体倍率。 */
function textOf(model, board, item, listCell) {
  const style = {}
  const tokens = item.foreStyles
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean)
  for (const token of tokens) {
    const text = layersOf(model, token, new Set()).find((layer) => layer.kind === "text")
    if (!text) continue
    if (style.font === undefined && text.style.font !== undefined) style.font = text.style.font
    if (style.fontSize === undefined && text.style.fontSize !== undefined) style.fontSize = text.style.fontSize
    if (style.weight === undefined && text.style.weight !== undefined) style.weight = text.style.weight
    if (style.color === undefined && text.style.color !== undefined) style.color = text.style.color
    if (style.shadow === undefined && text.style.shadow !== undefined) style.shadow = text.style.shadow
  }
  if (!Object.keys(style).length) return undefined
  const visual = textVisual(style)
  const fontScale = listCell ? board.panels?.list?.content?.fontScale ?? 1 : 1
  if (fontScale !== 1 && visual.fontSize !== undefined) visual.fontSize *= fontScale
  return visual
}

function textVisual(style) {
  return {
    ...(style.font ? { fontName: style.font } : {}),
    ...(style.fontSize !== undefined ? { fontSize: style.fontSize } : {}),
    ...(style.weight !== undefined ? { weight: style.weight } : {}),
    ...(style.color ? { color: colorCss(style.color) } : {}),
    ...(style.shadow ? { shadowColor: colorCss(style.shadow.color), shadowSize: style.shadow.size } : {}),
  }
}

function layersOf(model, styleID, missing) {
  if (!model.styles.has(styleID)) {
    missing.add(`样式 ${styleID} 不在模型里`)
    return []
  }
  return styleLayers(model, styleID, false)
}

async function encodePng(canvas) {
  if (typeof canvas.encode === "function") return canvas.encode("png")
  return canvas.toBuffer("image/png")
}

function fail(message, code = 2) {
  console.error(message)
  process.exit(code)
}
