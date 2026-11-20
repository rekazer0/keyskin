// 面板的一帧：取数与绘制分开，浏览器预览与 Node 出图共用。
//
// 这里只认 `SkinModel`、`Board` 与渲染参数；不认识 DOM、`Preview` 或编辑器的选中/拖拽状态。
import type { Size } from "taffy-layout"
import type { Board } from "../skin-model/board.ts"
import { containerOf } from "../skin-model/board.ts"
import type { SkinModel } from "../skin-model/model.ts"
import type { KeyRender } from "../skin-model/build.ts"
import type { ToolbarItem } from "../skin-model/panel.ts"
import { bitmapOf } from "../skin-model/image.ts"
import { styleLabel, styleLayers, styleText } from "../skin-model/style.ts"
import type { Rect } from "../preview-items.ts"
import { isFullPanelPreviewItem, keyAnimationStyles, persistVisible, previewSurfaceColor } from "../preview-items.ts"
import { actionText } from "../skin-model/inspect.ts"
import { boardRenders } from "./board.ts"
import { paintKey, type KeyAnimationState, type KeyPaintEnv, type KeyVisuals, type LayerPaint } from "./key.ts"
import { paintLayer } from "./layer.ts"
import { paintParticles, type ParticleFrame } from "./particles.ts"
import { hintCellWidth, paintHintBubble, type HintPaintData } from "./hint.ts"
import { drawSceneLayer, type NativeScene, type SceneKey, type SceneLayer } from "../native-scene.ts"
import { drawSprite, type SceneSprite } from "../native-motion.ts"
import {
  hintKeyOf,
  isLegacyHintInputKey,
  legacyHintCandidates,
  legacyHintIconID,
  type HintKey,
  type LegacyHint,
} from "../preview-hints.ts"
import {
  bdaAnimationBindingsForKey,
  bdaBindingEffects,
  bdaParticleEmitter,
  bdaTransforms,
  legacyAnimationOpacity,
  legacyAnimationRotation,
  legacyAnimationScale,
  legacyAnimationTranslation,
  legacyParticleFrames,
  type LegacyAnimation,
} from "../preview-animation.ts"
import type { BdaAnimation } from "../bda.ts"
import type { PreviewClip } from "../animation-preview-model.ts"

export type HintDirection = "center" | "up" | "down" | "left" | "right" | "hold"

/** 已用毫秒，全部由调用方提供；绘制器不读时钟。 */
export type PanelTime = {
  /** 各段按下动画已用毫秒；键在表里就是按下的。 */
  pressed?: ReadonlyMap<string, number>
  /** 面板显示动画已用毫秒；缺省没在播。 */
  panel?: number
  /** BDA 动画正在播的段与已用毫秒。 */
  bda?: { section: string; elapsed: number }
  /** 播放器：粒子与已用毫秒。 */
  player?: { particles: PreviewClip["particles"]; elapsed: number; section?: string; motion?: boolean }
  /** 原生按键动画：段、已用毫秒、种子。 */
  nativePress?: { section: string; elapsed: number; seed: number }
  /** 场景出现后已过毫秒（场景自己的面板效果）。 */
  sceneShown?: number
}

