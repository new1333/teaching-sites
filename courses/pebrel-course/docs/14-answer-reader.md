---
title: 第 14 章 AI 回答阅读器：共享管线的复用范式
---

# AI 回答阅读器：共享管线的复用范式

这是靠后的三个机制章之一，篇幅压着写。压缩的是铺陈，不是义务：每章仍要交付一个带得走的读码范式，并过本章的探针门槛。本章的范式，用来在陌生代码里识别复用结构——分清「调用同一个入口」与「把实现抄了一份」，并顺着调用链拿出证据。

## 工具箱

本章调用的旧积木三块。**排版编译管线**——TeX 公式的唯一编译入口，parse → validate → layout → compile 产后端无关的布局结果，与窗口系统无关（第 13 章）。**共享常量合同**——最小可读字号这类常量在两条渲染路径间共用，保证回退判定一致（第 13 章）。**GPUI Entity**——实体持状态、Context 提供订阅与更新入口，看到 `.update()` / `cx` 就是在操作实体（第 5 章）。三块在手，一条「没有 WebView 的文档阅读器」能从载荷走到像素。

## 滚出网格的回答，去哪了

在终端里跑一轮 Claude，长回答从网格上滚过去：正文、公式、图片引用混在一屏里，想再读一遍只能翻回滚缓冲区。这些回答值得被当成一篇文档留下来——字号放大、公式排成版、原文可复制。多数桌面应用对这个需求的答案是嵌一个浏览器内核去加载 markdown 渲染库。Pebrel 的答案是三件原生的事。第一件，回答捕获：把 CLI 交出的完整回答原文接住。第二件，文档 tab：让一页文档与终端 tab 并列存在。第三件，复用：公式渲染不另写一套，走终端里已经在跑的那条编译管线。

本章拆这条链，顺路证伪三个直觉：阅读器等于嵌一个浏览器；复用就是复制粘贴代码；文本模型需要感知 markdown 语法之外的东西。

## 原理：从载荷到一页文档

### 回答捕获：在信封解析处接住原文

先排除一个想象：回答不是从屏幕上抠下来的。网格上确实有这段文字，屏幕证据那层回退（第 10 章）也确实从网格读状态——但它读的是「状态」，给的是没有钩子的 CLI 用的，从来不当「原文」的来源。回答原文只在一个地方完整存在：CLI 钩子事件的载荷里。所以捕获点不在渲染层，而在载荷被解析成事件对象的那一行：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ai_hook/protocol.rs
    let answer = crate::assistant_answer::AssistantAnswer::from_hook(&source, &payload);
```

（引用依 GPL-3.0 授权，署名与许可集中声明于 about 页，本章首处引用提示一次，后不重复。）载荷经命名管道桥——CLI 侧钩子写管道、宿主读出（第 8 章）——进宿主，在这条解析函数里被归一成类型化事件，即异构载荷折成一种带类型的事件对象（第 9 章）。回答就挂在事件上，随事件流进 UI。from_hook 本身只干一件事：按 CLI 与事件名查一个字段名，把字段值装进一个三态信封。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/assistant_answer.rs
pub const MAX_ANSWER_BYTES: usize = 128 * 1024;

#[derive(Clone, PartialEq, Eq, Hash)]
pub enum AssistantAnswer {
    Complete(Arc<str>),
    Missing,
    TooLarge { bytes: usize },
}

impl AssistantAnswer {
    pub fn from_hook(source: &str, payload: &Value) -> Option<Self> {
        let field = match source {
            "claude" if payload.get("hook_event_name")?.as_str()? == "Stop" => {
                "last_assistant_message"
            },
            "codex" if payload.get("hook_event_name").and_then(Value::as_str) == Some("Stop") => {
                "last_assistant_message"
            },
            "codex"
                if payload.get("type").and_then(Value::as_str) == Some("agent-turn-complete") =>
            {
                "last-assistant-message"
            },
            _ => return None,
        };
        Some(match payload.get(field).and_then(Value::as_str) {
            Some(text) if text.len() > MAX_ANSWER_BYTES => Self::TooLarge { bytes: text.len() },
            Some(text) if !text.trim().is_empty() => Self::Complete(Arc::from(text)),
            _ => Self::Missing,
        })
    }
```

