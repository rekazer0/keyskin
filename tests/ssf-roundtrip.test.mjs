// 搜狗皮肤（SSF）往返：读 → 写 → 再读，两次 IR 必须一致，且写出的 INI 不能多出或少掉段字段。
//
// 样本来自 `public/res/`，骨架来自 `public/sogou-template.bds`（客户端内置的键位表）。
// 这里不比较「写出来的包像不像原包」，只比较 IR 与段字段集合——那才是往返的验收标准。
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { zipSync } from "fflate"
import { IniDocument } from "../src/ini.ts"
import { SkinArchive } from "../src/skin.ts"
import { containerOf } from "../src/skin-model/board.ts"
import { openSkin, writeSkin } from "../src/skin-model/formats/index.ts"
import { computeLayout } from "../src/skin-model/layout.ts"
import { skeletonBoardOf } from "../src/skin-model/formats/ssf/skeleton.ts"
import { parseSsfImage, unpackSsf } from "../src/ssf/ssf-package.ts"

const ROOT = path.join(import.meta.dirname, "..")
const SKINS = ["好柿花生", "拟物", "森·钱来", "荷气生财", "蓝色经典"]

function readFile(file) {
  return new Uint8Array(readFileSync(path.join(ROOT, file)))
}

function skeleton() {
  return SkinArchive.open(readFile("public/sogou-template.bds"), "bds")
}

async function opened(name) {
  const archive = SkinArchive.open(readFile(`public/res/${name}.ssf`), "ssf")
  const opened = await openSkin(archive, { skeleton: skeleton() })
  assert.ok(opened, `${name} 读不出模型`)
  return opened
}

function zipped(files) {
  return new Uint8Array(zipSync(Object.fromEntries(files)))
}

/** 段字段集合：只看「哪个段的哪个字段存在」，值由语义比较负责。 */
function fieldsOf(bytes) {
  const document = IniDocument.parse(new TextDecoder().decode(bytes))
  return new Set(document.entries().map((entry) => `${entry.section}\u0000${entry.key}`))
}

/** Map 与数组转成纯数据；Map 的顺序不承载语义，按键名排序。 */
function plain(value) {
  if (value instanceof Map) return [...value].sort(([left], [right]) => String(left).localeCompare(String(right))).map(([key, item]) => [key, plain(item)])
  if (Array.isArray(value)) return value.map(plain)
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)]))
  return value
}

/** 模型投影：把 Map 按名字排序，去掉不承载语义的顺序差异。 */
function project(model) {
  const sorted = (map) => Object.fromEntries([...map].sort(([left], [right]) => String(left).localeCompare(String(right))).map(([key, item]) => [key, plain(item)]))
  return {
    meta: { ...model.meta },
    appearances: model.appearances,
    boards: model.boards.map((board) => ({
      id: board.id,
      kind: board.kind,
      geometry: board.geometry,
      container: board.container,
      backdrop: board.backdrop ?? null,
      panels: plain(board.panels ?? null),
      extra: plain(board.extra ?? null),
      layout: board.layout,
      keys: board.keys.map((key) => ({
        id: key.id,
        layoutId: key.layoutId,
        sections: key.sections ?? null,
        actions: key.actions,
        container: key.container,
        states: key.states ? sorted(key.states) : null,
        foreground: key.foreground ?? null,
        labelPosition: key.labelPosition ?? null,
        holdSymbol: key.holdSymbol ?? null,
        motions: key.motions ?? null,
      })),
    })),
    styles: sorted(model.styles),
    motions: sorted(model.motions),
    sounds: model.sounds,
    images: [...model.images.keys()].sort(),
    resources: [...model.resources.keys()].sort(),
    opaque: [...model.opaque].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => [key, plain(value)]),
  }
}

for (const name of SKINS) {
  test(`${name}：读 → 写 → 再读，模型一致`, async () => {
    const first = await opened(name)
    const written = await writeSkin(first.model, "ssf")
    const second = await openSkin(SkinArchive.open(zipped(written.source.files), "ssf"), { skeleton: skeleton() })
    assert.ok(second, "写出的包读不出模型")
    assert.equal(JSON.stringify(project(second.model)), JSON.stringify(project(first.model)))
  })

  test(`${name}：写出包的 INI 段字段与原包一致`, async () => {
    const first = await opened(name)
    const written = await writeSkin(first.model, "ssf")
    const original = await unpackSsf(readFile(`public/res/${name}.ssf`))
    for (const [file, bytes] of written.source.files) {
      if (!file.endsWith(".ini") || file === "smafilelist.ini") continue
      const before = original.get(file)
      assert.ok(before, `写出了一个原包没有的 INI：${file}`)
      const expected = fieldsOf(before)
      const actual = fieldsOf(bytes)
      assert.deepEqual([...actual].filter((field) => !expected.has(field)), [], `${file} 多出字段`)
      assert.deepEqual([...expected].filter((field) => !actual.has(field)), [], `${file} 少了字段`)
    }
  })
}

