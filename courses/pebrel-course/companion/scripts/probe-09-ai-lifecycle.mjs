// 第 9 章 ai-lifecycle：事件归一与门控排序——从原始载荷到类型化状态机。
// 对锁定 clone（.course/repo @ 360613aa）只读断言宿主侧事件管线的分层依赖流：
// transport -> protocol/payload -> typed events -> ordering -> pane lifecycle。
// 覆盖：五层模块划分、parse_envelope 信封解析与载荷形状校验、GateVerdict
// 的 6 条拒绝路径（带原因）、批次重排 reorder_batch、UI 适配器只消费共享
// 生命周期（AgentActivity），以及 AiHookCapabilities 能力集的表示。
// 边界：钩子桥进程（nebula_hook）与管道环境变量哨兵由第 8 章探针负责，
// 本章只在宿主侧取证（transport.rs 的 parse_envelope 调用点，不碰 env 常量）。
// clone 为 CRLF 检出：行锚定正则先统一 \n，跨行文档句先剥注释前缀再归一空白。
// 所有断言取自锁定 ref 上的静态文件内容，不执行目标仓库代码。
import { requireRepo, readRepoFile, repoFileExists, makeProbe } from './lib/repo.js';

const probe = makeProbe('ai-lifecycle');
requireRepo();

// 红绿纪律：首轮以错误预期值 2_000 运行观察到 1 处预期 FAIL（实测值 1_500），已改回真实值转绿。
const DUP_WINDOW_EXPECTED = '1_500';

const unix = (s) => s.replace(/\r\n/g, '\n');
// 剥掉 //、///、//! 注释前缀后按空白归一，拼回跨行文档句。
const flat = (s) =>
  unix(s)
    .split('\n')
    .map((l) => l.replace(/^\s*\/\/!?\/?\s?/, ''))
    .join(' ')
    .replace(/\s+/g, ' ');

const HOST = 'nebula_app/src/ai_hook.rs';
const ORDERING = 'nebula_app/src/ai_hook/ordering.rs';
const EVENT = 'nebula_app/src/ai_hook/event.rs';
const PROTOCOL = 'nebula_app/src/ai_hook/protocol.rs';
const PAYLOAD = 'nebula_app/src/ai_hook/payload.rs';
const LIFECYCLE = 'nebula_app/src/ai_hook/lifecycle.rs';
const TRANSPORT = 'nebula_app/src/ai_hook/win/transport.rs';
const GPUI_ADAPTER = 'nebula_app/src/gpui_shell/terminal/view/agent_activity.rs';
const LEGACY_ADAPTER = 'nebula_app/src/window_context/agent_activity.rs';
const WINDOWING = 'nebula_app/src/gpui_shell/workspace/windowing.rs';

const layerFiles = [HOST, ORDERING, EVENT, PROTOCOL, PAYLOAD, LIFECYCLE, TRANSPORT, GPUI_ADAPTER, LEGACY_ADAPTER, WINDOWING];
probe.check('十个证据文件（五层 + 两个 UI 壳适配器 + 批次分发口）都在锁定 ref 上存在', layerFiles.every(repoFileExists));

const host = unix(readRepoFile(HOST));
const ordering = unix(readRepoFile(ORDERING));
const event = unix(readRepoFile(EVENT));
const protocol = unix(readRepoFile(PROTOCOL));
const payload = unix(readRepoFile(PAYLOAD));
const lifecycle = unix(readRepoFile(LIFECYCLE));
const transport = unix(readRepoFile(TRANSPORT));
const gpuiAdapter = unix(readRepoFile(GPUI_ADAPTER));
const legacyAdapter = unix(readRepoFile(LEGACY_ADAPTER));
const windowing = unix(readRepoFile(WINDOWING));