**回答捕获**——把 AI CLI 交出的完整回答原文接住、存为可打开文档的行为——之所以落在三个状态而不是一个 Option 上，是因为「没收到」和「收到了但拿不动」对用户是两句话。Missing 的提示是「未收到完整回答原文；保留终端内容，不从屏幕猜测」；TooLarge 的提示是「回答原文共 N 字节，超过 128 KiB 阅读上限；未截断渲染，请在终端查看」。超限不截断是有意的：把一个 200 KiB 的回答从中间切开，公式会碎成半截，宁可让用户回终端看整份。反事实检验一下三态的必要性：若折叠成一个 None，这两条提示写不出来，前端只能统一显示「无回答」，用户分不清该等、该回终端、还是该重问。`Arc<str>` 让原文在事件、收件箱与阅读器之间传递时零拷贝共享。

查表那栏还有个容易讲错的细节：claude 的 Stop 与 codex 的 Stop 读 `last_assistant_message`（下划线），codex 的 `agent-turn-complete` 读 `last-assistant-message`（连字符）。两个 CLI、三种事件形状，折叠成三行；字段不存在的其余事件一律返回 None——这个事件干脆不携带回答，不给「猜」留门。

### 收件与打开：inbox、latest、AnswerReader

捕获之后，原文去哪。每个终端视图持有一个 AnswerInbox，事件到达时先过四道闸门：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/assistant_answer.rs
    pub fn observe(&mut self, event: &crate::ai_hook::AiHookEvent, pane_id: u64) -> bool {
        use crate::ai_hook::AiHookKind;

        if event.pane != Some(pane_id)
            || !matches!(event.source.as_str(), "claude" | "codex")
            || event.received_sequence <= self.last_sequence
        {
            return false;
        }
        let Some(session_id) = event.session_id.as_deref().filter(|id| !id.is_empty()) else {
            return false;
        };
        let identity = (event.source.clone(), session_id.to_owned());
```

pane 号对得上、来源是两家 CLI 之一、序号比上次新、会话身份非空。此后只有会话主人（或一个新会话的开始事件）才能更新 `latest`。绑定到 pane 而不是全局，是因为两个 pane 可以各跑一个会话——全局「最新回答」会把 A pane 的回答塞进 B pane 的阅读器。终端视图在事件处理里调它（`self.answers.observe(event, self.pane_id)`），且只在本地 pane 上发布，SSH 远端 pane 不参与。

打开侧的机制链在 terminal/view.rs：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/terminal/view.rs
    fn open_answer(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(snapshot) = self.answers.latest.clone() else { return };
        let reader = cx.new(|cx| super::answer_reader::AnswerReader::new(snapshot, cx));
        if self.agent_activity.status() == crate::ai_agents::AgentStatus::Blocked {
            reader.update(cx, |reader, cx| reader.needs_attention(cx));
        }
        cx.subscribe_in(
            &reader,
            window,
            |view, _, _: &super::answer_reader::ReaderEvent, window, cx| {
                view.answer_reader = None;
                window.focus(&view.focus_handle, cx);
                cx.notify();
            },
        )
        .detach();
```

取 `answers.latest`，用 GPUI Entity 的标准姿势造一个 AnswerReader 实体（第 5 章），订阅它的 Close 事件把自己清空并回焦。阅读器打开后，整个 pane 的渲染为之让位——Render 实现的第一行就是短路：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/terminal/view.rs
        if let Some(reader) = &self.answer_reader {
            return div().size_full().child(reader.clone()).into_any_element();
        }
```

这里要如实交代一件事：在课程锁定的提交上，`open_answer` 在全仓库恰好出现一处——它自己的定义。没有任何键位、菜单或命令调用它。机制链（捕获 → inbox → latest → AnswerReader → 整 pane 替换）完整存在，inbox 的绑定规则与三态判定都有单元测试覆盖；缺的是最后一根触发接线。所以本章讲的是一条已经建好、等待接线的链，不是一个已经能按出来的功能。

### 阅读器与文档 tab：一份与渲染器无关的文本模型

AnswerReader 自己不排版公式，也不解析 markdown 以外的东西。构造时它把文本整理丢到后台线程：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/terminal/answer_reader.rs
        if let Some(source) = source {
            cx.spawn(async move |reader, cx| {
                let document = cx.background_spawn(async move { document::prepare(&source) }).await;
                let _ = reader.update(cx, |reader, cx| reader.prepared(document, cx));
            })
            .detach();
        }
```

prepare 做的是纯文本整理：把 `\( \)` 与 `\[ \]` 分隔符归一成 `$ $` 与 `$$`、转义金钱符号、把图片引用换成显式占位块（网络图源不自动下载）。渲染正反两态各持一个组件库 TextView 状态——`TextViewState::markdown("", cx)` 在代码里恰好出现两次。它对 markdown 语法的全部感知是两个开关：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/assistant_answer/document.rs
fn parse_options() -> ParseOptions {
    let mut options = ParseOptions::gfm();
    options.constructs.math_flow = true;
    options.constructs.math_text = true;
    options
}
```

GFM 基线加公式节点的两个开关，仅此而已。第三个直觉在这里被证伪。公道话先说：渲染一篇带公式的文档，直觉上确实像需要「懂公式」的文本模型——公式要量宽、要缩号、要回退，这些像文本层的事。但看仓库自己的分层声明：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/markdown/mod.rs
//! Self-contained Markdown document model. This module owns ONLY parsing and
//! the parsed representation — no rendering, no Display state, no UI types.
//! The viewer that draws these values lives in `display::markdown_view`.
```

这个模块只拥有解析与解析结果——没有渲染、没有 Display 状态、没有 UI 类型；绘制方另住一处。解析产出纯数据，量宽缩号回退都在渲染侧，文本模型不需要为此知道任何额外的事。

文档 tab 那一侧把同一个判断走得更彻底。先看 tab 的家：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/workspace.rs
    /// 只读图片查看 tab（文件树双击图片进入；旧壳 open_image_tab 同形态）。
    Image {
        view: Entity<crate::gpui_shell::doc_tabs::ImageTabView>,
    },
    /// Markdown/文本文档 tab（文件树双击可读文本进入；旧壳 doc tab 同形态）。
    Document {
        view: Entity<crate::gpui_shell::doc_tabs::DocTabView>,
        _subscription: Subscription,
    },
    /// 源码查看 tab（tree-sitter 高亮 + 行级虚拟化，只读）。
    Code {
        view: Entity<crate::gpui_shell::code_tab::CodeTabView>,
        _subscription: Subscription,
    },
}
```

枚举叫 WorkspaceTab，完整五个变体按序是 Terminal、Settings、Image、Document、Code——探针逐个数过。文档 tab 模型指的是这一层的东西：与终端 tab 在同一枚举里并列的 Document 变体，加上 text_document 维护的那份文本快照。它不是另一棵窗口树，也不自带渲染器。要说清的一点差别：阅读器不是文档 tab——它整个替换所在 pane，而文档 tab 是工作区层的并列变体——但两者共用同一条形态法则：原生渲染，文本模型不越界。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/text_document.rs
//! Renderer-independent text snapshots shared by local and SFTP documents.

use std::io;
use std::sync::Arc;

pub(crate) const MAX_BYTES: usize = 8 * 1024 * 1024;

#[derive(Clone, Debug)]
pub(crate) struct TextSnapshot {
    pub text: String,
    pub bytes: Arc<[u8]>,
    pub bom: bool,
    pub crlf: bool,
    pub truncated: bool,
    pub invalid_encoding: bool,
    pub read_only: bool,
}
```

