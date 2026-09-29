---
title: 第 2 章 从字节到屏幕：VT 解析与网格状态机
---

# 从字节到屏幕：VT 解析与网格状态机

## 工具箱

- 命名双轨 — 引用代码用 crate 现名 nebula_*，讲产品用 Pebrel，NEBULA_ 前缀按兼容层理解（第 1 章）。
- 所有权地图 — 查 docs/architecture.md 的 owns / must not become 两栏合同，判断一个改动该落在哪个 crate（第 1 章）。

## 三种输出，一台状态机

在终端里敲一个 `ls`，目录名带着颜色和粗体；打开 vim 改一行字，它只重画受影响的那几行；不小心 `cat` 了一个二进制文件，整屏字符糊成一团「乱码」，连提示符都找不到。三件事看起来毫不相干——上色、局部刷新、乱码——它们是同一台状态机的三种输入。

shell 手里没有画笔。程序与终端之间只有一条字节管道：要显示的字节从这里走，「把接下来的字染红」这类指令也从这里走。指令的编码方式就是转义序列——以 ESC 字节（十六进制 0x1b）开头的一小段控制字节，比如 `\x1b[31m`。终端收到输出后并不直接显示，而是把字节流交给解析器，翻译成对一个一个单元格的修改；每改一处，网格顺手记一笔 damage（损坏账）：哪一行、哪一段列变了。渲染只重画记过账的地方。

本章回答三个问题：颜色怎么落进格子？vim 凭什么只刷几行？「乱码」到底是谁干的？走完这一章，你能亲手追踪任意一条序列，从字节一路追到屏幕状态的变化。

## 原理：从字节流到网格

### 先定位：这层代码住哪

拿所有权地图查这层代码的落点：

```text
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:docs/architecture.md
| `nebula_terminal` | Grid, VT processing, terminal/PTY behavior | Product panels or GPUI state |
```

这是全书第一处源码引用。此后每个引用块首行都标注 `Kuddev/pebrel@360613aa…:路径`，与锁定 commit 逐字一致；被引用代码依 GPL-3.0 授权使用，署名与许可声明集中在 about 页。

合同读法：nebula_terminal 拥有网格、VT 处理与终端行为；禁区是产品面板与 GPUI 状态。本章读的全部状态机代码都与 UI 框架无关。crate 名沿用旧的 nebula_ 前缀、产品叫 Pebrel，引用代码一律用现名（命名双轨的口径，第 1 章）。

### VT 转义序列：一条管道，两种内容

为什么会有转义序列这种东西？反事实想一遍：终端与程序之间没有第二条通道，没有带外信令。程序想改颜色、清屏、移动光标，唯一的办法就是把指令编码成字节混进输出流。ESC（0x1b）被选作转义起点——它是控制字符，不会与可打印文本冲突。这类序列统称 VT 转义序列——终端协议的基本词法单位；名字来自 Digital Equipment Corporation 的 VT 系列终端，它家的控制码成了几十年的事实标准。

日常打交道的两个大类，先各给一句辨认级定义：

- CSI：ESC [ 开头、以一个字母收尾。`\x1b[31m`（设置前景色）、`\x1b[2J`（清屏）、`\x1b[?25l`（隐藏光标）都是。
- OSC：ESC ] 开头、以 BEL 或 ST 收尾，载荷是一段文本。窗口标题、当前目录上报走这条路。

nebula_terminal 不自己写字节级解析器，它用 alacritty 维护的 vte：

```toml
# Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/Cargo.toml
vte = { version = "0.15.0", default-features = false, features = ["std", "ansi"] }
```

lib.rs 里一句 `pub use vte;` 把解析器重导出为本 crate 的一等成员。解析器的产出是结构化回调：Term 实现 vte 的 Handler trait，收到的是「打印字符 c」「设置属性 attr」「进入私有模式 mode」这样的调用，不再是裸字节。

