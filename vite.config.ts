import { defineConfig } from "vite"
import { realpathSync } from "node:fs"
import { fileURLToPath } from "node:url"

export default defineConfig({
  base: "./",
  // worktree 共用 node_modules 时，预构建缓存仍须各自独立。
  cacheDir: ".tmp/vite",
  build: {
    manifest: true,
    rollupOptions: {
      input: ["index.html", "picker.html", "new-project.html"],
      output: {
        manualChunks: {
          // 核心编辑器
          editor: ["@codemirror/commands", "@codemirror/lang-json", "@codemirror/language", "@codemirror/state", "@codemirror/view"],
          // AI 功能
          ai: ["@earendil-works/pi-agent-core", "@earendil-works/pi-ai", "deep-chat"],
          // 音频处理
          audio: ["@wasm-audio-decoders/ogg-vorbis"],
        },
      },
    },
    target: "es2022",
    minify: "esbuild",
    cssMinify: true,
    cssCodeSplit: true,
    // 预加载优化
    modulePreload: {
      polyfill: true,
    },
    // 优化 chunk 大小
    chunkSizeWarningLimit: 1000,
    // 压缩配置
    terserOptions: {
      compress: {
        drop_console: false,
        drop_debugger: true,
        pure_funcs: ["console.debug"],
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    fs: {
      allow: [fileURLToPath(new URL(".", import.meta.url)), realpathSync(new URL("./node_modules", import.meta.url))],
    },
    watch: { ignored: ["**/src-tauri/**"] },
  },
  // 优化依赖预构建
  optimizeDeps: {
    // 启动时扫描全部源码，避免运行中发现新依赖触发重新预构建、旧 chunk 失效导致白屏
    entries: ["index.html", "picker.html", "new-project.html", "src/**/*.ts"],
    include: [
      "@codemirror/commands",
      "@codemirror/lang-json",
      "@codemirror/language",
      "@codemirror/state",
      "@codemirror/view",
      "fflate",
    ],
  },
})

