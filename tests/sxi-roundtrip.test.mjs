// 手心皮肤往返：读 → 写 → 再读，两次 IR 一致；写回的 skin.json 结构对照。
//
// 判据是「两次读出的 IR 结构一致」：布局比矩形（由 taffy 算出）、样式比图层、图片比像素摘要、
// 音效比主体与变体。写回的 skin.json 只做结构对照（键集合、按键矩形与动作），
// 不要求逐字节像原包——图片扩展名在写回时统一成 `.png`，比较前两边都归一。
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { unzipSync } from "fflate"
import { SkinArchive } from "../src/skin.ts"
import { containerOf } from "../src/skin-model/board.ts"
import { computeLayout } from "../src/skin-model/layout.ts"
import { openSkin } from "../src/skin-model/formats/index.ts"
import { sxiFormat, sxiSource } from "../src/skin-model/formats/sxi/index.ts"
import { readWith, writeWith } from "./support/driver.mjs"

const SAMPLES = [
  "public/res/Skin(4).sxi",
  "public/res/Write26-C-rect-no-t.sxi",
  "public/res/拒绝摆烂-乱17.sxi",
  "public/res/白橙 智能深色 Amk v211229.sxi",
  "public/res/超快乐A(2).sxi",
]

function archiveOf(path) {
  return SkinArchive.open(new Uint8Array(readFileSync(new URL(`../${path}`, import.meta.url))), "sxi")
}

/** 每块板由布局树算出的矩形；几何是 IR 的一部分，单独比较。 */
async function rectsOf(model) {
  const result = {}
  for (const board of model.boards) {
    const size = containerOf(board)
    if (!size) continue
    const rects = await computeLayout(board.layout, size)
    result[board.id] = Object.fromEntries([...rects].map(([id, box]) => [id, [
      box.position.x, box.position.y, box.size.width, box.size.height,
    ]]))
  }
  return result
}

/** 几何比较允许 1px 容差：taffy 计算会对绝对节点的像素取整（项目 derive 容差也是 1）。 */
function firstCloseDifference(left, right, path = "") {
  if (typeof left === "number" && typeof right === "number") {
    return Math.abs(left - right) <= 1 ? undefined : `${path}: ${left} ≠ ${right}`
  }
  if (Object.is(left, right)) return
  if (typeof left !== typeof right) return `${path}: 类型不同 ${typeof left} vs ${typeof right}`
  if (left && right && typeof left === "object") {
    const leftKeys = Array.isArray(left) ? left.map((_, index) => String(index)) : Object.keys(left)
    const rightKeys = Array.isArray(right) ? right.map((_, index) => String(index)) : Object.keys(right)
    for (const key of leftKeys) {
      const difference = firstCloseDifference(left[key], right[key], `${path}/${key}`)
      if (difference) return difference
    }
    for (const key of rightKeys) if (!(key in left)) return `${path}/${key}: 只在回读里有`
    return
  }
  return `${path}: ${JSON.stringify(left)} ≠ ${JSON.stringify(right)}`
}

/** 每个样本只读两次（首读与回读）；后面的用例复用结果，避免重复解码上千张图。 */
const ROUNDTRIP = new Map()

async function roundtrip(path) {
  const cached = ROUNDTRIP.get(path)
  if (cached) return cached
  const archive = archiveOf(path)
  const first = await readWith(sxiFormat, sxiFormat.open(archive))
  const written = await writeWith(sxiFormat, first)
  const second = await readWith(sxiFormat, sxiSource(new Map(written.files)))
  const result = { first, second, written, firstRects: await rectsOf(first), secondRects: await rectsOf(second) }
  ROUNDTRIP.set(path, result)
  return result
}

