// 第 6 章 ssh-session：传输层无关——SSH 远端终端。
// 对锁定 clone（.course/repo @ 360613aa）只读断言本章 milestone：
// 远端 pane 不建本地 PTY 的代码路径、路由解析模块（route.rs）与 SshEventHost 抽象点，
// 外加正文推理要用的证据链：channel 驱动如何喂同一 Term/消息协议栈（输入/缩放/关闭）、
// russh 连接池复用（终端/exec/SFTP 三类负载共用一条已认证连接）、
// jump 路由的递归结构与有界深度、agent 身份选择与有界发现预算。
// 本地 PTY 侧（ConPTY 建立、event_loop pty_read、FairMutex 公平锁）归第 3 章探针，
// 不重复；本探针只断言远端路径与本地路径在「同一协议栈」上的汇合点。
// 所有断言取自锁定 ref 上的静态文件内容，不执行目标仓库代码。
import fs from 'node:fs';
import path from 'node:path';
import { requireRepo, readRepoFile, repoFileExists, makeProbe } from './lib/repo.js';

const probe = makeProbe('ssh-session');
const root = requireRepo();

const P = {
  session: 'nebula_app/src/ssh_session.rs',
  route: 'nebula_app/src/ssh_session/route.rs',
  agent: 'nebula_app/src/ssh_session/agent.rs',
  lifecycle: 'nebula_app/src/ssh_session/lifecycle.rs',
  windowContext: 'nebula_app/src/window_context.rs',
  sshPanes: 'nebula_app/src/window_context/ssh_panes.rs',
  gpuiSession: 'nebula_app/src/gpui_shell/terminal/session.rs',
};
for (const p of Object.values(P)) {
  if (!repoFileExists(p)) {
    console.error(`ssh-session: 锁定 clone 缺少 ${p}`);
    process.exit(1);
  }
}
// 锁定 clone 在本机检出为 CRLF 行尾；断言前统一归一为 \n，行号不受影响。
const read = (p) => readRepoFile(p).replace(/\r\n/g, '\n');
const session = read(P.session);
const route = read(P.route);
const agent = read(P.agent);
const lifecycle = read(P.lifecycle);
const windowContext = read(P.windowContext);
const sshPanes = read(P.sshPanes);
const gpuiSession = read(P.gpuiSession);

const lineOf = (text, needle) => {
  const idx = text.indexOf(needle);
  return idx < 0 ? -1 : text.slice(0, idx).split('\n').length;
};
const countOf = (text, needle) => text.split(needle).length - 1;
// 压平空白后的包含判断（跨行文档注释用）。
const flat = (text) => text.replace(/\s+/g, ' ');
// 再剥掉行注释前缀（//、///、//!）后压平：多行文档注释逐行拼接用。
const flatDoc = (text) => text.replace(/\/\/+!?\s*/g, ' ').replace(/\s+/g, ' ');

// ---- A. 远端 pane 不建本地 PTY 的代码路径 ------------------------------------------
probe.check(
  'ssh_session.rs 模块文档四行合同：由 SSH 通道直接驱动远端终端；远端 Pane 不创建本地伪终端；继续使用统一的输入、缩放和关闭消息协议；渲染与键盘处理保持传输层无关',
  session.includes('//! 由 SSH 通道直接驱动的远端终端会话。')
    && session.includes('//! 远端 Pane 不创建本地伪终端，但继续使用统一的输入、缩放和关闭消息协议，')
    && session.includes('//! 从而让渲染与键盘处理保持传输层无关。'),
);
probe.check(
  'terminal_config 只关两个 ConPTY 专属开关：suppress_bringup_da1 = false + conpty_resize = false，文档点名远端没有 ConPTY 握手与行锚定（其余配置沿用本地同一份）',
  session.includes('config.suppress_bringup_da1 = false;')
    && session.includes('config.conpty_resize = false;')
    && flat(session).includes('Remote terminals have no pre-primed ConPTY handshake or host row anchoring.'),
);
// ssh_session 全树负扫描：本地 PTY 的建立符号一个都不许出现。
const walkRs = (relDir) =>
  fs.readdirSync(path.join(root, relDir.split('/').join(path.sep)), { withFileTypes: true }).flatMap((e) => {
    const rel = `${relDir}/${e.name}`;
    return e.isDirectory() ? walkRs(rel) : e.name.endsWith('.rs') ? [rel] : [];
  });
