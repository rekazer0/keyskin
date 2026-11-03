// Legacy Baidu press effects mapped to Sogou's ObjectAnimator / decoration syntax.
import { IniDocument } from "../ini.ts"
import { legacyAnimationValueParts } from "../legacy-animation.ts"

type Size = { width: number; height: number }
type Picture = { file: string; width: number; height: number }
const ANCHORS = [[50, 50], [0, 50], [50, 0], [100, 50], [50, 100], [0, 0], [100, 0], [0, 100], [100, 100]]

export class BaiduSsfMotion {
  readonly output: IniDocument
  private next = 0
  private animations: IniDocument
  private styles: IniDocument
  private warnings: string[]
  private scale: number
  private picture: (style: string) => Picture | undefined
  constructor(animations: IniDocument, styles: IniDocument, warnings: string[], scale: number,
    picture: (style: string) => Picture | undefined, output: IniDocument) {
    this.animations = animations
    this.styles = styles
    this.warnings = warnings
    this.scale = scale
    this.picture = picture
    this.output = output
    this.next = output.sections().length
  }

  private add(prefix: string, fields: Record<string, string>): string {
    const name = `${prefix}_${++this.next}`
    this.output.appendSection(name, Object.entries(fields).map(([key, value]) => ({ key, value })))
    return name
  }

  private values(value: string | undefined, fallback: number[]): number[] {
    if (value === undefined) return fallback
    return legacyAnimationValueParts(value).map((part, index) => {
      const random = part.match(/^rand\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/i)
      if (random) {
        this.warnings.push("百度动效的 rand() 随机取值在搜狗关键帧中使用区间中点")
        return (Number(random[1]) + Number(random[2])) / 2
      }
      return Number.isFinite(Number(part)) ? Number(part) : fallback[index] ?? fallback[0] ?? 0
    })
  }

  private animation(id: string, size: Size, board: Size, active = new Set<string>()): { animation?: string; pivot?: number; objects: string[] } {
    const section = `ANIM${id}`
    if (active.has(id) || active.size >= 32 || !this.animations.sections().includes(section)) {
      this.warnings.push(`百度动画 ${section} 缺失、循环引用或嵌套过深，已跳过`)
      return { objects: [] }
    }
    const seen = new Set(active).add(id)
    const get = (key: string) => this.animations.get(section, key)?.trim()
    if (get("BUILD_LIST") !== undefined) {
      if (get("DELAY") || get("REPEAT_CNT") && get("REPEAT_CNT") !== "1" || get("REPEAT_MODE") === "1") this.warnings.push(`${section} 的组合延迟/循环在搜狗组合中无法完整表达`)
      const children = get("BUILD_LIST")!.split(",").map(value => value.trim()).filter(Boolean)
        .map(child => this.animation(child, size, board, seen))
      const animations = children.flatMap(child => child.animation ? [child.animation] : [])
      const pivots = new Set(children.flatMap(child => child.pivot === undefined ? [] : [child.pivot]))
      if (pivots.size > 1) this.warnings.push(`${section} 的子动画锚点不同，搜狗组合沿用第一个锚点`)
      return { animation: animations.length ? this.add("Anim", { ANIM_SET: animations.join(","), PLAY_METHOD: get("BUILD_METHOD") === "0" ? "0" : "1" }) : undefined,
        pivot: [...pivots][0], objects: children.flatMap(child => child.objects) }
    }
    if (get("ANIM_PATH") !== undefined || get("SOURCE_FILE") !== undefined || get("CATEGORY") === "2") {
      this.warnings.push(`${section} 的 GIF 帧动画在搜狗按键动效中没有等价字段，已跳过：${get("ANIM_PATH") ?? get("SOURCE_FILE") ?? "未指定文件"}`)
      return { objects: [] }
    }
    if (get("CATEGORY") === "3" || get("PARTICLE_IMAGE") !== undefined) return { objects: this.particles(section, size) }
    const type = Number(get("TYPE") ?? 0)
    if (![0, 1, 2, 3, 4].includes(type)) {
      this.warnings.push(`${section} 的 TYPE=${type} 动效在搜狗没有等价变换，已跳过`)
      return { objects: [] }
    }
    if (type === 3) this.warnings.push(`${section} 的目标区域缩放转换为搜狗整体缩放`)
    const defaults = type === 0 ? [255] : type === 3 || type === 4 ? [100, 100] : [0, 0]
    const from = this.values(get(type === 2 && get("FROM_PX") !== undefined ? "FROM_PX" : "FROM"), defaults)
    const to = this.values(get(type === 2 && get("TO_PX") !== undefined ? "TO_PX" : "TO"), defaults)
    const tracks = (type === 2 || type === 3 || type === 4 ? [0, 1] : [0]).map(axis => {
      const convert = (values: number[], pixel: boolean) => {
        const value = values[axis] ?? values[0]
        if (type === 3 || type === 4) return value / 100
        if (type !== 2) return value
        const length = axis ? size.height : size.width
        const pixels = pixel ? value : value * length / 100
        const share = pixels / ((axis ? board.height : board.width) || 1)
        return Math.abs(share) <= 1 ? share : pixels * this.scale
      }
      return this.add("Keyframe", { TIME: "0,1", VALUE: `${convert(from, get("FROM_PX") !== undefined)},${convert(to, get("TO_PX") !== undefined)}` })
    })
    const easing = get("INTPOL") ?? "0"
    if (!/^[0-4]$/.test(easing)) this.warnings.push(`${section} 的插值器 ${easing} 无法映射，沿用匀速`)
    const repeat = get("REPEAT_CNT")
    const animation = this.add("Anim", {
      TYPE: String(({ 0: 4, 1: 3, 2: 1, 3: 2, 4: 2 } as Record<number, number>)[type]),
      DURATION: get("DURATION") ?? "0", START_DELAY: get("DELAY") ?? "0", KEYFRAME: tracks.join(","),
      INTERPOLATOR: easing === "4" ? "6" : /^[0-3]$/.test(easing) ? easing : "0",
      REPEAT_COUNT: repeat?.toLowerCase() === "inf" ? "-1" : String(Math.max(1, Number(repeat ?? 1)) * (get("REPEAT_MODE") === "1" ? 2 : 1) - 1),
      REPEAT_MODE: get("REPEAT_MODE") === "1" ? "2" : "1",
    })
    if (get("REMOVE") === "0") this.warnings.push(`${section} 的结束保持状态在搜狗按键动画中无法保留`)
    let pivot = this.values(get("PIVOT"), [50, 50])
    if (get("PIVOT_PX") !== undefined) pivot = this.values(get("PIVOT_PX"), [size.width / 2, size.height / 2]).map((value, axis) => value / (axis ? size.height : size.width) * 100)
    const anchor = ANCHORS.findIndex(([x, y]) => x === pivot[0] && y === (pivot[1] ?? pivot[0]))
    if (anchor < 0 && [1, 3, 4].includes(type)) this.warnings.push(`${section} 的自定义锚点在搜狗转为中心锚点`)
    return { animation, pivot: anchor < 0 ? 0 : anchor, objects: [] }
  }

