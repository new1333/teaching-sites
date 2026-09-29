---
title: 第 15 章 独立补全引擎：从 Nushell 抽出的零 UI crate
---

# 独立补全引擎：从 Nushell 抽出的零 UI crate

视野章声明：本书靠后的三个机制章按「机制故事 + 接缝识别」压缩篇幅，每章至少教会一个可迁移的读码范式并过各自的探针门槛。本章的范式是：读任何补全、匹配类的代码，先找接缝——谁产候选、谁管排序；再看依赖面——它有没有资格独立成一个 crate。

## 工具箱

本章调用的旧积木两块。**所有权地图**——判断一段代码落在哪个 crate、禁区是什么的权威查表入口（[第 1 章](./01-repo-map.md)）。**crate 依赖方向**——core 与 domain 的 crate 不依赖 UI 和平台能力，依赖只能由外向内（[第 1 章](./01-repo-map.md)）。这两块在手，「这段补全代码凭什么自己成一个 crate」就有了判据，而不是凭感觉。

## 钩子：排序器不认识「命令」

在 Pebrel 的命令面板里敲两三个字母，弹出的候选列表第一条，常常是一条相当长的命令；在终端里敲半个路径，剩下的目录名自己冒出来。多数人会下意识认为：补全器「认识」命令和路径，所以才挑得准。

把排序那层代码翻开，这个印象撑不住。排序器从头到尾没见过一个「命令」，它见到的是字符串、分数，和一次 trait 调用。三个字母与一条长命令之间发生了什么，就是本章要拆的两件事：补全源如何穿过一个接缝交出候选，模糊匹配又如何用分数决定座次。

## 原理：接缝长什么样

### 签名里没有 shell

先做反事实：如果没有任何统一接缝，宿主要接三种补全源，就得认识三种具体类型，每加一种源就多一层 if；源想换个宿主，就得连宿主类型一起搬。接缝的存在，是为了让「产候选」这件事有唯一合同。

这块合同叫 **Completer trait 接缝**——实现它，就能把一个新补全源注入引擎，而宿主只认这一个类型。合同全文如下（引用依 GPL-3.0 授权，署名与许可集中声明于 about 页，本章首处引用提示一次，后不重复）：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula-completions/src/completer.rs
/// Trait for types that can produce completion suggestions.
pub trait Completer {
    /// Fetch, filter, and sort completions for the given `prefix`.
    ///
    /// * `cwd` — Current working directory (used by file-based completers).
    /// * `prefix` — The partial text the user has typed.
    /// * `span` — The span in the original input that `prefix` covers.
    /// * `offset` — Offset of the span relative to the start of the line
    ///   (for adjusting span values in suggestions).
    /// * `options` — Matching / sorting configuration.
    fn fetch(
        &mut self,
        cwd: &str,
        prefix: impl AsRef<str>,
        span: Span,
        offset: usize,
        options: &CompletionOptions,
    ) -> Vec<SemanticSuggestion>;
}
```

五个参数逐个说人话：`cwd` 是当前目录（给要读文件系统的源用）；`prefix` 是用户敲了一半的字；`span` 标记这段前缀在输入里的范围；`offset` 是这个范围相对行首的偏移，源要用它把建议里的替换范围换算回行坐标；`options` 是匹配与排序的配置。返回值 `Vec<SemanticSuggestion>` 是纯数据——文本、可选的类型标注、命中下标。

现在检验本章要证伪的第一个直觉：「补全逻辑必须知道 shell 语义才能工作」。先替它说句公道话：在 bash 的 `compgen` 或 zsh 的补全系统里，补全函数确实解析命令行、区分参数位置，Nushell 自己的补全框架也解析语法树——在那类系统里，这个直觉是对的。但看这份签名：没有 shell 类型、没有语法树、没有「参数位置」，连终端类型都没有。shell 感知没有被删掉，而是被推到了接缝之外——住在调用方 `nebula_app` 里：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/display/command_completion.rs
pub(crate) fn nebula_is_command_position(line: &str) -> bool {
    !line.contains([' ', '\t'])
        && !line.contains(['/', '\\'])
        && line.as_bytes().get(1) != Some(&b':')
}

pub(crate) fn nebula_path_wants_directory(line: &str) -> bool {
    let command = line.split([' ', '\t']).next().unwrap_or("");
    matches!(
        command.to_ascii_lowercase().as_str(),
        "cd" | "chdir" | "pushd" | "sl" | "set-location"
    )
}
```

