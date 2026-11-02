const cleanups = new Map<Element, () => void>()
const pending = { frame: 0, timer: undefined as ReturnType<typeof setTimeout> | undefined, observer: undefined as MutationObserver | undefined }

function flushCleanup(): void {
  cancelAnimationFrame(pending.frame)
  clearTimeout(pending.timer)
  pending.frame = 0
  pending.timer = undefined
  for (const [node, cleanup] of cleanups) {
    if (node.isConnected) continue
    cleanups.delete(node)
    cleanup()
  }
  if (!cleanups.size) pending.observer?.disconnect()
}

function scheduleCleanup(): void {
  if (pending.frame) return
  pending.frame = requestAnimationFrame(flushCleanup)
  // Source watchers still rebuild DOM while background WebViews suspend animation frames.
  pending.timer = setTimeout(flushCleanup, 1000)
}

/** Release generated DOM resources after removal; synchronous moves/reuse keep them alive. */
export function releaseOnRemove(node: Element, cleanup: () => void): void {
  if (!pending.observer) pending.observer = new MutationObserver((records) => {
    if (records.some((record) => record.removedNodes.length)) scheduleCleanup()
  })
  if (!cleanups.size) pending.observer.observe(document.body, { childList: true, subtree: true })
  cleanups.set(node, cleanup)
  // Also discard components built but replaced before they ever reach the document.
  scheduleCleanup()
}
