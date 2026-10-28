// `.sxi` style models (`ss_1` text/image styles, `ss_2` animations, `info` tile maps and the skin
// info) written as Baidu `default.css`, `anim.ini`, `*.til` and `Info.txt`, for exporting a Palm skin as
// BDI/BDS (sxi-to-baidu.ts). ANIMATION_FIELDS also lists the fields Palm reads per animation family.

import {
  IniWriter,
  asObject,
  listText,
  put,
  putFields,
  rectParts,
  type FieldKind,
  type Json,
  type JsonObject,
} from "./sxi-ini.ts"

// `infoModel` (`ss_1`).
export function stylesIni(value: Json): IniWriter {
  const writer = new IniWriter()
  for (const [index, style] of Object.entries(asObject(value) ?? {})) {
    const model = asObject(style) ?? {}
    const entries = writer.section(typeof model.id === "string" ? model.id : `STYLE${index}`)
    putFields(entries, asObject(model.s_1) ?? {}, [
      ["text", "SHOW", "string"],
      ["c_type", "FONT_CLEARTYPE", "number"],
      ["f_s", "FONT_SIZE", "number"],
      ["f_n", "FONT_NAME", "string"],
      ["c_normal", "NM_COLOR", "string"],
      ["c_hl", "HL_COLOR", "string"],
      ["file", "FONT_PATH", "string"],
    ])
    putFields(entries, asObject(model.s_2) ?? {}, [["normal", "NM_IMG", "string"], ["hl", "HL_IMG", "string"]])
    putFields(entries, asObject(model.s_3) ?? {}, [["size", "BORDER_SIZE", "number"], ["color", "BORDER_COLOR", "string"]])
    putFields(entries, asObject(model.s_4) ?? {}, [
      ["path_1", "PRESS_SOUND_PATH", "string"],
      ["path_2", "PANEL_SHOW_SOUND_PATH", "string"],
      ["path_3", "PANEL_HIDE_SOUND_PATH", "string"],
    ])
    putFields(entries, asObject(model.s_5) ?? {}, [
      ["1", "PRESS_ANIM", "number"],
      ["2", "RELEASE_ANIM", "number"],
      ["3", "SHOW_ANIM", "number"],
      ["4", "HIDE_ANIM", "number"],
      ["5", "HOLD_ANIM", "number"],
    ])
  }
  return writer
}

// `tileModel` (`.til`).
export function tilesIni(value: Json): IniWriter {
  const writer = new IniWriter()
  for (const [index, tile] of (Array.isArray(value) ? value : []).entries()) {
    const model = asObject(tile) ?? {}
    const entries = writer.section(typeof model.id === "string" ? model.id : `IMG${index}`)
    putFields(entries, model, [
      ["info", "SCALABLE", "bool"],
      ["alpha", "USE_ALPHA", "number"],
      ["mode", "TILE_MODE", "number"],
      ["t_s", "THEME_SCALE_STYLE", "number"],
      ["rect1", "SOURCE_RECT", "rect"],
      ["rect2", "INNER_RECT", "rect"],
      ["insets", "PADDING", "insets"],
    ])
    if (Array.isArray(model.scales) && model.scales.length) put(entries, "SCALE", listText(model.scales))
  }
  return writer
}

const BASE_FIELDS: Array<[string, string, FieldKind]> = [
  ["t", "TYPE", "number"],
  ["c", "CATEGORY", "number"],
  ["count", "REPEAT_CNT", "number"],
  ["clear", "REMOVE", "bool"],
]

