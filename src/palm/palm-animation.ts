// Animation models (`ss_2` / `a1`..`a14`), mirroring PalmSkin's `SkinAnimationWrapModel`
// family. Every value is produced as Palm JSON so the encoder stays dumb.

import type { IniSection } from "./palm-ini.ts"
import {
  toBool,
  toDouble,
  toInt,
  toIntArray,
  toPlaySpeedRates,
  toRect,
  toRectFromCorners,
} from "./palm-ini.ts"
import type { PalmJSONValue } from "./palm-json.ts"

type PalmIniEntries = Record<string, string>

type PalmAnimationBase = {
  type: number
  category: number
  repeatCount: number
  autoReverse: boolean
  removeOnComplete: boolean
}

function palmCgPoint(text: string | undefined): [number, number] | undefined {
  if (text === undefined) return undefined
  const parts = text.split(",")
  if (parts.length !== 2) return undefined
  const x = toDouble(parts[0])
  const y = toDouble(parts[1])
  return x === undefined || y === undefined ? undefined : [x, y]
}

function cgPointValue(text: string | undefined): PalmJSONValue | undefined {
  const point = palmCgPoint(text)
  return point === undefined ? undefined : [point[0], point[1]]
}

// CoreGraphics types encode as nested arrays: points as `[x, y]`, rects as
// `[[x, y], [w, h]]` (origin then size).
function rectValue(rect: [[number, number], [number, number]] | undefined): PalmJSONValue | undefined {
  if (!rect) return undefined
  return [[rect[0][0], rect[0][1]], [rect[1][0], rect[1][1]]]
}

const ANIMATION_CATEGORIES = new Set([0, 1, 2, 3, 10, 11, 12, 13, 14])

function animationBase(entries: PalmIniEntries): PalmAnimationBase {
  const type = toInt(entries["TYPE"]) ?? 0
  let category = toInt(entries["CATEGORY"])
  const repeatCount = toInt(entries["REPEAT_CNT"])
  const repeatMode = toInt(entries["REPEAT_MODE"])
  const removeOnComplete = toBool(entries["REMOVE"])

  // `SkinAnimationModel.init(entries:)` falls back to the group category when the
  // BUILD_* trio is present, then to 0.
  if (category === undefined && entries["BUILD_NUM"] !== undefined
    && entries["BUILD_LIST"] !== undefined && entries["BUILD_METHOD"] !== undefined) {
    category = 1
  }

  return {
    type,
    category: category ?? 0,
    repeatCount: repeatCount ?? 1,
    autoReverse: repeatMode === 1,
    removeOnComplete: removeOnComplete ?? false,
  }
}

function animationBaseJSON(base: PalmAnimationBase): PalmJSONValue {
  return {
    t: base.type,
    c: base.category,
    count: base.repeatCount,
    back: base.autoReverse,
    clear: base.removeOnComplete,
  }
}

// `SkinAnimationLevel`: LEVEL 0 is `down`, everything else (including a missing key) is `up`.
function animationLevel(entries: PalmIniEntries): number | undefined {
  const level = toInt(entries["LEVEL"])
  if (level === undefined) return undefined
  return level === 0 ? 0 : 1
}

// `SkinAnimationRegion` accepts 0...4 only.
function animationRegion(entries: PalmIniEntries): number | undefined {
  const region = toInt(entries["REGION"])
  return region !== undefined && region >= 0 && region <= 4 ? region : undefined
}

