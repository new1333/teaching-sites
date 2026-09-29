---
title: 第 4 章 纯数据分屏树：不含一个 UI 类型的布局内核
---

# 纯数据分屏树：不含一个 UI 类型的布局内核

分屏大概是终端里最像"界面"的功能，Pebrel 却把它的内核放进了一个不含任何 UI 类型的零依赖 crate。

## 工具箱

- 所有权地图 — 判断改动落点 crate 与禁区的查表入口：docs/architecture.md 的 owns / must-not-become 两栏（[第 1 章](./01-repo-map.md)）。

本章只调用这一块积木，其余从零建立。

## 三个 pane 挤一条边

把三个 pane 挤在同一条边上，捏住中间那根分隔条，一路往边上拖。受挤压的那个 pane 缩到大约一个字符宽就停住，不肯再小一步；继续拖过一条看不见的线，松手，它整个消失，邻居平滑吞下腾出的空间。全程没有 pane 变成 0 宽，也没有哪个 pane 消失之后还留下残影。

这些行为看上去很"UI"——分隔条、指针、松手，直觉上它们就该长在界面框架里。但裁决这一切的代码，住在一个不含任何 UI 类型的 crate 里：切割是纯函数，宽度被钳制在至少一个字符格，pane 是树上的树叶。这三件事就是本章的三块新积木，我们逐个装上。

先查地图。

## 纯数据布局树：长在界面之外的内核

**纯数据布局树**——用纯数据结构加纯函数表达分屏布局、不引用任何 UI 框架类型的模型。Pebrel 把整个分屏内核做成了这样一棵树，住在 nebula_split 里。

它住哪、禁区是什么，所有权地图早就写好了。地图给 nebula_split 的那一行写着：owns 是 split tree、geometry、navigation rules；must-not-become 是 window management 或 rendering。管切割，不管窗口管理，更不碰渲染。工程约束还补了一条硬规矩：split rules 属于"单一权威"的共享行为，不许每个 UI 壳各写一份。

那这个 crate 依赖什么？答案是一行注释加一个空段（本章引用片段依 GPL-3.0 授权使用，署名与许可集中声明于 about 页）：

```toml
# Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_split/Cargo.toml
# 刻意零依赖：任何壳与任何渲染后端都能免费引用（与 nebula-settings 同则）。
[dependencies]
```

`[dependencies]` 段零条目；src 下仅有的两个 .rs 文件里，没有一处 gpui 或其他 UI 框架字样；全部 use 语句只有 std::mem 与 super::*。crate 依赖方向的合同（[第 1 章](./01-repo-map.md)）说 domain crate 不许依赖 UI 与平台能力——nebula_split 是把这份合同执行到极致的展品；SHA 钉版（[第 1 章](./01-repo-map.md)）解决的问题在这里干脆不存在：一个依赖都没有，没什么可钉。

crate 的开场白把出身交代得很清楚：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_split/src/lib.rs
//! Nebula 分屏规则的共享权威实现：布局树、几何切割、分隔条拖拽与方向聚焦。
//!
//! 从旧壳 `nebula_app/src/window_context/split.rs` 逐字对照移植成纯数据 +
//! 纯函数——切割数学（floor/钳制次序）、拖拽比例曲线（关闭边距/预览钉边/
//! 提交量化）与最近邻导航（垂直漂移 4 倍惩罚）以旧壳行为为权威，任何 UI
//! 框架类型都不出现在这里。
//!
//! 同步事实（记录在案）：旧壳 `split.rs` 是体内既有实现，按 P4 裁定冻结
//! 保留；新 UI 一律读本 crate。改规则时两处同步，直到 P3 接入完成。
```

三处值得停下。其一，命名双轨照旧（[第 1 章](./01-repo-map.md)）：crate 叫 nebula-split、注释自称 Nebula、产品叫 Pebrel——引用代码用现名，讲产品用新名。其二，这套规则是从旧壳 window_context/split.rs 逐字对照搬出来的；旧壳所在的 window_context.rs 在体积预算表上记着 3735 行、只减不增（ratchet 预算，[第 1 章](./01-repo-map.md)），把共享规则搬出巨石文件而不是继续往里堆，正合预算的方向。其三，"旧壳冻结、新 UI 一律读本 crate"是锁定 commit 上记录在案的裁定，主分支此后的演进不自动生效。

树的形状本身：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_split/src/lib.rs
/// 分屏布局树：叶子是 pane（泛型 id），内部节点是带比例的二分。
#[derive(Debug, Clone, PartialEq)]
pub enum SplitTree<T> {
    Leaf(T),
    Split {
        direction: SplitDirection,
        /// 第一个孩子的占比（提交值）。
        ratio: f32,
        /// 拖拽中的预览比例；PTY 尺寸跟随提交值直到松手。
        preview_ratio: Option<f32>,
        dragging: bool,
        first: Box<SplitTree<T>>,
        second: Box<SplitTree<T>>,
    },
}
```