const sshTree = ['nebula_app/src/ssh_session.rs', ...walkRs('nebula_app/src/ssh_session')];
const forbidden = ['tty::new', 'EventedPty', 'openpty', 'portable_pty', 'PtyEventLoop'];
const hits = forbidden.flatMap((sym) =>
  sshTree.filter((f) => read(f).includes(sym)).map((f) => `${sym}@${f}`),
);
probe.check(
  'ssh_session 全树（含 route/agent/lifecycle/exec/integration 与测试）零本地 PTY 符号：tty::new / EventedPty / openpty / portable_pty / PtyEventLoop 均不出现——PTY 只在远端经协议申请：request_pty(true, "xterm-256color", ...) 发给 sshd',
  hits.length === 0 && lifecycle.includes('.request_pty(') && lifecycle.includes('"xterm-256color"'),
  hits.join(', '),
);
const localPane = windowContext.slice(
  windowContext.indexOf('fn create_pane('),
  windowContext.indexOf('fn create_pane(') + 4200,
);
probe.check(
  '分叉点在 pane 创建层：本地 create_pane 走 tty::new + PtyEventLoop::new（fork shell、master 归 PTY 持有）；远端 create_ssh_pane 走 crate::ssh_session::spawn_session_at，ssh_panes.rs 全文无 tty::new，文档声明「创建由远端 PTY 通道驱动的 Pane，并复用本地终端的解析、渲染和事件协议」',
  localPane.includes('let pty = tty::new(&pty_config, (*size_info).into(), window_id.into())?;')
    && windowContext.includes('PtyEventLoop::new(')
    && sshPanes.includes('crate::ssh_session::spawn_session_at(')
    && !sshPanes.includes('tty::new')
    && flatDoc(sshPanes).includes('创建由远端 PTY 通道驱动的 Pane，并复用本地终端的解析、渲染和事件协议'),
);
const shellPidAt = gpuiSession.indexOf('pub shell_pid');
probe.check(
  'GPUI 侧同判据：TerminalSession.shell_pid 注释「SSH 没有本地 shell 进程，固定为 0」（本地会话此处是 PTY 直系 shell PID）',
  flat(gpuiSession.slice(shellPidAt - 300, shellPidAt + 30)).includes('SSH 没有本地 shell 进程，固定为 0。'),
);

// ---- B. channel 驱动喂同一 Term/消息协议栈 ------------------------------------------
probe.check(
  '协议栈同源进口：lifecycle.rs 从 nebula_terminal（本地终端同一 crate）import Msg + StreamProcessor 与 Term——SSH 侧没有第二套消息枚举或网格实现',
  lifecycle.includes('use nebula_terminal::event_loop::{Msg, StreamProcessor};')
    && lifecycle.includes('use nebula_terminal::term::Term;'),
);
const pumpFn = lifecycle.slice(lifecycle.indexOf('async fn pump<'), lifecycle.indexOf('async fn wait_for_sync'));
probe.check(
  '输入消息统一：pump 收 Msg::Input 直接 channel.data 写向远端（network("channel write", channel.data(...))），与本地路径共用同一 Input 载荷',
  pumpFn.includes('Some(Msg::Input(bytes)) => network("channel write", channel.data(bytes.as_ref())).await?,'),
);
const resizeArm = pumpFn.slice(pumpFn.indexOf('Some(Msg::Resize(size)) => {'), pumpFn.indexOf('Some(Msg::ResizeGrid'));
probe.check(
  '缩放消息统一且双轨同步：Msg::Resize 分支 terminal.lock().resize + stream.resize 后 channel.window_change 同步远端 PTY，注释点名「与本地 event loop 调 ResizePseudoConsole 前的做法一致」；Msg::ResizeGrid 同样先喂 terminal 再喂 stream',
  pumpFn.includes('Some(Msg::Resize(size)) => {')
    && resizeArm.includes('terminal.lock().resize(size);')
    && resizeArm.includes('stream.resize(size);')
    && resizeArm.includes('channel.window_change(')
    && flatDoc(resizeArm).includes('stream and the remote PTY, just as the local event loop does before calling ResizePseudoConsole.')
    && pumpFn.includes('Some(Msg::ResizeGrid(size)) => {'),
);
probe.check(
  '关闭消息统一：Msg::Shutdown 与通道断流都走 return，finish 统一 terminal.lock().exit() / render_error 后 send_event(TerminalEvent::Wakeup)——与本地循环同一种 UI 通知',
  pumpFn.includes('Some(Msg::Shutdown) | None => return Ok(()),')
    && lifecycle.includes('event_proxy.send_event(TerminalEvent::Wakeup);')
    && lifecycle.includes('Ok(()) => terminal.lock().exit(),'),
);
probe.check(
  '输出方向同构：ChannelMsg::Data/ExtendedData 都走 stream.feed(&mut *terminal.lock(), event_proxy, data)——与本地 pty_read 的 feed 同一入口（该行在 lifecycle.rs 出现 2 次：shell 确认前的 pending 队列 + 主循环）',
  countOf(lifecycle, 'stream.feed(&mut *terminal.lock(), event_proxy, data.as_ref());') === 2,
);
probe.check(
  '会话句柄同型：spawn_session_at 签名持有 Arc<FairMutex<Term<H>>>（与本地 create_pane 的 Arc<FairMutex<Term>> 同一包装），EventLoopSender::standalone() 产出与本地 Notifier 同一 sender 类型；pump 起手 StreamProcessor::default() + stream.resize(initial_size)',
  session.includes('terminal: Arc<FairMutex<Term<H>>>,')
    && session.includes('let (sender, receiver) = EventLoopSender::standalone()?;')
    && pumpFn.includes('let mut stream = StreamProcessor::default();')
    && pumpFn.includes('stream.resize(initial_size);'),
);

