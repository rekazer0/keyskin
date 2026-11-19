// 迁移期兼容入口：PNG 编解码已提升为公共的 `@/raster.ts`，这里只转发旧引用。
// 新代码直接引用 `@/raster.ts`；旧引用迁移完后删除本文件。
export * from "../raster.ts"
