# BDS 面板段语义

本文记录 BDS 面板段（`CAND` / `HINT` / `MORE` / `INPUT` / `LIST`）在 `gen.ini` 与布局文件之间的归属关系。这是格式语义，读侧、写侧、渲染层都依赖它。

## 结论

| 段 | `gen.ini` | 布局文件 | 合并规则 |
|---|---|---|---|
| `[CAND]` | 方向级默认（候选栏的位置、类型、引用名） | 出现该段即覆盖；空段 = 本布局关闭候选栏 | **出现就覆盖，空段也覆盖** |
| `[HINT]` | 方向级默认（`LAYOUT_NAME` / `TYPE`） | 同上 | **出现就覆盖，空段也覆盖** |
| `[MORE]` | 方向级默认（类别 → 布局名、网格、样式） | 同上 | **出现就覆盖，空段也覆盖** |
| `[INPUT]` | 方向级默认（输入栏样式、高度） | 同上 | **出现就覆盖，空段也覆盖** |
| `[LIST]` | 几何默认值（`POS` / `CELL_SIZE` / `PADDING`） | 样式与内容（`BACK_STYLE` / `NAMES` / `VALUES` / `LIST_NUM` / `LIST_ORDER` / `TYPE`） | **必须合并，两层各有各的字段** |

一句话：面板段是「方向级默认 + 布局级覆盖」，布局文件里出现该段（哪怕空段）就由它决定；`[LIST]` 拆在两处，不适用覆盖规则。

## 证据

`public/default-template.bds`：

- `port/gen.ini` 有 `[CAND] LAYOUT_NAME=cand1 VIEW_RECT=0,0,480,60 TYPE=4`。
- `port/py_9.ini` 的 `[CAND]` 是空段，`[KEY1] VIEW_RECT=79,6,106,75`。候选栏若按 `gen.ini` 继承，`0,0,480,60` 与 `79,6,106,75` 在 y 上相交（6~60 与 6~81），候选栏后画会盖住 1/2/3 键。
- `port/py_26.ini` 的 `[CAND]` 也是空段，键从 y=7 开始，同样与候选栏矩形相交。
- `port/symbol.ini` 的 `[CAND]` 不是空段（有自己的 `VIEW_RECT`），它是本布局声明的候选栏。
- `port/bh.ini`、`port/py_9.ini` 的 `[LIST]` 只有样式与内容，几何在 `gen.ini`；两者必须合并才能得到完整的列表。

统计（`public/*.bds` 与 `public/templates/*.bds`）：

- 392 个带 `[LIST] NAMES` 的布局，**0 个**写 `[LIST] VIEW_RECT` 或 `[LIST] SIZE`，几何全部来自 `gen.ini` → 列表这条必须是合并。
- 主输入布局（`py_*` / `def_*` / `en_*` / `bh` / `num_*`）普遍不写 `[PANEL] SIZE`，画布尺寸由 `gen.ini` 的 `[PANEL] SIZE` 声明。

## 对 IR 的影响

- 板级 `panels` 里，`candidates` / `hint` / `more` / `input` 只表示「本布局实际生效的面板」；布局文件空段时这些字段缺省，表示该面板在这块板上不存在。
- `gen.ini` 自己的声明单独保留（写回 `gen.ini` 用）：`genList` / `genHint` / `genMore` 是 IR 的正式字段；`[CAND]` / `[INPUT]` 没有对应的 IR 字段，按原文存在 `opaque` 的 `genPanels` 里（按主题方向分开），写回时逐块还原。
- `[LIST]` 的三层（`appearance` / `layout` / `content`）来自两边合并：`gen.ini` 给几何，布局文件给样式与内容；`content: {}` 表示「层存在但空池」，不是缺省。

## 写回

- 布局文件的空段由 `emptySections` 原样写回，不能因为「没有字段」就丢掉段头。
- `gen.ini` 的 `[CAND]` / `[INPUT]` 不能因为主布局关闭了面板就消失：它们是方向级声明，属于文件事实。
