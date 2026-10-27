// 测试用 BDA 动画样例：手写 protobuf animationConfig，并拼出一个最小 BDA 皮肤包。
// 字段号与 APK 里 animation.proto 的 descriptor 一致（见 bda-decode.ts 的解码实现）。
import { readFileSync } from "node:fs"
import { zipSync } from "fflate"
import { encodedField, encodeVarint, join } from "../../src/bda-encode.ts"
import { encodePng } from "../../src/ssf/ssf-png.ts"
import { SkinArchive } from "../../src/skin.ts"

const encoder = new TextEncoder()

const string = (value) => encoder.encode(value)
const varint = (number, value) => encodedField(number, 0, encodeVarint(value))
const bytes = (number, value) => encodedField(number, 2, value)
const float32 = (number, value) => {
  const payload = new Uint8Array(4)
  new DataView(payload.buffer).setFloat32(0, value, true)
  return encodedField(number, 5, payload)
}
const message = (number, fields) => bytes(number, join(fields))
const mapEntry = (number, key, value) => message(number, [bytes(1, string(key)), bytes(2, value)])
/** RandomValue { min, max } */
const randomValue = (min, max) => join([varint(1, min), varint(2, max)])
/** RandomPoint { randomX, randomY } */
const randomPoint = (x, y) => join([message(1, [randomValue(x[0], x[1])]), message(2, [randomValue(y[0], y[1])])])
/** Resource { type, resourceID }：type 0=PNG、1=GIF */
const resource = (type, resourceID) => join([varint(1, type), bytes(2, string(resourceID))])
/** Range { location, length }（BDA 用起点 + 长度表示范围） */
const range = (from, to) => join([float32(1, from), float32(2, to - from)])

const effectCommon = ({ repeatCount = 1, repeatMode = 0, delay = 0, removeOnFinish = false, duration = 200, interpolation = 0 }) => [
  varint(1, repeatCount),
  varint(2, repeatMode),
  varint(3, delay),
  varint(4, removeOnFinish ? 1 : 0),
  varint(7, duration),
  varint(8, interpolation),
]

export function animationConfigBytes(overrides = {}) {
  const designWidth = overrides.designWidth ?? 1080
  const effects = {
    alphaPress: message(4, [
      bytes(1, string("press")),
      bytes(2, join([
        ...effectCommon({ repeatCount: 2, repeatMode: 1, delay: 20, removeOnFinish: true, duration: 240, interpolation: 2 }),
        message(5, [randomValue(0, 40)]),
        message(6, [randomValue(230, 255)]),
      ])),
    ]),
    scaleShow: message(5, [
      bytes(1, string("enter")),
      bytes(2, join([
        ...effectCommon({ repeatCount: 1, duration: 300, interpolation: 3 }),
        message(5, [randomPoint([60, 80], [60, 80])]),
        message(6, [randomPoint([100, 100], [100, 110])]),
        message(11, [varint(1, 1), varint(2, 3)]),
      ])),
    ]),
    shiftPress: message(6, [
      bytes(1, string("slide")),
      bytes(2, join([
        ...effectCommon({ duration: 180 }),
        message(5, [randomPoint([-20, 0], [0, 0])]),
        message(6, [randomPoint([80, 120], [0, 20])]),
      ])),
    ]),
    shiftPixels: message(6, [
      bytes(1, string("pixel")),
      bytes(2, join([
        ...effectCommon({ duration: 160 }),
        message(9, [randomPoint([-30, -10], [0, 0])]),
        message(10, [randomPoint([0, 10], [0, 40])]),
      ])),
    ]),
    rotatePress: message(7, [
      bytes(1, string("spin")),
      bytes(2, join([
        ...effectCommon({ duration: 260, repeatMode: 0 }),
        message(5, [randomValue(0, 0)]),
        message(6, [randomValue(180, 360)]),
        message(9, [varint(1, 25), varint(2, 75)]),
        message(10, [varint(1, 50), varint(2, 50)]),
      ])),
    ]),
    groupCombo: message(3, [
      bytes(1, string("combo")),
      bytes(2, join([
        varint(1, 1),
        varint(2, 1),
        varint(3, 0),
        varint(4, 0),
        varint(5, 0),
        message(6, [varint(1, 1), bytes(2, string("press"))]),
        message(6, [varint(1, 4), bytes(2, string("spin"))]),
      ])),
    ]),
    frameGif: message(8, [
      bytes(1, string("gif")),
      bytes(2, join([varint(1, 1), varint(2, 0), bytes(3, resource(1, "spark.gif")), varint(4, 0)])),
    ]),
    imageSequence: message(9, [
      bytes(1, string("seq")),
      bytes(2, join([
        varint(1, 1),
        varint(2, 0),
        varint(4, 0),
        message(5, [bytes(1, resource(0, "dot.png")), varint(2, 100)]),
        message(5, [bytes(1, resource(0, "dot.png")), varint(2, 120)]),
        varint(6, 1),
        varint(7, 0),
      ])),
    ]),
    emitterSpark: message(10, [
      bytes(1, string("spark")),
      bytes(2, join([
        varint(3, 1),
        varint(4, 0),
        varint(5, 1),
        float32(6, 0.5),
        varint(7, 20),
        varint(8, 12),
        message(12, [float32(1, 0), float32(2, 0), float32(3, 0.4), float32(4, 1)]),
        message(13, [resource(0, "dot.png")]),
        message(14, [range(300, 600)]),
        message(15, [range(-20, 20)]),
        message(16, [range(-60, 60)]),
        message(17, [range(80, 120)]),
        message(18, [range(-0.5, 0.5)]),
        message(19, [range(200, 255)]),
        message(20, [range(-100, -50)]),
        message(21, [range(0, 120)]),
        message(22, [range(0, 90)]),
        message(23, [range(10, 20)]),
        message(24, [range(90, 90)]),
      ])),
    ]),
    lottiePress: message(11, [bytes(1, string("lottie")), bytes(2, join([varint(1, 1), bytes(3, resource(7, "celebrate.json"))]))]),
    videoPress: message(13, [
      bytes(1, string("video")),
      bytes(2, join([varint(1, 1), bytes(3, resource(3, "celebrate.mp4")), bytes(5, resource(0, "dot.png"))])),
    ]),
  }
  const animation = (target, items, delegateKey) => mapEntry(1, target, join([
    ...items,
    ...(delegateKey ? [bytes(3, string(delegateKey))] : []),
  ]))
  const simple = (scope, type, key, event, condition) => bytes(1, join([
    varint(1, scope),
    varint(2, type),
    bytes(4, string(key)),
    varint(5, event),
    ...(condition ? [bytes(6, string(condition))] : []),
  ]))
  const complex = (location, type, key, event) => bytes(2, join([
    varint(1, location),
    varint(2, type),
    bytes(3, string(key)),
    varint(4, event),
  ]))
  return join([
    animation("KEY_A", [
      simple(2, 1, "press", 1),
      simple(1, 2, "enter", 3),
      simple(0, 3, "slide", 2),
      simple(2, 3, "pixel", 8),
    ]),
    animation("MAIN_KEY", [simple(2, 0, "combo", 1)]),
    animation("FUNCTION_KEY", [complex(0, 2, "spark", 1)]),
    animation("PANEL", [complex(0, 0, "gif", 0)]),
    animation("CAND", [simple(2, 1, "press", 3)]),
    animation("HINT", [simple(2, 1, "press", 4)]),
    animation("KEY_Q", [simple(2, 4, "spin", 1), simple(2, 3, "pixel", 2)]),
    animation("KEY_Z", [complex(0, 1, "seq", 3)]),
    animation("KEY_X", [complex(0, 3, "lottie", 1)]),
    animation("KEY_C", [complex(0, 4, "video", 1)]),
    animation("UNKNOWN_SLOT", [simple(2, 1, "press", 1)]),
    effects.alphaPress,
    effects.scaleShow,
    effects.shiftPress,
    effects.shiftPixels,
    effects.rotatePress,
    effects.groupCombo,
    effects.frameGif,
    effects.imageSequence,
    effects.emitterSpark,
    effects.lottiePress,
    effects.videoPress,
    varint(12, designWidth),
  ])
}

