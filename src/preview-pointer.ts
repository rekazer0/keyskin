import type { Preview } from "./preview.ts"
import { isFullPanelPreviewItem } from "./preview-items.ts"
import { gestureDirection } from "./layout.ts"
import { isTouchLongPress } from "./preview-items.ts"
import { type PreviewItem } from "./preview-items.ts"
import { isAdditiveSelection } from "./preview-items.ts"
import { actionText } from "./skin-model/inspect.ts"
import type { KeyEvent } from "./skin-model/types.ts"

/** 方向到按键事件。 */
const DIRECTION_EVENTS: Readonly<Record<string, KeyEvent>> = {
  center: "press",
  up: "swipe-up",
  down: "swipe-down",
  left: "swipe-left",
  right: "swipe-right",
  hold: "long-press",
}

/** 某个方向的动作文本；没有动作就是空串。 */
function actionAt(key: PreviewItem, direction: string): string {
  const event = DIRECTION_EVENTS[direction]
  return event ? actionText(key.key.actions[event]) ?? "" : ""
}

/** 可见的按键：可见性由 IR 给。 */
function visibleKeys(keys: readonly PreviewItem[]): PreviewItem[] {
  return keys.filter((render) => render.visible)
}
import { snapRectDelta } from "./layout.ts"
import { hintKeyOf, legacyHintCandidates, legacyHintHasHold, legacyHintSelectedIndex } from "./preview-hints.ts"

function nativeHold(self: Preview, key: PreviewItem) {
  return self.drawnScene?.keys.find((item) => item.section === key.section)?.holdPopup
}

function hasHold(self: Preview, key: PreviewItem): boolean {
  return Boolean(nativeHold(self, key)) || legacyHintHasHold(hintKeyOf(key), self.longHint ?? self.shortHint,
    Boolean(self.stateDocument) || self.bdaHints || Boolean((self.longHint ?? self.shortHint)?.defaultCandidates))
}

function holdCandidates(self: Preview, key: PreviewItem): string[] {
  return nativeHold(self, key)?.candidates ?? legacyHintCandidates(hintKeyOf(key), "hold",
    Boolean(self.stateDocument) || self.bdaHints || Boolean((self.longHint ?? self.shortHint)?.defaultCandidates))
}

export function pointerDown(self: Preview, event: PointerEvent): void {
  if (self.pointerInteractionLocked || event.button !== 0) return
  const point = self.point(event)
  const key = self.hit(point)
  if (self.mode === "edit" && (self.editTool === "select" || self.editTool === "multi") && !self.toolbarSlots && event.pointerType === "mouse") {
    self.marquee = { pointerId: event.pointerId, start: point, clientX: event.clientX, clientY: event.clientY, key }
    self.canvas.setPointerCapture(event.pointerId)
    // 多选模式只负责框选与加减选，按下按键不播放按下态，避免连续挑键时画面一直闪。
    if (key && self.editTool === "select") {
      if (!self.animationView) self.flashPress(key)
      playPressedKey(self, key)
    }
    return
  }
  if (self.mode === "edit" && self.editTool === "select" && event.pointerType === "touch") {
    self.editTouch = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      key,
      clientX: event.clientX,
      clientY: event.clientY,
      startedAt: Date.now(),
      longPress: false,
    }
    const touch = self.editTouch
    if (key) touch.longPressTimer = window.setTimeout(() => {
      if (self.editTouch !== touch) return
      touch.longPress = true
      holdSelection(self, key)
    }, 450)
    self.canvas.setPointerCapture(event.pointerId)
    return
  }
  if (self.animationView) {
    if (self.mode !== "edit") {
      if (key) playPressedKey(self, key)
      return
    }
    if (key) pickKey(self, key, event)
    else self.selected.clear()
    self.onAnimationKeys([...self.selected])
    if (key) playPressedKey(self, key)
    void self.draw()
    return
  }
  if (!key) {
    if (self.mode === "edit") {
      self.selected.clear()
      self.mobileMultiSelect = false
      self.onSelect([])
      void self.draw()
    }
    return
  }
  if (self.mode === "edit") {
    pickKey(self, key, event)
    notifySelection(self)
    self.flashPress(key)
    playPressedKey(self, key)
    // 不可编辑的项（列表容器、列表格）不参与拖动。
    if (self.editTool === "move" && key.editable) {
      const selectedSections = new Set(
        visibleKeys(self.keys)
          .filter((item) => self.itemSelected(item) && item.editable)
          .flatMap((item) => item.sections),
      )
      const selectedKeys = self.keys.filter((item) => selectedSections.has(item.section))
      self.editDrag = {
        pointerId: event.pointerId,
        startX: point.x,
        startY: point.y,
        original: new Map(selectedKeys.map((item) => [item.section, { ...item.rect }])),
      }
      event.stopPropagation()
      self.canvas.setPointerCapture(event.pointerId)
      self.canvas.style.cursor = self.crosshair ? "none" : "grabbing"
    }
    void self.draw()
    return
  }
  self.canvas.setPointerCapture(event.pointerId)
  self.active = {
    pointerId: event.pointerId,
    key,
    startX: point.x,
    startY: point.y,
    startedAt: Date.now(),
    clearOnHold: actionAt(key, "center").trim() === "F36",
    holdTriggered: false,
    direction: "center",
  }
  if (self.active.clearOnHold || hasHold(self, key)) {
    const active = self.active
    active.holdTimer = window.setTimeout(() => {
      if (self.active !== active) return
      active.direction = "hold"
      if (active.clearOnHold) {
        active.holdTriggered = true
        self.onEvent({ section: key.section, direction: "hold", code: "F48" })
      }
      void self.draw()
    }, 450)
  }
  playPressedKey(self, key)
  void self.draw()
}

