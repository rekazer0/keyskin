import type { Preview } from "./preview.ts"
import { visiblePreviewItems } from "./preview-items.ts"
import { gestureDirection } from "./layout.ts"
import { isTouchLongPress } from "./preview-items.ts"
import { type PreviewItem } from "./preview-items.ts"
import { isAdditiveSelection } from "./preview-items.ts"
import { snapRectDelta } from "./layout.ts"

export function pointerDown(self: Preview, event: PointerEvent): void {
  if (self.pointerInteractionLocked) return
  const point = self.point(event)
  const key = self.hit(point)
  if (self.animationView) {
    if (key) void self.playAnimation(key)
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
  if (self.mode === "edit" && self.editTool === "select" && event.pointerType === "touch") {
    self.editTouch = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      key,
      startX: point.x,
      startY: point.y,
      clientX: event.clientX,
      clientY: event.clientY,
      startedAt: Date.now(),
      longPress: false,
    }
    const touch = self.editTouch
    touch.longPressTimer = window.setTimeout(() => {
      if (self.editTouch !== touch) return
      touch.longPress = true
      self.mobileMultiSelect = true
      self.selected.add(key.section)
      self.selectionAnchor = key.section
      self.onSelect([...self.selected])
      void self.draw()
    }, 450)
    self.canvas.setPointerCapture(event.pointerId)
    return
  }
  if (self.mode === "edit") {
    selectKey(self, key, event)
    self.flashPress(key)
    if (self.editTool === "move" && !key.section.startsWith("LIST")) {
      const selectedSections = new Set(
        visiblePreviewItems(self.keys, self.skinState)
          .filter((item) => self.itemSelected(item) && !item.section.startsWith("LIST"))
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
    clearOnHold: key.center.trim() === "F36",
    holdTriggered: false,
    direction: "center",
  }
  if (self.active.clearOnHold || key.hold || key.holdSymbols || self.bdaHints) {
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
  void self.playAnimation(key)
  void self.draw()
}

export function pointerMove(self: Preview, event: PointerEvent): void {
  if (self.active && event.pointerId === self.active.pointerId) {
    const point = self.point(event)
    const direction = gestureDirection(
      point.x - self.active.startX,
      point.y - self.active.startY,
      Date.now() - self.active.startedAt,
      Boolean(self.active.key.hold || self.active.key.holdSymbols) || self.active.clearOnHold || self.bdaHints,
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
    if (distance > 12 && self.editTouch.longPressTimer !== undefined) {
      window.clearTimeout(self.editTouch.longPressTimer)
      self.editTouch.longPressTimer = undefined
    }
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
  if (self.editTouch?.pointerId === event.pointerId) {
    const touch = self.editTouch
    self.cancelEditTouch()
    const distance = Math.hypot(event.clientX - touch.clientX, event.clientY - touch.clientY)
    const longPress = touch.longPress || isTouchLongPress(
      touch.pointerType,
      Date.now() - touch.startedAt,
      distance,
    )
    if (longPress) {
      self.mobileMultiSelect = true
      self.selected.add(touch.key.section)
      self.selectionAnchor = touch.key.section
      self.onSelect([...self.selected])
    } else {
      selectKey(self, touch.key, {
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey || self.mobileMultiSelect,
        shiftKey: event.shiftKey,
      })
    }
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
  if (!self.active) return
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
  const clearOnHold = key.center.trim() === "F36"
  const direction = gestureDirection(
    dx,
    dy,
    Date.now() - startedAt,
    Boolean(key.hold || key.holdSymbols) || clearOnHold || self.bdaHints,
  )
  const code = direction === "hold" && clearOnHold ? "F48" : key[direction]
  self.onEvent({
    section: key.section,
    direction,
    code,
    holdSymbols: direction === "hold" ? key.holdSymbols : undefined,
  })
  const release = () => {
    if (self.active !== active) return
    self.active = undefined
    void self.draw()
  }
  globalThis.setTimeout(release, 160)
}

export function selectKey(self: Preview, key: PreviewItem, event: Pick<PointerEvent, "metaKey" | "ctrlKey" | "shiftKey">): void {
  if (self.mode === "edit" && event.shiftKey && self.selectionAnchor) {
    const sections = visiblePreviewItems(self.keys, self.skinState)
      .filter((item) => item.editable).map((item) => item.section)
    const from = sections.indexOf(self.selectionAnchor)
    const to = sections.indexOf(key.section)
    if (from >= 0 && to >= 0) {
      self.selected = new Set(sections.slice(Math.min(from, to), Math.max(from, to) + 1))
    }
  } else if (self.mode === "edit" && isAdditiveSelection(event)) {
    if (self.itemSelected(key)) key.sections.forEach((section) => self.selected.delete(section))
    else self.selected.add(key.section)
  } else if (self.mode === "edit" && self.editTool === "select" && self.selected.size === 1 && self.itemSelected(key)) {
    // 再次单击唯一选中的键即取消选中
    self.selected = new Set()
  } else if (!self.itemSelected(key) || self.mode === "preview" || self.editTool === "select") {
    // 普通单击只选中这一个键；多选时单击收为单选。
    // 移动工具下保留多选，便于整体拖动。
    self.selected = new Set([key.section])
  }
  if (self.mobileMultiSelect && !self.selected.size) self.mobileMultiSelect = false
  if (self.mode === "edit" && !event.shiftKey) self.selectionAnchor = key.section
  self.onSelect([...self.selected])
}

function dragDelta(self: Preview, point: { x: number; y: number }): { x: number; y: number } {
  if (!self.editDrag) return { x: 0, y: 0 }
  return snapRectDelta(
    [...self.editDrag.original.values()],
    visiblePreviewItems(self.keys, self.skinState)
      .filter((key) => key.editable && !self.editDrag?.original.has(key.section))
      .map((key) => key.rect),
    {
      x: Math.round(point.x - self.editDrag.startX),
      y: Math.round(point.y - self.editDrag.startY),
    },
    self.snapThreshold(),
  )
}
