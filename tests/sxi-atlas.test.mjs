// 手心图集：`s_info.info` 的切片表加同名 PNG，切成独立图片进资源表；
// `a_i` 是无组名的第二张切片表。
import assert from "node:assert/strict"
import test from "node:test"
import { encodePng } from "../src/raster.ts"
import { atlasesOfTheme, atlasesJson } from "../src/skin-model/formats/sxi/atlas.ts"

function atlasPng(width, height) {
  return encodePng({ width, height, data: new Uint8Array(width * height * 4).fill(0x70) })
}

test("按切片表把图集切成独立图片，并给出切片引用", () => {
  const files = new Map([["light/skin/res/atlas.png", atlasPng(20, 10)]])
  const result = atlasesOfTheme({
    atlas: [
      { id: "IMG1", rect1: [[0, 0], [10, 10]] },
      { id: "IMG2", rect1: [[10, 0], [10, 10]] },
    ],
  }, [], "light", files)
  assert.equal(result.atlases.length, 1)
  assert.equal(result.atlases[0].source, "light/skin/res/atlas.png")
  assert.equal(result.images.size, 3)
  assert.equal(result.lookup("atlas", "1"), "sxi:light:atlas#IMG1")
  assert.equal(result.images.get("sxi:light:atlas#IMG1").width, 10)
})

test("图集文件缺失时只保留切片表，不假装切好", () => {
  const result = atlasesOfTheme({ atlas: [{ id: "IMG1", rect1: [[0, 0], [4, 4]] }] }, [], "light", new Map())
  assert.equal(result.images.size, 0)
  assert.equal(result.atlases[0].source, "")
  assert.equal(result.lookup("atlas", "1"), undefined)
})

test("超出图集范围的切片被丢掉，切片表仍然保留", () => {
  const files = new Map([["light/skin/res/atlas.png", atlasPng(8, 8)]])
  const result = atlasesOfTheme({
    atlas: [
      { id: "IMG1", rect1: [[0, 0], [8, 8]] },
      { id: "IMG2", rect1: [[4, 4], [20, 20]] },
    ],
  }, [], "light", files)
  assert.equal(result.images.size, 2)
  assert.equal(result.atlases[0].slices.length, 2)
})

test("a_i 是无组名的第二张切片表", () => {
  const result = atlasesOfTheme({}, [{ id: "IMG1", rect1: [[0, 0], [4, 4]], alpha: 1, scales: [] }], "light", new Map())
  assert.equal(result.atlases.length, 1)
  assert.equal(result.atlases[0].name, "a_i")
  assert.equal(result.atlases[0].slices[0].id, "IMG1")
})

test("rect2 与 scales 进切片的 extra，写回按原值吐出", () => {
  const result = atlasesOfTheme({
    atlas: [{ id: "IMG1", rect1: [[0, 0], [8, 8]], rect2: [[2, 2], [4, 4]], alpha: 1, scales: [1, 2, 1, 1, 1] }],
  }, [], "light", new Map([["light/skin/res/atlas.png", atlasPng(8, 8)]]))
  const slice = result.atlases[0].slices[0]
  assert.deepEqual(slice.extra.get("rect2"), [[2, 2], [4, 4]])
  assert.deepEqual(slice.extra.get("scales"), [1, 2, 1, 1, 1])
  const table = atlasesJson(result.atlases)
  assert.deepEqual(table.info.atlas[0].rect2, [[2, 2], [4, 4]])
  assert.deepEqual(table.info.atlas[0].scales, [1, 2, 1, 1, 1])
})

test("没有切片表时什么也不做", () => {
  const result = atlasesOfTheme({}, [], "light", new Map())
  assert.equal(result.atlases.length, 0)
  assert.equal(result.images.size, 0)
})
