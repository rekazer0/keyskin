// 布局切换：从归档里认出可切换的布局，并换算成可选的完整路径。
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { SkinArchive } from "../src/skin.ts"
import { layoutChoices, layoutLabel, layoutPathOf } from "../src/app/layout-switch.ts"

/** 只读文件名列表，够 layoutChoices 用。 */
function source(names) {
  return { names: () => names }
}

test("只列同方向的布局，并给出可读名字", () => {
  const names = [
    "light/skin/port/py_26.ini",
    "light/skin/port/py_9.ini",
    "light/skin/port/sym.ini",
    "light/skin/port/gen.ini",
    "light/skin/land/py_26.ini",
    "light/skin/port/background.png",
  ]
  const choices = layoutChoices(source(names), "light/skin/port/py_26.ini")
  assert.deepEqual(choices.map((choice) => choice.name), ["py_26.ini", "py_9.ini", "sym.ini"],
    "横屏布局、gen.ini 与图片都不该出现")
  assert.deepEqual(choices.map((choice) => choice.label), ["26 键", "9 键", "符号"])
})

test("没有归档时没有可切换布局", () => {
  assert.deepEqual(layoutChoices(undefined, "light/skin/port/py_26.ini"), [])
})

test("布局文件名换成同目录下的完整路径", () => {
  assert.equal(layoutPathOf("light/skin/port/py_26.ini", "py_9.ini"), "light/skin/port/py_9.ini")
})

test("没有目录时不硬拼路径", () => {
  assert.equal(layoutPathOf("py_26.ini", "py_9.ini"), undefined, "没有目录就不猜")
})

test("没登记过的板名退回文件名", () => {
  assert.equal(layoutLabel("unknown_board"), "unknown_board")
  assert.equal(layoutLabel("py_31"), "31 键")
})

test("真实归档里能列出布局", () => {
  const archive = SkinArchive.open(new Uint8Array(readFileSync("public/bda-base.bds")))
  assert.ok(archive.names().length > 0, "归档应当能列出文件名")
})
