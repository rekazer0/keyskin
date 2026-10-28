// Unit tests for the pure `.sxi` animation model (`ss_2`). Only public exports of
// `src/palm/sxi-animation.ts` are used; the projection tables in `sxi-style.ts` are the source of
// truth for the fields the inspector has to cover.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ANIMATION_FAMILIES,
  addableComboIds,
  a1IsScale,
  a1TypePatch,
  a1UnitPatch,
  a1Variant,
  animationBase,
  animationFamily,
  animationFamilyInfo,
  animationFieldKeys,
  animationGroups,
  animationHasBase,
  animationModel,
  animationReferences,
  animationTimeline,
  baseNeedsFix,
  comboAnimations,
  comboMethod,
  floaterDefaults,
  floaterFields,
  floaterKeys,
  projectedFieldKeys,
  newAnimation,
} from '../src/palm/sxi-animation.ts'
import { ANIMATION_FIELDS, FLOATER_FIELDS } from '../src/palm/sxi-style.ts'
import { PALM_INT_MAX } from '../src/palm/palm-json.ts'
import { sxiDerivedFiles } from '../src/palm/sxi-projection.ts'

const wrap = (kind, model = {}) => ({ id: `ANIM_${kind}`, [kind]: model })

/** The inspector applies a patch with exactly this algorithm; used to check the resulting model. */
function applyPatch(model, patch) {
  const next = structuredClone(model)
  for (const key of patch.remove) delete next[key]
  for (const [segments, value] of patch.set) {
    let cursor = next
    for (const step of segments.slice(0, -1)) {
      cursor[step] = { ...(cursor[step] ?? {}) }
      cursor = cursor[step]
    }
    cursor[segments[segments.length - 1]] = value
  }
  return next
}

const patchedKeys = (patch) => patch.set.map(([segments]) => segments.join('.'))

// One representative model per family, holding every key `animationsIni` projects for it.
const FAMILY_MODELS = {
  a1: [
    {
      b: { t: 0, c: 0, count: 1, back: false, clear: true },
      style: 3, duration: 200, delay: 20, from: 255, to: 0,
      pp: [50, 50], pxp: [10, 10],
    },
    {
      b: { t: 3, c: 0, count: 1 },
      style: 1, duration: 240, delay: 0, from_p: [100, 100], to_p: [90, 90],
      pp: [50, 50], pxp: [10, 10],
    },
    {
      b: { t: 2, c: 0, count: 1 },
      style: 0, duration: 260, delay: 0, from_px: [0, 0], to_px: [0, -40],
      pp: [50, 50], pxp: [50, 100],
    },
  ],
  af2: {
    b: { t: 0, c: 2, count: 3, back: false, clear: false },
    type: 1, file: 'press.webp', d: 500, delay: 0, l: 1, r: 4, pos: [2, 3], psr: [0.5, 1, 1.5],
  },
  a4: {
    b: { t: 0, c: 3, count: 1, back: false, clear: true },
    rate: 4, clean: true, remove: false, m_up: 1, aera: [[0, 0], [10, 20]], use_touch: true,
    duration: 600, delay: 0, count: 12, i_p: [7, 8], paths: [1, 2],
    life: [300, 600], rotation: [0, 90], spin: [10, 20], scale: [0.5, 1], s_scale: [0, 0.2],
    alpha: [180, 255], s_alpha: [-10, 0], velocity: [0, 120], v_direction: [0, 180],
    acceleration: [0, 50], a_direction: [0, 90],
  },
  a10: {
    b: { t: 0, c: 10, count: 1, back: false, clear: true },
    rr: true, pm: 3, rm: 1, file: 'path.json', d: 800, l: 1, r: 2,
    sp: [10, 20], rp: [50, 50], sd: 100, iri: 500, fs: 80,
  },
  a11: {
    b: { t: 0, c: 11, count: 1, back: false, clear: true },
    g: 980, v: [20, 30], a_vel: 5, dir: [0, 1], rest: 0.7, fric: 0.2, use_touch: false,
    resist: 0.1, a_resist: 0.2, region: 4, collision_rect: [[1, 2], [30, 40]],
    duration: 900, delay: 0, file: 'ball.png', launch_point: [50, 50], l: 1,
  },
  a12: {
    b: { t: 0, c: 12, count: 1, back: false, clear: true },
    surface_color: '#2FC7FF', wave_color: '#9FEAFF', highlight_color: '#FFFFFF',
    body_alpha: 0.78, fill: 0.333, tilt_enabled: true, tilt_sensitivity: 1.1,
    sensor_filter_ms: 85, dead_zone_deg: 0.8, hysteresis_deg: 0.35, max_angle_deg: 30,
    tilt_response_ms: 95, samples: 42, spring: 40, damping: 5.6, coupling: 140,
    max_wave: 26, impulse: 170, tilt_slosh_gain: 0.33, gravity: 400, l: 1,
  },
  a13: {
    b: { t: 0, c: 13, count: 1, back: false, clear: true },
    count: 7, assetDir: 'elements', loopPattern: 'element%d_loop.webp',
    jumpStartPattern: 'jump%d_start.png', jumpApexPattern: 'jump%d_apex.png',
    jumpFallPattern: 'jump%d_fall.png', waveDelayMs: 80, jumpDurationMs: 620,
    jumpHeightRatio: 0.45, itemSizeDp: 65, rowWidthRatio: 0.86, bottomMarginDp: 0, l: 1,
  },
  a14: {
    b: { t: 0, c: 14, count: 1, back: false, clear: true },
    backgroundPath: 'rabbit_background.png', backgroundAnimationPath: 'rabbit_background_animation.webp',
    idleRabbitPath: 'rabbit_idle.webp', runningRabbitPath: 'rabbit_running.webp',
    crazyRabbitPath: 'rabbit_crazy_running.webp', brakingRabbitPath: 'rabbit_braking.webp',
    fallingPattern: 'falling_element_%d.png', fallingCount: 7, backgroundHeightPx: 250,
    rabbitSizePx: 500, rabbitCenterXRatio: 0.5, rabbitBottomMarginPx: 0,
    typingWindowMs: 1000, crazyThreshold: 3, stopToBrakeDelayMs: 800, brakeDurationMs: 500,
    backgroundFlashMs: 150, fallDurationMs: 1000, fallDistancePx: 600,
    fallStartOffsetPx: 150, fallSpreadPx: 240, fallSizePx: 102,
  },
}

