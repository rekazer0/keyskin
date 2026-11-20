// BDS 双向往返：读 → 写 → 再读，两次 IR 结构必须一致；非图文件的行集合必须一致。
//
// 判据是「两次读出的 IR 一致」，不是「写出的包长得像原包」：写出物只由模型重建，
// 模型里没有的东西不能靠回看源包补，所以这里的断言都落在模型与文件内容上。
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { SkinArchive } from "../src/skin.ts"
import { bdsFormat, bdsSource } from "../src/skin-model/formats/bds/index.ts"
import { readWith, writeWith } from "./support/driver.mjs"

const SAMPLES = [
  "default-template.bds",
  "bda-base.bds",
  "sogou-template.bds",
  "layout-templates/pinyin18.bds",
  "templates/huawei-swipe-symbols-1080.bds",
  "templates/iqoo-rounded-black.bds",
  "templates/oppo-dual-color.bds",
  "templates/oppo-swipe-down.bds",
  "templates/xiaomi-unified-rounded-blur.bds",
]

function archiveOf(name) {
  return SkinArchive.open(new Uint8Array(readFileSync(new URL(`../public/${name}`, import.meta.url))), "bds")
}

function isImage(path) {
  return /\.(?:png|jpg|jpeg|webp)$/i.test(path)
}

function isDirectory(path) {
  return path.endsWith("/")
}

/** 模型的结构骨架：只取会影响再读结果的字段，不比较对象身份。 */
function shapeOf(model) {
  const byId = (left, right) => String(left.id ?? left.name ?? "").localeCompare(String(right.id ?? right.name ?? ""))
  return {
    meta: {
      name: model.meta.name,
      theme: model.meta.theme,
      orientation: model.meta.orientation,
      resolution: model.meta.resolution,
    },
    boards: model.boards.map((board) => ({
      id: board.id,
      kind: board.kind,
      theme: board.theme,
      orientation: board.orientation,
      container: board.container,
      // 键的顺序有意义（编号与绘制顺序），保持原序比较。
      keys: board.keys.map((key) => key.id),
    })).sort(byId),
    styles: [...model.styles.keys()].sort(),
    atlases: model.atlases.map((atlas) => ({
      name: atlas.name,
      source: atlas.source,
      slices: atlas.slices.map((slice) => slice.id),
    })).sort(byId),
    appearances: model.appearances.map((appearance) => ({
      theme: appearance.theme,
      orientation: appearance.orientation,
      activation: appearance.activation,
      boards: [...appearance.boards].sort(),
    })).sort((left, right) => `${left.theme}/${left.orientation}`.localeCompare(`${right.theme}/${right.orientation}`)),
    profiles: model.profiles.map((profile) => ({
      format: profile.format,
      capabilities: [...profile.capabilities.entries()].sort(),
      // `declared` 只记录原值，段与字段的出现顺序不参与判定。
      declared: [...(profile.declared ?? [])].map(([section, fields]) => [section, fields.split(",").sort().join(",")]).sort(),
    })),
  }
}

/**
 * 文件内容归一：`=` 两侧空格是写法差异；`NM_IMG`/`HL_IMG` 的切片号前导零
 * （`fore2,06` 与 `fore2,6`）是同一个编号的两种写法。
 */
function contentLine(line) {
  return line
    .trim()
    .replace(/\s*=\s*/, "=")
    .replace(/^(NM_IMG|HL_IMG)=(.+?),0*(\d+)$/, "$1=$2,$3")
}

function lineSet(archive, path) {
  return archive.getText(path).split(/\r?\n/).map(contentLine).filter(Boolean).sort()
}

async function roundTrip(name) {
  const archive = archiveOf(name)
  const source = bdsSource(archive)
  assert.ok(source, `${name} 打不开`)
  const first = await readWith(bdsFormat, source)
  const written = await writeWith(bdsFormat, first)
  const again = await readWith(bdsFormat, written)
  return { archive, first, written: written.archive, again }
}

test("每个样本往返后两次 IR 结构一致", async () => {
  for (const name of SAMPLES) {
    const { first, again } = await roundTrip(name)
    assert.deepEqual(shapeOf(again), shapeOf(first), `${name} 往返后 IR 结构变了`)
  }
})

test("非图文件不增不减", async () => {
  for (const name of SAMPLES) {
    const { archive, written } = await roundTrip(name)
    const before = archive.names().filter((path) => !isImage(path) && !isDirectory(path))
    const after = written.names().filter((path) => !isImage(path) && !isDirectory(path))
    assert.deepEqual(after, before, `${name} 的文件集合变了`)
  }
})

test("非图文件的行集合一致", async () => {
  const failures = []
  for (const name of SAMPLES) {
    const { archive, written } = await roundTrip(name)
    for (const path of archive.names()) {
      if (isImage(path) || isDirectory(path)) continue
      const before = lineSet(archive, path)
      const after = written.getText(path).split(/\r?\n/).map(contentLine).filter(Boolean).sort()
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        failures.push(`${name}:${path}\n  只原 ${before.filter((line) => !after.includes(line)).slice(0, 3)}\n  只新 ${after.filter((line) => !before.includes(line)).slice(0, 3)}`)
      }
    }
  }
  assert.deepEqual(failures, [], failures.join("\n"))
})

test("图集来自 .til，不是凭空重排", async () => {
  const { first, written } = await roundTrip("default-template.bds")
  const tilPaths = [...written.names()].filter((path) => path.endsWith(".til")).sort()
  const atlasPaths = first.atlases.map((atlas) => atlas.name).sort()
  assert.deepEqual(atlasPaths, tilPaths, "读到的图集路径与包里的 .til 不一致")
  for (const atlas of first.atlases) {
    assert.ok(atlas.slices.length > 0, `${atlas.name} 没有切片`)
    assert.equal(atlas.source, atlas.name.replace(/\.til$/, ".png"), `${atlas.name} 的源图配对不对`)
  }
})

test("外观来自主题方向目录，能力声明来自 gen.ini", async () => {
  const { first } = await roundTrip("default-template.bds")
  assert.deepEqual(
    first.appearances.map((appearance) => `${appearance.theme}/${appearance.orientation}`).sort(),
    ["light/land", "light/port"],
  )
  const profile = first.profiles[0]
  assert.equal(profile.format, "bds")
  assert.ok(profile.capabilities.size > 0, "能力表是空的")
  // gen.ini 声明了哪些段、每段有哪些字段，原样记在 declared 里。
  assert.ok(profile.declared?.has("PANEL"), "没有记录 gen.ini 的 PANEL 段")
  assert.match(profile.declared.get("PANEL"), /SIZE/)
})

test("没有样式表的基础布局不凭空造样式", async () => {
  const { first, again } = await roundTrip("bda-base.bds")
  assert.equal(first.styles.size, 0)
  assert.equal(again.styles.size, 0)
  assert.equal(first.atlases.length, 0)
})
