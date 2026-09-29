---
title: 第 13 章 原生 TeX 管线：后端无关的公式排版
---

# 原生 TeX 管线：后端无关的公式排版

本书最后三个机制章共用一条压缩方针：机制讲成故事，接缝点到即止，但每章都守住两样东西——一个能带走的方法，和一道自己跑得绿的探针。本章教的方法是读码用的：遇到「渲染公式」这一类子系统，先把『算几何』与『上屏』两段拆开，再核对每一段被允许做什么决定。

## 工具箱

- **所有权地图**——判断一段代码归谁、禁区是什么的权威查表入口（第 1 章）。本章进门先查它：公式代码住在哪一行合同之下，看一眼就知道。

## 同一行公式，两种大小

把同一行求根公式 `x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}` 贴到两个地方：浏览器里的聊天页面一份，Pebrel 的终端里一份。网页那份由 KaTeX 渲出；Pebrel 那份也渲出来了——没有弹出浏览器组件，没有 WebView，连远端 pane 里也一样。两份并排摆好，差异肉眼可见：Pebrel 的上下标明显比网页版的大，公式整体和旁边的等宽正文比例更协调。

第一反应多半是「这是个没修完的 bug，等版本更新就一致了」。这个判断把「不一样」当成了「不对」。差异背后是一台刻意的排版机器：一处叫光学缩放——让公式在等宽字体旁边不显小的字号补偿；另一处是抬高了上下标下限的常量取舍。要确认它们是决定而不是缺陷，得跟着一行 TeX 源码走完从解析到像素的整条管线，并逐个核对管线上的常量为什么是那个数。顺手把本章要证伪的三个直觉摆上台面：公式渲染必须依赖 WebView 或平台 UI 吗？字号不够时的降级是显示层临时拍板吗？与 KaTeX 的差异是没修完的 bug 吗？

## 管线不认识窗口

先替「必须依赖 WebView」说句公道话：多数桌面应用渲染富文本确实靠内嵌浏览器，KaTeX 又是现成的网页公式引擎，嵌进去一天就能跑——这条路走得通，所以直觉有来路。它的边界在成本：每条公式要跨进程送进浏览器引擎，终端滚动时公式跟不上网格刷新，公式与终端各持一套渲染栈。终端要的是公式跟网格一起动，于是 Pebrel 把公式排版做成了自己的一条流水线——**排版编译管线**——把 TeX 源码编译成不依赖任何渲染后端的绘制指令，再交给呈现面变成像素。这条管线的身份声明写在模块头一行：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/math/mod.rs
//! 原生 TeX 数学解析、排版与后端无关绘制指令。
//!
//! 该模块不依赖窗口、OpenGL 或主题类型，保证同一份布局可被不同渲染后端复用。
```

（引用依 GPL-3.0 授权，署名与许可集中声明于 about 页，本章首处引用提示一次，后不重复。）

这句话有机械面可查。`nebula_app/src/math` 下 mod.rs 声明的模块恰好十个。五个阶段各占一份（parser、validate、layout、compile、rasterizer），另五份是支撑（ir、font、spacing、cache、bitmap）。对这十份文件扫描 `gpui::`、`use gpui`、`winit`、`glow` 四种模式，零命中。「公式渲染必须依赖 WebView 或平台 UI」就这样被证伪：依赖面是 grep 得出的事实，不是态度——不是「没找到 UI 依赖」，是这条管线上根本没有 UI 依赖可找。

所有权地图在这里被真实调用。architecture.md 的所有权表给 math 写了一行合同。owns 栏是「Parse, validate, layout, compile and cache responsibilities」——五个阶段（解析、校验、布局、编译、缓存）归它管；must-not-become 栏是「A duplicated per-shell math engine」，翻译过来：不许变成每个壳一套的重复数学引擎。这行合同的代码形态，在「一条底线，两条管线」一节会看到。

五个阶段各自长什么样？按源码顺序走。

解析（parse，parser.rs）。入口 `parse_formula` 收三个参数：源码、是否独立成行、预算上限。值得看两眼的是次序——校验发生在解析之前。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/math/parser.rs
pub(crate) fn parse_formula(
    source: &str,
    display: bool,
    limits: MathLimits,
) -> Result<ParsedFormula, MathError> {
    let source = normalize_formula_source(source, limits)?;
    validate(source.as_ref(), limits)?;

    let style = if display { MathStyle::Display } else { MathStyle::Text };
    let arrows = normalize_ascii_math_arrows(source.as_ref());
    let normalized_source = substitute_unsupported_presentation(arrows.as_ref());
    parse_normalized_formula(normalized_source.as_ref(), display, style, limits)
}
```