function updateMarquee(self: Preview, event: PointerEvent) {
  const drag = self.marquee!
  if (!drag.rect && Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) < 3) return
  const { x, y } = self.point(event)
  return drag.rect = { x: Math.min(x, drag.start.x), y: Math.min(y, drag.start.y),
    width: Math.abs(x - drag.start.x), height: Math.abs(y - drag.start.y) }
}

export function pointerMove(self: Preview, event: PointerEvent): void {
  if (self.marquee && self.marquee.pointerId === event.pointerId) {
    if (updateMarquee(self, event)) void self.draw()
    return
  }
  if (self.active && event.pointerId === self.active.pointerId) {
    const point = self.point(event)
    if (self.active.direction === "hold" && self.active.hintCellWidth && !self.active.clearOnHold) {
      const candidates = holdCandidates(self, self.active.key)
      const index = Math.max(0, Math.min(candidates.length - 1, (nativeHold(self, self.active.key)?.selected ?? legacyHintSelectedIndex(hintKeyOf(self.active.key), candidates))
        + Math.round((point.x - self.active.startX) / self.active.hintCellWidth)))
      if (self.active.hintIndex !== index) {
        self.active.hintIndex = index
        void self.draw()
      }
      return
    }
    const direction = gestureDirection(
      point.x - self.active.startX,
      point.y - self.active.startY,
      Date.now() - self.active.startedAt,
      hasHold(self, self.active.key) || self.active.clearOnHold,
    )
    if (direction !== self.active.direction) {
      self.active.direction = direction
      void self.draw()
    }
    if (Math.max(
      Math.abs(point.x - self.active.startX),
      Math.abs(point.y - self.active.startY),
    ) >= 20 && self.active.holdTimer !== undefined) {
      window.clearTimeout(self.active.holdTimer)
      self.active.holdTimer = undefined
    }
  }
  if (self.editTouch?.pointerId === event.pointerId && !self.editTouch.longPress) {
    const distance = Math.hypot(event.clientX - self.editTouch.clientX, event.clientY - self.editTouch.clientY)
    if (distance > 12) self.cancelEditTouch()
  }
  if (!self.editDrag || self.editDrag.pointerId !== event.pointerId) return
  const point = self.point(event)
  const { x: dx, y: dy } = dragDelta(self, point)
  for (const key of self.keys) {
    const original = self.editDrag.original.get(key.section)
    if (original) key.rect = { ...original, x: original.x + dx, y: original.y + dy }
  }
  if (!self.dragDrawFrame) {
    self.dragDrawFrame = window.requestAnimationFrame(() => {
      self.dragDrawFrame = 0
      if (self.editDrag) void self.drawSync()
    })
  }
}

