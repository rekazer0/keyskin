// Node 侧的 `@/*` 解析：把 `@/x` 映射到 `src/x`，让 `node --test` 与 tsc、Vite 的路径别名一致。
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    return nextResolve(new URL(`../src/${specifier.slice(2)}`, import.meta.url).href, context)
  }
  return nextResolve(specifier, context)
}