/** 出图与预览共用的面板渲染参数。 */
export type PanelOptions = {
  theme: "light" | "dark"
  /** 按下的段；空集就是静止状态。 */
  pressed?: ReadonlySet<string>
  /** 列表格当前显示的条目；缺省用 IR 的默认内容。 */
  contentOf?: (section: string) => string | undefined
  /** 输出像素倍率；缺省 1，只影响 `PanelFrame.pixelScale`，不改逻辑坐标。 */
  pixelScale?: number
  /**
   * 完整面板合成：给了这个就以它决定顶栏画候选栏（true）还是工具栏（false），
   * 板整体下移到顶栏下方。缺省不合成——预览的两块画布各自显示自己的部分。
   */
  composing?: boolean
  /** 画布尺寸；缺省按板容器（合成顶栏时再加顶栏高）。预览用它表示自己的画布。 */
  container?: Size<number>
  /** 已算好的渲染项（板坐标）；缺省用 `boardRenders(board, state)`。 */
  items?: readonly KeyRender[]
  /** items 缺省时用它调 `boardRenders`。 */
  state?: number
  /** 面板样式 id；缺省取板自己的 backdrop。 */
  panelStyle?: string
  /** 面板显示动画用的样式名；缺省同 `panelStyle`。 */
  panelAnimationStyle?: string
  /** 动画时刻；缺省静止。 */
  time?: PanelTime
  /** 旧格式按键动画；缺省没有。 */
  legacyAnimation?: LegacyAnimation
  /** 面板显示动画（SHOW_ANIM）；缺省没有。 */
  showAnimation?: LegacyAnimation
  /** BDA 动画；缺省没有。 */
  animation?: BdaAnimation
  /** 原生场景（Palm/搜狗）；缺省没有，按普通键绘制。 */
  scene?: NativeScene
  /** 提示气泡的当前方向与选中格；缺省没有气泡。 */
  hint?: { section: string; direction: HintDirection; index?: number }
  /** 旧格式提示配置；缺省没有气泡图。 */
  hintConfig?: { short?: LegacyHint; long?: LegacyHint; defaults: boolean }
  /** AI 草稿对某键某一层的样式替换；编辑器专用输入，出图不传。 */
  draft?: { section: string; foreground: boolean; layer: number; styleID?: string; pressed: boolean }
  /** 不填底色（编辑器透明预览）；缺省按 theme 填。 */
  transparent?: boolean
}

/** 顶栏里的一个图标：已解码的图层与它在完整面板里的矩形。 */
export type PanelHeaderItem = {
  rect: Rect
  back?: LayerPaint
  fore?: LayerPaint
}

/** 顶栏里的一条：候选栏或工具栏，图标按各自的锚点定位。 */
export type PanelStrip = {
  rect: Rect
  items: readonly PanelHeaderItem[]
  /** 候选词显示区（`role` 为 candidates 的项）；没有就是 undefined。 */
  candidatesRect?: Rect
}

/** 顶栏：输入中画候选栏，未输入画工具栏。 */
export type PanelHeaderFrame = {
  /** 顶栏在完整面板里的矩形。 */
  rect: Rect
  /** 候选栏（BDS 一条、BDA 可能多条）。 */
  candidates: readonly PanelStrip[]
  toolbar?: PanelStrip
  /** 候选栏背景层。 */
  background?: LayerPaint
}

/** 气泡：原生场景弹层，或旧格式气泡的绘制数据。 */
export type PanelHintFrame = {
  key: HintKey
  anchor: Rect
  /** 原生场景的长按弹层；有就画它，不画气泡。 */
  popup?: readonly SceneLayer[]
  /** 旧格式气泡；没有图标时没有。 */
  data?: HintPaintData
  /** 柱状候选的格子宽度；指针命中用。 */
  cellWidth?: number
}