  private particles(section: string, size: Size): string[] {
    const get = (key: string) => this.animations.get(section, key)?.trim()
    const range = (key: string, fallback: number) => {
      const pair = this.values(get(key), [fallback, fallback])
      if (pair.length > 1 && pair[0] !== pair[1]) this.warnings.push(`${section} 的 ${key} 随机范围在搜狗装饰动效中使用中点`)
      return pair.length > 1 ? (pair[0] + pair[1]) / 2 : pair[0]
    }
    const images = (get("PARTICLE_IMAGE") ?? "").split(",").map(value => value.trim()).filter(Boolean)
    const pictures = images.flatMap(style => this.picture(style) ?? [])
    if (!pictures.length) {
      this.warnings.push(`${section} 缺少粒子图片，已跳过`)
      return []
    }
    const life = Math.max(1, range("LIFE", 1000))
    const region = this.values(get("EMIT_REGION"), [0, 0, 1, 1])
    const configured = Number(get("TOTAL_NUMBER") ?? 1)
    if (!Number.isFinite(configured)) { this.warnings.push(`${section} 的粒子数量无效，已跳过`); return [] }
    const total = Math.min(256, Math.max(1, Math.floor(configured)))
    if (get("REPEAT_CNT") && get("REPEAT_CNT") !== "1" || get("MIRROR_UP") && get("MIRROR_UP") !== "0") this.warnings.push(`${section} 的粒子循环/父层镜像无法完整转换`)
    this.warnings.push(`${section} 的粒子发射转换为搜狗装饰动效，持续发射和结束移除语义为近似效果`)
    if (Number(get("TOTAL_NUMBER")) > 256) this.warnings.push(`${section} 的粒子超过 256 个，搜狗导出限制为 256 个`)
    if (get("PARTICLE_PATH")) this.warnings.push(`${section} 的复杂粒子路径无法转换为搜狗抛物轨迹`)
    const velocity = range("VELOCITY", 0) * this.scale
    const acceleration = range("ACCELERATION", 0) * this.scale
    const radians = (key: string) => range(key, 0) * Math.PI / 180
    const velocityAngle = radians("VELOCITY_DIRECTION")
    const accelerationAngle = radians("ACCELERATION_DIRECTION")
    return Array.from({ length: total }, (_, index) => {
      const delay = get("EMIT_TYPE") === "1" ? 0 : index / Math.max(0.1, Number(get("BIRTH_RATE") ?? 1)) * 1000
      const tracks = [this.add("Anim", { TYPE: "1", DURATION: String(life), START_VALUE: "0,0",
        VELOCITY: `${velocity * Math.cos(velocityAngle)},${velocity * Math.sin(velocityAngle)}`,
        ACCELERATION: `${acceleration * Math.cos(accelerationAngle)},${acceleration * Math.sin(accelerationAngle)}` })]
      for (const [type, initial, speed, fallback] of [[2, "INIT_SCALE", "SCALE_SPEED", 1], [3, "INIT_ROTATE", "ROTATE_SPEED", 0], [4, "INIT_ALPHA", "ALPHA_SPEED", 255]] as const) {
        const from = range(initial, fallback)
        const to = from + range(speed, 0) * life / 1000
        const frame = this.add("Keyframe", { TIME: "0,1", VALUE: `${from},${to}` })
        tracks.push(this.add("Anim", { TYPE: String(type), DURATION: String(life), KEYFRAME: type === 2 ? `${frame},${frame}` : frame }))
      }
      const animation = this.add("Anim", { ANIM_SET: tracks.join(","), PLAY_METHOD: "0", START_DELAY: String(delay) })
      const picture = pictures[index % pictures.length]
      return this.add("Anim_Obj", { IMG: picture.file, POS_ANCHOR: "0", RELATETO: "1,1",
        NEW_POS_X: `${(region[0] ?? 0) - 0.5},${(region[0] ?? 0) + (region[2] ?? 0) - 0.5}`,
        NEW_POS_Y: `${(region[1] ?? 0) - 0.5},${(region[1] ?? 0) + (region[3] ?? 0) - 0.5}`,
        RATE_KEY_W: String(picture.width / (size.width * this.scale)),
        RATE_KEY_H: String(picture.height / (size.height * this.scale)), ANIM: animation })
    })
  }

