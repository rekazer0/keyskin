import type { Preview } from "./preview.ts"
import { drawMeasurements } from "./preview-measurements.ts"
import { legacyParticleFrames } from "./preview-animation.ts"
import { drawSprite, type SceneSprite } from "./native-motion.ts"
import { scheduleNativeFrame } from "./preview-native.ts"
import { bdaAnimationBindingsForKey } from "./preview-animation.ts"
import { bdaBindingEffects } from "./preview-animation.ts"
import { bdaParticleEmitter } from "./preview-animation.ts"
import { hintKeyOf, legacyHintCandidates } from "./preview-hints.ts"
import { legacyHintIconID } from "./preview-hints.ts"
import { type Visual } from "./atlas.ts"
import { previewSurfaceColor, isFullPanelPreviewItem } from "./preview-items.ts"
import { actionText } from "./skin-model/inspect.ts"
import { drawVisual } from "./preview-draw.ts"
import { paintMarquee } from "./paint/marquee.ts"
import { paintHintBubble } from "./paint/hint.ts"
import { paintKey, type KeyAnimationState, type KeyPaintEnv } from "./paint/key.ts"
import { paintParticles } from "./paint/particles.ts"
import { strokeDraft, strokeSelected } from "./paint/selection.ts"
import { previewSelectionVisible } from "./preview-items.ts"
import { bdaTransforms } from "./preview-animation.ts"
import { legacyAnimationScale } from "./preview-animation.ts"
import { legacyAnimationTranslation } from "./preview-animation.ts"
import { legacyAnimationRotation } from "./preview-animation.ts"
import { legacyAnimationOpacity } from "./preview-animation.ts"
import { isLegacyHintInputKey } from "./preview-hints.ts"
import { setCanvasSize } from "./preview-draw.ts"
import { keyAnimationStyles } from "./preview-items.ts"
import { type PreviewItem } from "./preview-items.ts"
import { DEFAULT_PANEL_WIDTH } from "./keyboard.ts"
import { drawSceneLayer } from "./native-scene.ts"
import { paintToolbarStrip } from "./paint/toolbar.ts"

