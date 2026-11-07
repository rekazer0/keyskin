import { test } from "node:test"
import assert from "node:assert/strict"
import { strToU8, zipSync } from "fflate"
import { IniDocument } from "../src/ini.ts"
import { SkinArchive } from "../src/skin.ts"
import { buildSxiZip } from "../src/palm/palm-export.ts"
import { parseSkinJson } from "../src/palm/sxi-json.ts"
import { animationsIni } from "../src/palm/sxi-style.ts"
import { convertSxiToBaidu } from "../src/palm/sxi-to-baidu.ts"
import { boardIni } from "../src/palm/sxi-layout.ts"
import { animationGroups } from "../src/palm/sxi-animation.ts"

test("Baidu layout and animation data survive a Palm round trip where both formats support it", () => {
  const source = SkinArchive.open(zipSync({
    "Info.txt": strToU8("Name=conversion test\n"),
    "light/port/gen.ini": strToU8("[PANEL]\nSIZE=500,300\n[MORE]\nGRID=5,4\nLAYOUT_NAME=sel_ch\nSYM_LAYOUT=custom_symbols\n"),
    "light/port/py_26.ini": strToU8([
      "[PANEL]", "SIZE=500,300", "[KEY1]", "VIEW_RECT=0,0,100,100",
      "FORE_STYLE=3,3", "POS_TYPE=0,2", "CENTER=q",
    ].join("\n")),
    "light/res/anim.ini": strToU8([
      "[GLOBAL]", "ANIM_NUM=5", "CUSTOM_META=keep-me",
      "[ANIM1]", "CATEGORY=1", "BUILD_NUM=2", "BUILD_LIST=4,4", "BUILD_METHOD=0",
      "[ANIM2]", "ANIM_PATH=frames.gif",
      "[ANIM3]", "CATEGORY=2", "SOURCE_FILE=legacy-frames.gif",
      "[ANIM4]", "TYPE=0", "PARTICLE_IMAGE=8", "EMIT_TYPE=1", "TOTAL_NUMBER=2",
      "[ANIM5]", "CATEGORY=0", "TYPE=0", "FROM=rand(0,1)", "TO=255",
      "[PATH1]", "MOVE_TO_POINT=0,0", "LINE_TO_POINT=0.2,0.2",
    ].join("\n")),
  }), "bds")

  const converted = buildSxiZip(source)
  assert.ok(converted.warnings.some((warning) => warning.includes("ANIM5 的 FROM")))
  assert.ok(converted.warnings.some((warning) => warning.includes("[GLOBAL] 的 CUSTOM_META")))
  const palm = SkinArchive.open(converted.bytes, "sxi")
  const skin = parseSkinJson(palm.getText("skin.json"))
  const key = skin.default.port_layout.b.full26Pinyin.keys[0]
  assert.deepEqual(key.b.base_f, [3, 3])
  assert.deepEqual(key.b.base_o, [0, 2])
  const more = skin.default.port_layout.b.defaultGlobal.more
  assert.equal(more.sym_layout, "custom_symbols")
  assert.match(boardIni(skin.default.port_layout.b.defaultGlobal).toString(), /SYM_LAYOUT=custom_symbols/)
  assert.equal(skin.default.s_info.ss_2["4"].a4.b.c, 3, "missing CATEGORY is inferred from PARTICLE_IMAGE")
  assert.equal(skin.default.s_info.ss_2["4"].a4.emit_type, 1)
  assert.equal(skin.default.s_info.ss_2["2"].af2.b.c, 2, "missing CATEGORY is inferred from ANIM_PATH")
  assert.ok(animationGroups("a4", skin.default.s_info.ss_2["4"].a4)
    .flatMap((group) => group.fields).some((field) => field.key === "emit_type" && field.options?.length === 2))

  const animations = IniDocument.parse(animationsIni(skin.default.s_info.ss_2, skin.default.s_info.ss_2_paths).toString())
  assert.equal(animations.get("GLOBAL", "ANIM_NUM"), "5")
  assert.equal(animations.get("ANIM1", "BUILD_NUM"), "2")
  assert.equal(animations.get("ANIM1", "BUILD_LIST"), "4,4")
  assert.equal(animations.get("ANIM2", "ANIM_PATH"), "frames.gif")
  assert.equal(animations.get("ANIM3", "ANIM_PATH"), "legacy-frames.gif")
  assert.equal(animations.get("ANIM3", "SOURCE_FILE"), undefined)
  assert.equal(animations.get("ANIM4", "CATEGORY"), "3")
  assert.equal(animations.get("ANIM4", "EMIT_TYPE"), "1")
  assert.equal(animations.get("PATH1", "LINE_TO_POINT"), "0.2,0.2")
})

test("Palm animation fields that the Baidu writer skips are reported", async () => {
  const source = SkinArchive.open(zipSync({
    "Info.txt": strToU8("Name=conversion test\n"),
    "light/port/gen.ini": strToU8("[PANEL]\nSIZE=500,300\n"),
    "light/res/anim.ini": strToU8("[ANIM1]\nCATEGORY=0\nTYPE=0\nDURATION=200\n"),
  }), "bds")
  const archive = SkinArchive.open(buildSxiZip(source).bytes, "sxi")
  const skin = parseSkinJson(archive.getText("skin.json"))
  skin.default.s_info.ss_2["80"] = {
    id: "ANIM80",
    a1: { b: { t: 0, c: 0 }, duration: 100, palm_extra: true },
  }
  skin.default.s_info.ss_2["81"] = { id: "ANIM81", a15: { custom: 1 } }
  archive.setText("skin.json", JSON.stringify(skin))

  const converted = await convertSxiToBaidu(archive, "bds")
  assert.ok(converted.warnings.some((warning) => warning.includes("a1.palm_extra 未映射到 百度")))
  assert.ok(converted.warnings.some((warning) => warning.includes("a15 未映射到 百度")))
})
