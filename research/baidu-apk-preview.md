# 官方百度 Android APK 预览依据

调查日期：2026-10-18。按用户最终要求，只模拟官方 APK 的普通手机默认设置，不追随厂商定制版本。

样本：`baiduinput_AndroidPhone_1000e.apk`，版本 **13.3.16.2 / 1177**。
SHA-256：`cffe202cc2b7fdf0c45c0f8d1d69586e126791d0d9d358c373f0c336a12cb9bd`。
使用 JADX 1.5.6，关闭方法内联；以下摘录去掉 LiteTracer 和重复的空检查，保留分支、数值和绘制顺序。
本地完整反编译结果在 `/private/tmp/bdi-apk-research/decompiled/sources/`，资源在同目录上一级的 `resources/resources/`。

## A. FontUtils.c：默认是 true，不启用 font.json 替换切图

类：`com.baidu.input.acgfont.FontUtils`。`c` 是未显式初始化的静态 boolean，类加载时先为 false；这不是安装完成后的值。
`DefaultInstaller.l(-1)` 明确调用 `FontUtils.e(...)`，所以全新安装、系统默认字体完成初始化后为 **true**。

全部直接赋值位置如下（同名的 `com.baidu.input.font.util.FontUtils` 是另一个类）：

```java
// FontUtils.b(Context, ICallback)：加载内置下载字体文件
if (typefaceCreateFromFile != null) {
    c = false;
    s("a5179cb86268f52db43fa23166d2451c", ...);
} else {
    c = true;
    s("system", ...);
}
// FontUtils.c(Context, String, String, String, ICallback)：加载用户选中的字体
if (typefaceCreateFromFile != null) {
    c = false;
    s(str2, str3);
} else {
    c = true;
    s("system", ...);
}
// FontUtils.e(Context, ICallback)：系统字体
TypefaceUtils.getInstance().setCusTypeface(Typeface.DEFAULT);
s("system", context.getString(R.string.system_font_name));
c = true;
h("system");
// SVIPMemberValidator.g(boolean)：会员字体失效，恢复系统字体
TypefaceUtils.getInstance().setCusTypeface(Typeface.DEFAULT);
FontUtils.s("system", ...);
FontUtils.c = true;
FontUtils.h("system");
```

`b/c` 的路径为空、文件缺失等提前返回，不给 `c` 赋值，保留原值。`FontUtils.j()` 的字体 token 缺省为 `"system"`；`d()` 遇到系统 token 转调 `e()`。

真正的门控是：

```java
// KeyMap.C1()
return !FontUtils.c;
// KeyMap 初始化 / SkinRenderCallback.C()
SkinRender.p().y = !FontUtils.c; // 强制原始字体模式还会把 y 设为 false
// StyleParam.s(...)：仅 y=true 才尝试字体适配器
if (SkinRender.p().y && SkinRender.l().f()) {
    adapter.b(canvas, paint, styleIndex, rect, highlighted, underline, SkinRender.p().z);
    // 适配成功后直接 return，不绘制切图
}
// 否则继续绘制 ImgParam 的 bitmap / nine-patch
```

因此不能因为皮肤带有 `font.json` 就无条件画其中的文字，更不能给所有文字加上 1.1。

## B. textType 1/2：56% 字号，同一颜色，不单独降低 alpha

类：`com.baidu.input.ime.params.fontadapt.KeyForePatch`。
`d(FontStyle)` 只识别以下标签：`中/英 英/中 半/全 全/半 全/单 单/全 音/英 仓/速 速/仓 词/字 字/词 部/写 写/部`。
匹配后 drawType 2/3/4 分别对应 textType 2/3/4，其余对应 1。未知标签不因含 `/` 就变成分段文字。

`BdsFontAdapter.b(...)` 的共同准备：

```java
paint2.set(paint); // 复制共享 Paint 的字体、抗锯齿、对齐等
float size = fontStyle.getScaleFontSize() * f;
paint2.setTextSize(size);
paint2.setColor(highlighted ? fontStyle.getHighlightColor() : fontStyle.getNormalColor());
Paint.FontMetrics fm = paint2.getFontMetrics();
float baseline = rect.centerY() - (fm.ascent + fm.descent) / 2;
```

textType 1 的完整绘制逻辑，即 `KeyForePatch.b(...)`（参数改成易读名称）：

```java
int split = length >= 2 ? length - 2 : 0;
canvas.drawText(text, 0, split, rect.centerX() - size / 3, baseline, paint);
Rect bounds = new Rect();
paint.getTextBounds(text, 0, split, bounds);
paint.setTextSize(56 * size / 100);
canvas.drawText(text, split, length, bounds.centerX() + rect.centerX(), baseline, paint);
paint.setTextSize(size);
```

textType 2 的完整绘制逻辑，在 `BdsFontAdapter.b(...)` 的 `isIncreasesText()` 分支：

