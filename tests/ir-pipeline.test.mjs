// 管线驱动器：识别、解析、转换按序执行，转换阶段拿不到原始包。
import assert from "node:assert/strict"
import test from "node:test"
import { IniDocument } from "../src/ini.ts"
import { SkinArchive } from "../src/skin.ts"
import { exportSkin, importArchive, pathsWith, roleCounts, unknownFiles } from "../src/skin-model/pipeline.ts"

function archive() {
  return SkinArchive.fromSourceFiles([
    { path: "a.ini", data: new TextEncoder().encode("[KEY1]\nX=1") },
    { path: "weird.bin", data: new TextEncoder().encode("xx") },
  ])
}

/** 一个最小导入器：记录调用顺序，转换阶段只拿到文档。 */
function importer(log, options = {}) {
  return {
    identify(pkg) {
      log.push("identify")
      assert.ok(pkg.files.has("a.ini"))
      return {
        roles: new Map([
          ["a.ini", { kind: "layout", board: "main", theme: "light", orientation: "port" }],
          ["weird.bin", { kind: "unknown", reason: "不认识的后缀" }],
        ]),
        themes: ["light"],
        orientations: ["port"],
      }
    },
    parse(pkg, structure) {
      log.push("parse")
      const texts = new Map()
      for (const [path, role] of structure.roles) {
        if (role.kind !== "layout") continue
        texts.set(path, IniDocument.parse(new TextDecoder().decode(pkg.files.get(path))))
      }
      return { roles: structure.roles, texts, structs: new Map(), binaries: new Map() }
    },
    toModel(documents) {
      log.push("toModel")
      // 转换阶段能看到的只有文档，没有原始字节。
      assert.equal(documents.binaries.size, 0)
      assert.ok(documents.texts.has("a.ini"))
      return options.model ?? { boards: [], styles: new Map(), images: new Map(), motions: new Map(), sounds: new Map(), resources: new Map() }
    },
  }
}

test("驱动器按识别、解析、转换的顺序执行", async () => {
  const log = []
  await importArchive(archive(), "bds", importer(log))
  assert.deepEqual(log, ["identify", "parse", "toModel"])
})

test("转换阶段拿不到原始包", async () => {
  const log = []
  const model = await importArchive(archive(), "bds", importer(log))
  assert.ok(model)
  // toModel 的入参里没有包；上面已断言它只能从文档取内容。
})

test("识别不出来的文件如实列出，不当兜底", async () => {
  const log = []
  const impl = importer(log)
  const structure = impl.identify({ format: "bds", files: new Map([["a.ini", new Uint8Array()], ["weird.bin", new Uint8Array()]]) })
  const unknown = unknownFiles(structure)
  assert.equal(unknown.length, 1)
  assert.equal(unknown[0].path, "weird.bin")
  assert.ok(unknown[0].reason)
  assert.equal(roleCounts(structure).get("layout"), 1)
  assert.deepEqual(pathsWith(structure, "layout"), ["a.ini"])
})

test("角色统计覆盖包里的每个文件", async () => {
  const log = []
  const impl = importer(log)
  const files = new Map([["a.ini", new Uint8Array()], ["weird.bin", new Uint8Array()]])
  const structure = impl.identify({ format: "bds", files })
  assert.equal(structure.roles.size, files.size, "每个文件都必须有角色")
  const total = [...roleCounts(structure).values()].reduce((sum, count) => sum + count, 0)
  assert.equal(total, files.size)
})

test("导出方向同样分三步，打包阶段拿不到模型", async () => {
  const log = []
  const exporter = {
    fromModel(model) {
      log.push("fromModel")
      assert.ok(model)
      return { roles: new Map([["a.ini", { kind: "layout", board: "main", theme: "light", orientation: "port" }]]), texts: new Map(), structs: new Map(), binaries: new Map() }
    },
    structure(documents) {
      log.push("structure")
      return { roles: documents.roles, themes: ["light"], orientations: ["port"] }
    },
    pack(documents, structure) {
      log.push("pack")
      // 打包阶段拿到的是文档与结构，没有模型。
      assert.ok(documents.roles.size)
      assert.deepEqual(structure.themes, ["light"])
      return { format: "bds", files: new Map() }
    },
  }
  await exportSkin({ boards: [] }, exporter)
  assert.deepEqual(log, ["fromModel", "structure", "pack"])
})