头注释一句话说完立场：与渲染器无关、本地与 SFTP 共享。8 MiB 上限之外，decode 的收尾一行把 truncated 与 invalid_encoding 一并折进 read_only，写法是 `read_only: read_only || truncated || invalid_encoding`。超限或含二进制字节的快照永远不可编辑。防的是半份文件被当成完整文件改了再存。全仓库 `use crate::text_document` 恰好四处。本地侧是 file_editor/document.rs 与 file_editor/source.rs。远端侧是 ssh_sftp/document.rs 与 ssh_sftp/transaction.rs。一份模型，两条后端路径——这是本章的第二个复用结构，判定方法与公式管线完全同构，下一节给方法。文档 tab 的入口路由是三条只读查看器的前缀判断，即 image_viewer、markdown_view、code_tab 各自的 `viewable_file`。视图类型 DocTabView 则是 file_editor 里 TextFileView 的重导出，同一形态两个名字。

### 一条编译入口，两个调用方，零份拷贝

现在是全章主线：阅读器的公式从哪来。先给反面证据——阅读器模块自己不写一行排版代码。answer_reader.rs 与 assistant_answer/document.rs 全文里，`compile_formula`、`parse_formula`、`crate::math`、`rasteriz` 四个 token 的命中数是 0。那公式怎么渲染？走一根注册进组件库的钩子。壳初始化时的接线只有两行。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/mod.rs
    // TextView 的公式渲染钩子：旧壳数学管线（compile → 栅格化）接入组件库
    // 的 markdown 渲染；不注册时公式回退为源码文本。
    math_view::register(cx);
