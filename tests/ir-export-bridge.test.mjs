// 跨格式判定与格式名映射：导出分支收敛的依据。
import assert from "node:assert/strict"
import test from "node:test"
import { formatIdOf, isCrossFormatExport } from "../src/skin-model/convert.ts"

test("BDI 与 BDS 是同一套容器，不算跨格式", () => {
  assert.equal(isCrossFormatExport("bdi", "bds"), false)
  assert.equal(isCrossFormatExport("bds", "bdi"), false)
  assert.equal(isCrossFormatExport("bds", "bds"), false)
})

test("其它组合都算跨格式", () => {
  assert.equal(isCrossFormatExport("ssf", "sxi"), true)
  assert.equal(isCrossFormatExport("bds", "ssf"), true)
  assert.equal(isCrossFormatExport("bda", "bds"), true)
  assert.equal(isCrossFormatExport("sxi", "bda"), true)
})

test("导出格式映射到 IR 格式名", () => {
  assert.equal(formatIdOf("bdi"), "bds")
  assert.equal(formatIdOf("bds"), "bds")
  assert.equal(formatIdOf("ssf"), "ssf")
  assert.equal(formatIdOf("sxi"), "sxi")
  assert.equal(formatIdOf("bda"), "bda")
})
