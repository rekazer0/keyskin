import { type StyleTextVisual, type TextVisual, type Visual, type VisualResolver } from "./atlas.ts"
import { IniDocument } from "./ini.ts"
import { DEFAULT_PANEL_HEIGHT, DEFAULT_PANEL_WIDTH } from "./keyboard.ts"
import { snapPointToRects } from "./layout.ts"
import type { BdaAnimation } from "./bda.ts"
import { type PreviewItem, type Rect, previewItems, visiblePreviewItems, previewSurfaceHeight, effectivePreviewHitItem, previewHitItem } from "./preview-items.ts"
import { type LegacyAnimation, type LegacyParticleEmitter, bdaAnimationBindingsForKey, bdaBindingEffects, bdaEffectDuration, animationSequenceForKey, animationDuration } from "./preview-animation.ts"
import { type LegacyHint } from "./preview-hints.ts"
import { constrainedCanvasSize, setCanvasSize } from "./preview-draw.ts"
import { paintPreview } from "./preview-paint.ts"
import type { NativeScene } from "./native-scene.ts"
import { playNativePress } from "./preview-native.ts"
import { pointerDown } from "./preview-pointer.ts"
import { pointerMove } from "./preview-pointer.ts"
import { pointerUp } from "./preview-pointer.ts"

export type PreviewEvent = {
  section: string
  direction: "center" | "hold" | "up" | "down" | "left" | "right"
  code: string
  holdSymbols?: string
}

export class Preview {
  readonly canvas: HTMLCanvasElement
  readonly onEvent: (event: PreviewEvent) => void
  readonly onSelect: (sections: string[]) => void
  readonly onMove: (sections: string[], deltaX: number, deltaY: number) => void
  private readonly toolbarSlots: boolean
  readonly hintCanvas?: HTMLCanvasElement
  document?: IniDocument
  private defaults?: IniDocument
  offsets?: IniDocument
  resolver?: VisualResolver
  /** Palm and Sogou skins paint a scene read from their own files instead of resolving styles. */
  scene?: (state: number | undefined) => Promise<NativeScene | undefined>
  private readonly scenes = new Map<number | undefined, Promise<NativeScene | undefined>>()
  /** Palm documents list their keys themselves, per keyboard state and composition. */
  private nativeItems?: (state: number | undefined, persistentOnly: boolean) => PreviewItem[]
  // Resolver lookups are asynchronous and can involve stylesheet/tile parsing
  // and image decoding. Keep the resolved values for the lifetime of a
  // resolver; drag frames then only redraw geometry instead of repeating the
  // expensive lookups for every key.
  private readonly visualCache = new Map<string, Promise<Visual | undefined>>()
  private readonly resourceCache = new Map<string, Promise<Visual | undefined>>()
  private toolbarImagesCache?: Promise<Visual[]>
  panelStyle = ""
  panelWidth = DEFAULT_PANEL_WIDTH
  panelHeight = DEFAULT_PANEL_HEIGHT
  private surfaceKeys?: PreviewItem[]
  private surfaceHeightValue = DEFAULT_PANEL_HEIGHT
  theme: "light" | "dark" = "light"
  transparent = false
  keys: PreviewItem[] = []
  mode: "edit" | "preview" = "edit"
  editTool: "select" | "move" = "select"
  crosshair = false
  pointerInteractionLocked = false
  /** 动效设计 / 粒子设计：点按键只在画布上播放它的动画，不选中、不切换文件。 */
  animationView = false
  private renderDeferred = false
  editDrag?: {
    pointerId: number
    startX: number
    startY: number
    original: Map<string, Rect>
  }
  editTouch?: {
    pointerId: number
    pointerType: string
    key: PreviewItem
    startX: number
    startY: number
    clientX: number
    clientY: number
    startedAt: number
    longPress: boolean
    longPressTimer?: number
  }
  active?: {
    pointerId: number
    key: PreviewItem
    startX: number
    startY: number
    startedAt: number
    clearOnHold: boolean
    holdTriggered: boolean
    direction: "center" | "up" | "down" | "left" | "right" | "hold"
    holdTimer?: number
  }
  selected = new Set<string>()
  /**
   * Sections touched by an unconfirmed AI draft. Drawn in the selection orange
   * so the canvas shows what a pending change would affect before it is
   * committed.
   */
  private draftSections = new Set<string>()
  private pressed?: { section: string; timeout: number }
  mobileMultiSelect = false
  selectionAnchor?: string
  guides = false
  guidesOverlay?: SVGSVGElement
  skinState?: number
  private persistentOnly = false
  animation?: BdaAnimation
  animationVisual?: { key: PreviewItem; visual: Visual }
  private animationTimer?: number
  bdaAnimationState?: { key: PreviewItem; startedAt: number }
  private bdaAnimationTimer?: number
  legacyAnimation?: LegacyAnimation
  shortHint?: LegacyHint
  longHint?: LegacyHint
  bdaHints = false
  legacyAnimationState?: { key: PreviewItem; startedAt: number }
  private legacyAnimationTimer?: number
  particlePreview?: LegacyParticleEmitter
  panelAnimationStyle = ""
  legacyPanelAnimationStartedAt = 0
  private legacyPanelAnimationTimer?: number
  /** A native scene's running press animation (kept across the refresh a press causes) and when panel animations started. */
  nativePress?: { section: string; startedAt: number; seed: number }
  nativeShownAt = Date.now()
  /** The scene last painted, which a press animates while the refresh it causes builds the next. */
  drawnScene?: NativeScene
  nativeFrame = 0
  drawID = 0
  lastDrawnID = 0
  private drawQueued = 0
  private renderPending = false
  private renderInFlight: Promise<void> = Promise.resolve()
  private renderAgain = false
  hintVisible = false
  dragDrawFrame = 0
  lastRenderCache?: {
    panel: Visual | undefined
    visuals: Array<{ back: Visual | undefined; fore: Array<Visual | undefined>; text: TextVisual | undefined; styleTexts: Array<StyleTextVisual | undefined> }>
    toolbarImages: Visual[]
  }
  private readonly resizeObserver: ResizeObserver

