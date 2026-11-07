# 键设（KeySkin）开发约定

所有开发者和 AI agent 动手前都必须读完 [DESIGN.md](DESIGN.md)，并严格遵守。

## 必须遵守

- 界面、交互、图标、动效一律按 DESIGN.md 执行：颜色、字号、圆角、时长只用 `src/tokens.css` 里的 token；组件用 `src/components.css` 的 `.ui-*`；图标只从 `src/icons.ts` 取。
- 不写 `!important`，不新开 CSS 文件去覆盖别的文件，不在 HTML 里写内联样式或 `<svg>`。
- 没用的代码直接删掉；不导出没人用的函数；新代码先找现有 helper 复用。
- 单个 TS 文件不超过 800 行。

## 验证

```bash
npm run typecheck   # 修改 TypeScript 时运行
node --test tests/<受影响模块>.test.mjs
node scripts/test-<受影响流程>.mjs  # 修改交互时运行对应专项 E2E
npm run test:ui     # 修改样式时运行，逐条确认变化都是有意的
```

每次修改按功能模块定向验证，只运行覆盖改动的单测和专项 E2E；不要默认运行 `npm test` 或 `npm run test:e2e`，它们会执行全量测试。只有用户明确要求，或改动横跨多个模块且定向测试无法覆盖集成行为时，才运行全量测试。

规范检查失败时，修改代码去符合规范，不要修改测试来放行。