export const ANIMATION_FIELDS: Record<string, Array<[string, string, FieldKind]>> = {
  a1: [
    ["style", "INTPOL", "number"],
    ["duration", "DURATION", "number"],
    ["delay", "DELAY", "number"],
    ["from_p", "FROM", "point"],
    ["from", "FROM", "number"],
    ["to_p", "TO", "point"],
    ["to", "TO", "number"],
    ["from_px", "FROM_PX", "point"],
    ["to_px", "TO_PX", "point"],
    ["pp", "PIVOT", "point"],
    ["pxp", "PIVOT_PX", "point"],
  ],
  af2: [
    ["type", "MODIFY", "number"],
    ["file", "SOURCE_FILE", "string"],
    ["d", "DURATION", "number"],
    ["delay", "DELAY", "number"],
    ["l", "LEVEL", "number"],
    ["r", "REGION", "number"],
    ["pos", "OFFSET", "point"],
    ["psr", "PLAY_SPEED_RATE", "list"],
  ],
  a4: [
    ["rate", "BIRTH_RATE", "number"],
    ["clean", "FINISH_AFTER_PRACTICES", "bool"],
    ["remove", "REMOVE_INCLUDE_PRACTICES", "bool"],
    ["m_up", "MIRROR_UP", "number"],
    ["aera", "EMIT_REGION", "rect"],
    ["use_touch", "USE_TOUCH", "bool"],
    ["duration", "DURATION", "number"],
    ["delay", "DELAY", "number"],
    ["count", "TOTAL_NUMBER", "number"],
    ["i_p", "PARTICLE_IMAGE", "list"],
    ["paths", "PARTICLE_PATH", "list"],
    ["life", "LIFE", "point"],
    ["rotation", "INIT_ROTATE", "point"],
    ["spin", "ROTATE_SPEED", "point"],
    ["scale", "INIT_SCALE", "point"],
    ["s_scale", "SCALE_SPEED", "point"],
    ["alpha", "INIT_ALPHA", "point"],
    ["s_alpha", "ALPHA_SPEED", "point"],
    ["velocity", "VELOCITY", "point"],
    ["v_direction", "VELOCITY_DIRECTION", "point"],
    ["acceleration", "ACCELERATION", "point"],
    ["a_direction", "ACCELERATION_DIRECTION", "point"],
  ],
  a10: [
    ["rr", "RESTORE_RADOM", "bool"],
    ["pm", "PATH_MODE", "number"],
    ["rm", "INTERRUPT_MODE", "number"],
    ["file", "SOURCE_FILE", "string"],
    ["d", "DURATION", "number"],
    ["l", "LEVEL", "number"],
    ["r", "REGION", "number"],
    ["sp", "START_POINT", "point"],
    ["rp", "RESTORE_POINT", "point"],
    ["sd", "START_DELAY", "number"],
    ["iri", "IDLE_RESET_INTERVAL", "number"],
    ["fs", "FOLLOW_SPEED", "number"],
  ],
  a11: [
    ["g", "GRAVITY", "number"],
    ["v", "VELOCITY", "point"],
    ["a_vel", "ANGULAR_VELOCITY", "number"],
    ["dir", "DIRECTION", "point"],
    ["rest", "RESTITUTION", "number"],
    ["fric", "FRICTION", "number"],
    ["use_touch", "USE_TOUCH", "bool"],
    ["resist", "RESISTANCE", "number"],
    ["a_resist", "ANGULAR_RESISTANCE", "number"],
    ["region", "REGION", "number"],
    ["duration", "DURATION", "number"],
    ["delay", "DELAY", "number"],
    ["file", "SOURCE_FILE", "string"],
    ["launch_point", "LAUNCH_POINT", "point"],
    ["l", "LEVEL", "number"],
  ],
  a12: [
    ["surface_color", "SURFACE_COLOR", "string"],
    ["wave_color", "WAVE_COLOR", "string"],
    ["highlight_color", "HIGHLIGHT_COLOR", "string"],
    ["body_alpha", "BODY_ALPHA", "number"],
    ["fill", "LIQUID_FILL_RATIO", "number"],
    ["tilt_enabled", "TILT_ENABLED", "bool"],
    ["tilt_sensitivity", "TILT_SENSITIVITY", "number"],
    ["sensor_filter_ms", "SENSOR_FILTER_MS", "number"],
    ["dead_zone_deg", "DEAD_ZONE_DEG", "number"],
    ["hysteresis_deg", "HYSTERESIS_DEG", "number"],
    ["max_angle_deg", "MAX_ANGLE_DEG", "number"],
    ["tilt_response_ms", "TILT_RESPONSE_MS", "number"],
    ["samples", "SAMPLE_COUNT", "number"],
    ["spring", "SPRING", "number"],
    ["damping", "DAMPING", "number"],
    ["coupling", "COUPLING", "number"],
    ["max_wave", "MAX_WAVE", "number"],
    ["impulse", "IMPULSE", "number"],
    ["tilt_slosh_gain", "TILT_SLOSH_GAIN", "number"],
    ["gravity", "GRAVITY", "number"],
    ["l", "LEVEL", "number"],
  ],
  a13: [
    ["count", "COUNT", "number"],
    ["assetDir", "ASSET_DIR", "string"],
    ["loopPattern", "LOOP_PATTERN", "string"],
    ["jumpStartPattern", "JUMP_START_PATTERN", "string"],
    ["jumpApexPattern", "JUMP_APEX_PATTERN", "string"],
    ["jumpFallPattern", "JUMP_FALL_PATTERN", "string"],
    ["waveDelayMs", "WAVE_DELAY_MS", "number"],
    ["jumpDurationMs", "JUMP_DURATION_MS", "number"],
    ["jumpHeightRatio", "JUMP_HEIGHT_RATIO", "number"],
    ["itemSizeDp", "ITEM_SIZE_DP", "number"],
    ["rowWidthRatio", "ROW_WIDTH_RATIO", "number"],
    ["bottomMarginDp", "BOTTOM_MARGIN_DP", "number"],
    ["l", "LEVEL", "number"],
  ],
  a14: [
    ["backgroundPath", "BACKGROUND_PATH", "string"],
    ["backgroundAnimationPath", "BACKGROUND_ANIMATION_PATH", "string"],
    ["idleRabbitPath", "IDLE_RABBIT_PATH", "string"],
    ["runningRabbitPath", "RUNNING_RABBIT_PATH", "string"],
    ["crazyRabbitPath", "CRAZY_RABBIT_PATH", "string"],
    ["brakingRabbitPath", "BRAKING_RABBIT_PATH", "string"],
    ["fallingPattern", "FALLING_PATTERN", "string"],
    ["fallingCount", "FALLING_COUNT", "number"],
    ["backgroundHeightPx", "BACKGROUND_HEIGHT_PX", "number"],
    ["rabbitSizePx", "RABBIT_SIZE_PX", "number"],
    ["rabbitCenterXRatio", "RABBIT_CENTER_X_RATIO", "number"],
    ["rabbitBottomMarginPx", "RABBIT_BOTTOM_MARGIN_PX", "number"],
    ["typingWindowMs", "TYPING_WINDOW_MS", "number"],
    ["crazyThreshold", "CRAZY_THRESHOLD", "number"],
    ["stopToBrakeDelayMs", "STOP_TO_BRAKE_DELAY_MS", "number"],
    ["brakeDurationMs", "BRAKE_DURATION_MS", "number"],
    ["backgroundFlashMs", "BACKGROUND_FLASH_MS", "number"],
    ["fallDurationMs", "FALL_DURATION_MS", "number"],
    ["fallDistancePx", "FALL_DISTANCE_PX", "number"],
    ["fallStartOffsetPx", "FALL_START_OFFSET_PX", "number"],
    ["fallSpreadPx", "FALL_SPREAD_PX", "number"],
    ["fallSizePx", "FALL_SIZE_PX", "number"],
  ],
}

