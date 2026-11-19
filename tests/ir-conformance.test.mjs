// 格式一致性检查：导出再读回，比对计数。
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { SkinArchive } from "../src/skin.ts"
import { checkRoundTrip, checkTargets, countsOf, summarizeRoundTrip } from "../src/skin-model/conformance.ts"
import { bdsFormat, bdsSource } from "../src/skin-model/formats/bds.ts"
import { bdsFixture } from "./helpers/baidu-fixture.mjs"
import { readWith } from "./support/driver.mjs"

function baseBds() {
  return SkinArchive.open(new Uint8Array(readFileSync(new URL("../public/bda-base.bds", import.meta.url))), "bds")
}

function fixtureBds() {
  return SkinArchive.open(new Uint8Array(bdsFixture()), "bds")
}

test("计数快照包含主键盘键数", async () => {
  const model = await readWith(bdsFormat, bdsSource(fixtureBds()))
  const counts = countsOf(model)
  assert.equal(counts.boards, 3)
  assert.ok(counts.keys > counts.mainKeys, "总键数应大于主板键数")
  assert.ok(counts.styles > 0)
})

test("BDS 自转不丢主键盘与样式", async () => {
  const report = await checkRoundTrip(fixtureBds(), "bds")
  assert.ok(report)
  assert.equal(report.ok, true, report.problems.join("；"))
  assert.equal(report.after.mainKeys, report.before.mainKeys)
  assert.equal(report.after.styles, report.before.styles)
})

test("转到手心会少板与键，作为提示而不是失败", async () => {
  const report = await checkRoundTrip(baseBds(), "sxi", { base: baseBds() })
  assert.ok(report)
  assert.equal(report.ok, true, "单板是手心格式的限制，不该判失败")
  assert.ok(report.notes.length > 0, "应当如实提示少掉的板与键")
  assert.equal(report.after.mainKeys, report.before.mainKeys, "主键盘本身不能少键")
})

test("转到 BDA 后能读回，主键盘完整", async () => {
  const archive = baseBds()
  const report = await checkRoundTrip(archive, "bda", { base: archive })
  assert.ok(report)
  assert.equal(report.ok, true, report.problems.join("；"))
  assert.equal(report.after.mainKeys, report.before.mainKeys)
})

test("一次跑多个目标，失败的不会中断后面的检查", async () => {
  const archive = baseBds()
  const reports = await checkTargets(archive, ["bds", "sxi", "bda"], { base: archive })
  assert.equal(reports.length, 3)
  assert.deepEqual(reports.map((report) => report.to), ["bds", "sxi", "bda"])
  for (const report of reports) assert.equal(typeof summarizeRoundTrip(report), "string")
})

test("无法识别源包时不做检查，返回 undefined", async () => {
  const bare = SkinArchive.open(new Uint8Array([80, 75, 5, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), "bds")
  assert.equal(await checkRoundTrip(bare, "bds"), undefined)
})
