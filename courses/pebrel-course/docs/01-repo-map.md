---
title: 第 1 章 仓库地图：九个 crate 与所有权合同
---

# 仓库地图：九个 crate 与所有权合同

## 从哪读起：703 个文件与两次撞墙

`git clone` 落地的那一刻，这个仓库递给你的是 703 个第一方 `.rs` 文件（`third_party/` 下 vendor 进来的 winit 源码还没算）。文件树按字母排序，`nebula_app` 之下再无导航。顺着目录一个一个读，是新读者在这里摔的第一跤——文件多只是一半原因，另一半是：目录顺序既不是职责顺序，也不是依赖顺序。

打开根目录的 `Cargo.toml`，第一屏把全书的第一个事实摆上桌：这是一个由九个 crate 组成的 workspace，九个名字、一个 `resolver = "2"`，再无别的成员。往下翻会撞到第二堵墙：GPUI 框架在依赖区出现了不止一次，全部指向项目自有 fork（`Kuddev/zed`、`Kuddev/gpui-component`），每一条都钉着一串 40 位十六进制的 SHA。这种 SHA 钉版不是洁癖。注释里写明了事故形态——两处 URL 或 rev 不一致，Cargo 会把同名类型解析成两套互不兼容的 crate，直接编不过。

本章先不进任何模块。三个问题回答掉，走读才有起点：这九个 crate 各自拥有什么？依赖只许往哪个方向流？版本为什么钉死在一串 SHA 上？答案全写在仓库自带的治理文件里——`docs/architecture.md`、`architecture/dependencies.toml`、`architecture/file-budgets.txt`，加上 `Cargo.toml` 本身。合起来读，你会得到一张所有权地图——谁拥有什么、禁止变成什么，一行一份合同——全书后面走进任何一个子系统，第一站都是这张图。

替「按目录顺序通读」说句公道话：在几十个文件的小仓库里这几乎是唯一可行的读法，文件少到目录顺序天然接近职责顺序。它在这里失效只因为数量级变了——703 个文件里，同一个职责散在多个 crate，同一个 crate 里又挤着多个职责区。读大仓库的第一步不是打开第一个文件，是找到它的地图。

::: info 引用纪律（全书通用，此处一次性说明）
本书逐字引用 Pebrel 的源码与文档。每个引用块第一行都是出处标注，格式为 `Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:路径`——仓库名、锁定 commit 的完整 SHA、文件路径三段。全书事实都锚定在这个锁定 ref 上：主分支之后的演进不自动生效，正文也不追着最新代码改口。Pebrel 以 GPL-3.0 授权发布，被引用片段依该许可使用；署名与完整许可声明集中在关于页，首处引用时在此一并提示。
:::

## 原理：一张地图、一条方向、两份预算

### 所有权地图：owns 与 must-not-become 两栏合同

正本是 `docs/architecture.md`。开篇方向一段写下了全书最重要的一句合同：

```text
# Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:docs/architecture.md
The dependency direction is **composition/UI → application capabilities → shared
domain rules**. Platform and I/O details adapt domain inputs/results. They must not
make a domain crate depend on a view. This is a responsibility model, not a demand
to rename all existing directories or create abstract interfaces everywhere.
```

翻译过来：界面与组合层在最外，应用能力居中，共享领域规则在最内；平台与 I/O 只做适配，不许反过来让领域规则依赖某个视图。这句话的落地载体是一张两栏表，全文如下：

::: details 所有权地图正本（19 行合同，逐字引自锁定 ref）