/** 一帧面板的全部可绘制数据。 */
export type PanelFrame = {
  /** 完整面板尺寸（含顶栏）。 */
  container: Size<number>
  /** 板在完整面板里的位置；`items` 仍是板坐标。 */
  board: Rect
  /** 输出像素倍率（来自 options）；出图工具据此建画布。 */
  pixelScale: number
  /** 排序后的渲染项：整板键在底、按下的键在上；不含顶栏的 CAND。 */
  items: readonly KeyRender[]
  /** 按下的段；绘制与命中都只用它。 */
  pressed: ReadonlySet<string>
  /** 每键已解析的图与文字。 */
  visuals: ReadonlyMap<string, KeyVisuals>
  /** 每键已算好的动画时刻。 */
  animations: ReadonlyMap<string, KeyAnimationState>
  /** 面板背景图层（PANEL 样式）；没有就是无色。 */
  panelLayer?: LayerPaint
  /** 原生场景背景层。 */
  background: readonly SceneLayer[]
  /** 原生场景；没有就是普通键。 */
  scene?: NativeScene
  sceneKeys: ReadonlyMap<string, SceneKey>
  /** 顶栏；没有顶栏数据就是 undefined。 */
  header?: PanelHeaderFrame
  /** 气泡；没有就是 undefined。 */
  hint?: PanelHintFrame
  /** 粒子帧（面板/按键/BDA/播放器）。 */
  particles: readonly ParticleFrame[]
  /** 粒子图；按 `styleID` 取。 */
  particleVisuals: ReadonlyMap<string, LayerPaint>
  /** 场景自己的面板效果（build 时按 time 算好）。 */
  panelSprites: readonly SceneSprite[]
  /** 画布底色；透明时没有。 */
  surfaceColor?: string
  /** 整板样式 id，用于「背景与整板样式相同就不重画」。 */
  panelStyle: string
  /** 原生按键动画；没有就是 undefined。 */
  press?: { section: string; elapsed: number; seed: number }
}

/** 从模型取一个样式 id 的图层与位图；没有样式或没有可画图层就是 undefined。
 *
 * 编辑器侧的缩略图与预览也从这里取，不要在别处再拼一份样式装配。 */
export async function paintLayerOf(model: SkinModel, styleID: string, highlighted = false): Promise<LayerPaint | undefined> {
  const layers = styleLayers(model, styleID, highlighted)
  const image = layers.find((layer) => layer.kind === "image")
  if (image?.kind === "image") {
    const source = model.images.get(image.image)
    return { layer: image, ...(source ? { bitmap: await bitmapOf(source) } : {}) }
  }
  const color = layers.find((layer) => layer.kind === "color")
  return color ? { layer: color } : undefined
}

/** 动画与粒子引用的是包里的原始资源名；按模型里的索引换算成图片图层。 */
async function resourcePaintOf(model: SkinModel, resourceID: string): Promise<LayerPaint | undefined> {
  const imageID = model.resourceIndex.get(resourceID) ?? resourceID
  const image = model.images.get(imageID)
  if (!image) return undefined
  const bitmap = await bitmapOf(image)
  return bitmap ? { layer: { kind: "image", image: imageID }, bitmap } : undefined
}

/** 可见项按绘制顺序排：整板键在底、普通项居中、按下的键在上；合成顶栏时 CAND 由顶栏代理。 */
function orderItems(
  items: readonly KeyRender[],
  size: Size<number>,
  pressed: ReadonlySet<string>,
  stripCandidates: boolean,
): KeyRender[] {
  const rank = (item: KeyRender): number => {
    if (item.sections.some((section) => pressed.has(section))) return 2
    return isFullPanelPreviewItem(item, size.width, size.height) ? 0 : 1
  }
  return items
    .filter((item) => item.visible !== false)
    .filter((item) => !stripCandidates || !/^CAND\d*$/i.test(item.section))
    .sort((left, right) => rank(left) - rank(right))
}

/** 顶栏的 CAND 渲染项已经由 `header` 代理；这里只留板上的键与其它组件。 */
function withContent(items: KeyRender[], contentOf: PanelOptions["contentOf"]): KeyRender[] {
  if (!contentOf) return items
  return items.map((item) => {
    const content = contentOf(item.section)
    return content === undefined ? item : { ...item, text: content }
  })
}

function isPressed(item: KeyRender, pressed: ReadonlySet<string>): boolean {
  return item.sections.some((section) => pressed.has(section))
}

