// Syntax lowering does not supply runtime APIs. Modern engines keep their native implementations.
if (!Array.prototype.at) {
  Object.defineProperty(Array.prototype, "at", {
    configurable: true,
    writable: true,
    value<T>(this: ArrayLike<T>, index: number): T | undefined {
      const offset = Math.trunc(index) || 0
      const at = offset < 0 ? this.length + offset : offset
      return at >= 0 && at < this.length ? this[at] : undefined
    },
  })
}

if (!Object.hasOwn) {
  Object.defineProperty(Object, "hasOwn", {
    configurable: true,
    writable: true,
    value: (value: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(value, key),
  })
}