叶子 Leaf(T) 只装一个泛型 id——树不关心这个 id 背后是哪种视图对象，任何可复制、可比较的类型都行。内部节点记方向和比例，其中 ratio 是提交值，preview_ratio 是拖拽中的预览值，两个字段的分工后面细讲。铺陈函数 layout() 吃一棵树加一个 viewport 矩形，吐出 SplitLayout：每个叶子的矩形，加上每条分隔条的身份，仅此而已。同一棵树加同一 viewport，永远得到同一份输出；没有隐藏状态，没有副作用。

这棵树的边界同样值得读。它对终端内部一无所知：TermMode 位域里此刻置着哪些模式（[第 2 章](./02-vt-grid.md)）、damage 追踪圈了哪些行要重画（[第 2 章](./02-vt-grid.md)），都不在它的世界里。nebula_terminal 里那把按到达序授锁的 FairMutex（[第 3 章](./03-pty-event-loop.md)）在这里也没有对应物——纯函数不持有共享状态，自然不需要锁。它只认矩形、比例和 id，换来的是可独立测试：crate 里 16 个单元测试不需要窗口、不需要 GPU，headless 全绿。

## 切割次序合同：先取整、再钳制、余数归第二段

**切割次序合同**——可用长度先扣掉分隔条，第一段按比例 floor 取整，再双向钳到"至少一个单元格"宽，第二段拿走全部余数。次序写死在表达式里，不是建议。

为什么以"格"为单位？pane 里住着一张由 VT 转义序列一行行改写的网格与单元格（[第 2 章](./02-vt-grid.md)）——宽度切成 7.3 格没有意义，切割必须落在整格上；受压的一侧也至少要留一格，否则连一个字符都放不下。合同原文写在 layout 的 doc 注释里，执行在 collect_rects 的 LeftRight 分支——与注释隔着一个函数，下面第二个块是节选：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_split/src/lib.rs（已统一去缩进）
/// 切割数学与旧壳逐字一致：可用长度 = 总长 - 分隔条，第一段先 floor
/// 再双向钳制到"至少一个单元格"，第二段吃掉余数。
```

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_split/src/lib.rs（已统一去缩进）
let usable = (vp.w - divider).max(cell_w);
let first_w =
    (usable * r).floor().max(cell_w).min((usable - cell_w).max(cell_w));
let second_w = (usable - first_w).max(cell_w);
```

用仓库自己的测试数字走一遍。viewport 宽 803、分隔条厚 3：usable = 800。比例 0.5 时，first = floor(800 × 0.5) = 400，second = 800 − 400 = 400；分隔条落在 500..503、右侧 pane 从 503 起宽 400（测试矩形自 x=100 起，绝对坐标才是 500..503；相对 usable 的偏移是 400..403）。lib.rs 的测试 layout_splits_left_right_with_floor_and_divider 断言的就是这组数。极端情形换 viewport 宽 103、格宽 10，usable = 100。比例 0.001 时 floor(0.1) = 0，钳制把 0 顶到 10，second 吃下 90。测试 layout_clamps_each_side_to_a_cell 断言受压侧恰为 10.0。

