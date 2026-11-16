import assert from "node:assert/strict"
import test from "node:test"
import { encodedField, updateBdaKeySound } from "../src/bda-encode.ts"
import { decodeBdaSoundConfig } from "../src/bda-decode.ts"

test("BDA sound edits isolate Android/iOS maps and preserve unrelated bytes", () => {
  const unknown = encodedField(88, 2, new TextEncoder().encode("unknown"))
  const android = updateBdaKeySound(unknown, "KEY_A", { type: 5, resourceID: "a.ogg" })
  const both = updateBdaKeySound(android, "KEY_A", { type: 10, resourceID: "a.aiff" }, true)
  const changed = updateBdaKeySound(both, "KEY_A", { type: 0, resourceID: "b.wav" })
  assert.equal(decodeBdaSoundConfig(changed).keySounds.get("KEY_A").resourceID, "b.wav")
  assert.equal(decodeBdaSoundConfig(changed).iosKeySounds.get("KEY_A").resourceID, "a.aiff")
  assert.deepEqual(changed.slice(0, unknown.length), unknown)
  assert.deepEqual(updateBdaKeySound(both, "KEY_A", undefined, true), android)
  const iosOnly = updateBdaKeySound(unknown, "KEY_A", { type: 10, resourceID: "a.aiff" }, true)
  assert.deepEqual(updateBdaKeySound(both, "KEY_A", undefined), iosOnly)
  assert.equal(updateBdaKeySound(both, "MISSING", undefined), both)
})
