// 百度系路径规则：布局判断、方向、主题与板名。
import assert from "node:assert/strict"
import test from "node:test"
import { appearanceOf, bdsBoardName, bdsDirectory, isBdsLayoutPath, orientationOf } from "../src/skin-model/board-paths.ts"

test("布局路径判断排除面板专用文件", () => {
  assert.equal(isBdsLayoutPath("light/skin/port/py_26.ini"), true)
  assert.equal(isBdsLayoutPath("dark/skin/land/en_26.ini"), true)
  assert.equal(isBdsLayoutPath("light/skin/port/gen.ini"), false, "gen.ini 是配置不是布局")
  assert.equal(isBdsLayoutPath("light/skin/port/res/default.css"), false)
  assert.equal(isBdsLayoutPath("light/skin/port/py_26.til"), false)
})

test("方向与主题从路径读出", () => {
  assert.equal(orientationOf("light/skin/land/py_26.ini"), "land")
  assert.equal(orientationOf("dark/skin/port/py_26.ini"), "port")
  assert.equal(orientationOf("light/skin/res/x.png"), undefined)
  assert.equal(appearanceOf("dark/skin/port/py_26.ini"), "dark")
  assert.equal(appearanceOf("skin/port/py_26.ini"), undefined)
})

test("板名取自布局文件名", () => {
  assert.equal(bdsBoardName("light/skin/port/py_26.ini"), "py_26")
  assert.equal(bdsBoardName("light/skin/port/9.ini"), "9")
  assert.equal(bdsBoardName("light/skin/res/x.png"), undefined)
})

test("目录拼接带尾斜杠", () => {
  assert.equal(bdsDirectory("light", "port"), "light/skin/port/")
})