```text
# Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:docs/architecture.md
| Area | Owns | Must not become |
| --- | --- | --- |
| `nebula_settings` | Runtime settings, language registry, shared preference contracts | A UI/widget library |
| `nebula_split` | Split tree, geometry, navigation rules | Window management or rendering |
| `nebula_terminal` | Grid, VT processing, terminal/PTY behavior | Product panels or GPUI state |
| `nebula_config`, `nebula_config_derive` | Configuration abstractions and derives | Application orchestration |
| `nebula-completions` | Completion matching and presentation-independent results | Terminal view ownership |
| `nebula_hook` | Small process/lifecycle hook bridge | An application dependency container |
| `nebula_app/src/i18n` | Static lookup, locale resolution and formatting | Runtime catalog parsing or UI ownership |
| `nebula_app/src/math` | Parse, validate, layout, compile and cache responsibilities | A duplicated per-shell math engine |
| `nebula_app/src/platform` | Explicit platform capabilities and native adapters | A dumping ground for unrelated logic |
| `nebula_app/src/ai_hook` | Normalized provider facts, bounded ordering, one shared pane lifecycle and owned installation policy; Windows adapters | Screen keyword rules or a separate state machine per UI shell |
| `nebula_app/src/platform/ssh_agent.rs` | Native agent endpoints, transport connection and bounded identity discovery | Host authentication policy or private key selection |
| `nebula_app/src/ssh_session/agent.rs` | SSH agent identity selection, signing outcomes and total discovery budget; fresh scope per host | A second authentication plan, credential store or agent forwarding service |
| `nebula_app/src/ssh_session/integration.rs` | Authenticated exec/PTY orchestration for remote hook installation and shell startup | Provider policy or a second Agent state machine |
| `nebula_app/src/ai_agents` | Agent identity and structurally constrained screen observations | Authority to overwrite hook results or infer remote completion from silence |
| `nebula_app/src/gpui_shell` | GPUI views, UI state, commands and subscriptions | A second settings/domain implementation |
| `nebula_app/src/product_ui` | Feature-selected shared presentation facade | A route to legacy rendering dependencies |
| `nebula_app/src/display`, `renderer` | Legacy rendering and still-shared extracted models | A source of new undifferentiated functionality |
| `nebula_gpui` | Component acceptance lab | A dependency of the product |
| `nebula_app/build`, `tools/i18n-contract` | Generation and independent contract verification | Runtime configuration loading |
```

:::

左栏 Owns 承诺「拥有什么」，右栏 Must not become 画死「禁止变成什么」。19 行合同盖住九个 crate：六个独立 crate 各占一行，职责最重的 `nebula_app` 拆成十来个 `src/*` 子区行。为了随手可查，下面是本书压成的九行拼版，以正本为准：

| crate | 一句话职责 | 层 |
| --- | --- | --- |
| `nebula_terminal` | 网格、VT 处理、终端/PTY 行为 | core |
| `nebula_config` + `nebula_config_derive` | 配置抽象与派生宏 | core |
| `nebula_settings` | 运行时设置、语言注册表、共享偏好合同 | core（零生产依赖） |
| `nebula_split` | 分屏树、几何与导航规则 | core（零生产依赖） |
| `nebula-completions` | 补全匹配与呈现无关的候选结果 | core |
| `nebula_hook` | 独立小进程形态的钩子桥 | hook（零生产依赖） |
| `nebula_app` | 应用聚合：i18n、math、platform、ai_hook、ssh_session、ai_agents、gpui_shell、product_ui 等能力区 | application |
| `nebula_gpui` | 组件验收实验室 | lab |

反事实检验一下右栏的价值。要是没有 Must not become，评审会反复上演同一场争论——「这段代码放这儿不行」对「这不也编译过了」。有了右栏，争论提前变成合同引用：`nebula_terminal` 的禁区白纸黑字写着不得变成 GPUI 状态，想把光标动画塞进终端核心的 PR，评审时引这一行就够了。左栏管分工，右栏管退路，合在一起才是合同。

### 依赖方向：合同里能机器检查的那一半

上一节那句单向流，本书叫它 crate 依赖方向——依赖只能从外向内：application 可以依赖 core，core 绝不依赖 application，更不许沾任何渲染包。这句话有一半不用靠自觉：检查器吃 `architecture/dependencies.toml`。

::: details dependencies.toml 全文（37 行，逐字引自锁定 ref）