function geometryAnimation(entries: PalmIniEntries, base: PalmAnimationBase): PalmJSONValue {
  const model: Record<string, PalmJSONValue> = {
    b: animationBaseJSON(base),
    style: toInt(entries["INTPOL"]) ?? 0,
    c_delay: 0,
  }
  const from = entries["FROM"]
  const to = entries["TO"]
  const duration = toDouble(entries["DURATION"])
  const delay = toDouble(entries["DELAY"])
  if (duration !== undefined) model.duration = duration
  if (delay !== undefined) model.delay = delay
  if (from !== undefined) {
    const value = toDouble(from.replace(/°/g, ""))
    if (value !== undefined) model.from = value
  }
  if (to !== undefined) {
    const value = toDouble(to.replace(/°/g, ""))
    if (value !== undefined) model.to = value
  }
  const fromPoint = cgPointValue(entries["FROM"])
  const toPoint = cgPointValue(entries["TO"])
  const fromPixel = cgPointValue(entries["FROM_PX"])
  const toPixel = cgPointValue(entries["TO_PX"])
  const pivot = cgPointValue(entries["PIVOT"])
  const pivotPixel = cgPointValue(entries["PIVOT_PX"])
  if (fromPoint !== undefined) model.from_p = fromPoint
  if (toPoint !== undefined) model.to_p = toPoint
  if (fromPixel !== undefined) model.from_px = fromPixel
  if (toPixel !== undefined) model.to_px = toPixel
  if (pivot !== undefined) model.pp = pivot
  if (pivotPixel !== undefined) model.pxp = pivotPixel
  return model
}

function frameAnimation(entries: PalmIniEntries, base: PalmAnimationBase): PalmJSONValue {
  const model: Record<string, PalmJSONValue> = { b: animationBaseJSON(base) }
  const modify = toInt(entries["MODIFY"])
  const file = entries["SOURCE_FILE"]
  const duration = toDouble(entries["DURATION"])
  const delay = toDouble(entries["DELAY"])
  const level = animationLevel(entries)
  const region = animationRegion(entries)
  const offset = cgPointValue(entries["OFFSET"])
  const rates = toPlaySpeedRates(entries["PLAY_SPEED_RATE"])
  if (modify !== undefined) model.type = modify
  if (file !== undefined) model.file = file
  if (duration !== undefined) model.d = duration
  if (delay !== undefined) model.delay = delay
  if (level !== undefined) model.l = level
  if (region !== undefined) model.r = region
  if (offset !== undefined) model.pos = offset
  if (rates !== undefined) model.psr = rates
  return model
}

// `SkinCombAnimationModel` carries no `base` member, so `a3` never emits `b`.
function combAnimation(entries: PalmIniEntries): PalmJSONValue {
  const method = toInt(entries["BUILD_METHOD"]) ?? 0
  const list = toIntArray(entries["BUILD_LIST"])
  const model: Record<string, PalmJSONValue> = {
    // `SkinCombAnimMethod` (method) is encoded as a value-less enum.
    method: method === 0 ? { simultaneous: {} } : { sequential: {} },
    a_method: method === 1 ? "sequential" : method === 2 ? "random" : "simultaneous",
    animations: list,
  }
  return model
}

function combAnimationValid(entries: PalmIniEntries): { method: number; list: number[] } | undefined {
  const method = toInt(entries["BUILD_METHOD"])
  const count = toInt(entries["BUILD_NUM"])
  if (method === undefined || count === undefined || entries["BUILD_LIST"] === undefined) return undefined
  const list = toIntArray(entries["BUILD_LIST"])
  const unique = new Set(list)
  if (unique.size !== count) return undefined
  return { method, list }
}

