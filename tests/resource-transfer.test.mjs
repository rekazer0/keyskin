import test from "node:test"
import assert from "node:assert/strict"
import { declarations, run } from "./helpers/app-source.mjs"
import { isSoundPath } from "../src/sounds.ts"
import { isFontFile, sanitizeFontFileName } from "../src/font-files.ts"

const png = Uint8Array.from([137, 80, 78, 71])
const file = (name, bytes = png) => ({ name, arrayBuffer: async () => bytes.buffer })
function uploadContext() {
  const commits = []
  const archive = { format: "bds", getBytes: () => undefined }
  const context = run(declarations("uploadResourceFiles", "prepareResourceImage"), {
    archive, editing: true, Uint8Array, Blob, isFontFile, sanitizeFontFileName,
    theme: { value: "light" }, orientation: { value: "port" }, resourceSearch: { value: "" },
    isEditing: () => context.editing,
    currentSoundEntries: () => [], pickableImagePaths: () => ["light/skin/res/bg.png"],
    createImageBitmap: async () => ({ close() {} }), isSoundPath,
    commitBatch: changes => commits.push(changes), keySoundBuffers: new Map(),
    releaseKeySound() {}, openResources(kind) { context.resourceInspectorMode = kind }, renderResourceInspector() {}, syncResourceSelection() {}, updateDirty() {}, showStatus() {},
    renderResourceCatalogSearch() {}, refreshPreview() {}, validateFont: async bytes => { if (bytes[0] !== 137) throw new Error("Invalid font") },
  })
  return { context, commits }
}

test("resource batches validate every file before committing, including duplicate names", async () => {
  for (const files of [[file("a.png"), file("bad.png", Uint8Array.of(1))], [file("a.png"), file("a.png")]]) {
    const { context, commits } = uploadContext()
    await assert.rejects(context.uploadResourceFiles(files))
    assert.equal(commits.length, 0)
  }
  const { context, commits } = uploadContext()
  assert.equal(await context.uploadResourceFiles([file("a.png"), file("b.png")]), true)
  assert.equal(commits.length, 1)
  assert.deepEqual(Array.from(commits[0], change => change.path), ["light/skin/res/a.png", "light/skin/res/b.png"])
})

test("font uploads use only the active skin mode and validate a whole batch before committing", async () => {
  for (const mode of ["light", "dark"]) {
    const { context, commits } = uploadContext()
    context.resourceCatalog = "font"
    context.theme.value = mode
    await assert.rejects(context.uploadResourceFiles([file("good.ttf"), file("bad.ttf", Uint8Array.of(1))]))
    await assert.rejects(context.uploadResourceFiles([file("image.png")]))
    assert.equal(commits.length, 0)
    assert.equal(await context.uploadResourceFiles([file("a.ttf"), file("b.otf")]), true)
    assert.deepEqual(Array.from(commits[0], change => change.path), [`${mode}/skin/res/a.ttf`, `${mode}/skin/res/b.otf`])
  }
  const { context, commits } = uploadContext()
  context.resourceCatalog = "font"
  const delayed = { name: "late.ttf", arrayBuffer: async () => { context.theme.value = "dark"; return png.buffer } }
  assert.equal(await context.uploadResourceFiles([delayed]), false)
  assert.equal(commits.length, 0)
})

test("uploads cancel if the archive, mode or resource scope changes while reading", async () => {
  for (const change of [context => { context.archive = {} }, context => { context.editing = false }, context => { context.theme.value = "dark" }, context => { context.orientation.value = "land" }]) {
    const { context, commits } = uploadContext()
    const delayed = { name: "late.png", arrayBuffer: async () => { change(context); return png.buffer } }
    assert.equal(await context.uploadResourceFiles([file("a.png"), delayed]), false)
    assert.equal(commits.length, 0)
  }
})

test("dropped resources are classified by extension, not the visible resource catalog", async () => {
  const { context, commits } = uploadContext()
  context.resourceCatalog = "font"
  await assert.rejects(context.uploadResourceFiles([file("image.PNG"), file("notes.txt")], "drop"), /notes\.txt/)
  assert.equal(commits.length, 0)
  assert.equal(await context.uploadResourceFiles([file("image.PNG"), file("tap.WAV")], "drop"), true)
  assert.deepEqual(Array.from(commits[0], change => change.path), ["light/skin/res/image.PNG", "light/skin/res/tap.WAV"])
  assert.equal(context.resourceInspectorMode, "sound")
  assert.deepEqual(Array.from(context.selectedResourceGalleryPaths), ["file:light/skin/res/tap.WAV"])

  context.resourceCatalog = ""
  assert.equal(await context.uploadResourceFiles([file("font.OTF")], "drop"), true)
  assert.equal(context.resourceCatalog, "font")
  assert.equal(context.selectedResourceCatalogItem, "light/skin/res/font.otf")
})