```toml
# Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:architecture/dependencies.toml
version = 1
renderer_packages = ["gpui", "gpui_platform", "gpui-component", "gpui-component-assets", "winit", "glutin", "crossfont"]

[crates.nebula_app]
layer = "application"
dependencies = ["nebula_terminal", "nebula_config", "nebula_config_derive", "nebula_settings", "nebula_split", "nebula-completions"]
build-dependencies = ["nebula_settings"]
dev-dependencies = []

[crates.nebula_terminal]
layer = "core"

[crates.nebula_config]
layer = "core"
dev-dependencies = ["nebula_config_derive"]

[crates.nebula_config_derive]
layer = "core"
dev-dependencies = ["nebula_config"]

[crates.nebula-completions]
layer = "core"

[crates.nebula_settings]
layer = "core"
zero_production_dependencies = true

[crates.nebula_split]
layer = "core"
zero_production_dependencies = true

[crates.nebula_hook]
layer = "hook"
zero_production_dependencies = true

[crates.nebula_gpui]
layer = "lab"
```

:::

三个可核对的机制。其一，每个 crate 挂一个 `layer` 标签，application、core、hook、lab 四类，方向断言按标签判。其二，`renderer_packages` 列出七个渲染包，core 层的生产与构建依赖出现任何一个即违规。其三，`nebula_settings`、`nebula_split`、`nebula_hook` 额外带着 `zero_production_dependencies = true`，生产依赖清零。配套规则写在 `docs/project-constraints.md` 第 2 节：core 不得依赖 application 或 lab，本地依赖边必须无环，新成员必须有分类。

反过来想这条禁令防的是什么。假如允许 `nebula_terminal` 依赖 `gpui` 来「顺手画个光标」，终端核心从此背上整个渲染栈：跑一行单元测试也要拉起 GPU 上下文，SSH 会话想复用同一套网格，就得连带编译窗口系统。方向合同把这类「顺手」挡在依赖图层面，而不是等代码长歪了再用人评审。

### ratchet 预算：只许变小的不等式

地图自己承认还没治理完。正本在表格之后紧接着写了这段话：

```text
# Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:docs/architecture.md
The map records current responsibilities; it does not assert that every legacy
file has already reached the target shape. Eleven oversized legacy files remain
under [ratcheted budgets](project-constraints.md). Move their independent rules
when working on the relevant capability; do not mix a whole-app rewrite into a fix.
```

治理工具叫 ratchet 预算——ratchet 是棘轮，一种只能单向拧动的扳手。合同一句话：超标旧文件的行数额度按采纳时的实测值钉死，此后只许变小，不许变大。预算表本身在 `architecture/file-budgets.txt`：

```text
Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:architecture/file-budgets.txt
limit 2000
```

```text
Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:architecture/file-budgets.txt
nebula_app/src/display/chrome.rs 2442
nebula_app/src/display/command_palette.rs 3935
nebula_app/src/display/markdown_view.rs 2067
nebula_app/src/display/mod.rs 11150
nebula_app/src/display/settings.rs 8434
nebula_app/src/event.rs 3594
nebula_app/src/gpui_shell/workspace.rs 4798
nebula_app/src/window_context.rs 3735
nebula_terminal/src/term/mod.rs 2713
```

这里有一个必须如实交代的数字差。architecture.md 与 project-constraints.md 写的都是「十一个」——Eleven，采纳时的口径。锁定 ref 上的预算表实际只剩九条 allowance。两个数字都真：采纳时十一个文件超过 2000 行，其中两条在此期间已离开名单。离开的方式是缩小到限内还是随文件删除，预算表本身看不出来。引用时写「采纳时 11 个、当前预算表 9 条」，不要替仓库圆成同一个数。

