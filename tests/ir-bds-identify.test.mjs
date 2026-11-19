// 百度皮肤的识别：每个文件一个角色，判不出来要如实标 unknown。
import assert from "node:assert/strict"
import test from "node:test"
import { identifyBds } from "../src/skin-model/formats/bds/identify.ts"
import { roleCounts, unknownFiles } from "../src/skin-model/pipeline.ts"
import { bdsFixture } from "./helpers/baidu-fixture.mjs"

function pkgOf(entries) {
  return { format: "bds", files: new Map(entries.map(([path, text]) => [path, new TextEncoder().encode(text)])) }
}

const LAYOUT = "[KEY1]\nVIEW_RECT=0,0,100,100\nCENTER=F13\n"

test("布局按方向与主题识别，板种类从文件名推断", () => {
  const pkg = pkgOf([
    ["light/skin/port/py_26.ini", LAYOUT],
    ["light/skin/port/num_9.ini", LAYOUT],
    ["light/skin/land/py_26.ini", LAYOUT],
  ])
  const structure = identifyBds(pkg)
  assert.deepEqual(structure.roles.get("light/skin/port/py_26.ini"), { kind: "layout", board: "main", theme: "light", orientation: "port" })
  assert.deepEqual(structure.roles.get("light/skin/port/num_9.ini"), { kind: "layout", board: "number", theme: "light", orientation: "port" })
  assert.deepEqual(structure.themes, ["light"])
  assert.deepEqual(structure.orientations, ["land", "port"])
})

test("非按键面板按后缀与文件名识别", () => {
  const pkg = pkgOf([
    ["light/skin/port/cand1.cnd", "x"],
    ["light/skin/port/hint1.pop", "x"],
    ["light/skin/port/bh.ini", "x"],
    ["light/skin/port/gen.ini", "[PANEL]\n"],
    ["light/skin/res/default.css", "x"],
    ["light/skin/res/click.wav", "x"],
    ["light/skin/res/font.ttf", "x"],
    ["light/skin/res/frame.png", "x"],
    ["Info.txt", "Name=测试\n"],
  ])
  const structure = identifyBds(pkg)
  const counts = roleCounts(structure)
  assert.equal(counts.get("candidate-window"), 1)
  assert.equal(counts.get("hint-window"), 1)
  assert.equal(counts.get("handwriting"), 1)
  assert.equal(counts.get("panel-config"), 1)
  assert.equal(counts.get("style"), 1)
  assert.equal(counts.get("audio"), 1)
  assert.equal(counts.get("font"), 1)
  assert.equal(counts.get("image"), 1)
  assert.equal(counts.get("info"), 1)
})

test("判不出来的文件进 unknown，并带上原因", () => {
  const pkg = pkgOf([["light/skin/port/weird.xyz", "x"]])
  const structure = identifyBds(pkg)
  const unknown = unknownFiles(structure)
  assert.equal(unknown.length, 1)
  assert.ok(unknown[0].reason.length > 0)
  assert.equal(unknown[0].path, "light/skin/port/weird.xyz")
})

test("没有按键段的 ini 归到面板配置，不冒充布局", () => {
  const pkg = pkgOf([["light/skin/port/template.ini", "[MISC]\nA=1\n"]])
  const role = identifyBds(pkg).roles.get("light/skin/port/template.ini")
  assert.equal(role.kind, "panel-config")
})

test("夹具皮肤的每个文件都有角色", () => {
  const pkg = pkgOf([["light/skin/port/py_26.ini", LAYOUT]])
  const structure = identifyBds(pkg)
  assert.equal(structure.roles.size, pkg.files.size)
  assert.equal(unknownFiles(structure).length, 0)
})
