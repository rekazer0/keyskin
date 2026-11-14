import assert from "node:assert/strict"
import test from "node:test"
import { draftEdits, selectedDraftChanges } from "../src/ai-draft-selection.ts"

test("INI proposals can accept one field without changing the others", () => {
  const change = { path: "default.css", syntax: "ini", before: "[STYLE1]\nFONT_SIZE=16\nROUND=8\n", after: "[STYLE1]\nFONT_SIZE=18\nROUND=14\n" }
  const edits = draftEdits(change)
  assert.equal(edits.length, 2)
  const exclude = new Map([[change.path, new Set([edits[1].id])]])
  const selected = selectedDraftChanges([change], undefined, exclude)[0]
  assert.match(selected.after, /FONT_SIZE=18/)
  assert.match(selected.after, /ROUND=8/)
  exclude.get(change.path).add(edits[0].id)
  assert.deepEqual(selectedDraftChanges([change], undefined, exclude), [])
  assert.deepEqual(selectedDraftChanges([change], new Set([change.path])), [])
  assert.equal(selectedDraftChanges([change])[0].after, change.after)
})

test("INI added and removed sections remain atomic, including empty sections", () => {
  const change = { path: "keys.ini", syntax: "ini", before: "[OLD]\nA=1\n[EMPTY]\n", after: "[NEW]\nB=2\n[EMPTY]\nX=3\n" }
  const excluded = new Map([[change.path, new Set([JSON.stringify(["OLD"]), JSON.stringify(["EMPTY", "X"])])]])
  const result = selectedDraftChanges([change], undefined, excluded)[0].after
  assert.match(result, /\[OLD\]\nA=1/)
  assert.match(result, /\[NEW\]\nB=2/)
  assert.ok(!result.includes("X=3"))
})

test("JSON proposals select nested fields, deletions and arrays independently", () => {
  const change = { path: "skin.json", syntax: "json", before: '{"key":{"round":8,"size":16},"gone":true,"list":[1]}', after: '{"key":{"round":14,"size":18},"list":[2],"new":{"a":1}}' }
  const edits = draftEdits(change)
  assert.equal(edits.length, 5)
  const excluded = new Map([[change.path, new Set(edits.filter(edit => edit.label !== "key · round").map(edit => edit.id))]])
  assert.deepEqual(JSON.parse(selectedDraftChanges([change], undefined, excluded)[0].after), { key: { round: 14, size: 16 }, gone: true, list: [1] })
})

test("format-only and image changes keep file-level selection", () => {
  const change = { path: "keys.ini", syntax: "ini", before: "[KEY1]\nA=1\n", after: "[KEY1]\nA=1\n; note\n" }
  assert.deepEqual(draftEdits(change), [])
  assert.equal(selectedDraftChanges([change])[0], change)
  const image = { path: "key.png", syntax: "png", before: new Uint8Array([1]), after: new Uint8Array([2]) }
  assert.deepEqual(draftEdits(image), [])
  assert.equal(selectedDraftChanges([image])[0], image)
})