换算一下体感：九条 allowance 合计约 42868 行，平均 4763 行一条；最大的一条 `nebula_app/src/display/mod.rs` 有 11150 行，是 2000 硬限的 5.6 倍。名单里唯一不在 `nebula_app` 的是 `nebula_terminal/src/term/mod.rs`（2713 行）——终端核心的心脏文件也在监护之下。合同的细节由 `docs/project-constraints.md` 写明，两段原话：

```text
# Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:docs/project-constraints.md
- `architecture/file-budgets.txt` is the single shared source of roots, the hard
  limit and legacy allowances. Eleven existing files exceeded 2000 at adoption.
  They receive their measured size, not additional growth room.
- A normal PR cannot add/raise an allowance or raise the default limit. With
  `--base`, an oversized file's permitted size is also bounded by its actual base
  size, so an old allowance cannot be reused after the file has shrunk.
```

中译：预算表是根、硬限与遗留额度的唯一共享事实源；十一个存量文件在采纳时超过 2000 行，拿到的额度是当时的实测行数，不是增长空间。普通 PR 不能新增或调高 allowance，也不能调高默认限；文件缩小后旧额度随之作废，不许复用。

同一份 `Cargo.toml` 里还住着第二种预算——发布包体积。冷代码整体按体积编译（`opt-level = "s"`），渲染、字体塑形、VT 热路径等十个包逐个钉回 O3。注释写明目标是安装包小于 30MB，动过必须重跑发布测试：

```toml
# Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:Cargo.toml
# 发布包体积预算：安装包 <30MB。冷代码（协议栈、序列化、CLI、SSH 等
# 几百个依赖）按体积编译；渲染/塑形/布局/VT 热路径在下面逐个钉回 O3，
# 手感不受影响。改动这里必须重新跑 scripts/tests/package-release.tests.ps1。
opt-level = "s"
```

文件行数与安装包体积，两份预算形态不同、性格相同：都先把上限写成数，再禁止无声地突破。

### SHA 钉版：两个 fork 与一条身份规则

现在拆第二堵墙的砖。先看 `gpui_platform`，它住在常规的 `[workspace.dependencies]` 段，注释带着三条硬约束：

```toml
# Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:Cargo.toml
# GPUI v1.16.1 把平台启动入口拆到独立 crate。它必须与 `gpui` 使用完全相同
# 的 Git URL 和 rev，否则 Cargo 会把同名类型解析成两套互不兼容的 crate。
# Without font-kit, the macOS platform uses NoopTextSystem and renders no text.
gpui_platform = { git = "https://github.com/Kuddev/zed", rev = "fc05d637cc7029d75de051fd7f52c1a0fb8fa6b4", version = "=0.1.0", features = ["font-kit"] }
```

而 `gpui` 和两个 `gpui-component` 包不住在这里——它们住在 `[patch.crates-io]` 段。这个段的语义是重定向：凡是 Cargo 想从 crates.io 解析到这些包的位置，一律改吃指定来源。gpui 的钉版因此不写在常规依赖表里——它以「劫持 crates.io 解析」的方式生效：

```toml
# Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:Cargo.toml
gpui = { git = "https://github.com/Kuddev/zed", rev = "fc05d637cc7029d75de051fd7f52c1a0fb8fa6b4", version = "=0.2.2" }
# Native inputs share rendered text's device-pixel line height and expose a
# post-paint point lookup. Window selection ends on release even when a child
# consumes MouseUp or the platform reports the next move without a held button.
gpui-component = { git = "https://github.com/Kuddev/gpui-component", rev = "fc5f5cf63dd80686dafacd2a6e37345bbd1dc7ba", version = "=0.5.2" }
gpui-component-assets = { git = "https://github.com/Kuddev/gpui-component", rev = "fc5f5cf63dd80686dafacd2a6e37345bbd1dc7ba", version = "=0.5.1" }
```

顺带交代：`[patch.crates-io]` 段里还有两条与 GPUI 无关的补丁。一个钉在上游作者 quininer 仓上的 `x11-clipboard` 修复（不是 Kuddev 自有仓——来源身份要说准），段首 TODO 写明官方发布后即撤销；另一个是 vendor 进 `third_party/` 的 winit 0.30.13。