// ---- A. 五层模块划分 ---------------------------------------------------------
probe.check(
  'ai_hook.rs 模块头依赖流逐字：transport -> protocol/payload -> typed events -> ordering -> pane lifecycle',
  flat(host).includes('transport -> protocol/payload -> typed events -> ordering -> pane lifecycle.'),
);
probe.check(
  '五个层各有自己的文件：mod event/ordering/payload/protocol + pub(crate) mod lifecycle，transport 住在 win/transport.rs',
  /^mod event;$/m.test(host) && /^mod ordering;$/m.test(host) && /^mod payload;$/m.test(host)
    && /^mod protocol;$/m.test(host) && /^pub\(crate\) mod lifecycle;$/m.test(host)
    && transport.includes('//! Windows named-pipe transport. Supplies kernel process identity to parsed events.'),
);
probe.check(
  '分层靠再导出接线：pub use ordering::GateVerdict + pub(crate) use ordering::{accept_for_pane, reorder_batch} + use protocol::parse_envelope + event 层导出 AiHookCapabilities',
  host.includes('pub use ordering::GateVerdict;')
    && host.includes('pub(crate) use ordering::{accept_for_pane, reorder_batch};')
    && host.includes('use protocol::parse_envelope;')
    && host.includes('pub use event::{\n    AiBackgroundTasks, AiHookCapabilities, AiHookEvent, AiHookKind, AiPermissionMode,'),
);
probe.check(
  '模块头 UI 适配器合同逐字（归一后）：UI adapters render the shared lifecycle … never reinterpret a completed hook by scanning terminal prose … Screen evidence is an explicit fallback for capabilities absent from the active integration',
  flat(host).includes('UI adapters render the shared lifecycle and deliver its notifications. They never reinterpret a completed hook by scanning terminal prose. Screen evidence is an explicit fallback for capabilities absent from the active integration.'),
);
probe.check(
  'typed events 层自述纯度逐字：Normalized provider facts. No terminal scanning, I/O or pane mutation.',
  event.includes('//! Normalized provider facts. No terminal scanning, I/O or pane mutation.'),
);

// ---- B. parse_envelope 入口与载荷形状校验 -----------------------------------
probe.check(
  '入口签名（protocol.rs:19）：pub(super) fn parse_envelope(bytes: &[u8]) -> Option<AiHookEvent>',
  protocol.includes('pub(super) fn parse_envelope(bytes: &[u8]) -> Option<AiHookEvent> {'),
);
probe.check(
  '信封是头行 + 原样 JSON（归一后）：a `nebula-hook/1 source=<s> pane=<n>` header line, then the hook\'s raw JSON payload verbatim（helper 绝不重编码）',
  flat(protocol).includes('Parse one pipe message: a `nebula-hook/1 source=<s> pane=<n>` header line, then the hook\'s raw JSON payload verbatim (the helper never re-encodes; all JSON work happens here, off the turn\'s hot path).'),
);
probe.check(
  '信封头校验：首 token 不是 nebula-hook/1 直接 None（if fields.next() != Some("nebula-hook/1")），source 缺失也 None（let source = source?;）',
  protocol.includes('if fields.next() != Some("nebula-hook/1") {')
    && protocol.includes('return None;\n    }\n    let (mut source, mut pane, mut codex_mode, mut native_event)')
    && protocol.includes('let source = source?;'),
);
probe.check(
  '载荷形状校验：解析失败的 JSON 落为 Value::Null（serde_json::from_slice(raw).unwrap_or(Value::Null)），后续按 source 分支读形状',
  protocol.includes('let payload: Value = serde_json::from_slice(raw).unwrap_or(Value::Null);'),
);
probe.check(
  '串台第二道门逐字：别家 hook runner 的 camelCase 形状被拒——"claude" if payload.get("hookEventName").is_some() => return None',
  protocol.includes('"claude" if payload.get("hookEventName").is_some() => return None,')
    && protocol.includes('"cursor" if payload.get("hookEventName").is_some() => return None,'),
);
probe.check(
  '会话身份候选键按 source 收紧：claude|kimi 只认 session_id（绝不读 camelCase），codex notify 只认 thread-id',
  protocol.includes('"claude" | "kimi" => &["session_id"],')
    && protocol.includes('"codex" => &["thread-id"],'),
);
probe.check(
  '未知事件名丢弃（载荷形状不符即 None）：claude 分支 _ => return None，且 SubagentStop 类噪音被注释点名；payload 层 MESSAGE_MAX_CHARS = 300',
  protocol.includes('// SubagentStop and friends would only produce noise.')
    && payload.includes('pub(super) const MESSAGE_MAX_CHARS: usize = 300;')
    && flat(payload).includes('Untyped legacy notifications remain parseable; the lifecycle only admits them during an active turn.'),
);
probe.check(
  'transport 层唯一生产调用点（transport.rs:131）：&& let Some(mut event) = parse_envelope(&buf)，全文件恰 1 处',
  transport.includes('&& let Some(mut event) = parse_envelope(&buf)')
    && (transport.split('parse_envelope(&buf)').length - 1) === 1,
);
probe.check(
  '远端变体：parse_remote_envelope(bytes, pane) 复用 parse_envelope，Pane 身份始终由本地 PTY 通道覆盖（防远端载荷改道路由）',
  protocol.includes('pub(crate) fn parse_remote_envelope(bytes: &[u8], pane: Option<u64>) -> Option<AiHookEvent> {')
    && protocol.includes('let mut event = parse_envelope(bytes)?;')
    && flat(protocol).includes('远端会话只能提交事件语义，Pane 身份始终由本地 PTY 通道覆盖，'),
);