字节从哪里进来、怎么喂给解析器：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/event_loop.rs
/// 本地 PTY 与远端传输共用的有状态终端字节流处理器。
/// OSC 提取必须紧贴 VT 解析，避免两类会话产生不同的目录、命令和图片状态。
#[derive(Default)]
pub struct StreamProcessor {
    parser: ansi::Processor,
    cwd_sniffer: crate::osc_cwd::CwdSniffer,
    window_size: Option<WindowSize>,
```

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/event_loop.rs
    fn advance<U: EventListener>(&mut self, terminal: &mut Term<U>, bytes: &[u8]) {
        // VTE 0.15 在约 2 MiB 时强制提交同步缓冲；提前取消兼容锚点，
        // 但不强制结束/截断输出。分块保证单次大输入也不会绕过检查。
        for chunk in bytes.chunks(4096) {
            if self.parser.sync_bytes_count() >= 1024 * 1024 {
                terminal.cancel_redraw_anchor();
            }
            self.parser.advance(terminal, chunk);
        }
```

两段连起来读：字节进入 `StreamProcessor::advance`，按 4096 字节一块喂给 `parser.advance(terminal, chunk)`。分块是刻意的——注释写明 vte 0.15 在约 2 MiB 时强制提交同步缓冲，分块保证单次大输入也不会绕过检查。文档注释还交代了一件事：无论字节来自本地还是远端会话，进的都是同一个处理器、同一个解析器。

### 网格与单元格：屏幕状态的家

屏幕在内存里不是一张图，而是一张二维表格——网格与单元格，屏幕一切可见状态的家。追问「这行字怎么来的」，最终都落到这张表上。

<details>
<summary>nebula_terminal/src/grid/mod.rs · Grid&lt;T&gt; 结构体（30 行，点击展开）。</summary>

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/grid/mod.rs
#[derive(Clone, Debug)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub struct Grid<T> {
    /// Current cursor for writing data.
    #[cfg_attr(feature = "serde", serde(skip))]
    pub cursor: Cursor<T>,

    /// Last saved cursor.
    #[cfg_attr(feature = "serde", serde(skip))]
    pub saved_cursor: Cursor<T>,

    /// Lines in the grid. Each row holds a list of cells corresponding to the
    /// columns in that row.
    raw: Storage<T>,

    /// Number of columns.
    columns: usize,

    /// Number of visible lines.
    lines: usize,

    /// Offset of displayed area.
    ///
    /// If the displayed region isn't at the bottom of the screen, it stays
    /// stationary while more text is emitted. The scrolling implementation
    /// updates this offset accordingly.
    display_offset: usize,

    /// Maximum number of lines in history.
    max_scroll_limit: usize,
```

</details>

字段面过一遍：cursor / saved_cursor 是当前与暂存的光标（光标自带一个「模板」，演练时细看）；raw: Storage<T> 是行存储本体；columns / lines 是可见尺寸；display_offset 记录视口向历史方向回滚了多少；max_scroll_limit 限定历史行数上限。

单个格子长什么样，答案在 cell.rs。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/term/cell.rs
#[derive(Clone, Debug, Eq, PartialEq)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub struct Cell {
    pub c: char,
    pub fg: Color,
    pub bg: Color,
    pub flags: Flags,
    pub extra: Option<Arc<CellExtra>>,
}
```

五个字段：c 是字符，fg / bg 是前景与背景色，flags 是粗体、斜体、下划线这类位标志，extra 装零宽字符、超链接等稀有属性（Option 加 Arc，绝大多数格子是 None，省内存）。。

这里值得停一下，拆一个常见直觉：「红字」听起来是文字的属性——富文本编辑器就这么建模，日常语言也这么说，在那个场景里这个直觉完全够用。但在状态机里，**颜色住在格子上，不住在字符上**。证据就是 Cell 的字段面：fg、bg 与 c 并列声明，互不隶属。可观察的反证也有：`ls` 的高亮目录整行带底色——底色铺在空格上，而空格不是任何「文字」的一部分；同一屏两个 E 可以一红一白，字符相同、格子不同。

Grid 与 Term 还共同实现一份尺寸小合同：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/grid/mod.rs
/// Grid dimensions.
pub trait Dimensions {
    /// Total number of lines in the buffer, this includes scrollback and visible lines.
    fn total_lines(&self) -> usize;

    /// Height of the viewport in lines.
    fn screen_lines(&self) -> usize;