// ---- C. russh 连接复用 ---------------------------------------------------------------
const reuseBranch = session.slice(
  session.indexOf('if let Some(existing) = existing {'),
  session.indexOf('if let Some(existing) = existing {') + 500,
);
probe.check(
  '全局连接池：connection_pool 是 OnceLock 静态 Mutex<HashMap<String, SharedSession>>；键为 SshDestination::pool_key = user@host:port（host 小写）',
  session.includes('fn connection_pool() -> &\'static tokio::sync::Mutex<HashMap<String, SharedSession>>')
    && session.includes('format!("{}@{}:{}", self.user, self.host.to_ascii_lowercase(), self.port)'),
);
probe.check(
  '池命中未关闭即复用：existing.is_closed() 为假时记日志「复用已认证 SSH 连接: {key}」并返回 reused: true，不再走 Connect/Authenticate 阶段',
  reuseBranch.includes('if !existing.is_closed() {') && reuseBranch.includes('复用已认证 SSH 连接')
    && reuseBranch.includes('reused: true,'),
);
probe.check(
  '三类负载共用一条已认证连接：exec_capture 文档「走连接池里已认证的传输，所以不会触发第二次认证或 MFA；开的是独立 exec」；open_sftp 在同一池上 request_subsystem(true, "sftp")；两者都经 authenticated_session(..., None::<&NoopSshEventHost>)（出现 2 次）',
  session.includes('走连接池里已认证的传输，所以不会触发第二次认证或 MFA；开的是独立 exec')
    && session.includes('channel.request_subsystem(true, "sftp").await?;')
    && countOf(session, 'authenticated_session(&destination, &profile, None::<&NoopSshEventHost>)') === 2,
);
probe.check(
  '池连接失效自愈：shell channel 打不开时驱逐池键并整条重连（日志 SSH pooled channel failed; reconnecting），evict_pooled_session 按 Arc::ptr_eq 校验后才移除',
  lifecycle.includes('SSH pooled channel failed; reconnecting')
    && session.includes('Arc::ptr_eq(pooled, session)'),
);

