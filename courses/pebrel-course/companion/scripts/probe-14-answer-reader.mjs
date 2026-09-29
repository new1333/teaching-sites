// 第 14 章 answer-reader：AI 回答阅读器 —— 共享管线的复用范式。
// 对锁定 clone（.course/repo @ 360613aa）只读断言本章 milestone：
// 1) 回答捕获：hook 信封解析处调用 AssistantAnswer::from_hook（三态
//    Complete/Missing/TooLarge + 128 KiB 上限 + 两 CLI 的字段映射），
//    AnswerInbox 按 pane/session 绑定，不做屏幕猜测；
// 2) 打开路径：open_answer 取 answers.latest 构造 AnswerReader，渲染时
//    整个终端 pane 被阅读器替换；
// 3) 文档 tab 模型：WorkspaceTab 里 Document 与 Terminal 并列，
//    text_document 的 TextSnapshot 被本地 file_editor 与 SFTP 双路径共享；
// 4) 复用调用链（阅读器侧）：阅读器模块自身零 TeX 代码，公式经组件库
//    TextView 的公式渲染钩子（math_view::register → set_math_renderer）→
//    MathAssets::layout → scientific_render 单点分发
//    compile_formula/compile_formula_source；文档 tab 渲染器 markdown_view
//    的 2 处非测试调用点同样传入 DEFAULT_LIMITS；
// 5) 无 WebView：全源码树与两份 Cargo 清单无 webview/wry/cef/electron。
// 所有断言取自锁定 ref 上的静态文件内容，不执行目标仓库代码。
import fs from 'node:fs';
import path from 'node:path';
import { requireRepo, readRepoFile, makeProbe } from './lib/repo.js';

const probe = makeProbe('answer-reader');
const root = requireRepo();

// CRLF 检出：读入即剥 \r；跨行比对再用 norm() 归一空白（既有探针先例）。
// 头注释句子跨 `//!` 行书写：先剥行首文档注释标记再归一，整句才能比对。
const read = (rel) => readRepoFile(rel).replace(/\r/g, '');
const norm = (s) => s.replace(/\s+/g, ' ');
const normDoc = (s) => norm(s.replace(/^\s*\/\/[!/]?/gm, ''));

const capture = read('nebula_app/src/assistant_answer.rs');
const readerDoc = read('nebula_app/src/assistant_answer/document.rs');
const protocol = read('nebula_app/src/ai_hook/protocol.rs');
const agentActivity = read('nebula_app/src/gpui_shell/terminal/view/agent_activity.rs');
const terminalView = read('nebula_app/src/gpui_shell/terminal/view.rs');
const reader = read('nebula_app/src/gpui_shell/terminal/answer_reader.rs');
const textDocument = read('nebula_app/src/text_document.rs');
const workspace = read('nebula_app/src/gpui_shell/workspace.rs');
const docTabs = read('nebula_app/src/gpui_shell/doc_tabs.rs');
const shellMod = read('nebula_app/src/gpui_shell/mod.rs');
const mathView = read('nebula_app/src/gpui_shell/math_view.rs');
const scientificRender = read('nebula_app/src/gpui_shell/scientific_render.rs');
const markdownMod = read('nebula_app/src/markdown/mod.rs');
const markdownView = read('nebula_app/src/display/markdown_view.rs');

