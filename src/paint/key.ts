// 一个按键的绘制：背景一层、前景层栈、文字，各自带自己的动画变换。
//
// 数据来自渲染项（几何 + 样式引用）；图与文字由调用方事先解析好传进来。
import { canvasFont, withTextShadow, type StyleTextVisual, type TextVisual, type Visual } from "../atlas.ts"
import { drawSceneLayer, type NativeScene, type SceneKey, type SceneLayer } from "../native-scene.ts"
import { withMotion, type SceneSprite } from "../native-motion.ts"
import type { PreviewItem, Rect } from "../preview-items.ts"
import { paddedRect, previewFallbackText, shouldDrawItemBackground } from "../preview-items.ts"
import {
  drawListText,
  drawStyleText,
  drawVisual,
  foregroundLayerRect,
  foregroundTextPoint,
  phoneForegroundLayers,
  withTransform,
} from "../preview-draw.ts"

/** 一个键解析后的图与文字；没有就是没解析到。 */
export type KeyVisuals = {
  back?: Visual
  fore?: (Visual | undefined)[]
  text?: TextVisual
  styleTexts?: (StyleTextVisual | undefined)[]
}

/** 动画在某一时刻的变换；缺省表示这一项不动。 */
export type KeyTransform = {
  scale?: readonly [number, number]
  translation?: readonly [number, number]
  rotation?: number
  opacity?: number
}

/** 一个键在某个时刻的动画状态：传统动画与 BDA 动画共用一套变换。 */
export type KeyAnimationState = {
  /** 该键自身的动画起播时间；没在播就是 undefined。 */
  startedAt?: number
  /** 播放器正在播这个键时的已用时长。 */
  playerElapsed?: number
  bdaBack: KeyTransform
  bdaFore: KeyTransform
  backAnim?: string
  /** 某个样式在 `elapsed` 时刻的变换；`which` 决定没在播时取哪组 BDA 变换。 */
  transformOf(style: string | undefined, elapsed: number, rect: Rect, which: "back" | "fore"): KeyTransform
}

export type KeyPaintEnv = {
  context: CanvasRenderingContext2D
  theme: "light" | "dark"
  panelStyle: string
  panelWidth: number
  panelHeight: number
  visuals: ReadonlyMap<string, KeyVisuals>
  /** 原生场景：Palm / 搜狗这类有自己的图层模型。 */
  scene?: NativeScene
  sceneKeys: ReadonlyMap<string, SceneKey>
  press?: { section: string; startedAt: number; seed: number }
  pressed(key: PreviewItem): boolean
  sprites: SceneSprite[]
  /** 选中描边由编辑器给，绘制器不碰选择状态。 */
  strokeSelection(key: PreviewItem): void
}

