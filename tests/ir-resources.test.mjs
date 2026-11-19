// 资源字节：四个格式都要把音效与字体的内容读进模型，导出时从模型恢复。
import assert from "node:assert/strict"
import test from "node:test"
import { SkinArchive } from "../src/skin.ts"
import { ssfFormat, ssfSource } from "../src/skin-model/formats/ssf.ts"
import { SsfPackage } from "../src/ssf/ssf-package.ts"
import { ssfSkeleton } from "../src/ssf/ssf-convert.ts"
import { readWith, writeWith } from "./support/driver.mjs"

const bytes = (text) => new TextEncoder().encode(text)

function ssfFiles() {
  return new Map([
    ["phoneTheme.ini", bytes("[General]\nskin_type=1\nskin_name=测试\n")],
    ["1080/phoneSkin.ini", bytes("[General]\nskin_type=1\n")],
    ["1080/keys.ini", bytes("")],
    ["1080/click.mp3", bytes("mp3-bytes")],
    ["1080/font.ttf", bytes("font-bytes")],
    ["1080/py_26.ini", bytes("[KEY1]\nVIEW_RECT=0,0,100,100\n")],
  ])
}

test("搜狗皮肤的音效与字体进模型", async () => {
  const files = ssfFiles()
  const pkg = SsfPackage.fromFiles(files)
  const skeletonArchive = SkinArchive.fromSourceFiles([
    { path: "light/skin/port/py_26.ini", data: bytes("[KEY1]\nVIEW_RECT=0,0,100,100\nCENTER=F13\n") },
  ])
  const skeleton = ssfSkeleton(pkg, skeletonArchive)
  const model = await readWith(ssfFormat, ssfSource(files, skeletonArchive))
  const audio = [...model.resources.values()].find((resource) => resource.kind === "audio")
  const font = [...model.resources.values()].find((resource) => resource.kind === "font")
  assert.ok(audio, "音效没有进模型")
  assert.ok(font, "字体没有进模型")
  assert.equal(new TextDecoder().decode(audio.data), "mp3-bytes")
  assert.equal(new TextDecoder().decode(font.data), "font-bytes")
  assert.ok(skeleton)
})

test("搜狗导出把资源写回包里", async () => {
  const files = ssfFiles()
  const skeletonArchive = SkinArchive.fromSourceFiles([
    { path: "light/skin/port/py_26.ini", data: bytes("[KEY1]\nVIEW_RECT=0,0,100,100\nCENTER=F13\n") },
  ])
  const model = await readWith(ssfFormat, ssfSource(files, skeletonArchive))
  const out = await writeWith(ssfFormat, model)
  assert.equal(new TextDecoder().decode(out.files.get("1080/click.mp3")), "mp3-bytes")
  assert.equal(new TextDecoder().decode(out.files.get("1080/font.ttf")), "font-bytes")
})
