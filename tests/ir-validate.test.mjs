// IR 校验：悬空引用与几何自洽。
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { SkinArchive } from "../src/skin.ts"
import { bdaFormat, bdaSource } from "../src/skin-model/formats/bda.ts"
import { bdsFormat, bdsSource } from "../src/skin-model/formats/bds.ts"
import { isExportable, summarize, validateModel } from "../src/skin-model/validate.ts"
import { bdsFixture } from "./helpers/baidu-fixture.mjs"
import { readWith } from "./support/driver.mjs"

async function bdsModel() {
  return readWith(bdsFormat, bdsSource(SkinArchive.open(new Uint8Array(bdsFixture()), "bds")))
}

test("读出来的模型通过自检", async () => {
  const report = validateModel(await bdsModel())
  assert.equal(report.errors, 0, summarize(report))
  assert.ok(isExportable(report))
})

test("样式引用不存在的图片时报错", async () => {
  const model = await bdsModel()
  model.styles.set("900", { normal: [{ kind: "image", image: "不存在的图片" }] })
  const report = validateModel(model)
  assert.ok(report.issues.some((issue) => issue.code === "missing-image" && issue.severity === "error"))
  assert.equal(isExportable(report), false)
})

test("按键引用不存在的样式时报错", async () => {
  const model = await bdsModel()
  model.boards[0].keys[0].container = { ...model.boards[0].keys[0].container, back: { style: "不存在" } }
  const report = validateModel(model)
  assert.ok(report.issues.some((issue) => issue.code === "missing-style" && issue.subject.includes("KEY1")))
})

test("空板报错，重复键 id 报错", async () => {
  const model = await bdsModel()
  model.boards.push({ ...model.boards[0], id: "空板", keys: [] })
  assert.ok(validateModel(model).issues.some((issue) => issue.code === "empty-board"))
  const duplicated = await bdsModel()
  const key = duplicated.boards[0].keys[0]
  duplicated.boards[0].keys.push({ ...key })
  assert.ok(validateModel(duplicated).issues.some((issue) => issue.code === "duplicate-id"))
})

test("动效绑定的样式不存在时给提示", async () => {
  const model = await bdsModel()
  model.motions = new Map([["m1", {
    id: "m1",
    root: { kind: "track", track: { property: "alpha", from: [[0, 0], [0, 0]], to: [[1, 1], [1, 1]], relative: false, easing: { kind: "linear" } }, delay: 0, duration: 0.2 },
    timeline: { delay: 0, duration: 0.2, repeat: 0, reverse: false, clear: false },
    bindings: [{ target: "style:999", slot: "press", scope: "both" }],
  }]])
  const report = validateModel(model)
  assert.ok(report.issues.some((issue) => issue.code === "missing-style" && issue.subject === "m1"))
})

test("真实 BDA 皮肤自检后没有错误", async () => {
  const bda = SkinArchive.open(new Uint8Array(readFileSync(new URL("../public/default-template.bda", import.meta.url))), "bda")
  const base = SkinArchive.open(new Uint8Array(readFileSync(new URL("../public/bda-base.bds", import.meta.url))))
  const model = await readWith(bdaFormat, bdaSource(bda, base))
  const report = validateModel(model)
  assert.equal(report.errors, 0, `${summarize(report)}；${report.issues.slice(0, 3).map((issue) => `${issue.code} ${issue.subject}`).join("，")}`)
})