这套做法就是 SHA 钉版——依赖不写 branch、不写 tag、不写通配版本，只用完整 40 位 commit SHA 加精确等号版本（如 `=0.2.2`）把来源钉死。为什么这么较劲？`Cargo.toml` 的基线注释把事故形态写得很具体：

```toml
# Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:Cargo.toml
# 所有 Zed 依赖统一使用 Kuddev URL：Cargo 的 source identity 包含 URL，应用
# 与 component 内部若混用官方/自有 URL，即使 SHA 相同也会解析成两套 gpui
# 类型。新增 Zed/component 补丁必须从固定基线开独立分支、逐条提交并更新
# exact rev，不能移动基线 branch/tag。
```

Cargo 判定「这是不是同一个 crate」时，来源身份（source identity）包含 Git URL。官方 URL 与自有 URL 即使指向同一次提交，也会解析成两份 `gpui` 类型，在编译期互不兼容。`gpui_platform` 与 `gpui` 必须做到 URL 与 rev 双一致，防的正是这个。

替「写 branch 多省事」说句公道话：只有一个 git 依赖的小项目里，跟着分支走能自动拿到修复，`^x.y` 的浮动版本也是 crates.io 的日常默认。这套默认在这里失效，因为钉的不是「一个依赖」，是四个必须互相对齐的包。基线注释原话：

```toml
# Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:Cargo.toml
# ---- GPUI v1.16.1 固定基线 ------------------------------------------------
#
# 版本配对：Zed v1.16.1 提交上的 gpui 0.2.2 / gpui_platform 0.1.0，配套
# gpui-component 0.5.2 和 gpui-component-assets 0.5.1。版本号与 Git rev 都
# 精确固定，禁止 main、通配版本或仅凭 branch 名解析。
```

由此能推出升级的真实形状：换 GPUI 基线等于在 fork 上开新分支、迁移补丁、四条 rev 一起更新——一次带清单的手术，而不是一次 `cargo update`。版本号与 rev 是配好对的，任何一条单独漂移都在制造两套类型。

### 命名双轨：Pebrel 与 nebula_*

最后一堵墙不在依赖里，在名字里。README 主标题写的是 `Pebrel`，九个 crate 却全部叫 `nebula_*`，连 logo 的文件路径都还是 `extra/logo/nebula.png`。这不是笔误：项目由 Nebula 改名 Pebrel，crate 名与大量内部标识沿用旧名，环境变量则新旧成对出现。本书把这种现象叫命名双轨——一条轨道是产品名 Pebrel，面向用户；一条轨道是代码标识 nebula，长在源码里。读代码时两轨并存，缺一不可。

双轨在环境变量层的实现是「同名双写」。以 Agent 身份变量为例：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/agent_env.rs
pub const CLI_ENV: &str = "PEBREL_CLI";
const LEGACY_CLI_ENV: &str = "NEBULA_CLI";

/// [`CLI_ENV`] 所在目录，同时被前置到 `PATH`，这样 `nebula` 裸命令也可用。
pub const BIN_DIR_ENV: &str = "PEBREL_BIN_DIR";
const LEGACY_BIN_DIR_ENV: &str = "NEBULA_BIN_DIR";
```

新旧两个名字永远写同一个值，而且有测试把这条合同钉死。哪怕旧名带着过期值，apply 之后两者也必须指向同一目录：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/agent_env.rs
    fn child_configuration_aliases_refer_to_the_same_directory() {
        let mut env = HashMap::from([
            ("PEBREL_CONFIG_DIR".to_owned(), "current-config".to_owned()),
            ("NEBULA_CONFIG_DIR".to_owned(), "stale-config".to_owned()),
        ]);
        apply(&mut env, 5);
        assert_eq!(env.get("NEBULA_CONFIG_DIR"), env.get("PEBREL_CONFIG_DIR"));
        assert_eq!(env.get("NEBULA_CONFIG_DIR").unwrap(), "current-config");
```