function particleAnimation(entries: PalmIniEntries, base: PalmAnimationBase): PalmJSONValue {
  const model: Record<string, PalmJSONValue> = {
    b: animationBaseJSON(base),
    rate: toDouble(entries["BIRTH_RATE"]) ?? 1.0,
    clean: toBool(entries["FINISH_AFTER_PRACTICES"]) ?? false,
    remove: toBool(entries["REMOVE_INCLUDE_PRACTICES"]) ?? false,
    m_up: toInt(entries["MIRROR_UP"]) ?? 0,
    aera: rectValue(toRect(entries["EMIT_REGION"])) ?? [[0, 0], [1, 1]],
    use_touch: toBool(entries["USE_TOUCH"]) ?? false,
  }
  if (entries["REMOVE"] === undefined) {
    // `SkinParticleAnimationModel` forces removal when the skin does not say otherwise.
    model.b = { ...(model.b as Record<string, PalmJSONValue>), clear: true }
  }
  const duration = toDouble(entries["DURATION"])
  const delay = toDouble(entries["DELAY"])
  const total = toInt(entries["TOTAL_NUMBER"])
  const particles = entries["PARTICLE_IMAGE"] === undefined ? undefined : toIntArray(entries["PARTICLE_IMAGE"])
  const paths = entries["PARTICLE_PATH"] === undefined ? undefined : toIntArray(entries["PARTICLE_PATH"])
  const life = cgPointValue(entries["LIFE"])
  const rotation = cgPointValue(entries["INIT_ROTATE"])
  const spin = cgPointValue(entries["ROTATE_SPEED"])
  const scale = cgPointValue(entries["INIT_SCALE"])
  const scaleSpeed = cgPointValue(entries["SCALE_SPEED"])
  const alpha = cgPointValue(entries["INIT_ALPHA"])
  const alphaSpeed = cgPointValue(entries["ALPHA_SPEED"])
  const velocity = cgPointValue(entries["VELOCITY"])
  const velocityDirection = cgPointValue(entries["VELOCITY_DIRECTION"])
  const acceleration = cgPointValue(entries["ACCELERATION"])
  const accelerationDirection = cgPointValue(entries["ACCELERATION_DIRECTION"])
  if (duration !== undefined) model.duration = duration
  if (delay !== undefined) model.delay = delay
  if (total !== undefined) model.count = total
  if (particles !== undefined) model.i_p = particles
  if (life !== undefined) model.life = life
  if (rotation !== undefined) model.rotation = rotation
  if (spin !== undefined) model.spin = spin
  if (scale !== undefined) model.scale = scale
  if (scaleSpeed !== undefined) model.s_scale = scaleSpeed
  if (alpha !== undefined) model.alpha = alpha
  if (alphaSpeed !== undefined) model.s_alpha = alphaSpeed
  if (velocity !== undefined) model.velocity = velocity
  if (velocityDirection !== undefined) model.v_direction = velocityDirection
  if (acceleration !== undefined) model.acceleration = acceleration
  if (accelerationDirection !== undefined) model.a_direction = accelerationDirection
  if (paths !== undefined) model.paths = paths
  return model
}

function pathTrackerAnimation(entries: PalmIniEntries, base: PalmAnimationBase): PalmJSONValue {
  const mode = toInt(entries["PATH_MODE"])
  const interrupt = toInt(entries["INTERRUPT_MODE"])
  const model: Record<string, PalmJSONValue> = {
    b: animationBaseJSON(base),
    rr: toBool(entries["RESTORE_RADOM"]) ?? false,
    pm: mode !== undefined && mode >= 0 && mode <= 3 ? mode : 3,
    rm: interrupt !== undefined && interrupt >= 0 && interrupt <= 1 ? interrupt : 1,
  }
  const file = entries["SOURCE_FILE"]
  const duration = toDouble(entries["DURATION"])
  const level = animationLevel(entries)
  const region = animationRegion(entries)
  const startPoint = cgPointValue(entries["START_POINT"])
  const restorePoint = cgPointValue(entries["RESTORE_POINT"])
  const startDelay = toDouble(entries["START_DELAY"])
  const idleReset = toDouble(entries["IDLE_RESET_INTERVAL"])
  const followSpeed = toDouble(entries["FOLLOW_SPEED"])
  if (file !== undefined) model.file = file
  if (duration !== undefined) model.d = duration
  if (level !== undefined) model.l = level
  if (region !== undefined) model.r = region
  if (startPoint !== undefined) model.sp = startPoint
  if (restorePoint !== undefined) model.rp = restorePoint
  if (startDelay !== undefined) model.sd = startDelay
  if (idleReset !== undefined) model.iri = idleReset
  if (followSpeed !== undefined) model.fs = followSpeed
  return model
}