```

register 把一个闭包交给组件库的 TextView。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/math_view.rs
/// 注册 TextView 的公式渲染器；`gpui_shell::init` 调用一次。
pub fn register(cx: &mut App) {
    scientific_render::init(cx);
    cx.set_global(MathAssets::new(scientific_render::assets(cx)));
    gpui_component::text::set_math_renderer(cx, |spec, window, cx| {
        let assets = source_assets(cx);
        // 探针编译：失败的公式仍是文档文本，交回组件库按代码样式排版。
        assets.layout(&spec.source, spec.display, PROBE_PX, 1.0)?;
```

闭包先做一次探针编译。这条公式编不过（解析错、超预算）就返回 None，组件库把它当普通代码文本排版——失败不炸阅读器，只降级。编得过，就经 MathAssets::layout 转交共享引擎。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/math_view.rs
        self.engine.layout(FormulaKey::new(
            source.clone(),
            display,
            self.verbatim_source,
            pixel_size,
            pixels_per_point,
        ))
```

engine 是 ScientificRender。它的后台 Job 在分发处碰到本章要害的那一行。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/scientific_render.rs
            Key::Layout(key) => {
                let compile = if key.verbatim { compile_formula_source } else { compile_formula };
                compile(
                    &key.source,
                    key.display,
                    f32::from_bits(key.size),
                    f32::from_bits(key.points),
                    DEFAULT_LIMITS,
                )
                .map(|layout| Resource::Layout(Arc::new(layout)))
                .unwrap_or(Resource::Failed)
            },
```

import 行是 `use crate::math::{DEFAULT_LIMITS, compile_formula, compile_formula_source};`——两个编译入口都来自那条排版编译管线（第 13 章）。整条链读下来：AnswerReader 的 TextView 撞见公式节点，公式交给 math_view::register 装上的渲染闭包。闭包探针编译后经 MathAssets::layout 转交引擎。ScientificRender 的 Job 分发处，`compile_formula` 与 `compile_formula_source` 二选一。这就是「排版编译管线入口在阅读器路径被复用」的落点：阅读器经钩子间接调用，终端覆盖层直接调用，同一个入口，零份拷贝。