「这行是不是命令位置」「`cd` 之后是不是该补目录」——这些 shell 知识全在宿主侧函数里。引擎收到的只是算好的结论：一个布尔、一个前缀。另一个引擎入口 `CommandQuery` 的文档注释写得更直白：标点按字面处理，shell 标志不会变成搜索操作符。引擎对 shell 一无所知，照样工作。

### 三个内置源，两种接入形态

crate 自述（`nebula-completions/src/lib.rs`）说它 Extracted from Nushell's ``nu-cli`` completions framework，内置补全覆盖文件、目录与静态字符串列表。读代码会发现一个容易讲错的细节：三个内置源，只有两个是 trait 实现。

- `DirectoryCompletion`（目录源）与 `StaticCompletion`（静态列表源）以 `impl Completer` 的形态存在，藏在私有模块里，经 `pub use` 对外出口；
- 文件源根本不是 trait 实现，它是一个公共函数 `pub fn complete_item(...) -> Vec<FileSuggestion>` 的函数面，模块声明是 `pub mod file`——函数直接对外。

目录源的 `fetch` 内部委托这个函数面：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula-completions/src/directory.rs
impl Completer for DirectoryCompletion {
    fn fetch(
        &mut self,
        cwd: &str,
        prefix: impl AsRef<str>,
        span: Span,
        offset: usize,
        options: &CompletionOptions,
    ) -> Vec<SemanticSuggestion> {
        let prefix = prefix.as_ref();

        let items = complete_item(true, span, prefix, &[cwd], options, true, None);

        let current_span =
            Span::new(span.start.saturating_sub(offset), span.end.saturating_sub(offset));
```

静态列表源则走另一条更短的路——直接把匹配排序委托给引擎（28 行，点击展开）。

<details>
<summary>static_completion.rs · impl Completer for StaticCompletion</summary>

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula-completions/src/static_completion.rs
impl Completer for StaticCompletion {
    fn fetch(
        &mut self,
        _cwd: &str,
        prefix: impl AsRef<str>,
        span: Span,
        offset: usize,
        options: &CompletionOptions,
    ) -> Vec<SemanticSuggestion> {
        let mut matcher = CandidateMatcher::new(prefix, options, true);
        let current_span =
            Span::new(span.start.saturating_sub(offset), span.end.saturating_sub(offset));

        for option in self.options.iter() {
            matcher.add_suggestion(SemanticSuggestion {
                suggestion: Suggestion {
                    value: option.clone(),
                    span: current_span,
                    description: None,
                    ..Suggestion::default()
                },
                kind: Some(SuggestionKind::Value("string".to_string())),
            });
        }

        matcher.suggestion_results()
    }
}
```

</details>

把两条路对齐看：目录源的 `fetch` 经 `complete_item` 的递归内部，最终也建出同一个 `CandidateMatcher`；静态源则当场建它。全 crate 扫描 `impl Completer` 恰好两处，没有第三处。这就是本章的组装证据——**源只产候选，引擎统一匹配排序**。trait 是给宿主统一调度的接缝，函数面是被组合的机制件，两种形态都汇入同一个匹配引擎。

### 匹配三级，排序一层

第二个直觉：「匹配就是字符串前缀比较」。公道话：默认配置 `MatchAlgorithm::Prefix` 确实就是 `starts_with`，默认体验下直觉成立。边界在配置之后：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula-completions/src/options.rs
/// Algorithm used to match completions against the input prefix.
#[derive(Copy, Clone, Debug, PartialEq)]
pub enum MatchAlgorithm {
    /// Only show suggestions beginning with the input.
    ///
    /// Example: `"git switch"` is matched by `"git sw"`
    Prefix,

    /// Only show suggestions containing the input as a substring.
    ///
    /// Example: `"git checkout"` is matched by `"checkout"`
    Substring,

    /// Fuzzy matching — characters can appear anywhere, in order.
    ///
    /// Example: `"git checkout"` is matched by `"gco"`
    Fuzzy,
}
```

前两级是过滤：`gco` 在 Prefix 与 Substring 下都命中不了 `git checkout`。第三级允许跳字按序命中，代价是「命中」有了好坏之分——于是需要分数。引擎内部用两个状态把这件事分开：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula-completions/src/matcher.rs
/// Internal data for a fuzzy (scored) match.
struct FuzzyMatch<T> {
    item: T,
    haystack: String,
    score: u16,
    match_indices: Vec<usize>,
}

enum State<T> {
    Unscored(Vec<UnscoredMatch<T>>),
    Fuzzy { matcher: Matcher, atom: Atom, matches: Vec<FuzzyMatch<T>> },
}
```

Prefix 与 Substring 不打分（走 `Unscored`，自家 `starts_with` 与 `find`），只有 Fuzzy 进打分分支，分数是一个 `u16` 整数——排序语义全部建立在整数比较上，不涉浮点。打分由外部 crate `nucleo-matcher` 承担，并在默认配置上打开了 `prefer_prefix`：从第一个字符就命中的候选获得倾斜。排序那行是本章的事实锚点之一：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula-completions/src/matcher.rs
            State::Fuzzy { matches, .. } => match self.options.sort {
                crate::options::CompletionSort::Alphabetical => {
                    matches.sort_by(|a, b| a.haystack.cmp(&b.haystack));
                },
                crate::options::CompletionSort::Smart => {
                    matches.sort_by(|a, b| b.score.cmp(&a.score).then(a.haystack.cmp(&b.haystack)));
                },
            },
```

`CompletionSort` 默认字典序；选 Smart 时，分数降序，同分字典序。纸上跟算一遍（下面的锁定测试就是这么断言的）：查询 `fob`，候选 `fob`、`foo bar`、`foo/bar`。三条都能跳字命中；`fob` 本身连续完整命中，分数最优排第一；`foo bar` 压过 `foo/bar`——这两条无论分数有别还是同分进字典序（空格的编码值小于斜杠），顺序都一样。排序器给 `fob` 第一名，靠的是分数，不是「认识」这个词。

## 演练：零 UI 是编译事实，不是愿望

第三个直觉：「抽取成 crate 只是为了目录整洁」。公道话：把补全代码挪进单独文件夹确实让目录变整洁，这个观察没错；错在「只是」。crate 边界买到的是三样模块边界买不到的东西。

第一样：依赖面的编译器强制。看完整依赖表：

```toml
# Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula-completions/Cargo.toml
[features]
default = ["color"]
color = ["dep:nu-ansi-term", "dep:lscolors"]

[dependencies]
nucleo-matcher = "0.3"
unicase = "2.9"
unicode-segmentation = "1.13"
nu-ansi-term = { version = "0.50", optional = true, default-features = false }
lscolors = { version = "0.21", optional = true, default-features = false, features = ["nu-ansi-term"] }
```

依赖恰好五项：打分的 `nucleo-matcher`（版本行逐字为 `nucleo-matcher = "0.3"`，非 optional，无条件参与构建）、大小写折叠的 `unicase`、字素计数的 `unicode-segmentation`，以及两个可选的着色依赖。清单里没有 gpui，没有 ratatui、crossterm 任何 UI crate——想在源码里 import 一个窗口类型，编译不过，靠的不是自觉。唯一的终端耦合字段 `style` 也被特性门关住：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula-completions/src/suggestion.rs
    /// Indices in the displayed text that matched the query.
    pub match_indices: Option<Vec<usize>>,
    /// Styling for the suggestion.
    #[cfg(feature = "color")]
    pub style: Option<nu_ansi_term::Style>,
    /// The span in the input that this suggestion replaces.
    pub span: Span,
```

关掉 color 特性，`style` 字段在编译期直接不存在——这是编译期开关，不是运行时判空。顺带一个对照：这五项依赖全走语义化版本号，不像 GPUI 那样钉在自有 fork 的 40 位 SHA 上；SHA 钉版服务于「分叉过、必须锁基线」的依赖，这里五个都是上游常规发布，用不上那套手段。

第二样：架构合同的位置背书。所有权地图给这一行写了两栏合同。owns 栏是「Completion matching and presentation-independent results」；must-not-become 栏是「Terminal view ownership」。依赖清单把它登记在 core 层，被 `nebula_app` 以路径依赖消费。换句话说：匹配与「和展示无关的结果」归它，拥有终端视图是被明文写下的禁区。这正是 crate 依赖方向那块积木的用法——先看 crate 归属与层级，再读模块。

第三样：真实的复用面。宿主 `nebula_app` 里至少五处直接消费这个 crate——命令面板、命令管理器、历史搜索、命令补全、建议引擎。建议引擎的模块注释写明了用意：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/display/suggest_engine.rs
//! 补全/建议引擎：ghost 余量与弹窗候选的计算核心。
//!
//! 从 `Display` 的方法下沉为自由函数：winit 壳把 `Display` 字段借成
//! [`SuggestSources`]，GPUI 壳借进程级单例（`gpui_shell::terminal::suggest`）。
//! 数据源与排序规则两个壳共用，避免第二套平行实现（与 `ssh_session` 的
//! `SshEventHost` 泛型下沉同一手法）。
```

按 `nebula_app/Cargo.toml` 的注释，正式产品只有 GPUI 壳，旧 winit 壳是显式请求才编译的遗留路径；这条注释写于两个壳并存的语境，要点在最后一句——数据源与排序规则共用，避免第二套平行实现。连排序层的测试都是从 Nushell 移植来的。测试注释原话：ported from nushell `completion_options.rs`, all names stripped。搬家时把验收一起带走——这是「抽取」与「复制」的差别。

组装式点名：所有权地图查合同行，crate 依赖方向核层级，加上本章的接缝识别。由此得到的新能力是——对任何仓库里的补全、匹配代码，能判定「这段能不能抽成零 UI 的独立 crate」，并能指出证据该去哪找（依赖面、特性门、消费点）。

### 承重练习：一个 git 分支补全源

目标：给终端加一个假想的 git 分支补全源。接缝已经把答案限定死了——需要实现的方法只有一个：`fetch`，返回 `Vec<SemanticSuggestion>`。示范如下：

```rust
// 用法示例：假想的 git 分支补全源（教学示例，不在锁定仓库中）
use nebula_completions::matcher::CandidateMatcher;
use nebula_completions::{
    Completer, CompletionOptions, SemanticSuggestion, Span, Suggestion, SuggestionKind,
};

pub struct GitBranchCompletion;

impl Completer for GitBranchCompletion {
    fn fetch(
        &mut self,
        cwd: &str,
        prefix: impl AsRef<str>,
        span: Span,
        offset: usize,
        options: &CompletionOptions,
    ) -> Vec<SemanticSuggestion> {
        let output = std::process::Command::new("git")
            .args(["branch", "--format=%(refname:short)"])
            .current_dir(cwd)
            .output();
        let Ok(output) = output else { return Vec::new() };
        let text = String::from_utf8_lossy(&output.stdout);

        let mut matcher = CandidateMatcher::new(prefix, options, true);
        let current_span =
            Span::new(span.start.saturating_sub(offset), span.end.saturating_sub(offset));
        for branch in text.lines().map(str::trim) {
            if branch.is_empty() {
                continue;
            }
            matcher.add_suggestion(SemanticSuggestion {
                suggestion: Suggestion {
                    value: branch.to_string(),
                    span: current_span,
                    ..Suggestion::default()
                },
                kind: Some(SuggestionKind::Value("branch".to_string())),
            });
        }
        matcher.suggestion_results()
    }
}
```

结构与静态列表源同构：`git` 子进程在 `cwd` 里列出分支（这正是 `fetch` 收 `cwd` 的意义），每条分支包成 `SemanticSuggestion` 喂给匹配器，匹配与排序仍委托同一个 `CandidateMatcher`——源只产候选。判定你写对了没有，用四条 prose 判据自查：其一，实现是否只依赖签名里那五个参数，没偷看任何 shell 或终端类型；其二，候选是否只是 `SemanticSuggestion` 的纯数据包装；其三，匹配排序是否交给引擎而不是自己写比较；其四，`git` 不存在或失败时是否安静返回空列表，而不是让宿主崩掉。

## 验证：先猜，再跑

三步，都在你手里完成。

第一步，探针先猜后跑。到 companion 目录运行 `node scripts/probe-15-completion-engine.mjs`。跑之前先写下两个离散预测：输出里「impl Completer 全 crate 扫描」的实测处数是多少；依赖项数是多少。跑完对照——应看到扫描恰好 2 处（`DirectoryCompletion`、`StaticCompletion`）、依赖恰好 5 项，共 31 条检查全绿。如果你的预测落了空，回到「三个内置源，两种接入形态」一节找原因。

第二步，纸面跟算。查询 `fob`，候选按写入顺序是 `foo/bar`、`fob`、`foo bar`。先按 Smart 规则（分数降序、同分字典序）在纸上写下你推出的最终顺序。然后展开下面的锁定测试核对（18 行）。

<details>
<summary>matcher.rs · fuzzy_sort_by_score（锁定原文）</summary>

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula-completions/src/matcher.rs
    #[test]
    fn fuzzy_sort_by_score() {
        let opts = CompletionOptions {
            match_algorithm: MatchAlgorithm::Fuzzy,
            sort: crate::options::CompletionSort::Smart,
            ..Default::default()
        };
        let mut m = CandidateMatcher::new("fob", &opts, true);
        for item in ["foo/bar", "fob", "foo bar"] {
            m.add(item, item);
        }
        let results = m.results();
        assert_eq!(3, results.len());
        // Best score first, alphabetical tie-break for equal scores
        assert_eq!("fob", results[0].0);
        assert_eq!("foo bar", results[1].0);
        assert_eq!("foo/bar", results[2].0);
    }
```

</details>

第三步，定向破坏。在你自己 clone 的 Pebrel 上（课程探针只读，不动仓库），把 `matcher.rs` 里 Smart 分支的 `b.score.cmp(&a.score)` 改成 `a.score.cmp(&b.score)`——分数升序。先写下预测再跑 `cargo test -p nebula-completions`：应看到恰好 3 条断言红，全部在 `fuzzy_sort_by_score` 里（三条顺序断言）；`assert_eq!(3, results.len())` 那条居然还绿——它守的是「过滤面」：命中了几条；分数方向只动排序，不动过滤。其余七条测试也全绿，因为 Prefix 与 Substring 走 `Unscored`，根本不经过分数。改回那一个比较方向，重跑确认复原。

三条做完，本章结论与你的观察对上了：接缝限定源的自由度，分数限定座次，两者都不需要认识「命令」。

## 自查：换一个输入

1. 把配置换成 `MatchAlgorithm::Substring` 后，`gco` 还能命中 `git checkout` 吗？为什么？
2. 你的 git 分支源想让宿主知道候选是「分支」而非普通字符串，动哪个字段、取值长什么样？
3. 宿主想让 `cd` 之后的路径补全只出目录，有哪两条路？分别动什么？
4. 文件源不实现 `Completer`，为什么照样算「内置源」？宿主直接调它的函数面时，损失了什么、换来了什么？

::: details 参考答案
1. 不能。Substring 要求输入作为连续子串出现，`gco` 不是 `git checkout` 的连续子串；只有 Fuzzy 允许跳字按序命中（回查「匹配三级，排序一层」）。
2. `kind` 字段，取 `Some(SuggestionKind::Value("branch".to_string()))` 一类的类型标注——纯数据，不含 UI。
3. 选内置的 `DirectoryCompletion`（trait 面）；或直接调 `complete_item` 并把第一个参数 `want_directory` 置真（函数面）。shell 语义（认出 `cd`）始终住在宿主侧，例如 `nebula_path_wants_directory`。
4. 因为「源」的本质是产候选的机制件；trait impl 是给宿主统一调度用的形态，函数面是被组合的机制形态（目录源就组合它）。直接调函数面损失统一调度与统一替换类型，换来不经过 trait 的直接控制——宿主的 `suggest_engine` 正是这么用 `complete_item` 的。
:::

## 收束

开篇的现象现在可以整段解释了。敲三个字母，长命令排在候选第一位：补全源穿过 Completer trait 接缝交出候选——它可能是一张静态列表、一次目录扫描或一次 `git` 调用；候选进入匹配引擎，Fuzzy 分支给每条算一个 `u16` 分数；Smart 排序按分数降序、同分字典序落座。这条因果链里没有任何一环见过「命令」，排序器认识的是字符串和分数——它不需要更多。本章交给你两块新积木：Completer trait 接缝（实现 `fetch` 即注入新源，输出与终端视图无关）、模糊匹配排序（三级匹配、Fuzzy 打分、分数降序加字典序）。两个易错点带走：文件源是 `complete_item` 函数面，别把三个内置源说成都实现了 trait；Prefix 与 Substring 不打分，Smart 只作用于 Fuzzy 分支。终章会把这块积木放回全书地图对账（[第 16 章](./16-review.md)）。

