// BDA 双向往返：读 → 写 → 再读，两次 IR 结构一致，protobuf 字段号与 wire 不变。
//
// 往返看的是 IR，不是字节：同一份模型写出的包再读回来，模型结构必须与第一次相同。
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import test from "node:test"
import { SkinArchive } from "../src/skin.ts"
import { containerOf } from "../src/skin-model/board.ts"
import { decodeBdaAnimation, decodeBdaAppearance, decodeBdaLayout, decodeBdaSoundConfig } from "../src/bda-decode.ts"
import { bdaFormat, bdaSource } from "../src/skin-model/formats/bda/index.ts"
import { exportSkin, importArchive } from "../src/skin-model/pipeline.ts"

const SAMPLES = readdirSync(new URL("../public/res/", import.meta.url))
  .filter((name) => name.toLowerCase().endsWith(".bda"))
  .sort()

function archiveOf(name) {
  return SkinArchive.open(new Uint8Array(readFileSync(new URL(`../public/res/${name}`, import.meta.url))), "bda")
}

async function roundtrip(name) {
  const archive = archiveOf(name)
  const model = await importArchive(archive, "bda", bdaFormat.importer(bdaSource(archive)))
  const written = await exportSkin(model, bdaFormat.exporter)
  const read = await importArchive(written.archive, "bda", bdaFormat.importer(bdaSource(written.archive)))
  return { archive, model, written, read }
}

/** 结构比较用的规范化：Map 按原顺序、字节用摘要、对象逐字段。 */
function canonical(value) {
  if (value === undefined) return "<undefined>"
  if (value === null || typeof value !== "object") return value
  if (value instanceof Uint8Array) {
    return `bytes:${value.length}:${createHash("sha1").update(value).digest("hex")}`
  }
  if (value instanceof Map) return [`map`, [...value].map(([key, item]) => [canonical(key), canonical(item)])]
  if (Array.isArray(value)) return value.map(canonical)
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, canonical(item)]))
}

/** 顶层 protobuf 字段的 `字段号:wire` 多重集合。 */
function topFields(bytes) {
  const fields = []
  let offset = 0
  const varint = () => {
    let value = 0
    let shift = 0
    let byte
    do {
      byte = bytes[offset++]
      value += (byte & 0x7f) * 2 ** shift
      shift += 7
    } while (byte & 0x80)
    return value
  }
  while (offset < bytes.length) {
    const tag = varint()
    const number = Math.floor(tag / 8)
    const wire = tag & 7
    if (wire === 0) {
      varint()
    } else if (wire === 1) {
      offset += 8
    } else if (wire === 2) {
      const length = varint()
      offset += length
    } else if (wire === 5) {
      offset += 4
    } else throw new Error(`不支持的 wire type：${wire}`)
    fields.push(`${number}:${wire}`)
  }
  return fields
}

function countOf(fields) {
  const counts = new Map()
  for (const field of fields) counts.set(field, (counts.get(field) ?? 0) + 1)
  return [...counts].sort(([left], [right]) => left.localeCompare(right))
}

/** 解码器：把配置字节读成结构，用来比较嵌套字段是否也原样往返。 */
const DECODERS = {
  appearanceConfig: decodeBdaAppearance,
  layoutConfig: decodeBdaLayout,
  animationConfig: decodeBdaAnimation,
  soundConfig: decodeBdaSoundConfig,
}

test("样本目录里有 BDA 包", () => {
  assert.ok(SAMPLES.length > 0, "public/res 下没有 .bda")
})

for (const name of SAMPLES) {
  test(`两次读出的 IR 结构一致：${name}`, async () => {
    const { model, read } = await roundtrip(name)
    assert.deepEqual(canonical(read), canonical(model))
  })
}

test("protobuf 字段号与 wire type 往返后保持一致", async () => {
  for (const name of SAMPLES) {
    const { archive, written } = await roundtrip(name)
    const source = bdaSource(archive)
    const prefix = `${source.theme}/skin/${source.orientation}/`
    for (const [config, decode] of Object.entries(DECODERS)) {
      const before = archive.getBytes(`${prefix}${config}`)
      const after = written.archive.getBytes(`${prefix}${config}`)
      if (!before || !after) continue
      assert.deepEqual(countOf(topFields(after)), countOf(topFields(before)), `${name} 的 ${config} 字段集变了`)
      // 字段号相同还不够：解码后的结构（含嵌套字段）也要一致。
      assert.deepEqual(canonical(decode(after)), canonical(decode(before)), `${name} 的 ${config} 解码结构变了`)
    }
  }
})

test("样式引用保留外观里的原始编号", async () => {
  for (const name of SAMPLES) {
    const { model } = await roundtrip(name)
    for (const ref of model.styles.keys()) {
      assert.match(ref, /^bda:(image|color|text):\d+$/, `${name} 的样式引用不是原始编号：${ref}`)
    }
  }
})

test("自带布局的包读得出每键几何，画布与配置一致", async () => {
  const withLayout = ["民生银行.bda", "星河·一束光(2).bda"]
  for (const name of withLayout) {
    const { model } = await roundtrip(name)
    assert.ok(model.boards.length > 1, `${name} 没读到多块板`)
    const board = model.boards.find((item) => item.keys.length > 0)
    assert.ok(board, `${name} 没有带按键的板`)
    assert.equal(board.geometry.kind, "document")
    const size = containerOf(board)
    assert.ok(size && size.width > 0 && size.height > 0, `${name} 的画布尺寸丢了`)
    assert.ok(board.keys.every((key) => key.actions.press !== undefined), `${name} 有按键没有动作`)
  }
})

test("只有外观的包按面板建板，不伪造坐标", async () => {
  const bare = ["夜间.bda", "llee素雅.bda", "南城往事_安卓智能深色.bda"]
  for (const name of bare) {
    const { model } = await roundtrip(name)
    assert.ok(model.boards.length > 1, `${name} 没读到面板`)
    assert.ok(model.boards.every((board) => board.geometry.kind === "client"))
    assert.ok(model.boards.every((board) => board.container.kind === "unknown"), `${name} 的外观面板没有画布，容器应为未知`)
    // 外观里有键，只是没有几何：键照常进板，layoutId 缺省。
    assert.ok(model.boards.some((board) => board.keys.length > 0), `${name} 的外观按键没读出来`)
    assert.ok(model.boards.every((board) => board.keys.every((key) => key.layoutId === undefined)))
  }
})
