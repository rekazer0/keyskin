// 非按键窗口：候选栏、提示气泡、手写区要能进模型并原路写回。
import assert from "node:assert/strict"
import test from "node:test"
import { SkinArchive } from "../src/skin.ts"
import { bdsFormat, bdsSource } from "../src/skin-model/formats/bds/index.ts"
import { emptyModel } from "../src/skin-model/model.ts"
import { readWith, writeWith } from "./support/driver.mjs"

test("候选窗与提示窗进模型，带原路径与分段", async () => {
  const base = bdsFixtureArchive()
  const model = await readWith(bdsFormat, bdsSource(base))
  const candidates = model.windows.filter((window) => window.kind === "candidate")
  const hints = model.windows.filter((window) => window.kind === "hint")
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
  for (const window of model.windows) {
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

test("空模型的窗口列表是空数组，不是缺字段", () => {
  const model = emptyModel({ appearance: "light", orientation: "port" }, "bds")
  assert.deepEqual(model.windows, [])
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