// ---- C. GateVerdict 变体与拒绝路径 ------------------------------------------
const verdictEnum = ordering.slice(ordering.indexOf('pub enum GateVerdict {'), ordering.indexOf('impl GateVerdict {'));
const verdictVariants = [
  'Accepted', 'DuplicateEventId', 'StaleSequence', 'StaleTime',
  'DuplicateFingerprint', 'AfterSessionEnd', 'UnorderedAfterDone',
];
const variantLines = verdictVariants.filter((v) => new RegExp(`^    ${v},$`, 'm').test(verdictEnum));
probe.check(
  `GateVerdict 恰 ${verdictVariants.length} 个变体：Accepted + 6 条拒绝原因（实测 ${variantLines.length} 个）`,
  variantLines.length === 7,
);
probe.check(
  '枚举文档逐字（首行）：事件门的判定结果。带原因，而不只是一个 bool——「通知没出现」这类问题事后唯一的线索就是这个原因',
  flat(ordering).includes('事件门的判定结果。带原因，而不只是一个 bool——「通知没出现」这类问题事后')
    && flat(ordering).includes('唯一的线索就是这个原因，日志里必须说得出是哪一条规则拦的。'),
);
probe.check(
  'accepted() 谓词：pub fn accepted(self) -> bool，体内即 self == Self::Accepted',
  ordering.includes('pub fn accepted(self) -> bool {') && ordering.includes('self == Self::Accepted'),
);
const rejectReturns = verdictVariants.slice(1).filter((v) => ordering.includes(`return GateVerdict::${v};`));
probe.check(
  `6 条拒绝路径各有 return GateVerdict::<X>; 拒绝点（实测 ${rejectReturns.length}/6），全文件 return GateVerdict:: 恰 6 处`,
  rejectReturns.length === 6 && (ordering.split('return GateVerdict::').length - 1) === 6,
);
probe.check(
  '迟到/重放拒绝：序号不比上一次大 → StaleSequence（provider_order != Greater）；没有序号但时间戳更早 → StaleTime',
  ordering.includes('if provider_order.is_some_and(|order| order != std::cmp::Ordering::Greater) {')
    && ordering.includes('if provider_order.is_none() && time_order == Some(std::cmp::Ordering::Less) {')
    && ordering.includes('let strictly_newer = provider_order == Some(std::cmp::Ordering::Greater)'),
);
probe.check(
  '会话终态拒绝：SessionEnd 后只有 SessionStart 能复活 → AfterSessionEnd（StreamLifecycle::Ended if event.kind != AiHookKind::SessionStart）',
  ordering.includes('StreamLifecycle::Ended if event.kind != AiHookKind::SessionStart => {')
    && flat(ordering).includes('该 session 已经 SessionEnd，只有 SessionStart 能复活。'),
);
probe.check(
  'Done 后乱序拒绝：Done 状态的 ToolComplete 无更新证据 → UnorderedAfterDone；唯一逃生口是 capabilities().serialized_delivery && bridge_sequence.is_some()',
  ordering.includes('if event.kind == AiHookKind::ToolComplete')
    && ordering.includes('&& !strictly_newer')
    && ordering.includes('&& !(event.capabilities().serialized_delivery')
    && ordering.includes('&& event.bridge_sequence.is_some()) =>')
    && ordering.includes('return GateVerdict::UnorderedAfterDone;'),
);
probe.check(
  '有界去重常量：MAX_TRACKED_STREAMS=512、MAX_EVENT_IDS_PER_STREAM=64、DUPLICATE_WINDOW_MS=1_500（无身份元数据的终态指纹去重窗口）',
  ordering.includes('const MAX_TRACKED_STREAMS: usize = 512;')
    && ordering.includes('const MAX_EVENT_IDS_PER_STREAM: usize = 64;')
    && ordering.includes(`const DUPLICATE_WINDOW_MS: u64 = ${DUP_WINDOW_EXPECTED};`)
    && ordering.includes('&& event.received_at_ms.saturating_sub(at) <= DUPLICATE_WINDOW_MS'),
);
const streamLifecycle = ordering.slice(ordering.indexOf('enum StreamLifecycle {'), ordering.indexOf('#[derive(Debug)]\nstruct AiHookStreamState'));
probe.check(
  '流状态机 4 态 Active/Blocked/Done/Ended；TurnDone 时 active_background_tasks() > 0 仍保持 Active（后台任务未收工不算完成）',
  /^\s{4}Active,$/m.test(streamLifecycle) && /^\s{4}Blocked,$/m.test(streamLifecycle)
    && /^\s{4}Done,$/m.test(streamLifecycle) && /^\s{4}Ended,$/m.test(streamLifecycle)
    && ordering.includes('AiHookKind::TurnDone if event.active_background_tasks() > 0 => StreamLifecycle::Active,'),
);
probe.check(
  '全进程一扇门：accept_for_pane(event, pane_id) -> GateVerdict，内部 EVENT_GATE.lock()…verdict(event, pane_id)，verdict() 核心在最终 pane 解析后裁定',
  ordering.includes('pub(crate) fn accept_for_pane(event: &AiHookEvent, pane_id: u64) -> GateVerdict {')
    && ordering.includes('EVENT_GATE.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).verdict(event, pane_id)')
    && ordering.includes('pub(super) fn verdict(&mut self, event: &AiHookEvent, pane_id: u64) -> GateVerdict {')
    && flat(ordering).includes('在最终 Pane 已解析后调用。全进程共用一扇门，关闭/跨窗口移动期间不会为'),
);

