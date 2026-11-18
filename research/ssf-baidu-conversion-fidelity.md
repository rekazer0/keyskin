# 搜狗与百度格式转换适配验证

2026-10-18，分支 `fix/sogou-baidu-conversion`。

## 本轮修复

1. **百度相对偏移**：`R_POS=x,y` 是按键宽高的百分比，按 Java 整数除法向零截断；`POS` 和键上的 `FORE_OFFSET` 是像素。预览与百度转 SSF 共用同一个读取函数，显式 `FORE_OFFSET` 优先。
2. **搜狗前景框**：SSF 的 `FG_RECT` 相对目标按键。转 BDS/BDI 时直接在目标键大小的透明画布上摆放字形，避免按源图片尺寸缩放造成位置、大小错误。极小前景框也只分配目标键画布。
3. **模板残留偏移**：替换为 SSF 前景后，同时去除百度模板的 `FORE_OFFSET` 和 `POS_TYPE`，避免已经定位好的图片再次被偏移。
4. **透明功能图标**：SSF 明确使用 `transparent.png` 时，BDS、BDI、BDA 都使用该透明前景，避免出现模板的回车、清空等图标。
5. **半透明候选栏**：百度转 SSF 时，RootView 的候选栏条带保持透明，由 CandidateView 单独绘制 `bar.png`。回转时只叠加一次，避免 alpha 从 128 变为 192。
6. **纯色背景**：`RootView BG_STYLE=2` 读取 `BG_COLOR`，忽略未启用的背景图；BDS/BDI 输出颜色样式，BDA 输出已有协议支持的颜色样式，样式编号避开横竖屏已用编号。

新增 `tests/ssf-conversion-fidelity.test.mjs` 的 6 项回归；原有前景框测试改为断言目标键位几何，极小前景框测试仍检查内存分配边界和实际像素。

## 官方实现依据

直接检查本机官方 APK 的 JADX 1.5.6 反编译结果，未使用第三方博客推测语义。

| APK | SHA-256 |
| --- | --- |
| `SogouInput_20.17.0_android_sweb.apk` | `3eb2612040fd7daefb7e92b9de5c1a715b03f272b644e0664948742df1c7a416` |
| `baiduinput_AndroidPhone_1000e.apk` | `cffe202cc2b7fdf0c45c0f8d1d69586e126791d0d9d358c373f0c336a12cb9bd` |

- 百度 `com.baidu.input.ime.params.RelativeOffsetParam.a/b`：`rect.height() * y / 100`、`rect.width() * x / 100`；`KeyParam.D` 先按图片本身尺寸居中，再应用偏移。
- 搜狗 `com.sogou.theme.parse.parseimpl.a.B`：`FG_RECT` 与 `FG_IMAGES` 分别存入按键前景数据。
- 搜狗 `com.sogou.theme.parse.frame.i.t`：`BG_STYLE=2` 使用 `BG_COLOR` 的 ColorDrawable，`BG_STYLE=1` 才解析图片。
- 搜狗 `com.sogou.theme.parse.frame.b0.s`：RootView 单独处理背景模式与图片；CandidateView 使用独立背景数据。
- 搜狗 `com.sogou.theme.parse.parseimpl.c0.w`：正常、按下、禁用、ON/OFF 等状态分别写入状态映射。
- 搜狗 6 参数图片分支也检查了 `com.sogou.theme.utils.e.d` 与 `data.module.f.k`：该 APK 中会走 BitmapDrawable 分支。本轮没有把这类参数强行当作四坐标九宫格。

源码保存在 `/private/tmp/bdi-sogou-src/sources/` 和 `/private/tmp/bdi-baidu-src/sources/`。全 APK 反编译分别有 184 / 238 处错误；以上引用方法已直接检查，未据此声称整个引擎完全还原。

[搜狗官方制作说明](https://open.shouji.sogou.com/instructions/)与[官方编辑器教程](https://shouji.sogou.com/sapp/skindesign/jchtml/bjqjc.html)用于确认候选栏、背景、正常/按下切图及横屏的设计范围。

## 实例与图片

本地证据位于 `artifacts/ssf-conversion-2026-10-18/`，该目录已由仓库忽略，不提交第三方皮肤。

- 搜狗 SSF 样本：比较原生 SSF 与转换的 BDS、BDI、BDA。
- 百度 BDS 样本：比较原始 BDS 与输出 SSF。
- 每种文档覆盖九键、全键、横屏、竖屏：6 种文档 × 4 个布局，共 24 张浅色正常、24 张深色正常、24 张深色按下截图。
- 每次截图确认画布有按键且源文件 `changed` 为空。逐图复查了图标残留、前景位置、两种外观及按下状态；目标格式使用其官方布局，键位几何不要求与源格式完全相同。

[修复前浅色](../artifacts/ssf-conversion-2026-10-18/before/comparison.png) · [修复后浅色](../artifacts/ssf-conversion-2026-10-18/after/comparison.png) · [深色正常](../artifacts/ssf-conversion-2026-10-18/after/comparison-dark.png) · [深色按下](../artifacts/ssf-conversion-2026-10-18/after/comparison-dark-pressed.png)

转换后的 `sogou.bds`、`sogou.bdi`、`sogou.bda`、`baidu.ssf` 也在证据目录的 `after/` 中。

## 验证结果

- 修改前基线：类型检查通过，201/201 单元测试及设计规范检查通过。
- 中间修复轮：206/206；补充实际导出位置与 BDA 颜色覆盖后，207/207 通过。
- 最终代码：类型检查、207/207 单元测试及设计规范检查、生产构建通过。
- 完整 E2E 首轮：14 个脚本全部完成，用户流程 22/22，其中包含 75 个真实百度皮肤的打开、渲染和属性检查。
- 真实搜狗转换：现有测试遍历 `/Users/kaze/work/ssf` 的 8 个实例，各转 BDS、BDI、BDA 并回转 SSF，共 24 条往返路径，无图片缺失或解码失败。
- 真实百度转换：`/Users/kaze/work/bd` 的 75 个 BDS/BDI/BDA 均成功转 SSF、校验生成图片引用、再转 BDS 打开；逐文件结果在 `baidu-real-skins.json`。
- 最终代码的第二轮完整 E2E：14 个脚本全部完成，用户流程 22/22，其中 75 个真实百度皮肤全部通过。日志见 `e2e-final.log`。
- 最后补查无效 `FG_RECT` 的缩放回退，9/9 相关测试通过。

针对回归的快速复跑：

```sh
node --test tests/ssf-conversion-fidelity.test.mjs
npm run typecheck
npm test
npm run test:e2e
npm run build
node artifacts/ssf-conversion-2026-10-18/check-baidu.mjs
```

## 保留的限制

- 这是编辑器预览、结构和像素验证，未在两家输入法真机中安装每个产物。
- 动态效果并无一一对应：75 个百度包中 56 个报告忽略按键动画；搜狗的 anim.ini / WebP 动画仍有明确降级提示。
- 4 个百度包在两种外观中都没有可解析的键盘背景，继续报告缺失并使用目标模板回退。上面的 BDS 样本属于此类，因此其输出 SSF 的回退底色不能当作原背景完全保真的证据。
- 一份真实 BDA 样本仍报告横竖屏同号样式冲突（浅色 202、深色 201）；现有 BDA→BDS 中间转换沿用竖屏样式。该限制未在本轮扩展修复，75/75 表示转换与资源引用通过，不表示每一张皮肤都达到视觉完全相同。
- 没有修改编辑器 CSS，未重置或更新 UI 快照基线；本轮视觉验收使用上述实际转换截图。