  constructor(
    canvas: HTMLCanvasElement,
    onEvent: (event: PreviewEvent) => void,
    onSelect: (sections: string[]) => void,
    toolbarSlots = false,
    onMove: (sections: string[], deltaX: number, deltaY: number) => void = () => {},
    hintCanvas?: HTMLCanvasElement,
  ) {
    this.canvas = canvas
    this.onEvent = onEvent
    this.onSelect = onSelect
    this.onMove = onMove
    this.toolbarSlots = toolbarSlots
    this.hintCanvas = hintCanvas
    canvas.addEventListener("pointerdown", (event) => pointerDown(this, event))
    canvas.addEventListener("pointermove", (event) => pointerMove(this, event))
    canvas.addEventListener("pointerup", (event) => pointerUp(this, event))
    canvas.addEventListener("contextmenu", (event) => event.preventDefault())
    canvas.addEventListener("pointercancel", () => {
      this.cancelDragDraw()
      if (this.active?.holdTimer !== undefined) window.clearTimeout(this.active.holdTimer)
      this.active = undefined
      this.cancelEditTouch()
      this.cancelEditDrag()
      this.updateCursor()
      void this.draw()
    })
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(canvas)
  }

  whenDrawn(timeoutMs = 8_000): Promise<void> {
    this.draw()
    // 只等调用之后开始的那次渲染；不等绘制队列清空，持续的动画会一直排绘制，那样每次都要等到超时。
    const target = this.drawID + 1
    const started = Date.now()
    return new Promise((resolve, reject) => {
      const tick = () => {
        if (this.lastDrawnID >= target) {
          resolve()
          return
        }
        if (Date.now() - started > timeoutMs) {
          reject(new Error("预览绘制超时"))
          return
        }
        requestAnimationFrame(tick)
      }
      tick()
    })
  }

