import assert from "node:assert/strict"
import { unzipSync } from "fflate"
import test from "node:test"
import { convertBdaArchive } from "../src/bda-convert.ts"
import { IniDocument } from "../src/ini.ts"
import { parseLegacyAnimation } from "../src/preview-animation.ts"
import { SkinArchive } from "../src/skin.ts"
import { bdaAnimatedSkinBytes, bdsBaseArchive } from "./helpers/bda-animation-fixture.mjs"

const source = () => SkinArchive.open(bdaAnimatedSkinBytes(), "bda")
const convert = (format = "bds") => convertBdaArchive(source(), bdsBaseArchive(), format)
const animationIni = (archive, theme, orientation) => {
  const path = `${theme}/skin/${orientation}/res/anim.ini`
  assert.ok(archive.names().includes(path), `缺少 ${path}`)
  return IniDocument.parse(archive.getText(path))
}
const css = (archive, theme) => IniDocument.parse(archive.getText(`${theme}/skin/res/default.css`))

test("BDA 导出 BDS 时生成 anim.ini，而不是丢弃动效", () => {
  const { archive, warnings } = convert()
  for (const theme of ["light", "dark"]) {
    for (const orientation of ["port", "land"]) {
      const animations = animationIni(archive, theme, orientation)
      assert.ok(Number(animations.get("GLOBAL", "ANIM_NUM")) > 0, `${theme}/${orientation} 没有动画`)
    }
  }
  assert.ok(!warnings.some((warning) => /序列帧动画已降级/.test(warning) && /0 个/.test(warning)))
})

test("动效绑定写回 default.css 的 PRESS_ANIM / SHOW_ANIM / HIDE_ANIM", () => {
  const { archive } = convert()
  const styles = css(archive, "light")
  const animations = animationIni(archive, "light", "port")
  const refs = styles.entries().filter(({ key }) => ["PRESS_ANIM", "SHOW_ANIM", "HIDE_ANIM", "RELEASE_ANIM"].includes(key))
  assert.ok(refs.length >= 3, `只写回了 ${refs.length} 条动效引用`)
  for (const entry of refs) {
    assert.ok(animations.sections().includes(`ANIM${entry.value}`), `${entry.section} 引用了不存在的 ANIM${entry.value}`)
  }
  assert.ok(refs.some(({ key }) => key === "PRESS_ANIM"))
  assert.ok(refs.some(({ key }) => key === "SHOW_ANIM"))
  assert.ok(refs.some(({ key }) => key === "HIDE_ANIM"))
})

test("粒子动效引用新分配的真实图片样式，GIF 资源随包导出", () => {
  const { archive } = convert()
  const styles = css(archive, "light")
  const animations = animationIni(archive, "light", "port")
  const particle = animations.sections().find((section) => animations.get(section, "CATEGORY") === "3")
  assert.ok(particle, "没有粒子动效")
  const image = animations.get(particle, "PARTICLE_IMAGE")
  assert.match(image, /^\d+$/)
  assert.equal(styles.get(`STYLE${image}`, "NM_IMG"), "dot,1")
  const frame = animations.sections().find((section) => animations.get(section, "CATEGORY") === "2")
  assert.ok(frame, "没有帧动效")
  assert.equal(animations.get(frame, "ANIM_PATH"), "spark.gif")
  assert.ok(archive.names().includes("light/skin/port/res/spark.gif"))
  assert.ok(archive.names().includes("light/skin/res/dot.png"))
})

test("生成的旧版动画能被现有预览解析器读回", () => {
  const { archive } = convert()
  const animations = animationIni(archive, "light", "port")
  const parsed = parseLegacyAnimation(css(archive, "light"), animations)
  assert.ok(parsed.size > 0, "旧版预览解析不到任何动效")
  assert.ok([...parsed.values()].some((effect) => effect.particles.length), "缺少粒子动效")

  // 一个样式只放一条动画时，预览解析器要能按 TYPE 还原出对应效果。
  const parsedOne = (section) => {
    const styles = IniDocument.parse(`[GLOBAL]\nSTYLE_NUM=1\n\n[STYLE99]\nSHOW_ANIM=${section}\n`)
    return [...parseLegacyAnimation(styles, animations).values()][0]?.frames[0]
  }
  const sectionOf = (type) => animations.sections().find((section) => animations.get(section, "TYPE") === type)?.replace(/^ANIM/, "")
  assert.equal(parsedOne(sectionOf("0"))?.type, "opacity")
  assert.equal(parsedOne(sectionOf("4"))?.type, "scale")
  assert.equal(parsedOne(sectionOf("2"))?.type, "translate")
  assert.equal(parsedOne(sectionOf("1"))?.type, "rotate")
})

test("导出 BDS 包时 anim.ini 落在皮肤引擎读取的 res 目录", async () => {
  const bytes = await convert().archive.platformBytesAsync("bds")
  const files = unzipSync(bytes)
  assert.ok("light/port/res/anim.ini" in files, "BDS 包缺少 light/port/res/anim.ini")
  const animations = IniDocument.parse(new TextDecoder().decode(files["light/port/res/anim.ini"]))
  assert.ok(Number(animations.get("GLOBAL", "ANIM_NUM")) > 0)
  const styles = IniDocument.parse(new TextDecoder().decode(files["light/res/default.css"]))
  assert.ok(styles.entries().some(({ key, value }) => key === "PRESS_ANIM" && animations.sections().includes(`ANIM${value}`)))
})

test("导出 iOS（BDI）时用区间中点，不写 iOS 不支持的 rand()", () => {
  const { archive } = convert("bdi")
  const animations = animationIni(archive, "light", "port")
  const text = archive.getText("light/skin/port/res/anim.ini")
  assert.ok(!text.includes("rand("), "BDI 动画里不应出现 rand()")
  const alpha = animations.sections().map((section) => section).find((section) => animations.get(section, "TYPE") === "0")
  assert.equal(animations.get(alpha, "FROM"), "20")
  assert.equal(animations.get(alpha, "TO"), "243")
  assert.match(convert("bds").archive.getText("light/skin/port/res/anim.ini"), /rand\(/)
})

test("没有动效的 BDA 转换保持原行为，不生成空 anim.ini", async () => {
  const { readFileSync } = await import("node:fs")
  const template = SkinArchive.open(new Uint8Array(readFileSync(new URL("../public/default-template.bda", import.meta.url))), "bda")
  const { archive, warnings } = convertBdaArchive(template, bdsBaseArchive())
  assert.ok(!archive.names().some((name) => /anim\.ini$/.test(name)))
  assert.ok(!warnings.some((warning) => /anim/.test(warning)))
})