export const FLOATER_FIELDS: Array<[string, string, FieldKind]> = [
  ["file", "SOURCE_FILE", "string"],
  ["mode", "MODE", "number"],
  ["mass", "MASS", "number"],
  ["delay", "DELAY", "number"],
  ["v", "VELOCITY", "point"],
  ["drag", "DRAG", "number"],
  ["immersion", "IMMERSION", "number"],
  ["downhill", "DOWNHILL_ACCELERATION", "number"],
  ["max_speed", "MAX_SPEED", "number"],
  ["edge_rest", "EDGE_RESTITUTION", "number"],
  ["rotation_follow", "ROTATION_FOLLOW", "number"],
  ["swim_speed", "SWIM_SPEED", "number"],
  ["swim_range", "SWIM_RANGE", "point"],
  ["swim_pause", "SWIM_PAUSE", "point"],
  ["flip", "FLIP", "bool"],
  ["anchor_x", "ANCHOR_X", "number"],
  ["anchor_y", "ANCHOR_Y", "number"],
  ["wave_suppression", "WAVE_SUPPRESSION", "number"],
  ["wave_reflection", "WAVE_REFLECTION", "number"],
  ["ride", "RIDE", "number"],
]

const GROUP_METHODS: Record<string, string> = { simultaneous: "0", sequential: "1", random: "2" }

// `buildAnimationWrap` (`ss_2`): exactly one of `a1`..`a14` per wrap.
export function animationsIni(value: Json): IniWriter {
  const writer = new IniWriter()
  for (const [index, wrap] of Object.entries(asObject(value) ?? {})) {
    const model = asObject(wrap) ?? {}
    const entries = writer.section(typeof model.id === "string" ? model.id : `ANIM${index}`)
    const group = asObject(model.a3)
    if (group) {
      const list = Array.isArray(group.animations) ? group.animations : []
      put(entries, "CATEGORY", "1")
      put(entries, "BUILD_METHOD", GROUP_METHODS[String(group.a_method)] ?? "0")
      put(entries, "BUILD_NUM", String(new Set(list).size))
      put(entries, "BUILD_LIST", listText(list))
      continue
    }
    const kind = Object.keys(ANIMATION_FIELDS).find((key) => asObject(model[key]))
    const animation = kind ? asObject(model[kind])! : undefined
    if (!kind || !animation) continue
    const base = asObject(animation.b) ?? {}
    putFields(entries, base, BASE_FIELDS)
    put(entries, "REPEAT_MODE", base.back === true ? "1" : undefined)
    putFields(entries, animation, ANIMATION_FIELDS[kind])
    if (kind === "a11") {
      const rect = rectParts(animation.collision_rect)
      if (rect) put(entries, "COLLISION_RECT", [rect[0], rect[1], rect[0] + rect[2], rect[1] + rect[3]].join(","))
    }
    if (kind === "a12" && Array.isArray(animation.floaters)) {
      put(entries, "FLOATER_COUNT", String(animation.floaters.length))
      for (const [floaterIndex, floater] of animation.floaters.entries()) {
        const prefixed = FLOATER_FIELDS.map(([jsonKey, iniKey, fieldKind]): [string, string, FieldKind] =>
          [jsonKey, `FLOATER_${floaterIndex}_${iniKey}`, fieldKind])
        putFields(entries, asObject(floater) ?? {}, prefixed)
      }
    }
  }
  return writer
}

// `skinInfoJson` (`info`) of the skin, as Info.txt.
export function infoIni(skin: JsonObject): IniWriter {
  const writer = new IniWriter()
  putFields(writer.section(""), asObject(skin.info) ?? {}, [
    ["name", "Name", "string"],
    ["description", "Description", "string"],
    ["author", "Author", "string"],
    ["dark_mode", "SupportDarkMode", "bool"],
    ["core_ability", "MinImeCode", "number"],
  ])
  return writer
}