test('all nine ss_2 families are recognised from their wrap key', () => {
  const expectedCategories = { a1: 0, a3: 1, af2: 2, a4: 3, a10: 10, a11: 11, a12: 12, a13: 13, a14: 14 }
  assert.equal(ANIMATION_FAMILIES.length, 9)
  assert.deepEqual(ANIMATION_FAMILIES.map((family) => family.id), Object.keys(expectedCategories))
  for (const [kind, category] of Object.entries(expectedCategories)) {
    const model = kind === 'a3' ? { a_method: 'simultaneous', animations: [] } : FAMILY_MODELS[kind][0]
    assert.equal(animationFamily(wrap(kind, model)), kind, `${kind} 应由 animationFamily 识别`)
    const info = animationFamilyInfo(kind)
    assert.equal(info?.category, category, `${kind} 的 CATEGORY`)
    assert.ok(info.label.length && info.summary.length, `${kind} 应有标题和摘要`)
  }
  // The wrap model checks families in table order; `a3` has no base, only its key.
  assert.equal(animationFamily({ a3: {}, a1: {} }), 'a1')
  assert.equal(animationFamily({}), undefined)
  assert.equal(animationFamily({ a1: [] }), undefined)
  assert.equal(animationFamilyInfo('zzz'), undefined)
  assert.equal(animationFamilyInfo(undefined), undefined)
})

test('animationModel/animationBase/animationHasBase follow the wrap shape', () => {
  const model = FAMILY_MODELS.af2
  assert.deepEqual(animationModel(wrap('af2', model)), { kind: 'af2', model })
  assert.deepEqual(animationModel(wrap('af2', model), 'af2'), { kind: 'af2', model })
  assert.equal(animationModel(wrap('af2', model), 'a1'), undefined)
  assert.deepEqual(animationModel({ a3: {} }, 'a3'), { kind: 'a3', model: {} })
  assert.equal(animationModel({ a1: [] }), undefined)
  assert.deepEqual(animationBase(model), model.b)
  assert.deepEqual(animationBase({}), {})
  for (const family of ANIMATION_FAMILIES) assert.equal(animationHasBase(family.id), family.id !== 'a3')
})