  destroy(): void {
    this.resizeObserver.disconnect()
    this.cancelDragDraw()
    if (this.drawQueued) cancelAnimationFrame(this.drawQueued)
    this.drawQueued = 0
    this.renderPending = false
    this.renderAgain = false
    if (this.animationTimer) window.clearTimeout(this.animationTimer)
    if (this.bdaAnimationTimer) window.cancelAnimationFrame(this.bdaAnimationTimer)
    if (this.legacyAnimationTimer) window.cancelAnimationFrame(this.legacyAnimationTimer)
    if (this.legacyPanelAnimationTimer) window.cancelAnimationFrame(this.legacyPanelAnimationTimer)
    window.clearTimeout(this.nativeFrame)
    this.nativePress = undefined
    if (this.active?.holdTimer !== undefined) window.clearTimeout(this.active.holdTimer)
    this.clearPress()
    this.cancelEditTouch()
    this.guidesOverlay?.remove()
  }

  setMode(mode: "edit" | "preview"): void {
    if (this.mode === mode) return
    this.cancelDragDraw()
    this.mode = mode
    this.mobileMultiSelect = false
    if (this.active?.holdTimer !== undefined) window.clearTimeout(this.active.holdTimer)
    this.active = undefined
    this.clearPress()
    this.cancelEditTouch()
    this.cancelEditDrag()
    this.updateCursor()
    void this.draw()
  }

  cancelPointerInteraction(): void {
    const hadInteraction = Boolean(this.active || this.editTouch || this.editDrag)
    this.cancelDragDraw()
    if (this.active?.holdTimer !== undefined) window.clearTimeout(this.active.holdTimer)
    this.active = undefined
    this.clearPress()
    this.cancelEditTouch()
    this.cancelEditDrag()
    this.updateCursor()
    if (hadInteraction) void this.draw()
  }

  setPointerInteractionLocked(locked: boolean): void {
    this.pointerInteractionLocked = locked
    if (locked) this.cancelPointerInteraction()
    else if (this.renderDeferred) {
      this.renderDeferred = false
      this.draw()
    }
  }

  setEditTool(tool: "select" | "move"): void {
    if (this.editTool === tool) return
    this.cancelDragDraw()
    this.editTool = tool
    this.cancelEditTouch()
    this.cancelEditDrag()
    this.updateCursor()
    void this.draw()
  }

  /**
   * Edit mode keeps selection and pressing independent: a plain click still
   * selects, but it also flashes the key's highlight style so the editor can
   * see the pressed appearance without leaving edit mode.
   */
  flashPress(key: PreviewItem): void {
    if (this.pressed?.timeout !== undefined) window.clearTimeout(this.pressed.timeout)
    const timeout = window.setTimeout(() => {
      if (this.pressed?.section !== key.section) return
      this.pressed = undefined
      void this.draw()
    }, 180)
    this.pressed = { section: key.section, timeout }
  }

  private clearPress(): void {
    if (this.pressed?.timeout !== undefined) window.clearTimeout(this.pressed.timeout)
    this.pressed = undefined
  }

  keyPressed(key: PreviewItem): boolean {
    if (!this.pressed) return false
    return this.pressed.section === key.section ||
      key.sections.includes(this.pressed.section)
  }

  setSelected(sections: readonly string[]): void {
    this.selected = new Set(sections)
    if (!sections.length) this.mobileMultiSelect = false
    void this.draw()
  }

  /** Settles once the render already in flight (if any) has drawn the canvas. */
  rendered(): Promise<void> {
    return this.renderInFlight.catch(() => undefined)
  }

  /** Marks (or clears) the keys a pending AI draft would change. */
  setDraftSections(sections: readonly string[]): void {
    const next = new Set(sections)
    if (next.size === this.draftSections.size && [...next].every((section) => this.draftSections.has(section))) return
    this.draftSections = next
    void this.draw()
  }

  itemDrafted(item: PreviewItem): boolean {
    if (!this.draftSections.size) return false
    return item.sections.some((section) => this.draftSections.has(section))
  }

  setResolver(resolver?: VisualResolver): void {
    this.resolver = resolver
    this.visualCache.clear()
    this.resourceCache.clear()
    this.toolbarImagesCache = undefined
    this.lastRenderCache = undefined
    void this.draw()
  }

  setScene(scene?: (state: number | undefined) => Promise<NativeScene | undefined>): void {
    this.scene = scene
    this.scenes.clear()
    void this.draw()
  }