// ---- D. 路由解析模块（route.rs）------------------------------------------------------
probe.check(
  'RouteTransport 是四变体传输计划：Direct / Server(ProxyServer) / Command(String) / Jump(Box<ResolvedRoute>)——jump 递归：跳板本身又是一条完整 ResolvedRoute',
  route.includes('pub(super) enum RouteTransport {')
    && route.includes('Direct,') && route.includes('Server(ProxyServer),')
    && route.includes('Command(String),') && route.includes('Jump(Box<ResolvedRoute>)'),
);
probe.check(
  '有界深度：build_route 以 depth: u8 递归，depth >= 2 报「跳板链过深，最多支持 2 级跳板」；ancestors 记录途经 (host, port)，contains 命中报「跳板链存在循环或将目标主机自身用作跳板」',
  route.includes('if depth >= 2 {') && route.includes('跳板链过深，最多支持 2 级跳板')
    && route.includes('ancestors.contains(&endpoint)') && route.includes('跳板链存在循环或将目标主机自身用作跳板'),
);
probe.check(
  '路由即身份：池键带路由指纹——逐跳 SHA-256 update（b"jump"/b"direct"/b"proxy"/b"command" 标段），最终 format "{}|route:{fingerprint}"：同目标不同路径不共享连接',
  route.includes('digest.update(b"jump");') && route.includes('digest.update(b"direct");')
    && route.includes('route:{fingerprint}'),
);
const transportFn = session.slice(session.indexOf('async fn open_transport'), session.indexOf('async fn authenticate('));
probe.check(
  '四种传输汇入同一握手：open_transport 内 client::connect_stream( 恰好 4 次（Server/Jump/Command/Direct 各一）——字节流是唯一接缝；jump 分支先在跳板连接上 channel_open_direct_tcpip，再把 channel.into_stream() 当传输流喂给目标的 russh 会话',
  countOf(session, 'client::connect_stream(') === 4
    && transportFn.includes('acquired.session.channel_open_direct_tcpip(')
    && transportFn.includes('client::connect_stream(config, channel.into_stream(), handler)'),
);

// ---- E. SshEventHost 抽象点 ----------------------------------------------------------
const traitAt = session.indexOf('pub trait SshEventHost:');
const traitDef = session.slice(traitAt, session.indexOf('#[cfg(feature = "legacy-shell")]', traitAt));
probe.check(
  'SshEventHost 形态：supertrait 是 nebula_terminal::event::EventListener + Clone + Send + Sync + \'static（终端事件泵能力白送），唯一新增方法 ssh_stage(stage: SshStage) 默认丢弃（let _ = stage;），文档声明「spawn_session 因此对 UI 壳无感——同一条 russh 业务路径服务两个壳，不产生第二套连接语义」',
  session.includes('pub trait SshEventHost:')
    && session.includes('nebula_terminal::event::EventListener + Clone + Send + Sync + \'static')
    && traitDef.includes('fn ssh_stage(&self, stage: SshStage) {') && traitDef.includes('let _ = stage;')
    && flatDoc(session).includes('因此对 UI 壳无感——同一条 russh 业务路径服务') 
    && flatDoc(session).includes('两个壳，不产生第二套连接语义'),
);
probe.check(
  '两个 UI 壳各自实现同一接缝：旧 winit 壳 impl SshEventHost for EventProxy 投递 EventType::SshConnect(stage)；GPUI 壳 impl crate::ssh_session::SshEventHost for EventProxy 投递 stages.unbounded_send(stage)',
  session.includes('impl SshEventHost for EventProxy {')
    && session.includes('self.send_event(crate::event::EventType::SshConnect(stage));')
    && gpuiSession.includes('impl crate::ssh_session::SshEventHost for EventProxy {')
    && gpuiSession.includes('self.stages.unbounded_send(stage);'),
);
probe.check(
  '一条业务路径服务两个壳：两壳都调 crate::ssh_session::spawn_session_at(（ssh_panes.rs 与 gpui_shell/terminal/session.rs 各一处），GPUI 文档「与旧壳同一条业务路径……事件与输入协议不变」',
  countOf(sshPanes, 'crate::ssh_session::spawn_session_at(') === 1
    && countOf(gpuiSession, 'crate::ssh_session::spawn_session_at(') === 1
    && gpuiSession.includes('与旧壳同一条业务路径') && gpuiSession.includes('事件与输入协议不变'),
);
probe.check(
  '无 UI 路径也有实现：NoopSshEventHost 同时实现 EventListener 与 SshEventHost 空体，exec_capture/open_sftp 用 None::<&NoopSshEventHost> 关掉阶段上报',
  session.includes('impl nebula_terminal::event::EventListener for NoopSshEventHost {}')
    && session.includes('impl SshEventHost for NoopSshEventHost {}'),
);

