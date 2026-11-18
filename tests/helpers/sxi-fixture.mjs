// 手心皮肤夹具：skin.json 里一个两键键盘，info.json 里元信息，外加一张图标。
import { strToU8, zipSync } from "fflate"
import { encodePng } from "../../src/raster.ts"

const PNG = encodePng({ width: 4, height: 4, data: new Uint8Array(64).fill(0x60) })

export function sxiFixture() {
  const skin = {
    default: {
      keyboard: {
        board: { size: [0, 0, 1080, 600], i_b: 3, exact: true },
        keys: [
          { id: 1, rect: [[0, 0], [540, 300]], i_b: 10, i_f: 11, values: [4, "q", 0, "1"] },
          { id: 2, rect: [[540, 0], [540, 300]], i_b: 10, values: [4, "F31"] },
        ],
        cand: { i_cand: 20, i_cell: 21 },
        hint: { i_b: 30, rect: [[10, 20], [100, 40]] },
        logo: { file: "logo.png" },
      },
    },
  }
  return zipSync({
    "skin.json": strToU8(JSON.stringify(skin)),
    "info.json": strToU8(JSON.stringify({ name: "手心测试", author: "me", version: "1" })),
    "light/skin/logo.png": PNG,
  })
}