test('every family with a base ends its timing group with the shared playback fields', () => {
  for (const family of ANIMATION_FAMILIES) {
    const groups = animationGroups(family.id, {})
    if (family.id === 'a3') {
      assert.deepEqual(groups, [], 'a3 没有 base，也没有属性分组')
      continue
    }
    const timing = groups.find((group) => group.title === '时间与循环')
    assert.ok(timing, `${family.id} 缺少时间与循环分组`)
    const base = timing.fields.filter((field) => field.scope === 'base')
    assert.deepEqual(base.map((field) => field.key), ['count', 'back', 'clear'])
    assert.deepEqual(base.map((field) => field.iniKey), ['REPEAT_CNT', 'REPEAT_MODE', 'REMOVE'])
    assert.deepEqual(timing.fields.slice(-3), base, `${family.id}: 重复、往返、移除排在时间字段之后`)
    assert.ok(groups.some((group) => group !== timing), `${family.id} 应有自己的属性分组`)
  }
})

test('a1 sections follow the inspector order: 变化 (type first), 时间与循环, then the pivot when it matters', () => {
  const [scalar, point, pixels] = FAMILY_MODELS.a1
  assert.deepEqual(animationGroups('a1', point).map((group) => group.title), ['变化', '时间与循环', '变换中心'])
  const change = animationGroups('a1', scalar)[0]
  assert.equal(change.fields[0].key, 't')
  assert.equal(change.fields[0].scope, 'base')
  assert.deepEqual(animationGroups('a1', { b: { t: 0 } }).map((group) => group.title), ['变化', '时间与循环'], '透明度不用变换中心')
  assert.deepEqual(animationGroups('a1', { b: { t: 1 } }).map((group) => group.title), ['变化', '时间与循环', '变换中心'])
  assert.ok(animationGroups('a1', pixels).some((group) => group.title === '变换中心'), '已设置的中心不能被藏起来')
  assert.deepEqual(animationGroups('a4', {}).map((group) => group.title), ['发射', '运动', '外观', '时间与循环'])
})

test('the projection fields of every family are all covered by animationGroups, and nothing else leaks', () => {
  // `count` is the base model's repeat count on every family; a4/a13 reuse the key inside the model.
  const BASE_INSPECTOR_KEYS = ['count', 'back', 'clear']
  // Keys the inspector writes through dedicated controls instead of ANIMATION_FIELDS.
  const SPECIAL_INSPECTOR_KEYS = { a1: ['t'], a11: ['collision_rect'] }

  const families = ANIMATION_FAMILIES.map((family) => family.id).filter((id) => id !== 'a3')
  assert.deepEqual(Object.keys(ANIMATION_FIELDS).sort(), [...families].sort(), 'ANIMATION_FIELDS 应与 a1..a14 的 8 个有 base 的族一一对应')

  for (const kind of families) {
    const projected = projectedFieldKeys(kind)
    assert.deepEqual(projected, ANIMATION_FIELDS[kind].map(([key]) => key), `${kind}: projectedFieldKeys 应取自 ANIMATION_FIELDS`)
    assert.ok(projected.length > 0)

    const models = Array.isArray(FAMILY_MODELS[kind]) ? FAMILY_MODELS[kind] : [FAMILY_MODELS[kind]]
    const covered = new Set(models.flatMap((model) => animationFieldKeys(kind, model)))
    const missing = projected.filter((key) => !covered.has(key))
    assert.deepEqual(missing, [], `${kind}: 这些投影字段在检查器里没有对应行`)

    const allowed = new Set([...projected, ...BASE_INSPECTOR_KEYS, ...(SPECIAL_INSPECTOR_KEYS[kind] ?? [])])
    const extra = [...covered].filter((key) => !allowed.has(key))
    assert.deepEqual(extra, [], `${kind}: 检查器暴露了投影不会写入的字段`)
  }

  // a1's three spellings must stay disjoint, so switching type/unit never leaves a mixed wrap.
  const [scalar, point, pixels] = FAMILY_MODELS.a1
  const keysOf = (model) => new Set(animationFieldKeys('a1', model))
  assert.equal(a1Variant(scalar), 'scalar')
  assert.equal(a1Variant(point), 'point')
  assert.equal(a1Variant(pixels), 'pixels')
  const scalarKeys = keysOf(scalar)
  assert.ok(scalarKeys.has('from') && scalarKeys.has('to'))
  assert.ok(!scalarKeys.has('from_p') && !scalarKeys.has('from_px'))
  const pointKeys = keysOf(point)
  assert.ok(pointKeys.has('from_p') && pointKeys.has('to_p'))
  assert.ok(!pointKeys.has('from') && !pointKeys.has('from_px'))
  const pixelKeys = keysOf(pixels)
  assert.ok(pixelKeys.has('from_px') && pixelKeys.has('to_px'))
  assert.ok(!pixelKeys.has('from') && !pixelKeys.has('from_p'))

  // The same key means different things in different families; the labels must not collide.
  const fieldOf = (kind, key, scope) => animationGroups(kind, {})
    .flatMap((group) => group.fields)
    .find((field) => field.key === key && field.scope === scope)
  assert.equal(fieldOf('a4', 'count', undefined).label, '粒子总数')
  assert.equal(fieldOf('a13', 'count', undefined).label, '物件数量')
  assert.equal(fieldOf('a4', 'count', 'base').label, '重复次数')
})