export async function paintPreview(self: Preview): Promise<void> {
  const drawID = ++self.drawID
  const isDragging = Boolean(self.editDrag)

  // 拖拽时跳过 resolver 的 ready 等待，使用已缓存的数据
  if (!isDragging) {
    try {
      await self.resolver?.ready?.()
    } catch (error) {
      console.warn("预览解析准备失败:", error)
      return
    }
  }

  // A native scene (Palm, Sogou) replaces the resolver's panel, key and toolbar visuals.
  // A running animation keeps the painted scene while the next one (a press refreshes it) builds.
  const next = self.sceneForState()
  const animating = self.drawnScene && (self.nativePress || self.drawnScene.effects?.panel)
  const scene = next && animating && !self.builtScenes.has(next) ? self.drawnScene : await next?.catch((error) => {
    console.warn("预览场景生成失败:", error)
    return undefined
  })
  const sceneKeys = new Map(scene?.keys.map((key) => [key.section, key]))
  const panelAnimationElapsed = self.legacyPanelAnimationStartedAt
    ? Date.now() - self.legacyPanelAnimationStartedAt
    : -1
  // 面板自己的粒子：先看面板的显示动画（SHOW_ANIM），再看面板的按下动画。
  const particles = (self.legacyShowAnimation?.get(self.panelAnimationStyle)
    ?? self.legacyAnimation?.get(self.panelAnimationStyle))?.particles ?? []
  const particleFrames = panelAnimationElapsed < 0
    ? []
    : particles.flatMap((particle) =>
        legacyParticleFrames(particle, panelAnimationElapsed, self.panelWidth, self.panelHeight)
      )
  const player = self.playerParticles
  const playerRect = player?.key?.rect ?? { x: 0, y: 0, width: self.panelWidth, height: self.panelHeight }
  const playerParticleFrames = (player?.particles ?? []).flatMap((item) =>
    player!.elapsed < item.start || player!.elapsed > item.start + item.duration
      ? []
      : legacyParticleFrames(item.emitter, player!.elapsed - item.start, playerRect.width, playerRect.height)
        .map((frame) => ({ ...frame, x: frame.x + playerRect.x, y: frame.y + playerRect.y })),
  )
  const bdaAnimationElapsed = self.bdaAnimationState ? Date.now() - self.bdaAnimationState.startedAt : -1
  // The player already draws this key's particles at its own time.
  const bdaParticleFrames = self.animation && self.bdaAnimationState && bdaAnimationElapsed >= 0 && player?.key !== self.bdaAnimationState.key
    ? bdaAnimationBindingsForKey(self.animation, self.bdaAnimationState.key).flatMap((binding) =>
        bdaBindingEffects(self.animation!, binding).flatMap((effect) => {
          if (effect.kind !== "emitter" || !effect.resources.length) return []
          return legacyParticleFrames(
            bdaParticleEmitter(effect), bdaAnimationElapsed,
            self.bdaAnimationState!.key.rect.width, self.bdaAnimationState!.key.rect.height,
          ).map((frame) => ({
            ...frame,
            x: frame.x + self.bdaAnimationState!.key.rect.x,
            y: frame.y + self.bdaAnimationState!.key.rect.y,
          }))
        })
      )
    : []
  // 旧版按键按下时，它的动画样式引用的粒子从按键上发射；播放器已在画这个键时不重复。
  const pressedParticleFrames = [...self.legacyAnimationStates.values()].flatMap((pressed) =>
    player?.key?.section === pressed.key.section ? [] : keyAnimationStyles(pressed.key, self.panelAnimationStyle)
      .flatMap((style) => self.legacyAnimation?.get(style)?.particles ?? [])
      .flatMap((emitter) => legacyParticleFrames(emitter, Date.now() - pressed.startedAt, pressed.key.rect.width, pressed.key.rect.height))
      .map((frame) => ({ ...frame, x: frame.x + pressed.key.rect.x, y: frame.y + pressed.key.rect.y })),
  )
  const allParticleFrames = [...particleFrames, ...bdaParticleFrames, ...playerParticleFrames, ...pressedParticleFrames]
  const particleStyleIDs = [...new Set(allParticleFrames.map((frame) => frame.styleID))]
  const hintDirection = self.active?.direction ?? "center"
  const hintConfig = hintDirection === "hold" ? self.longHint ?? self.shortHint : self.shortHint
  const hintCandidates = self.active && (
    hintDirection === "hold" || hintDirection === "up" && hintConfig?.upIcon
  )
    ? legacyHintCandidates(hintKeyOf(self.active.key), hintDirection, Boolean(self.stateDocument) || self.bdaHints || Boolean(hintConfig?.defaultCandidates))
    : []
  const hintBar = hintCandidates.length > 0 && Boolean(hintConfig?.barIcon)
  const hintIconID = hintBar ? hintConfig?.barIcon : legacyHintIconID(hintConfig, hintDirection)
  const hintIcon = hintIconID ? hintConfig?.icons.get(hintIconID) : undefined
  const hintCellStyle = hintIcon?.cellStyle ?? hintConfig?.cellStyle
  const hintCellSize = hintIcon?.cellSize ?? hintConfig?.cellSize
  // 可见性与状态覆盖都已经在 IR 里定好，画的时候只排序：整板的键在底，普通键在上。
  const visible = self.keys.filter((key) => key.visible)
  const keys = [...visible].sort((left, right) => {
    const layerOf = (key: PreviewItem) => key.section === self.legacyAnimationState?.key.section
      ? 2
      : isFullPanelPreviewItem(key, self.panelWidth, self.panelHeight) ? 0 : 1
    return layerOf(left) - layerOf(right)
  })

  // 拖拽时优先使用缓存的视觉数据，避免重复异步解析
  let panel: Visual | undefined
  let visuals: NonNullable<Preview["lastRenderCache"]>["visuals"]
  let toolbarImages: Visual[]

  if (scene && !scene.partial) {
    panel = undefined
    visuals = new Map()
    toolbarImages = []
  } else if (isDragging && self.lastRenderCache) {
    // 使用缓存数据进行快速拖拽渲染
    panel = self.lastRenderCache.panel
    visuals = self.lastRenderCache.visuals
    toolbarImages = self.lastRenderCache.toolbarImages
  } else {
    // 正常渲染：完整解析所有视觉元素
    try {
      [panel, visuals, toolbarImages] = await Promise.all([
        self.resolver?.resolve(self.panelStyle, false).catch(() => undefined),
        Promise.all(keys.map(async (key) => {
          const draft = self.draftVisual && key.sections.includes(self.draftVisual.section) ? self.draftVisual : undefined
          const foreStyles = [...key.foreStyles]
          if (draft?.foreground) foreStyles[draft.layer] = draft.styleID ?? ""
          const highlighted = self.active?.key.section === key.section ||
            draft?.pressed ||
            player?.motion && player.key?.section === key.section ||
            self.legacyAnimationStates.has(key.section) ||
            self.keyPressed(key)
          try {
            return {
              back: draft && !draft.foreground ? draft.visual : await self.resolveVisual(
                highlighted ? key.highlightBackStyle ?? key.backStyle ?? "" : key.backStyle ?? "",
                highlighted,
              ).catch(() => undefined),
              fore: await Promise.all(
                foreStyles.map((style, index) => draft?.foreground && draft.layer === index ? draft.visual : self.resolveVisual(style, highlighted).catch(() => undefined)),
              ),
              text: key.key.kind === "list-cell" && self.resolver?.resolveListText
                ? self.resolver.resolveListText(foreStyles.join(","), highlighted)
                : self.resolver?.resolveText(foreStyles.join(","), highlighted),
              // A list cell shows its own entry (NAMES); a label carried by its shared style is not the cell's text.
              styleTexts: key.key.kind === "list-cell" ? [] : foreStyles.map((style) =>
                self.resolver?.resolveStyleText?.(style, highlighted)
              ),
            }
          } catch (error) {
            console.warn(`解析按键 ${key.section} 失败:`, error)
            return {
              back: undefined,
              fore: [],
              text: undefined,
              styleTexts: [],
            }
          }
        })).then((resolved) => new Map(keys.map((key, index) => [key.section, resolved[index]]))),
        self.resolveToolbar().catch(() => []),
      ])
      // 按键按下动画会改变绘制顺序，缓存必须按 section 匹配。
      self.lastRenderCache = { panel, visuals, toolbarImages }
    } catch (error) {
      console.warn("预览渲染解析失败:", error)
      // 使用空数据继续渲染，避免完全失败
      panel = undefined
      visuals = new Map()
      toolbarImages = []
    }
  }

  const [particleVisuals, hintVisuals, hintTextVisual, hintSelectedTextVisual, hintCellVisuals] = await Promise.all([
    Promise.all(particleStyleIDs.map(async (styleID) =>
      await self.resolveResource(styleID).catch(() => undefined)
    )),
    hintIcon
      ? Promise.all([
          self.resolveVisual(hintIcon.backStyle, false).catch(() => undefined),
          self.resolveVisual(hintIcon.foreStyle, false).catch(() => undefined),
        ])
      : Promise.resolve([undefined, undefined]),
    hintIcon ? self.resolver?.resolveText(hintIcon.foreStyle, false) : undefined,
    hintIcon ? self.resolver?.resolveText(hintIcon.foreStyle, true) : undefined,
    hintBar && hintCellStyle
      ? Promise.all([
          self.resolveVisual(hintCellStyle, false).catch(() => undefined),
          self.resolveVisual(hintCellStyle, true).catch(() => undefined),
        ])
      : Promise.resolve([undefined, undefined]),
  ])
  if (drawID !== self.drawID) return
  const context = beginCanvas(self)
  if (!context) return
  if (scene) for (const layer of scene.background) drawSceneLayer(context, layer)
  else drawVisual(
    context,
    panel,
    { x: 0, y: -self.panelTopInset, width: self.panelWidth, height: self.surfaceHeight + self.panelTopInset },
    true,
  )

  const sprites: SceneSprite[] = []
  const animationOf = (key: PreviewItem): KeyAnimationState => {
    const bdaElapsed = self.bdaAnimationState?.key.section === key.section ? bdaAnimationElapsed : -1
    const bdaBack = bdaTransforms(self.animation, key, bdaElapsed, "back")
    const bdaFore = bdaTransforms(self.animation, key, bdaElapsed, "fore")
    const state = self.legacyAnimationStates.get(key.section)
    return {
      ...(state ? { startedAt: state.startedAt } : {}),
      ...(player?.motion && player.key?.section === key.section ? { playerElapsed: player.elapsed } : {}),
      bdaBack,
      bdaFore,
      ...(key.container.back?.anim ? { backAnim: key.container.back.anim } : {}),
      transformOf: (style, elapsed, rect, which) => elapsed < 0
        ? (which === "back" ? bdaBack : bdaFore)
        : {
          scale: legacyAnimationScale(self.legacyAnimation, style, elapsed),
          translation: legacyAnimationTranslation(self.legacyAnimation, style, elapsed, rect),
          rotation: legacyAnimationRotation(self.legacyAnimation, style, elapsed),
          opacity: legacyAnimationOpacity(self.legacyAnimation, style, elapsed),
        },
    }
  }
  const keyEnv: KeyPaintEnv = {
    context,
    theme: self.theme,
    panelStyle: self.panelStyle,
    panelWidth: self.panelWidth,
    panelHeight: self.panelHeight,
    visuals,
    ...(scene ? { scene } : {}),
    sceneKeys,
    ...(self.nativePress ? { press: self.nativePress } : {}),
    pressed: (key) => self.active?.key.section === key.section || self.keyPressed(key),
    sprites,
    strokeSelection: (key) => strokeSelection(self, context, key),
  }
  for (const key of keys) paintKey(keyEnv, key, animationOf(key))

  const press = self.nativePress && { section: self.nativePress.section, elapsed: Date.now() - self.nativePress.startedAt, seed: self.nativePress.seed }
  const nativeSprites = [...scene?.effects?.panel?.(Date.now() - self.nativeShownAt, press) ?? [], ...sprites]
  const overlaySprites = nativeSprites.filter(sprite => sprite.overlay && self.hintCanvas)
  for (const sprite of nativeSprites) if (!sprite.overlay || !self.hintCanvas) drawSprite(context, sprite)
  self.drawnScene = scene
  scheduleNativeFrame(self, scene)

  const popupKey = self.active && sceneKeys.get(self.active.key.section)
  const holdPopup = self.active?.direction === "hold" && popupKey?.holdPopup
  if (holdPopup && self.active) self.active.hintCellWidth = holdPopup.cellWidth
  const popup = holdPopup && self.active
    ? holdPopup.layers(self.active.hintIndex ?? holdPopup.selected)
    : undefined
  const shouldDrawHint = Boolean(popup?.length || self.active && (isLegacyHintInputKey(hintKeyOf(self.active.key)) || hintCandidates.length) && hintIcon)
  let hintContext = context
  if (self.hintCanvas && (shouldDrawHint || self.hintVisible || overlaySprites.length || self.nativeOverlayVisible)) {
    const overlayBounds = self.hintCanvas.getBoundingClientRect()
    const previewBounds = self.canvas.getBoundingClientRect()
    const scale = globalThis.devicePixelRatio || 1
    setCanvasSize(
      self.hintCanvas,
      Math.max(1, Math.round(overlayBounds.width * scale)),
      Math.max(1, Math.round(overlayBounds.height * scale)),
    )
    const overlayContext = self.hintCanvas.getContext("2d")
    if (overlayContext) {
      overlayContext.setTransform(scale, 0, 0, scale, 0, 0)
      overlayContext.clearRect(0, 0, overlayBounds.width, overlayBounds.height)
      overlayContext.translate(previewBounds.left - overlayBounds.left, previewBounds.top - overlayBounds.top)
      overlayContext.scale(previewBounds.width / self.panelWidth, previewBounds.height / self.surfaceHeight)
      overlayContext.imageSmoothingEnabled = true
      overlayContext.imageSmoothingQuality = "high"
      hintContext = overlayContext
    }
  }

  self.nativeOverlayVisible = overlaySprites.length > 0
  for (const sprite of overlaySprites) drawSprite(hintContext, sprite)

  if (popup?.length) {
    self.hintVisible = true
    for (const layer of popup) drawSceneLayer(hintContext, layer)
  } else if (shouldDrawHint && self.active && hintIcon) {
    self.hintVisible = true
    paintHintBubble(hintContext, hintKeyOf(self.active.key), self.active.key.rect, {
      size: hintIcon.size,
      position: hintIcon.position,
      padding: hintIcon.padding,
      background: hintVisuals[0],
      foreground: hintVisuals[1],
      candidates: hintCandidates,
      cellVisuals: hintCellVisuals,
      textVisual: hintTextVisual,
      selectedTextVisual: hintSelectedTextVisual,
      cellSize: hintCellSize,
      direction: hintDirection,
      bar: hintBar,
      panelWidth: self.panelWidth,
      dark: self.theme === "dark",
      onCellWidth: (width) => { if (self.active) self.active.hintCellWidth = width },
    })
  } else {
    self.hintVisible = false
  }

  const particleVisualByStyle = new Map(
    particleStyleIDs.map((styleID, index) => [styleID, particleVisuals[index]]),
  )
  paintParticles(context, allParticleFrames, (styleID) => particleVisualByStyle.get(styleID))

  if (self.animationVisual) {
    drawVisual(context, self.animationVisual.visual, self.animationVisual.key.rect, false)
  }

  // 原生场景已经画了 F14 那条时不重复画。
  const sceneOwnsToolbar = Boolean(scene && (!scene.partial || keys.some((key) => actionText(key.key.actions.press) === "F14" && sceneKeys.has(key.section))))
  if (!sceneOwnsToolbar) paintToolbarStrip(context, toolbarImages, self.toolbarRect, self.panelWidth, self.devicePointWidth)

  paintMarquee(context, self.marquee?.rect, () => getComputedStyle(self.canvas).getPropertyValue("--selection").trim())
  drawGuides(self, visible)
  self.lastDrawnID = drawID
}

