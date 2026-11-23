// Imported before app startup: syntax lowering does not supply runtime APIs.
function install(target: object, name: PropertyKey, value: unknown): void {
  if (!(name in target)) Object.defineProperty(target, name, { configurable: true, writable: true, value })
}

install(Array.prototype, "at", function <T>(this: ArrayLike<T>, index: number): T | undefined {
  const offset = Math.trunc(index) || 0
  const at = offset < 0 ? this.length + offset : offset
  return at >= 0 && at < this.length ? this[at] : undefined
})
install(Object, "hasOwn", (value: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(value, key))
install(String.prototype, "replaceAll", function (this: string, search: string | RegExp, replacement: string | Parameters<String["replace"]>[1]): string {
  if (search instanceof RegExp && !search.global) throw new TypeError("replaceAll requires a global RegExp")
  const pattern = search instanceof RegExp ? search : new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")
  return typeof replacement === "function" ? this.replace(pattern, replacement) : this.replace(pattern, replacement)
})
install(Promise, "allSettled", (values: Iterable<unknown>) => Promise.all(Array.from(values, value => Promise.resolve(value).then(
  value => ({ status: "fulfilled", value }),
  reason => ({ status: "rejected", reason }),
))))

// Chrome 74 already streams Blob bodies through Fetch. Retain bounded reads for the large-file progress path.
install(Blob.prototype, "arrayBuffer", function (this: Blob) { return new Response(this).arrayBuffer() })
install(Blob.prototype, "stream", function (this: Blob) { return new Response(this).body! })

install(Element.prototype, "replaceChildren", function (this: Element, ...nodes: (Node | string)[]) {
  const fragment = this.ownerDocument.createDocumentFragment()
  fragment.append(...nodes)
  this.textContent = ""
  this.appendChild(fragment)
})
install(Element.prototype, "checkVisibility", function (this: Element) { return this.getClientRects().length !== 0 })
// The layout overview only uses this to wait for or skip cosmetic CSS transitions.
install(Element.prototype, "getAnimations", () => [])
install(CanvasRenderingContext2D.prototype, "roundRect", function (this: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius = 0) {
  // All app calls use a single circular corner radius.
  if (radius < 0) throw new RangeError("Negative corner radius")
  const r = Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2)
  if (!r) return this.rect(x, y, width, height)
  const right = x + width, bottom = y + height
  this.moveTo(x + Math.sign(width) * r, y)
  this.arcTo(right, y, right, bottom, r)
  this.arcTo(right, bottom, x, bottom, r)
  this.arcTo(x, bottom, x, y, r)
  this.arcTo(x, y, right, y, r)
  this.closePath()
})

// Use a real submit button so validation and method="dialog" still run.
install(HTMLFormElement.prototype, "requestSubmit", function (this: HTMLFormElement, submitter?: HTMLButtonElement | HTMLInputElement) {
  if (submitter) return submitter.click()
  const button = this.ownerDocument.createElement("button")
  button.hidden = true
  this.append(button)
  try { button.click() } finally { button.remove() }
})
if (typeof SubmitEvent === "undefined") {
  const clicks = new WeakMap<HTMLFormElement, Event>()
  document.addEventListener("click", event => {
    const button = event.target instanceof Element ? event.target.closest("button, input") : null
    if (!(button instanceof HTMLButtonElement || button instanceof HTMLInputElement)) return
    const form = button.form
    if (!form || (button.type !== "submit" && button.type !== "image")) return
    clicks.set(form, event)
    setTimeout(() => { if (clicks.get(form) === event) clicks.delete(form) }, 0)
  }, true)
  document.addEventListener("submit", event => {
    if (!(event.target instanceof HTMLFormElement)) return
    const click = clicks.get(event.target)
    clicks.delete(event.target)
    const target = click?.target
    Object.defineProperty(event, "submitter", { value: target instanceof Element ? target.closest("button, input") : null })
  }, true)
}

install(Crypto.prototype, "randomUUID", function (this: Crypto) {
  const bytes = this.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
})