```java
int split = length >= 2 ? length - 2 : 0;
paint.setTextSize(56 * size / 100);
canvas.drawText(text, 0, split, rect.centerX() - 2 * size / 3, baseline, paint);
Rect bounds = new Rect();
paint.getTextBounds(text, 0, split, bounds);
paint.setTextSize(size);
canvas.drawText(text, split, length, bounds.centerX() + rect.centerX(), baseline, paint);
```

两段都沿用同一 `Paint` 颜色和 alpha。textType 1 的 `中/英` 是大「中」+小「/英」；textType 2 是小「中」+大「/英」，不是把斜杠单独归入前一段。
这里没有 0.6，也没有分别选色。**alpha 102、次要字 ×0.93 是 textType 3/4 的带角标绘制 `KeyForePatch.a(...)`，不能挪用到 1/2。**

普通文字分支也是 `BdsFontAdapter.b(...)`：

```java
float dx = (text.length() == 1 && isFormattedChar(text.charAt(0)))
    ? TypefaceUtils.getCharOffset((int) size, text.charAt(0)) : 0;
canvas.drawText(text, rect.centerX() + dx, baseline, paint2);
```

Typeface 来自 `StyleParam.B`。`StyleParam.r()` 新建 Paint，仅设置抗锯齿、位图过滤、居中对齐；`StyleParam.x(Typeface)` 设置字体。
适配开启时 `StyleParam.y(Paint, true)` 使用 `TypefaceUtils.getCusTypeface()`（用户选择的字体），没有 `setFakeBoldText` 或强制粗体。
颜色仅由 normalColor/highlightColor 决定；分段文字不再取第三种颜色。默认系统字体的这条适配路径不执行。

## C. S99：官方样本未找到使其为 true 的来源

`Global` 的静态初始化：`n0 = new boolean[123]`，全部为 false。
`SkinRenderCallback.w(short s)` 除两种输入会话/国际化特例直接返回 false 外，读取 `Global.n0[s]`；没有 S99 或屏幕圆角特例。
`KeyParam.J()` 按 `STAT_STYLE` 的书写顺序，选中第一个成立的状态，然后返回该 TIP；不再读取 TIP 自己的 STAT_STYLE。

检索范围：全部反编译 Java 中 `Global.n0` 的直接访问、局部数组别名、字面量/变量下标写入、`Arrays.fill/copyOf`、`System.arraycopy`、反射字段名，以及输入、皮肤、OEM、渲染目录中的 `99` / `RoundCorner` / `screenCorner`。
发现的变量下标写入：

- `TemporaryImpl.ra(int i)`：`Global.n0[i] = false`，只能关闭状态。
- `ImeService` 的 `zArr[c] = true`：该方法中 `c='p'`，即 112，不是 99。
- `KeyMapCand` 的 `zArr[c]`：该方法的 `c='\b'`（8），不是 99。

未找到给索引 99 置 true 的循环、数组复制、服务端状态列表或反射写入，也未见该数组作为参数交给 native。
另扫描 APK 中 50 个 `.so`，未发现 `com/baidu/input/pub/Global` 或点分形式的类名字符串。
这不等于证明 native/动态加载代码永远不能改状态；JADX 对全 APK 报了 238 处错误，本次未动态运行 APK，也未逐函数逆向 native。
可以确认的是：**没有依据把 S99 当作官方手机默认成立的状态**。预览取消常开 S99，保留手动选择 S99。

## D. 36 / 37 是手写，py_9 不乘 1.2

`InputStatMac.g()` 返回面板字段 `b`（特殊面板可返回 0）。
`InputStatMac.q(boolean)` 的面板到资源索引映射与 `res/values/arrays.xml` 的 `BDSKT` 对照：

| 面板状态 | 资源索引 | 面板 |
|---|---|---|
| 33，d=1 | 10 | py_9，拼音九键 |
| 33，d≠1 | 11 | py_26，拼音全键 |
| 36 | 13 | hw_full，全屏手写 |
| 37 | 12 | hw_grid，半屏手写 |

`SubList.g(...)`：

```java
if (inputStatMac.g == 2 || hardKeyboard) h0 = 5;
else if (panel == 50) h0 = 4;
else if (inputStatMac.f8965a == 16) h0 = 3;
else if (panel == 36 || panel == 37) { h0 = 0; ... }
else h0 = 2;
```

`SubList.f()`（初始化和其他重绘位置也遵循同一条件）：

```java
E = (short) (SkinRender.p().z * styleParam.e);
paint.setTextSize(h0 == 0 ? E * 1.2f : E);
```

因此 py_9 普通符号列 `h0=2`，只应用用户字体比例，**没有手写面板的 ×1.2**。

## E. key_keyboard_font_scale：默认 1.0，只影响文字

- `SkinRenderStatus()`：`z = 1.0f`。
- `SkinRenderCallback.k(...)` / `DiyRenderCallback`：`getFloat("key_keyboard_font_scale", 1.0f)`；平板硬键盘模式固定为 1。
- `FontServiceModule` / `Option` 的重置也写 1.0。
- `FontDataManager.o(KeywordFontData)` 直接保存传入比例，没有通用的固定 min/max 钳制。