function beginCanvas(self: Preview): CanvasRenderingContext2D | undefined {
  const context = self.canvas.getContext("2d")
  if (!context) return
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.clearRect(0, 0, self.canvas.width, self.canvas.height)
  context.setTransform(self.canvas.width / self.panelWidth, 0, 0, self.canvas.height / self.surfaceHeight, 0, 0)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = "high"
  const surfaceColor = previewSurfaceColor(self.theme, self.transparent)
  if (surfaceColor) {
    context.fillStyle = surfaceColor
    context.fillRect(0, 0, self.panelWidth, self.surfaceHeight)
  }
  return context
}

function strokeSelection(self: Preview, context: CanvasRenderingContext2D, key: PreviewItem): void {
  if (previewSelectionVisible(self.mode, !self.joinedSelection && self.itemSelected(key))) {
    const flash = self.mode === "edit" && self.keyPressed(key)
    strokeSelected(context, key.rect, () => getComputedStyle(self.canvas).getPropertyValue(flash || self.toolbarSlots ? "--selection" : "--guide-selected").trim())
  } else if (self.mode === "edit" && self.itemDrafted(key)) {
    strokeDraft(context, key.rect)
  }
}

function drawGuides(self: Preview, keys: readonly PreviewItem[]): void {
  drawMeasurements(self)
  if (!self.guides) {
    self.guidesOverlay?.toggleAttribute("hidden", true)
    return
  }
  const overlay = self.guidesOverlay ?? document.createElementNS("http://www.w3.org/2000/svg", "svg")
  if (!self.guidesOverlay) {
    overlay.classList.add("preview-guides")
    overlay.setAttribute("aria-hidden", "true")
    self.canvas.insertAdjacentElement("afterend", overlay)
    self.guidesOverlay = overlay
  }
  overlay.toggleAttribute("hidden", false)
  const viewBox = `0 0 ${self.panelWidth} ${self.surfaceHeight}`
  if (overlay.getAttribute("viewBox") !== viewBox) {
    overlay.setAttribute("viewBox", viewBox)
    overlay.style.setProperty("--preview-guide-font-size", `${15 * self.panelWidth / DEFAULT_PANEL_WIDTH}px`)
  }
  // Reuse the SVG slots across canvas frames, including drag and selection changes.
  while (overlay.childElementCount > keys.length) overlay.lastElementChild!.remove()
  keys.forEach((key, index) => {
    let group = overlay.children[index]
    if (!group) {
      group = document.createElementNS("http://www.w3.org/2000/svg", "g")
      group.append(document.createElementNS("http://www.w3.org/2000/svg", "rect"), document.createElementNS("http://www.w3.org/2000/svg", "text"))
      overlay.append(group)
    }
    const rect = group.firstElementChild!, text = group.lastElementChild!
    group.classList.toggle("selected", !self.joinedSelection && self.itemSelected(key))
    guideCoordinate(rect, "x", key.rect.x)
    guideCoordinate(rect, "y", key.rect.y)
    guideCoordinate(rect, "width", key.rect.width)
    guideCoordinate(rect, "height", key.rect.height)
    guideCoordinate(text, "x", key.rect.x + 4)
    guideCoordinate(text, "y", key.rect.y + 4)
    if (text.textContent !== key.section) text.textContent = key.section
  })
}

function guideCoordinate(node: Element, name: string, value: number): void {
  const coordinate = String(value)
  if (node.getAttribute(name) !== coordinate) node.setAttribute(name, coordinate)
}