// ---- A. 回答捕获：hook → AssistantAnswer 三态 → AnswerInbox -------------------
probe.check(
  '捕获发生在 hook 信封解析处：ai_hook/protocol.rs 调 `crate::assistant_answer::AssistantAnswer::from_hook(&source, &payload)`，回答随事件对象流进 UI，而非屏幕抓取',
  protocol.includes('let answer = crate::assistant_answer::AssistantAnswer::from_hook(&source, &payload);'),
);
probe.check(
  'AssistantAnswer 是三态模型：Complete(Arc<str>) / Missing / TooLarge { bytes }；MAX_ANSWER_BYTES = 128 * 1024（超限报 TooLarge、保留终端内容不截断渲染）',
  norm(capture).includes('pub enum AssistantAnswer { Complete(Arc<str>), Missing, TooLarge { bytes: usize }, }')
    && capture.includes('pub const MAX_ANSWER_BYTES: usize = 128 * 1024;')
    && capture.includes('MAX_ANSWER_BYTES / 1024'),
  undefined,
);
probe.check(
  '两个 CLI 的字段映射不同：claude Stop 与 codex Stop 读 `last_assistant_message`（下划线），codex agent-turn-complete 读 `last-assistant-message`（连字符）；其余事件返回 None',
  norm(capture).includes('"claude" if payload.get("hook_event_name")?.as_str()? == "Stop" => { "last_assistant_message" },')
    && norm(capture).includes('if payload.get("type").and_then(Value::as_str) == Some("agent-turn-complete") => { "last-assistant-message" }'),
);
probe.check(
  'AnswerInbox::observe(event, pane_id) 按 pane + (source, session_id) 身份绑定回答；agent_activity.rs 在终端视图内调 `self.answers.observe(event, self.pane_id)`，捕获范围是本 pane 的会话',
  /pub fn observe\(\s*&mut self, event: &crate::ai_hook::AiHookEvent, pane_id: u64\) -> bool/.test(capture)
    && norm(agentActivity).includes('&& self.answers.observe(event, self.pane_id)'),
);

// ---- B. 打开路径：open_answer → AnswerReader 整 pane 替换 ---------------------
probe.check(
  '打开路径：terminal/view.rs 的 open_answer 取 `self.answers.latest.clone()` 构造 `AnswerReader::new(snapshot, cx)`，存入 self.answer_reader 并订阅 ReaderEvent::Close 关闭回焦',
  terminalView.includes('fn open_answer(&mut self, window: &mut Window, cx: &mut Context<Self>) {')
    && terminalView.includes('let Some(snapshot) = self.answers.latest.clone() else { return };')
    && terminalView.includes('let reader = cx.new(|cx| super::answer_reader::AnswerReader::new(snapshot, cx));')
    && norm(terminalView).includes('|view, _, _: &super::answer_reader::ReaderEvent, window, cx| { view.answer_reader = None;'),
);
probe.check(
  '阅读器打开后替换整个终端 pane 渲染：Render for TerminalView 首行 `if let Some(reader) = &self.answer_reader { return div().size_full().child(reader.clone()).into_any_element(); }`',
  norm(terminalView).includes('if let Some(reader) = &self.answer_reader { return div().size_full().child(reader.clone()).into_any_element(); }'),
);
probe.check(
  'AnswerReader 用组件库 TextView 呈现：`TextViewState::markdown("", cx)` 双份（渲染/原文两态），准备阶段后台跑 `document::prepare(&source)` 做分隔符归一与图片占位',
  (reader.match(/TextViewState::markdown\("", cx\)/g) || []).length === 2
    && reader.includes('cx.background_spawn(async move { document::prepare(&source) })'),
);

