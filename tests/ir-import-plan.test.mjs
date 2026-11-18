// 提示键与导入计划：把散在打开流程里的准备动作收成一份计划。
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { SkinArchive } from "../src/skin.ts"
import { missingAssets, planImport } from "../src/app/import-plan.ts"

function bdsArchive() {
  return SkinArchive.open(new Uint8Array(readFileSync(new URL("../public/bda-base.bds", import.meta.url))), "bds")
}

function bdaArchive() {
  return SkinArchive.open(new Uint8Array(readFileSync(new URL("../public/default-template.bda", import.meta.url))), "bda")
}

test("BDA 打开前要准备官方基础布局", () => {
  const plan = planImport(bdaArchive())
  assert.equal(plan.basis, "bda-base")
  assert.deepEqual(missingAssets(plan, { hasBdaBase: false, hasSsfTemplates: false }), ["bda-base"])
  assert.deepEqual(missingAssets(plan, { hasBdaBase: true, hasSsfTemplates: false }), [])
})

test("百度皮肤不需要额外基础", () => {
  const plan = planImport(bdsArchive())
  assert.equal(plan.basis, "none")
  assert.deepEqual(missingAssets(plan, { hasBdaBase: false, hasSsfTemplates: false }), [])
  assert.equal(plan.preview, "none")
})

test("手心皮肤要解析自己的原生文档，但没有外部依赖", () => {
  const plan = planImport(SkinArchive.fromSourceFiles([{ path: "skin.json", data: new TextEncoder().encode("{}") }]))
  assert.equal(plan.basis, "none")
  assert.equal(plan.needsNativeDocument, true)
  assert.equal(plan.preview, "sxi")
})
