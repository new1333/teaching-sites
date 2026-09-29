---
title: 第 5 章 GPUI 壳与 pane 生命周期
---

# GPUI 壳与 pane 生命周期

## 工具箱

拼这一章的壳，要用四块旧积木。

- 事件循环——本地 shell 输出进入 UI 的唯一通道：I/O 线程分块读字节、喂给 Term、发 UI 通知；它同时开着一条 Msg 消息队列，Input / Shutdown / Resize 都从这里进（[第 3 章](./03-pty-event-loop.md)）。
- 纯数据布局树——分屏行为的第一性模型：切割数学与导航规则全在 nebula_split，不引用任何 UI 类型（[第 4 章](./04-split-tree.md)）。
- 树叶集合不变式——「pane id 集合 == 树叶集合」的等式，把布局树接回视图层时的对账判据（[第 4 章](./04-split-tree.md)）。
- 所有权地图——判断一个改动应落在哪个 crate 的权威查表入口，domain crate 不依赖 UI 是它的硬约束（[第 1 章](./01-repo-map.md)）。

## 拖着不放的那两秒钟

拖住窗口右下角往里拽。终端里的字跟着你的手一帧一帧重新折行：80 列变 70 列再变 60 列，提示符每帧挪一次位置。松手，小半秒后一切落定，shell 照常干活。

问题来了：整个过程里，「现在到底几列几行」是谁说了算？候选有三个，本章都会拆开：渲染管线里每帧测量尺寸的 prepaint 阶段；持有每个终端视图状态的 Entity；关 pane 时负责送走 PTY 线程与子进程的 shutdown。

直觉会说，resize 不就是改一个宽度变量吗——一次同步调用，改完大家就都知道了。如果真是这样，这章一页就写完了。可你亲眼看到的是两种节奏：逐帧跟手的 rewrap，和松手后才发生的落定。这两种节奏是被刻意分开的，分开的代价和收益都得用源码算账。算完你会发现，这一章真正的主题不是「怎么 resize」，而是「谁有权裁定尺寸」和「谁有权宣布死亡」。

## 一张会骗人的模块地图

从入口开始。仓库里有两个叫「壳」的东西，别走错门。（本章起逐字引用锁定 commit 的源码片段，均标注 `Kuddev/pebrel@360613aa…:路径`；片段依 GPL-3.0 授权使用，署名与许可声明集中见关于页。）

`nebula_app` 才是产品壳的家：`src/gpui_shell/` 整个目录在 feature `gpui-shell`（默认开启）下编译，由 `src/main.rs` 里的 `gpui_shell::run_shell(...)` 启动。而 `nebula_gpui` 这个 crate 是一块实验场。它的入口小到只有三行：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_gpui/src/main.rs
fn main() {
    nebula_gpui::run_shell();
}
```

它的库文档说得很直白：产品代码不在这里，这个 crate 只保留 GPUI 组件验收页，用来快速验证组件、fork 补丁与上游升级回归。读壳的正文，去 `nebula_app/src/gpui_shell/`。

进了目录还有第二重骗局：模块名和文件位置不完全对应。`workspace.rs` 有 3346 行，但它声明了一串子模块（`mod closing;`、`mod pane_header;`、`mod session_persistence;`……），实现躺在 `workspace/` 子目录里；`terminal/view.rs` 同样声明了 `mod layout;`，`set_layout` 的实体就住在 `terminal/view/layout.rs`——不在 view.rs 本体，更不在 element.rs。仓库里还有 `#[path = "element/color_tests.rs"]` 这样的显式重映射先例。结论：先读模块声明，再定位文件，别按路径名猜。

你可以现在就验证这一点（在锁定 clone 根目录执行）：

```bash
grep -rn "pub fn set_layout" --include="*.rs" nebula_app nebula_terminal
# 唯一命中：nebula_app/src/gpui_shell/terminal/view/layout.rs
```

顺带两个防混提示：`nebula_app/src/display/terminal_math.rs` 里那个 `set_layout_resolver` 是上一代 winit 壳的遗迹，与本章无关；`workspace.rs` 本身挂在 ratchet预算名单上（`architecture/file-budgets.txt` 给的上限是 4798 行），改它之前先核对预算合同（[第 1 章](./01-repo-map.md)）。

## Entity：壳的细胞

先解决居住问题。终端视图的状态——网格快照、字体、选区、会话句柄——必须跨帧存活、能被多处订阅、还能被后台线程通知更新。散落在函数局部变量里显然不行。GPUI（Zed 编辑器的那套 UI 框架，在本仓库被 SHA钉版锁在自有 fork 基线上，[第 1 章](./01-repo-map.md)）给出的答案是 **GPUI Entity**。它的职责三分：实体持状态、Context 提供创建订阅与更新的入口、渲染由框架调度。

写过 React 的人可以把它理解成「框架替你保管的一个 struct，外加一个人人可以持有的句柄」，但别推得太远：Entity 没有虚拟 DOM，也不 diff。句柄只做两件事——`read(cx)` 借读、`update(cx, …)` 在闭包里改。看到 `.update()` 或 `cx`，就是在操作实体。

