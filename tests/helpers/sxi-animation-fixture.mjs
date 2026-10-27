// A Palm `.sxi` fixture with one animation of every family in `ss_2`, for the animation inspector's
// end-to-end and UI-snapshot tests. Built from the shipped harmony template so the rest of the skin
// stays realistic: boards, styles and images are the template's; only `ss_2` (and two styles that
// play animations) are added.

import { readFileSync } from "node:fs"
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate"

/** `ss_2` rows keyed by animation id; ids follow the table's numeric order. */
export function animationTable() {
  return {
    "100": {
      id: "ANIM100",
      a1: {
        b: { t: 3, c: 0, count: 1, back: true, clear: true },
        style: 3,
        duration: 160,
        delay: 0,
        from_p: [100, 100],
        to_p: [92, 92],
        pp: [50, 50],
        c_delay: 0,
      },
    },
    "101": {
      id: "ANIM101",
      a1: {
        b: { t: 2, c: 0, count: 1, back: false, clear: true },
        style: 1,
        duration: 240,
        delay: 20,
        from_px: [0, 0],
        to_px: [0, -40],
        pxp: [50, 100],
        c_delay: 0,
      },
    },
    "102": {
      id: "ANIM102",
      a3: { method: { simultaneous: {} }, a_method: "simultaneous", animations: [100, 101] },
    },
    "103": {
      id: "ANIM103",
      af2: {
        b: { t: 0, c: 2, count: 3, back: false, clear: false },
        type: 1,
        file: "press.webp",
        d: 500,
        delay: 0,
        l: 1,
        r: 4,
        pos: [2, 3],
        psr: [0.5, 1, 1.5],
      },
    },
    "104": {
      id: "ANIM104",
      a4: {
        b: { t: 0, c: 3, count: 1, back: false, clear: true },
        rate: 4,
        clean: true,
        remove: false,
        m_up: 1,
        aera: [[0, 0], [10, 20]],
        use_touch: true,
        duration: 600,
        delay: 0,
        count: 12,
        i_p: [7, 8],
        paths: [1, 2],
        life: [300, 600],
        rotation: [0, 90],
        spin: [10, 20],
        scale: [0.5, 1],
        s_scale: [0, 0.2],
        alpha: [180, 255],
        s_alpha: [-10, 0],
        velocity: [0, 120],
        v_direction: [0, 180],
        acceleration: [0, 50],
        a_direction: [0, 90],
      },
    },
    "105": {
      id: "ANIM105",
      a10: {
        b: { t: 0, c: 10, count: 1, back: false, clear: true },
        rr: true,
        pm: 3,
        rm: 1,
        file: "path.json",
        d: 800,
        r: 2,
        sp: [10, 20],
        rp: [50, 50],
        sd: 100,
        iri: 500,
        fs: 80,
        // `l` intentionally missing: LEVEL defaults to 上层.
      },
    },
    "106": {
      id: "ANIM106",
      a11: {
        b: { t: 0, c: 11, count: 1, back: false, clear: true },
        g: 980,
        v: [20, 30],
        a_vel: 5,
        dir: [0, 1],
        rest: 0.7,
        fric: 0.2,
        use_touch: false,
        resist: 0.1,
        a_resist: 0.2,
        region: 4,
        collision_rect: [[1, 2], [30, 40]],
        duration: 900,
        delay: 0,
        file: "ball.png",
        launch_point: [50, 50],
        l: 1,
      },
    },
    "107": {
      id: "ANIM107",
      a12: {
        b: { t: 0, c: 12, count: 1, back: false, clear: false },
        surface_color: "#2FC7FF",
        wave_color: "#9FEAFF",
        highlight_color: "#FFFFFF",
        body_alpha: 0.78,
        fill: 0.333,
        tilt_enabled: true,
        tilt_sensitivity: 1.1,
        sensor_filter_ms: 85,
        dead_zone_deg: 0.8,
        hysteresis_deg: 0.35,
        max_angle_deg: 30,
        tilt_response_ms: 95,
        samples: 42,
        spring: 40,
        damping: 5.6,
        coupling: 140,
        max_wave: 26,
        impulse: 170,
        tilt_slosh_gain: 0.33,
        gravity: 400,
        l: 1,
        floaters: [{
          file: "leaf.png",
          mode: 1,
          mass: 1.2,
          delay: 100,
          v: [0, -180],
          drag: 1.8,
          immersion: 8,
          downhill: 180,
          max_speed: 180,
          edge_rest: 0.25,
          rotation_follow: 0.65,
          swim_speed: 40,
          swim_range: [0.1, 0.9],
          swim_pause: [1000, 3000],
          flip: true,
          anchor_x: 0.5,
          anchor_y: -5,
          wave_suppression: 0.3,
          wave_reflection: 0.2,
          ride: 0,
        }],
      },
    },
    "108": {
      id: "ANIM108",
      a13: {
        b: { t: 0, c: 13, count: 1, back: false, clear: false },
        count: 7,
        assetDir: "carnival",
        loopPattern: "element%d_loop.webp",
        jumpStartPattern: "jump%d_start.png",
        jumpApexPattern: "jump%d_apex.png",
        jumpFallPattern: "jump%d_fall.png",
        waveDelayMs: 80,
        jumpDurationMs: 620,
        jumpHeightRatio: 0.45,
        itemSizeDp: 65,
        rowWidthRatio: 0.86,
        bottomMarginDp: 0,
        l: 1,
      },
    },
    "109": {
      id: "ANIM109",
      a14: {
        b: { t: 0, c: 14, count: 1, back: false, clear: false },
        backgroundPath: "rabbit_background.png",
        backgroundAnimationPath: "rabbit_background_animation.webp",
        idleRabbitPath: "rabbit_idle.webp",
        runningRabbitPath: "rabbit_running.webp",
        crazyRabbitPath: "rabbit_crazy_running.webp",
        brakingRabbitPath: "rabbit_braking.webp",
        fallingPattern: "falling_element_%d.png",
        fallingCount: 7,
        backgroundHeightPx: 250,
        rabbitSizePx: 500,
        rabbitCenterXRatio: 0.5,
        rabbitBottomMarginPx: 0,
        typingWindowMs: 1000,
        crazyThreshold: 3,
        stopToBrakeDelayMs: 800,
        brakeDurationMs: 500,
        backgroundFlashMs: 150,
        fallDurationMs: 1000,
        fallDistancePx: 600,
        fallStartOffsetPx: 150,
        fallSpreadPx: 240,
        fallSizePx: 102,
      },
    },
  }
}

/** The harmony template with the animation table above and two styles that play animations. */
export function sxiAnimationFixture() {
  const files = unzipSync(readFileSync(new URL("../../public/templates/palm-harmony.sxi", import.meta.url)))
  const skin = JSON.parse(strFromU8(files["skin.json"]))
  const info = skin.default.s_info
  info.ss_2 = { ...info.ss_2, ...animationTable() }
  // `s_5` names the animation per event: 1 press, 3 show.
  info.ss_1 = { ...info.ss_1, "9001": { id: "STYLE9001", s_5: { 1: 100, 3: 102 } }, "9002": { id: "STYLE9002", s_5: { 3: 107 } } }
  files["skin.json"] = strToU8(JSON.stringify(skin))
  return Buffer.from(zipSync(files))
}