function collisionAnimation(entries: PalmIniEntries, base: PalmAnimationBase): PalmJSONValue {
  const model: Record<string, PalmJSONValue> = {
    b: animationBaseJSON(base),
    g: toDouble(entries["GRAVITY"]) ?? 980.0,
    v: cgPointValue(entries["VELOCITY"]) ?? [0, 0],
    a_vel: toDouble(entries["ANGULAR_VELOCITY"]) ?? 0,
    dir: cgPointValue(entries["DIRECTION"]) ?? [0, 1],
    rest: toDouble(entries["RESTITUTION"]) ?? 0.6,
    fric: toDouble(entries["FRICTION"]) ?? 0.1,
    collision_rect: rectValue(toRectFromCorners(entries["COLLISION_RECT"])) ?? [[0, 0], [1, 1]],
    use_touch: toBool(entries["USE_TOUCH"]) ?? false,
    resist: toDouble(entries["RESISTANCE"]) ?? 0,
    a_resist: toDouble(entries["ANGULAR_RESISTANCE"]) ?? 0,
    region: toInt(entries["REGION"]) ?? 4,
  }
  const duration = toDouble(entries["DURATION"])
  const delay = toDouble(entries["DELAY"])
  const file = entries["SOURCE_FILE"]
  const launchPoint = cgPointValue(entries["LAUNCH_POINT"])
  const level = animationLevel(entries)
  if (duration !== undefined) model.duration = duration
  if (delay !== undefined) model.delay = delay
  if (file !== undefined) model.file = file
  if (launchPoint !== undefined) model.launch_point = launchPoint
  if (level !== undefined) model.l = level
  return model
}

