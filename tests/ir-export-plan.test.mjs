// 导出计划：重建的文件、原样保留的文件、明确丢弃的文件。
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { SkinArchive } from "../src/skin.ts"
import { describePlan, planExport } from "../src/skin-model/export-plan.ts"
import { bdsFormat, bdsSource } from "../src/skin-model/formats/bds.ts"
import { bdsFixture } from "./helpers/baidu-fixture.mjs"

function bytes(value) {
  return new TextEncoder().encode(value)
}

test("重建文件覆盖同名路径，资源原样保留", () => {
  const source = SkinArchive.fromSourceFiles([
    { path: "light/skin/res/default.css", data: bytes("旧样式") },
    { path: "light/skin/res/click.wav", data: bytes("wav") },
    { path: "light/skin/res/font.ttf", data: bytes("ttf") },
    { path: "light/skin/port/py_26.ini", data: bytes("旧布局") },
  ])
  const rebuilt = new Map([["light/skin/res/default.css", bytes("新样式")]])
  const plan = planExport(source, rebuilt)
  assert.deepEqual(plan.replaced, ["light/skin/res/default.css"])
  assert.ok(plan.kept.includes("light/skin/res/click.wav"))
  assert.ok(plan.kept.includes("light/skin/res/font.ttf"))
  const paths = plan.files.map((file) => file.path)
  assert.ok(paths.includes("light/skin/res/click.wav"))
  const css = plan.files.find((file) => file.path === "light/skin/res/default.css")
  assert.equal(new TextDecoder().decode(css.data), "新样式")
})

test("dropPath 指定的文件被丢弃并说明原因", () => {
  const source = SkinArchive.fromSourceFiles([
    { path: "light/skin/res/old.png", data: bytes("png") },
    { path: "light/skin/res/click.wav", data: bytes("wav") },
  ])
  const plan = planExport(source, new Map(), { dropPath: (path) => path.endsWith(".png") })
  assert.deepEqual(plan.dropped.map((item) => item.path), ["light/skin/res/old.png"])
  assert.ok(plan.kept.includes("light/skin/res/click.wav"))
  assert.match(describePlan(plan), /保留 1 个原文件/)
})

test("没有原包时只输出重建的文件", () => {
  const rebuilt = new Map([["Info.txt", bytes("信息")]])
  const plan = planExport(undefined, rebuilt)
  assert.equal(plan.files.length, 1)
  assert.deepEqual(plan.kept, [])
  assert.deepEqual(plan.dropped, [])
})

test("BDS 导出保留音效，丢弃已被图集取代的散图与切片表", async () => {
  const withSound = SkinArchive.open(new Uint8Array(bdsFixture()), "bds")
  const files = withSound.names().map((path) => ({ path, data: withSound.getBytes(path) ?? new Uint8Array() }))
  files.push({ path: "light/skin/res/click.wav", data: bytes("wav") })
  const archive = SkinArchive.fromSourceFiles(files)
  const source = bdsSource(archive)
  const model = await bdsFormat.read(source)
  const rebuilt = await bdsFormat.write(model, source)
  const names = rebuilt.archive.names()
  assert.ok(names.includes("light/skin/res/click.wav"), "音效被丢掉了")
  assert.ok(!names.some((name) => name.endsWith(".til") && !/atlas\d*\.til$/.test(name)), "旧切片表还在")
  assert.ok(names.includes("light/skin/res/atlas.til"))
  // 面板文件沿用原名，不产生第二份
  assert.ok(names.includes("light/skin/port/cand1.cnd"))
  assert.ok(!names.includes("light/skin/port/cand.cnd"))
})

test("导出前后的文件数量不会无故减少", async () => {
  const archive = SkinArchive.open(new Uint8Array(bdsFixture()), "bds")
  const source = bdsSource(archive)
  const model = await bdsFormat.read(source)
  const rebuilt = await bdsFormat.write(model, source)
  const before = new Set(archive.names())
  const after = new Set(rebuilt.archive.names())
  const lost = [...before].filter((name) => !after.has(name))
  // 只允许丢掉被图集取代的散图与旧切片表
  assert.ok(lost.every((name) => /\.(?:png|til)$/i.test(name)), `丢了非图片文件：${lost.join("、")}`)
})
