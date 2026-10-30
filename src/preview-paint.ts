import type { Preview } from "./preview.ts"
import { legacyParticleFrames } from "./preview-animation.ts"
import { drawSprite, withMotion, type SceneSprite } from "./native-motion.ts"
import { scheduleNativeFrame } from "./preview-native.ts"
import { bdaAnimationBindingsForKey } from "./preview-animation.ts"
import { bdaBindingEffects } from "./preview-animation.ts"
import { bdaParticleEmitter } from "./preview-animation.ts"
import { legacyHintCandidates } from "./preview-hints.ts"
import { legacyHintIconID } from "./preview-hints.ts"
import { previewDrawOrder } from "./preview-items.ts"
import { visiblePreviewItems } from "./preview-items.ts"
import { effectivePreviewItem } from "./preview-items.ts"
import { type Visual } from "./atlas.ts"
import { type TextVisual } from "./atlas.ts"
import { type StyleTextVisual } from "./atlas.ts"
import { previewSurfaceColor } from "./preview-items.ts"
import { drawVisual } from "./preview-draw.ts"
import { previewSelectionVisible } from "./preview-items.ts"
import { bdaTransforms } from "./preview-animation.ts"
import { legacyAnimationScale } from "./preview-animation.ts"
import { legacyAnimationTranslation } from "./preview-animation.ts"
import { legacyAnimationRotation } from "./preview-animation.ts"
import { legacyAnimationOpacity } from "./preview-animation.ts"
import { phoneForegroundLayers } from "./preview-draw.ts"
import { shouldDrawItemBackground } from "./preview-items.ts"
import { withTransform } from "./preview-draw.ts"
import { offsetFromSection } from "./preview-items.ts"
import { paddedRect } from "./preview-items.ts"
import { foregroundLayerRect } from "./preview-draw.ts"
import { foregroundTextPoint } from "./preview-draw.ts"
import { drawStyleText } from "./preview-draw.ts"
import { canvasFont } from "./atlas.ts"
import { previewFallbackText } from "./preview-items.ts"
import { drawListText } from "./preview-draw.ts"
import { isLegacyHintInputKey } from "./preview-hints.ts"
import { setCanvasSize } from "./preview-draw.ts"
import { phoneForegroundVisual } from "./preview-draw.ts"
import { legacyHintText } from "./preview-hints.ts"
import { dynamicToolbarRect } from "./preview-items.ts"
import { type PreviewItem } from "./preview-items.ts"
import { DEFAULT_PANEL_WIDTH } from "./keyboard.ts"
import { drawSceneLayer, type SceneLayer } from "./native-scene.ts"

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
  const particles = self.particlePreview
    ? [self.particlePreview]
    : self.legacyAnimation?.get(self.panelAnimationStyle)?.particles ?? []
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
  const allParticleFrames = [...particleFrames, ...bdaParticleFrames, ...playerParticleFrames]
  const particleStyleIDs = [...new Set(allParticleFrames.map((frame) => frame.styleID))]
  const hintDirection = self.active?.direction ?? "center"
  const hintConfig = hintDirection === "hold" ? self.longHint ?? self.shortHint : self.shortHint
  const hintCandidates = self.active && (
    hintDirection === "hold" || hintDirection === "up" && hintConfig?.upIcon
  )
    ? legacyHintCandidates(self.active.key, hintDirection, self.bdaHints)
    : []
  const hintBar = hintCandidates.length > 1 && Boolean(hintConfig?.barIcon)
  const hintIconID = hintBar ? hintConfig?.barIcon : legacyHintIconID(hintConfig, hintDirection)
  const hintIcon = hintIconID ? hintConfig?.icons.get(hintIconID) : undefined
  const keys = previewDrawOrder(visiblePreviewItems(self.keys, self.skinState)
    .map((key) =>
      self.stateDocument ? effectivePreviewItem(self.stateDocument, key, self.skinState ?? 0) : key,
    ), self.panelWidth, self.panelHeight, self.legacyAnimationState?.key.section)

  // 拖拽时优先使用缓存的视觉数据，避免重复异步解析
  let panel: Visual | undefined
  let visuals: Array<{ back: Visual | undefined; fore: Array<Visual | undefined>; text: TextVisual | undefined; styleTexts: Array<StyleTextVisual | undefined> }>
  let toolbarImages: Visual[]

  if (scene) {
    panel = undefined
    visuals = keys.map(() => ({ back: undefined, fore: [], text: undefined, styleTexts: [] }))
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
          const highlighted = self.active?.key.section === key.section ||
            self.legacyAnimationState?.key.section === key.section ||
            self.keyPressed(key)
          try {
            return {
              back: await self.resolveVisual(
                highlighted ? key.highlightBackStyle ?? key.backStyle : key.backStyle,
                highlighted,
              ).catch(() => undefined),
              fore: await Promise.all(
                key.foreStyles.map((style) => self.resolveVisual(style, highlighted).catch(() => undefined)),
              ),
              text: self.resolver?.resolveText(key.foreStyles.join(","), highlighted),
              styleTexts: key.foreStyles.map((style) =>
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
        })),
        self.resolveToolbar().catch(() => []),
      ])
      // 保存缓存供拖拽时使用
      self.lastRenderCache = { panel, visuals, toolbarImages }
    } catch (error) {
      console.warn("预览渲染解析失败:", error)
      // 使用空数据继续渲染，避免完全失败
      panel = undefined
      visuals = keys.map(() => ({ back: undefined, fore: [], text: undefined, styleTexts: [] }))
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
    hintBar && hintConfig?.cellStyle
      ? Promise.all([
          self.resolveVisual(hintConfig.cellStyle, false).catch(() => undefined),
          self.resolveVisual(hintConfig.cellStyle, true).catch(() => undefined),
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
    { x: 0, y: 0, width: self.panelWidth, height: self.surfaceHeight },
    true,
  )

  const sprites: SceneSprite[] = []
  for (const [index, key] of keys.entries()) {
    const animationElapsed = self.legacyAnimationState?.key.section === key.section
      ? Date.now() - self.legacyAnimationState.startedAt
      : -1
    const activeBdaElapsed = self.bdaAnimationState?.key.section === key.section ? bdaAnimationElapsed : -1
    const bdaBack = bdaTransforms(self.animation, key, activeBdaElapsed, "back")
    const bdaFore = bdaTransforms(self.animation, key, activeBdaElapsed, "fore")
    const backAnimationStyle = key.backAnimStyle || key.animStyle
    const backScale = animationElapsed >= 0
      ? legacyAnimationScale(self.legacyAnimation, backAnimationStyle, animationElapsed)
      : bdaBack.scale
    const backTranslation = animationElapsed >= 0
      ? legacyAnimationTranslation(self.legacyAnimation, backAnimationStyle, animationElapsed, key.rect)
      : bdaBack.translation
    const backRotation = animationElapsed >= 0
      ? legacyAnimationRotation(self.legacyAnimation, backAnimationStyle, animationElapsed)
      : bdaBack.rotation
    const backOpacity = animationElapsed >= 0
      ? legacyAnimationOpacity(self.legacyAnimation, backAnimationStyle, animationElapsed)
      : bdaBack.opacity
    const sceneKey = sceneKeys.get(key.section)
    if (scene) {
      const press = self.nativePress?.section === key.section ? self.nativePress : undefined
      const pressed = Boolean(press) || self.active?.key.section === key.section || self.keyPressed(key)
      const layers = sceneKey?.layers(pressed)
      if (sceneKey && layers) {
        const motion = press && scene.effects?.press(key.section, Date.now() - press.startedAt, press.seed)
        if (motion) sprites.push(...motion.sprites)
        // Scene layers sit where the skin puts the key; a key being dragged takes them along.
        const draw = (group: SceneLayer[]) => {
          context.save()
          context.translate(key.rect.x, key.rect.y)
          context.scale(key.rect.width / sceneKey.rect.width, key.rect.height / sceneKey.rect.height)
          context.translate(-sceneKey.rect.x, -sceneKey.rect.y)
          for (const layer of group) drawSceneLayer(context, layer)
          context.restore()
        }
        withMotion(context, key.rect, motion?.back, () => draw(layers.back))
        layers.fore.forEach((layer, index) => withMotion(context, key.rect, motion?.fore[layers.groups?.[index] ?? 0], () => draw([layer])))
      }
      strokeSelection(self, context, key)
      continue
    }
    const area = paddedRect(key)
    const styleTexts = visuals[index].styleTexts
    const foregrounds = phoneForegroundLayers(visuals[index].fore)
    const hasForeground = foregrounds.some(Boolean) || styleTexts.some(Boolean)
    if (shouldDrawItemBackground(key, self.panelStyle, self.panelWidth, self.panelHeight)) {
      withTransform(context, area, backScale, backTranslation, backRotation, backOpacity, () => {
        drawVisual(context, visuals[index].back, area, true)
      })
    }
    for (const [layer, fore] of foregrounds.entries()) {
      const animationStyle = key.foreAnimStyles[layer] || key.foreAnimStyle || key.animStyle
      const foreScale = animationElapsed >= 0
        ? legacyAnimationScale(self.legacyAnimation, animationStyle, animationElapsed)
        : bdaFore.scale
      const foreTranslation = animationElapsed >= 0
        ? legacyAnimationTranslation(self.legacyAnimation, animationStyle, animationElapsed, area)
        : bdaFore.translation
      const foreRotation = animationElapsed >= 0
        ? legacyAnimationRotation(self.legacyAnimation, animationStyle, animationElapsed)
        : bdaFore.rotation
      const foreOpacity = animationElapsed >= 0
        ? legacyAnimationOpacity(self.legacyAnimation, animationStyle, animationElapsed)
        : bdaFore.opacity
      const offset = key.foreOffsets[layer] ?? offsetFromSection(
        self.offsets,
        `OFFSET${key.positionTypes[layer] ?? ""}`,
        area,
      )
      const destination = key.foreRect ?? foregroundLayerRect(area, fore?.source, offset)
      withTransform(context, area, foreScale, foreTranslation, foreRotation, foreOpacity, () => {
        drawVisual(context, fore, destination, false)
      })
    }

    for (const [layer, styleText] of styleTexts.entries()) {
      if (!styleText || foregrounds[layer]) continue
      const animationStyle = key.foreAnimStyles[layer] || key.foreAnimStyle || key.animStyle
      const foreScale = animationElapsed >= 0
        ? legacyAnimationScale(self.legacyAnimation, animationStyle, animationElapsed)
        : bdaFore.scale
      const foreTranslation = animationElapsed >= 0
        ? legacyAnimationTranslation(self.legacyAnimation, animationStyle, animationElapsed, area)
        : bdaFore.translation
      const foreRotation = animationElapsed >= 0
        ? legacyAnimationRotation(self.legacyAnimation, animationStyle, animationElapsed)
        : bdaFore.rotation
      const foreOpacity = animationElapsed >= 0
        ? legacyAnimationOpacity(self.legacyAnimation, animationStyle, animationElapsed)
        : bdaFore.opacity
      const offset = key.foreOffsets[layer] ?? offsetFromSection(
        self.offsets,
        `OFFSET${key.positionTypes[layer] ?? ""}`,
        area,
      )
      const point = foregroundTextPoint(key.foreRect ?? area, offset)
      withTransform(context, area, foreScale, foreTranslation, foreRotation, foreOpacity, () => {
        drawStyleText(context, styleText, point, self.theme)
      })
    }

    strokeSelection(self, context, key)

    const textVisual: TextVisual | undefined = visuals[index].text
    context.fillStyle = textVisual?.color ?? (self.theme === "dark" ? "#f5f5f7" : "#17191c")
    const fontSize = textVisual?.fontSize ?? Math.max(18, Math.min(42, area.height * 0.25))
    context.font = canvasFont(fontSize, textVisual)
    context.textAlign = "center"
    context.textBaseline = "middle"
    const fallbackText = previewFallbackText(key, hasForeground)
    if (fallbackText) {
      const animationStyle = key.foreAnimStyle || key.animStyle
      const foreScale = animationElapsed >= 0
        ? legacyAnimationScale(self.legacyAnimation, animationStyle, animationElapsed)
        : bdaFore.scale
      const foreTranslation = animationElapsed >= 0
        ? legacyAnimationTranslation(self.legacyAnimation, animationStyle, animationElapsed, area)
        : bdaFore.translation
      const foreRotation = animationElapsed >= 0
        ? legacyAnimationRotation(self.legacyAnimation, animationStyle, animationElapsed)
        : bdaFore.rotation
      const foreOpacity = animationElapsed >= 0
        ? legacyAnimationOpacity(self.legacyAnimation, animationStyle, animationElapsed)
        : bdaFore.opacity
      withTransform(context, area, foreScale, foreTranslation, foreRotation, foreOpacity, () => {
        const centerX = area.x + area.width / 2
        const centerY = area.y + area.height / 2
        if (key.section.startsWith("LIST:")) drawListText(context, fallbackText, centerX, centerY)
        else context.fillText(fallbackText, centerX, centerY)
      })
    }

  }

  if (scene?.effects) {
    const press = self.nativePress && { section: self.nativePress.section, elapsed: Date.now() - self.nativePress.startedAt, seed: self.nativePress.seed }
    for (const sprite of [...scene.effects.panel?.(Date.now() - self.nativeShownAt, press) ?? [], ...sprites]) drawSprite(context, sprite)
  }
  self.drawnScene = scene
  scheduleNativeFrame(self, scene)

  const popup = self.active ? sceneKeys.get(self.active.key.section)?.popup : undefined
  const shouldDrawHint = Boolean(popup?.length || self.active && isLegacyHintInputKey(self.active.key) && hintIcon)
  let hintContext = context
  if (self.hintCanvas && (shouldDrawHint || self.hintVisible)) {
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

  if (popup?.length) {
    self.hintVisible = true
    for (const layer of popup) drawSceneLayer(hintContext, layer)
  } else if (shouldDrawHint && self.active && hintIcon) {
    self.hintVisible = true
    const [baseWidth, height] = hintIcon.size
    const [offsetX, offsetY] = hintIcon.position
    const key = self.active.key
    const [left, top, right, bottom] = hintIcon.padding
    const cellWidth = self.bdaHints ? self.panelWidth / 14 : self.panelWidth / 24
    const width = hintBar ? Math.max(baseWidth, left + right + hintCandidates.length * cellWidth) : baseWidth
    const x = Math.max(0, Math.min(self.panelWidth - width, key.rect.x + (key.rect.width - width) / 2 + offsetX))
    const bdaNineKeyBar = self.bdaHints && hintDirection === "hold" && /^\d$/.test(key.up) && hintCandidates.length > 3
    const rect = { x, y: bdaNineKeyBar ? -height + offsetY : key.rect.y - height + offsetY, width, height }
    drawVisual(hintContext, hintVisuals[0], rect, true)
    drawVisual(hintContext, phoneForegroundVisual(hintVisuals[1]), rect, false)
    if (hintBar) {
      const selected = hintDirection === "up"
        ? 0
        : self.bdaHints && /^\d$/.test(key.up) && hintCandidates.includes(key.up)
          ? hintCandidates.indexOf(key.up)
          : Math.max(0, hintCandidates.lastIndexOf(key.center))
      const cellHeight = height - top - bottom
      hintCandidates.forEach((action, index) => {
        const cell = { x: rect.x + left + index * cellWidth, y: rect.y + top, width: cellWidth, height: cellHeight }
        drawVisual(hintContext, hintCellVisuals[index === selected ? 1 : 0], cell, true)
        const text = index === selected ? hintSelectedTextVisual ?? hintTextVisual : hintTextVisual
        hintContext.fillStyle = text?.color ?? (self.theme === "dark" ? "#f5f5f7" : "#17191c")
        hintContext.font = canvasFont(text?.fontSize ?? Math.max(18, Math.min(42, height * 0.25)), text)
        hintContext.textAlign = "center"
        hintContext.textBaseline = "middle"
        hintContext.fillText(action, cell.x + cell.width / 2, cell.y + cell.height / 2)
      })
    } else {
      const action = legacyHintText(key, hintDirection)
      if (action) {
        hintContext.fillStyle = hintTextVisual?.color ?? (self.theme === "dark" ? "#f5f5f7" : "#17191c")
        hintContext.font = canvasFont(hintTextVisual?.fontSize ?? Math.max(18, Math.min(42, height * 0.25)), hintTextVisual)
        hintContext.textAlign = "center"
        hintContext.textBaseline = "middle"
        hintContext.fillText(action, rect.x + left + (width - left - right) / 2, rect.y + top + (height - top - bottom) / 2)
      }
    }
  } else {
    self.hintVisible = false
  }

  const particleVisualByStyle = new Map(
    particleStyleIDs.map((styleID, index) => [styleID, particleVisuals[index]]),
  )
  for (const frame of allParticleFrames) {
    const visual = particleVisualByStyle.get(frame.styleID)
    if (!visual?.image || !visual.source || frame.scale <= 0 || frame.opacity <= 0) continue
    const [sx, sy, width, height] = visual.source
    context.save()
    context.globalAlpha *= frame.opacity
    context.translate(frame.x, frame.y)
    context.rotate(frame.rotation * Math.PI / 180)
    context.scale(frame.scale, frame.scale)
    context.drawImage(visual.image, sx, sy, width, height, -width / 2, -height / 2, width, height)
    context.restore()
  }

  if (self.animationVisual) {
    drawVisual(context, self.animationVisual.visual, self.animationVisual.key.rect, false)
  }

  const toolbarRect = self.document
    ? dynamicToolbarRect(self.document, self.panelWidth, self.panelHeight)
    : undefined
  if (toolbarRect && toolbarImages.length) {
    const slotWidth = toolbarRect.width / toolbarImages.length
    toolbarImages.forEach((visual, index) => {
      // 工具栏图标常是 @3x 大图（如 121px），按槽位等比缩小，只缩不放。
      const [, , sw, sh] = visual.source ?? [0, 0, slotWidth, toolbarRect.height]
      const scale = Math.min(1, slotWidth / sw, toolbarRect.height / sh)
      drawVisual(context, visual, {
        x: toolbarRect.x + index * slotWidth + (slotWidth - sw * scale) / 2,
        y: toolbarRect.y + (toolbarRect.height - sh * scale) / 2,
        width: sw * scale,
        height: sh * scale,
      }, true)
    })
  }

  drawGuides(self, visiblePreviewItems(self.keys, self.skinState))
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
  if (previewSelectionVisible(self.mode, self.itemSelected(key))) {
    // A press flash in edit mode is marked in the selection orange so it
    // reads as "momentary feedback", not as the blue selection state.
    const flash = self.mode === "edit" && self.keyPressed(key)
    context.strokeStyle = flash ? "#ff6b2c" : "#087ff5"
    context.lineWidth = 4
    context.strokeRect(key.rect.x + 2, key.rect.y + 2, key.rect.width - 4, key.rect.height - 4)
  } else if (self.mode === "edit" && self.itemDrafted(key)) {
    // Unconfirmed AI draft: dashed orange, distinct from any solid selection.
    const inset = 3
    context.save()
    context.strokeStyle = "#ff6b2c"
    context.lineWidth = 3
    context.setLineDash([9, 6])
    context.strokeRect(
      key.rect.x + inset,
      key.rect.y + inset,
      Math.max(0, key.rect.width - inset * 2),
      Math.max(0, key.rect.height - inset * 2),
    )
    context.restore()
  }
}

function drawGuides(self: Preview, keys: readonly PreviewItem[]): void {
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
  overlay.setAttribute("viewBox", `0 0 ${self.panelWidth} ${self.surfaceHeight}`)
  overlay.style.setProperty("--preview-guide-font-size", `${15 * self.panelWidth / DEFAULT_PANEL_WIDTH}px`)
  overlay.replaceChildren(...keys.map((key) => {
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g")
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect")
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text")
    group.classList.toggle("selected", self.itemSelected(key))
    rect.setAttribute("x", String(key.rect.x))
    rect.setAttribute("y", String(key.rect.y))
    rect.setAttribute("width", String(key.rect.width))
    rect.setAttribute("height", String(key.rect.height))
    text.setAttribute("x", String(key.rect.x + 4))
    text.setAttribute("y", String(key.rect.y + 4))
    text.textContent = key.section
    group.append(rect, text)
    return group
  }))
}
