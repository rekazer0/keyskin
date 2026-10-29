# 键设（KeySkin）开发约定

所有开发者和 AI agent 动手前都必须读完 [DESIGN.md](DESIGN.md)，并严格遵守。

## 必须遵守

- 界面、交互、图标、动效一律按 DESIGN.md 执行：颜色、字号、圆角、时长只用 `src/tokens.css` 里的 token；组件用 `src/components.css` 的 `.ui-*`；图标只从 `src/icons.ts` 取。
- 不写 `!important`，不新开 CSS 文件去覆盖别的文件，不在 HTML 里写内联样式或 `<svg>`。
- 没用的代码直接删掉；不导出没人用的函数；新代码先找现有 helper 复用。
- 单个 TS 文件不超过 800 行。

## 提交前

```bash
npm run typecheck
npm test            # 单元测试 + 设计规范检查（任何违规都失败）
npm run test:e2e    # 端到端（改了交互时必须跑）
npm run test:ui     # 界面快照比对（改了样式时必须跑，逐条确认变化都是有意的）
```

规范检查失败时，修改代码去符合规范，不要修改测试来放行。