async function buildVisuals(
  model: SkinModel,
  items: readonly KeyRender[],
  options: PanelOptions,
  pressed: ReadonlySet<string>,
): Promise<Map<string, KeyVisuals>> {
  const entries = await Promise.all(items.map(async (item): Promise<[string, KeyVisuals]> => {
    const draft = options.draft && item.sections.includes(options.draft.section) ? options.draft : undefined
    const foreStyles = [...item.foreStyles]
    if (draft?.foreground) foreStyles[draft.layer] = draft.styleID ?? ""
    const highlighted = isPressed(item, pressed) || Boolean(draft?.pressed)
    const backID = highlighted ? item.highlightBackStyle ?? item.backStyle ?? "" : item.backStyle ?? ""
    return [item.section, {
      backLayer: await paintLayerOf(model, backID, highlighted),
      foreLayers: await Promise.all(foreStyles.map((style) => paintLayerOf(model, style, highlighted))),
      textStyle: styleText(model, foreStyles.join(","), highlighted),
      // 列表格显示自己的条目，不取共享样式里的标签。
      labels: item.key.kind === "list-cell" ? [] : foreStyles.map((style) => styleLabel(model, style, highlighted)),
    }]
  }))
  return new Map(entries)
}

function buildAnimations(
  items: readonly KeyRender[],
  options: PanelOptions,
  time: PanelTime,
): Map<string, KeyAnimationState> {
  const animations = new Map<string, KeyAnimationState>()
  for (const item of items) {
    animations.set(item.section, animationOf(item))
  }
  return animations

  function animationOf(item: KeyRender): KeyAnimationState {
    const bdaElapsed = time.bda?.section === item.section ? time.bda.elapsed : -1
    const bdaBack = bdaTransforms(options.animation, item, bdaElapsed, "back")
    const bdaFore = bdaTransforms(options.animation, item, bdaElapsed, "fore")
    const elapsed = time.pressed?.get(item.section)
    const playerElapsed = time.player?.section === item.section ? time.player.elapsed : undefined
    return {
      ...(elapsed === undefined ? {} : { elapsed }),
      ...(playerElapsed === undefined ? {} : { playerElapsed }),
      bdaBack,
      bdaFore,
      ...(item.container.back?.anim ? { backAnim: item.container.back.anim } : {}),
      transformOf: (style, at, rect, which) => at < 0
        ? (which === "back" ? bdaBack : bdaFore)
        : {
          scale: legacyAnimationScale(options.legacyAnimation, style, at),
          translation: legacyAnimationTranslation(options.legacyAnimation, style, at, rect),
          rotation: legacyAnimationRotation(options.legacyAnimation, style, at),
          opacity: legacyAnimationOpacity(options.legacyAnimation, style, at),
        },
    }
  }
}

/** 面板、按键、BDA 与播放器的粒子；全部按已用时长算，不读时钟。 */
function buildParticles(
  items: readonly KeyRender[],
  size: Size<number>,
  options: PanelOptions,
  time: PanelTime,
): ParticleFrame[] {
  const panelStyle = options.panelAnimationStyle ?? options.panelStyle ?? ""
  const frames: ParticleFrame[] = []
  const panelEffect = options.showAnimation?.get(panelStyle) ?? options.legacyAnimation?.get(panelStyle)
  const panelElapsed = time.panel ?? -1
  if (panelElapsed >= 0) {
    for (const emitter of panelEffect?.particles ?? []) {
      frames.push(...legacyParticleFrames(emitter, panelElapsed, size.width, size.height))
    }
  }
  const player = time.player
  if (player) {
    const target = player.section ? items.find((item) => item.section === player.section) : undefined
    const rect = target?.rect ?? { x: 0, y: 0, width: size.width, height: size.height }
    for (const clip of player.particles) {
      if (player.elapsed < clip.start || player.elapsed > clip.start + clip.duration) continue
      frames.push(...legacyParticleFrames(clip.emitter, player.elapsed - clip.start, rect.width, rect.height)
        .map((frame) => ({ ...frame, x: frame.x + rect.x, y: frame.y + rect.y })))
    }
  }
  const bda = time.bda
  const bdaItem = bda ? items.find((item) => item.section === bda.section) : undefined
  if (bda && bdaItem && options.animation && player?.section !== bda.section) {
    for (const binding of bdaAnimationBindingsForKey(options.animation, bdaItem)) {
      for (const effect of bdaBindingEffects(options.animation, binding)) {
        if (effect.kind !== "emitter" || !effect.resources.length) continue
        frames.push(...legacyParticleFrames(
          bdaParticleEmitter(effect), bda.elapsed, bdaItem.rect.width, bdaItem.rect.height,
        ).map((frame) => ({ ...frame, x: frame.x + bdaItem.rect.x, y: frame.y + bdaItem.rect.y })))
      }
    }
  }
  for (const [section, elapsed] of time.pressed ?? []) {
    if (player?.section === section) continue
    const item = items.find((each) => each.section === section)
    if (!item) continue
    const emitters = keyAnimationStyles(item, panelStyle)
      .flatMap((style) => options.legacyAnimation?.get(style)?.particles ?? [])
    for (const emitter of emitters) {
      frames.push(...legacyParticleFrames(emitter, elapsed, item.rect.width, item.rect.height)
        .map((frame) => ({ ...frame, x: frame.x + item.rect.x, y: frame.y + item.rect.y })))
    }
  }
  return frames
}

