/** Clone skin/configuration data on WebViews predating structuredClone. */
export function cloneJson<T>(value: T): T {
  return typeof globalThis.structuredClone === "function" ? globalThis.structuredClone(value)
    : value === undefined ? value : JSON.parse(JSON.stringify(value))
}
