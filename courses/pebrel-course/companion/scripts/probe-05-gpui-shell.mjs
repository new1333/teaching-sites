// 第 5 章 gpui-shell：GPUI 壳与 pane 生命周期。
// 对锁定 clone（.course/repo @ 360613aa）只读断言：workspace 三件套
// （panes + SplitTree + focused）字段形态、pane 关闭走 tree.remove_leaf
// 的调用链、终端元素 prepaint 阶段像素尺寸→行列换算→PTY resize 的回写
// 路径，以及显式 shutdown 与 Drop 兜底的双保险结构。
// 模块地图：set_layout 的实现不在 view.rs 本体，而在 view.rs 声明的
// `mod layout;` 子模块文件 terminal/view/layout.rs；workspace 的关闭/标题
// 条等逻辑同样落在 workspace.rs 声明的 workspace/ 子目录。先读模块声明
// 再定位文件（#[path] 重映射先例：element.rs 的 color_tests）。
// ConPTY 对账死线与 PendingResize 合并（event_loop 侧）由第 3 章探针负责，
// 本章只断言渲染侧回写与 pane/资源生命周期，不重复其断言面。
// E 组用自建最小输入按源码公式重演，不执行目标仓库代码。
import { requireRepo, readRepoFile, repoFileExists, makeProbe } from './lib/repo.js';

const probe = makeProbe('gpui-shell');
requireRepo();

const norm = (s) => s.replace(/\s+/g, ' ');

const ws = readRepoFile('nebula_app/src/gpui_shell/workspace.rs');
const paneHeader = readRepoFile('nebula_app/src/gpui_shell/workspace/pane_header.rs');
const view = readRepoFile('nebula_app/src/gpui_shell/terminal/view.rs');
// 模块地图定位：set_layout 住在 view.rs 声明的 `mod layout;` 里。
const layout = readRepoFile('nebula_app/src/gpui_shell/terminal/view/layout.rs');
const element = readRepoFile('nebula_app/src/gpui_shell/terminal/element.rs');
const render = readRepoFile('nebula_terminal/src/render.rs');
const main = readRepoFile('nebula_gpui/src/main.rs');

// ---- A. 最小入口与 workspace 三件套结构 --------------------------------------
probe.check(
  'nebula_gpui 是最小入口：main.rs 仅 3 行，全部工作委托 nebula_gpui::run_shell()',
  norm(main).trim() === 'fn main() { nebula_gpui::run_shell(); }',
);

probe.check(
  '模块地图：workspace.rs 声明 mod closing; 且文件落在 workspace/ 子目录（模块名 ≠ 文件位置）',
  /^mod closing;$/m.test(ws) && repoFileExists('nebula_app/src/gpui_shell/workspace/closing.rs')
    && /^mod layout;$/m.test(view)
    && repoFileExists('nebula_app/src/gpui_shell/terminal/view/layout.rs')
    && element.includes('#[path = "element/color_tests.rs"]'),
);

probe.check(
  '模块头生命周期合同逐字：三件套（panes + tree + focused）、「不变式：panes 的 id 集合 == 树的叶集合」、显式 shutdown + TerminalView::drop 兜底、prepaint 回写 set_layout',
  norm(ws).includes('每个 Terminal tab 持有 `panes`（实体属主）+ `tree`（`nebula_split`')
    && norm(ws).includes('布局树，叶 = pane id）+ `focused`。不变式：panes 的 id 集合 == 树的')
    && ws.includes('叶集合。')
    && ws.includes('会话清理走显式 `shutdown` +')
    && ws.includes('`TerminalView::drop` 兜底。')
    && norm(ws).includes('`TerminalElement` prepaint 回写')
    && norm(ws).includes('`set_layout`，resize 合并/提交合同（burst + settle）原样生效'),
);

probe.check(
  'WorkspaceTab::Terminal 三件套字段形态：panes: Vec<TerminalPane> + tree: SplitTree<u64> + focused: u64（另携 zoomed/broadcast）',
  ws.includes('panes: Vec<TerminalPane>,')
    && ws.includes('tree: SplitTree<u64>,')
    && ws.includes('focused: u64,')
    && ws.includes('zoomed: bool,')
    && ws.includes('broadcast: bool,'),
);

probe.check(
  '三件套各字段的合同注释：panes=实体属主（无序存储，按 id 查找）、tree=nebula_split 共享权威实现（叶 = pane id）、focused=键盘输入焦点与 split/close 动作的作用对象',
  ws.includes('/// pane 实体属主（无序存储，按 id 查找）。见模块头的生命周期合同。')
    && ws.includes('/// 分屏布局树（`nebula_split` 共享权威实现），叶 = pane id。')
    && ws.includes('/// 聚焦 pane：键盘输入焦点与 split/close 动作的作用对象。'),
);

