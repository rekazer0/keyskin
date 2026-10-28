import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate"
import { SkinArchive } from "../src/skin.ts"
import { buildSxiZip } from "../src/palm/palm-export.ts"
import { convertSxiToBaidu, convertSxiToBda, sxiToBaiduArchive } from "../src/palm/sxi-to-baidu.ts"
import { canExport } from "../src/export.ts"
import { IniDocument } from "../src/ini.ts"
import { parseXmlPlist } from "../src/palm/palm-plist.ts"
import { bdsFixture } from "./helpers/baidu-fixture.mjs"

function sxi() {
  return SkinArchive.open(buildSxiZip(SkinArchive.open(bdsFixture())).bytes, "sxi")
}

test("an .sxi exports to BDI, BDS and BDA; SSF stays unreachable", () => {
  assert.ok(canExport("sxi", "bdi"))
  assert.ok(canExport("sxi", "bds"))
  assert.ok(canExport("sxi", "bda"))
  assert.ok(canExport("sxi", "sxi"))
  assert.ok(!canExport("sxi", "ssf"))
  assert.ok(canExport("bds", "sxi"))
})

test("an .sxi becomes a BDS package with the same layouts, styles and resources", async () => {
  const archive = sxi()
  const converted = sxiToBaiduArchive(archive)
  assert.equal(converted.format, "bds")
  for (const path of ["light/skin/port/py_26.ini", "light/skin/port/gen.ini", "light/skin/port/cand1.cnd", "light/skin/res/default.css", "light/skin/res/list_cell.png", "light/skin/res/list_cell.til"]) {
    assert.ok(converted.names().includes(path), path)
  }
  const keyboard = IniDocument.parse(converted.getText("light/skin/port/py_26.ini"))
  assert.equal(keyboard.get("PANEL", "KEY_NUM"), "2")
  assert.equal(keyboard.get("PANEL", "TIP_NUM"), "1")
  const gen = IniDocument.parse(converted.getText("light/skin/port/gen.ini"))
  assert.equal(gen.get("MORE", "SYM_LAYOUT"), "symbol")
  // The list cell background the source BDS designed keeps its style, tile map and image.
  assert.equal(gen.get("LIST", "CELL_STYLE"), "120")
  const styles = IniDocument.parse(converted.getText("light/skin/res/default.css"))
  assert.equal(styles.get("STYLE120", "NM_IMG"), "list_cell,1")
  assert.equal(styles.get("STYLE120", "HL_IMG"), "list_cell,0")

  const bytes = await converted.platformBytesAsync("bds")
  const reopened = SkinArchive.open(bytes, "bds")
  assert.equal(reopened.getText("Info.txt").includes("SupportPlatform=A"), true)
  assert.equal(reopened.getText("Info.txt").includes("Name=测试皮肤"), true)
})

test("an .sxi exports to BDI as an iOS package", async () => {
  const { bytes, warnings } = await convertSxiToBaidu(sxi(), "bdi")
  assert.deepEqual(warnings, [])
  const reopened = SkinArchive.open(bytes, "bdi")
  assert.equal(reopened.format, "bdi")
  assert.equal(reopened.getText("Info.txt").includes("SupportPlatform=I"), true)
  assert.ok(reopened.names().includes("light/skin/port/py_26.ini"))
})

test("an .sxi exports to BDA on the official template", async () => {
  const template = SkinArchive.open(new Uint8Array(readFileSync(new URL("../public/default-template.bda", import.meta.url))), "bda")
  const { bytes, warnings } = await convertSxiToBda(sxi(), template)
  assert.deepEqual(warnings, ["百度按键动画在搜狗皮肤中没有对应，已忽略"])
  const reopened = SkinArchive.open(bytes, "bda")
  assert.equal(reopened.format, "bda")
  assert.ok(reopened.names().some((path) => /appearanceConfig$/.test(path)))
})

test("an .sxi keeps the toolbar plist and menu atlas the export folds into skin.json", () => {
  const files = unzipSync(bdsFixture())
  const toolbar = `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><array><dict><key>Position</key><string>toolbar</string><key>Name</key><string>23</string><key>Titles</key><dict><key>Normal</key><dict><key>Normal</key><string>语音&amp;输入</string><key>Selected</key><string>语音</string></dict></dict><key>Images</key><dict><key>Normal</key><dict><key>Normal</key><string>lg/yuyin</string></dict><key>Theme</key><dict><key>Normal</key><string>lg/yuyin</string></dict></dict></dict></array></plist>`
  files["light/res/logo/com.baidu.inputmethod.toolbarMenuItems.plist"] = strToU8(toolbar)
  files["light/res/logo/lg/yuyin_iphone@3x.png"] = files["light/res/btn.png"]
  files["light/res/logo/pop_menu_icons.til"] = strToU8("[IMG26]\nSOURCE_RECT=0,0,2,2\n")
  files["light/res/logo/pop_menu_icons.png"] = files["light/res/btn.png"]
  const archive = SkinArchive.open(buildSxiZip(SkinArchive.open(zipSync(files))).bytes, "sxi")
  const plistPath = "light/skin/res/logo/com.baidu.inputmethod.toolbarMenuItems.plist"
  // The .sxi keeps them in skin.json only; the Baidu export writes them out as files again.
  const skin = JSON.parse(archive.getText("skin.json")).default
  assert.equal(skin.menu.flat().find((item) => item.Position === "toolbar").Titles.Normal.Normal, "语音&输入")
  assert.deepEqual(skin.a_m.find((tile) => tile.id === "IMG26").rect1, [[0, 0], [2, 2]])
  assert.equal(archive.getBytes(plistPath), undefined)
  const baidu = sxiToBaiduArchive(archive)
  const [item] = parseXmlPlist(baidu.getBytes(plistPath))
  assert.equal(item.Position, "toolbar")
  assert.equal(item.Titles.Normal.Normal, "语音&输入")
  assert.equal(item.Images.Normal.Normal, "lg/yuyin")
  assert.equal(IniDocument.parse(baidu.getText("light/skin/res/logo/pop_menu_icons.til")).get("IMG26", "SOURCE_RECT"), "0,0,2,2")
})