test('floater fields and defaults cover FLOATER_FIELDS completely', () => {
  const projected = FLOATER_FIELDS.map(([key]) => key)
  assert.deepEqual(floaterKeys(), projected)
  const fields = floaterFields()
  assert.deepEqual(fields.map((field) => field.key), projected, 'floaterFields 必须逐项覆盖 FLOATER_FIELDS')
  const kinds = { string: 'text', number: 'number', bool: 'bool', point: 'point' }
  for (const [index, [key, , kind]] of FLOATER_FIELDS.entries()) {
    assert.equal(fields[index].kind, key === 'mode' ? 'select' : kinds[kind], `${key} 的控件类型`)
  }
  const defaults = floaterDefaults()
  assert.deepEqual(Object.keys(defaults).sort(), projected.filter((key) => key !== 'ride').sort())
  assert.equal(defaults.ride, undefined, '未配置搭载对象不能默认为物体 0')
  for (const [key, , kind] of FLOATER_FIELDS) {
    const value = defaults[key]
    if (key === 'ride') continue
    if (kind === 'string') assert.equal(typeof value, 'string', key)
    else if (kind === 'bool') assert.equal(typeof value, 'boolean', key)
    else if (kind === 'point') assert.ok(Array.isArray(value) && value.length === 2 && value.every(Number.isFinite), key)
    else assert.ok(Number.isFinite(value), key)
  }
})

test('animationTimeline reads the duration from the spelling each family uses', () => {
  const cases = [
    ['a1', { duration: 240 }],
    ['af2', { d: 500 }],
    ['a4', { duration: 600 }],
    ['a10', { d: 800 }],
    ['a11', { duration: 900 }],
  ]
  for (const [kind, model] of cases) {
    const timeline = animationTimeline(kind, model)
    assert.equal(timeline.duration, Object.values(model)[0], `${kind} 的时长`)
    assert.equal(timeline.continuous, false, `${kind} 播完就结束`)
  }
  for (const [kind] of cases) {
    assert.equal(animationTimeline(kind, {}).duration, undefined, `${kind} 缺少时长时不应编造`)
    assert.equal(animationTimeline(kind, {}).continuous, false)
    assert.equal(animationTimeline(kind, {}).unknown, true)
  }
  assert.equal(animationTimeline('a12', {}).continuous, true, '液体动画持续生效')
  assert.equal(animationTimeline('a12', { d: 500 }).duration, undefined, 'a12 不看 d')
  assert.equal(animationTimeline('a14', { duration: 500 }).continuous, true, '太空兔持续生效')
})

test('a13 spans the jump plus the wave offset of every item', () => {
  assert.equal(animationTimeline('a13', { count: 3, jumpDurationMs: 500, waveDelayMs: 100 }).duration, 700)
  assert.equal(animationTimeline('a13', { count: 1, jumpDurationMs: 500, waveDelayMs: 100 }).duration, 500)
  // Missing values fall back to the model defaults: 620 ms jump, 80 ms wave, 7 items.
  assert.equal(animationTimeline('a13', {}).duration, 620 + 80 * 6)
  assert.equal(animationTimeline('a13', { count: 0 }).duration, 620)
  assert.equal(animationTimeline('a13', {}).continuous, false)
})

