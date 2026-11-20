// 一个按键的绘制：背景一层、前景层栈、文字，各自带自己的动画变换。
//
// 数据来自渲染项（几何 + 样式引用）；图与文字由调用方事先解析好传进来。
import { canvasFontFamily, isTransparentColor } from "../atlas.ts"
import { colorCss, type SkinLayer, type TextStyle } from "../skin-model/style.ts"
import { paintLayer } from "./layer.ts"
import { drawSceneLayer, type NativeScene, type SceneKey, type SceneLayer } from "../native-scene.ts"
import { withMotion, type SceneSprite } from "../native-motion.ts"
import type { PreviewItem, Rect } from "../preview-items.ts"
import { paddedRect, previewFallbackText, shouldDrawItemBackground } from "../preview-items.ts"
import {
  drawListText,
  drawStyleText,
  foregroundLayerRect,
  foregroundTextPoint,
  withTransform,
} from "../preview-draw.ts"

/** 一个 IR 图层与它按需解码好的位图；新路径直接画这个，不再经过 `Visual`。 */
export type LayerPaint = { layer: SkinLayer; bitmap?: ImageBitmap }

/** 一个键解析后的图与文字；没有就是没解析到。 */
export type KeyVisuals = {
  /** 从模型取的图层；`back`/`fore` 的旧解析结果已经退役。 */
  backLayer?: LayerPaint
  foreLayers?: (LayerPaint | undefined)[]
  /** 键上文字与样式标签，都来自模型的 `text` 层。 */
  textStyle?: TextStyle
  labels?: ReadonlyArray<{ text: string; style: TextStyle } | undefined>
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
  /** 调用方算好的已用时长；没在播就是 undefined。绘制器不自己读时钟。 */
  elapsed?: number
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
  press?: { section: string; elapsed: number; seed: number }
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
  const labels = visual?.labels ?? []
  const foreLayers = visual?.foreLayers ?? []
  const hasForeground = foreLayers.some(Boolean) || labels.some(Boolean)
  const elapsed = animation.elapsed ?? animation.playerElapsed ?? -1
  if (shouldDrawItemBackground(key, env.panelStyle, env.panelWidth, env.panelHeight)) {
    const back = animation.transformOf(animation.backAnim, elapsed, area, "back")
    withTransform(context, area, back.scale, back.translation, back.rotation, back.opacity, () => {
      if (visual?.backLayer) paintLayer(context, visual.backLayer.layer, visual.backLayer.bitmap, area)
    })
  }
  for (let layer = 0; layer < foreLayers.length; layer++) {
    const paint = foreLayers[layer]
    if (!paint) continue
    const style = key.container.fore[layer]?.anim || key.container.press
    const transform = animation.transformOf(style, elapsed, area, "fore")
    const offset = key.container.fore[layer]?.offset
    const source = paint.bitmap
      ? [0, 0, paint.bitmap.width, paint.bitmap.height] as [number, number, number, number]
      : undefined
    const destination = foregroundLayerRect(area, source, offset ? [offset.x, offset.y] : undefined)
    withTransform(context, area, transform.scale, transform.translation, transform.rotation, transform.opacity, () => {
      paintLayer(context, paint.layer, paint.bitmap, destination)
    })
  }
  for (const [layer, label] of labels.entries()) {
    if (!label || foreLayers[layer]) continue
    const style = key.container.fore[layer]?.anim || key.container.press
    const transform = animation.transformOf(style, elapsed, area, "fore")
    const offset = key.container.fore[layer]?.offset
    const unit = key.container.fore[layer]?.offsetUnit
    const point = foregroundTextPoint(area, offset ? [offset.x, offset.y] : undefined, unit)
    withTransform(context, area, transform.scale, transform.translation, transform.rotation, transform.opacity, () => {
      drawStyleText(context, label, point, env.theme)
    })
  }
  env.strokeSelection(key)
  paintKeyText(env, key, area, visual?.textStyle, elapsed, hasForeground, animation)
}

/** 原生场景里的键：图层由场景给，位移按场景坐标缩放。 */
function paintSceneKey(env: KeyPaintEnv, key: PreviewItem, sceneKey: SceneKey | undefined): void {
  const { context } = env
  const press = env.press?.section === key.section ? env.press : undefined
  const pressed = Boolean(press) || env.pressed(key)
  const layers = sceneKey?.layers(pressed)
  if (!sceneKey || !layers) return
  const motion = press && env.scene?.effects?.press(key.section, press.elapsed, press.seed)
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
  textStyle: TextStyle | undefined,
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
    context.fillStyle = textStyle?.color ? colorCss(textStyle.color) : (env.theme === "dark" ? "#f5f5f7" : "#17191c")
    context.font = `${textStyle?.weight ? `${textStyle.weight} ` : ""}${textStyle?.fontSize ?? Math.max(18, Math.min(42, area.height * 0.25))}px ${canvasFontFamily(textStyle?.font)}`
    context.textAlign = "center"
    context.textBaseline = "middle"
    const shadow = textStyle?.shadow
    if (shadow && shadow.size > 0 && !isTransparentColor(colorCss(shadow.color))) {
      context.save()
      context.shadowColor = colorCss(shadow.color)
      context.shadowBlur = shadow.size / 5
      context.shadowOffsetX = shadow.offset?.x ?? 0
      context.shadowOffsetY = shadow.offset?.y ?? shadow.size
      if (key.key.kind === "list-cell") drawListText(context, text, centerX, centerY)
      else context.fillText(text, centerX, centerY)
      context.restore()
    } else if (key.key.kind === "list-cell") {
      drawListText(context, text, centerX, centerY)
    } else {
      context.fillText(text, centerX, centerY)
    }
  })
}

/** 按键的绘制区域由 `paddedRect` 给；这里不再自己算一遍。 */
