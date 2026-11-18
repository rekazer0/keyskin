// 推导回环：真实模板里的每个布局都要能被推导、按 taffy 精确复现，并以结果为输入再推导一致。
import assert from "node:assert/strict"
import { globSync, readFileSync } from "node:fs"
import test from "node:test"
import { IniDocument } from "@/ini.ts"
import { previewItems } from "@/preview-items.ts"
import { SkinArchive } from "@/skin.ts"
import { computeLayout } from "@/skin-model/layout.ts"
import { deriveBoard } from "@/skin-model/derive/layout.ts"

const TOLERANCE = 1

function sizeOf(document) {
  const parts = document.get("PANEL", "SIZE")?.split(",").map((part) => Number(part.trim()))
  return parts && parts.length === 2 && parts.every(Number.isFinite) && parts[0] > 0
    ? { width: parts[0], height: parts[1] }
    : { width: 1080, height: 600 }
}

function samples() {
  const found = []
  for (const path of globSync(["public/layout-templates/*.bds", "public/templates/*.bds", "public/*.bds"])) {
    const archive = SkinArchive.open(new Uint8Array(readFileSync(path)), "bds")
    for (const name of archive.names()) {
      if (!/\/(?:port|land)\/[^/]+\.ini$/i.test(name)) continue
      const document = IniDocument.parse(archive.getText(name))
      const size = sizeOf(document)
      const keys = previewItems(document, size.width, size.height, undefined, false)
        .filter((item) => /^KEY\d+$/i.test(item.section) && item.rect.width > 0 && item.rect.height > 0)
        .map((item) => ({ id: item.section, ...item.rect }))
      if (keys.length >= 4) found.push({ path, name, size, keys })
    }
  }
  return found
}

function matches(actual, expected) {
  return actual !== undefined
    && Math.abs(actual.x - expected.x) <= TOLERANCE
    && Math.abs(actual.y - expected.y) <= TOLERANCE
    && Math.abs(actual.width - expected.width) <= TOLERANCE
    && Math.abs(actual.height - expected.height) <= TOLERANCE
}

test("真实模板布局可推导并回环一致", async () => {
  const list = samples()
  assert.ok(list.length > 100, `样本过少：${list.length}`)
  const failures = []
  for (const sample of list) {
    const first = await deriveBoard("board", sample.keys, sample.size)
    const computed = await computeLayout(first.layout, sample.size)
    if (!sample.keys.every((key) => matches(computed.get(key.id), key))) {
      failures.push(`${sample.path}:${sample.name} 无法复现`)
      continue
    }
    const rects = sample.keys.map((key) => ({ id: key.id, ...computed.get(key.id) }))
    const second = await deriveBoard("board", rects, sample.size)
    const again = await computeLayout(second.layout, sample.size)
    if (!rects.every((key) => matches(again.get(key.id), key))) failures.push(`${sample.path}:${sample.name} 回环不一致`)
  }
  assert.deepEqual(failures, [], `失败 ${failures.length} 个：${failures.slice(0, 5).join(" | ")}`)
})