壳把每个终端视图包成一个 pane 记录：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/workspace.rs（行 180–189）
/// 一个终端 pane：视图实体 + 宿主订阅。id 即 `TerminalView::pane_id`
/// （AI hook 的 `NEBULA_PANE_ID` 同源），全工作区唯一、终生不复用。
struct TerminalPane {
    id: u64,
    custom_name: Option<String>,
    /// Recent committed names; follows the live pane without retaining window-bound inputs.
    name_history: Vec<Option<String>>,
    view: Entity<TerminalView>,
    _subscription: Subscription,
}
```

出生是标准三步：领 id、建实体、订事件。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/workspace.rs（行 1204–1207）
        let pane_id = self.next_pane_id;
        self.next_pane_id = self.next_pane_id.saturating_add(1);
        let view = cx.new(|cx| TerminalView::new(pane_id, grid, launch, window, cx));
        let subscription = cx.subscribe_in(&view, window, Self::on_terminal_event);
```

id 不是随手发的。多窗口时高 32 位按窗口分区，注释原话：「AI hook 只有 pane id 时也不会撞到另一窗口的同号 pane」。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/workspace.rs（行 940–945）
            // 首窗仍从 1 起，保持既有 runtime/测试身份；后续窗口用高 32 位
            // 分区，AI hook 只有 pane id 时也不会撞到另一窗口的同号 pane。
            next_pane_id: runtime_window_id
                .saturating_sub(1)
                .saturating_mul(1u64 << 32)
                .saturating_add(1),