test('delay falls back to a10 START_DELAY and reverse/clear come from the base model', () => {
  assert.equal(animationTimeline('a10', { d: 800, sd: 120 }).delay, 120, 'a10 用 sd 当延迟')
  assert.equal(animationTimeline('a10', { d: 800, sd: 120, delay: 30 }).delay, 30, '有 delay 时不用 sd')
  assert.equal(animationTimeline('a1', { duration: 100 }).delay, 0)
  assert.equal(animationTimeline('a1', { duration: 100, delay: 50 }).delay, 50)

  const base = { b: { back: true, clear: true }, duration: 100 }
  const timeline = animationTimeline('a1', base)
  assert.equal(timeline.reverse, true)
  assert.equal(timeline.clear, true)
  const plain = animationTimeline('a1', { b: {}, duration: 100 })
  assert.equal(plain.reverse, false)
  assert.equal(plain.clear, false)
})

test('repeatText tells once, N times and the infinite loop apart', () => {
  const text = (count) => animationTimeline('a1', { b: { count } }).repeatText
  assert.equal(text(1), '播放一次')
  assert.equal(text(2), '重复 2 次')
  assert.equal(text(7), '重复 7 次')
  assert.equal(text(PALM_INT_MAX), '无限循环')
  assert.equal(animationTimeline('a1', {}).repeatText, '播放一次')
})

test('a3 combines its children: max for simultaneous/random, sum for sequential', () => {
  const table = {
    '1': { a1: { b: { count: 1 }, duration: 400, delay: 100 } },
    '2': { af2: { b: { count: 1 }, d: 300, delay: 0 } },
    '3': { a10: { b: { count: 1 }, d: 150, sd: 50 } },
  }
  const combo = (method) => ({ a_method: method, animations: [1, 2] })
  assert.equal(animationTimeline('a3', combo('simultaneous'), table).duration, 500)
  assert.equal(animationTimeline('a3', combo('random'), table).duration, 500)
  assert.equal(animationTimeline('a3', combo('sequential'), table).duration, 800, '400+100 与 300+0 相加')
  assert.equal(animationTimeline('a3', combo('sequential'), table).continuous, false)

  // A continuous child (e.g. liquid) makes the whole combination continuous.
  const withLiquid = animationTimeline('a3', { a_method: 'simultaneous', animations: [1, 4] }, { ...table, '4': { a12: { b: {} } } })
  assert.equal(withLiquid.continuous, true)
  assert.equal(withLiquid.duration, undefined)
  // A missing child means the length is unknown, not zero.
  const broken = animationTimeline('a3', combo('simultaneous'), { ...table, '2': undefined })
  assert.equal(broken.duration, undefined)
  assert.equal(broken.continuous, false)
  assert.equal(broken.unknown, true)
  assert.equal(animationTimeline('a3', { animations: [] }, table).unknown, true)
})

test('comboAnimations keeps only non-negative integers', () => {
  assert.deepEqual(comboAnimations({ animations: [3, 2, 3, 0, -1, 1.5, '7', null, Infinity, NaN] }), [3, 2, 3, 0])
  assert.deepEqual(comboAnimations({ animations: ['1', '2'] }), [])
  assert.deepEqual(comboAnimations({}), [])
  assert.deepEqual(comboAnimations({ animations: 4 }), [])
  assert.equal(comboMethod({ a_method: 'sequential' }), 'sequential')
  assert.equal(comboMethod({ a_method: 'random' }), 'random')
  assert.equal(comboMethod({ a_method: 'simultaneous' }), 'simultaneous')
  assert.equal(comboMethod({}), 'simultaneous')
  assert.equal(comboMethod({ a_method: 'nonsense' }), 'simultaneous')
})

