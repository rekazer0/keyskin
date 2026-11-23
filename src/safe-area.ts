function resolveViewportFrame(options: {
  viewportHeight: number
  viewportOffsetTop: number
  viewportOffsetLeft: number
  viewportWidth: number
  layoutHeight: number
  layoutWidth: number
}): { height: number; width: number; offsetTop: number; offsetLeft: number } {
  return {
    height: Math.max(1, options.viewportHeight || options.layoutHeight),
    width: Math.max(1, options.viewportWidth || options.layoutWidth),
    offsetTop: Math.max(0, options.viewportOffsetTop),
    offsetLeft: Math.max(0, options.viewportOffsetLeft),
  }
}

function isKeyboardViewportOpen(options: {
  viewportHeight: number
  baselineHeight: number
}): boolean {
  const baseline = Math.max(1, options.baselineHeight)
  const threshold = Math.max(80, baseline * 0.15)
  return baseline - Math.max(1, options.viewportHeight) > threshold
}

function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true
  if (target instanceof HTMLInputElement) {
    return !["button", "checkbox", "radio", "file", "submit", "reset", "hidden", "image", "range", "color"].includes(target.type)
  }
  return Boolean(target.closest?.(".cm-content, .cm-editor"))
}

function revealFocusedInput(): void {
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || !isTextInput(active)) return
  const scroller = active.closest("#quick-inspector, #resource-inspector, #source-editor, aside #files, .source")
  if (!(scroller instanceof HTMLElement)) return
  const viewport = window.visualViewport
  const viewportTop = viewport?.offsetTop ?? 0
  const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight)
  const scrollerRect = scroller.getBoundingClientRect()
  const activeRect = active.getBoundingClientRect()
  const visibleTop = Math.max(scrollerRect.top, viewportTop) + 8
  const visibleBottom = Math.min(scrollerRect.bottom, viewportBottom) - 8
  if (activeRect.top < visibleTop) scroller.scrollTop -= visibleTop - activeRect.top
  else if (activeRect.bottom > visibleBottom) scroller.scrollTop += activeRect.bottom - visibleBottom
}

function resetPageOffset(): void {
  document.documentElement.scrollTop = 0
  document.documentElement.scrollLeft = 0
  document.body.scrollTop = 0
  document.body.scrollLeft = 0
  if (window.scrollX || window.scrollY) window.scrollTo(0, 0)
}

export function installSafeAreaLock(root: HTMLElement = document.documentElement): () => void {
  let baselineViewportHeight = window.visualViewport?.height ?? window.innerHeight
  let keyboardWasOpen = false
  let restoreTimers: number[] = []
  let frameRequest = 0
  let shouldReveal = false
  let androidImeOverlap = 0

  const restoreAfterKeyboard = () => {
    const active = document.activeElement
    if (active instanceof HTMLElement && isTextInput(active)) active.blur()
    for (const timer of restoreTimers) window.clearTimeout(timer)
    restoreTimers = [0, 120, 360].map((delay) => window.setTimeout(resetPageOffset, delay))
  }
  const sync = (reveal = false) => {
    const viewport = window.visualViewport
    const frame = resolveViewportFrame({
      viewportHeight: viewport?.height ?? window.innerHeight,
      viewportOffsetTop: viewport?.offsetTop ?? 0,
      viewportOffsetLeft: viewport?.offsetLeft ?? 0,
      viewportWidth: viewport?.width ?? window.innerWidth,
      layoutHeight: window.innerHeight,
      layoutWidth: window.innerWidth,
    })
    baselineViewportHeight = Math.max(baselineViewportHeight, frame.height)
    const visibleHeight = Math.min(frame.height, Math.max(1, window.innerHeight - androidImeOverlap))
    const focusedInput = isTextInput(document.activeElement)
    const viewportShrunk = isKeyboardViewportOpen({
      viewportHeight: visibleHeight,
      baselineHeight: baselineViewportHeight,
    })
    const keyboardOpen = androidImeOverlap > 0 || viewportShrunk && (focusedInput || keyboardWasOpen)
    // visualViewport reports controls that overlap the layout viewport. Browser
    // chrome already excluded by dvh needs no extra inset. Ignore keyboard and
    // pinch-zoom geometry; neither describes browser controls.
    const browserOverlay = !keyboardOpen && (viewport?.scale ?? 1) === 1
    root.style.setProperty("--browser-occlusion-top", `${browserOverlay ? frame.offsetTop : 0}px`)
    root.style.setProperty("--browser-occlusion-bottom", `${browserOverlay ? Math.max(0, window.innerHeight - frame.height - frame.offsetTop) : 0}px`)
    if (root.dataset.keyboardOpen !== String(keyboardOpen)) root.dataset.keyboardOpen = String(keyboardOpen)
    const keyboardHeight = keyboardOpen ? `${Math.round(visibleHeight)}px` : ""
    if (root.style.getPropertyValue("--keyboard-viewport-height") !== keyboardHeight) root.style.setProperty("--keyboard-viewport-height", keyboardHeight)
    if (reveal && keyboardOpen) revealFocusedInput()
    if (keyboardWasOpen && !keyboardOpen) restoreAfterKeyboard()
    keyboardWasOpen = keyboardOpen
  }
  const schedule = () => {
    if (frameRequest) return
    frameRequest = window.requestAnimationFrame(() => {
      frameRequest = 0
      const reveal = shouldReveal
      shouldReveal = false
      sync(reveal)
    })
  }
  const reveal = () => {
    shouldReveal = true
    schedule()
  }
  const onAndroidIme: EventListener = event => {
    androidImeOverlap = (event as CustomEvent<number>).detail
    reveal()
  }
  const resetOrientation = () => {
    baselineViewportHeight = window.visualViewport?.height ?? window.innerHeight
    schedule()
    window.setTimeout(schedule, 250)
  }

  const listeners: Array<[EventTarget, string, EventListener]> = [
    [window, "resize", schedule],
    [window, "orientationchange", resetOrientation],
    [document, "focusin", reveal],
    [document, "focusout", schedule],
    [root, "android-ime-overlap", onAndroidIme],
  ]
  const viewport = window.visualViewport
  if (viewport) listeners.push([viewport, "resize", reveal], [viewport, "scroll", reveal])
  for (const [target, type, listener] of listeners) target.addEventListener(type, listener, { passive: true })
  sync(false)
  return () => {
    for (const [target, type, listener] of listeners) target.removeEventListener(type, listener)
    for (const timer of restoreTimers) window.clearTimeout(timer)
    window.cancelAnimationFrame(frameRequest)
    root.style.removeProperty("--keyboard-viewport-height")
    root.style.removeProperty("--browser-occlusion-top")
    root.style.removeProperty("--browser-occlusion-bottom")
    delete root.dataset.keyboardOpen
  }
}
