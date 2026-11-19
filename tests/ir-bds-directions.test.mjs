// 多方向、资源字节、非按键窗口：这三样以前都靠源包补，现在必须在模型里。
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { SkinArchive } from "../src/skin.ts"
import { bdsFormat, bdsSource } from "../src/skin-model/formats/bds.ts"
import { readWith, writeWith } from "./support/driver.mjs"

function fixture() {
  const bytes = (text) => new TextEncoder().encode(text)
  return SkinArchive.fromSourceFiles([
    { path: "light/skin/port/py_26.ini", data: bytes("[KEY1]\nVIEW_RECT=0,0,100,100\nCENTER=F13\n") },
    { path: "light/skin/land/py_26.ini", data: bytes("[KEY1]\nVIEW_RECT=0,0,200,100\nCENTER=F13\n") },
    { path: "light/skin/port/gen.ini", data: bytes("[PANEL]\nSIZE=400,300\n") },
    { path: "light/skin/land/gen.ini", data: bytes("[PANEL]\nSIZE=600,300\n") },
    { path: "light/skin/res/default.css", data: bytes("[STYLE1]\nNM_COLOR=#fff\nPRESS_SOUND_PATH=click.wav\nFONT_FILE=font.ttf\n") },
    { path: "light/skin/res/click.wav", data: bytes("RIFF-wav-bytes") },
    { path: "light/skin/res/font.ttf", data: bytes("ttf-bytes") },
  ])
}

test("竖屏与横屏两套键盘都进模型", async () => {
  const model = await readWith(bdsFormat, bdsSource(fixture()))
  const orientations = new Set(model.boards.map((board) => board.orientation))
  assert.deepEqual([...orientations].sort(), ["land", "port"])
  assert.equal(model.boards.length, 2)
})

test("每个方向各自写出面板文件", async () => {
  const archive = fixture()
  const model = await readWith(bdsFormat, bdsSource(archive))
  const out = await writeWith(bdsFormat, model)
  const names = out.archive.names()
  assert.ok(names.includes("light/skin/port/gen.ini"), "竖屏面板缺失")
  assert.ok(names.includes("light/skin/land/gen.ini"), "横屏面板缺失")
})

test("音效与字体的字节进模型，导出原样写回", async () => {
  const archive = fixture()
  const model = await readWith(bdsFormat, bdsSource(archive))
  const audio = [...model.resources.values()].find((resource) => resource.kind === "audio")
  const font = [...model.resources.values()].find((resource) => resource.kind === "font")
  assert.ok(audio?.data, "音效没有字节")
  assert.ok(font?.data, "字体没有字节")
  assert.equal(new TextDecoder().decode(audio.data), "RIFF-wav-bytes")
  assert.equal(new TextDecoder().decode(font.data), "ttf-bytes")

  const out = await writeWith(bdsFormat, model)
  assert.equal(new TextDecoder().decode(out.archive.getBytes(audio.path)), "RIFF-wav-bytes")
  assert.equal(new TextDecoder().decode(out.archive.getBytes(font.path)), "ttf-bytes")
})

test("资源没有字节时不凭空造文件", async () => {
  const bytes = (text) => new TextEncoder().encode(text)
  const archive = SkinArchive.fromSourceFiles([
    { path: "light/skin/port/py_26.ini", data: bytes("[KEY1]\nVIEW_RECT=0,0,100,100\nCENTER=F13\n") },
    // 样式里声明了音效，但包里没有这个文件。
    { path: "light/skin/res/default.css", data: bytes("[STYLE1]\nNM_COLOR=#fff\nPRESS_SOUND_PATH=missing.wav\n") },
  ])
  const model = await readWith(bdsFormat, bdsSource(archive))
  const out = await writeWith(bdsFormat, model)
  assert.ok(!out.archive.names().some((name) => name.endsWith("missing.wav")), "凭空造出了源包里没有的音效")
})

test("非图片文件在往返后不减少", async () => {
  const base = SkinArchive.open(new Uint8Array(readFileSync("public/bda-base.bds")))
  const model = await readWith(bdsFormat, bdsSource(base))
  const out = await writeWith(bdsFormat, model)
  const after = new Set(out.archive.names())
  const lost = base.names().filter((name) => !after.has(name) && !/\.png$/i.test(name))
  assert.deepEqual(lost, [], `丢了非图片文件：${lost.join("、")}`)
  // 60 块键盘布局；手写区的 bh.ini 与 hw_*.ini 不算键盘布局。
  assert.equal(model.boards.length, 60, "两个方向的键盘布局应当是 60")
})
