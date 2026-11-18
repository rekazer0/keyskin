// 布局推导：从按键矩形得到 grid / 行容器 / 绝对矩形，并验证计算后与输入一致。
import assert from "node:assert/strict"
import test from "node:test"
import { Display } from "taffy-layout"
import { deriveBoard } from "../src/skin-model/derive/layout.ts"
import { layoutStats } from "../src/skin-model/derive/cost.ts"
import { computeLayout } from "../src/skin-model/layout.ts"

test("规整网格推导为 grid 并精确复现", async () => {
  const keys = []
  for (let row = 0; row < 2; row++) {
    for (let column = 0; column < 3; column++) {
      keys.push({ id: `k${row}${column}`, x: column * 101, y: row * 51, width: 100, height: 50 })
    }
  }
  const size = { width: 302, height: 101 }
  const board = (await deriveBoard("board", keys, size)).layout
  assert.equal(board.style.display, Display.Grid)
  const layout = await computeLayout(board, size)
  for (const key of keys) {
    assert.deepEqual(layout.get(key.id), { x: key.x, y: key.y, width: key.width, height: key.height })
  }
})

test("错位的行推导为行容器并精确复现", async () => {
  const keys = [
    { id: "a", x: 0, y: 0, width: 100, height: 50 },
    { id: "b", x: 100, y: 0, width: 100, height: 50 },
    { id: "c", x: 10, y: 60, width: 100, height: 50 },
    { id: "d", x: 110, y: 60, width: 100, height: 50 },
  ]
  const size = { width: 200, height: 110 }
  const board = (await deriveBoard("board", keys, size)).layout
  const layout = await computeLayout(board, size)
  for (const key of keys) {
    assert.deepEqual(layout.get(key.id), { x: key.x, y: key.y, width: key.width, height: key.height })
  }
})

test("不规整的键盘保持绝对矩形", async () => {
  const keys = [
    { id: "a", x: 0, y: 0, width: 100, height: 50 },
    { id: "b", x: 120, y: 0, width: 90, height: 50 },
    { id: "c", x: 0, y: 60, width: 130, height: 50 },
  ]
  const size = { width: 300, height: 110 }
  const board = (await deriveBoard("board", keys, size)).layout
  const layout = await computeLayout(board, size)
  for (const key of keys) {
    assert.deepEqual(layout.get(key.id), { x: key.x, y: key.y, width: key.width, height: key.height })
  }
})

test("纵向列推导为列容器并精确复现", async () => {
  const keys = [
    { id: "a", x: 0, y: 0, width: 100, height: 50 },
    { id: "b", x: 0, y: 60, width: 100, height: 50 },
    { id: "c", x: 120, y: 0, width: 100, height: 50 },
    { id: "d", x: 120, y: 60, width: 100, height: 50 },
  ]
  const size = { width: 220, height: 110 }
  const board = (await deriveBoard("board", keys, size)).layout
  const layout = await computeLayout(board, size)
  for (const key of keys) {
    assert.deepEqual(layout.get(key.id), { x: key.x, y: key.y, width: key.width, height: key.height })
  }
})

test("行内嵌套列的混合结构可推导", async () => {
  const keys = [
    { id: "a", x: 0, y: 0, width: 100, height: 50 },
    { id: "b", x: 0, y: 60, width: 100, height: 50 },
    { id: "c", x: 120, y: 0, width: 100, height: 110 },
  ]
  const size = { width: 220, height: 110 }
  const board = (await deriveBoard("board", keys, size)).layout
  const layout = await computeLayout(board, size)
  for (const key of keys) {
    assert.deepEqual(layout.get(key.id), { x: key.x, y: key.y, width: key.width, height: key.height })
  }
})

test("错位行合并为列容器，横向差异用 margin 表达", async () => {
  const keys = [
    { id: "a", x: 0, y: 0, width: 100, height: 50 },
    { id: "b", x: 100, y: 0, width: 100, height: 50 },
    { id: "c", x: 10, y: 60, width: 100, height: 50 },
    { id: "d", x: 110, y: 60, width: 100, height: 50 },
  ]
  const size = { width: 210, height: 110 }
  const result = await deriveBoard("board", keys, size)
  assert.equal(result.kind, "flex-column")
  assert.equal(result.layout.style.display, Display.Flex)
  assert.equal(result.layout.children.length, 2)
  const second = result.layout.children[1]
  assert.equal(second.style.margin.left, 10)
  const layout = await computeLayout(result.layout, size)
  for (const key of keys) {
    assert.deepEqual(layout.get(key.id), { x: key.x, y: key.y, width: key.width, height: key.height })
  }
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
    .map((item) => ({ id: item.section, ...item.rect }))
  const result = await deriveBoard("board", keys, size)
  const stats = layoutStats(result.layout)
  assert.ok(stats.absolute / keys.length < 0.2, `绝对节点占比 ${stats.absolute}/${keys.length}`)
  const layout = await computeLayout(result.layout, size)
  for (const key of keys) {
    const actual = layout.get(key.id)
    assert.ok(actual, `${key.id} 缺失`)
    assert.ok(Math.abs(actual.x - key.x) <= 1, `${key.id}.x ${actual.x} != ${key.x}`)
    assert.ok(Math.abs(actual.y - key.y) <= 1, `${key.id}.y ${actual.y} != ${key.y}`)
    assert.ok(Math.abs(actual.width - key.width) <= 1, `${key.id}.w`)
    assert.ok(Math.abs(actual.height - key.height) <= 1, `${key.id}.h`)
  }
})
