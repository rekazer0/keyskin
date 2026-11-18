// 注册 `@/*` 解析钩子；用 `node --import ./scripts/alias-loader.mjs ...` 启用。
import { register } from "node:module"

register("./alias-hooks.mjs", import.meta.url)