```

`NEBULA_` 前缀又是命名双轨的遗迹：产品已改名，环境变量与 crate 名留在 nebula 一侧（[第 1 章](./01-repo-map.md)）。

pane id 终生不复用，是为了让「一个 id 只指过一个 pane」永远成立——后面 AI 钩子按 pane id 记账时，这成为可依赖的前提（[第 9 章](./09-ai-lifecycle.md)）。

## pane 生命周期：出生、关闭、搬迁

有了细胞，还得有户籍制度。每个终端 tab 持有三件套，合同写在 workspace.rs 的模块头。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/workspace.rs（行 8–19）
//! ## 分屏 pane 生命周期合同
//!
//! - 每个 Terminal tab 持有 `panes`（实体属主）+ `tree`（`nebula_split`
//!   布局树，叶 = pane id）+ `focused`。不变式：panes 的 id 集合 == 树的
//!   叶集合。
//! - 关一个 pane：`tree.remove_leaf` 裁定结局——`WasRoot` 关整个 tab；
//!   `Collapsed(id)` 由兄弟子树收编空间、焦点交给其首叶。被摘 pane 立即
//!   显式 `shutdown`，实体随 `panes` 移除而释放，`Drop` 兜底。
//! - 关整个 tab（侧栏 ×、最后 pane 退出）：逐 pane `shutdown`。
//! - PTY 尺寸：pane 矩形由布局树裁定，`TerminalElement` prepaint 回写
//!   `set_layout`，resize 合并/提交合同（burst + settle）原样生效——分屏
//!   拖拽期间 PTY 跟随提交比例，松手后一次落定，与旧壳语义一致。
```

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/workspace.rs（行 191–206）
enum WorkspaceTab {
    Terminal {
        /// pane 实体属主（无序存储，按 id 查找）。见模块头的生命周期合同。
        panes: Vec<TerminalPane>,
        /// 分屏布局树（`nebula_split` 共享权威实现），叶 = pane id。
        tree: SplitTree<u64>,
        /// 聚焦 pane：键盘输入焦点与 split/close 动作的作用对象。
        focused: u64,
        /// 缩放：聚焦 pane 临时满卡（ctrl+shift+enter，旧壳 ToggleZoom）；
        /// 任何结构性操作（split/close/导航/点击别的 pane）都先解除。
        zoomed: bool,
        /// 广播输入：开启后聚焦 pane 的击键/文本同步到本 tab 其余 pane。
        /// 只活在内存里——绝不写进 session 快照，重启不该带回一个看不见的
        /// 「打一个字进四个 shell」模式。收敛到单 pane 时自动关。
        broadcast: bool,
    },
```

这一节教的新积木是 **pane 生命周期**，即 panes + tree + focused 三件套，加上出生、关闭、搬迁三条路径的裁定规则。它的组装式值得点名：纯数据布局树负责裁定（谁来收编空间），Entity 负责持有（视图状态住在哪），树叶集合不变式负责对账（两本账必须一致）。三块旧积木拼在一起，才有关 pane 的完整语义。workspace.rs 顶部 `use nebula_split::{DIVIDER_GAP, HIT_SLOP, RemoveOutcome, SplitDirection, SplitNav, SplitTree};` 就是组装的物证：壳直接消费那个零 UI 依赖的分屏 crate（[第 4 章](./04-split-tree.md)）。

先看出生这条路径。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/workspace.rs（行 1417–1419）
    /// 在聚焦 pane 上开分屏（ctrl+shift+d / ctrl+shift+s，对齐旧壳
    /// SplitRight/SplitDown）：新 pane 继承聚焦 pane 的 cwd，spawn 网格按
    /// 切割方向对半预估——首帧 prepaint 回写真实矩形后自动收敛。
```

切割比例 0.5 交给纯数据布局树，最终落点由切割次序合同钳制——先取整、再双向钳到至少一个单元格宽，所以任何比例都不会切出 0 宽 pane（[第 4 章](./04-split-tree.md)）。注意最后半句的措辞：spawn 网格只是「对半预估」，真实矩形要等首帧 prepaint 回写后才收敛——这正是下一节的主角。挂树失败时有防御路径：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/workspace.rs（行 1458–1460）
            // new_pane 之后 tab 结构不可能已变（同一同步调用栈），但防御住：
            // 树上挂不进去就立即回收，不留孤儿 PTY。
            pane.view.read(cx).shutdown();
```

关闭由树裁定。`close_pane` 只问一次 `tree.remove_leaf(pane_id)`，然后按裁定分三路：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/workspace.rs（行 1523–1543，节选）
        let outcome = match self.tabs.get_mut(tab_ix) {
            Some(WorkspaceTab::Terminal { tree, .. }) => tree.remove_leaf(pane_id),
            _ => return,
        };
        if !matches!(outcome, RemoveOutcome::NotFound) {
            self.runtime_hub.record_pane_closed(self.runtime_window_id, pane_id);
        }
        match outcome {
            RemoveOutcome::NotFound => {},
            RemoveOutcome::WasRoot => self.close_tab(tab_ix, window, cx),
            RemoveOutcome::Collapsed(next_focus) => {
                if let Some(WorkspaceTab::Terminal { panes, focused, zoomed, broadcast, .. }) =
                    self.tabs.get_mut(tab_ix)
                {
                    if let Some(pos) = panes.iter().position(|pane| pane.id == pane_id) {
                        let pane = panes.remove(pos);
                        pane.view.read(cx).shutdown();
                    }
                    if *focused == pane_id {
                        *focused = next_focus;
                    }
```

`NotFound` 什么都不做；`WasRoot` 是最后一片叶子，升级成关整个 tab；`Collapsed` 是常态——兄弟子树收编空间，`panes` 移除记录、显式 shutdown、焦点移交给幸存子树的首叶。关整个 tab 则是逐 pane 清算：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/workspace.rs（行 1692–1693、1707–1715，节选）
    /// 终端应用惯例：最后一个 Tab 关闭即退出应用。整 tab 关闭（侧栏 ×）
    /// 逐 pane 回收会话；实体引用清零后 `TerminalView::drop` 再兜底。
```

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/workspace.rs（行 1707–1715）
        if let WorkspaceTab::Terminal { panes, .. } = &tab {
            let mut bounds = self.pane_bounds.borrow_mut();
            for pane in panes {
                self.runtime_hub.record_pane_closed(self.runtime_window_id, pane.id);
                pane.view.read(cx).shutdown();
                self.remote_browser.forget(pane.id);
                bounds.remove(&pane.id);
            }
        }
```

搬迁是反向教材。把 pane 拖出分屏、变成独立 tab 的路径，注释第一句就是警告：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/workspace/pane_header.rs（行 662–667）
    /// 把一个 pane 从分屏树里摘出来、原封不动搬进紧随其后的新 tab。
    ///
    /// **绝不能走 `close_pane`**：那条路会 `shutdown()` 掉视图（连 PTY 一起
    /// 回收）。这里要的是活体搬迁——视图实体、PTY、滚动历史全部保留，只换
    /// 归属。同窗口内搬迁不需要动 `runtime_hub`：它按 `(window_id, pane_id)`
    /// 记账，两者都没变（跨窗口才需要 `move_panes_to_window`）。
```

同一个 `remove_leaf`，close 语义是死亡，detach 语义是搬家。detach 路径甚至防着树与 panes 不同步的病态情况——宁可不动也不搬迁：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/workspace/pane_header.rs（行 683–689）
        let nebula_split::RemoveOutcome::Collapsed(next_focus) = outcome else {
            // panes.len() >= 2 时树上必然还有别的叶子，摘掉这个只会是 Collapsed。
            // 真出现 NotFound/WasRoot 说明树与 panes 已经不同步；此时啥都不做
            // 比继续搬迁安全（后者会把 pane 从两边同时摘掉，留下孤儿 PTY）。
            log::warn!("detach_pane_to_new_tab: unexpected remove outcome for pane {pane_id}");
            return;
        };
```

把三条路径连起来看，树叶集合不变式就是户籍底账：panes 与树任何一边动了，另一边必须同步。close_pane 的 `panes.remove(pos)` 与 detach 的搬迁都守着它；守不住时的症状你手里有现成判据——幽灵 pane 或丢 pane（[第 4 章](./04-split-tree.md)）。

## prepaint 回写：尺寸的真话在布局之后

回到开篇的拖拽。终端需要知道行列数，shell 那头的 PTY伪终端窗口尺寸也要有人更新；而 UI 框架在布局完成之前只知道「我想要多大」，不知道「实际分到了多大」。所以信息只能单向流动：渲染侧量出最终矩形，换算成行列，回告子进程那一半。这个方向就是 **prepaint 回写**：它发生在 GPUI 元素渲染的 prepaint 阶段（布局已定、绘制未开始），是「窗口拖动时 shell 怎么知道列数变了」的答案。

先替一个流行直觉说句公道话。「UI 拥有布局真相」在多数 UI 栈里确实如此：React 组件持有 style，Android View 持有 layout params。布局参数就是 UI 层的私有财产，这个默认预期在这里恰好不成立——而且源码把拒绝写在了脸上。第一层证据：测量的人不做裁定。元素在 prepaint 里只干一件事——用大写字母 M 量一个字宽，然后把矩形和度量原样上报：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/terminal/element.rs（行 212–235）
        let sample = window.text_system().shape_line(
            SharedString::new_static("M"),
            font_size,
            &[TextRun {
                len: 1,
                font,
                color: Hsla::default(),
                background_color: None,
                underline: None,
                strikethrough: None,
            }],
            None,
        );
        let scale = window.scale_factor();
        let view = self.view.read(cx);
        let cell_width = view.cell_width_for_advance(sample.width.as_f32(), scale);
        let line_height =
            view.line_height_for_metrics(sample.ascent.as_f32() + sample.descent.as_f32(), scale);

