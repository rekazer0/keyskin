// 测试用的盒子构造与读取：与 taffy 的 LayoutBox（position + size）保持一致。
export const box = (x, y, width, height) => ({ position: { x, y }, size: { width, height } })

export const rectOf = (value) => ({ x: value.position.x, y: value.position.y, width: value.size.width, height: value.size.height })