  /** The scene for the current keyboard state, built once per state. */
  sceneForState(): Promise<NativeScene | undefined> | undefined {
    if (!this.scene) return
    let scene = this.scenes.get(this.skinState)
    if (!scene) {
      const built = scene = this.scene(this.skinState)
      this.scenes.set(this.skinState, built)
      void built.then(() => {
        this.builtScenes.add(built)
        void this.draw()
      }, () => {})
    }
    return scene
  }

  /** Scenes whose build has finished, which painting need not wait for. */
  readonly builtScenes = new WeakSet<Promise<NativeScene | undefined>>()

  resolveVisual(styleID: string, highlighted: boolean): Promise<Visual | undefined> {
    const key = `${highlighted ? "1" : "0"}:${styleID}`
    let result = this.visualCache.get(key)
    if (!result) {
      result = this.resolver?.resolve(styleID, highlighted) ?? Promise.resolve(undefined)
      this.visualCache.set(key, result)
    }
    return result
  }

  resolveResource(resourceID: string): Promise<Visual | undefined> {
    let result = this.resourceCache.get(resourceID)
    if (!result) {
      const resource = this.resolver?.resolveResource?.(resourceID)
      result = resource
        ? resource.then((value) => value ?? this.resolveVisual(resourceID, false))
        : this.resolveVisual(resourceID, false)
      this.resourceCache.set(resourceID, result)
    }
    return result
  }

  resolveToolbar(): Promise<Visual[]> {
    if (!this.toolbarImagesCache) {
      this.toolbarImagesCache = this.toolbarSlots && !this.persistentOnly
        ? this.resolver?.resolveToolbarImages() ?? Promise.resolve([])
        : Promise.resolve([])
    }
    return this.toolbarImagesCache
  }

  setOffsets(offsets?: IniDocument): void {
    this.offsets = offsets
    void this.draw()
  }

  setDefaults(defaults?: IniDocument): void {
    this.defaults = defaults
    this.visualCache.clear()
    this.lastRenderCache = undefined
    this.keys = this.layoutItems()
    this.fitCanvas()
    void this.draw()
  }

  setTheme(theme: "light" | "dark"): void {
    this.theme = theme
    void this.draw()
  }

  setTransparent(transparent: boolean): void {
    this.transparent = transparent
    void this.draw()
  }

  setGuides(enabled: boolean): void {
    this.guides = enabled
    this.guidesOverlay?.toggleAttribute("hidden", !enabled)
    void this.draw()
  }

  setSkinState(state?: number): void {
    this.skinState = state
    if (this.nativeItems) this.keys = this.layoutItems()
    void this.draw()
  }

  setPersistentOnly(persistentOnly: boolean): void {
    if (this.persistentOnly === persistentOnly) return
    this.persistentOnly = persistentOnly
    this.visualCache.clear()
    this.toolbarImagesCache = undefined
    this.keys = this.layoutItems()
    void this.draw()
  }

  /** The keys the canvas shows: the native list, else the layout document's. */
  private layoutItems(persistentOnly = this.persistentOnly): PreviewItem[] {
    if (this.nativeItems) return this.nativeItems(this.skinState, persistentOnly)
    return this.document ? previewItems(this.document, this.panelWidth, this.panelHeight, this.defaults, persistentOnly) : []
  }

  expandSections(sections: readonly string[]): string[] {
    const requested = new Set(sections)
    return visiblePreviewItems(this.keys, this.skinState).flatMap((item) =>
      item.sections.some((section) => requested.has(section)) ? item.sections : []
    )
  }

  setAnimation(animation?: BdaAnimation): void {
    this.animation = animation
    this.animationVisual = undefined
    this.bdaAnimationState = undefined
    if (this.animationTimer) window.clearTimeout(this.animationTimer)
    if (this.bdaAnimationTimer) window.cancelAnimationFrame(this.bdaAnimationTimer)
    void this.draw()
  }

  setLegacyAnimation(animation?: LegacyAnimation): void {
    this.legacyAnimation = animation
    this.legacyAnimationState = undefined
    if (this.legacyAnimationTimer) window.cancelAnimationFrame(this.legacyAnimationTimer)
    this.restartLegacyPanelAnimation()
    void this.draw()
  }