test('a1Variant and a1IsScale follow the base type', () => {
  const variant = (t, extra = {}) => a1Variant({ b: { t }, ...extra })
  assert.equal(a1Variant({}), 'scalar')
  assert.equal(variant(0), 'scalar')
  assert.equal(variant(1), 'scalar')
  assert.equal(variant(2), 'point')
  assert.equal(variant(2, { from_px: [0, 0] }), 'pixels')
  assert.equal(variant(2, { to_px: [0, 0] }), 'pixels')
  assert.equal(variant(3), 'point')
  assert.equal(a1IsScale({ b: { t: 0 } }), false)
  assert.equal(a1IsScale({ b: { t: 1 } }), false)
  assert.equal(a1IsScale({ b: { t: 2 } }), false)
  assert.equal(a1IsScale({ b: { t: 3 } }), true)
  assert.equal(a1IsScale({ b: { t: 4 } }), true)
  assert.equal(a1IsScale({}), false)
})

test('a1TypePatch swaps one from/to spelling for the other and writes b.t', () => {
  // scalar -> point (位移/缩放): the scalar values are not valid points, so defaults fill in.
  const scalar = { b: { t: 0 }, from: 255, to: 0, pp: [50, 50] }
  const toPoint = a1TypePatch(scalar, 2)
  assert.ok(toPoint.set.some(([path, value]) => path.join('.') === 'b.t' && value === 2), '必须写入 b.t')
  assert.ok(patchedKeys(toPoint).includes('from_p') && patchedKeys(toPoint).includes('to_p'))
  assert.deepEqual(toPoint.remove.sort(), ['from', 'from_px', 'to', 'to_px'])
  const pointModel = applyPatch(scalar, toPoint)
  assert.deepEqual(pointModel.b, { t: 2 })
  assert.deepEqual(pointModel.from_p, [0, 0])
  assert.deepEqual(pointModel.to_p, [0, 0])
  assert.equal(pointModel.from, undefined)
  assert.equal(pointModel.to, undefined)
  assert.equal(a1Variant(pointModel), 'point')

  // point -> scalar: every point spelling goes away and the scalar defaults are written.
  const point = { b: { t: 3 }, from_p: [100, 100], to_p: [90, 90] }
  const toScalar = a1TypePatch(point, 0)
  assert.ok(toScalar.set.some(([path, value]) => path.join('.') === 'b.t' && value === 0))
  assert.deepEqual(patchedKeys(toScalar).sort(), ['b.t', 'from', 'to'])
  assert.deepEqual(toScalar.remove.sort(), ['from_p', 'from_px', 'to_p', 'to_px'])
  const scalarModel = applyPatch(point, toScalar)
  assert.deepEqual(scalarModel, { b: { t: 0 }, from: 255, to: 0 })
  assert.equal(a1Variant(scalarModel), 'scalar')

  // scalar -> scalar keeps the current numbers (rotating 255° or 200% is still the same value).
  const carried = applyPatch({ b: { t: 0 }, from: 200, to: 10 }, a1TypePatch({ b: { t: 0 }, from: 200, to: 10 }, 1))
  assert.deepEqual(carried, { b: { t: 1 }, from: 200, to: 10 })

  // pixels -> same pixel variant carries the points and drops the scalar/percent spellings.
  const pixelsModel = { b: { t: 2 }, from_px: [0, -40], to_px: [10, 20] }
  const repixeled = applyPatch(pixelsModel, a1TypePatch(pixelsModel, 2))
  assert.deepEqual(repixeled, { b: { t: 2 }, from_px: [0, -40], to_px: [10, 20] })

  // pixels -> scalar also drops both point spellings.
  const pixelToScalar = applyPatch(pixelsModel, a1TypePatch(pixelsModel, 0))
  assert.deepEqual(pixelToScalar, { b: { t: 0 }, from: 255, to: 0 })

  // pixels -> scale keeps the numbers in the percent spelling instead of silently dropping them.
  const pixelsToScale = applyPatch(pixelsModel, a1TypePatch(pixelsModel, 3))
  assert.deepEqual(pixelsToScale, { b: { t: 3 }, from_p: [0, -40], to_p: [10, 20] })
})