function physicalWaterAnimation(entries: PalmIniEntries, base: PalmAnimationBase): PalmJSONValue {
  const floaters: PalmJSONValue[] = []
  const floaterCount = Math.max(toInt(entries["FLOATER_COUNT"]) ?? 0, 0)
  for (let index = 0; index < floaterCount; index += 1) {
    const prefix = `FLOATER_${index}_`
    const mode = toInt(entries[`${prefix}MODE`]) ?? 0
    const floater: Record<string, PalmJSONValue> = {
      file: entries[`${prefix}SOURCE_FILE`] ?? "",
      mode: mode >= 0 && mode <= 2 ? mode : 0,
      mass: toDouble(entries[`${prefix}MASS`]) ?? 1,
      delay: toDouble(entries[`${prefix}DELAY`]) ?? 0,
      v: cgPointValue(entries[`${prefix}VELOCITY`]) ?? [0, -180],
      drag: toDouble(entries[`${prefix}DRAG`]) ?? 1.8,
      immersion: toDouble(entries[`${prefix}IMMERSION`]) ?? 8,
      downhill: toDouble(entries[`${prefix}DOWNHILL_ACCELERATION`]) ?? 180,
      max_speed: toDouble(entries[`${prefix}MAX_SPEED`]) ?? 180,
      edge_rest: toDouble(entries[`${prefix}EDGE_RESTITUTION`]) ?? 0.25,
      rotation_follow: toDouble(entries[`${prefix}ROTATION_FOLLOW`]) ?? 0.65,
      swim_speed: toDouble(entries[`${prefix}SWIM_SPEED`]) ?? 40,
      swim_range: cgPointValue(entries[`${prefix}SWIM_RANGE`]) ?? [0.1, 0.9],
      swim_pause: cgPointValue(entries[`${prefix}SWIM_PAUSE`]) ?? [1000, 3000],
      flip: toBool(entries[`${prefix}FLIP`]) ?? true,
      anchor_x: toDouble(entries[`${prefix}ANCHOR_X`]) ?? 0.5,
      anchor_y: toDouble(entries[`${prefix}ANCHOR_Y`]) ?? -5,
      wave_suppression: toDouble(entries[`${prefix}WAVE_SUPPRESSION`]) ?? 0.3,
      wave_reflection: toDouble(entries[`${prefix}WAVE_REFLECTION`]) ?? 0.2,
    }
    const ride = toInt(entries[`${prefix}RIDE`])
    if (ride !== undefined && ride >= 0) floater.ride = ride
    floaters.push(floater)
  }
  const level = toInt(entries["LEVEL"])
  return {
    b: animationBaseJSON(base),
    surface_color: entries["SURFACE_COLOR"] ?? "#2FC7FF",
    wave_color: entries["WAVE_COLOR"] ?? "#9FEAFF",
    highlight_color: entries["HIGHLIGHT_COLOR"] ?? "#FFFFFF",
    body_alpha: toDouble(entries["BODY_ALPHA"]) ?? 0.78,
    fill: toDouble(entries["LIQUID_FILL_RATIO"]) ?? 0.333,
    tilt_enabled: toBool(entries["TILT_ENABLED"]) ?? true,
    tilt_sensitivity: toDouble(entries["TILT_SENSITIVITY"]) ?? 1.1,
    sensor_filter_ms: toDouble(entries["SENSOR_FILTER_MS"]) ?? 85,
    dead_zone_deg: toDouble(entries["DEAD_ZONE_DEG"]) ?? 0.8,
    hysteresis_deg: toDouble(entries["HYSTERESIS_DEG"]) ?? 0.35,
    max_angle_deg: toDouble(entries["MAX_ANGLE_DEG"]) ?? 30,
    tilt_response_ms: toDouble(entries["TILT_RESPONSE_MS"]) ?? 95,
    samples: toInt(entries["SAMPLE_COUNT"]) ?? 42,
    spring: toDouble(entries["SPRING"]) ?? 40,
    damping: toDouble(entries["DAMPING"]) ?? 5.6,
    coupling: toDouble(entries["COUPLING"]) ?? 140,
    max_wave: toDouble(entries["MAX_WAVE"]) ?? 26,
    impulse: toDouble(entries["IMPULSE"]) ?? 170,
    tilt_slosh_gain: toDouble(entries["TILT_SLOSH_GAIN"]) ?? 0.33,
    gravity: toDouble(entries["GRAVITY"]) ?? 400,
    floaters,
    l: level !== undefined && level >= 0 && level <= 1 ? level : 1,
  }
}

function bottomCarnivalAnimation(entries: PalmIniEntries, base: PalmAnimationBase): PalmJSONValue {
  const level = toInt(entries["LEVEL"])
  return {
    b: animationBaseJSON(base),
    count: toInt(entries["COUNT"]) ?? 7,
    assetDir: entries["ASSET_DIR"] ?? "",
    loopPattern: entries["LOOP_PATTERN"] ?? "element%d_loop.webp",
    jumpStartPattern: entries["JUMP_START_PATTERN"] ?? "jump%d_start.png",
    jumpApexPattern: entries["JUMP_APEX_PATTERN"] ?? "jump%d_apex.png",
    jumpFallPattern: entries["JUMP_FALL_PATTERN"] ?? "jump%d_fall.png",
    waveDelayMs: toDouble(entries["WAVE_DELAY_MS"]) ?? 80,
    jumpDurationMs: toDouble(entries["JUMP_DURATION_MS"]) ?? 620,
    jumpHeightRatio: toDouble(entries["JUMP_HEIGHT_RATIO"]) ?? 0.45,
    itemSizeDp: toDouble(entries["ITEM_SIZE_DP"]) ?? 65,
    rowWidthRatio: toDouble(entries["ROW_WIDTH_RATIO"]) ?? 0.86,
    bottomMarginDp: toDouble(entries["BOTTOM_MARGIN_DP"]) ?? 0,
    l: level !== undefined && level >= 0 && level <= 1 ? level : 1,
  }
}