    /// Width of the terminal in columns.
    fn columns(&self) -> usize;
```

total_lines（含历史）/ screen_lines（视口高）/ columns（宽）。从此「问尺寸」不用关心里面是 Grid 还是 Term——滚动、resize 的代码反复用这个抽象问路。vim 那种局部滚动还有一半真相在 Term 侧：scroll_region 是一个 Range&lt;Line&gt; 滚动区，行搬运被裁剪在这个区间内。

### TermMode 位域：终端「现在处于什么模式」

换行要不要自动回车、光标显不显示、鼠标事件报不报告——这些是跨序列持久的开关状态：一条序列把它设上，效果要留到未来任意久。如果每个开关存一个 bool，结构散、序列化烦、互斥关系也没法表达。nebula_terminal 的选择是一个 u32 的位域：TermMode 位域——一个 bit 一个开关，终端模式的单一事实源。

<details>
<summary>nebula_terminal/src/term/mod.rs · TermMode 位域开头（13 行，点击展开）。</summary>

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/term/mod.rs
bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
    pub struct TermMode: u32 {
        const NONE                    = 0;
        const SHOW_CURSOR             = 1;
        const APP_CURSOR              = 1 << 1;
        const APP_KEYPAD              = 1 << 2;
        const MOUSE_REPORT_CLICK      = 1 << 3;
        const BRACKETED_PASTE         = 1 << 4;
        const SGR_MOUSE               = 1 << 5;
        const MOUSE_MOTION            = 1 << 6;
        const LINE_WRAP               = 1 << 7;
        const LINE_FEED_NEW_LINE      = 1 << 8;
```

</details>

<details>
<summary>nebula_terminal/src/term/mod.rs · 位域收尾：私有扩展与聚合（18 行，点击展开）。</summary>

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/term/mod.rs
        /// Microsoft ConPTY Win32 input mode (DECSET 9001).
        const WIN32_INPUT_MODE        = 1 << 23;
        /// DECSET 2031 — 订阅色彩方案（亮/暗）变更通知。
        ///
        /// 订阅方在终端翻主题时收到 `CSI ? 997 ; 1 n`（暗）/ `; 2 n`（亮），
        /// 据此重挑自己的配色。没有这条，已经跑着的 TUI 只能停留在它启动那一刻
        /// 用 OSC 11 问到的背景色上——用户把深色主题切成浅色，nvim/delta/codex
        /// 会继续用为深底挑的颜色画在白底上。
        const COLOR_SCHEME_UPDATES    = 1 << 24;
        const MOUSE_MODE              = Self::MOUSE_REPORT_CLICK.bits() | Self::MOUSE_MOTION.bits() | Self::MOUSE_DRAG.bits();
        const KITTY_KEYBOARD_PROTOCOL = Self::DISAMBIGUATE_ESC_CODES.bits()
                                      | Self::REPORT_EVENT_TYPES.bits()
                                      | Self::REPORT_ALTERNATE_KEYS.bits()
                                      | Self::REPORT_ALL_KEYS_AS_ESC.bits()
                                      | Self::REPORT_ASSOCIATED_TEXT.bits();
         const ANY                    = u32::MAX;
    }
}
```

</details>

中间被折叠的十几行是同一种节奏：从 ORIGIN 到 REPORT_ASSOCIATED_TEXT，一个标志一个编号。读法抓三件事：

1. **编号即身份**。SHOW_CURSOR 占 1<<0、LINE_WRAP 占 1<<7……NONE 之外的 25 个单标志无空洞地铺满 1<<0 到 1<<24。探针专门有一条检查「单比特标志覆盖 1<<0..1<<24 无空洞」，守的就是这张分配表。
2. 聚合不是新位。MOUSE_MODE 是三个鼠标标志的并集、KITTY_KEYBOARD_PROTOCOL 是五个 kitty 键盘标志的并集——都只是别名。用途是「一键清掉一组互斥开关」：切换鼠标协议时先 remove(MOUSE_MODE) 再 insert 新标志。
3. 开机默认只亮四盏灯：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/term/mod.rs
impl Default for TermMode {
    fn default() -> TermMode {
        TermMode::SHOW_CURSOR
            | TermMode::LINE_WRAP
            | TermMode::ALTERNATE_SCROLL
            | TermMode::URGENCY_HINTS
    }
}
```