test('a1UnitPatch rewrites 位移 between percent and pixels without leaving both spellings', () => {
  const percentModel = { b: { t: 2 }, from_p: [100, 100], to_p: [80, 20] }
  const pixels = a1UnitPatch(percentModel, 'pixels')
  assert.ok(pixels)
  assert.deepEqual(patchedKeys(pixels).sort(), ['from_px', 'to_px'])
  assert.deepEqual(pixels.remove.sort(), ['from_p', 'to_p'])
  const pixelModel = applyPatch(percentModel, pixels)
  assert.deepEqual(pixelModel, { b: { t: 2 }, from_px: [100, 100], to_px: [80, 20] })
  assert.equal(a1Variant(pixelModel), 'pixels')

  const percent = a1UnitPatch(pixelModel, 'percent')
  assert.ok(percent)
  assert.deepEqual(patchedKeys(percent).sort(), ['from_p', 'to_p'])
  assert.deepEqual(percent.remove.sort(), ['from_px', 'to_px'])
  assert.deepEqual(applyPatch(pixelModel, percent), percentModel)

  // Switching one way may still find the other spelling first (a wrap edited by hand).
  const mixed = { b: { t: 2 }, from_px: [7, 8], to_px: [9, 10] }
  assert.deepEqual(applyPatch(mixed, a1UnitPatch(mixed, 'percent')).from_p, [7, 8])
  const percentOnly = { b: { t: 2 }, from_p: [5, 6], to_p: [1, 2] }
  assert.deepEqual(applyPatch(percentOnly, a1UnitPatch(percentOnly, 'pixels')).from_px, [5, 6])

  // Not a 位移 animation: no unit switch (旋转 and 缩放 have no pixel spelling).
  assert.equal(a1UnitPatch({ b: { t: 0 }, from: 255, to: 0 }, 'pixels'), undefined)
  assert.equal(a1UnitPatch({ b: { t: 1 } }, 'percent'), undefined)
  assert.equal(a1UnitPatch({ b: { t: 3 }, from_p: [100, 100], to_p: [90, 90] }, 'pixels'), undefined)
  assert.equal(a1UnitPatch({ b: { t: 4 } }, 'percent'), undefined)
})

test('addableComboIds never lets a combination reach itself', () => {
  const table = {
    100: { a1: { b: { t: 0 } } },
    101: { a3: { a_method: 'simultaneous', animations: [100] } },
    102: { a3: { a_method: 'sequential', animations: [101] } },
    103: { a3: { a_method: 'random', animations: [103] } },
  }
  // 101 and 102 already reach 100 (directly / through 101) and 100 is excluded as itself.
  assert.deepEqual(addableComboIds(table, '100'), ['103'])
  assert.deepEqual(addableComboIds(table, '101'), ['100', '103'])
  // A cycle already in the table must not make the check recurse forever.
  assert.deepEqual(addableComboIds(table, '103'), ['100', '101', '102'])
})

test('animationTimeline survives a hand-edited combination cycle', () => {
  const table = { 102: { a3: { a_method: 'simultaneous', animations: [102] } } }
  const timeline = animationTimeline('a3', table[102].a3, table)
  assert.equal(timeline.continuous, true)
  assert.equal(timeline.duration, undefined)
})

test('animationReferences finds the styles whose s_5 events and combos reference an animation', () => {
  const skin = {
    default: {
      s_info: {
        ss_1: {
          '7': { id: 'STYLE7', s_5: { '1': 100, '2': 7, '3': '100' } },
          '8': { s_5: { '5': 100 } },
          '9': { s_5: { '4': 99 } },
          '10': { s_1: { text: '无动画' } },
        },
        ss_2: {
          '100': { id: 'ANIM100', a1: { b: { t: 0 }, duration: 100 } },
          '101': { id: 'ANIM101', a3: { a_method: 'simultaneous', animations: [100, 7, 200] } },
          '103': { id: 'ANIM103', a3: { a_method: 'sequential', animations: [7] } },
        },
      },
      s_port: {
        ss_1: { '20': { s_5: { '1': 100 } } },
        ss_2: { '104': { a3: { a_method: 'simultaneous', animations: [100] } } },
      },
    },
  }
  assert.deepEqual(animationReferences(skin, ['default', 's_info', 'ss_2'], '100'), {
    styles: [
      { name: '样式 7', events: ['按下', '显示'] },
      { name: '样式 8', events: ['长按'] },
      { name: '竖屏 · 样式 20', events: ['按下'] },
    ],
    combos: [101, 104], contexts: ['竖屏 · 动画 104'],
  })
  // From an orientation table the shared s_info styles are merged with the orientation's own.
  assert.deepEqual(animationReferences(skin, ['default', 's_port', 'ss_2'], '100'), {
    styles: [
      { name: '样式 7', events: ['按下', '显示'] },
      { name: '样式 8', events: ['长按'] },
      { name: '样式 20', events: ['按下'] },
    ],
    combos: [101, 104],
  })
  assert.deepEqual(animationReferences(skin, ['default', 's_info', 'ss_2'], '999'), { styles: [], combos: [] })
  assert.deepEqual(animationReferences({}, ['default', 's_info', 'ss_2'], '100'), { styles: [], combos: [] })
})

