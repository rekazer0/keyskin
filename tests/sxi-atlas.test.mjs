// 手心图集：`info` 的切片表加同名 PNG，切成独立图片进资源表。
import assert from "node:assert/strict"
import test from "node:test"
import { encodePng } from "../src/raster.ts"
import { atlasImagesOf } from "../src/skin-model/formats/sxi-atlas.ts"

function atlasPng(width, height) {
  return encodePng({ width, height, data: new Uint8Array(width * height * 4).fill(0x70) })
}

function skinWithInfo(tiles) {
  return { default: { light: { s_info: { info: { "light/skin/res/atlas": tiles } } } } }
}

test("按切片表把图集切成独立图片", () => {
  const files = new Map([["light/skin/res/atlas.png", atlasPng(20, 10)]])
  const result = atlasImagesOf(skinWithInfo([
    { id: "IMG0", rect1: [0, 0, 10, 10] },
    { id: "IMG1", rect1: [10, 0, 10, 10] },
  ]), files, "light", "port")
  assert.deepEqual(result.atlases, ["light/skin/res/atlas"])
  assert.equal(result.images.size, 2)
  const first = result.images.get("light/skin/res/atlas#0")
  assert.equal(first.width, 10)
  assert.equal(first.height, 10)
  assert.deepEqual(result.missing, [])
})

test("图集文件缺失时记下来，不假装切好", () => {
  const result = atlasImagesOf(skinWithInfo([{ id: "IMG0", rect1: [0, 0, 4, 4] }]), new Map(), "light", "port")
  assert.equal(result.images.size, 0)
  assert.deepEqual(result.missing, ["light/skin/res/atlas"])
})

test("超出图集范围的切片被丢掉", () => {
  const files = new Map([["light/skin/res/atlas.png", atlasPng(8, 8)]])
  const result = atlasImagesOf(skinWithInfo([
    { id: "IMG0", rect1: [0, 0, 8, 8] },
    { id: "IMG1", rect1: [4, 4, 20, 20] },
  ]), files, "light", "port")
  assert.equal(result.images.size, 1)
})

test("没有切片表时什么也不做", () => {
  const result = atlasImagesOf({ default: { light: { s_info: {} } } }, new Map(), "light", "port")
  assert.equal(result.images.size, 0)
  assert.deepEqual(result.atlases, [])
})