解析器把 pulldown-latex 的事件流落进 ir.rs 的有界 arena。ir.rs 的头注释自述「有界、连续存储的数学中间表示」；NodeId 与 ParsedFormula 是解析与布局之间的接力棒。

校验（validate，validate.rs）。一份约七十项的禁令表，全是能定义控制序列、读写文件或改命令表的命令。头注释一句话立了安全边界：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/math/validate.rs
//! TeX 输入的线性预算扫描器；任何宏展开都必须晚于这一层。

use super::{MathError, MathErrorKind, MathLimits};

/// 这些命令会定义/展开动态控制序列、读写外部资源或改变 TeX 命令表。
/// 符号和排版命令不在此重复维护白名单，由固定版本 pulldown-latex 继续判定。
const FORBIDDEN_COMMANDS: &[&str] = &[
    "DeclareMathOperator",
    "RequirePackage",
    "catcode",
    "chardef",
    "closein",
```

「任何宏展开都必须晚于这一层」意味着 `\input{private.tex}` 这类命令在任何展开逻辑看见它之前就出局了——compile.rs 的测试里有一条专门断言它必须报错。校验是线性扫描，预算内完成，不做展开。

布局（layout，layout.rs）。`layout_formula` 吃解析产物加三个数值参数，吐出四组后端无关的绘制指令：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/math/layout.rs
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct MathLayout {
    pub(crate) metrics: MathMetrics,
    pub(crate) glyphs: Vec<MathGlyphOp>,
    pub(crate) rules: Vec<MathRuleOp>,
    pub(crate) text: Vec<MathTextOp>,
}
```

四组指令说人话：metrics 是整条公式的几何（宽、高、深、轴线）；glyphs 是字形编号加落点；rules 是分数线这类矩形；text 是数学字体里没有的字符，交给应用现成的跨平台文本缓存去画。「后端无关」就在这四组类型上兑现——没有窗口、没有主题、没有 GPU。

编译（compile，compile.rs）。全管线唯一的串联点，也是光学补偿唯一的乘入点：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/math/compile.rs
/// Compile normalized TeX source into backend-independent drawing operations.
pub(crate) fn compile_formula(
    source: &str,
    display: bool,
    pixel_size: f32,
    pixels_per_point: f32,
    limits: MathLimits,
) -> Result<MathLayout, MathError> {
    let formula = parse_formula(source, display, limits)?;
    // 光学补偿在这一个入口做：调用方传名义字号（终端/正文字号），缓存键也用
    // 名义字号，返回的 metrics 已是补偿后的真实几何，fit 逻辑自然吸收。
    layout_formula(&formula, pixel_size * super::OPTICAL_SCALE, pixels_per_point, limits)
}
```

两个要点先记下，后文都要回来：补偿只发生在这一个入口；这个入口归全部呈现面共用。共用被写成了明文合同。compile.rs 的头注释原文是：终端与文档可以各自决定公式「出现在哪」；但 neither is allowed to normalize, parse or lay them out independently。翻译过来：谁都不许自己归一化、解析或排版——防止针对特定来源的修复（矩阵、cases）在两个呈现面各自分叉。

栅格化（rasterize，rasterizer.rs 与 bitmap.rs）。rasterizer.rs 的头注释自述「固定数学字体 glyph ID 的紧边界 CPU 栅格化」——CPU 上逐个字形烘位图；bitmap.rs 再把整条公式合成一张图，受双重上界约束：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/math/bitmap.rs
//! Bounded CPU composition shared by all formula presentation surfaces.
use super::layout::MathLayout;
use super::rasterizer::MathGlyphRasterizer;

const MAX_IMAGE_EDGE_PX: u32 = 8192;
const MAX_IMAGE_BYTES: usize = 24 * 1024 * 1024;
```

单边 8192 像素、整张 24MiB；合成入口先按公式几何算出字节数再分配，超界直接放弃，呈现面回退源码文本。内存上界长在合成入口上，不靠调用方自觉。

编译不便宜，所以有缓存。cache.rs 的头注释一句话：「固定字节预算的公式布局 LRU」：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/math/cache.rs
pub(crate) const LAYOUT_CACHE_BUDGET: usize = 4 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub(crate) struct FormulaCacheKey {
    /// 文档生命周期内稳定的公式编号；缓存随 DocView 一起销毁，因而无需复制公式源码。
    pub(crate) formula_id: u64,
    pub(crate) pixel_size_bits: u32,
    pub(crate) pixels_per_point_bits: u32,
    pub(crate) display: bool,
}
```

预算 4MiB，记账连容器与哈希桶的固定开销都算进去，装不下就淘汰最久未用的条目；键是名义字号的位模式。「名义」两个字下一节展开。

到这里可以给出本章最精确的一句表述：布局后端无关，但位图合成对接壳的图像格式。bitmap.rs 的合成注释写明产出：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/math/bitmap.rs
/// 把整条公式（字形 + 分数线等矩形）按物理像素合成为一张直通 alpha 的
/// BGRA 位图。字形位图原点吸附整数物理像素（旧壳同款），advance 保持
/// 全精度。
```

代码里那行注脚写着「gpui 图像管线吃直通 alpha 的 BGRA（与 DirectWrite 字形同一约定）」。math 模块自己不碰窗口；它在最后一步把像素按壳的图像管线吃的字节布局排好，壳把这块内存当图片贴上去。「依赖」压缩成一条数据格式约定，而不是一个框架 import——这就是「窗口/OpenGL 无关」成立的确切机制。

## 光学缩放：1.21 是补偿，0.8 是取舍

开篇第一处差异的成因是一组数字。Latin Modern Math 是数学排版的经典字体，但它天生显小。常量的注释把这笔账算了出来：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/math/mod.rs
/// Latin Modern Math 在等宽字体旁边天生显小：它的 x-height 是 0.431 em，
/// 而主流编程字体在 0.53–0.56 em。同样的名义字号下，公式里的 `x` 比正文的
/// `x` 矮一圈。KaTeX 对同族字体给出的补偿是 1.21 em，这里沿用同一数值，
/// 在 [`compile_formula`] 单点生效，两条渲染管线（终端覆盖层 / markdown
/// 阅读器）自动一致。
pub(crate) const OPTICAL_SCALE: f32 = 1.21;
```

x-height 0.431 em 对等宽正文的 0.53–0.56 em：同样的名义字号，公式里的 x 比正文的 x 矮一圈。补偿系数 1.21 不是发明的——KaTeX 对同族字体给出的补偿就是 1.21 em，Pebrel 沿用同一数值。所以这一处「和网页不一样」恰恰不是分歧：两边做的是同一个决定，视觉差异来自两侧正文字体不同（等宽对网页字体），不是系数不同。

演算一遍，名义字号 20px：补偿前 x-height 是 0.431 × 20 = 8.62 像素；补偿后是 0.431 × 20 × 1.21 ≈ 10.43 像素。乘法发生在哪？全模块恰好两处 `pixel_size * super::OPTICAL_SCALE`，都在 compile.rs 的两个入口函数体内，其余文件零引用。补偿后的几何直接写进 metrics 返回；缓存键仍持名义字号——键空间里没有补偿这个概念，调用方从头到尾只说名义字号。

第二处差异（上下标更大）是真正的偏离，理由也写在注释里：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/math/mod.rs
/// 上下标 / 分子分母的最小相对字号。Latin Modern 的 MATH 表给 70%，是为
/// 纸面阅读字号调的；终端正文本来就小，0.7 em 的分子在 20px 字号下只有
/// 14px，用户看到的就是"公式比正文小一圈"。这里抬到 0.8，代价是公式变高
/// 约一成——仍在一行加行距的预算内（见 `terminal_math` 的溢出容差），所以
/// 同类公式的字号不会因此分裂。
///
/// 这是刻意偏离 LaTeX/KaTeX 的一处：那两者排的是版面充裕的文档，我们排的
/// 是终端里 AI 输出的一行文字。上限卡在 0.8：再往上（实测 0.85）根号里的
/// 上标会把 `\sqrt` 顶过字形变体的阈值，高度从 30px 跳到 45px，那条公式
/// 就得缩——同类公式一样大比多两个百分点重要。
pub(crate) const MIN_SCRIPT_SCALE: f32 = 0.8;
/// 二级下标（`x^{a^b}` 的 b、分式套分式的内层）的下限。仍比一级小一档，
/// 层级关系保住，但不再掉到 0.5 em 那种糊成一团的尺寸。
pub(crate) const MIN_SCRIPT_SCRIPT_SCALE: f32 = 0.65;
```

字体的 MATH 表原生给 70%，那是为纸面阅读字号调的；终端里 20px 正文的分子只有 14px。抬到 0.8 的代价是公式变高约一成；上限卡在 0.8 的理由带着实测：0.85 时根号里的上标顶过字形变体的阈值，高度从 30px 跳到 45px。注释原话——「这是刻意偏离 LaTeX/KaTeX 的一处」。二级下标另有 0.65 的下限，比一级小一档，层级关系保住。

这些常量是活的合同，布局阶段每次都执行：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/math/layout.rs
    fn script_scale(&self, script_script: bool) -> Result<f32, MathError> {
        let scale = self
            .font
            .script_scale(script_script)
            .map_err(|_| MathError::new(MathErrorKind::Font, 0))?;
        let floor =
            if script_script { super::MIN_SCRIPT_SCRIPT_SCALE } else { super::MIN_SCRIPT_SCALE };
        Ok(scale.max(floor))
    }
```

`scale.max(floor)`：字体给的 70% 抬到 0.8、50% 抬到 0.65，字体给得更大时保留字体值。常量不是注释里的散文，是每次布局都越不过去的下限。

「与 KaTeX 的差异是未修完的 bug」的直觉也该说句公道话：渲染差异多数确实是缺陷，升级就好，经验不坏。判定差异是 bug 还是决定，看理由的载体在不在。注释里有没有实测数字（0.85 让高度 30px 跳 45px）；测试里有没有锁定断言（验证节会看到对 0.431 × 20 × 1.21 的断言）；常量是不是全模块唯一声明。三样都在，这是决定；三样都没有，才轮到报 bug。

## 一条底线，两条管线

「字号不够就别渲了」这种降级决定，看起来天然属于显示层——毕竟是它在画，它看着办最自然。这个系统里「显示层」不止一个：终端覆盖层（terminal_math.rs，公式画在终端网格上方）和 markdown 阅读器（markdown_view.rs，公式画进文档页）。如果各自拍板阈值，同一条公式可能终端里能读、进了阅读器就变回源码，而且没人说得出为什么。

机制是一处定义、逐字引用。底线常量在 mod.rs 唯一声明：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/math/mod.rs
/// 低于该字号的公式已不可读：调用方应放弃覆盖渲染，回退到原始源码文本。
/// 终端覆盖层与 markdown 阅读器共用同一条底线，保证两条管线判定一致。
pub(crate) const MIN_READABLE_MATH_PX: f32 = 6.0;
```

两条路径怎么取它？逐字相同的 import：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/display/terminal_math.rs
use crate::math::{DEFAULT_LIMITS, MIN_READABLE_MATH_PX, compile_formula};
```

markdown_view.rs 里有一行字符级相同的 import（探针逐字符比对过），常量与编译入口一次拿到。判定处也是同一条比较——阅读器把公式往列宽里收，收到字号掉线就放弃：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/display/markdown_view.rs
    // Math layout is linear in pixel size. Leave a small rounding margin so
    // the rightmost antialiasing pixel stays inside the reading column.
    let fitted_size = pixel_size * (max_width / run.advance_width) * 0.98;
    if fitted_size < MIN_READABLE_MATH_PX {
        return None;
    }
```

终端覆盖层做的是同一常量的同一比较；GPUI 壳的 math_view.rs 也 import 同一常量持同一条底线。这就是**共享常量合同**——最小字号、编译入口这类常量在一处定义、两条渲染路径逐字引用，同一问题在整个系统里只允许有一个判定。字号不足时的降级因此不是谁的临时决定：掉到 6.0 像素之下，所有呈现面同时回退源码文本。

另一份合同是显式长度换算。TeX 的 pt 与逻辑像素不是一比一：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/math/mod.rs
/// 窗口 DPI scale → `compile_formula` 的 `pixels_per_point`。TeX 的 pt 是
/// 1/72.27 英寸，逻辑分辨率按 96 dpi 计；该参数只决定 `\kern`/`\\[6pt]`
/// 这类显式长度的换算。两壳所有编译调用共用这一个公式，显式行距/间距
/// 才不会因壳而异（GPUI 壳曾直接传 scale factor，显式长度偏小 1/3）。
pub(crate) fn pixels_per_point(scale_factor: f32) -> f32 {
    scale_factor * 96.0 / 72.27
}
```

96 除以 72.27，两壳所有编译调用共用这一个函数。注释还记着病史：GPUI 壳曾直接传 scale factor，显式长度悄悄偏小——这类错不崩不报，只是行距不对，所以它必须是共用函数，不能靠各自记得。双路径一致性的验收口径就落在这批合同上：改 6.0 这个数，两条路径同时变；谁也不能背着另一条路径私调阈值。

## 演练：一行公式走过五段

把开篇那行求根公式从左到右走一遍，每段的入口与交接物如下：

| 阶段 | 文件 | 入口 | 交给下一段的东西 |
| --- | --- | --- | --- |
| parse | parser.rs | `parse_formula(source, display, limits)` | `ParsedFormula`（有界 arena） |
| validate | validate.rs | `validate(source, limits)` | 通过，或带原因的拒绝 |
| layout | layout.rs | `layout_formula(formula, pixel_size, pixels_per_point, limits)` | `MathLayout` 四组指令 |
| compile | compile.rs | `compile_formula(source, display, pixel_size, pixels_per_point, limits)` | 补偿后的 `MathLayout` |
| rasterize | rasterizer.rs + bitmap.rs | `rasterize(glyph_id, pixel_size)` 与 `compose(...)` | 直通 alpha 的 BGRA 位图 |

支撑件各一句：ir.rs 是中间表示；font.rs 让 Latin Modern Math 进程内只解析一次，Face 只借用约 716 KiB 静态字体字节不复制；spacing.rs 管原子间距；cache.rs 是 4MiB 的布局 LRU；bitmap.rs 管有界合成。五段管线加五份支撑，正是 mod.rs 声明的十个模块。

本章要你带走的是三步读码法，适用于任何「渲染公式、渲染富文本」的子系统：

1. 找编译入口。谁把 parse 与 layout 串起来？呈现面被允许做什么决定（定位可以，排版不行）？入口唯一，后面的复用才有落点。
2. 查中间表示的依赖面。布局产物 import 了哪些类型？窗口、OpenGL、主题一样都没有，「后端无关」就是 grep 得出的事实。
3. 查常量的引用形态。一处定义、逐字 import、同一比较，这是合同；各处自抄数字，那是复制。常量的引用形态，就是合同的执行形态。

## 验证：先猜，再跑

第一步，探针先猜后跑。到 companion 目录运行 `node scripts/probe-13-native-math.mjs`。跑之前把四个离散预测写在纸上：数学模块的文件数；三个常量 MIN_READABLE_MATH_PX、OPTICAL_SCALE、MIN_SCRIPT_SCALE 的值；`pixel_size * super::OPTICAL_SCALE` 乘法的处数；全部检查的条数。跑完对照——应为 10 份文件、6.0 / 1.21 / 0.8、恰好 2 处、23 条全绿；summary 行还会把阶段清单与缓存事实串打出来。预测落空，回「管线不认识窗口」与「光学缩放」两节找原因。

第二步，纸面演算。名义字号 20px 下：(a) 补偿前的 x-height 是多少像素？(b) 补偿后呢？(c) 分式分子在 MATH 表原生 70% 下多大，抬到下限后多大？先写数，再展开锁定测试核对。

<details>
<summary>compile.rs · optical_scale_reaches_layout_metrics（锁定原文）</summary>

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/math/compile.rs
    /// 光学补偿必须真正到达 metrics：Latin Modern 的 x-height 是 0.431 em，
    /// 名义 20px 下补偿后应为 0.431 × 20 × [`super::super::OPTICAL_SCALE`]。
    /// 补偿只在 compile_formula 单点生效；缓存键、fit、draw 都持名义字号。
    #[test]
    fn optical_scale_reaches_layout_metrics() {
        let layout = compile_formula("x", false, 20.0, 1.0, DEFAULT_LIMITS).expect("compile");
        let expected = 0.431 * 20.0 * crate::math::OPTICAL_SCALE;
        assert!(
            (layout.metrics.height - expected).abs() < 0.5,
            "x-height {} should be ≈ {expected}",
            layout.metrics.height,
        );
    }
```

答案：(a) 8.62 像素；(b) 约 10.43 像素；(c) 14px，抬到 16px。测试容差 0.5 像素——1.8 像素的补偿差，一删就出界。

</details>

第三步，定向破坏。在你自己 clone 的 Pebrel 上（课程探针只读，不动仓库），把 compile.rs 里两处 `pixel_size * super::OPTICAL_SCALE` 的乘法都删掉。先写下预测再跑 `cargo test -p nebula math::`：应恰好 1 条红——optical_scale_reaches_layout_metrics；math 模块其余测试全绿。两条「没变红」的各有守卫对象：两个编译入口互相断言相等的测试还绿——你删的是两处，两边同时失去补偿，等式不受影响，它守的是「两条入口同源」，不是「补偿发生」；截图公式测试也绿——它守「能编出非空几何」，不问尺寸。红的那条守的才是「补偿真正到达 metrics」。改回两处乘法重跑，确认复原。如果红的多于一条，先检查是不是只删了一处——那会让两条入口失去同步，等于换了一个实验。

## 自查：换一个输入

1. 某桌面应用声称自己的公式引擎「后端无关」。给出一条可机械执行的 grep 命令验证它——查什么模式、在什么范围？范围圈错会发生什么？
2. 名义字号 14px、x-height 0.431 em：补偿后的 x-height 是多少像素？要判断某处「公式偏大」是 bug 还是决定，你要找哪三样证据？
3. 同一条公式在终端覆盖层拟合出 6.5px、在阅读器只剩 5.8px。两边各自的呈现结果是什么？如果阈值由各显示层自己定，最坏会出什么事；这里为什么出不了？
4. 缓存键 FormulaCacheKey 为什么存名义字号的位模式，而不是补偿后的字号？换个说法：补偿若进了键，调用方得多知道什么？

::: details 参考答案
1. 在圈定的引擎目录内查 `gpui::|use gpui|winit|glow`（对应本课是 math 目录十份文件），零命中才成立；范围必须先圈定，全仓库扫描当然会命中 UI 代码，那验证不了任何事。
2. 0.431 × 14 × 1.21 ≈ 7.33 像素。三样证据：注释里的实测数字、测试里的锁定断言、常量的全模块唯一声明。
3. 覆盖层照常渲染（6.5 ≥ 6.0），阅读器回退源码文本（5.8 < 6.0）。阈值若各自定，同一条公式可能一处渲一处不渲，且说不清谁对；这里出不了，因为两边逐字 import 同一常量做同一比较——合同管的是阈值一致，拟合结果本来允许不同。
4. 多知道「补偿系数存在、是多少」。键持名义字号，补偿就是 compile 入口的内部细节；若补偿进键，调用方构造键时就得自己乘系数，任何一处忘乘就得到另一个缓存条目——合同泄漏成了调用方的负担。
:::

## 收束

开篇那两份公式的大小差异，现在可以一件件对上号了。上下标更大：MATH 表原生的 70% 是为纸面字号调的，终端里太糊；MIN_SCRIPT_SCALE 把下限抬到 0.8（二级 0.65）。注释里留着理由——实测 0.85 会让根号上标高度从 30px 跳到 45px。整体比例：Latin Modern Math 的 x-height 只有 0.431 em，光学缩放按 1.21 补偿——与 KaTeX 同族同数值的同一个决定。两者都不是没修完的 bug，是写下了理由与断言的决定。这台机器五段流水线（解析、校验、布局、编译、栅格化）不认识窗口，只在最后一步按壳的 BGRA 字节约定交货；一条 6.0 像素的底线被两条渲染路径逐字引用。本章交给你三块积木。排版编译管线——五阶段与唯一编译入口，窗口/OpenGL 无关；光学缩放——1.21 补偿与 0.8/0.65 下限，何时刻意偏离 KaTeX；共享常量合同——一处定义、逐字引用、同一判定。两个易错点带走：「后端无关」不等于零约定，位图合成的最后一步仍按壳的图像格式排字节；补偿不进缓存键、只进 metrics，看到键里是名义字号别当成漏乘。下一站：AI 回答阅读器逐字 import 的正是这条管线的编译入口（第 14 章）。
