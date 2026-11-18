// 布局推导：从按键的已计算布局得到 grid / 行容器 / 绝对盒子，并验证计算后与输入一致。
import assert from "node:assert/strict"
import test from "node:test"
import { Display } from "taffy-layout"
import { deriveBoard } from "../src/skin-model/derive/layout.ts"
import { layoutStats } from "../src/skin-model/derive/cost.ts"
import { computeLayout } from "../src/skin-model/layout.ts"
import { box, rectOf } from "./helpers/boxes.mjs"

function expectSame(layout, keys) {
  for (const key of keys) {
    assert.deepEqual(rectOf(layout.get(key.id)), rectOf(key), key.id)
  }
}

test("规整网格推导为 grid 并精确复现", async () => {
  const keys = []
  for (let row = 0; row < 2; row++) {
    for (let column = 0; column < 3; column++) {
      keys.push({ id: `k${row}${column}`, ...box(column * 101, row * 51, 100, 50) })
    }
  }
  const size = { width: 302, height: 101 }
  const board = (await deriveBoard("board", keys, size)).layout
  assert.equal(board.style.display, Display.Grid)
  expectSame(await computeLayout(board, size), keys)
})

test("错位的行推导为行容器并精确复现", async () => {
  const keys = [
    { id: "a", ...box(0, 0, 100, 50) },
    { id: "b", ...box(100, 0, 100, 50) },
    { id: "c", ...box(10, 60, 100, 50) },
    { id: "d", ...box(110, 60, 100, 50) },
  ]
  const size = { width: 200, height: 110 }
  expectSame(await computeLayout((await deriveBoard("board", keys, size)).layout, size), keys)
})

test("不规整的键盘保持绝对盒子", async () => {
  const keys = [
    { id: "a", ...box(0, 0, 100, 50) },
    { id: "b", ...box(120, 0, 90, 50) },
    { id: "c", ...box(0, 60, 130, 50) },
  ]
  const size = { width: 300, height: 110 }
  expectSame(await computeLayout((await deriveBoard("board", keys, size)).layout, size), keys)
})

test("纵向列推导为列容器并精确复现", async () => {
  const keys = [
    { id: "a", ...box(0, 0, 100, 50) },
    { id: "b", ...box(0, 60, 100, 50) },
    { id: "c", ...box(120, 0, 100, 50) },
    { id: "d", ...box(120, 60, 100, 50) },
  ]
  const size = { width: 220, height: 110 }
  expectSame(await computeLayout((await deriveBoard("board", keys, size)).layout, size), keys)
})

test("行内嵌套列的混合结构可推导", async () => {
  const keys = [
    { id: "a", ...box(0, 0, 100, 50) },
    { id: "b", ...box(0, 60, 100, 50) },
    { id: "c", ...box(120, 0, 100, 110) },
  ]
  const size = { width: 220, height: 110 }
  expectSame(await computeLayout((await deriveBoard("board", keys, size)).layout, size), keys)
})

test("错位行合并为列容器，横向差异用 margin 表达", async () => {
  const keys = [
    { id: "a", ...box(0, 0, 100, 50) },
    { id: "b", ...box(100, 0, 100, 50) },
    { id: "c", ...box(10, 60, 100, 50) },
    { id: "d", ...box(110, 60, 100, 50) },
  ]
  const size = { width: 210, height: 110 }
  const result = await deriveBoard("board", keys, size)
  assert.equal(result.kind, "flex-column")
  assert.equal(result.layout.style.display, Display.Flex)
  assert.equal(result.layout.children.length, 2)
  assert.equal(result.layout.children[1].style.margin.left, 10)
  expectSame(await computeLayout(result.layout, size), keys)
})

test("真实模板按键可被推导并按 taffy 复现", async () => {
  const { readFileSync } = await import("node:fs")
  const { SkinArchive } = await import("../src/skin.ts")
  const { IniDocument } = await import("../src/ini.ts")
  const { previewItems } = await import("../src/preview-items.ts")
  const archive = SkinArchive.open(new Uint8Array(readFileSync("public/layout-templates/pinyin18.bds")), "bds")
  const path = archive.names().find((name) => /port\/py_18\.ini$/.test(name))
  assert.ok(path)
  const document = IniDocument.parse(archive.getText(path))
  const size = { width: 1125, height: 592 }
  const keys = previewItems(document, size.width, size.height, undefined, false)
    .filter((item) => /^KEY\d+$/i.test(item.section) && item.rect.width > 0)
    .map((item) => ({ id: item.section, ...box(item.rect.x, item.rect.y, item.rect.width, item.rect.height) }))
  const result = await deriveBoard("board", keys, size)
  const stats = layoutStats(result.layout)
  assert.ok(stats.absolute / keys.length < 0.2, `绝对节点占比 ${stats.absolute}/${keys.length}`)
  expectSame(await computeLayout(result.layout, size), keys)
})