probe.check(
  'TerminalPane：id: u64 + view: Entity<TerminalView> + _subscription；id 即 TerminalView::pane_id（AI hook 的 NEBULA_PANE_ID 同源），全工作区唯一、终生不复用',
  ws.includes('struct TerminalPane {')
    && ws.includes('id: u64,') && ws.includes('view: Entity<TerminalView>,')
    && ws.includes('/// 一个终端 pane：视图实体 + 宿主订阅。id 即 `TerminalView::pane_id`')
    && ws.includes('/// （AI hook 的 `NEBULA_PANE_ID` 同源），全工作区唯一、终生不复用。'),
);

probe.check(
  '组装证据：workspace.rs 直接消费第 4 章的纯数据布局树 crate——use nebula_split::{DIVIDER_GAP, HIT_SLOP, RemoveOutcome, SplitDirection, SplitNav, SplitTree}',
  ws.includes('use nebula_split::{DIVIDER_GAP, HIT_SLOP, RemoveOutcome, SplitDirection, SplitNav, SplitTree};'),
);

// ---- B. pane 关闭调用链：tree.remove_leaf 裁定 -------------------------------
const removeLeafSite = 'Some(WorkspaceTab::Terminal { tree, .. }) => tree.remove_leaf(pane_id),';
probe.check(
  'close_pane 由树裁定：workspace.rs 恰 1 处 tree.remove_leaf(pane_id) 调用点，三分支 NotFound / WasRoot→close_tab / Collapsed(next_focus) 齐全',
  ws.split(removeLeafSite).length - 1 === 1
    && ws.includes('RemoveOutcome::NotFound => {},')
    && ws.includes('RemoveOutcome::WasRoot => self.close_tab(tab_ix, window, cx),')
    && ws.includes('RemoveOutcome::Collapsed(next_focus) => {'),
);

probe.check(
  'Collapsed 分支收尾链：panes.remove(pos) → pane.view.read(cx).shutdown() → 焦点移交 if *focused == pane_id { *focused = next_focus; }',
  ws.includes('let pane = panes.remove(pos);')
    && ws.includes('pane.view.read(cx).shutdown();')
    && ws.includes('if *focused == pane_id {')
    && ws.includes('*focused = next_focus;'),
);

probe.check(
  '关整个 tab 逐 pane shutdown：finish_close_tab 对 panes 循环 record_pane_closed + shutdown + forget；注释声明「实体引用清零后 `TerminalView::drop` 再兜底」',
  ws.includes('for pane in panes {')
    && ws.includes('self.runtime_hub.record_pane_closed(self.runtime_window_id, pane.id);')
    && ws.includes('/// 逐 pane 回收会话；实体引用清零后 `TerminalView::drop` 再兜底。'),
);

probe.check(
  '第二个 remove_leaf 调用点（pane_header.rs 的 detach 到新 tab）：树与 panes 不同步时宁可不动也不搬迁——NotFound/WasRoot 直接 warn 返回，防孤儿 PTY',
  paneHeader.includes(removeLeafSite)
    && paneHeader.includes('log::warn!("detach_pane_to_new_tab: unexpected remove outcome for pane {pane_id}");')
    && paneHeader.includes('// 真出现 NotFound/WasRoot 说明树与 panes 已经不同步；此时啥都不做'),
);

// ---- C. prepaint 回写：像素尺寸 → 行列换算 → PTY resize ----------------------
probe.check(
  '元素不拥布局真相：prepaint 用 "M" 单字采样 shape_line 量出 cell_width / line_height（cell_width_for_advance / line_height_for_metrics，含 scale）',
  element.includes('SharedString::new_static("M"),')
    && element.includes('let cell_width = view.cell_width_for_advance(sample.width.as_f32(), scale);')
    && element.includes('view.line_height_for_metrics(sample.ascent.as_f32() + sample.descent.as_f32(), scale);'),
);

probe.check(
  '回写调用点逐字：view.update 内 view.set_layout(bounds.origin, cell_width, line_height, bounds.size, scale, cx)——元素只上报内容矩形与度量',
  element.includes('view.set_layout(bounds.origin, cell_width, line_height, bounds.size, scale, cx);')
    && element.includes('// 网格裁定（floor、最小网格、resize 合流）全部由渲染合同的')
    && element.includes('// ViewportTracker 在 view 内完成；元素只上报内容矩形与度量。'),
);