  press(layout: IniDocument, section: string, size: Size, board: Size): string | undefined {
    const fields: Record<string, string> = {}
    const decorations: string[] = []
    const convertedAnimations = new Map<string, ReturnType<BaiduSsfMotion["animation"]>>()
    for (const [field, slot] of [["BACK_ANIM_STYLE", "BG_ANIM"], ["FORE_ANIM_STYLE", "FG_ANIM"]] as const) {
      const style = layout.get(section, field) ?? layout.get(section, "ANIM_STYLE") ?? layout.get(section, field === "BACK_ANIM_STYLE" ? "BACK_STYLE" : "FORE_STYLE")
      const ids = (style ?? "").split(",").map(value => value.trim()).filter(Boolean)
      const parts = ids.flatMap(id => {
        const animation = this.styles.get(`STYLE${id}`, "PRESS_ANIM")?.trim()
        for (const event of ["RELEASE_ANIM", "SHOW_ANIM", "HIDE_ANIM", "FIRST_PRESS_PANEL_ANIM"]) {
          if (this.styles.get(`STYLE${id}`, event)) this.warnings.push(`STYLE${id} 的 ${event} 在搜狗按键动效中没有等价触发方式`)
        }
        if (!animation) return []
        let converted = convertedAnimations.get(animation)
        if (!converted) {
          converted = this.animation(animation, size, board)
          convertedAnimations.set(animation, converted)
          decorations.push(...converted.objects)
        }
        return converted.animation ? [converted] : []
      })
      if (!parts.length) continue
      if (field === "FORE_ANIM_STYLE" && parts.length > 1) this.warnings.push("百度独立前景层动画在搜狗合并为一层播放")
      const objects = parts.map(part => this.add("Anim_Obj", { ANIM: part.animation! }))
      fields[slot] = this.add("Animation", { DOWN_ANIM_OBJ: objects.join(","), ANCHOR: String(parts[0].pivot ?? 0) })
    }
    if (decorations.length) {
      fields.DECO_ANIM = this.add("Animation", { DOWN_ANIM_OBJ: decorations.join(",") })
      fields.DECO_ANIM_NUMBER = "-1"
    }
    return Object.keys(fields).length ? this.add("Anim_Style", fields) : undefined
  }
}