export function pointerUp(self: Preview, event: PointerEvent): void {
  if (event.pointerType === "mouse" && self.marquee && self.marquee.pointerId === event.pointerId) {
    const { key } = self.marquee
    const box = updateMarquee(self, event)
    self.marquee = undefined
    if (box) {
      const hits = visibleKeys(self.keys).filter(({ editable, rect }) => editable &&
        rect.x <= box.x + box.width && rect.x + rect.width >= box.x &&
        rect.y <= box.y + box.height && rect.y + rect.height >= box.y &&
        !isFullPanelPreviewItem({ rect }, self.panelWidth, self.panelHeight))
      self.selected = new Set([...(isAdditiveSelection(event) ? self.selected : []), ...hits.map(item => item.section)])
      self.selectionAnchor = hits.at(-1)?.section
    } else if (key) {
      // 多选模式下点按键是加减选，不是替换当前选择。
      if (self.editTool === "multi") {
        const next = new Set(self.selected)
        if (next.has(key.section)) next.delete(key.section)
        else next.add(key.section)
        self.selected = next
        self.selectionAnchor = key.section
      } else pickKey(self, key, event)
    } else self.selected.clear()
    if (!self.selected.size) self.mobileMultiSelect = false
    notifySelection(self)
    void self.draw()
    return
  }
  if (self.editTouch?.pointerId === event.pointerId) {
    const touch = self.editTouch
    self.cancelEditTouch()
    const distance = Math.hypot(event.clientX - touch.clientX, event.clientY - touch.clientY)
    if (touch.longPress || distance > 12) return
    if (!touch.key) {
      self.selected.clear()
      self.mobileMultiSelect = false
      notifySelection(self)
      void self.draw()
      return
    }
    if (isTouchLongPress(touch.pointerType, Date.now() - touch.startedAt, distance)) {
      holdSelection(self, touch.key)
      return
    }
    pickKey(self, touch.key, {
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey || self.mobileMultiSelect,
      shiftKey: event.shiftKey,
    })
    notifySelection(self)
    if (!self.animationView) self.flashPress(touch.key)
    playPressedKey(self, touch.key)
    void self.draw()
    return
  }
  if (self.editDrag?.pointerId === event.pointerId) {
    const drag = self.editDrag
    const point = self.point(event)
    const { x: dx, y: dy } = dragDelta(self, point)
    self.cancelDragDraw()
    self.editDrag = undefined
    self.updateCursor()
    // 拖拽结束，清除缓存以便下次正常渲染
    self.lastRenderCache = undefined
    if (dx || dy) {
      self.onMove([...drag.original.keys()], dx, dy)
    }
    else void self.draw()
    return
  }
  if (!self.active || self.active.pointerId !== event.pointerId) return
  const point = self.point(event)
  const active = self.active
  const { key, startX, startY, startedAt } = active
  if (active.holdTimer !== undefined) window.clearTimeout(active.holdTimer)
  if (active.holdTriggered) {
    self.active = undefined
    void self.draw()
    return
  }
  const dx = point.x - startX
  const dy = point.y - startY
  const clearOnHold = actionAt(key, "center").trim() === "F36"
  const direction = active.direction === "hold" && active.hintCellWidth ? "hold" : gestureDirection(
    dx,
    dy,
    Date.now() - startedAt,
    hasHold(self, key) || clearOnHold,
  )
  const candidates = direction === "hold" ? holdCandidates(self, key) : []
  const index = active.hintIndex ?? nativeHold(self, key)?.selected ?? legacyHintSelectedIndex(hintKeyOf(key), candidates)
  const code = direction === "hold" && clearOnHold ? "F48" : direction === "hold" && candidates.length ? candidates[index] : actionAt(key, direction)
  self.onEvent({
    section: key.section,
    direction,
    code,
    holdSymbols: direction === "hold" && !active.hintCellWidth ? key.key.holdSymbol : undefined,
  })
  const release = () => {
    if (self.active !== active) return
    self.active = undefined
    void self.draw()
  }
  globalThis.setTimeout(release, 160)
}

/** A canvas press takes over from the paused player and uses the state currently drawn. */
function playPressedKey(self: Preview, key: PreviewItem): void {
  self.setPlayerParticles()
  // 状态覆盖已经在 IR 里合进渲染项，这里直接用当前画出的那个键。
  void self.playAnimation(key)
}

function notifySelection(self: Preview): void {
  if (self.animationView) self.onAnimationKeys([...self.selected])
  else self.onSelect([...self.selected])
}

function holdSelection(self: Preview, key: PreviewItem): void {
  self.mobileMultiSelect = true
  self.selected.add(key.section)
  self.selectionAnchor = key.section
  notifySelection(self)
  void self.draw()
}

/** 点按键改选择：Shift 连选、Cmd/Ctrl 加减选；不通知。 */
function pickKey(self: Preview, key: PreviewItem, event: Pick<PointerEvent, "metaKey" | "ctrlKey" | "shiftKey">): void {
  if (self.mode === "edit" && event.shiftKey && self.selectionAnchor) {
    const sections = visibleKeys(self.keys)
      .filter((item) => item.editable).map((item) => item.section)
    const from = sections.indexOf(self.selectionAnchor)
    const to = sections.indexOf(key.section)
    if (from >= 0 && to >= 0) {
      self.selected = new Set(sections.slice(Math.min(from, to), Math.max(from, to) + 1))
    }
  } else if (self.mode === "edit" && isAdditiveSelection(event)) {
    if (self.itemSelected(key)) key.sections.forEach((section) => self.selected.delete(section))
    else self.selected.add(key.section)
  } else if (!self.itemSelected(key) || self.mode === "preview" || self.editTool === "select") {
    // 普通单击只选中这一个键；多选时单击收为单选。
    // 移动工具下保留多选，便于整体拖动。
    self.selected = new Set([key.section])
  }
  if (self.mobileMultiSelect && !self.selected.size) self.mobileMultiSelect = false
  if (self.mode === "edit" && !event.shiftKey) self.selectionAnchor = key.section
}

function dragDelta(self: Preview, point: { x: number; y: number }): { x: number; y: number } {
  if (!self.editDrag) return { x: 0, y: 0 }
  return snapRectDelta(
    [...self.editDrag.original.values()],
    visibleKeys(self.keys)
      .filter((key) => key.editable && !self.editDrag?.original.has(key.section))
      .map((key) => key.rect),
    {
      x: Math.round(point.x - self.editDrag.startX),
      y: Math.round(point.y - self.editDrag.startY),
    },
    self.snapThreshold(),
  )
}
