// 指定皮肤与布局出 PNG：消费 IR 与公共面板渲染核心，不依赖浏览器。
//
//   node --import @oxc-node/core/register scripts/render-skin.mjs \
//     --skin <皮肤包> --layout <板 id> --out <png> [--scale 2] [--theme light] [--state idle] [--press KEY1]
//   node --import @oxc-node/core/register scripts/render-skin.mjs --skin <皮肤包> --list
//   node --import @oxc-node/core/register scripts/render-skin.mjs --skin <皮肤包> --debug-summary
//
// 这是渲染核心的消费方：取数与装配全部交给 `buildPanelFrame`，绘制交给 `paintPanel`，
// 命中交给 `hitTest`；这里不再自己拼装样式。
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
const { buildPanelFrame, paintPanel, hitTest } = await import("../src/paint/panel.ts")
const { actionText } = await import("../src/skin-model/inspect.ts")
const { gestureDirection } = await import("../src/layout.ts")

const USAGE = `用法：
  node --import @oxc-node/core/register scripts/render-skin.mjs --skin <包> --layout <板 id> --out <png> [选项]
  node --import @oxc-node/core/register scripts/render-skin.mjs --skin <包> --list
  node --import @oxc-node/core/register scripts/render-skin.mjs --skin <包> --debug-summary

选项：
  --skin <path>         必填，皮肤包路径（.bds/.bda/.ssf/.sxi）
  --layout <id>         板 id；缺省时列出全部板 id 并要求指定
  --theme <light|dark> 默认 light
  --orientation <port|land> 默认 port；只用于收窄板 id
  --state <idle|composing> 默认 idle：顶栏画工具栏；composing 画候选栏
  --press <KEY1,KEY3>   只按指定段；缺省整板静止
  --click <x,y>         输出命中结果（section、key.kind、各动作文本），坐标是板坐标
  --swipe <x1,y1,x2,y2> 起点命中后按方向取 swipe 动作
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
    state: "idle",
    press: undefined,
    click: undefined,
    swipe: undefined,
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
      case "--state": options.state = take(++index, arg); break
      case "--press": options.press = take(++index, arg); break
      case "--click": options.click = take(++index, arg); break
      case "--swipe": options.swipe = take(++index, arg); break
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
  if (!["idle", "composing"].includes(options.state)) fail(`--state 只能是 idle 或 composing，收到：${options.state}`)
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

/** `--press KEY1,KEY3`：只按指定段；空白项与重复项丢掉。 */
function pressedSections(value) {
  const sections = (value ?? "")
    .split(",")
    .map((section) => section.trim())
    .filter(Boolean)
  return new Set(sections)
}

/** 一个动作的文本；没建模的动作返回 undefined，由调用方如实写出来。 */
function actionOf(key, name) {
  return actionText(key.actions?.[name]) ?? "未建模"
}

async function renderBoard(model, board, options) {
  const pressed = pressedSections(options.press)
  const composing = options.state === "composing"
  const panelOptions = {
    theme: options.theme,
    composing,
    pixelScale: options.scale,
    pressed,
    state: undefined,
  }
  const frame = await buildPanelFrame(model, board, panelOptions)
  const missing = [...pressed].filter((section) => !frame.items.some((item) => item.sections.includes(section)))
  if (missing.length) console.error(`警告：--press 的段不在板上：${missing.join(", ")}`)

  const width = Math.max(1, Math.round(frame.container.width * frame.pixelScale))
  const height = Math.max(1, Math.round(frame.container.height * frame.pixelScale))
  const canvas = createCanvas(width, height)
  const context = canvas.getContext("2d")
  if (frame.pixelScale !== 1) context.scale(frame.pixelScale, frame.pixelScale)
  paintPanel(context, frame, panelOptions)

  if (options.click) reportClick(frame, options.click)
  if (options.swipe) reportSwipe(frame, options.swipe)

  for (const item of frame.items) warnOverflow(item, frame.board)
  if (!frame.items.length) console.error(`警告：板「${board.id}」没有可见渲染项，输出是空白画布`)

  mkdirSync(dirname(options.out), { recursive: true })
  writeFileSync(options.out, await encodePng(canvas))
  console.log(`板：${board.id}（${board.kind}，${board.theme}/${board.orientation}）`)
  const headerName = frame.header?.candidates.length ? "候选栏" : "工具栏"
  console.log(`顶栏：${frame.header ? `${frame.header.rect.height}px（${headerName}）` : "无"}`)
  console.log(`容器：${frame.container.width}x${frame.container.height}，板偏移 y=${frame.board.y}，缩放 ${frame.pixelScale}，画布 ${width}x${height}px`)
  console.log(`渲染项：${frame.items.length}`)
  console.log(`输出：${options.out}（${statSync(options.out).size} 字节）`)
}

/** 命中结果：段、按键种类与每个动作的文本。 */
function reportClick(frame, value) {
  const [x, y] = numbers(value, 2, "--click")
  const item = hitTest(frame, { x, y })
  if (!item) {
    console.log(`命中：无（${x},${y} 不在任何可见渲染项里）`)
    return
  }
  console.log(`命中：${item.section}（${item.key.kind ?? "kind 未建模"}）rect=${rectText(item.rect)}`)
  console.log(`动作：${actionList(item.key)}`)
}

/** 起点命中后按方向取 `swipe-*` 动作；没有位移就是 `press`。 */
function reportSwipe(frame, value) {
  const [x1, y1, x2, y2] = numbers(value, 4, "--swipe")
  const item = hitTest(frame, { x: x1, y: y1 })
  if (!item) {
    console.log(`滑动：起点（${x1},${y1}）没有命中任何可见渲染项`)
    return
  }
  const direction = gestureDirection(x2 - x1, y2 - y1, 0, false)
  const name = direction === "center" ? "press" : `swipe-${direction}`
  console.log(`滑动：起点命中 ${item.section}，方向 ${direction.toUpperCase()}`)
  console.log(`动作：${name}=${actionOf(item.key, name)}`)
}

function actionList(key) {
  const actions = key.actions ?? {}
  const names = Object.keys(actions)
  if (!names.length) return "未建模"
  return names.map((name) => `${name}=${actionOf(key, name)}`).join(" / ")
}

function rectText(rect) {
  return `${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}x${Math.round(rect.height)}`
}

function numbers(value, count, name) {
  const parts = value.split(",").map((part) => Number(part.trim()))
  if (parts.length !== count || parts.some((part) => !Number.isFinite(part))) {
    fail(`${name} 需要 ${count} 个数字，收到：${value}`)
  }
  return parts
}

/** 超出板容器不裁掉也不静默：逐项报到 stderr，画布尺寸仍按完整面板。 */
function warnOverflow(item, board) {
  const rect = item.rect
  const sides = [
    ["左", Math.max(0, -rect.x)],
    ["上", Math.max(0, -rect.y)],
    ["右", Math.max(0, rect.x + rect.width - board.width)],
    ["下", Math.max(0, rect.y + rect.height - board.height)],
  ]
  const parts = sides
    .filter(([, value]) => value > 0.5)
    .map(([side, value]) => `${side} +${Math.round(value)}px`)
  if (!parts.length) return
  console.error(
    `警告：渲染项 ${item.section}（${rectText(rect)}）超出板容器 `
    + `${board.width}x${board.height}：${parts.join("，")}`,
  )
}

async function encodePng(canvas) {
  if (typeof canvas.encode === "function") return canvas.encode("png")
  return canvas.toBuffer("image/png")
}

function fail(message, code = 2) {
  console.error(message)
  process.exit(code)
}