"先取整还是先钳制，无所谓吧。"这个直觉在多数输入下确实无害，整数世界里两种次序常常给同一个答案，它有合理的来路。恰好骗人的是边界：漏掉钳制一步，比例 0.001 会切出 0 宽的第一段，pane 直接消失。两段各自独立取整（而不是余数归第二段），usable = 100、比例 0.545 会得到 55 加 46，和变成 101——多出的 1 像素让两侧重叠，分隔条失去落点。合同把三条性质分给三步看守：钳制守"两侧各至少一格"，余数结构守"两侧之和恒等于 usable"，floor 守"第一段不超额"。破坏其中一步，恰好死对应的那条，其余还活着——验证槽里会亲手拆一次。

TopBottom 分支是同一份表达式的 cell_h 版本，逐字平行；竖切横切共用一套数学。

接着看四个常量。先读原文，再辨析两个最容易混的：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_split/src/lib.rs
/// 可见分隔条厚度（逻辑像素；使用处乘以 scale 后取整，至少 1 物理像素）。
pub const DIVIDER_GAP: f32 = 2.0;
/// 分隔条命中扩边（逻辑像素）：视觉线很细，抓取目标刻意加宽。
pub const HIT_SLOP: f32 = 8.0;
/// 松手时原始比例越过该边距即关闭被挤压的一侧
/// （`< margin` 关第一个孩子，`> 1 - margin` 关第二个）。
pub const CLOSE_MARGIN: f32 = 0.06;
/// 提交时比例的硬钳制带：任何一侧都不小于总宽的 10%。
pub const RATIO_CLAMP: (f32, f32) = (0.10, 0.90);
```

CLOSE_MARGIN = 0.06 是关闭手势的阈值：松手时原始比例越过这条边距，才关掉受挤压的一侧——小于它关第一个孩子，大于 1 − 0.06 关第二个。RATIO_CLAMP = (0.10, 0.90) 是提交时的硬钳带：落库的比例任何一侧不小于总宽的 10%。一个管"关不关"，一个管"提交值落在哪"，作用面不同，doc 注释各写各的，读代码时别把 0.06 当成钳制带的一部分。另外两个是几何量：DIVIDER_GAP 与 HIT_SLOP 的单位是逻辑像素，管分隔条多厚、多好抓，与比例世界互不相干。

两个比例常量分别被两个小函数消费。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_split/src/lib.rs
/// 原始拖拽比例 → 预览比例：常规带内跟手；关闭区钉死在边缘，让 pane 可见地
/// 塌下去，示意"松手即关"。
pub fn preview_ratio(raw: f32) -> f32 {
    if raw < CLOSE_MARGIN {
        0.02
    } else if raw > 1.0 - CLOSE_MARGIN {
        0.98
    } else {
        raw.clamp(RATIO_CLAMP.0, RATIO_CLAMP.1)
    }
}
```

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_split/src/lib.rs
/// 提交比例：吸附到整数个单元格（pane 尺寸与字符网格对齐）再硬钳制。
pub fn commit_ratio(preview: f32, extent: f32, divider: f32, cell: f32) -> f32 {
    let cell = cell.max(1.0);
    let usable = (extent - divider).max(cell);
    (((preview * usable) / cell).round() * cell / usable).clamp(RATIO_CLAMP.0, RATIO_CLAMP.1)
}
```

preview_ratio 只在拖拽中用：关闭区把预览钉死在 0.02 / 0.98，让受压的 pane 可见地塌下去，示意"松手即关"；常规带内才动用 RATIO_CLAMP。曲线抽查：0.03 → 0.02，0.07 → 0.10，0.5 → 0.5，0.93 → 0.90。松手那一刻的裁决在 drag_close_target。raw < 0.06 返回 Some(false)，raw > 0.94 返回 Some(true)，带内返回 None。边界是严格不等式，恰好压在 0.06 上不算越过。commit_ratio 是最终落库的那条路：先把预览吸附到整数个单元格，再过一遍硬钳带——0.437 在 usable = 800、格宽 10 下吸附成 0.4375；0.02 与 0.98 会被压回 0.10 与 0.90。

为什么树里要同时存 ratio 和 preview_ratio？preview_ratio 字段的 doc 只有一句关键话："PTY 尺寸跟随提交值直到松手"。pane 里那个 PTY 伪终端（[第 3 章](./03-pty-event-loop.md)）一旦收到 resize，shell 就按新列数重排输出；Windows 上 ConPTY 还会重放一屏内容，靠事件循环里的对账静默期吸收（ConPTY 对账，[第 3 章](./03-pty-event-loop.md)）。拖拽的每个中间尺寸都通知 PTY 的话，一次拖手就是几十场 resize 风暴。所以预览只移动分隔条，提交才改树，终端内容在整个拖拽期间保持稳定。松手后最终尺寸怎么写回 PTY，属于壳侧接线的话题（[第 5 章](./05-gpui-shell.md)）。

## 树叶集合不变式：关闭是摘叶，不是隐藏

**树叶集合不变式**——视图认得的 pane id 集合，必须恰好等于树的 leaves() 集合。它是树与视图对接的验收口径：等式的任何一侧被破坏，另一侧立刻出症状。

"关闭一个 pane，不就是把它藏起来吗。"在只有一套界面的程序里，隐藏确实便宜又可逆，这个直觉有它的来路。分屏树上不行：铺陈函数对每个 Leaf 都会分配矩形，藏起来的叶子照样切走宽度、照样被方向导航命中。Pebrel 的关闭是一次结构性手术，先看手术刀的三种下场：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_split/src/lib.rs
/// 从树上摘除叶子的结果。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RemoveOutcome<T> {
    /// 目标不在这棵树上。
    NotFound,
    /// 目标是唯一叶子；调用方应关闭整个 tab。
    WasRoot,
    /// 已摘除且父节点塌缩；焦点应移交给幸存子树的首叶。
    Collapsed(T),
}
```

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_split/src/lib.rs（已统一去缩进）
/// 摘除 `target` 叶子并塌缩其父节点，兄弟子树接管腾出的空间。
pub fn remove_leaf(&mut self, target: T) -> RemoveOutcome<T> {
    if let SplitTree::Leaf(id) = self {
        return if *id == target { RemoveOutcome::WasRoot } else { RemoveOutcome::NotFound };
    }

    if let SplitTree::Split { first, second, .. } = self {
        // 直接孩子命中 → 塌缩为兄弟。占位叶子随 *self 覆盖一起丢弃。
        if matches!(first.as_ref(), SplitTree::Leaf(id) if *id == target) {
            let survivor = mem::replace(second.as_mut(), SplitTree::Leaf(target));
            let focus = survivor.first_leaf();
            *self = survivor;
            return RemoveOutcome::Collapsed(focus);
        }
        if matches!(second.as_ref(), SplitTree::Leaf(id) if *id == target) {
            let survivor = mem::replace(first.as_mut(), SplitTree::Leaf(target));
            let focus = survivor.first_leaf();
            *self = survivor;
            return RemoveOutcome::Collapsed(focus);
        }
        return match first.remove_leaf(target) {
            RemoveOutcome::NotFound => second.remove_leaf(target),
            other => other,
        };
    }

    RemoveOutcome::NotFound
}
```

三种结局各有调用方。NotFound 交还"目标不在这棵树上"；WasRoot 说明摘的是唯一叶子，树没了，调用方该关掉整个 tab；Collapsed 携带幸存子树的首叶，焦点移交给它。塌缩用 mem::replace 原地换出幸存者，占位叶子随覆盖一起丢弃——树上不留空壳节点。

在 [1 | [2 / 3]] 这棵树上摘 2。2 不是根的直接孩子，递归落进 second 那棵 [2 / 3] 子树。它的 first 恰是 Leaf(2)，子树塌缩成 Leaf(3)，结果 Collapsed(3)，此后 leaves() 是 [1, 3]。这一段有测试原句为证：

<details><summary>lib.rs 的摘叶往返测试（逐字）</summary>

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_split/src/lib.rs（已统一去缩进）
#[test]
fn split_and_remove_roundtrip() {
    let mut tree = SplitTree::leaf(1u32);
    assert!(tree.split_leaf(1, 2, SplitDirection::LeftRight, 0.5));
    assert!(tree.split_leaf(2, 3, SplitDirection::TopBottom, 0.5));
    assert_eq!(tree.leaves(), vec![1, 2, 3]);
    assert_eq!(tree.first_leaf(), 1);

    // 摘掉 2：其父塌缩，焦点给幸存子树首叶 3。
    assert_eq!(tree.remove_leaf(2), RemoveOutcome::Collapsed(3));
    assert_eq!(tree.leaves(), vec![1, 3]);
    // 不存在的叶子。
    assert_eq!(tree.remove_leaf(99), RemoveOutcome::NotFound);
    // 摘到只剩一个 → WasRoot。
    assert_eq!(tree.remove_leaf(1), RemoveOutcome::Collapsed(3));
    assert_eq!(tree.remove_leaf(3), RemoveOutcome::WasRoot);
}
```