/** 顶栏项的矩形：`offset` 相对 `anchor` 给的锚点线，不是面板左上角。
 *
 * 右/下锚点按边界定位：图标左边缘在 `右边界 + offset`（`offset` 为负即贴右），
 * 与左/上锚点对称，不做「再减图标宽」的二次换算。 */
function anchoredRect(item: ToolbarItem, bar: Rect): Rect {
  const offset = item.offset ?? { x: 0, y: 0 }
  const size = item.size ?? { width: bar.width, height: bar.height }
  const x = item.anchor?.x === "center"
    ? bar.x + bar.width / 2 + offset.x
    : item.anchor?.x === "right" ? bar.x + bar.width + offset.x : bar.x + offset.x
  const y = item.anchor?.y === "middle"
    ? bar.y + bar.height / 2 + offset.y
    : item.anchor?.y === "bottom" ? bar.y + bar.height + offset.y : bar.y + offset.y
  return { x, y, width: size.width, height: size.height }
}

/** 一条候选栏/工具栏：图标按锚点定位并取样式图层，候选词项的矩形单独给出。
 *
 * 可见时机按 `PERSIST` 在取数阶段过滤，`frame` 里只留该显示的项。 */
async function buildStrip(
  model: SkinModel,
  bar: Rect,
  items: readonly ToolbarItem[],
  composing: boolean,
): Promise<PanelStrip> {
  const shown = items.filter((item) => item.visible !== false && persistVisible(item.persist, composing))
  const built = await Promise.all(shown.map(async (item): Promise<PanelHeaderItem> => {
    const rect = anchoredRect(item, bar)
    if (item.role === "candidates") return { rect }
    const [back, fore] = await Promise.all([
      item.backStyle ? paintLayerOf(model, item.backStyle) : undefined,
      item.foreStyle ? paintLayerOf(model, item.foreStyle) : undefined,
    ])
    return { rect, ...(back ? { back } : {}), ...(fore ? { fore } : {}) }
  }))
  const candidates = shown.find((item) => item.role === "candidates")
  return {
    rect: bar,
    items: built,
    ...(candidates ? { candidatesRect: anchoredRect(candidates, bar) } : {}),
  }
}

