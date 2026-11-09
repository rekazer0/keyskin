import assert from "node:assert/strict"
import test from "node:test"
import { IniDocument } from "../src/ini.ts"
import { baiduInspectorEntries, baiduInspectorTuple } from "../src/baidu-inspector-fields.ts"

test("Baidu inspector exposes supported fields of empty sections without changing source", () => {
  const source = "[PANEL]\nSIZE=1/3,2/3\n[LIST]\n[ICON1]\nKEY=F14\n[SWITCH]\n[EXTRA]\nCUSTOM=keep\n"
  const document = IniDocument.parse(source)
  const entries = baiduInspectorEntries(document, "port/sparse.ini")
  for (const [section, keys] of [
    ["PANEL", ["BACK_STYLE", "FORE_STYLE", "ANIM_STYLE", "NO_BLUR"]],
    ["LIST", ["POS", "CELL_SIZE", "LIST_ORDER", "LIST_NUM", "NAMES", "VALUES"]],
    ["ICON1", ["POS", "SIZE", "PERSIST", "ANCHOR_TYPE"]],
    ["SWITCH", ["NML_BACK_STYLE", "SEL_FONT_STYLE"]],
  ]) {
    for (const key of keys) assert.equal(entries.find((entry) => entry.section === section && entry.key === key)?.value, "", `${section}.${key}`)
  }
  assert.equal(entries.filter(({ section, key }) => section === "PANEL" && key === "SIZE").length, 1)
  assert.equal(entries.find(({ section, key }) => section === "PANEL" && key === "SIZE").value, "1/3,2/3")
  assert.deepEqual(entries.filter(({ section }) => section === "EXTRA"), [{ section: "EXTRA", key: "CUSTOM", value: "keep" }])
  assert.equal(document.toString(), source)
})

test("new candidate, input, global list and bubble configurations are discoverable", () => {
  for (const [path, expected] of [
    ["port/gen.ini", ["PANEL", "INPUT", "CAND", "SCAND", "HINT", "MORE", "LIST", "LOGO", "EMOJI", "GLOBAL"]],
    ["port/py_26.ini", ["PANEL", "INPUT", "CAND", "SCAND", "HINT", "MORE", "LIST", "LOGO", "EMOJI", "GLOBAL"]],
    ["port/cand.cnd", ["CAND", "INPUT", "SWITCH"]],
    ["port/hint.pop", ["HINT", "BAR"]],
  ]) {
    const document = IniDocument.parse("")
    const entries = baiduInspectorEntries(document, path)
    assert.deepEqual([...new Set(entries.map(({ section }) => section))], expected)
    assert.equal(document.toString(), "")
  }
  assert.deepEqual(baiduInspectorEntries(IniDocument.parse(""), "res/default.css"), [])
})

test("the whole layout lists only this layout's own sections", () => {
  const source = "[PANEL]\nSIZE=1080,642\nKEY_NUM=17\n[KEY1]\nCENTER=a\n[LIST]\nPOS=6,5\n[CAND]\nTYPE=4\n[INPUT]\nPOS=1,2\n"
  const document = IniDocument.parse(source)
  const entries = baiduInspectorEntries(document, "port/py_9.ini", true)
  // 候选栏、输入区由候选栏文件提供；更多面板等各有自己的入口，不在整体布局里重复。
  assert.deepEqual([...new Set(entries.map(({ section }) => section))].filter((section) => !/^KEY\d+$/.test(section)), ["PANEL", "LIST"])
  // 面板与列表里缺的项照常列出，查看不写文件。
  assert.ok(entries.some(({ section, key }) => section === "PANEL" && key === "BACK_ANIM_STYLE"))
  assert.ok(entries.some(({ section, key }) => section === "LIST" && key === "CELL_SIZE"))
  assert.equal(document.toString(), source)
  // 没有列表的 26 键布局不硬造一个列表分组。
  const keysOnly = baiduInspectorEntries(IniDocument.parse("[PANEL]\nSIZE=1,2\n[KEY1]\nCENTER=a\n"), "port/py_26.ini", true)
  assert.deepEqual([...new Set(keysOnly.map(({ section }) => section))].filter((section) => !/^KEY\d+$/.test(section)), ["PANEL"])
})

test("new geometry tuples are valid after the first component is edited", () => {
  assert.equal(baiduInspectorTuple(["", "15"]), "0,15")
  assert.equal(baiduInspectorTuple(["", "", "12", ""]), "0,0,12,0")
  assert.equal(baiduInspectorTuple(["", "", "", ""]), "")
  assert.equal(baiduInspectorTuple(["1.5", "-4"]), "1.5,-4")
})
