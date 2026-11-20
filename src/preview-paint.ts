import type { Preview } from "./preview.ts"
import { buildPanelFrame, paintPanel, type PanelFrame, type PanelOptions } from "./paint/panel.ts"
import { drawMeasurements } from "./preview-measurements.ts"
import { scheduleNativeFrame } from "./preview-native.ts"
import { previewSelectionVisible, previewSurfaceColor } from "./preview-items.ts"
import { paintMarquee } from "./paint/marquee.ts"
import { paintLayer } from "./paint/layer.ts"
import { strokeDraft, strokeSelected } from "./paint/selection.ts"
import { setCanvasSize } from "./preview-draw.ts"
import { DEFAULT_PANEL_WIDTH } from "./keyboard.ts"
import type { PreviewItem } from "./preview-items.ts"

export async function paintPreview(self: Preview): Promise<void> {
  const drawID = ++self.drawID
  const isDragging = Boolean(self.editDrag)

  // A native scene (Palm, Sogou) replaces the resolver's panel, key and toolbar visuals.
  // A running animation keeps the painted scene while the next one (a press refreshes it) builds.
  const next = self.sceneForState()
  const animating = self.drawnScene && (self.nativePress || self.drawnScene.effects?.panel)
  const scene = next && animating && !self.builtScenes.has(next) ? self.drawnScene : await next?.catch((error) => {
    console.warn("预览场景生成失败:", error)
    return undefined
  })

  const options = previewOptions(self, scene)
  // IR 是唯一真相：模型或板还没就绪时只画底色，不用 resolver 兜底。
  if (!self.model || !self.board) {
    self.lastFrame = undefined
    beginCanvas(self)
    return
  }
  // 拖拽只改同一批渲染项的 rect；复用上一帧，不重复解析样式。
  const frame = isDragging && self.lastFrame
    ? self.lastFrame
    : await buildPanelFrame(self.model, self.board, options)
  self.lastFrame = frame

  if (drawID !== self.drawID) return
  const context = beginCanvas(self)
  if (!context) return
  const overlay = overlayContext(self, frame)
  paintPanel(context, frame, options, {
    ...(overlay ? { overlay } : {}),
    onItemPainted: (key) => strokeSelection(self, context, key),
  })
  // 动效设计播放器把当前样式临时盖在键上，属于编辑器叠加。
  if (self.animationVisual) {
    const paint = self.animationVisual.paint
    paintLayer(context, paint.layer, paint.bitmap, self.animationVisual.key.rect)
  }
  self.hintVisible = Boolean(frame.hint)
  self.nativeOverlayVisible = frame.panelSprites.some((sprite) => sprite.overlay)
  self.drawnScene = scene
  scheduleNativeFrame(self, scene)

  paintMarquee(context, self.marquee?.rect, () => getComputedStyle(self.canvas).getPropertyValue("--selection").trim())
  drawGuides(self, frame.items.filter((key) => key.visible))
  self.lastDrawnID = drawID
}

/** 预览侧的渲染参数：把指针状态、动画时刻与场景折成核心认识的形状。 */
function previewOptions(self: Preview, scene: PanelFrame["scene"]): PanelOptions {
  const now = Date.now()
  const pressed = new Set<string>()
  for (const key of self.keys) {
    if (self.active?.key.section === key.section || self.keyPressed(key)) {
      for (const section of key.sections) pressed.add(section)
    }
  }
  const pressedElapsed = new Map<string, number>()
  for (const [section, state] of self.legacyAnimationStates) pressedElapsed.set(section, now - state.startedAt)
  const player = self.playerParticles
  const hintDirection = self.active?.direction ?? "center"
  const hintConfig = hintDirection === "hold" ? self.longHint ?? self.shortHint : self.shortHint
  return {
    theme: self.theme,
    pressed,
    transparent: self.transparent,
    panelStyle: self.panelStyle,
    panelAnimationStyle: self.panelAnimationStyle,
    // 预览的两块画布各自显示自己的部分，不合成顶栏。
    container: { width: self.panelWidth, height: self.surfaceHeight },
    items: self.keys,
    time: {
      ...(self.legacyPanelAnimationStartedAt ? { panel: now - self.legacyPanelAnimationStartedAt } : {}),
      ...(pressedElapsed.size ? { pressed: pressedElapsed } : {}),
      ...(self.bdaAnimationState
        ? { bda: { section: self.bdaAnimationState.key.section, elapsed: now - self.bdaAnimationState.startedAt } }
        : {}),
      ...(player
        ? {
          player: {
            particles: player.particles,
            elapsed: player.elapsed,
            ...(player.key ? { section: player.key.section } : {}),
            ...(player.motion ? { motion: true } : {}),
          },
        }
        : {}),
      ...(self.nativePress
        ? { nativePress: { section: self.nativePress.section, elapsed: now - self.nativePress.startedAt, seed: self.nativePress.seed } }
        : {}),
      sceneShown: now - self.nativeShownAt,
    },
    ...(self.legacyAnimation ? { legacyAnimation: self.legacyAnimation } : {}),
    ...(self.legacyShowAnimation ? { showAnimation: self.legacyShowAnimation } : {}),
    ...(self.animation ? { animation: self.animation } : {}),
    ...(scene ? { scene } : {}),
    ...(self.active
      ? {
        hint: {
          section: self.active.key.section,
          direction: self.active.direction,
          ...(self.active.hintIndex === undefined ? {} : { index: self.active.hintIndex }),
        },
      }
      : {}),
    ...(self.shortHint || self.longHint
      ? {
        hintConfig: {
          short: self.shortHint,
          long: self.longHint,
          defaults: Boolean(self.stateDocument) || self.bdaHints || Boolean(hintConfig?.defaultCandidates),
        },
      }
      : {}),
    ...(self.draftVisual ? { draft: self.draftVisual } : {}),
  }
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

/** 气泡与原生覆盖层画在独立的 hint 画布上；没有该画布时由核心画到主画布。 */
function overlayContext(self: Preview, frame: PanelFrame): CanvasRenderingContext2D | undefined {
  if (!self.hintCanvas) return undefined
  const overlays = frame.panelSprites.some((sprite) => sprite.overlay)
  if (!(frame.hint || overlays || self.hintVisible || self.nativeOverlayVisible)) return undefined
  const overlayBounds = self.hintCanvas.getBoundingClientRect()
  const previewBounds = self.canvas.getBoundingClientRect()
  const scale = globalThis.devicePixelRatio || 1
  setCanvasSize(
    self.hintCanvas,
    Math.max(1, Math.round(overlayBounds.width * scale)),
    Math.max(1, Math.round(overlayBounds.height * scale)),
  )
  const context = self.hintCanvas.getContext("2d")
  if (!context) return undefined
  context.setTransform(scale, 0, 0, scale, 0, 0)
  context.clearRect(0, 0, overlayBounds.width, overlayBounds.height)
  context.translate(previewBounds.left - overlayBounds.left, previewBounds.top - overlayBounds.top)
  context.scale(previewBounds.width / self.panelWidth, previewBounds.height / self.surfaceHeight)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = "high"
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