于是读代码的操作规则是：引用代码与文件路径用 crate 现名（`nebula_*`），讲产品与用户可见面用 Pebrel；撞见 `NEBULA_` 前缀的变量按兼容层理解，它和 `PEBREL_` 版本是同一个值。一个辨认细节：成员名单里 `nebula-completions` 用连字符、其余八个用下划线——它是一个从 Nushell 补全框架抽出的独立引擎 crate，自带独立版本号，检索时两种拼法都要认。

## 演练：拿地图判三个改动的落点

方法论在这里成形：进任何模块之前，先在地图上判落点。下面三个假想改动，每个先自己判一遍——落点 crate 加禁区——再展开对照。

1. 给「向下分屏」增加一种新的键位绑定。
2. 把 SFTP 下载的分段数调小。
3. 换一套字体渲染后端。

::: details 对照：用 19 行合同逐条判

**改动一（键位）**：键位绑定是命令与订阅的接线。落点是 `nebula_app/src/gpui_shell`（合同原文：GPUI views, UI state, commands and subscriptions）。若这种键位要做成可配置项，默认值与偏好合同落在 `nebula_settings`（Runtime settings, shared preference contracts）。禁区：`nebula_terminal`——它拥有的是网格与 VT 处理，右栏明写不得变成 GPUI 状态，终端核心不该认识任何键位。

**改动二（SFTP 分段数）**：分段是应用层的传输策略，落点是 `nebula_app` 的 `ssh_sftp` 模块——`dependencies.toml` 里 `nebula_app` 是唯一的 application 层成员。禁区有两条：把分段常量下沉进任何 core crate（方向合同禁止 core 依赖 application，传输策略也不是领域规则）；塞进 `nebula_gpui`（验收实验室，右栏明写不得成为产品依赖）。

**改动三（字体渲染）**：产品侧接线落在 `nebula_app/src/gpui_shell` 与 `product_ui`（feature 选择的共享呈现门面）。若要动到渲染框架本身，那是 GPUI fork 上开新分支、迁补丁、换 rev 的手术，不是 workspace 里的常规改动。禁区：`nebula_app/src/display` 与 `renderer` 旧渲染区（右栏明写不得再成为新功能的来源），更不许解钉版本混用官方 gpui——那正是上一节的两套类型事故。

:::

这些判断不该停在纸面。本书伴生仓为每章配一个只读探针：Node 脚本，先校验 `.course/repo` 的 HEAD 等于锁定 SHA，再对源码做解析、grep 与结构断言；不安装依赖、不构建、不执行目标仓库的代码。本章探针 `companion/scripts/probe-01-repo-map.mjs` 把正文断言变成 24 条检查，覆盖七个事实面：成员清单、所有权表、依赖方向、SHA 钉版、编译体积策略、ratchet 预算、命名双轨。

## 验证：先猜后跑，再拆一条

先猜后跑。在 `companion` 目录执行 `node scripts/probe-01-repo-map.mjs` 之前，把预测写在纸上——每项都是离散可判定的值：

- workspace 成员数（整数）；
- 所有权表行数（整数）；
- 预算 `limit` 与现存 allowance 条数（两个整数）；
- `[profile.release.package]` 的 O3 名单项数（整数）；
- `gpui` 与 `gpui_platform` 的 rev：完全相同，还是各不相同（二选一）。

然后运行。成功形态的尾部两行长这样，summary 行给出成员清单与钉版 SHA 摘要，逐项对照你的预测：

```text
summary [repo-map] members(9)=nebula_app,nebula_terminal,nebula_config,nebula_config_derive,nebula-completions,nebula_hook,nebula_gpui,nebula_settings,nebula_split; gpui@zed rev=fc05d637cc7029d75de051fd7f52c1a0fb8fa6b4; gpui-component rev=fc5f5cf63dd80686dafacd2a6e37345bbd1dc7ba; budgets: limit 2000, 9 allowances
PASS  [repo-map] 24/24 checks
```