probe.check(
  '桥接点：TerminalView 渲染时把自身实体交给元素——root.child(TerminalElement::new(cx.entity()))',
  view.includes('root = root.child(TerminalElement::new(cx.entity()));'),
);

probe.check(
  'set_layout 换算入口：内容像素 + CellMetrics 交给渲染合同的 ViewportTracker——viewports.observe(content.width.as_f32(), content.height.as_f32(), &metrics)',
  layout.includes('pub fn set_layout(')
    && layout.includes('self.viewports.observe(content.width.as_f32(), content.height.as_f32(), &metrics);'),
);

probe.check(
  '网格与子进程两半分治：grid_changed 先 resize_grid_only（本地网格立刻跟手）；resize_grid_only 走 Msg::ResizeGrid「而不是直接锁 `Term`」，由 event_loop 先消化旧几何字节',
  layout.includes('if change.grid_changed {')
    && layout.includes('self.resize_grid_only(viewport);')
    && layout.includes('notifier.on_resize_grid(viewport.window_size());')
    && layout.includes('走 `Msg::ResizeGrid` 而不是直接锁 `Term`'),
);

probe.check(
  '结构性变化不去抖直commit、普通帧尾沿去抖：std::mem::take(&mut self.structural_resize) 即 commit_viewport；否则 pending_resize = Some(viewport) + schedule_settled_resize(cx)',
  layout.includes('if std::mem::take(&mut self.structural_resize) {')
    && layout.includes('self.commit_viewport(viewport);')
    && layout.includes('self.pending_resize = Some(viewport);')
    && layout.includes('self.schedule_settled_resize(cx);'),
);

probe.check(
  'PTY 下发出口：commit_viewport 注释 grid-before-PTY order，grid 或像素口径任一变化才 notifier.on_resize(next)（行列不变但像素变化也上报 PTY）',
  layout.includes('/// Commit one viewport in grid-before-PTY order.')
    && layout.includes('notifier.on_resize(next);')
    && layout.includes('let pixel_changed = (self.window_size.cell_width, self.window_size.cell_height)')
    && layout.includes('!= (next.cell_width, next.cell_height);'),
);

probe.check(
  'settle 节奏常量：RESIZE_SETTLE_DELAY = 150ms（尾沿去抖）、STARTUP_GRID_GRACE = 400ms（启动稳定闸）',
  view.includes('const STARTUP_GRID_GRACE: std::time::Duration = std::time::Duration::from_millis(400);')
    && view.includes('const RESIZE_SETTLE_DELAY: std::time::Duration = std::time::Duration::from_millis(150);'),
);

probe.check(
  '拖拽手势门控：drag_gesture_active 在 windows 读 VK_LBUTTON（GetAsyncKeyState）、非 windows 恒 false；手势未松开定时器自我续期（view.schedule_settled_resize(cx)）',
  layout.split('fn drag_gesture_active() -> bool {').length - 1 === 2
    && layout.includes('GetAsyncKeyState')
    && layout.includes('VK_LBUTTON')
    && layout.includes('#[cfg(not(windows))]')
    && layout.includes('view.schedule_settled_resize(cx);'),
);

// ---- D. 行列换算合同（nebula_terminal/src/render.rs）-------------------------
probe.check(
  '最小网格合同：MIN_COLS = 2 / MIN_ROWS = 1；换算先 floor 除法再钳最小网格——cols/rows 两行逐字',
  render.includes('pub const MIN_COLS: u16 = 2;')
    && render.includes('pub const MIN_ROWS: u16 = 1;')
    && render.includes('let cols = (width / metrics.cell_width.max(1.0)).floor().max(MIN_COLS as f32) as u16;')
    && render.includes('let rows = (height / metrics.cell_height.max(1.0)).floor().max(MIN_ROWS as f32) as u16;'),
);

probe.check(
  '稳态帧零开销 + PTY 尺寸口径：observe 在 grid_eq && pixel_eq 时返回 None；window_size() 以 num_lines=rows / num_cols=cols 上报 PTY',
  render.includes('if !grid_changed && !pixel_changed {')
    && render.includes('return None;')
    && render.includes('num_lines: self.rows,')
    && render.includes('num_cols: self.cols,'),
);