// ---- D. 批次重排 reorder_batch ------------------------------------------------
probe.check(
  '批次重排签名（ordering.rs:237）：pub(crate) fn reorder_batch(events: Vec<AiHookEvent>) -> Vec<AiHookEvent>',
  ordering.includes('pub(crate) fn reorder_batch(events: Vec<AiHookEvent>) -> Vec<AiHookEvent> {'),
);
probe.check(
  '重排条件：按 stream_key(pane) 分组后，仅当组内 >1 且全部带 bridge_sequence 才 sort_by_key(|event| event.bridge_sequence)；不同会话保持原交错槽位',
  ordering.includes('let keys = events.iter().map(|event| event.stream_key(event.pane)).collect::<Vec<_>>();')
    && ordering.includes('if group.len() > 1 && group.iter().all(|event| event.bridge_sequence.is_some()) {')
    && ordering.includes('ordered.sort_by_key(|event| event.bridge_sequence);')
    && flat(ordering).includes('同一 pump 批次内，只有一组事件全部带 bridge sequence 时才按该序号')
    && flat(ordering).includes('重排；不同会话仍占据原来的交错槽位。跨批次的旧序号由事件门拒绝。'),
);

// ---- E. UI 适配器只消费共享生命周期 -----------------------------------------
probe.check(
  '生命周期层自述逐字：One pane\'s Agent lifecycle, shared by both UI shells.（Hook events are facts; screen matches are observations with limited authority.）',
  lifecycle.includes("//! One pane's Agent lifecycle, shared by both UI shells.")
    && lifecycle.includes('//! Hook events are facts; screen matches are observations with limited authority.'),
);
probe.check(
  '适配器只许交事实：struct AgentActivity 文档 Owns status and arbitration. Adapters may submit facts but cannot set fields.；事实入口 apply_hook，屏幕回退入口 observe_screen 另立',
  lifecycle.includes('/// Owns status and arbitration. Adapters may submit facts but cannot set fields.')
    && lifecycle.includes('pub fn apply_hook(&mut self, event: &AiHookEvent) -> bool {')
    && lifecycle.includes('pub fn observe_screen(&mut self, detection: Option<Detection>) -> bool {'),
);
probe.check(
  '两个 UI 壳都先过同一扇门再消费生命周期：GPUI 壳 accept_for_pane(event, self.pane_id)，legacy 壳 accept_for_pane(event, pane_id)，随后各自 apply_hook',
  gpuiAdapter.includes('let verdict = crate::ai_hook::accept_for_pane(event, self.pane_id);')
    && legacyAdapter.includes('let verdict = crate::ai_hook::accept_for_pane(event, pane_id);')
    && gpuiAdapter.includes('self.agent_activity.apply_hook(event);'),
);
probe.check(
  '拒绝必须带原因进日志（与 ai_hook.rs 模块头 GateVerdict explains rejected events 呼应）：GPUI 壳 log::debug!("ai_hook: pane={} source={} dropped {verdict:?}")',
  gpuiAdapter.includes('if !verdict.accepted() {')
    && gpuiAdapter.includes('"ai_hook: pane={} source={} dropped {verdict:?}",')
    && flat(host).includes('`GateVerdict` explains rejected events in application debug logs.'),
);
probe.check(
  '批次分发口（windowing.rs:931）：dispatch_ai_events 先 reorder_batch 再按 pane id 严格路由——pane 已关闭时迟到 Hook 必须丢弃',
  windowing.includes('pub(crate) fn dispatch_ai_events(events: Vec<crate::ai_hook::AiHookEvent>, cx: &mut App) {')
    && windowing.includes('for event in crate::ai_hook::reorder_batch(events) {')
    && windowing.includes('// 明确 pane id 是严格路由合同：pane 已关闭时，迟到 Hook 必须丢弃；'),
);

