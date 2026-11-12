import { defineConfig } from "vite"

export default defineConfig({
  base: "./",
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