/** 画一个键；原生场景与解析图两条路各自走，样式都已是解析结果。 */
export function paintKey(env: KeyPaintEnv, key: PreviewItem, animation: KeyAnimationState): void {
  const { context } = env
  const sceneKey = env.sceneKeys.get(key.section)
  if (env.scene && (!env.scene.partial || sceneKey)) {
    paintSceneKey(env, key, sceneKey)
    env.strokeSelection(key)
    return
  }
  const area = paddedRect(key)
  const visual = env.visuals.get(key.section)
  const styleTexts = visual?.styleTexts ?? []
  const foregrounds = phoneForegroundLayers(visual?.fore ?? [])
  const hasForeground = foregrounds.some(Boolean) || styleTexts.some(Boolean)
  const elapsed = animation.playerElapsed ?? (
    animation.startedAt === undefined ? -1 : Date.now() - animation.startedAt
  )
  if (shouldDrawItemBackground(key, env.panelStyle, env.panelWidth, env.panelHeight)) {
    const back = animation.transformOf(animation.backAnim, elapsed, area, "back")
    withTransform(context, area, back.scale, back.translation, back.rotation, back.opacity, () => {
      drawVisual(context, visual?.back, area, true)
    })
  }
  for (const [layer, fore] of foregrounds.entries()) {
    const style = key.container.fore[layer]?.anim || key.container.press
    const transform = animation.transformOf(style, elapsed, area, "fore")
    const offset = key.container.fore[layer]?.offset
    const destination = foregroundLayerRect(area, fore?.source, offset ? [offset.x, offset.y] : undefined)
    withTransform(context, area, transform.scale, transform.translation, transform.rotation, transform.opacity, () => {
      drawVisual(context, fore, destination, false)
    })
  }
  for (const [layer, styleText] of styleTexts.entries()) {
    if (!styleText || foregrounds[layer]) continue
    const style = key.container.fore[layer]?.anim || key.container.press
    const transform = animation.transformOf(style, elapsed, area, "fore")
    const offset = key.container.fore[layer]?.offset
    const point = foregroundTextPoint(area, offset ? [offset.x, offset.y] : undefined)
    withTransform(context, area, transform.scale, transform.translation, transform.rotation, transform.opacity, () => {
      drawStyleText(context, styleText, point, env.theme)
    })
  }
  env.strokeSelection(key)
  paintKeyText(env, key, area, visual?.text, elapsed, hasForeground, animation)
}

/** 原生场景里的键：图层由场景给，位移按场景坐标缩放。 */
function paintSceneKey(env: KeyPaintEnv, key: PreviewItem, sceneKey: SceneKey | undefined): void {
  const { context } = env
  const press = env.press?.section === key.section ? env.press : undefined
  const pressed = Boolean(press) || env.pressed(key)
  const layers = sceneKey?.layers(pressed)
  if (!sceneKey || !layers) return
  const motion = press && env.scene?.effects?.press(key.section, Date.now() - press.startedAt, press.seed)
  if (motion) env.sprites.push(...motion.sprites)
  // 场景图层摆在皮肤给的位置上；键被拖动时跟着走。
  const draw = (group: SceneLayer[]) => {
    context.save()
    context.translate(key.rect.x, key.rect.y)
    context.scale(key.rect.width / sceneKey.rect.width, key.rect.height / sceneKey.rect.height)
    context.translate(-sceneKey.rect.x, -sceneKey.rect.y)
    for (const layer of group) drawSceneLayer(context, layer)
    context.restore()
  }
  withMotion(context, key.rect, motion?.back, () => draw(layers.back))
  layers.fore.forEach((layer, index) => {
    withMotion(context, key.rect, motion?.fore[layers.groups?.[index] ?? 0], () => draw([layer]))
  })
}

/** 没有前景图层时画在键上的文本。 */
function paintKeyText(
  env: KeyPaintEnv,
  key: PreviewItem,
  area: { x: number; y: number; width: number; height: number },
  textVisual: TextVisual | undefined,
  elapsed: number,
  hasForeground: boolean,
  animation: KeyAnimationState,
): void {
  const text = previewFallbackText(key, hasForeground)
  if (!text) return
  const { context } = env
  const transform = animation.transformOf(key.container.press, elapsed, area, "fore")
  withTransform(context, area, transform.scale, transform.translation, transform.rotation, transform.opacity, () => {
    const centerX = area.x + area.width / 2
    const centerY = area.y + area.height / 2
    context.fillStyle = textVisual?.color ?? (env.theme === "dark" ? "#f5f5f7" : "#17191c")
    context.font = canvasFont(textVisual?.fontSize ?? Math.max(18, Math.min(42, area.height * 0.25)), textVisual)
    context.textAlign = "center"
    context.textBaseline = "middle"
    withTextShadow(context, textVisual, () => {
      if (key.section.startsWith("LIST:")) drawListText(context, text, centerX, centerY)
      else context.fillText(text, centerX, centerY)
    })
  })
}

/** 按键的绘制区域由 `paddedRect` 给；这里不再自己算一遍。 */