// ---- C. 文档 tab 模型：与终端 tab 并列、双后端共享一份文本模型 ----------------
const enumStart = workspace.indexOf('enum WorkspaceTab {');
const enumBody = workspace.slice(enumStart, workspace.indexOf('\n}', enumStart));
const variants = [...enumBody.matchAll(/^ {4}(\w+) \{$/gm)].map((m) => m[1]);
probe.check(
  'WorkspaceTab 枚举恰好 5 个变体：Terminal / Settings / Image / Document / Code —— 文档 tab 与终端 tab 在同一枚举里并列，不是另一棵窗口树',
  variants.length === 5 && ['Terminal', 'Settings', 'Image', 'Document', 'Code'].every((v, i) => variants[i] === v),
  `实测 [${variants.join(', ')}]`,
);
probe.check(
  'Document 变体持有 `Entity<crate::gpui_shell::doc_tabs::DocTabView>`，注释声明『Markdown/文本文档 tab（文件树双击可读文本进入；旧壳 doc tab 同形态）』；doc_tabs.rs 把 DocTabView 重导出为 file_editor::TextFileView',
  norm(enumBody).includes('Document { view: Entity<crate::gpui_shell::doc_tabs::DocTabView>, _subscription: Subscription, }')
    && workspace.includes('/// Markdown/文本文档 tab（文件树双击可读文本进入；旧壳 doc tab 同形态）。')
    && docTabs.includes('pub use super::file_editor::{TextFileEvent as DocTabViewEvent, TextFileView as DocTabView};'),
);
probe.check(
  '文档 tab 入口路由三分支：doc_tabs.rs 的 openable_in_app = image_viewer::viewable_file || markdown_view::viewable_file || code_tab::viewable_file',
  docTabs.includes('crate::display::image_viewer::viewable_file(path)')
    && docTabs.includes('crate::display::markdown_view::viewable_file(path)')
    && docTabs.includes('crate::gpui_shell::code_tab::viewable_file(path)'),
);
probe.check(
  'text_document.rs 头注释声明『Renderer-independent text snapshots shared by local and SFTP documents』；MAX_BYTES = 8 * 1024 * 1024；decode 把 truncated/invalid_encoding 一律并入 read_only（超限/二进制快照永不变成可写）',
  textDocument.includes('//! Renderer-independent text snapshots shared by local and SFTP documents.')
    && textDocument.includes('pub(crate) const MAX_BYTES: usize = 8 * 1024 * 1024;')
    && textDocument.includes('read_only: read_only || truncated || invalid_encoding'),
);
probe.check(
  '同一份 TextSnapshot 被本地与远端两条 tab 路径共享：file_editor/document.rs、file_editor/source.rs（本地）与 ssh_sftp/document.rs、ssh_sftp/transaction.rs（SFTP）都 use crate::text_document',
  read('nebula_app/src/gpui_shell/file_editor/document.rs').includes('use crate::text_document::')
    && read('nebula_app/src/gpui_shell/file_editor/source.rs').includes('use crate::text_document::')
    && read('nebula_app/src/ssh_sftp/document.rs').includes('use crate::text_document::')
    && read('nebula_app/src/ssh_sftp/transaction.rs').includes('use crate::text_document::'),
);
probe.check(
  '文本模型不感知 markdown 之外的东西：markdown/mod.rs 头注释『This module owns ONLY parsing and the parsed representation — no rendering, no Display state, no UI types』（空白归一比对），并把绘制方指到 display::markdown_view；阅读器准备阶段只设 GFM + math_flow/math_text 两个开关',
  normDoc(markdownMod).includes('This module owns ONLY parsing and the parsed representation — no rendering, no Display state, no UI types.')
    && normDoc(markdownMod).includes('The viewer that draws these values lives in `display::markdown_view`.')
    && readerDoc.includes('ParseOptions::gfm()')
    && readerDoc.includes('options.constructs.math_flow = true;')
    && readerDoc.includes('options.constructs.math_text = true;'),
);

// ---- D. 复用调用链：一个编译入口，两处调用点，零份拷贝 -------------------------
probe.check(
  '复用而非复制（反面证据）：answer_reader.rs 与 assistant_answer/document.rs 全文 0 处 compile_formula / parse_formula / crate::math / rasteriz 引用 —— 阅读器不自带任何 TeX 管线代码',
  !/compile_formula|parse_formula|crate::math|rasteriz/.test(reader)
    && !/compile_formula|parse_formula|crate::math/.test(readerDoc),
);
probe.check(
  '阅读器侧公式经组件库钩子接入共享管线：gpui_shell/mod.rs 注释『TextView 的公式渲染钩子：旧壳数学管线（compile → 栅格化）接入组件库的 markdown 渲染；不注册时公式回退为源码文本』并调用 `math_view::register(cx);`',
  norm(shellMod).includes('// TextView 的公式渲染钩子：旧壳数学管线（compile → 栅格化）接入组件库 // 的 markdown 渲染；不注册时公式回退为源码文本。 math_view::register(cx);')
    && shellMod.includes('    math_view::register(cx);'),
);
probe.check(
  '钩子注册点是全局唯一：math_view.rs 的 register 调 `gpui_component::text::set_math_renderer(cx, ...)`，闭包先探针编译 `assets.layout(&spec.source, spec.display, PROBE_PX, 1.0)?`，失败即让组件库回退源码文本',
  mathView.includes('gpui_component::text::set_math_renderer(cx, |spec, window, cx| {')
    && mathView.includes('assets.layout(&spec.source, spec.display, PROBE_PX, 1.0)?;'),
);
probe.check(
  '钩子到底落在共享编译入口：MathAssets::layout 转交 `self.engine.layout(FormulaKey::new(...))`，scientific_render.rs 的 Job 分发处 `let compile = if key.verbatim { compile_formula_source } else { compile_formula };`（同一行二选一，import 来自 crate::math）',
  mathView.includes('self.engine.layout(FormulaKey::new(')
    && scientificRender.includes('let compile = if key.verbatim { compile_formula_source } else { compile_formula };')
    && scientificRender.includes('use crate::math::{DEFAULT_LIMITS, compile_formula, compile_formula_source};'),
);
const viewCode = markdownView.slice(0, markdownView.indexOf('#[cfg(test)]'));
const compileCalls = viewCode.match(/compile_formula\s*\(/g) || [];
probe.check(
  '文档 tab 渲染器 display/markdown_view.rs 的非测试代码恰好 2 处 `compile_formula(` 调用点（measure_math 缓存填充 + 绘制期缓存回填），且都以 DEFAULT_LIMITS 收参 —— 与终端覆盖层同一入口，未另写编译实现',
  compileCalls.length === 2
    && viewCode.includes('use crate::math::{DEFAULT_LIMITS, MIN_READABLE_MATH_PX, compile_formula};')
    && compileCalls.length === (viewCode.match(/compile_formula\([\s\S]{0,400}?DEFAULT_LIMITS/g) || []).length,
  `实测 ${compileCalls.length} 处非测试调用`,
);
probe.check(
  '阅读器路径持有同一条可读底线：math_view.rs 的 fit() 在 `fitted_size < MIN_READABLE_MATH_PX` 时返回 None（回退源码文本），头注释声明『失败合同与旧壳一致：编译失败/超预算/缩到 MIN_READABLE_MATH_PX 之下的公式回退为源码文本』（剥注释标记后空白归一比对）；常量 import 自 crate::math，不在阅读器侧重定义',
  mathView.includes('if fitted_size < MIN_READABLE_MATH_PX {')
    && mathView.includes('use crate::math::MIN_READABLE_MATH_PX;')
    && normDoc(mathView).includes('失败合同与旧壳一致：编译失败/超预算/缩到')
    && normDoc(mathView).includes('的公式回退为源码文本（组件库侧代码样式）'),
);

// ---- E. 无 WebView 的结构证据 -------------------------------------------------
const forbidden = /\bwebview\b|\bwry\b|webview2|\bcef\b|electron/i;
const offenders = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.rs') && forbidden.test(read(path.relative(root, full).split(path.sep).join('/')))) {
      offenders.push(path.relative(root, full));
    }
  }
};
walk(path.join(root, 'nebula_app', 'src'));
const manifests = [read('nebula_app/Cargo.toml'), read('Cargo.toml')];
probe.check(
  '无 WebView：nebula_app/src 全部 .rs 文件与根/应用两份 Cargo.toml 中 0 处 webview / wry / webview2 / cef / electron —— 阅读器是 GPUI 原生渲染（默认 feature gpui-shell），公式位图由共享管线合成后 paint_image 上屏',
  offenders.length === 0 && !manifests.some((m) => forbidden.test(m)),
  offenders.join(', ') || undefined,
);

// ---- 摘要（milestone_verify：输出复用调用点证据）------------------------------
console.log(
  `summary [answer-reader] reuse chain: answer_reader(TextView) -> math_view::register -> set_math_renderer probe(assets.layout @ PROBE_PX) -> ScientificRender Job::Layout -> {compile_formula | compile_formula_source} @ crate::math; ` +
  `doc-tab renderer display/markdown_view.rs: 2 non-test compile_formula call sites (DEFAULT_LIMITS); ` +
  `reader modules with own TeX code: 0; workspace tabs: [${variants.join(', ')}]; ` +
  `capture: protocol.rs from_hook -> AssistantAnswer{Complete|Missing|TooLarge} @128KiB -> AnswerInbox::observe(pane_id); webview tokens: 0`,
);

probe.done();