        // 网格裁定（floor、最小网格、resize 合流）全部由渲染合同的
        // ViewportTracker 在 view 内完成；元素只上报内容矩形与度量。
        self.view.update(cx, |view, cx| {
            view.set_layout(bounds.origin, cell_width, line_height, bounds.size, scale, cx);
        });
```

为什么是 M？等宽字体里 M 的 advance 就是单元格宽度的一手测量——不信任配置值，只信字体当场排出来的结果。

第二层证据：裁定的人不认识 UI。换算合同住在 nebula_terminal——与 Term 的网格、TermMode位域同层的 domain crate。模块头写明分层与四条硬规则，收尾一句正是所有权地图的 crate依赖方向合同在渲染层的落点：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/render.rs（行 1–16）
//! Renderer-agnostic terminal render contract (model → viewport → frontend).
//!
//! Layering: `Term`/grid (terminal model) → this module (viewport protocol +
//! plain-data snapshot) → a frontend renderer (today the GPUI element; later
//! possibly a self-managed glyph atlas or another backend). Frontends depend
//! on these types; nothing here may depend on a UI framework.
//!
//! Hard rules encoded here:
//! - Terminal content only exists as a cell grid (column × fixed step). There
//!   is no "string flow" representation; typography must never move a glyph.
//! - A viewport is immutable once issued and carries a monotonically
//!   increasing `revision`: a stale resize must never override a newer one.
//! - Pixel sizes reported to the PTY / applications are always the exact
//!   `columns × cell_width` product, never leftover pixels.
//! - A pixel-size change is reported even when rows/cols are unchanged:
//!   applications may care about pixel metrics.
```

具体换算是两行除法——先 floor 取整，再钳到最小网格。屏幕上的一切终究是网格与单元格，行列数就是这个网格的两个维度（[第 2 章](./02-vt-grid.md)）；重排之后真正要重画哪些格，则由 damage追踪决定，渲染只画变坏的区域：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/render.rs（行 47–48）
pub const MIN_COLS: u16 = 2;
pub const MIN_ROWS: u16 = 1;
```

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/render.rs（行 67–83）
    /// Floor-divide a content rect into a grid; clamps to the minimum grid.
    pub fn from_content_size(
        width: f32,
        height: f32,
        metrics: &CellMetrics,
        revision: u64,
    ) -> Self {
        let cols = (width / metrics.cell_width.max(1.0)).floor().max(MIN_COLS as f32) as u16;
        let rows = (height / metrics.cell_height.max(1.0)).floor().max(MIN_ROWS as f32) as u16;
        Self {
            cols,
            rows,
            cell_width_px: metrics.device_cell_width(),
            cell_height_px: metrics.device_cell_height(),
            revision,
        }
    }
```

`observe` 是这套合同的守门人。同样的矩形再来一帧，返回 `None`——稳态帧零开销：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/render.rs（行 142–160）
    pub fn observe(
        &mut self,
        width: f32,
        height: f32,
        metrics: &CellMetrics,
    ) -> Option<ViewportChange> {
        let candidate =
            TerminalViewport::from_content_size(width, height, metrics, self.issued + 1);
        let (grid_changed, pixel_changed) = match &self.current {
            Some(current) => (!current.grid_eq(&candidate), !current.pixel_eq(&candidate)),
            None => (true, true),
        };
        if !grid_changed && !pixel_changed {
            return None;
        }
        self.issued += 1;
        self.current = Some(candidate);
        Some(ViewportChange { viewport: candidate, grid_changed, pixel_changed })
    }
```

桥梁是 view 的一行——渲染时把自身实体交给元素，元素才有回写的对象：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/terminal/view.rs（行 1449）
            root = root.child(TerminalElement::new(cx.entity()));
```

### burst + settle：一次拖拽的完整状态机

现在看回写之后发生什么。`set_layout` 收下矩形与度量，先交给 `observe`：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/terminal/view/layout.rs（行 12–33）
    /// 元素 prepaint 回写布局：内容矩形与度量交给渲染合同裁定网格。
    /// 网格变化时同步 Term 与 ConPTY；行列不变但像素口径变化也上报 PTY
    /// （应用可能关心像素度量）；稳态帧 observe 返回 None，零额外开销。
    pub fn set_layout(
        &mut self,
        origin: Point<Pixels>,
        cell_width: Pixels,
        line_height: Pixels,
        content: Size<Pixels>,
        scale: f32,
        cx: &mut Context<Self>,
    ) {
        self.origin = origin;
        self.cell_width = cell_width;
        self.line_height = line_height;
        let metrics = CellMetrics {
            cell_width: cell_width.as_f32(),
            cell_height: line_height.as_f32(),
            scale,
        };
        let change =
            self.viewports.observe(content.width.as_f32(), content.height.as_f32(), &metrics);
```

有变化时，走三分支。前两支的合同注释把「为什么」说透了：本地网格与子进程两半的代价完全不对称。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/terminal/view/layout.rs（行 76–95）
        // 本地网格立刻跟手，只有子进程那一半去抖（旧壳也通过
        // `resize_active_layout_grids` 采用同一策略）。两半的代价完全不对称：客户端
        // reflow 便宜且可逆，而每一次 `ResizePseudoConsole` 都让 conhost 重排
        // 自己的缓冲区，那些重排累积出的光标行漂移事后无从察觉。让网格落后于
        // 渲染就只能靠"视觉裁剪"预览未提交的几何，而裁剪只能裁行、无法重排列
        // ——宽度一变预览就是错的，且 Term 与屏幕不一致的每一毫秒里到达的字节
        // 都会按旧宽度进网格。
        if change.grid_changed {
            self.resize_grid_only(viewport);
        }

        // 结构性变化（分屏创建/关闭、zoom、面板开合）不去抖：它只来一次，没有
        // 后续帧可以合并，多等的每一毫秒都是子进程按旧几何输出的窗口期。旧壳在
        // 这些路径上走 `resize_active_layout()` 同步下发，这里复刻同一条合同。
        if std::mem::take(&mut self.structural_resize) {
            self.pending_resize = None;
            self.resize_epoch = self.resize_epoch.wrapping_add(1);
            self.commit_viewport(viewport);
            return;
        }
```

网格跟手走的是专用通道，不直接去锁 Term。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/terminal/view/layout.rs（行 130–139）
    /// 只让本地网格 reflow 到 `viewport`，子进程留在旧几何上。
    ///
    /// 走 `Msg::ResizeGrid` 而不是直接锁 `Term`：event_loop 的 resize 分支会先
    /// 把旧几何下已可读的字节全部消化掉，绝对 CUP 序列因此不会被解析进新宽度
    /// 的网格。UI 线程自己上锁 resize 就绕过了这道流边界保护。
    fn resize_grid_only(&mut self, viewport: TerminalViewport) {
        let Some(session) = &self.session else { return };
        let mut notifier = nebula_terminal::event_loop::Notifier(session.notifier.0.clone());
        notifier.on_resize_grid(viewport.window_size());
    }
```

Term 住在 FairMutex 后面，但绕开锁不是怕锁——是怕绕过流边界。锁 Term 只需要一毫秒，跳过「先消化旧几何字节」这道工序的后果却无法撤销：旧宽度下产生的绝对光标序列（CUP，VT转义序列的一支）会被解析进新宽度的网格，提示符从此错位。

第三支是普通拖拽帧：进 pending，等视口静默。节奏由两个常量定：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/terminal/view.rs（行 475–481）
    /// 启动稳定闸的宽限期：等待开窗 resize 落地到布局的最长时间。超时
    /// 即认定差异是真实的（如小屏收拢），按当前视口放行纠正。
    const STARTUP_GRID_GRACE: std::time::Duration = std::time::Duration::from_millis(400);

    /// 尾沿去抖窗口：视口静默这么久才向 Term/ConPTY 提交一次 resize。
    /// 见 `set_layout` 内的合同注释（conhost rewrap 漂移取证）。
    const RESIZE_SETTLE_DELAY: std::time::Duration = std::time::Duration::from_millis(150);
```

为什么 150ms 的时间去抖还不够、还要加手势门控？合同注释给的是实测取证。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/terminal/view/layout.rs（行 97–107）
        // ConPTY 的直通式 conhost 在 resize 时零输出，指望终端侧 reflow 与
        // 它内部 buffer rewrap 一致；两者的换行语义存在路径依赖差异，每多
        // 一次中间宽度的 ResizePseudoConsole 就多攒一分光标行漂移（字节取
        // 证：13 次提交后 PSReadLine 的 CUP 行比真实提示行高 7 行）。旧壳
        // (winit) 的模态拖拽天然只在松手后送达一次 resize，从不累积。这里
        // 复刻该合同：子进程那一半纯尾沿去抖——只进 pending，视口静默
        // RESIZE_SETTLE_DELAY 后一次性下发。净零手势（挤压后拖回原宽）最终
        // 提交同尺寸 no-op，rewrap 次数为零；网格已在上面逐帧跟手，所以去抖
        // 的代价只落在"子进程晚知道几十毫秒"，屏幕上看不出来。
        self.pending_resize = Some(viewport);
        self.schedule_settled_resize(cx);
```

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/terminal/view/layout.rs（行 161–179）
    /// 一次拖拽手势（窗口边框/分屏把手）是否仍在进行。conhost 的 buffer
    /// rewrap 与本地 reflow 的换行语义存在路径依赖差异，每一次中间几何的
    /// `ResizePseudoConsole` 都会累积光标行漂移（字节取证：一次拖拽 14 次
    /// 提交后 PSReadLine 的 CUP 行比真实提示行高 7 行，且 conhost 全程零
    /// 重绘字节，漂移无法事后察觉）。旧壳 (winit) 的模态拖拽天然只在松手
    /// 后送达一次 resize，从不出这个问题；GPUI 在模态循环内持续派发布局，
    /// 时间去抖（150ms settle）与布局批次同周期，挡不住中间提交。因此按
    /// 手势门控：左键仍按住就不提交，settle 定时器自我续期到松手为止。
    #[cfg(windows)]
    fn drag_gesture_active() -> bool {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
        // SAFETY: GetAsyncKeyState 只读全局按键状态，无副作用。
        (unsafe { GetAsyncKeyState(VK_LBUTTON as i32) } as u16 & 0x8000) != 0
    }

    #[cfg(not(windows))]
    fn drag_gesture_active() -> bool {
        false
    }
```

折算体感：一次拖拽若不设防，窗口每帧一个新几何，14 次提交后光标就漂高 7 行——平均每次提交半行漂移。而且 conhost 全程零重绘字节，用户与程序都事后无从察觉。手势门控 + 自我续期把「拖动期间」整个挡在门外。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/terminal/view/layout.rs（行 187–204）
            let _ = this.update(cx, |view, cx| {
                if view.resize_epoch != epoch {
                    return;
                }
                let gate = Self::drag_gesture_active();
                if std::env::var_os("NEBULA_RESIZE_TRACE").is_some() {
                    crate::gpui_shell::try_write_stderr(format_args!(
                        "[nebula:resize-trace] settle-timer gate={gate}"
                    ));
                }
                if gate {
                    // 手势未松开：净零手势（挤压后拖回原宽）最终提交同尺寸
                    // no-op，ConPTY 一次 rewrap 都不做。
                    view.schedule_settled_resize(cx);
                    return;
                }
                let Some(viewport) = view.pending_resize.take() else { return };
                view.commit_viewport(viewport);
                cx.notify();
            });
```

最终出口是 `commit_viewport`，注释只有一句但定了次序——grid 在前、PTY 在后。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/terminal/view/layout.rs（行 141–159）
    /// Commit one viewport in grid-before-PTY order. Output produced after
    /// `ResizePseudoConsole` therefore always parses against the same geometry
    /// history ConPTY used to generate its absolute cursor coordinates.
    fn commit_viewport(&mut self, viewport: TerminalViewport) {
        let next = viewport.window_size();
        let grid_changed = (self.window_size.num_cols, self.window_size.num_lines)
            != (next.num_cols, next.num_lines);
        let pixel_changed = (self.window_size.cell_width, self.window_size.cell_height)
            != (next.cell_width, next.cell_height);
        if !grid_changed && !pixel_changed {
            return;
        }

        if let Some(session) = &self.session {
            let mut notifier = nebula_terminal::event_loop::Notifier(session.notifier.0.clone());
            notifier.on_resize(next);
        }
        self.window_size = next;
    }
```

注意 `pixel_changed` 这条支线：行列没变、但设备像素口径变了（比如 DPI 缩放变了），照样上报 PTY——render.rs 硬规则第四条的用武之地，应用可能关心像素度量。

至此可以给「resize 是一次同步调用」正式判刑。它是一份三方合同：本地网格每帧跟手（便宜、可逆）；子进程尾沿去抖（昂贵、漂移累积）；结构性变化插队——没有后续帧可合并，等的每一毫秒都是不一致窗口期。**网格每帧跟手，子进程松手落定**——两种节奏不是 bug，是对两种代价的定价。

### 链条的另一半在事件循环

回写到这里并没有结束。`commit_viewport` 发出的 `notifier.on_resize(next)` 和 `resize_grid_only` 发出的 `on_resize_grid`，进的都是事件循环的 Msg 通道。消息定义自己解释了为什么两条消息必须同走一条通道。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_terminal/src/event_loop.rs（行 281–297）
    /// Reflow the local grid to a new geometry without telling the child.
    ///
    /// Keep local grid reflow separate from notifying the child. The legacy shell
    /// has always done this (`window_context/split.rs`: grids every drag tick,
    /// PTYs on settle). The
    /// two halves have opposite cost profiles: a client-side reflow is cheap and
    /// reversible, while every `ResizePseudoConsole` makes conhost rewrap its
    /// own buffer, and those rewraps accumulate cursor-row drift that nothing
    /// can undo. So the grid follows the pointer frame by frame — the viewport
    /// on screen is always a real reflow of the real geometry — and only the
    /// child is debounced.
    ///
    /// Goes through the same channel as `Resize` on purpose: the resize branch
    /// drains everything readable against the old geometry first, so absolute
    /// CUP sequences produced at the old width are never parsed into the new
    /// grid. A UI thread reaching into `Term::resize` directly would skip that.
    ResizeGrid(WindowSize),
```

事件循环把这些消息合并成唯一的 `PendingResize`，在流边界上按固定次序执行。先把旧几何下可读的字节全部消化；再锁 Term 重排网格；最后 `pty.on_resize`（Windows 上就是 `ResizePseudoConsole`）。提交之后，ConPTY 会重放内容、对齐光标。吸收这批回流字节的那套 ALIGN_DELAY 静默期与光标对账，就是 **ConPTY对账**——Windows 上 resize 不花屏的机制（[第 3 章](./03-pty-event-loop.md)）。

于是两章的分工可以精确表述：壳侧的 prepaint 回写裁定「何时提交、以什么几何提交」；事件循环侧的对账机器负责「提交之后不花屏」。回写少提交一次，对账就少吸收一轮重放；回写把手势挡在门外，对账的静默期就不会被连续打断。两半各守一段，合起来才是 resize 的完整合同。

还有一处细节收尾：启动时这套机器反着用。新 pane 的 spawn 网格继承自聚焦 pane 的现网格（或开窗反推的目标网格），让 PTY 出生即在目标几何附近；`STARTUP_GRID_GRACE` 的 400ms 宽限等待开窗 resize 落地——落定了就零下发收口，没落定才纠正一次。目的写在字段注释里：避免启动即触发一次 ConPTY resize，「DA 探询与回显竞态的温床」。

## 资源清理合同：不赌引用计数

最后一个问题：谁送走 PTY。

PTY 线程、shell 子进程、Windows 上的 conhost，都是实体外面的世界。实体死了，它们不会自动死。先替 Drop 直觉说句公道话：在普通 Rust 里，值离开作用域就 drop，RAII 是可靠的日常经验，教科书也没骗你。边界在于，GPUI 实体的生命周期由引用计数决定，不归词法作用域管——workspace 持有句柄、宿主订阅、重命名或拖拽状态，任何一处多留一拍，归零就晚一拍。而清理晚一拍，PTY 线程与子进程就多活一拍，用户看到的是关了 tab 但后台进程还挂着。

本壳的答案叫 **资源清理合同**：显式 shutdown 先行，Drop 兜底，幂等保平安。两个部件都很短：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/terminal/view.rs（行 720–725）
    /// 让 EventLoop 退出并回收 ConPTY/子进程。幂等：重复调用只会得到发送失败。
    pub fn shutdown(&self) {
        if let Some(session) = &self.session {
            let _ = session.notifier.0.send(Msg::Shutdown);
        }
    }
```

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/terminal/view.rs（行 1260–1266）
impl Drop for TerminalView {
    fn drop(&mut self) {
        // 兜底清理：无论视图以何种路径销毁（关 Tab、关窗口、退出应用），
        // 都保证 PTY 线程和子进程被回收。
        self.shutdown();
    }
}
```

`shutdown` 体内只发一条 `Msg::Shutdown`——清理的执行者还是事件循环自己，宿主只递辞呈。幂等是关键设计：重复调用只会得到一次发送失败，被 `let _ =` 吞掉。于是「显式调用 + Drop 兜底」两道保险可以重叠而不打架。

显式调用的分布值得数一遍：workspace.rs 里 `.shutdown();` 恰好 8 处。close_pane 的 Collapsed 分支 1 处、finish_close_tab 的循环 1 处；pane 替换路径 3 处、split 挂树失败的防御 2 处（实测数字见验证槽）。8 处里只有 2 处是「用户要求的关闭」，其余 6 处全是防御：替换失败、挂树失败这类「实体已经出生、但没能上岗」的路径，必须当场回收，否则就是孤儿 PTY。detach 的活体搬迁则反向印证——那条路绝不能调 shutdown，调了就把还活着的会话杀了。

**显式 shutdown 管业务语义上的结束，Drop 管物理上的最后兜底**。评审资源泄漏类改动时，检查清单就三问：每条「实体出生」路径是否都有对应的显式回收？防御路径失败时是否回收？Drop 是否只做兜底而不承担唯一清理责任？

## 演练：跟一次拖拽走完全链

把上面所有零件按时间串起来。在 Windows 上拖住窗口边框向内拽，然后松手：

1. 按下左键，进入 GPUI 的模态拖拽循环；布局逐帧重算，每帧都有一轮 prepaint。
2. 每帧 `TerminalElement::prepaint` 用 M 采样量出 cell 度量，`set_layout` 上报新的内容矩形。
3. `ViewportTracker.observe` 换算（floor、钳 2×1）判定 `grid_changed`，走 `resize_grid_only`：`Msg::ResizeGrid` 进通道。事件循环在流边界先消化旧宽度下的字节，再重排本地网格。屏幕逐帧 rewrap——你看到的「抖动」就是这一步，网格永远反映真实几何。
4. 同时 `set_layout` 把 viewport 放进 `pending_resize`，150ms settle 定时器启动。到点检查 `drag_gesture_active`——左键还按着，定时器自我续期。
5. 松手。下一个定时器到点、门开，`commit_viewport` 以 grid-before-PTY 次序下发 `Msg::Resize`。事件循环消化在途字节、锁 Term、`ResizePseudoConsole`。
6. ConPTY 重放内容回流，ALIGN_DELAY 静默期吸收，光标对账，屏幕落定。

对照探针把每一步钉在断言上（在 `courses/pebrel-course/companion` 目录执行）。

```bash
node scripts/probe-05-gpui-shell.mjs
```

28 条断言分成六组：三件套字段与合同注释（A 组）、close_pane 与 detach 的调用链（B 组）；prepaint 回写全路径（C 组）、换算合同（D 组）、手算重演（E 组）；shutdown + Drop 双保险（F 组）。末行 summary 会打印整条证据链摘要。

## 验证：先猜后跑

三项验证，每项都先落笔再执行。

一、手算换算。按下表把「先猜」两列写死，再跑探针对照 E 组输出：

| 内容矩形（逻辑 px） | cell（逻辑 px） | scale | 先猜 cols×rows | 先猜设备 cell |
|---|---|---|---|---|
| 803×607 | 10×20 | 1.0 | ？ | ？ |
| 9×5 | 10×20 | 1.0 | ？ | ？ |
| 640×480 | 8×16 | 1.3 | ？ | ？ |

对照点：探针输出应出现「80×30（floor 除法）」「钳到最小网格 2×1」「网格仍 80×30 但设备 cell 10×21」。第三行是关键一问：行列数与第一行相同，PTY 会收到通知吗？——会。`grid_eq` 成立但 `pixel_eq` 不成立，`commit_viewport` 照样下发。算错了就回看 `from_content_size` 的两行除法与 `device_cell_width` 的 round。

二、grep 计数。在锁定 clone 根目录执行，先猜数字再看输出：

```bash
grep -c "\.shutdown();" nebula_app/src/gpui_shell/workspace.rs
```

答案是 8。如果你猜的是 2——只数了关 pane 与关 tab 两条「正常路径」——就漏了 6 处防御性回收，而孤儿 PTY 恰恰从防御路径的缺口里漏出去。

三、纸上手术（定向破坏）。不改 clone、不改探针，在纸面上完成：把 `close_pane` Collapsed 分支里的 `pane.view.read(cx).shutdown();`（workspace.rs 行 1539）这一行删掉。先写两个离散预测再往下读。

预测一：探针 28 条里红几条？答案是恰好 1 条——「双保险调用面：恰 8 处」变 7 处而红。你可能预期「Collapsed 分支收尾链」那条也红。它居然还绿：那条断言查的是字符串存在于文件中，而同样的字符串在 split 防御路径与关 tab 循环里还有 3 份。它守的是「收尾链长什么样」，守不住「这里有没有一份」；守多唯一性的，是计数断言。

预测二：用户看得到什么？大多数时候什么都没有——Drop 兜底会在实体归零时补发同一条 `Msg::Shutdown`。真正暴露的是清理时机的所有权：从「业务语义上 pane 已结束」退化为「引用计数碰巧归零」。哪个句柄多留一拍（重命名状态、订阅缓存），PTY 线程、shell 子进程和 conhost 就多活一拍，且没有任何报错。不立即红、也不立即可见——这正是「Drop 可靠」这个直觉危险的地方。而树叶集合不变式相关的断言一条不变红：`remove_leaf` 与 `panes.remove` 还在，结构对账守的是「不出现幽灵 pane」，不守资源回收。

（在纸面上）把那行放回去，28 条恢复全绿。

## 迁移自查

1. 拖拽进行到一半时用户按下分屏快捷键。新 pane 出生后的第一次 `set_layout` 会走三分支里的哪条？它为什么等不起 150ms？（回查「burst + settle」一节的结构性分支注释。）
2. 一个 pane 先被 detach 成独立 tab，随后用户关掉原来的 tab。它身上的 PTY 会被回收几次？为什么两次路径都不会漏？（回查 pane 生命周期一节的搬迁注释与清理合同的幂等条款。）
3. Windows 显示缩放从 100% 调到 125%，假设窗口的逻辑尺寸与字号都不变。行列数变吗？PTY 收得到通知吗？（回查 `observe` 的两个判定与 render.rs 硬规则第四条。）

<details>
<summary>参考答案</summary>

1. 走结构性分支：`split_focused` 收尾时调用了 `mark_structural_resize`，下一次网格观测直接 `commit_viewport`，不进 pending。结构性变化只来一次，没有后续帧可以合并；多等的每一毫秒都是 Term（已按新网格渲染）与子进程（仍是旧几何）不一致的窗口期。
2. 一次。detach 不调 shutdown（活体搬迁，注释明令绝不能走 close_pane）；关原 tab 时它已经不在原 tab 的 panes 里，循环碰不到它。它自己的回收发生在之后关掉它所在的 tab 时。即便显式调用与 Drop 意外重叠，幂等合同保证只生效一次。
3. 行列不变（逻辑 cell 与内容矩形都没动），但设备 cell 变大，`pixel_eq` 不成立——PTY 收到一次携带新像素度量的 resize。这是刻意的：应用可能关心像素尺寸。

</details>

## 收束

开篇之问现在可以整句回答：渲染和 PTY 的尺寸谁说了算——换算合同说了算，而它只在 prepaint 时被喂数据。UI 层量完矩形就闭嘴，`ViewportTracker` 在 domain crate 里裁定行列，事件循环在流边界上消化、重排、下发，ConPTY 对账吸收回流。你看到的两种节奏也有名有姓：网格每帧跟手是便宜可逆的 reflow，松手落定是昂贵且漂移累积的 rewrap 被刻意攒成一次。Entity 是壳的细胞，pane 生命周期是户籍制度（纯数据布局树裁定 + Entity 持有 + 树叶集合不变式对账），资源清理合同保证死亡不赌引用计数。

本章新增四块积木：GPUI Entity——界面状态的最小居住单元，`.update()`/`cx` 即操作实体；prepaint 回写——渲染侧量矩形、换行列、回告 PTY 的单向合同；pane 生命周期——三件套与出生/关闭/搬迁的裁定链；资源清理合同——显式先行、Drop 兜底、幂等保平安。

下一站（[第 6 章](./06-ssh-session.md)）：同一套 Term 与渲染栈如何吃 SSH channel——传输层无关原则的地基就在本章的分层里。更远的路：pane 生命周期与 Entity 在 AI 事件归一中被调用（[第 9 章](./09-ai-lifecycle.md)）；三件套与树叶集合不变式在会话恢复里续用（[第 11 章](./11-session-persistence.md)）。