// ---- F. agent 身份选择与有界发现预算 ----------------------------------------------
probe.check(
  '发现预算常量：DISCOVERY_TOTAL = 3s（全部端点共享）、DISCOVERY_ENDPOINT = 1500ms（单端点上限）、SELECTOR_BUDGET = 1s（读 .pub 偏好键）、PUBLIC_KEY_BYTES = 64KiB（selector 文件上限）',
  agent.includes('const DISCOVERY_TOTAL: Duration = Duration::from_secs(3);')
    && agent.includes('const DISCOVERY_ENDPOINT: Duration = Duration::from_millis(1_500);')
    && agent.includes('const SELECTOR_BUDGET: Duration = Duration::from_secs(1);')
    && agent.includes('const PUBLIC_KEY_BYTES: u64 = 64 * 1024;'),
);
probe.check(
  '模块合同：发现可回退、签名失败不可回退（Err 对传输致命，调用方丢弃不入池）；从不加载私钥/转发 agent/持久化身份，每主机每次新连 agent',
  flatDoc(agent.slice(0, agent.indexOf('#[derive')))
    .includes('Discovery may fall back; a failed signature may not.')
    && flatDoc(agent).includes('This module never loads private keys, forwards an agent, or persists identities.'),
);
probe.check(
  '身份选择：preferred_keys 由显式私钥 + ssh config IdentityFile 的 .pub selector 读出，rank_identities 把匹配身份排前；跨 Windows 端点按公钥 blob 去重（offered HashSet），同一把键不重复送签',
  agent.includes('rank_identities(&mut identities, &preferred);')
    && agent.includes('preferred_keys(explicit_keys.iter().chain(&destination.identity_files))')
    && agent.includes('offered.insert(blob)'),
);
probe.check(
  'PartialSuccess 回灌主认证计划：agent 报 PartialSuccess 后，ssh_session.rs 认证循环跳过后续私钥（matches!(agent_attempt, Some(agent::Attempt::PartialSuccess { .. })) 即 continue）——服务器已认可 agent 方式，本地私钥不再白试',
  session.includes('if matches!(agent_attempt, Some(agent::Attempt::PartialSuccess { .. })) {')
    && session.includes('continue;'),
);

// ---- 摘要（milestone_verify：传输层解耦证据链）-----------------------------------
console.log(
  `summary [ssh-session] no-local-pty=${P.sshPanes}:create_ssh_pane → spawn_session_at (shell_pid=0), ` +
  `conpty-off=${P.session}:${lineOf(session, 'config.conpty_resize = false;')}; ` +
  `same-stack=${P.lifecycle}:${lineOf(lifecycle, 'async fn pump<')} Msg=Input/Resize/ResizeGrid/Shutdown, ` +
  `feed=${lineOf(lifecycle, 'stream.feed(&mut *terminal.lock()')} (x2), ` +
  `resize=${lineOf(lifecycle, 'channel.window_change(')} 同步远端; ` +
  `pool=${P.session}:${lineOf(session, 'fn connection_pool')} key=user@host:port, ` +
  `reuse=${lineOf(session, '复用已认证 SSH 连接')}, exec+sftp 共池=${lineOf(session, 'authenticated_session(&destination, &profile, None::<&NoopSshEventHost>)')}; ` +
  `route=${P.route}:${lineOf(route, 'pub(super) enum RouteTransport')} 4 变体, ` +
  `jump-depth<=2=${lineOf(route, 'if depth >= 2 {')}, fingerprint=${lineOf(route, 'route:{fingerprint}')}, ` +
  `connect_stream x${countOf(session, 'client::connect_stream(')}; ` +
  `host-trait=${P.session}:${lineOf(session, 'pub trait SshEventHost:')} (EventListener+ssh_stage), ` +
  `shells=legacy:${lineOf(sshPanes, 'crate::ssh_session::spawn_session_at(')}+gpui:${lineOf(gpuiSession, 'crate::ssh_session::spawn_session_at(')}; ` +
  `agent-budget=${P.agent}:${lineOf(agent, 'const DISCOVERY_TOTAL')} 3s/1500ms/1s/64KiB`,
);

probe.done();