  setLegacyHints(shortHint?: LegacyHint, longHint?: LegacyHint, bda = false): void {
    this.shortHint = shortHint
    this.longHint = longHint
    this.bdaHints = bda
    void this.draw()
  }

  setParticlePreview(emitter?: LegacyParticleEmitter): void {
    if (this.particlePreview === emitter) return
    this.particlePreview = emitter
    this.restartLegacyPanelAnimation()
    void this.draw()
  }

  setPanel(styleID: string, width: number, height: number, animationStyle = ""): void {
    const animationChanged = this.panelAnimationStyle !== animationStyle
    this.panelStyle = styleID
    this.visualCache.clear()
    this.lastRenderCache = undefined
    this.panelAnimationStyle = animationStyle
    this.panelWidth = width
    this.panelHeight = height
    this.keys = this.layoutItems()
    this.fitCanvas()
    if (animationChanged) this.restartLegacyPanelAnimation()
    void this.draw()
  }

  /** Lists the canvas keys from the skin's own data instead of the layout document. */
  setNativeItems(items?: (state: number | undefined, persistentOnly: boolean) => PreviewItem[]): void {
    this.nativeItems = items
    this.setDocument(this.document)
  }

  setDocument(document?: IniDocument): void {
    this.document = document
    // An edit to the layout is an edit to the skin a scene is built from.
    this.scenes.clear()
    this.visualCache.clear()
    this.lastRenderCache = undefined
    this.keys = this.layoutItems()
    const available = new Set(this.keys.map((key) => key.section))
    this.selected = new Set([...this.selected].filter((section) => available.has(section)))
    this.fitCanvas()
    void this.draw()
  }