哪一项预测落空，就回到对应小节看自己漏了哪个事实——探针断言与正文是一一对应的。

再做一次定向破坏。探针与 clone 都是只读的，这次破坏在纸面做，预测要当真。指认一处精确到行的改动：把 `[patch.crates-io]` 里 `gpui` 那一行的 `git = "https://github.com/Kuddev/zed"` 换回官方 `https://github.com/zed-industries/zed`，rev 不动。先写下预测——24 条里哪几条红、哪条竟然还绿——再打开探针源码的 D 段核对：

- 红：「gpui（patch.crates-io）指向 Kuddev/zed fork」——`git` 字段不再匹配；
- 红：「防两套类型事故：gpui 与 gpui_platform 的 git URL 和 rev 完全一致」——与 `gpui_platform` 从此不同源；
- 仍绿：「四个 GPUI 类 git 依赖均无 branch=/tag=」——它守的是「不许用分支或标签引用」这条合同，URL 换家不触碰它。它不红，恰好说明每条断言守的是独立的合同面。

这行改动的真实后果，正是 `Cargo.toml` 注释警告的事故：来源身份包含 URL，换回官方源后，应用与组件各自解析出的 `gpui` 成了两套同名类型，编译期互不兼容。开篇「两个 fork 编不过」六个字，在依赖表上的形状就是这样。纸面破坏无需复原；真动了 clone 的话，`git -C .course/repo checkout -- Cargo.toml` 一条还原。

## 收束

回到开篇的问题。700 个文件从哪读起？不从文件树读起，从 `docs/architecture.md` 的 19 行合同读起：先判职责归属，再看依赖方向，最后才进模块——目录顺序在这里不承担导航。同一个 GPUI 出现两个 fork 为什么会编不过？因为 Cargo 认包看的是「URL 加 rev」的来源身份，两处不一致就是两套同名类型。这个仓库用 SHA 钉版把四个包钉在同一棵源码树上，并把规则写成注释合同，探针再把它变成可复跑的断言。

本章交出五块积木，全书反复调用。所有权地图——判落点的权威查表入口。crate 依赖方向——先看 crate 归属再读模块。ratchet 预算——动旧大文件前核对上限合同。SHA 钉版——40 位 SHA 加 Kuddev fork 即为钉版基线。命名双轨——引用代码用 nebula 名，讲产品用 Pebrel 名。每走进一个子系统，第一动作都是回到这张地图找到它的一行。（第 16 章会把 ratchet 预算与 SHA 钉版放回全部十五个子系统对账。）

### 自查：换一个情境再判一遍

1. 一个 PR 想让 `nebula_terminal` 直接依赖 `gpui`，理由是「在核心里顺手画光标」。按本章两份合同，它踩了哪两条？探针哪一组断言会红？
2. 升级 GPUI 时只更新了 `gpui` 的 rev，忘了同步 `gpui_platform`。哪条断言最先红？这条守住的是哪类事故？
3. 假设 `nebula_app/src/event.rs`（预算 3594 行）被治理到 1990 行。预算表会怎么变？条数变成几？

::: details 答案

1. 踩地图（`nebula_terminal` 行的 must not become：不得变成 GPUI 状态）与依赖方向（core 层生产依赖不得含 renderer 包）。探针 C 组「core 层 crate 的生产依赖不含 nebula_app 与任何 renderer 包」红。回查「依赖方向」一节。
2. 「防两套类型事故：gpui 与 gpui_platform 的 git URL 和 rev 完全一致」最先红——URL 相同但 rev 不再一致；它守住的是两包不同源导致的同名类型两套、编译期互不兼容。回查「SHA 钉版」一节。
3. 该条 allowance 删除——文件降到默认限内即移除条目，九条变八条。此后它受 2000 硬限正常约束（project-constraints 的 Remove allowances 条款）。回查「ratchet 预算」一节。

:::