test('baseNeedsFix flags a stale CATEGORY but never for a3', () => {
  assert.equal(baseNeedsFix('a1', { b: { c: 0 } }), false)
  assert.equal(baseNeedsFix('a1', { b: { c: 5 } }), true)
  assert.equal(baseNeedsFix('a1', {}), true)
  assert.equal(baseNeedsFix('af2', { b: { c: 2 } }), false)
  assert.equal(baseNeedsFix('af2', { b: { c: 0 } }), true)
  assert.equal(baseNeedsFix('a14', { b: { c: 14 } }), false)
  assert.equal(baseNeedsFix('a3', { a_method: 'simultaneous', animations: [] }), false)
})

test('combination timelines include repeats, reverse, nested delays and infinite children', () => {
  const table = {
    1: { a1: { b: { count: 3, back: true }, duration: 100, delay: 10, c_delay: 5 } },
    2: { af2: { d: 200 } },
    3: { a3: { a_method: 'sequential', animations: [1, 2] } },
  }
  assert.equal(animationTimeline('a3', table[3].a3, table).duration, 815)
  assert.equal(animationTimeline('a3', { animations: [1, 2] }, table).duration, 615)
  assert.equal(animationTimeline('a3', { animations: [3, 2], a_method: 'sequential' }, table).duration, 1015)
  table[1].a1.b.count = PALM_INT_MAX
  assert.equal(animationTimeline('a3', table[3].a3, table).continuous, true)
  assert.equal(animationTimeline('a3', table[3].a3, table).duration, undefined)
})

test('boolean defaults match the Palm model without materialising missing keys', () => {
  const fields = (kind) => animationGroups(kind, {}).flatMap((group) => group.fields)
  assert.equal(fields('a12').find((field) => field.key === 'tilt_enabled').defaultValue, 'true')
  assert.equal(fields('a4').find((field) => field.key === 'clear').defaultValue, 'true')
  assert.equal(fields('a1').find((field) => field.key === 'clear').defaultValue, 'false')
  assert.equal(floaterFields().find((field) => field.key === 'flip').defaultValue, 'true')
})

test('direction-specific styles override shared bindings before reference lookup', () => {
  const skin = { default: {
    s_info: { ss_1: { 1: { s_5: { 1: 100 } } }, ss_2: { 200: { a3: { animations: [100] } } } },
    s_port: { ss_1: { 1: { s_5: { 3: 100 } } } },
    s_land: { ss_1: { 1: { s_5: { 1: 999 } } } },
  } }
  assert.deepEqual(animationReferences(skin, ['default', 's_port', 'ss_2'], '100'), {
    styles: [{ name: '样式 1', events: ['显示'] }], combos: [200],
  })
  assert.deepEqual(animationReferences(skin, ['default', 's_land', 'ss_2'], '100'), { styles: [], combos: [200] })
})

test('new animations use native defaults for every supported family', () => {
  for (const family of ANIMATION_FAMILIES) {
    const wrap = newAnimation(family.id, '17')
    assert.equal(wrap.id, 'ANIM17')
    assert.equal(animationFamily(wrap), family.id)
    if (family.id !== 'a3') assert.equal(wrap[family.id].b.c, family.category)
  }
  assert.equal(newAnimation('a12', '1').a12.tilt_enabled, true)
  assert.equal(newAnimation('a1', '1').a1.duration, 200)
  assert.deepEqual(newAnimation('a3', '1').a3.animations, [])
  assert.throws(() => newAnimation('unknown', '1'))
})

test('an empty animation table keeps its visual-editor entry', () => {
  const files = sxiDerivedFiles({ default: { s_info: { ss_2: {} } } })
  const entry = files.get('light/skin/res/anim.ini')
  assert.deepEqual(entry.pointer, ['default', 's_info', 'ss_2'])
  assert.equal(entry.text.trim(), '')
})