  point(event: Pick<MouseEvent, "clientX" | "clientY">): { x: number; y: number } {
    const bounds = this.canvas.getBoundingClientRect()
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * this.panelWidth,
      y: ((event.clientY - bounds.top) / bounds.height) * this.surfaceHeight,
    }
  }

  snapThreshold(bounds: Pick<DOMRect, "width" | "height"> = this.canvas.getBoundingClientRect()): { x: number; y: number } {
    return {
      x: bounds.width ? 8 * this.panelWidth / bounds.width : 0,
      y: bounds.height ? 8 * this.surfaceHeight / bounds.height : 0,
    }
  }

  get surfaceHeight(): number {
    if (this.surfaceKeys !== this.keys) {
      this.surfaceKeys = this.keys
      // Measure every layout key, not only the persistent subset, so the canvas
      // keeps the same aspect as the viewport the editor sizes around it.
      this.surfaceHeightValue = previewSurfaceHeight(
        this.document || this.nativeItems ? this.layoutItems(false) : this.keys,
        this.panelHeight,
      )
    }
    return this.surfaceHeightValue
  }

  logicalSize(): { width: number; height: number } {
    return { width: this.panelWidth, height: this.surfaceHeight }
  }

  snapPoint(point: { x: number; y: number }, bounds?: Pick<DOMRect, "width" | "height">): { x: number; y: number } {
    return snapPointToRects(
      point,
      visiblePreviewItems(this.keys, this.skinState)
        .filter((key) => key.editable || this.toolbarSlots)
        .map((key) => key.rect),
      this.snapThreshold(bounds),
    )
  }

  /** The layout document whose TIP sections swap keys per state; native key lists are already swapped. */
  get stateDocument(): IniDocument | undefined {
    return this.nativeItems ? undefined : this.document
  }

  hit(point: { x: number; y: number }): PreviewItem | undefined {
    return this.stateDocument
      ? effectivePreviewHitItem(
        this.stateDocument,
        this.keys,
        point,
        this.mode,
        this.panelWidth,
        this.panelHeight,
        this.skinState,
      )
      : previewHitItem(
        this.keys,
        point,
        this.mode,
        this.panelWidth,
        this.panelHeight,
        this.skinState,
      )
  }

  itemSelected(item: PreviewItem): boolean {
    return item.sections.some((section) => this.selected.has(section))
  }

  async playAnimation(key: PreviewItem): Promise<void> {
    if (this.scene) return playNativePress(this, key)
    this.playLegacyAnimation(key)
    const effects = this.animation
      ? bdaAnimationBindingsForKey(this.animation, key).flatMap((binding) => bdaBindingEffects(this.animation!, binding))
      : []
    const duration = Math.max(0, ...effects.map(bdaEffectDuration))
    if (duration) {
      if (this.bdaAnimationTimer) window.cancelAnimationFrame(this.bdaAnimationTimer)
      this.bdaAnimationState = { key, startedAt: Date.now() }
      const tick = () => {
        const elapsed = this.bdaAnimationState ? Date.now() - this.bdaAnimationState.startedAt : duration + 1
        void this.draw()
        if (elapsed <= duration) this.bdaAnimationTimer = window.requestAnimationFrame(tick)
        else {
          this.bdaAnimationState = undefined
          this.bdaAnimationTimer = undefined
          void this.draw()
        }
      }
      this.bdaAnimationTimer = window.requestAnimationFrame(tick)
    }
    const sequence = animationSequenceForKey(this.animation, key)
    if (!sequence?.frames.length || !this.resolver?.resolveResource) return
    if (this.animationTimer) window.clearTimeout(this.animationTimer)
    const play = async (index: number) => {
      const frame = sequence.frames[index]
      if (!frame) {
        this.animationVisual = undefined
        void this.draw()
        return
      }
      if (frame.resourceID === undefined) return void play(index + 1)
      const visual = await this.resolver?.resolveResource?.(frame.resourceID)
      if (!visual) return
      this.animationVisual = { key, visual }
      void this.draw()
      this.animationTimer = window.setTimeout(() => void play(index + 1), Math.max(16, frame.duration ?? 0))
    }
    await play(0)
  }

  private restartLegacyPanelAnimation(): void {
    if (this.legacyPanelAnimationTimer) window.cancelAnimationFrame(this.legacyPanelAnimationTimer)
    this.legacyPanelAnimationTimer = undefined
    const particles = this.particlePreview
      ? [this.particlePreview]
      : this.legacyAnimation?.get(this.panelAnimationStyle)?.particles ?? []
    if (!particles.length) {
      this.legacyPanelAnimationStartedAt = 0
      return
    }
    this.legacyPanelAnimationStartedAt = Date.now()
    const duration = Math.max(...particles.map((particle) =>
      particle.totalNumber / particle.birthRate * 1000 + Math.max(...particle.life)
    ))
    const tick = () => {
      const elapsed = Date.now() - this.legacyPanelAnimationStartedAt
      void this.draw()
      if (elapsed <= duration) this.legacyPanelAnimationTimer = window.requestAnimationFrame(tick)
      else this.legacyPanelAnimationTimer = undefined
    }
    this.legacyPanelAnimationTimer = window.requestAnimationFrame(tick)
  }

  private playLegacyAnimation(key: PreviewItem): void {
    const styles = [key.animStyle, key.backAnimStyle, ...key.foreAnimStyles].filter(Boolean) as string[]
    const duration = Math.max(0, ...styles.flatMap((style) => {
      const frames = this.legacyAnimation?.get(style)?.frames
      return frames?.length
        ? [Math.max(...frames.map((frame) => frame.start + frame.delay + animationDuration(frame)))]
        : []
    }))
    if (!duration) return
    if (this.legacyAnimationTimer) window.cancelAnimationFrame(this.legacyAnimationTimer)
    this.legacyAnimationState = { key, startedAt: Date.now() }
    const tick = () => {
      const elapsed = Date.now() - this.legacyAnimationState!.startedAt
      if (elapsed >= duration) this.legacyAnimationState = undefined
      void this.draw()
      if (elapsed < duration) this.legacyAnimationTimer = window.requestAnimationFrame(tick)
    }
    tick()
  }

  private cancelEditDrag(): void {
    this.cancelDragDraw()
    if (!this.editDrag) return
    for (const key of this.keys) {
      const original = this.editDrag.original.get(key.section)
      if (original) key.rect = original
    }
    this.editDrag = undefined
  }

  cancelEditTouch(): void {
    if (this.editTouch?.longPressTimer !== undefined) window.clearTimeout(this.editTouch.longPressTimer)
    this.editTouch = undefined
  }

  updateCursor(): void {
    // 编辑模式开着十字光标时，十字线本身就是指针，系统光标隐藏
    this.canvas.style.cursor = this.mode === "preview" ? "pointer" : this.crosshair ? "none" : this.editTool === "move" ? "grab" : "default"
  }

  setCrosshair(on: boolean): void {
    this.crosshair = on
    this.updateCursor()
  }

  cancelDragDraw(): void {
    if (!this.dragDrawFrame) return
    window.cancelAnimationFrame(this.dragDrawFrame)
    this.dragDrawFrame = 0
  }

  private fitCanvas(): void {
    const width = Math.ceil(this.panelWidth)
    const height = Math.ceil(this.surfaceHeight)
    const changed = this.canvas.dataset.logicalWidth !== String(width) ||
      this.canvas.dataset.logicalHeight !== String(height)
    this.canvas.dataset.logicalWidth = String(width)
    this.canvas.dataset.logicalHeight = String(height)
    this.canvas.style.aspectRatio = `${width} / ${height}`
    if (changed) {
      const size = constrainedCanvasSize(
        width,
        height,
        Number(this.canvas.dataset.maxBackingWidth) || Number.POSITIVE_INFINITY,
        Number(this.canvas.dataset.maxBackingHeight) || Number.POSITIVE_INFINITY,
      )
      this.canvas.width = size.width
      this.canvas.height = size.height
    }
    requestAnimationFrame(() => this.resize())
  }

  resize(): void {
    const bounds = this.canvas.getBoundingClientRect()
    if (!bounds.width || !bounds.height) return
    const ratio = devicePixelRatio || 1
    // Keep the backing bitmap tied to the logical preview size, rather than
    // the current CSS size. Zooming changes the latter on every wheel tick;
    // resizing an HTML canvas clears its bitmap and exposes a blank frame
    // until the asynchronous draw completes (visible as flicker). The CSS
    // dimensions still control display scaling, while the backing store stays
    // stable and is only recreated when the logical panel or DPR changes.
    const logicalWidth = Number(this.canvas.dataset.logicalWidth)
    const logicalHeight = Number(this.canvas.dataset.logicalHeight)
    const size = constrainedCanvasSize(
      Number.isFinite(logicalWidth) && logicalWidth > 0 ? logicalWidth * ratio : bounds.width * ratio,
      Number.isFinite(logicalHeight) && logicalHeight > 0 ? logicalHeight * ratio : bounds.height * ratio,
      Number(this.canvas.dataset.maxBackingWidth) || Number.POSITIVE_INFINITY,
      Number(this.canvas.dataset.maxBackingHeight) || Number.POSITIVE_INFINITY,
    )
    if (!setCanvasSize(this.canvas, size.width, size.height)) return
    void this.draw()
  }

  draw(): void {
    if (this.renderPending) {
      this.renderAgain = true
      return
    }
    if (this.drawQueued) return
    // Coalesce updates across event handlers and promise callbacks into one frame.
    this.drawQueued = requestAnimationFrame(() => {
      this.drawQueued = 0
      if (this.renderPending) {
        this.renderAgain = true
        return
      }
      this.startRender()
    })
  }

  // 同步绘制方法，用于拖拽等需要立即响应的操作
  drawSync(): void {
    if (this.drawQueued) {
      cancelAnimationFrame(this.drawQueued)
      this.drawQueued = 0
    }
    if (this.renderPending) {
      this.renderAgain = true
      return
    }
    this.startRender()
  }

  /** 绘制交给 preview-paint.ts；这里只是调度用的接缝（测试会替换它）。 */
  render(): Promise<void> {
    return paintPreview(this)
  }

  private startRender(): void {
    // A full canvas repaint during a canvas pan drops frames; paint once when the pan ends.
    if (this.pointerInteractionLocked) {
      this.renderDeferred = true
      return
    }
    this.renderPending = true
    this.renderInFlight = this.render().finally(() => {
      this.renderPending = false
      if (this.renderAgain) {
        this.renderAgain = false
        this.draw()
      }
    })
  }
}
