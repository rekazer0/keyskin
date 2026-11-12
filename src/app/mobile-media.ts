// 移动端 App 外壳的断点。单独成模块，让 shell、画布、文件树等都能直接引用而不互相循环导入。
export const mobileShellQuery = matchMedia(
  "(max-width: 760px), (max-width: 950px) and (max-height: 600px) and (orientation: landscape)",
)
