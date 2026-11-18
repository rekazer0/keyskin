// BDA 转换器：外观来自 BDA 包，几何来自布局骨架。
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { SkinArchive } from "../src/skin.ts"
import { decodeBdaAppearance } from "../src/bda-decode.ts"
import { bdaFormat, bdaSource } from "../src/skin-model/formats/bda.ts"
import { encodeAppearance } from "../src/skin-model/formats/bda-appearance.ts"
import { detectFormat, openSkin } from "../src/skin-model/formats/index.ts"

function archives() {
  const bda = SkinArchive.open(new Uint8Array(readFileSync(new URL("../public/default-template.bda", import.meta.url))), "bda")
  const base = SkinArchive.open(new Uint8Array(readFileSync(new URL("../public/bda-base.bds", import.meta.url))))
  return { bda, base }
}

test("BDA 包按外观配置识别", () => {
  const { bda } = archives()
  assert.equal(detectFormat(bda), "bda")
})

test("BDA 读成多块板，样式与图片来自外观", async () => {
  const { bda, base } = archives()
  const source = bdaSource(bda, base)
  assert.ok(source)
  const model = await bdaFormat.read(source)
  assert.ok(model.boards.length > 1, "只读到一块板")
  assert.equal(model.boards[0].kind, "main")
  assert.ok(model.boards[0].keys.length > 0)
  assert.ok(model.styles.size > 0, "外观样式没有读出来")
  assert.ok(model.images.size > 0, "外观图片没有切出来")
  assert.ok([...model.styles.keys()].every((name) => name.startsWith("bda:")))
})

test("键按键是板种类的三者之一", async () => {
  const { bda, base } = archives()
  const model = await bdaFormat.read(bdaSource(bda, base))
  const kinds = new Set(["main", "number", "symbol", "candidate", "other"])
  for (const board of model.boards) assert.ok(kinds.has(board.kind), `未知板种类 ${board.kind}`)
})

test("缺少布局骨架时明确失败", async () => {
  const { bda } = archives()
  const source = bdaSource(bda)
  assert.ok(source)
  await assert.rejects(() => bdaFormat.read(source), /布局骨架/)
})

test("统一入口也能打开 BDA", async () => {
  const { bda, base } = archives()
  const opened = await openSkin(bda, { base })
  assert.ok(opened)
  assert.equal(opened.format, "bda")
  assert.ok(opened.model.boards.length > 1)
})

test("外观配置编码后能原样解回", async () => {
  const { bda } = archives()
  const bytes = bda.getBytes("light/skin/port/appearanceConfig")
  assert.ok(bytes)
  const before = decodeBdaAppearance(bytes)
  const after = decodeBdaAppearance(encodeAppearance(before))
  assert.equal(after.imageStyles.size, before.imageStyles.size)
  assert.equal(after.textStyles.size, before.textStyles.size)
  assert.equal(after.colorStyles.size, before.colorStyles.size)
  assert.equal(after.panels.size, before.panels.size)
  assert.equal(after.designWidth, before.designWidth)
  const firstKey = [...before.panels.keys()][0]
  assert.deepEqual(
    [...after.panels.get(firstKey).keys.keys()].sort(),
    [...before.panels.get(firstKey).keys.keys()].sort(),
  )
  // 存在但为空的嵌套消息不能丢
  for (const [name, panel] of before.panels) {
    assert.equal(after.panels.get(name).cand === undefined, panel.cand === undefined, `${name} 的候选栏存在性变了`)
    assert.equal(after.panels.get(name).more === undefined, panel.more === undefined, `${name} 的更多面板存在性变了`)
  }
})

test("写回后在原包上重读，样式与图片数量不变", async () => {
  const { bda, base } = archives()
  const source = bdaSource(bda, base)
  const model = await bdaFormat.read(source)
  const again = await bdaFormat.read(bdaFormat.write(model, source))
  assert.equal(again.styles.size, model.styles.size)
  assert.equal(again.images.size, model.images.size)
  assert.equal(again.boards.length, model.boards.length)
  assert.equal(again.boards[0].keys.length, model.boards[0].keys.length)
})

test("没有原包时也能重建整套外观与图片", async () => {
  const { bda, base } = archives()
  const model = await bdaFormat.read(bdaSource(bda, base))
  const rebuilt = bdaFormat.write(model)
  const again = await bdaFormat.read(bdaSource(rebuilt.archive, base))
  assert.equal(again.boards.length, model.boards.length)
  assert.equal(again.styles.size, model.styles.size)
  assert.equal(again.images.size, model.images.size)
})
