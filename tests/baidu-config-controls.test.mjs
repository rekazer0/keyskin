import assert from "node:assert/strict"
import test from "node:test"
import { baiduConfigControl, baiduConfigSumParts, baiduConfigTokens } from "../src/baidu-config-controls.ts"

test("百度配置按语义选择控件，不把多选列表当成开关", () => {
  for (const key of ["NO_BLUR", "FONT_CLEARTYPE"]) assert.equal(baiduConfigControl("STYLE1", key).kind, "switch")
  assert.deepEqual(baiduConfigControl("", "SkinType"), { kind: "switch", on: "0", off: "1", defaultValue: "0" })
  assert.equal(baiduConfigControl("", "SupportPatch").separator, "|")
  assert.equal(baiduConfigControl("", "Abilities").separator, ",")
  assert.equal(baiduConfigControl("", "SupportPlatform").separator, "")
  assert.equal(baiduConfigControl("LIST1", "LIST_ORDER").options.length, 2, "两项枚举由 field() 自动画成分段")
  assert.equal(baiduConfigControl("ICON1", "PERSIST").options.length, 4)
  assert.equal(baiduConfigControl("", "MinImeCode").layout, "select", "长选项强制下拉")
})

test("anim.ini 的开关与枚举在三种格式下同名同控件", () => {
  for (const key of ["REPEAT_MODE", "REMOVE", "FINISH_AFTER_PRACTICES", "REMOVE_INCLUDE_PRACTICES"]) assert.equal(baiduConfigControl("ANIM3", key).kind, "switch")
  assert.deepEqual(baiduConfigControl("ANIM3", "BUILD_METHOD").options.map(([, label]) => label), ["同时", "接续"])
  assert.equal(baiduConfigControl("ANIM3", "EMIT_TYPE").kind, "choice")
  assert.equal(baiduConfigControl("ANIM3", "NO_BLUR"), undefined, "动画段只认动画键")
  assert.equal(baiduConfigControl("GLOBAL", "VERSION").kind, "switch")
})

test("颜色键只有值是色值时才用色块", () => {
  assert.equal(baiduConfigControl("STYLE1", "NM_COLOR", "80123456").kind, "color")
  assert.equal(baiduConfigControl("STYLE1", "HL_COLOR", "").kind, "color")
  assert.equal(baiduConfigControl("STYLE1", "NM_COLOR", "STYLE3"), undefined)
})

test("同名 TYPE 和 ANCHOR_TYPE 按分区解释，未知语义不猜测", () => {
  assert.equal(baiduConfigControl("BAR", "ANCHOR_TYPE").options.length, 2)
  assert.deepEqual(baiduConfigControl("ICON3", "ANCHOR_TYPE"), { kind: "text" }, "图标锚点使用普通输入框，保留原始数值")
  const list = baiduConfigControl("LIST2", "TYPE")
  assert.deepEqual(list.parts.map(({ label }) => label), ["位置", "时机"])
  assert.deepEqual(["0", "1", "2", "3"].map((value) => baiduConfigSumParts(list, value)), [["0", "0"], ["0", "1"], ["2", "0"], ["2", "1"]], "位置 × 时机，编码不变")
  assert.deepEqual(baiduConfigSumParts(list, ""), ["", ""])
  assert.equal(baiduConfigSumParts(list, "7"), undefined, "未知值不拆")
  assert.equal(baiduConfigControl("BAR", "TYPE").options.length, 2)
  assert.equal(baiduConfigControl("PANEL", "TYPE"), undefined)
  assert.equal(baiduConfigControl("GLOBAL", "Unknown"), undefined)
})

test("列表保留扩展值及顺序，空值读取默认支持范围", () => {
  assert.deepEqual(baiduConfigTokens(" Sound , Custom, Animation ", ","), ["Sound", "Custom", "Animation"])
  assert.deepEqual(baiduConfigTokens("", "", "SWIA"), ["S", "W", "I", "A"])
  assert.deepEqual(baiduConfigTokens("Accessory|Custom", "|"), ["Accessory", "Custom"])
  assert.deepEqual(baiduConfigTokens("", ","), [])
})