SHOW_CURSOR、LINE_WRAP、ALTERNATE_SCROLL、URGENCY_HINTS，其余全灭。

### DECSET 2031：编号表外的私有扩展

`\x1b[?25l` 这类带问号的序列叫 DECSET / DECRST——设 / 清「私有模式」。一个流传很广的直觉是：这些编号都是标准规定的。给直觉说句公道话：?25、?1049 这些常用编号确实到处通用，看起来就像一张官方注册表。但 private mode 这个名字本身就说了实话——编号空间是留给私有扩展的，谁都可以来领号。上面的 TermMode 表尾就躺着两个：?9001 是 Microsoft ConPTY 的 Win32 输入模式；?2031 出自 color-palette-update-notifications 提案，订阅亮 / 暗主题变更通知。

2031 怎么落进位域？看 set_private_mode 的开头。

<details>
<summary>nebula_terminal/src/term/mod.rs · set_private_mode 的两个 Unknown 早退分支（15 行，点击展开）。</summary>

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/term/mod.rs
    fn set_private_mode(&mut self, mode: PrivateMode) {
        if matches!(mode, PrivateMode::Unknown(9001)) {
            self.mode.insert(TermMode::WIN32_INPUT_MODE);
            return;
        }
        // DECSET 2031 只订阅后续配色变化，不是 CSI ? 996 n 查询；
        // 在这里回报会在 shell 交接终端时注入它未请求的输入。
        if matches!(mode, PrivateMode::Unknown(2031)) {
            self.mode.insert(TermMode::COLOR_SCHEME_UPDATES);
            return;
        }
        let mode = match mode {
            PrivateMode::Named(mode) => mode,
            PrivateMode::Unknown(mode) => {
                debug!("Ignoring unknown mode {mode} in set_private_mode");
```

</details>

注意 2031 分支的位置：排在 Named 分类之前，用 `PrivateMode::Unknown(2031)` 匹配。为什么是 Unknown？因为 vte 0.15 的 NamedPrivateMode 表里没有 2031——解析器不认识这个编号，只能把它原样包成「未知私有模式」交给 handler。这段成因不是推断，测试文件里白纸黑字：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/term/tests.rs
/// 端到端走**真实字节**，而不是直接调 handler。
///
/// 2031 不在 vte 0.15 的 `NamedPrivateMode` 表里，它只能以
/// `PrivateMode::Unknown(2031)` 落到我们的 handler。上面那几个测试是直接调
/// `set_private_mode` 的，绕过了解析；如果解析器把 `\e[?2031h` 归到别处，
/// 整个功能是死的而单测照样全绿。这一条把那段路也钉住。
#[test]
fn decset_2031_survives_the_real_parser() {
```

注释还点破一个陷阱：直接调 set_private_mode 的单测会全绿，哪怕解析器根本没把字节送到这里——功能死了，测试不知道。所以有一条端到端测试用真实字节钉住整条解析路径。

<details>
<summary>nebula_terminal/src/term/tests.rs · decset_2031_survives_the_real_parser（22 行，点击展开）。</summary>

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/term/tests.rs
fn decset_2031_survives_the_real_parser() {
    let size = TermSize::new(5, 5);
    let events = WriteRecorder::default();
    let mut term = Term::new(Config::default(), &size, events.clone());
    let mut parser: ansi::Processor = ansi::Processor::new();

    parser.advance(&mut term, b"\x1b[?2031h");
    assert!(
        term.mode().contains(TermMode::COLOR_SCHEME_UPDATES),
        "`\\e[?2031h` 必须经解析器落到 PrivateMode::Unknown(2031)"
    );
    assert!(events.take().is_empty());

    // 主题翻成浅色：订阅方收到 `;2n`。
    term.set_color_scheme(false);
    assert_eq!(events.take(), vec!["\x1b[?997;2n".to_owned()]);

    // 退订之后不再收到。
    parser.advance(&mut term, b"\x1b[?2031l");
    assert!(!term.mode().contains(TermMode::COLOR_SCHEME_UPDATES));
    term.set_color_scheme(true);
    assert!(events.take().is_empty());
```

</details>

行为口径全部来自源码注释。订阅方向：启用时终端保持静默——「只订阅后续配色变化，不是 CSI ? 996 n 查询；在这里回报会在 shell 交接终端时注入它未请求的输入」。回报方向。

<details>
<summary>nebula_terminal/src/term/mod.rs · report_color_scheme：门与应答字节（14 行，点击展开）。</summary>

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/term/mod.rs
    /// 发 `CSI ? 997 ; 1 n`（暗）/ `CSI ? 997 ; 2 n`（亮）。    ///
    /// 编号来自 color-palette-update-notifications 提案；主流终端实现采用
    /// 同一套应答格式。没订阅就不发——这个序列对没要求过它的程序来说是
    /// 不认识的输入。
    fn report_color_scheme(&mut self)
    where
        T: EventListener,
    {
        if !self.mode.contains(TermMode::COLOR_SCHEME_UPDATES) {
            return;
        }
        let value = if self.color_scheme_dark { 1 } else { 2 };
        self.event_proxy.send_event(Event::PtyWrite(format!("\x1b[?997;{value}n")));
    }
```

</details>

门是 `mode.contains(COLOR_SCHEME_UPDATES)`：没订阅就一个字节都不发；订阅了，也只在主题真的翻转时往事件队列排一条 `\x1b[?997;1n`（暗）或 `\x1b[?997;2n`（亮）。这件事为什么值得做，位域的文档注释给了一个具体场景。没有这条，跑着的 TUI 只能停留在它启动那一刻用 OSC 11 问到的背景色上。用户把深色主题切成浅色后，nvim、delta、codex 会继续用为深底挑的颜色画在白底上。

### damage 追踪：只重画坏掉的部分

最后一个直觉：终端每次输出都全屏重绘。公平地说，从桌面 GUI 带来的印象里，重绘区域只是优化细节；而且确实有终端整帧全画也能跑。这个仓库把「哪里变了」当成一等状态来记账——damage 追踪，网格记录自上次渲染以来变化的最小区域，渲染侧只重绘损坏部分。账本分三层。

第一层，行级账本，在 damage.rs：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/term/damage.rs
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LineDamageBounds {
    pub line: usize,
    pub left: usize,
    pub right: usize,
}
```

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/term/damage.rs
    pub fn expand(&mut self, left: usize, right: usize) {
        self.left = cmp::min(self.left, left);
        self.right = cmp::max(self.right, right);
    }

    #[inline]
    pub fn is_damaged(&self) -> bool {
        self.left <= self.right
    }
}
```

每行一个 `LineDamageBounds { line, left, right }`。expand 取 min / max 扩区间——同一行的多次修改只会把区间越并越大，不重复记账；is_damaged 用 `left <= right` 判断，未损坏的行初始化为 left=列数、right=0，任何一次 expand 都会把它翻转成真。

第二层，光标区间补账。打字并不逐格记账——那是一种浪费。渲染来读账时，Term 把上一帧光标位置到当前位置补进账本，连续敲出的字被一个区间覆盖。

<details>
<summary>nebula_terminal/src/term/mod.rs · damage() 读账时的补账逻辑（17 行，点击展开）。</summary>

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/term/mod.rs
    #[must_use]
    pub fn damage(&mut self) -> TermDamage<'_> {
        // Ensure the entire terminal is damaged after entering insert mode.
        // Leaving is handled in the ansi handler.
        if self.mode.contains(TermMode::INSERT) {
            self.mark_fully_damaged();
        }

        let previous_cursor = mem::replace(&mut self.damage.last_cursor, self.grid.cursor.point);

        if self.damage.full {
            return TermDamage::Full;
        }

        // Add information about old cursor position and new one if they are not the same, so we
        // cover everything that was produced by `Term::input`.
        if self.damage.last_cursor != previous_cursor {
            // Cursor coordinates are always inside viewport even if you have `display_offset`.
            let point = Point::new(previous_cursor.line.0 as usize, previous_cursor.column);
            self.damage.damage_point(point);
        }

        // Always damage current cursor.
        self.damage_cursor();
```

</details>

擦行、插删字符这类行级操作才当场 damage_line；写路径上这样的调用点共 12 处（探针替你数了）。

第三层，全屏兜底。清屏、resize、进出交替屏这类结构性变化直接置 full：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/term/mod.rs
    /// Resets the terminal damage information.
    pub fn reset_damage(&mut self) {
        self.damage.reset(self.columns());
    }

    #[inline]
    fn mark_fully_damaged(&mut self) {
        self.damage.full = true;
    }
```

对外只有一张二态答卷：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/term/damage.rs
/// Terminal damage information collected since the last reset.
#[derive(Debug)]
pub enum TermDamage<'a> {
    Full,
    Partial(TermDamageIterator<'a>),
}
```

Full（整屏重画）或 Partial（按行迭代），没有第三种。状态本体：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/term/damage.rs
/// Mutable damage bookkeeping owned by a terminal.
pub(super) struct TermDamageState {
    pub(super) full: bool,
    pub(super) lines: Vec<LineDamageBounds>,
    pub(super) last_cursor: Point,
}
```

一个 full 标志、每行的账、上一帧光标位置。合同也写在源码里：渲染读 `pub fn damage()`，读完调 `reset_damage()` 清零——damage 的文档注释原话是 After reading damage reset_damage should be called。渲染侧按帧拿 Partial 迭代器、只重画坏行；这就是 vim 局部刷新不闪全屏的机制。账本的消费端接线在事件循环与渲染侧（第 3 章）。

### 四块积木拼成一条因果链

VT 转义序列（字节到回调的词法）+ 网格与单元格（回调到格子的状态）+ TermMode 位域（跨序列的模式）+ damage 追踪（变化的记账）⇒ 「屏幕为什么长这样」的完整解释链。开篇的三个现象，现在每个都能挂到链上。

## 演练：追踪 `\x1b[31mError\x1b[0m`

先把一条序列拆到每一步，走完从 vte 回调到单元格样式落库的全路径。开始前先猜一次：`\x1b[31m` 到达、还没有任何字符输出时，屏幕上会出现红色吗？记下你的答案。

1. 字节流进入 `StreamProcessor::advance`，按 4096 一块喂给 vte 解析器（见前面的 advance 片段）。
2. `\x1b[31m` 被解析器认成 CSI SGR，回调 terminal_attribute。

<details>
<summary>nebula_terminal/src/term/mod.rs · terminal_attribute：SGR 改的是模板（15 行，点击展开）。</summary>

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/term/mod.rs
    /// Set a terminal attribute.
    #[inline]
    fn terminal_attribute(&mut self, attr: Attr) {
        trace!("Setting attribute: {attr:?}");
        let cursor = &mut self.grid.cursor;
        match attr {
            Attr::Foreground(color) => cursor.template.fg = color,
            Attr::Background(color) => cursor.template.bg = color,
            Attr::UnderlineColor(color) => cursor.template.set_underline_color(color),
            Attr::Reset => {
                cursor.template.fg = Color::Named(NamedColor::Foreground);
                cursor.template.bg = Color::Named(NamedColor::Background);
                cursor.template.flags = Flags::empty();
                cursor.template.set_underline_color(None);
            },
```

</details>

   它改的是 `cursor.template.fg`——模板，不是屏幕。模板是「接下来要写的字」的预样式；此刻一个格子都没动，damage 也没记。这就是开头那题的答案：屏幕无任何变化。
3. 接着五个可打印字符 E、r、r、o、r 逐个回调 input()：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/term/mod.rs
impl<T: EventListener> Handler for Term<T> {
    /// A character to be displayed.
    #[inline(never)]
    fn input(&mut self, c: char) {
        // Number of cells the char will occupy.
        let width = match c.width() {
            Some(width) => width,
```

4. 宽度为 1 的字符直接写光标处：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/term/mod.rs
        if width == 1 {
            self.write_at_cursor(c);
        } else {
```

5. write_at_cursor 是颜色落库的现场。先把模板的样式抓出来。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/term/mod.rs
    /// Write `c` to the cell at the cursor position.
    #[inline(always)]
    fn write_at_cursor(&mut self, c: char) {
        let c = self.grid.cursor.charsets[self.active_charset].map(c);
        let fg = self.grid.cursor.template.fg;
        let bg = self.grid.cursor.template.bg;
        let flags = self.grid.cursor.template.flags;
        let extra = self.grid.cursor.template.extra.clone();
```

   写完字符后连同样式一起塞进格子。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/term/mod.rs
        cursor_cell.c = c;
        cursor_cell.fg = fg;
        cursor_cell.bg = bg;
        cursor_cell.flags = flags;
        cursor_cell.extra = extra;
```

   c、fg、bg、flags、extra 五个字段各自赋值——「红色」此刻才从模板进入单元格，五个字母各带一份红色前景。
6. `\x1b[0m` 又是一条 SGR，回调 Attr::Reset（terminal_attribute 片段的 Reset 分支）：模板清回默认前景 / 背景、flags 清空。后面再输出的字不再带红。
7. 帧尾：渲染读 damage()，上一帧光标到当前光标的区间补账，只重画这一段。

这七步就是「从 vte 回调到单元格样式落库」的全部路径。

## 验证：探针替你数，你替探针猜

本章探针是 companion/scripts/probe-02-vt-grid.mjs——只读静态探针，在锁定 clone 上断言本章说过的每一件事，共 25 条检查。

1. 动手跑：在 companion 目录执行 `node scripts/probe-02-vt-grid.mjs`。预期 25 条全绿，末行输出 `PASS  [vt-grid] 25/25 checks`。
2. 先猜后跑——把离散答案写在纸上，再跑探针对答案：
   - TermMode 的成员总数：27 / 29 / 31，三选一。
   - 写路径 damage_point / damage_line 调用点：恰好 12 / 至少 15，二选一。

   对照：成员数 29（26 个单标志 + 2 个聚合并集 + 1 个 ANY 全集）；调用点恰好 12。
3. 定向破坏——在你自己的 clone 上做，课程的锁定 clone 不要动。把 term/mod.rs 里 `const COLOR_SCHEME_UPDATES    = 1 << 24;` 的 24 改成 23。改之前先写下预言：哪条探针检查会变红？

   跑探针对答案。变红的应当是「单比特标志覆盖 1<<0..1<<24 无空洞」一条——24 号位凭空消失了。还有一层当下看不见的后果：2031 与 9001 撞在同一个 bit 上，DECSET 2031 点亮的开关会同时点亮 WIN32_INPUT_MODE。**位域里编号即身份，撞号即身份混淆**——探针守的不只是「成员存在」，而是整张编号分配表。改回 24，复跑恢复全绿。
4. 结果与结论连线：探针每条检查对应正文一个断言（位域成员、vte 依赖、2031 处理点、网格字段面、damage 结构）。预言对了，说明你已经能从结构推出行为，而不是背结论。

## 收束：回到开篇的三个现象

`ls` 的彩色输出：SGR 序列改模板，字符落格时把颜色一并写进 Cell——颜色是格子的属性，不是字符的。vim 的局部刷新：滚动区加行级 damage 记账，渲染只拿 Partial 迭代器重画坏行；只有结构性变化才走 Full。`cat` 二进制的「乱码」：那些字节同样进了这台状态机，大部分被当普通字符印进格子，恰好长得像转义序列的片段被忠实地当指令执行——乱码不是故障，是状态机在正确地执行垃圾输入。

你带走了四块新积木：VT 转义序列、网格与单元格、TermMode 位域、damage 追踪。下一站：这些字节在进入状态机之前，还有一段从 shell 到终端的跨线程旅程（第 3 章）。

### 自查

1. 程序发来 `\x1b[1;31m`（两个 SGR 参数一次到达），模板与屏幕各发生什么？
2. 若把 is_damaged 的判断从 `left <= right` 改成 `left < right`，哪一类损坏会被漏报？提示：单格修改时 left 与 right 的关系。
3. 程序先后发 `\x1b[?2031h`、`\x1b[?2031h`、`\x1b[?2031l`，此刻终端主题翻转，程序会收到应答字节吗？

<details>
<summary>参考答案</summary>

1. 模板同时置 BOLD 标志与红前景（SGR 参数逐个处理）；屏幕无变化——SGR 只改模板，格子与 damage 都没动。
2. 单格损坏：damage_point 记 column 到 column，left == right；严格小于会把它判成未损坏，单格修改全部漏报。
3. 不会。两次 h 幂等置位、一次 l 清位，contains(COLOR_SCHEME_UPDATES) 为假，report_color_scheme 直接返回。

</details>
