import assert from "node:assert/strict"
import test from "node:test"
import { ANIMATION_PRESETS, bdaPresetFields } from "../src/animation-presets.ts"
import { IniDocument } from "../src/ini.ts"
import { appendLegacyAnimation, writeLegacyAnimationFields } from "../src/legacy-animation.ts"
import { iniPreviewClip } from "../src/animation-preview-model.ts"
import { buildAnimationWrap } from "../src/palm/palm-animation.ts"
import { palmPreviewClip } from "../src/palm/palm-preview-clip.ts"
import { updateBdaAnimationEffect } from "../src/bda-encode.ts"
import { decodeBdaAnimation } from "../src/bda-decode.ts"
import { animationConfigBytes } from "./helpers/bda-animation-fixture.mjs"

for (const preset of ANIMATION_PRESETS) test(`${preset.id}: legacy / Palm native parameters and preview`, () => {
  const next = appendLegacyAnimation("[GLOBAL]\nANIM_NUM=0\n", preset.category === "particle" ? "particle" : "basic")
  const fields = { ...preset.fields, ...(preset.category === "particle" ? { PARTICLE_IMAGE: "1" } : {}) }
  const text = writeLegacyAnimationFields(next.text, next.section, fields)
  const clip = iniPreviewClip(IniDocument.parse(text), next.section)
  assert.ok(clip.duration > 0)
  const wrap = buildAnimationWrap({ name: "ANIM1", entries: fields })
  const palm = palmPreviewClip({ "1": wrap }, "1")
  assert.ok(palm.duration > 0)
  assert.equal(Boolean(palm.particles.length), preset.category === "particle")
  if (preset.category === "loop") {
    assert.ok(clip.lanes.some(lane => lane.unbounded))
    assert.ok(palm.lanes.some(lane => lane.unbounded))
  }
})

test("BDA presets preserve effect type, resource bindings and unrelated effects", () => {
  const original = animationConfigBytes()
  const before = decodeBdaAnimation(original)
  const ids = { alpha: "alpha:press", scale: "scale:enter", rotate: "rotate:spin", emitter: "emitter:spark" }
  for (const preset of ANIMATION_PRESETS) {
    for (const kind of ["alpha", "scale", "rotate", "emitter"]) {
      const fields = bdaPresetFields(preset, kind)
      if (!fields) continue
      const id = ids[kind]
      assert.ok(before.effects.has(id), id)
      let bytes = original
      for (const [property, value] of Object.entries(fields)) {
        assert.ok(Number.isFinite(value), `${preset.id}.${property}`)
        bytes = updateBdaAnimationEffect(bytes, id, property, value)
      }
      const after = decodeBdaAnimation(bytes)
      assert.equal(after.effects.get(id).kind, kind)
      assert.ok(Math.abs(after.effects.get(id).duration - Number(preset.fields.DURATION) / (kind === "emitter" ? 1000 : 1)) < 0.000001)
      for (const [other, effect] of before.effects) if (other !== id) assert.deepEqual(after.effects.get(other), effect)
      if (kind === "emitter") assert.deepEqual(after.effects.get(id).resources, before.effects.get(id).resources)
      if (kind === "scale") assert.deepEqual(after.effects.get(id).interpolationXY, [Number(preset.fields.INTPOL ?? 0), Number(preset.fields.INTPOL ?? 0)])
      if (kind === "scale" || kind === "rotate") {
        assert.deepEqual(after.effects.get(id).pivotPx, before.effects.get(id).pivotPx)
        assert.deepEqual(after.effects.get(id).pivot, before.effects.get(id).pivot)
      }
    }
    assert.equal(bdaPresetFields(preset, "video"), undefined)
  }
})