/** 顶栏：输入中画候选栏（图标按 `PERSIST` 过滤）；未输入画工具栏，皮肤没给图标时只画背景。 */
async function buildHeader(
  model: SkinModel,
  board: Board,
  size: Size<number>,
  composing: boolean,
): Promise<PanelHeaderFrame | undefined> {
  const bars = (board.panels?.candidates ?? []).filter((bar) => bar.viewRect)
  const first = bars[0]
  if (composing && first?.viewRect) {
    const height = first.viewRect.size.height
    const strips = await Promise.all(bars.map(async (bar): Promise<PanelStrip> => {
      const rect = { x: 0, y: 0, width: size.width, height: bar.viewRect?.size.height ?? height }
      return buildStrip(model, rect, bar.icons ?? [], composing)
    }))
    return {
      rect: { x: 0, y: 0, width: size.width, height },
      candidates: strips,
      ...(first.style ? { background: await paintLayerOf(model, first.style) } : {}),
    }
  }
  const toolbar = board.panels?.toolbar
  const toolbarHeight = toolbar?.height ?? toolbar?.iconSize?.height ?? 0
  if (toolbar && toolbarHeight > 0) {
    const rect = { x: 0, y: 0, width: size.width, height: toolbarHeight }
    return {
      rect,
      candidates: [],
      toolbar: await buildStrip(model, rect, toolbar.items, composing),
      ...(toolbar.style ? { background: await paintLayerOf(model, toolbar.style) } : {}),
    }
  }
  // 未输入且皮肤没给工具栏图标：顶栏仍占位，只画候选栏区域的背景。
  if (first?.viewRect) {
    const height = first.viewRect.size.height
    return {
      rect: { x: 0, y: 0, width: size.width, height },
      candidates: [],
      ...(first.style ? { background: await paintLayerOf(model, first.style) } : {}),
    }
  }
  return undefined
}

/** 顶栏是否已经占在板容器内：按键从顶栏下方开始，就不再加高画布。 */
function headerInset(header: PanelHeaderFrame | undefined, items: readonly KeyRender[]): number {
  if (!header) return 0
  const keys = items.filter((item) => item.editable)
  if (!keys.length) return header.rect.height
  const top = Math.min(...keys.map((item) => item.rect.y))
  return top >= header.rect.height ? 0 : header.rect.height
}

/** 气泡：旧格式按提示配置取图与候选，原生场景的长按弹层直接用它自己的图层。 */
async function buildHint(
  model: SkinModel,
  items: readonly KeyRender[],
  sceneKeys: ReadonlyMap<string, SceneKey>,
  options: PanelOptions,
  size: Size<number>,
): Promise<PanelHintFrame | undefined> {
  const state = options.hint
  if (!state) return undefined
  const item = items.find((each) => each.section === state.section)
  if (!item) return undefined
  const config = state.direction === "hold"
    ? options.hintConfig?.long ?? options.hintConfig?.short
    : options.hintConfig?.short
  const key = hintKeyOf(item)
  const popup = state.direction === "hold" ? sceneKeys.get(item.section)?.holdPopup : undefined
  const popupLayers = popup?.layers(state.index ?? popup.selected)
  const candidates = state.direction === "hold" || state.direction === "up" && config?.upIcon
    ? legacyHintCandidates(key, state.direction, options.hintConfig?.defaults ?? false)
    : []
  const bar = candidates.length > 0 && Boolean(config?.barIcon)
  const iconID = bar ? config?.barIcon : legacyHintIconID(config, state.direction)
  const icon = iconID ? config?.icons.get(iconID) : undefined
  const shouldDraw = Boolean(popupLayers?.length || (isLegacyHintInputKey(key) || candidates.length) && icon)
  if (!shouldDraw) return undefined
  if (!icon) return { key, anchor: item.rect, ...(popupLayers?.length ? { popup: popupLayers } : {}) }
  const cellStyle = icon.cellStyle ?? config?.cellStyle
  const [background, foreground] = await Promise.all([
    paintLayerOf(model, icon.backStyle ?? ""),
    paintLayerOf(model, icon.foreStyle ?? ""),
  ])
  const data: HintPaintData = {
    size: icon.size,
    position: icon.position,
    padding: icon.padding,
    ...(background ? { background } : {}),
    ...(foreground ? { foreground } : {}),
    candidates,
    cellVisuals: bar && cellStyle
      ? await Promise.all([paintLayerOf(model, cellStyle), paintLayerOf(model, cellStyle, true)])
      : [undefined, undefined],
    ...(icon.foreStyle ? { textStyle: styleText(model, icon.foreStyle, false) } : {}),
    ...(icon.foreStyle ? { selectedTextStyle: styleText(model, icon.foreStyle, true) } : {}),
    ...(icon.cellSize ?? config?.cellSize ? { cellSize: icon.cellSize ?? config?.cellSize } : {}),
    direction: state.direction,
    bar,
    panelWidth: size.width,
    dark: options.theme === "dark",
  }
  const width = hintCellWidth(data)
  return {
    key,
    anchor: item.rect,
    data,
    ...(width === undefined ? {} : { cellWidth: width }),
    ...(popupLayers?.length ? { popup: popupLayers } : {}),
  }
}