// ---- E. 自建最小输入重演（公式逐字取自 D 组源码形态，不执行仓库代码）--------
const fromContentSize = (width, height, cw, ch, scale) => {
  const cols = Math.max(Math.floor(width / Math.max(cw, 1.0)), 2);
  const rows = Math.max(Math.floor(height / Math.max(ch, 1.0)), 1);
  const dev = (v) => Math.max(Math.round(v * scale), 1);
  return { cols, rows, cell_width_px: dev(cw), cell_height_px: dev(ch) };
};
const gridEq = (a, b) => a.cols === b.cols && a.rows === b.rows;
const pixelEq = (a, b) => a.cell_width_px === b.cell_width_px && a.cell_height_px === b.cell_height_px;

const vp = fromContentSize(803.0, 607.0, 10.0, 20.0, 1.0);
const vpTiny = fromContentSize(9.0, 5.0, 10.0, 20.0, 1.0);
const vpDpi = fromContentSize(640.0, 480.0, 8.0, 16.0, 1.3);
probe.check(
  `换算重演：803×607 内容 / 10×20 cell → ${vp.cols}×${vp.rows}（floor 除法）；9×5 极小视口钳到最小网格 ${vpTiny.cols}×${vpTiny.rows}`,
  vp.cols === 80 && vp.rows === 30 && vpTiny.cols === 2 && vpTiny.rows === 1,
);
probe.check(
  `像素口径随 scale 换算：640×480 / 8×16 cell / scale 1.3 → 网格仍 ${vpDpi.cols}×${vpDpi.rows} 但设备 cell ${vpDpi.cell_width_px}×${vpDpi.cell_height_px}（grid_eq 同网格、pixel_eq 不同——PTY 仍需被告知）`,
  vpDpi.cols === 80 && vpDpi.rows === 30
    && vpDpi.cell_width_px === 10 && vpDpi.cell_height_px === 21
    && gridEq(vp, vpDpi) && !pixelEq(vp, vpDpi),
);
const steady = fromContentSize(803.0, 607.0, 10.0, 20.0, 1.0);
probe.check(
  '稳态帧语义重演：同一内容矩形第二帧 grid_eq && pixel_eq 均成立 → observe 返回 None（无变化不上报）',
  gridEq(vp, steady) && pixelEq(vp, steady),
);

// ---- F. shutdown + Drop 双保险 ----------------------------------------------
probe.check(
  '显式 shutdown 合同逐字：「让 EventLoop 退出并回收 ConPTY/子进程。幂等：重复调用只会得到发送失败。」——体内只发 Msg::Shutdown',
  view.includes('/// 让 EventLoop 退出并回收 ConPTY/子进程。幂等：重复调用只会得到发送失败。')
    && view.includes('pub fn shutdown(&self) {')
    && view.includes('let _ = session.notifier.0.send(Msg::Shutdown);'),
);

const dropSection = view.slice(view.indexOf('impl Drop for TerminalView'), view.indexOf('impl Focusable for TerminalView'));
probe.check(
  'Drop 兜底逐字：「兜底清理：无论视图以何种路径销毁（关 Tab、关窗口、退出应用），都保证 PTY 线程和子进程被回收」——drop() 体内即 self.shutdown()',
  dropSection.includes('impl Drop for TerminalView')
    && dropSection.includes('// 兜底清理：无论视图以何种路径销毁（关 Tab、关窗口、退出应用），')
    && dropSection.includes('// 都保证 PTY 线程和子进程被回收。')
    && dropSection.includes('self.shutdown();'),
);

const shutdownSites = ws.split('.shutdown();').length - 1;
probe.check(
  `双保险调用面：workspace.rs 显式 shutdown 调用点恰 8 处（实测 ${shutdownSites}）——close_pane Collapsed 分支、关 tab 循环、split 挂树失败防御路径`,
  shutdownSites === 8,
);

// ---- 摘要（milestone_verify 要求输出 pane 生命周期证据链）--------------------
console.log(
  `summary [gpui-shell] triple=panes:Vec<TerminalPane>+tree:SplitTree<u64>+focused:u64 (invariant: pane ids == leaves); ` +
  `close chain=close_pane -> tree.remove_leaf -> {WasRoot=>close_tab | Collapsed=>panes.remove+shutdown+focused=next_focus}; ` +
  `tab close=for pane {record_pane_closed+shutdown+forget}; ` +
  `writeback=element prepaint('M' sample -> cell metrics) -> set_layout -> viewports.observe(px->floor grid, MIN 2x1) ` +
  `-> grid_changed?resize_grid_only(Msg::ResizeGrid) : structural?commit_viewport : settle(150ms, drag-gate self-renew) -> on_resize(Msg::Resize, grid-before-PTY); ` +
  `cleanup=explicit shutdown(Msg::Shutdown, idempotent) + Drop fallback; explicit shutdown sites in workspace.rs=${shutdownSites}`,
);

probe.done();