const PNG = encodePng({ width: 2, height: 2, data: new Uint8Array(16).fill(0x80) })
const GIF = encoder.encode("GIF89a")

const animatedSkins = new Map()

/** 用官方默认 BDA 的外观配置拼一个带 animationConfig 的皮肤包。 */
export function bdaAnimatedSkinBytes(templatePath = new URL("../../public/default-template.bda", import.meta.url)) {
  const key = String(templatePath)
  const cached = animatedSkins.get(key)
  if (cached) return cached
  const template = SkinArchive.open(new Uint8Array(readFileSync(templatePath)), "bda")
  const files = {
    "Info.txt": template.getBytes("Info.txt"),
    "light/port/appearanceConfig": template.getBytes("light/skin/port/appearanceConfig"),
    "light/land/appearanceConfig": template.getBytes("light/skin/land/appearanceConfig"),
    "light/port/animationConfig": animationConfigBytes(),
    "light/land/animationConfig": animationConfigBytes({ designWidth: 1920 }),
    "light/res/dot.png": PNG,
    "light/res/spark.gif": GIF,
    "dark/port/appearanceConfig": template.getBytes("light/skin/port/appearanceConfig"),
    "dark/land/appearanceConfig": template.getBytes("light/skin/land/appearanceConfig"),
    "dark/port/animationConfig": animationConfigBytes(),
    "dark/land/animationConfig": animationConfigBytes({ designWidth: 1920 }),
    "dark/res/dot.png": PNG,
    "dark/res/spark.gif": GIF,
  }
  // 外观样式引用的 PNG 资源也要带上，转换/预览才不会只剩占位灰块。
  for (const path of template.names()) {
    const match = path.match(/(?:^|\/)res\/(.+)$/i)
    if (!match) continue
    const value = template.getBytes(path)
    if (!value) continue
    files[`light/res/${match[1]}`] = value
    files[`dark/res/${match[1]}`] = value
  }
  const bytes = zipSync(Object.fromEntries(Object.entries(files).filter(([, value]) => value)), { level: 6 })
  animatedSkins.set(key, bytes)
  return bytes
}

/** 官方 BDS 基础布局，转换测试需要。 */
export function bdsBaseArchive(basePath = new URL("../../public/bda-base.bds", import.meta.url)) {
  return SkinArchive.open(new Uint8Array(readFileSync(basePath)))
}
