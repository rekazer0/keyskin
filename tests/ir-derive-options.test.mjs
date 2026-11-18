// 布局推导：按参数推导网格、flex 与相对容器，并验证成本权重会影响选择。
import assert from "node:assert/strict"
import test from "node:test"
import { Display, Position } from "taffy-layout"
import { deriveBoard } from "../src/skin-model/derive/layout.ts"
import { DEFAULT_DERIVE_OPTIONS, resolveDeriveOptions } from "../src/skin-model/derive/options.ts"
import { layoutCost, layoutStats } from "../src/skin-model/derive/cost.ts"
import { computeLayout } from "../src/skin-model/layout.ts"

function gridKeys() {
  const keys = []
  for (let row = 0; row < 2; row++) {
    for (let column = 0; column < 3; column++) {
      keys.push({ id: `k${row}${column}`, x: column * 101, y: row * 51, width: 100, height: 50 })
    }
  }
  return keys
}

test("默认参数推导为严格网格", async () => {
  const keys = gridKeys()
  const result = await deriveBoard("board", keys, { width: 302, height: 101 })
  assert.equal(result.kind, "grid")
  const layout = await computeLayout(result.layout, { width: 302, height: 101 })
  for (const key of keys) assert.deepEqual(layout.get(key.id), { x: key.x, y: key.y, width: key.width, height: key.height })
})

test("容差为 0 时 1px 偏差无法用网格表达", async () => {
  const keys = gridKeys()
  keys[4].x += 1
  const strict = await deriveBoard("board", keys, { width: 302, height: 101 }, { tolerance: 0 })
  const loose = await deriveBoard("board", keys, { width: 302, height: 101 }, { tolerance: 1 })
  assert.notEqual(strict.kind, "grid")
  assert.notEqual(loose.kind, "absolute")
  const layout = await computeLayout(loose.layout, { width: 302, height: 101 })
  for (const key of keys) {
    const actual = layout.get(key.id)
    assert.ok(Math.abs(actual.x - key.x) <= 1, `${key.id}.x=${actual.x}`)
  }
})

test("权重越高，绝对节点越受罚", () => {
  const keys = gridKeys()
  const relative = {
    id: "board",
    style: { position: Position.Relative, display: Display.Block, size: { width: 302, height: 101 } },
    children: keys.map((key) => ({
      id: key.id,
      style: { position: Position.Absolute, inset: { left: key.x, top: key.y, right: "auto", bottom: "auto" }, size: { width: key.width, height: key.height } },
    })),
  }
  const stats = layoutStats(relative)
  assert.equal(stats.absolute, keys.length)
  assert.equal(stats.relative, 1)
  const low = layoutCost(relative, { ...DEFAULT_DERIVE_OPTIONS.weights, absolute: 1 })
  const high = layoutCost(relative, { ...DEFAULT_DERIVE_OPTIONS.weights, absolute: 100 })
  assert.ok(high > low, `high=${high} low=${low}`)
  assert.equal(high - low, keys.length * 99)
})

test("三级参数合并：后者覆盖显式字段，权重逐项合并", () => {
  const merged = resolveDeriveOptions(
    { tolerance: 2 },
    { weights: { absolute: 50 } },
    { tolerance: 3, weights: { margin: 9 } },
  )
  assert.equal(merged.tolerance, 3)
  assert.equal(merged.weights.absolute, 50)
  assert.equal(merged.weights.margin, 9)
  assert.equal(merged.weights.container, DEFAULT_DERIVE_OPTIONS.weights.container)
  assert.equal(merged.maxDepth, DEFAULT_DERIVE_OPTIONS.maxDepth)
})