test("搜狗没有按键坐标：几何来自客户端骨架，布局树能还原骨架矩形", async () => {
  const { model } = await opened("好柿花生")
  const skeletonBoard = skeletonBoardOf(skeleton(), { theme: "light", orientation: "port" })
  assert.ok(skeletonBoard)
  for (const board of model.boards) {
    assert.deepEqual(board.geometry, { kind: "client", basis: "sogou" })
    // 树里只有行结构、间距与宽度比例，没有以像素写死的按键坐标。
    const styles = [board.layout, ...(board.layout.children ?? []), ...(board.layout.children ?? []).flatMap((row) => row.children ?? [])]
    for (const node of styles.slice(1)) {
      assert.equal(node.style.position, undefined, `布局节点 ${node.id} 写死了定位`)
      assert.equal(node.style.inset, undefined, `布局节点 ${node.id} 写死了 inset`)
    }
    const container = containerOf(board)
    const rects = container ? await computeLayout(board.layout, container) : new Map()
    for (const key of skeletonBoard.keys) {
      const rect = rects.get(key.id)
      if (!rect) continue
      assert.ok(Math.abs(rect.position.x - key.rect.x) <= 1, `${key.id} 横坐标对不上骨架`)
      assert.ok(Math.abs(rect.position.y - key.rect.y) <= 1, `${key.id} 纵坐标对不上骨架`)
      assert.ok(Math.abs(rect.size.width - key.rect.width) <= 1, `${key.id} 宽度对不上骨架`)
      assert.ok(Math.abs(rect.size.height - key.rect.height) <= 1, `${key.id} 高度对不上骨架`)
    }
  }
})

test("时段进外观：7~18 点与 0~6、19~23 点", async () => {
  const { model } = await opened("好柿花生")
  const ranges = model.appearances.map((appearance) => [appearance.name, appearance.activation])
  assert.deepEqual(ranges, [
    ["status1", { kind: "time", ranges: [{ startHour: 7, endHour: 18 }] }],
    ["status2", { kind: "time", ranges: [{ startHour: 0, endHour: 6 }, { startHour: 19, endHour: 23 }] }],
  ])
  // 时间条件只能落在外观上，不能混进主题。
  assert.deepEqual(model.appearances.map((appearance) => appearance.theme), ["light", "dark"])
})

test("五态图落成按键状态：按下、禁用、开、开且按下", async () => {
  const { model } = await opened("荷气生财")
  const key = model.boards[0].keys.find((each) => each.container.fore.length)
  assert.ok(key, "没有带前景的按键")
  assert.ok(key.container.back?.pressed, "按下态没有背景样式")
  assert.deepEqual([...key.states.keys()], ["*|0|*", "0|1|1", "1|1|1"])
  assert.ok(key.foreground, "FG_RECT 没有读成前景区域")
})

test("九宫格：四数是九宫格边宽，六数原样保留", async () => {
  const four = parseSsfImage("26key.png,1,97,1,141")
  assert.deepEqual(four.stretch, [1, 97, 1, 141])
  const six = parseSsfImage("bar.png,0,34,121,0,59,12")
  assert.equal(six.stretch, undefined, "六数不能当成四数解析")
  assert.deepEqual(six.numbers, [0, 34, 121, 0, 59, 12])
  const { model } = await opened("好柿花生")
  const layers = [...model.styles.values()].flatMap((style) => style.normal)
  assert.ok(layers.some((layer) => layer.kind === "image" && layer.stretch?.kind === "nine-slice"))
  assert.ok(layers.some((layer) => layer.kind === "image" && layer.stretch?.kind === "unknown-six"))
})

test("三处拼写偏差原样写回", async () => {
  const first = await opened("好柿花生")
  const written = await writeSkin(first.model, "ssf")
  const text = [...written.source.files].filter(([file]) => file.endsWith(".ini")).map(([, bytes]) => new TextDecoder().decode(bytes)).join("\n")
  assert.match(text, /Foground_/, "Foground 段名被改写了")
  assert.match(text, /FG_IMGE=/, "FG_IMGE 字段被改写了")
  assert.match(text, /forder\d+=/, "forder 键名被改写了")
})

test("没有官方骨架就读不出搜狗皮肤", async () => {
  const archive = SkinArchive.open(readFile("public/res/好柿花生.ssf"), "ssf")
  assert.equal(await openSkin(archive), undefined)
})

test("非按键段里的未建模字段原样保留", async () => {
  const first = await opened("好柿花生")
  const loose = first.model.opaque.get("ssf:looseFields")
  assert.ok(loose && loose.size > 0)
  const written = await writeSkin(first.model, "ssf")
  const second = await openSkin(SkinArchive.open(zipped(written.source.files), "ssf"), { skeleton: skeleton() })
  assert.ok(second)
  assert.equal(second.model.opaque.get("ssf:looseFields")?.size, loose.size)
})
