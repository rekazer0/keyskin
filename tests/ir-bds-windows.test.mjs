// 非按键窗口：候选栏、提示气泡、手写区原样保留在 opaque 里，按原路径写回。
//
// 设计稿把这些窗口视为格式专有内容，不进顶层字段；路径作键、分段结构作值。
import assert from "node:assert/strict"
import test from "node:test"
import { SkinArchive } from "../src/skin.ts"
import { bdsFormat, bdsSource } from "../src/skin-model/formats/bds/index.ts"
import { emptyModel } from "../src/skin-model/model.ts"
import { readWith, writeWith } from "./support/driver.mjs"

/** 模型里的窗口文档：opaque 中 `window:<路径>` 的条目。 */
function windowsOf(model) {
  return [...model.opaque]
    .filter(([key]) => key.startsWith("window:"))
    .map(([key, value]) => ({ path: key.slice("window:".length), ...value }))
}

test("候选窗与提示窗进模型，带原路径与分段", async () => {
  const base = bdsFixtureArchive()
  const model = await readWith(bdsFormat, bdsSource(base))
  const windows = windowsOf(model)
  const candidates = windows.filter((window) => window.kind === "candidate")
  const hints = windows.filter((window) => window.kind === "hint")
  assert.ok(candidates.length > 0, "候选窗没有被读进模型")
  assert.ok(hints.length > 0, "提示窗没有被读进模型")
  for (const window of [...candidates, ...hints]) {
    assert.ok(window.path.endsWith(".cnd") || window.path.endsWith(".pop"), window.path)
    assert.ok(window.sections.size > 0, `${window.path} 没有分段`)
  }
})

test("窗口按原路径写回，内容与读出时一致", async () => {
  const base = bdsFixtureArchive()
  const model = await readWith(bdsFormat, bdsSource(base))
  const out = await writeWith(bdsFormat, model)
  for (const window of windowsOf(model)) {
    assert.ok(out.archive.names().includes(window.path), `${window.path} 没有写回`)
    const text = out.archive.getText(window.path)
    assert.ok(text, `${window.path} 写回后读不出文本`)
    for (const [section, fields] of window.sections) {
      assert.ok(text.includes(`[${section}]`), `${window.path} 丢了段 ${section}`)
      for (const [key, value] of fields) {
        assert.ok(text.includes(`${key}=${value}`) || text.includes(`${key} = ${value}`), `${window.path} 丢了 ${key}`)
      }
    }
  }
})

test("空模型的 opaque 是空集合，不是缺字段", () => {
  const model = emptyModel({ theme: "light", orientation: "port" }, "bds")
  assert.equal(model.opaque.size, 0)
})

function bdsFixtureArchive() {
  const bytes = new TextEncoder()
  return SkinArchive.fromSourceFiles([
    { path: "light/skin/port/py_26.ini", data: bytes.encode("[KEY1]\nVIEW_RECT=0,0,100,100\nCENTER=F13\n") },
    { path: "light/skin/port/cand1.cnd", data: bytes.encode("[CAND]\nCOUNT=3\nSIZE=120,40\n") },
    { path: "light/skin/port/hint1.pop", data: bytes.encode("[HINT]\nPOS=0,10\n") },
    { path: "light/skin/port/gen.ini", data: bytes.encode("[PANEL]\nSIZE=400,300\n") },
  ])
}
