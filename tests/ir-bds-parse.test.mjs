// 百度皮肤的解析：按角色分桶，每个文件都必须落进某个桶。
import assert from "node:assert/strict"
import test from "node:test"
import { identifyBds } from "../src/skin-model/formats/bds-identify.ts"
import { parseBds } from "../src/skin-model/formats/bds-parse.ts"
import { packageOf } from "../src/skin-model/pipeline.ts"

function pkgOf(entries) {
  return { format: "bds", files: new Map(entries.map(([path, text]) => [path, new TextEncoder().encode(text)])) }
}

const LAYOUT = "[KEY1]\nVIEW_RECT=0,0,100,100\nCENTER=F13\n"

test("布局与面板配置解析成文档，图片与音效进二进制桶", () => {
  const pkg = pkgOf([
    ["light/skin/port/py_26.ini", LAYOUT],
    ["light/skin/port/gen.ini", "[PANEL]\nSIZE=100,100\n"],
    ["light/skin/res/frame.png", "png"],
    ["light/skin/res/click.wav", "wav"],
    ["Info.txt", "Name=测试\n"],
  ])
  const documents = parseBds(pkg, identifyBds(pkg))
  assert.ok(documents.texts.has("light/skin/port/py_26.ini"))
  assert.ok(documents.texts.has("light/skin/port/gen.ini"))
  assert.ok(documents.texts.has("Info.txt"))
  assert.ok(documents.binaries.has("light/skin/res/frame.png"))
  assert.ok(documents.binaries.has("light/skin/res/click.wav"))
  // 文档能读出段名，说明真的解析了而不是原样塞进去
  assert.ok(documents.texts.get("light/skin/port/py_26.ini").sections().includes("KEY1"))
})

test("样式表是文本但不是 INI，单独存放", () => {
  const pkg = pkgOf([["light/skin/res/default.css", "[STYLE1]\nBG_COLOR=#fff\n"]])
  const documents = parseBds(pkg, identifyBds(pkg))
  assert.equal(documents.structs.get("light/skin/res/default.css").includes("STYLE1"), true)
  assert.equal(documents.texts.size, 0)
})

test("每个文件都要落进某个桶", () => {
  const pkg = pkgOf([
    ["light/skin/port/py_26.ini", LAYOUT],
    ["light/skin/port/cand1.cnd", "x"],
    ["light/skin/res/frame.png", "png"],
    ["light/skin/res/odd.xyz", "?"],
  ])
  const documents = parseBds(pkg, identifyBds(pkg))
  const total = documents.texts.size + documents.structs.size + documents.binaries.size
  assert.equal(total, pkg.files.size, "有文件没进任何桶")
})

test("识别不出来的文件不参与解析，但字节仍保留", () => {
  const pkg = pkgOf([["light/skin/res/odd.xyz", "?"]])
  const documents = parseBds(pkg, identifyBds(pkg))
  assert.equal(documents.texts.size, 0)
  assert.ok(documents.binaries.has("light/skin/res/odd.xyz"))
})

test("角色表说有、包里没有时报错，不静默跳过", () => {
  const pkg = pkgOf([["light/skin/port/py_26.ini", LAYOUT]])
  const structure = identifyBds(pkg)
  structure.roles.set("light/skin/port/missing.ini", { kind: "layout", board: "main", theme: "light", orientation: "port" })
  assert.throws(() => parseBds(pkg, structure), /包里没有文件/)
})

test("拆包只取文件与字节", () => {
  const archive = {
    names: () => ["a.ini", "b.png"],
    getBytes: (path) => new TextEncoder().encode(path),
  }
  const pkg = packageOf(archive, "bds")
  assert.equal(pkg.format, "bds")
  assert.deepEqual([...pkg.files.keys()], ["a.ini", "b.png"])
  assert.equal(new TextDecoder().decode(pkg.files.get("b.png")), "b.png")
})