</details>

现在回答本章开头埋下的问题：为什么"只是隐藏"会出幽灵 pane？假如关闭只是把视图藏掉、树上留着 id，leaves() 依旧是 [1, 2, 3]。那个"消失"的 pane 还在按比例吃宽度、还会出现在下一次铺陈输出里、还会被导航命中——视图上看不见，账本上无处不在。不变式把这类 bug 变成可机械对账的等式：一边数视图手里的 pane id，一边数 leaves()，不相等即有鬼。探针 D 组两行 ok——remove_leaf(2) 后 leaves() 恰为 vec![1, 3]、不存在的 id 返回 NotFound——就是这个等式的源码侧证据。

失败路径也在守同一条不变式。dock.rs 处理"把一棵现成的树拖到某个 pane 旁边"这件事。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_split/src/dock.rs（已统一去缩进）
/// Return the source unchanged if the destination disappeared during the gesture.
pub fn dock_at_leaf(&mut self, target: T, source: Self, side: SplitNav) -> Result<(), Self> {
    match self {
        Self::Leaf(id) if *id == target => {
            let previous = std::mem::replace(self, Self::Leaf(target));
            *self = previous.joined(source, side);
            Ok(())
        },
        Self::Split { first, second, .. } => match first.dock_at_leaf(target, source, side) {
            Ok(()) => Ok(()),
            Err(source) => second.dock_at_leaf(target, source, side),
        },
        _ => Err(source),
    }
}
```

手势进行到一半，目标 pane 被另一个动作关掉时，dock_at_leaf 返回 Err(source)，把来源树原样归还，目标树一个字节未动；dock.rs 自己的测试断言失败前后 leaves() 相等。没有半完成的嫁接，就没有悬在树外的碎片。

## 演练：探针把合同钉在源码上

"零依赖""次序写死"这类断言，肉眼扫一遍源码不算数，探针才算数。本章探针 companion/scripts/probe-04-split-tree.mjs 对锁定 clone 做了 25 条断言，分五组。

| 组 | 断言什么 | 对应源码位置 |
| --- | --- | --- |
| A 依赖面 | [dependencies] 零条目；两个 .rs 文件无 gpui / UI 框架字样；use 仅 std::mem 与 super::* | Cargo.toml、src/*.rs |
| B 常量 | 0.06 与 (0.10, 0.90) 逐字匹配且 doc 注释原文在场；DIVIDER_GAP / HIT_SLOP 像素量纲 | lib.rs 常量区 |
| C 次序 | 切割三行表达式与合同注释逐字；commit_ratio 同一合同 | lib.rs collect_rects、commit_ratio |
| D 树叶 | leaves / remove_leaf / RemoveOutcome 在场；等价断言逐字；dock 失败不动树 | lib.rs、dock.rs |
| E 重演 | 自建输入按源码公式重算：1001 个比例点，两侧恒不小于一格、和恒等于 usable；曲线抽查 | 源码公式，不执行仓库代码 |

E 组的立场值得注意：探针不编译、不运行 Pebrel 的任何代码，只是把源码里的公式抄成 JavaScript 再喂自建数字——断言的是数学性质，不是执行结果。A 组那条零依赖探针，就是本章反驳"布局逻辑天然长在 UI 框架里"的证据：不是口头保证，是任何人可复跑的 grep。

## 验证：先猜，再跑，再拆一次

第一步，先猜。落笔写下四个离散答案，不许写"大概"：

1. CLOSE_MARGIN 与 RATIO_CLAMP 的值各是多少？
2. usable = 100、格宽 10、比例 0.001：受压一侧多宽？
3. preview_ratio(0.07) 与 commit_ratio(0.437, 803, 3, 10) 各返回多少？
4. 在 [1 | [2 / 3]] 上 remove_leaf(2)：返回什么？此后 leaves() 是什么？

第二步，跑。在 companion 目录执行 node scripts/probe-04-split-tree.mjs。对照点：summary 行打出 CLOSE_MARGIN=0.06、RATIO_CLAMP=(0.1, 0.9)；"极端比例重演"行打出受压侧宽 10；曲线抽查行打出 0.10 与 0.4375；结尾 PASS 25/25。第 4 问的正面证据在演练槽引用的往返测试里：Collapsed(3) 与 [1, 3]。

第三步，拆一次。把切割第一段的钳制拿掉，看哪条保证先死：

```js
// 用法示例：把切割合同里的钳制拆掉，看哪条保证先死
const firstCut = (usable, r) => Math.floor(usable * r); // 原式还有 .max(cell).min(usable-cell)
const secondCut = (usable, first, cell) => Math.max(usable - first, cell);
const first = firstCut(100, 0.001);          // 先猜：____
const second = secondCut(100, first, 10);    // 先猜：____
console.log(first, second);
```

先预言再运行：first 与 second 各是多少？跑出来的答案是 0 和 100。0 宽的 pane 出现了——"两侧各至少一格"这条死了；但 0 + 100 = 100，"和恒等于 usable"这条还活着。两步看守两条性质，破坏精准落在钳制那一步，余数结构对此无感。把 .max(cell) 加回 firstCut 的表达式重算，回到 10 和 90；再跑一遍探针，恢复 25/25。确认复原后，scratch 文件可以随手删掉。

这一轮亲手验证了本章的核心断言：切割次序合同的每一步各自看守一条可判定的性质，探针把这些性质钉在锁定源码上，任何人任何时刻都能复跑。

## 收束

回到开篇那条受挤压的 pane。它不会变成 0 宽，因为切割次序合同在 floor 之后把第一段钳在至少一格，第二段吃余数，两侧之和恒等于可用长度。它消失后不留残影，因为关闭是对树的摘叶手术——remove_leaf 塌缩父节点、移交焦点，树叶集合不变式保证视图手里的 pane id 与树叶账账相符，幽灵无处藏身。而这一切能住进一个零依赖的 crate，因为布局本来就长成一棵纯数据布局树：不含一个 UI 类型，任何壳、任何渲染后端、任何测试进程都能免费引用。

本章新增三块积木：

- 纯数据布局树 — 不含 UI 类型、可独立测试的布局模型；读任何布局问题的第一落点
- 切割次序合同 — 先 floor、再钳到至少一格、余数归第二段；分屏比例异常时先核对的规则
- 树叶集合不变式 — pane id 集合等于 leaves() 集合；把布局树接回视图时的对账判据

这棵树如何被壳调用、pane 从生到死走哪条时间线，是下一站的地图（[第 5 章](./05-gpui-shell.md)）。

### 自查

1. usable = 250、格宽 12、比例 0.03：两侧各多宽？写出中间值。
2. 拖到 raw = 0.06 恰好压线松手：会触发关闭吗？preview_ratio 此时给多少？
3. 在 [1 | [2 / 3]] 上摘 1 而不是 2：返回什么？leaves() 变成什么？
4. 关闭区为什么把预览钉在 0.02 / 0.98，而不是干脆钉到 0 和 1？

<details><summary>参考答案</summary>

1. floor(250 × 0.03) = floor(7.5) = 7，钳到 12；second = 250 − 12 = 238。两侧 12 / 238。（回查"切割次序合同"一节的两次演算。）
2. 不会。边界判断用严格不等号：raw < 0.06 为假，落在带内，drag_close_target 返回 None；preview_ratio 走常规带，0.06 被钳到 0.10。（回查常量辨析段与 preview_ratio 引用块。）
3. 1 是根的直接孩子：first 命中，幸存者是 [2 / 3] 子树，返回 Collapsed(2)——焦点是幸存子树首叶 2；leaves() 变成 [2, 3]。（回查 remove_leaf 引用块的第一条分支。）
4. 钉边是给"松手即关"留视觉预告：pane 可见地塌下去但仍在。真钉到 0，切割合同会把 0 顶回一格；而且"已经看不见"和"松手才关"两种状态无法区分，示意就失效了。（回查 preview_ratio 的 doc 注释。）

</details>
