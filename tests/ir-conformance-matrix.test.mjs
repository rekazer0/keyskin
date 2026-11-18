// 真实皮肤的格式矩阵：锁住当前已通过的状态。
//
// 前几轮修掉的缺陷（样式段名、图片命名、动效键前缀）都是靠这类检查发现的。
// 把它们固化成断言，任何一处退化都会在这里暴露。
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { SkinArchive } from "../src/skin.ts"
import { checkTargets, summarizeRoundTrip } from "../src/skin-model/conformance.ts"
import { sxiFixture } from "./helpers/sxi-fixture.mjs"

function bdsBase() {
  return SkinArchive.open(new Uint8Array(readFileSync(new URL("../public/bda-base.bds", import.meta.url))), "bds")
}

function bdaSkin() {
  return SkinArchive.open(new Uint8Array(readFileSync(new URL("../public/default-template.bda", import.meta.url))), "bda")
}

function sxiSkin() {
  return SkinArchive.open(new Uint8Array(sxiFixture()), "sxi")
}

/** 跑一组目标，把失败原因拼成人能读的一行。 */
async function matrix(archive, targets, hints) {
  const reports = await checkTargets(archive, targets, hints)
  const failed = reports.filter((report) => !report.ok)
  assert.deepEqual(
    failed.map((report) => `${report.from}→${report.to}：${report.problems.join("；")}`),
    [],
  )
  return reports
}

test("官方基础布局转百度与手心都不丢内容", async () => {
  const base = bdsBase()
  const reports = await matrix(base, ["bds", "sxi", "bda"], { base })
  assert.equal(reports.length, 3)
  for (const report of reports) {
    assert.equal(report.after.mainKeys, report.before.mainKeys, `${report.to} 的主键盘键数变了`)
  }
})

test("真实 BDA 皮肤转百度与手心都不丢样式", async () => {
  const base = bdsBase()
  const reports = await matrix(bdaSkin(), ["bds", "sxi"], { base })
  for (const report of reports) {
    assert.equal(report.after.styles, report.before.styles, `${report.to} 的样式数变了`)
    assert.equal(report.after.errors, 0, `${report.to} 导出后自检有错误`)
  }
})

test("手心皮肤转百度保住主板按键，转 BDA 只保样式", async () => {
  const base = bdsBase()
  const reports = await matrix(sxiSkin(), ["sxi", "bds", "bda"], { base })
  for (const report of reports) {
    if (report.to === "bda") {
      // BDA 的按键由客户端面板布局决定，源键盘表达不了；只要不算失败即可。
      assert.equal(report.ok, true)
      continue
    }
    assert.equal(report.after.mainKeys, report.before.mainKeys, `${report.to} 的主键盘键数变了`)
  }
})

test("每条通过的转换都给得出结论行", async () => {
  const base = bdsBase()
  const reports = await matrix(base, ["bds", "sxi"], { base })
  for (const report of reports) {
    const line = summarizeRoundTrip(report)
    assert.match(line, /→/)
    assert.match(line, /通过/)
  }
})
