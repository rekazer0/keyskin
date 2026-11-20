// 手心皮肤夹具：两套主题、横竖布局、一张两片图集、一个音效（两种格式）、两个动画。
//
// 结构与真实样本一致：`default`/`night` 主题下是 `port_layout`/`land_layout`，
// 布局的 `b` 里是键盘，样式与图集在 `s_info`，菜单在主题的 `menu`。
import { strToU8, zipSync } from "fflate"
import { encodePng } from "../../src/raster.ts"

const ATLAS = encodePng({ width: 4, height: 4, data: new Uint8Array(4 * 4 * 4).fill(0x60) })
const SOUND = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0x00, 0x01])

function keyboard() {
  return {
    type: "full26Pinyin",
    board: { b: {}, exact: true },
    input: { b: {} },
    hint: { b: {}, file: "hint1", hint: 0 },
    cand: { b: {}, i_cand: 20 },
    more: { b: {}, file_info: {} },
    top_cand: { b: {} },
    force: [],
    key_fix: { 2: { v: [4, "capslock"], b: { base_b: 12 } } },
    keys: [
      {
        id: "1",
        rect: [[0, 0], [100, 100]],
        hit_rect: [[0, 0], [100, 100]],
        values: [0, "1", 4, "q", 6, "F36"],
        b: { base_b: 10, base_f: [11], base_s: 13, base_ba: 14, base_a: 14, base_o: [1, 2] },
      },
      {
        id: "2",
        rect: [[100, 0], [50, 100]],
        hit_rect: [[100, 0], [1, 1]],
        values: [4, "space"],
        b: {},
      },
    ],
  }
}

function theme() {
  const board = keyboard()
  return {
    port_layout: { b: { full26Pinyin: board }, c: { cand1: {} }, h: { hint1: {} } },
    land_layout: { b: { full26Pinyin: keyboard() }, c: {}, h: {} },
    s_info: {
      ss_1: {
        10: { id: "STYLE10", f: 0, s_2: { normal: "anjian,1", hl: "anjian,2" } },
        11: { id: "STYLE11", f: 0, s_1: { text: "q", c_normal: "030303", c_hl: "FCFCFC", f_s: 22, for_back: false } },
        12: { id: "STYLE12", f: 0, s_2: { normal: "anjian,3", hl: "anjian,3" } },
        13: { id: "STYLE13", f: 0, s_4: { path_1: "click.ogg" } },
        14: { id: "STYLE14", f: 0, s_5: { 1: 100 } },
      },
      ss_2: {
        100: { id: "ANIM100", a1: { b: { t: 4, c: 0, count: 1, back: false, clear: true }, style: 0, from_p: [100, 100], to_p: [90, 90], duration: 40, c_delay: 0 } },
        200: { id: "ANIM200", a3: { a_method: "sequential", animations: [100, 100] } },
      },
      info: {
        anjian: [
          { id: "IMG1", rect1: [[0, 0], [2, 2]], rect2: [[0, 0], [2, 2]], alpha: 1, scales: [1, 1, 1, 1, 1] },
          { id: "IMG2", rect1: [[2, 0], [2, 2]], alpha: 1, scales: [1, 1, 1, 1, 1] },
          { id: "IMG3", rect1: [[0, 2], [2, 2]], alpha: 1, scales: [1, 1, 1, 1, 1] },
        ],
      },
      ss_3: [],
      ss_4: [],
      ss_5: [],
    },
    menu: [
      [{ Name: "1", Position: "menu", Images: { Normal: { Normal: "a.png" }, Theme: { Normal: "a.png" } }, Titles: { Normal: { Normal: "建议", Selected: "建议" } } }],
      [{ Name: "1", Position: "menu", Images: { Normal: { Normal: "a.png" }, Theme: { Normal: "a.png" } }, Titles: { Normal: { Normal: "建议", Selected: "建议" } } }],
    ],
    r_info: ["light/skin/res/anjian.png", "light/skin/res/click.ogg"],
    r_logo: [],
    dir: "",
    i: "",
  }
}

export function sxiFixture() {
  return zipSync({
    "skin.json": strToU8(JSON.stringify({ default: theme(), night: theme(), info: { name: "手心测试" }, root: "" })),
    "info.json": strToU8(JSON.stringify({ name: "手心测试", author: "me", description: "", platform: "a", core_ability: 0 })),
    "native.layout": strToU8(JSON.stringify({ rules: {}, name: "native" })),
    "light/skin/res/anjian.png": ATLAS,
    "light/skin/res/click.ogg": SOUND,
    "light/skin/res/click.aiff": SOUND,
    "dark/skin/res/anjian.png": ATLAS,
  })
}