function spaceRabbitAnimation(entries: PalmIniEntries, base: PalmAnimationBase): PalmJSONValue {
  return {
    b: animationBaseJSON(base),
    backgroundPath: entries["BACKGROUND_PATH"] ?? "rabbit_background.png",
    backgroundAnimationPath: entries["BACKGROUND_ANIMATION_PATH"] ?? "rabbit_background_animation.webp",
    idleRabbitPath: entries["IDLE_RABBIT_PATH"] ?? "rabbit_idle.webp",
    runningRabbitPath: entries["RUNNING_RABBIT_PATH"] ?? "rabbit_running.webp",
    crazyRabbitPath: entries["CRAZY_RABBIT_PATH"] ?? "rabbit_crazy_running.webp",
    brakingRabbitPath: entries["BRAKING_RABBIT_PATH"] ?? "rabbit_braking.webp",
    fallingPattern: entries["FALLING_PATTERN"] ?? "falling_element_%d.png",
    fallingCount: toInt(entries["FALLING_COUNT"]) ?? 7,
    backgroundHeightPx: toDouble(entries["BACKGROUND_HEIGHT_PX"]) ?? 250,
    rabbitSizePx: toDouble(entries["RABBIT_SIZE_PX"]) ?? 500,
    rabbitCenterXRatio: toDouble(entries["RABBIT_CENTER_X_RATIO"]) ?? 0.5,
    rabbitBottomMarginPx: toDouble(entries["RABBIT_BOTTOM_MARGIN_PX"]) ?? 0,
    typingWindowMs: toDouble(entries["TYPING_WINDOW_MS"]) ?? 1000,
    crazyThreshold: toInt(entries["CRAZY_THRESHOLD"]) ?? 3,
    stopToBrakeDelayMs: toDouble(entries["STOP_TO_BRAKE_DELAY_MS"]) ?? 800,
    brakeDurationMs: toDouble(entries["BRAKE_DURATION_MS"]) ?? 500,
    backgroundFlashMs: toDouble(entries["BACKGROUND_FLASH_MS"]) ?? 150,
    fallDurationMs: toDouble(entries["FALL_DURATION_MS"]) ?? 1000,
    fallDistancePx: toDouble(entries["FALL_DISTANCE_PX"]) ?? 600,
    fallStartOffsetPx: toDouble(entries["FALL_START_OFFSET_PX"]) ?? 150,
    fallSpreadPx: toDouble(entries["FALL_SPREAD_PX"]) ?? 240,
    fallSizePx: toDouble(entries["FALL_SIZE_PX"]) ?? 102,
  }
}

// `SkinAnimationWrapModel.init?(entries:sectionName:)` — nil when neither the declared
// category nor the BUILD_* group animation validates.
export function buildAnimationWrap(section: IniSection): PalmJSONValue | undefined {
  const entries = section.entries
  const base = animationBase(entries)
  const model: Record<string, PalmJSONValue> = {}
  if (ANIMATION_CATEGORIES.has(base.category)) {
    switch (base.category) {
      case 0:
        model.a1 = geometryAnimation(entries, base)
        break
      case 1: {
        const group = combAnimationValid(entries)
        if (group) model.a3 = combAnimation(entries)
        break
      }
      case 2:
        model.af2 = frameAnimation(entries, base)
        break
      case 3:
        model.a4 = particleAnimation(entries, base)
        break
      case 10:
        model.a10 = pathTrackerAnimation(entries, base)
        break
      case 11:
        model.a11 = collisionAnimation(entries, base)
        break
      case 12:
        model.a12 = physicalWaterAnimation(entries, base)
        break
      case 13:
        model.a13 = bottomCarnivalAnimation(entries, base)
        break
      case 14:
        model.a14 = spaceRabbitAnimation(entries, base)
        break
      default:
        break
    }
    model.id = section.name
    return model
  }
  const group = combAnimationValid(entries)
  if (!group) return undefined
  model.a3 = combAnimation(entries)
  model.id = section.name
  return model
}
