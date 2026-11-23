import assert from "node:assert/strict"
import test from "node:test"
import { cloneJson } from "../src/clone-json.ts"

test("old WebViews can open settings and independently edit JSON skin data", () => {
  const native = globalThis.structuredClone
  try {
    globalThis.structuredClone = undefined
    const value = { title: "皮肤", keys: [{ size: [79, 44] }], enabled: false }
    const draft = cloneJson(value)
    assert.deepEqual(draft, value)
    draft.keys[0].size[0] = 100
    assert.equal(value.keys[0].size[0], 79)
    assert.equal(cloneJson(undefined), undefined)
  } finally {
    globalThis.structuredClone = native
  }
})