UI 字号等级为 **0–6，默认 3**（`FontEffectView`、`FontDialogLayout` 设置 seekbar max=6）。
`font.size.ClassicFontSizeSetting.e(level)`：

```java
int basePx = dependency.z0();
if (basePx <= 0) basePx = 64;
return (int) (basePx / ImeBaseGlobal.o + (level - 3) * 2);
```

`FontInnerServiceImpl.j(level)` / 老 `FontDialogLayout` 保存比例为 `e(level) / e(3)`。
所以可选范围依赖基础字号和屏幕密度，约为 `(baseDp-6)/baseDp` 至 `(baseDp+6)/baseDp`，还包含整数截断；不能写死为 0.8–1.2。
`OriginalFontSizeSetting.e(level)` 忽略等级，比例恒为 1。

作用范围：

- `StyleParam.s(...)` 的 FONT_SIZE/SHOW 文字：`textSize = e * z`。
- `BdsFontAdapter.b(...)`：`textSize = scaleFontSize * z`（scaleFontSize 已含布局比例）。
- `SubList`：`E = (short)(style.e * z)`；仅手写列表再 ×1.2。
- 同一 `StyleParam.s(...)` 的 bitmap/nine-patch 路径不使用 z 缩放图片矩形。**切图前景不跟着字号设置放大。**

1.1 可以是用户等级计算出的比例，不是官方默认值。本次不新增字号模拟开关。

## F. S35 / S67

**S35**：`InputEventHandler`：`n0[35] = ImePref.b0 == 1`。
`ImePref` 静态初始化 b0=0，读取 `pref_key_cjmode` 缺省 0；`InputHandler2.l()` 在 0/1 间切换并更新状态和内核 ConfigKey.v0。
这是仓颉/速成模式，**默认 S35=false**。`cjmode` 的 1 对应速成状态，不能当作手机设备特征常开。

**S67**：fusion 皮肤布局。
`SkinLayoutManagerKt.c()` 读取 `pref_key_skin_layout_token`，缺省值来自 `a()`；`e()` 判断 token 是否 `"fusion"`。

```java
// SkinLayoutManagerKt.a()
return (PadUtils.g() || OemCompat.f()) ? "default" : "fusion";
// SkinLayoutManagerKt.e()
return "fusion".equals(c());
// InputEventHandler / SkinLayoutManagerImpl
Global.n0[67] = SkinLayoutManagerKt.e();
```

`OemCompat.f()` 委托 Product.a()，通用 Product 的实现返回 false。因此普通手机全新安装通常为 **S67=true**；平板、特殊 Product 或用户改过布局则不同。
本预览的默认模型是普通手机，启用 S67；不是宣称所有设备都为 true。

## iPhone 截图与输入串背景分支

用户另提供一份 BDS 样本与 iPhone 官方百度输入法截图。
这个皮肤虽然 Info.txt 写 `SupportPlatform=A`，截图仍显示 iOS 把输入串放在候选栏上方的一整行。
该文件 `[INPUT] BACK_STYLE=7`，STYLE7 的 `NM_COLOR=EF3B3B3B`；前景 STYLE8 的字号 45。

Android `InputBarView.m(...)` 则按文字宽度加左右留白绘制浮窗：6dp 起点、两份 2.5dp inset 尾部留白，超宽时占满可用宽度并显示末尾。
背景 ARGB 非零时优先填色；值为 0 才调用样式图片绘制。边框绘制左、上、右，底边由另一个颜色字段控制。
iPhone 的整行宽度和位置依据截图验证，不从 Android APK 推导。

`fix/input-background-preview` 的现有实现已符合以上区别，本次补充颜色/图片优先级、三边边框，以及短串增长/长串裁切/清空/iPhone 整行的回归测试；不改变已验证正确的背景算法。

## 本轮验证结果

| 分支 | typecheck | 单元测试与设计规范 | 界面快照 |
|---|---|---|---|
| fix/preview-device-parity | 通过 | 195/195 | 最终复核 0 处差异 |
| fix/input-background-preview | 通过 | 193/193 | 最终复核 0 处差异 |

输入背景专项端到端测试同时通过内置小米模板和用户提供的 BDS 样本。
完整 `npm run test:e2e` 两个分支均运行完，真实皮肤遍历均通过 75/75；最后的综合用户流程均为 21/22。
共同失败为 `scripts/test-user-flows.mjs:659`：搜狗皮肤侧栏中 `1080/status1/phoneSkin.ini` 的入口预期 1 个，实际 2 个。
该失败在生产代码完全未改的 input-background 分支单独重跑仍复现，因此记录为已有的 SSF 侧栏问题；本轮没有更改测试断言或顺带修改 SSF 功能。
预览一致性分支第一次执行移动端 320×568 收起检查失败，完整重跑后移动端 27/27 通过。