// ---- F. 能力集表示 AiHookCapabilities ---------------------------------------
const capStruct = event.slice(event.indexOf('pub struct AiHookCapabilities {'), event.indexOf('/// Versioned contract of the installed Codex command hooks.'));
const capFields = [...capStruct.matchAll(/pub (lifecycle|attention_events|attention_context|background_tasks|bridge_sequence|serialized_delivery): bool,/g)].map((m) => m[1]);
probe.check(
  `能力集是显式结构体：AiHookCapabilities 恰 6 个 bool 字段（实测 ${capFields.length} 个：${capFields.join(', ')}）`,
  capFields.length === 6,
);
probe.check(
  '能力集按 source 显式分档（capabilities_for）：claude 全生命周期但 bridge_sequence=false；opencode 是唯一 serialized_delivery=true；codex notify 连 lifecycle 都没有',
  event.includes('pub fn capabilities_for(source: &str) -> AiHookCapabilities {')
    && event.includes('"claude" => AiHookCapabilities {')
    && event.includes('"opencode" => AiHookCapabilities {')
    && event.includes('"codex" => AiHookCapabilities {')
    && (event.split('serialized_delivery: true,').length - 1) === 1
    && flat(event).includes('Codex notify 当前只给 turn-complete；没有 permission payload，也没有'),
);
probe.check(
  'bridge_sequence 字段文档点名归属：序号由 Nebula 自己的 bridge 盖（没有任何 provider 提供原生顺序字段），名字里是 bridge 不是 provider 正因此',
  flat(event).includes('Nebula 自己的 bridge 是否为事件盖了单调序号。**没有任何 provider 提供'),
);
const kindEnum = event.slice(event.indexOf('pub enum AiHookKind {'), event.indexOf('/// A stopped turn is not necessarily a successful answer.'));
const kindVariants = ['SessionStart', 'PromptSubmit', 'ToolComplete', 'TurnDone', 'NeedsAttention', 'SessionEnd']
  .filter((v) => new RegExp(`^    ${v},$`, 'm').test(kindEnum));
probe.check(
  `类型化事件枚举 AiHookKind 恰 6 个变体（实测 ${kindVariants.length} 个）——异构 CLI 载荷归一为有界枚举，UI 只认类型`,
  kindVariants.length === 6,
);
probe.check(
  '事件级能力合并：AiHookEvent::capabilities() 以 capabilities_for 为底，codex_hooks 模式存在时上调 lifecycle/attention（capabilities.lifecycle = true;）',
  event.includes('pub fn capabilities(&self) -> AiHookCapabilities {')
    && event.includes('let mut capabilities = capabilities_for(&self.source);')
    && event.includes('capabilities.lifecycle = true;'),
);

// ---- 摘要（milestone_verify：输出分层依赖流证据链）--------------------------
console.log(
  `summary [ai-lifecycle] layers=${HOST}:1-2 transport->protocol/payload->typed events->ordering->pane lifecycle ` +
  `(files: win/transport.rs + protocol.rs/payload.rs + event.rs + ordering.rs + lifecycle.rs); ` +
  `entry=protocol.rs:19 parse_envelope(nebula-hook/1 header + raw JSON, per-source shape gates) <- transport.rs:131; ` +
  `gate=ordering.rs GateVerdict{Accepted + 6 rejects: DuplicateEventId/StaleSequence/StaleTime/DuplicateFingerprint/AfterSessionEnd/UnorderedAfterDone}, ` +
  `accept_for_pane x2 shells (gpui_shell + window_context), rejects logged w/ {verdict:?}; ` +
  `reorder=windowing.rs:934 dispatch_ai_events -> reorder_batch(bridge_sequence sort per stream); ` +
  `IR=event.rs AiHookKind(6) + AiHookCapabilities(6 bool, capabilities_for per source; only opencode serialized_delivery); ` +
  `lifecycle=lifecycle.rs AgentActivity shared by both shells, apply_hook facts / observe_screen fallback`,
);

probe.done();
