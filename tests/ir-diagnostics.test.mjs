// 包的诊断：认得出多少文件、哪些认不出来。
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { SkinArchive } from "../src/skin.ts"
import { describeDiagnostics, diagnose, structureOf } from "../src/skin-model/diagnostics.ts"

function pkgOf(entries) {
  const bytes = (text) => new TextEncoder().encode(text)
  return SkinArchive.fromSourceFiles(entries.map(([path, text]) => ({ path, data: bytes(text) })))
}

const LAYOUT = "[KEY1]\nVIEW_RECT=0,0,100,100\nCENTER=F13\n"

test("诊断给出文件总数与角色分布", () => {
  const archive = pkgOf([
    ["light/skin/port/py_26.ini", LAYOUT],
    ["light/skin/res/default.css", "[STYLE1]\nNM_COLOR=#fff\n"],
    ["light/skin/res/a.png", "png"],
    ["light/skin/res/b.png", "png"],
  ])
  const diagnostics = diagnose(archive, "bds")
  assert.equal(diagnostics.files, 4)
  assert.equal(diagnostics.unknown.length, 0)
  const image = diagnostics.roles.find((role) => role.kind === "image")
  assert.equal(image.count, 2)
  // 按数量降序：图片 2 个排第一
  assert.equal(diagnostics.roles[0].kind, "image")
})

test("认不出来的文件带路径与原因", () => {
  const archive = pkgOf([
    ["light/skin/port/py_26.ini", LAYOUT],
    ["light/skin/res/odd.xyz", "?"],
  ])
  const diagnostics = diagnose(archive, "bds")
  assert.equal(diagnostics.unknown.length, 1)
  assert.equal(diagnostics.unknown[0].path, "light/skin/res/odd.xyz")
  assert.ok(diagnostics.unknown[0].reason.length > 0)
})

test("摘要说明识别覆盖情况", () => {
  const clean = diagnose(pkgOf([["light/skin/port/py_26.ini", LAYOUT]]), "bds")
  assert.match(describeDiagnostics(clean), /已识别/)
  assert.doesNotMatch(describeDiagnostics(clean), /未识别/)

  const dirty = diagnose(pkgOf([["light/skin/res/odd.xyz", "?"]]), "bds")
  assert.match(describeDiagnostics(dirty), /未识别 1/)
})

test("四个格式都能给出结构，不依赖模型", () => {
  const bds = structureOf(pkgOf([["light/skin/port/py_26.ini", LAYOUT]]), "bds")
  assert.ok(bds.roles.size > 0)
  const sxi = structureOf(pkgOf([["skin.json", "{}"], ["a.png", "x"]]), "sxi")
  assert.ok(sxi.roles.size > 0)
  const ssf = structureOf(pkgOf([["phoneTheme.ini", "[General]\nskin_name=x\n"]]), "ssf")
  assert.ok(ssf.roles.size > 0)
  const bda = structureOf(pkgOf([["light/skin/port/appearanceConfig", "x"]]), "bda")
  assert.ok(bda.roles.size > 0)
})

test("真实皮肤：整包都认得出", () => {
  const archive = SkinArchive.open(new Uint8Array(readFileSync("public/bda-base.bds")))
  const diagnostics = diagnose(archive, "bds")
  assert.equal(diagnostics.files, 257)
  assert.equal(diagnostics.unknown.length, 0)
  assert.deepEqual(diagnostics.orientations, ["land", "port"])
})
