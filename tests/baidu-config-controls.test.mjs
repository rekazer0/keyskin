import assert from "node:assert/strict"
import test from "node:test"
import { baiduConfigControl, baiduConfigTokens } from "../src/baidu-config-controls.ts"

test("百度配置按语义选择控件，不把多选列表当成开关", () => {
  for (const key of ["NO_BLUR", "FONT_CLEARTYPE"]) assert.equal(baiduConfigControl("STYLE1", key).kind, "switch")
  assert.deepEqual(baiduConfigControl("", "SkinType"), { kind: "switch", on: "0", off: "1", defaultValue: "0" })
  assert.equal(baiduConfigControl("", "SupportPatch").separator, "|")
  assert.equal(baiduConfigControl("", "Abilities").separator, ",")
  assert.equal(baiduConfigControl("", "SupportPlatform").separator, "")
  assert.equal(baiduConfigControl("LIST1", "LIST_ORDER").segmented, true)
  assert.equal(baiduConfigControl("ICON1", "PERSIST").options.length, 4)
})

test("同名 TYPE 和 ANCHOR_TYPE 按分区解释，未知语义不猜测", () => {
  assert.equal(baiduConfigControl("BAR", "ANCHOR_TYPE").options.length, 2)
  assert.equal(baiduConfigControl("ICON3", "ANCHOR_TYPE").options.length, 9)
  assert.equal(baiduConfigControl("LIST2", "TYPE").options.length, 4)
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