export async function buildPanelFrame(
  model: SkinModel,
  board: Board,
  options: PanelOptions,
): Promise<PanelFrame> {
  const size = containerOf(board)
  if (!size) throw new Error(`板「${board.id}」没有容器尺寸，无法构建面板帧`)
  const pressed = options.pressed ?? new Set<string>()
  const time = options.time ?? {}
  const panelStyle = options.panelStyle ?? board.panels?.backdrop?.style ?? board.backdrop ?? ""
  const scene = options.scene
  const sceneKeys = new Map((scene?.keys ?? []).map((key) => [key.section, key]))
  const source = options.items ?? await boardRenders(board, options.state)
  const header = options.composing === undefined ? undefined : await buildHeader(model, board, size, options.composing)
  // 合成完整面板时 CAND 由顶栏代理；预览不合成，保留在自己的画布上。
  const items = withContent(
    orderItems(source, size, pressed, options.composing !== undefined),
    options.contentOf,
  )
  const replaced = Boolean(scene && !scene.partial)
  const inset = headerInset(header, items)
  const container = options.container ?? { width: size.width, height: size.height + inset }
  const boardRect = { x: 0, y: options.container ? 0 : inset, width: size.width, height: size.height }
  const visuals = replaced
    ? new Map<string, KeyVisuals>()
    : await buildVisuals(model, items, options, pressed)
  const hint = await buildHint(model, items, sceneKeys, options, size)
  const particles = buildParticles(items, size, options, time)
  const particleStyleIDs = [...new Set(particles.map((frame) => frame.styleID))]
  const particleVisuals = new Map((await Promise.all(
    particleStyleIDs.map(async (styleID): Promise<[string, LayerPaint | undefined]> =>
      [styleID, await resourcePaintOf(model, styleID)]),
  )).filter((entry): entry is [string, LayerPaint] => entry[1] !== undefined))
  return {
    container,
    board: boardRect,
    pixelScale: options.pixelScale ?? 1,
    items,
    pressed,
    visuals,
    animations: buildAnimations(items, options, time),
    ...(replaced ? {} : { panelLayer: await paintLayerOf(model, panelStyle) }),
    background: scene?.background ?? [],
    ...(scene ? { scene } : {}),
    sceneKeys,
    ...(header ? { header } : {}),
    ...(hint ? { hint } : {}),
    particles,
    particleVisuals,
    panelSprites: scene?.effects?.panel?.(time.sceneShown ?? 0, time.nativePress) ?? [],
    surfaceColor: options.transparent ? undefined : previewSurfaceColor(options.theme, false),
    panelStyle,
    ...(time.nativePress ? { press: time.nativePress } : {}),
  }
}

/** 绘制接缝：编辑器把气泡/覆盖层画到自己的画布，并在键画完时叠加选中描边。 */
export type PanelPaintHooks = {
  /** 气泡与覆盖层精灵画到这里；缺省画主画布。 */
  overlay?: CanvasRenderingContext2D
  /** 每键画完后调用；缺省不叠加。 */
  onItemPainted?: (item: KeyRender) => void
}