/** 图片扩展名统一成 `.png`，两次读的路径才可比。 */
function normalizedImage(id) {
  return typeof id === "string" ? id.replace(/\.(webp|jpe?g)(#|$)/i, ".png$2") : id
}

function imageSignature(image) {
  let hash = 2166136261
  for (const byte of image.data) hash = Math.imul(hash ^ byte, 16777619)
  return `${image.width}x${image.height}:${(hash >>> 0).toString(16)}`
}

function layerKey(layer) {
  return layer.kind === "image" ? { ...layer, image: normalizedImage(layer.image) } : layer
}

/** 触摸区按像素取整后比较：布局取整会让边界有 1px 内的浮点差。 */
function hitAreaShape(area) {
  if (!area) return null
  if (area.kind !== "inset") return area
  const edge = (value) => Math.round(value)
  return {
    kind: area.kind,
    edges: { left: edge(area.edges.left), top: edge(area.edges.top), right: edge(area.edges.right), bottom: edge(area.edges.bottom) },
  }
}

function modelSignature(model) {
  const boards = [...model.boards]
    .map((board) => ({
      id: board.id,
      kind: board.kind,
      theme: board.theme,
      orientation: board.orientation,
      // 布局计算按像素取整（layout.ts 的既定行为）；比较时与之一致，浮点差不算结构变化。
      container: containerOf(board)
        ? { width: Math.round(containerOf(board).width), height: Math.round(containerOf(board).height) }
        : null,
      geometry: board.geometry,
      backdrop: board.backdrop ?? null,
      removedKeys: board.removedKeys ?? null,
      keys: board.keys.map((key) => ({
        id: key.id,
        layoutId: key.layoutId,
        hitArea: hitAreaShape(key.hitArea),
        actions: key.actions,
        container: key.container,
        sound: key.sound ?? null,
        label: key.label ?? null,
        holdSymbol: key.holdSymbol ?? null,
        labelPosition: key.labelPosition ?? null,
      })),
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
  const styles = [...model.styles]
    .map(([id, style]) => [id, {
      normal: style.normal.map(layerKey),
      pressed: (style.pressed ?? []).map(layerKey),
      disabled: (style.disabled ?? []).map(layerKey),
    }])
    .sort((left, right) => left[0].localeCompare(right[0]))
  const images = [...model.images]
    .map(([id, image]) => [normalizedImage(id), imageSignature(image)])
    .sort((left, right) => left[0].localeCompare(right[0]))
  const atlases = model.atlases
    .map((atlas) => ({ ...atlas, source: normalizedImage(atlas.source) }))
    .sort((left, right) => left.name.localeCompare(right.name))
  const motions = [...model.motions].sort((left, right) => left[0].localeCompare(right[0]))
  const sounds = [...model.sounds].sort((left, right) => left.subject.localeCompare(right.subject))
  const appearances = [...model.appearances]
    .sort((left, right) => `${left.theme}:${left.orientation}`.localeCompare(`${right.theme}:${right.orientation}`))
  return {
    meta: {
      name: model.meta.name,
      author: model.meta.author,
      description: model.meta.description,
      platform: model.meta.platform,
      designWidth: model.meta.designWidth,
    },
    boards,
    styles,
    images,
    atlases,
    motions,
    sounds,
    appearances,
    opaqueKeys: [...model.opaque.keys()].sort(),
  }
}

function unpackedSkin(path) {
  const unpacked = unzipSync(new Uint8Array(readFileSync(new URL(`../${path}`, import.meta.url))))
  return JSON.parse(new TextDecoder().decode(unpacked["skin.json"]))
}

/** skin.json 的结构对照：主题与布局的键集合、每个按键的键值。 */
function skinStructure(skin) {
  const themes = {}
  for (const key of ["default", "night"]) {
    const theme = skin[key]
    if (!theme) continue
    const layouts = {}
    for (const orientation of ["port_layout", "land_layout"]) {
      const layout = theme[orientation] ?? {}
      layouts[orientation] = {
        fields: Object.keys(layout).sort(),
        boards: Object.fromEntries(Object.entries(layout.b ?? {}).map(([name, keyboard]) => [name, {
          type: keyboard.type,
          fields: Object.keys(keyboard).sort(),
          keys: (keyboard.keys ?? []).map((key) => ({
            id: key.id,
            values: key.values ?? [],
            b: key.b ?? null,
          })),
          keyFix: keyboard.key_fix ?? null,
        }])),
      }
    }
    themes[key] = {
      fields: Object.keys(theme).sort(),
      layouts,
      s_infoFields: Object.keys(theme.s_info ?? {}).sort(),
      ss_1: Object.keys(theme.s_info?.ss_1 ?? {}).sort(),
      ss_2: Object.keys(theme.s_info?.ss_2 ?? {}).sort(),
      info: Object.keys(theme.s_info?.info ?? {}).sort(),
      menu: theme.menu ?? null,
    }
  }
  return themes
}

/** 只报第一处差异，避免上千张图的签名把输出淹掉。 */
function firstDifference(left, right, path = "") {
  if (Object.is(left, right)) return
  if (typeof left !== typeof right) return `${path}: 类型不同 ${typeof left} vs ${typeof right}`
  if (left && right && typeof left === "object") {
    const leftKeys = Array.isArray(left) ? left.map((_, index) => String(index)) : Object.keys(left)
    const rightKeys = Array.isArray(right) ? right.map((_, index) => String(index)) : Object.keys(right)
    for (const key of leftKeys) {
      const difference = firstDifference(left[key], right[key], `${path}/${key}`)
      if (difference) return difference
    }
    for (const key of rightKeys) if (!(key in left)) return `${path}/${key}: 只在回读里有`
    return
  }
  return `${path}: ${JSON.stringify(left)} ≠ ${JSON.stringify(right)}`
}

test("五个手心样本读成模型并往返一致", async () => {
  for (const path of SAMPLES) {
    const { first, second, written, firstRects, secondRects } = await roundtrip(path)
    assert.ok(first.boards.length > 0, `${path} 没有板`)
    assert.ok(first.styles.size > 0, `${path} 没有样式`)
    assert.ok(first.images.size > 0, `${path} 没有图片`)
    assert.ok(first.boards.some((board) => board.kind === "main"), `${path} 没有主键盘板`)
    assert.ok(first.appearances.length > 0, `${path} 没有外观`)
    // 两次读出的 IR 结构必须一致。
    const difference = firstDifference(modelSignature(second), modelSignature(first))
    assert.equal(difference, undefined, `${path} 往返后 IR 不一致：${difference}`)
    // 几何按布局树算出的矩形比较，允许 1px 取整容差。
    const geometry = firstCloseDifference(secondRects, firstRects)
    assert.equal(geometry, undefined, `${path} 往返后几何不一致：${geometry}`)
    // 写回的 skin.json 与原包做结构对照，不要求逐字节相同。
    const rebuilt = JSON.parse(new TextDecoder().decode(written.files.get("skin.json")))
    const structure = firstDifference(skinStructure(rebuilt), skinStructure(unpackedSkin(path)))
    assert.equal(structure, undefined, `${path} 的 skin.json 结构变了：${structure}`)
  }
})

test("菜单是工具栏板，两层状态结构原样保留", async () => {
  const { first } = await roundtrip("public/res/Skin(4).sxi")
  const menu = first.boards.find((board) => board.kind === "toolbar")
  assert.ok(menu, "没有菜单板")
  const panels = menu.panels
  assert.ok(panels.toolbar.items.length > 0, "菜单项没有读出来")
  assert.ok(Array.isArray(menu.extra.get("sxi:menu")), "两层菜单原值没有保留")
})

test("包的目录层级保留 skin/ 中间层与资源目录", async () => {
  const { written } = await roundtrip("public/res/Skin(4).sxi")
  const names = [...written.files.keys()]
  assert.ok(names.includes("skin.json"))
  assert.ok(names.includes("info.json"))
  assert.ok(names.some((name) => /^light\/skin\/res\/.+\.png$/.test(name)), "light 主题资源没有写在 skin/res 下")
  assert.ok(names.some((name) => name.endsWith(".layout")), "规则文件没有写回")
  assert.ok(names.some((name) => /\.aiff$/.test(name)), "音效没有写回")
})

test("统一入口也能打开手心皮肤，并读出两个主题", async () => {
  const opened = await openSkin(archiveOf("public/res/Skin(4).sxi"))
  assert.ok(opened)
  assert.equal(opened.format, "sxi")
  assert.ok(opened.model.boards.some((board) => board.theme === "light"))
  assert.ok(opened.model.boards.some((board) => board.theme === "dark"))
})

test("读出的几何、样式与音效关键字段正确", async () => {
  const { first } = await roundtrip("public/res/Skin(4).sxi")
  const board = first.boards.find((item) => item.id.startsWith("sxi:default:port:"))
  assert.ok(board)
  assert.equal(board.geometry.kind, "document")
  assert.ok(containerOf(board).width > 0)
  const key = board.keys.find((item) => item.actions.press?.kind === "text" && item.actions.press.value === "q")
  assert.ok(key, "没有读出 q 键")
  assert.ok(key.container.back?.style?.startsWith("sxi:light:"))
  const sound = [...first.styles.values()]
    .flatMap((style) => style.normal)
    .find((layer) => layer.kind === "sound")
  assert.ok(sound, "没有读出音效")
  assert.match(sound.binding.sound, /\.(aiff|ogg)$/)
  assert.ok(sound.binding.variants.length > 0, "同一音效的另一格式没有进 variants")
})

test("动效读成轨道与组合", async () => {
  const { first } = await roundtrip("public/res/拒绝摆烂-乱17.sxi")
  const kinds = new Set([...first.motions.values()].map((motion) => motion.kind))
  assert.ok(kinds.has("track"), "a1 没有读成轨道")
  assert.ok(kinds.has("group"), "a3 没有读成组合")
  const group = [...first.motions.values()].find((motion) => motion.kind === "group")
  assert.ok(group.children.every((child) => child.kind === "reference"))
})

test("没有 skin.json 的包不被认成手心皮肤", () => {
  assert.equal(sxiSource(new Map([["info.json", new TextEncoder().encode("{}")]])), undefined)
})

test("只有 info.json 与空 default 时明确失败", () => {
  const files = new Map([["skin.json", new TextEncoder().encode(JSON.stringify({ default: {} }))]])
  assert.equal(sxiSource(files), undefined)
})