链条的第二个调用方在文档 tab 侧。绘制方 display/markdown_view.rs，正是 markdown/mod.rs 头注释指过去的位置。它的非测试代码里，`compile_formula(` 恰好两处，第一处在量测：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/display/markdown_view.rs
fn measure_math(
    source: MathSource,
    formula_id: u64,
    pixel_size: f32,
    pixels_per_point: f32,
    display: bool,
    cache: &mut MathLayoutCache,
) -> Option<MathRun> {
    let key = FormulaCacheKey::new(formula_id, pixel_size, pixels_per_point, display);
    let layout = cache
        .get_or_insert_with(key, || {
            compile_formula(source.as_str(), display, pixel_size, pixels_per_point, DEFAULT_LIMITS)
        })
        .ok()?;
```

第二处在绘制期的缓存回填，同样以 DEFAULT_LIMITS 收参。文档 tab 渲染器直接两处，加阅读器的钩子一处，三个调用面，一个入口。

共享常量合同在这条链上被真实调用。math_view.rs 的 fit() 负责把超宽公式线性缩字号，缩过头就放弃：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/math_view.rs
    /// 旧壳 `fit_math_run` 的等价物：超宽公式按线性比例缩字号，缩到
    /// [`MIN_READABLE_MATH_PX`] 之下就放弃（调用方回退源码文本）。
    fn fit(
        &mut self,
        source: &SharedString,
        display: bool,
        pixel_size: f32,
        pixels_per_point: f32,
        max_width: f32,
    ) -> Option<(Arc<MathLayout>, f32)> {
        let base = self.layout(source, display, pixel_size, pixels_per_point)?;
        if base.metrics.width <= max_width {
            return Some((base, pixel_size));
        }
        let fitted_size = pixel_size * (max_width / base.metrics.width) * FIT_MARGIN;
        if fitted_size < MIN_READABLE_MATH_PX {
            return None;
        }
        let fitted = self.layout(source, display, fitted_size, pixels_per_point)?;
        (fitted.metrics.width <= max_width).then_some((fitted, fitted_size))
    }
```

`MIN_READABLE_MATH_PX` 从 `crate::math` import，不在阅读器侧重定义。最小可读字号是两条路径共用的判定。缩到线以下的公式，终端覆盖层与阅读器一起回退源码文本。这份合同在 math_view.rs 头注释里写成一句子：失败合同与旧壳一致，编译失败、超预算、缩到最小可读字号之下的公式回退为源码文本。

### 复用与复制的成本对账

第二个直觉「复用就是复制粘贴」到这里可以正式算账。复制方案的成本：公式编译代码在阅读器侧再出现一份，token 命中从 0 变成一串；最小可读字号要重抄一个数值，上游改一处、这边忘一处；失败合同要重写一遍，语义漂移没人兜底；上游管线修一个解析 bug，抄走的那份照旧带病。复用方案的成本：一次函数调用，加一根必须注册的钩子。判定方法是机械的，四步：

1. 找被复用方的入口符号——这里是 `crate::math` 的 `compile_formula` 与 `compile_formula_source`。
2. 数消费方对入口的非测试调用点——阅读器经钩子间接一处，文档 tab 渲染器直接两处。
3. 在消费方全文搜管线同义 token——复用的判据：调用点大于 0，自带实现 token 等于 0。
4. 查共享常量是 import 还是重定义——import 是共用合同，重定义是分叉的开始。

第一个直觉留在这里一起收掉：「阅读器等于嵌一个浏览器」。全仓库扫 `webview`、`wry`、`webview2`、`cef`、`electron` 五个 token，nebula_app/src 的全部 .rs 文件加根与应用两份 Cargo.toml，命中数是 0。这是依赖清单层面的事实：阅读器是 GPUI 原生渲染，公式位图由共享管线合成后 `window.paint_image` 上屏，图片只解本地 PNG / JPEG。而且真走了 WebView，128 KiB 三态、8 MiB 只读折叠、图片不自动拉取这些边界合同就得在脚本层重造一遍。

组装式点名一次：排版编译管线 + 共享常量合同 + GPUI Entity，加上本章新增的捕获信封与文本模型，拼出「无 WebView 的回答阅读器」这块新能力。

## 演练：把范式跑两遍

视野章的最低义务是交一个可迁移的读码范式，现在在两个结构上各跑一遍。

结构一，公式管线。入口符号 `crate::math::compile_formula`。调用面三个：math_view 钩子（间接，经 set_math_renderer 的闭包）、display/markdown_view.rs 两处直接调用。消费方 answer_reader.rs 的管线 token 数 0。共享常量 `MIN_READABLE_MATH_PX` import 自 crate::math。结论：调用同一个入口，复用。

结构二，TextSnapshot。入口符号 `crate::text_document::TextSnapshot`。调用面四处：file_editor 两处（本地文件）、ssh_sftp 两处（远端文件）。任何一侧都没有自造一份快照结构，8 MiB 上限常量也只有 text_document 一处定义。结论：一份模型两条后端，复用。

两趟走完，范式收敛成一句话：复用的证据在消费方的「零」里——零份实现、零个重定义常量；复制的证据在消费方的「多」里——多出一串 token、多出一个分叉数值。以后读到「X 复用了 Y」的说法，先问这两个数。

## 验证：先猜后跑

三步，都在你手里。

第一步，探针。到 companion 目录运行 `node scripts/probe-14-answer-reader.mjs`。跑之前写下四个离散预测：WorkspaceTab 的变体数；display/markdown_view.rs 的非测试 `compile_formula(` 调用点数；阅读器两个模块里的 TeX 管线 token 数；全仓库 WebView 类 token 数。跑完对照——应看到 5、2、0、0，共 20 条检查全绿。哪个预测落空，回到对应小节找原因。

第二步，纸面判态。三份载荷，先在纸上写出 from_hook 各返回什么（四选一：Complete、Missing、TooLarge、None）：

- claude，`hook_event_name` 为 `Stop`，载荷没有 `last_assistant_message` 字段；
- claude，`hook_event_name` 为 `Notification`，`last_assistant_message` 有值；
- codex，`type` 为 `agent-turn-complete`，`last-assistant-message` 是 131073 个字符的文本。

写完展开锁定测试核对。注意它怎么把「字段名拼写写错」也钉进 Missing：

<details>
<summary>assistant_answer.rs · 字段错拼与事件不符的判定（锁定原文节选）</summary>

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/assistant_answer.rs
        assert_eq!(
            AssistantAnswer::from_hook(
                "claude",
                &json!({"hook_event_name": "Stop", "last-assistant-message": "wrong"})
            ),
            Some(AssistantAnswer::Missing)
        );
        assert_eq!(
            AssistantAnswer::from_hook(
                "codex",
                &json!({"type": "agent-turn-complete", "last_assistant_message": "wrong"})
            ),
            Some(AssistantAnswer::Missing)
        );
        assert!(
            AssistantAnswer::from_hook(
                "claude",
                &json!({"hook_event_name": "Notification", "last_assistant_message": "wrong"})
            )
            .is_none()
        );
```

</details>

第三步，接线事实与定向破坏。先猜后跑：在 .course/repo（锁定 clone，普通 git 检出）里执行 `grep -rn "open_answer" --include="*.rs" .`，预测命中数——应为恰好 1 处，且是定义本身；这一眼就是「触发接线未完成」的全部证据。然后定向破坏：把 nebula_app/src/display/markdown_view.rs 里 measure_math 的 `compile_formula(` 改名成 `compile_formula_disabled(`，模拟「复制实现」把入口撕走一个调用点。先预言再重跑探针：应看到恰好 1 条检查由绿转红——「恰好 2 处非测试调用点」那条，报实测 1 处；阅读器侧的零 token 检查照绿，因为阅读器本不经手编译。改回那一行（或 `git checkout -- nebula_app/src/display/markdown_view.rs`）重跑，确认 20/20 复原。这条检查守的是「文档 tab 渲染器与终端覆盖层同一入口」——撕掉一个调用点，守卫立刻叫；而它叫的方式恰好演示了复用判定第 3 步：数调用点。

三步做完，本章结论与你的观察对上：复用是可数的，接线是如实的。

## 自查：换一个输入

1. codex 某天把 `agent-turn-complete` 的字段改回下划线拼写，捕获链会发生什么？用户会看到哪条提示，哪条提示不会出现？
2. 给你一个陌生仓库，宣称「设置页复用了主窗口的渲染管线」，四步判定的前三步分别查什么？
3. AnswerInbox 为什么绑 pane 加会话身份，而不是全局存「最新一条回答」？错绑的具体症状是什么？
4. 删掉 parse_options 里 `math_text = true` 这一行，阅读器里的行内公式会怎样？排版编译管线本身受损吗？

::: details 参考答案
1. from_hook 的查表落空，返回 None——这个事件不再携带回答，inbox 不更新。用户不会看到任何提示，连 Missing 的提示都不会有，因为捕获根本没有发生（回查「回答捕获」一节的三行查表）。
2. 找主窗口渲染的入口符号；数设置页对入口的非测试调用点；在设置页全文搜管线同义 token——调用点大于 0 且自带实现 token 等于 0 才谈得上复用（回查「复用与复制的成本对账」）。
3. 两个 pane 各跑一个会话时，全局最新会把 A pane 的回答开进 B pane 的阅读器。绑定 `(source, session_id)` 身份加序号闸门后，跨 pane、跨会话、过期的事件都进不了 latest；症状是「打开的回答不属于这个终端」。
4. 行内公式不再被解析成 math 节点，`$x^2$` 按普通文本渲染，美元符号原样可见；`$$` 块走 math_flow 开关，不受影响。管线无损——入口仍在等 math 节点，只是没人再把行内式递过去。
:::

## 收束

开篇的问题现在可以整段回答。滚出网格的回答没有丢。CLI 在回合结束时经钩子把完整原文随载荷交出，宿主在信封解析处用 from_hook 把它装进三态信封。完整的进 Complete，缺席是 Missing，超 128 KiB 报 TooLarge 且不截断。inbox 按 pane 与会话身份收件，latest 上的快照随时可以变成一个 AnswerReader 实体，整个 pane 的渲染为之让位。它读起来像一篇文档，靠的是 TextView 的 markdown 渲染加后台归一的文本；公式高亮不另起炉灶，靠的是钩子把公式递给排版编译管线（第 13 章）——同一个入口、同一份常量合同、零份拷贝。文档 tab 那一侧同构：一份 TextSnapshot，本地与 SFTP 两条后端共用。

本章交给你三块新积木。回答捕获：hook 载荷 → 三态信封 → pane 会话收件。文档 tab 模型：WorkspaceTab 的 Document 变体，加与渲染器无关的 TextSnapshot。管线复用结构：识别「共用入口」与「复制实现」的四步判别法。两个易错点带走：open_answer 在锁定提交上还没有触发接线，别把机制链说成已上线的功能；阅读器自己不含一行 TeX 代码——复用的证据恰恰是那串 0。下一站看补全引擎的抽取（第 15 章），全书能力对账归终章（第 16 章）。