/** 只画 `frame` 里已有的东西：不查模型，不认编辑器状态。
 *
 * `options` 必须与生成这一帧的 `buildPanelFrame` 同一份：`theme` 决定文字颜色，
 * `composing` 决定顶栏画候选栏还是工具栏。 */
export function paintPanel(
  context: CanvasRenderingContext2D,
  frame: PanelFrame,
  options: PanelOptions,
  hooks: PanelPaintHooks = {},
): void {
  const { width, height } = frame.container
  if (frame.surfaceColor) {
    context.fillStyle = frame.surfaceColor
    context.fillRect(0, 0, width, height)
  }
  if (frame.header) {
    const header = frame.header
    if (header.background) paintLayer(context, header.background.layer, header.background.bitmap, header.rect)
    // 原生场景已经画了 F14 那条时不重复画。
    const sceneOwnsToolbar = Boolean(frame.scene && (!frame.scene.partial || frame.items.some(
      (item) => actionText(item.key.actions?.press) === "F14" && frame.sceneKeys.has(item.section),
    )))
    // 顶栏的可见项已经在取数时按 PERSIST 过滤；候选栏在时画候选栏，否则画工具栏。
    const strips = sceneOwnsToolbar ? [] : header.candidates.length ? header.candidates : header.toolbar ? [header.toolbar] : []
    for (const strip of strips) {
      for (const item of strip.items) {
        if (item.back) paintLayer(context, item.back.layer, item.back.bitmap, item.rect)
        if (item.fore) paintLayer(context, item.fore.layer, item.fore.bitmap, item.rect)
      }
    }
  }
  // 板在完整面板里有偏移时整体平移；没有偏移就不碰调用方的画布状态。
  const offset = frame.board.x !== 0 || frame.board.y !== 0
  if (offset) {
    context.save()
    context.translate(frame.board.x, frame.board.y)
  }
  if (frame.scene) {
    for (const layer of frame.background) drawSceneLayer(context, layer)
  } else if (frame.panelLayer) {
    paintLayer(context, frame.panelLayer.layer, frame.panelLayer.bitmap, {
      x: 0, y: 0, width: frame.board.width, height: frame.board.height,
    })
  }
  const sprites: SceneSprite[] = []
  const env: KeyPaintEnv = {
    context,
    theme: options.theme,
    panelStyle: frame.panelStyle,
    panelWidth: frame.board.width,
    panelHeight: frame.board.height,
    visuals: frame.visuals,
    ...(frame.scene ? { scene: frame.scene } : {}),
    sceneKeys: frame.sceneKeys,
    ...(frame.press ? { press: frame.press } : {}),
    pressed: (key) => isPressed(key, frame.pressed),
    sprites,
    strokeSelection: () => {},
  }
  for (const item of frame.items) {
    const animation = frame.animations.get(item.section)
    if (animation) paintKey(env, item, animation)
    hooks.onItemPainted?.(item)
  }
  const overlay = hooks.overlay
  for (const sprite of [...frame.panelSprites, ...sprites]) {
    drawSprite(sprite.overlay && overlay ? overlay : context, sprite)
  }
  if (frame.hint) {
    const target = overlay ?? context
    if (frame.hint.popup?.length) {
      for (const layer of frame.hint.popup) drawSceneLayer(target, layer)
    } else if (frame.hint.data) {
      paintHintBubble(target, frame.hint.key, frame.hint.anchor, frame.hint.data)
    }
  }
  paintParticles(context, frame.particles, (styleID) => frame.particleVisuals.get(styleID))
  if (offset) context.restore()
}

/** 命中测试：只查 `frame.items`，从后往前找第一个可见且包含点的项。 */
export function hitTest(frame: PanelFrame, point: { x: number; y: number }): KeyRender | undefined {
  for (let index = frame.items.length - 1; index >= 0; index -= 1) {
    const item = frame.items[index]
    if (item.visible === false) continue
    const { x, y, width, height } = item.rect
    if (point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height) return item
  }
  return undefined
}
