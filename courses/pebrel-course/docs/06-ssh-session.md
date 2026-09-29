---
title: 第 6 章 传输层无关：SSH 远端终端
---

# 传输层无关：SSH 远端终端

## 工具箱

搭一条远端会话，要调的三块旧积木都来自本地终端那条供血线。

- 事件循环 —— nebula_terminal 的 I/O 线程主循环：polling 等就绪、分块读字节、喂给 Term、发 UI 通知；键盘与缩放沿它的 Msg 队列进入（[第 3 章](./03-pty-event-loop.md)）。
- VT 转义序列 —— shell 输出中以 ESC 开头的控制片段，解析器把它切成结构化回调再驱动网格，是字节流里的「动词」（[第 2 章](./02-vt-grid.md)）。
- 所有权地图 —— docs/architecture.md 的 owns / must-not-become 两栏合同，判断一段代码该住在哪个 crate（[第 1 章](./01-repo-map.md)）。

## 远端 pane 里的 vim

连上一台服务器开个远端 pane：路径可能还要经过一台跳板机（jump），地址栏里填的是 user@bastion 这样一串。pane 打开，敲 vim——语法高亮、局部刷新、Ctrl+L 重画，手感和本地 pane 一模一样。可你翻遍渲染与键盘处理的代码，找不到任何带 ssh 字样的分支。画屏幕的那部分代码，根本不知道字节是本地 ConPTY 吐出来的，还是穿过 SSH channel 从另一台机器飘过来的。

直觉这时候会插话：远端是另一种终端，总得另写一套渲染吧？这个预期有来处——浏览器里的 Web 终端、IDE 的远程插件，看上去都是为网络会话单独做的一套界面。本章拿源码证据逐条审它，顺带审掉两个相邻的直觉：一个 SSH 连接只能挂一个会话；跳板只是把命令行参数拼成一串。审完的结论会落成四块新积木：传输层无关、russh 连接复用、jump 路由、SshEventHost。

## 原理：分叉在会话边界，汇合在 Term

### 传输层无关：只换「字节从哪来」

先看所有权地图给 SSH 代码划的住址。architecture.md 的表格里，nebula_terminal 拥有的是「Grid, VT processing, terminal/PTY behavior」。禁区一栏写着「Product panels or GPUI state」。SSH 会话的全部实现——连接、认证、路由、channel 驱动——都住在 nebula_app 的 ssh_session 模块里。

```text
# Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:docs/architecture.md（行 21）
| `nebula_terminal` | Grid, VT processing, terminal/PTY behavior | Product panels or GPUI state |
```

这不是目录偏好，是依赖方向合同的推论。解析、网格、渲染这些 domain 规则不许知道自己跑在哪种传输上；传输是 application capability，只能住在外层。模块头把它写成四行合同。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ssh_session.rs（行 1–4）
//! 由 SSH 通道直接驱动的远端终端会话。
//!
//! 远端 Pane 不创建本地伪终端，但继续使用统一的输入、缩放和关闭消息协议，
//! 从而让渲染与键盘处理保持传输层无关。
```

**传输层无关**：同一套 Term、渲染与键盘栈，既吃本地 ConPTY/Unix PTY，也吃 SSH channel；会话边界以下换掉「字节从哪来」，边界以上一行不改。反事实也直白——要是没有这条原则，每加一种传输就得复制一份网格与渲染。你手里的网格与单元格、damage 追踪两块积木都得存两份账，两边还会各自漂移。

证据一：远端路径上没有本地 PTY。整个 ssh_session 源码树做负扫描，覆盖 route、agent、lifecycle、exec、integration 与测试。五个本地 PTY 符号——tty::new、EventedPty、openpty、portable_pty、PtyEventLoop——一个都不出现。你可以亲自验证。

```bash
grep -rn "tty::new" nebula_app/src/ssh_session.rs nebula_app/src/ssh_session/
# 无输出：远端会话全树零本地 PTY 符号
```

本地 pane 的出生路径长这样（PTY 伪终端在这里 fork 出 shell 并握住 master 端，[第 3 章](./03-pty-event-loop.md)）。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/window_context.rs（行 531–534）
        // The PTY forks the shell process and retains the master side.
        crate::boot_trace("conpty spawn begin");
        let pty = tty::new(&pty_config, (*size_info).into(), window_id.into())?;
        crate::boot_trace("conpty spawn done");
```

紧随其后的是 PtyEventLoop::new——I/O 线程就此上岗。远端 pane 的出生路径没有这两步。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/window_context/ssh_panes.rs（行 15–16）
    /// 创建由远端 PTY 通道驱动的 Pane，并复用本地终端的解析、渲染和事件协议。
    /// 这样传输层只负责字节流，输入、缩放与终端状态无需维护两套实现。
```

两条路径在 Term 的包装方式上汇合。本地是 `Arc::new(FairMutex::new(terminal))`（行 505–508），远端是同一副包装。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/window_context/ssh_panes.rs（行 28–39）
        let terminal = Arc::new(FairMutex::new(Term::new(
            crate::ssh_session::terminal_config(config.term_options()),
            size_info,
            event_proxy.clone(),
        )));
        let sender = crate::ssh_session::spawn_session_at(
            destination.clone(),
            remote_cwd,
            (*size_info).into(),
            terminal.clone(),
            event_proxy.clone(),
        )?;
```

同一把按到达序授予的公平锁 FairMutex（[第 3 章](./03-pty-event-loop.md)），同一个 Term 类型，不同的只剩谁往里喂字节。GPUI 壳侧同判据：本地 spawn 与远端 spawn_ssh 产出同一种 TerminalSession。差别浓缩在一个字段。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/terminal/session.rs（行 63–70）
pub struct TerminalSession {
    pub term: Arc<FairMutex<Term<EventProxy>>>,
    pub notifier: Notifier,
    pub(super) native_prompt: super::event_mailbox::NativePromptState,
    /// PTY 直系 shell PID；关闭确认沿用旧壳 `busy_child(shell_pid)` 判据。
    /// SSH 没有本地 shell 进程，固定为 0。
    pub shell_pid: u32,
}
```

shell_pid 固定为 0：本地会话这里有 PTY 直系的 shell 进程号，远端会话根本没有本地 shell 可编号。

证据二：PTY 没有消失，只是搬了家。远端 shell 依然活在一个 PTY 伪终端的骗局里——只是这对主从设备搬到了服务器上。sshd 申请它，shell 挂在从端，channel 字节倒进 master 端。申请动作是一条协议消息。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ssh_session/lifecycle.rs（行 345–356）
    channel
        .request_pty(
            true,
            "xterm-256color",
            u32::from(size.num_cols),
            u32::from(size.num_lines),
            u32::from(size.cell_width) * u32::from(size.num_cols),
            u32::from(size.cell_height) * u32::from(size.num_lines),
            &[],
        )
        .await?;
    wait_request_success(&mut channel, "PTY").await?;
```

行列数和像素尺寸都随请求带上——远端 PTY 从出生那一刻起就与本地网格同一几何。

证据三：本地专属的补偿被显式关掉，其余配置原样沿用。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ssh_session.rs（行 37–44）
/// Remote terminals have no pre-primed ConPTY handshake or host row anchoring.
pub(crate) fn terminal_config(
    mut config: nebula_terminal::term::Config,
) -> nebula_terminal::term::Config {
    config.suppress_bringup_da1 = false;
    config.conpty_resize = false;
    config
}
```

terminal_config 只翻两个开关，都是 ConPTY 专属行为。conpty_resize 关掉 Windows 的 resize 特殊路径。ConPTY 对账吸收的是 conhost 重放，远端没有 conhost 可对账（[第 3 章](./03-pty-event-loop.md)）。suppress_bringup_da1 则关掉 DA1 静音：远端没有「预先充好电」的 ConPTY 握手。除此之外，term_options 一字未动——同一个 Term 配置服务两种传输。

### pump：四条消息与一个 channel

「统一的输入、缩放和关闭消息协议」落在哪？lifecycle.rs 的 import 单子是第一份证据。SSH 侧没有第二套消息枚举：Msg、StreamProcessor、Term 全部从 nebula_terminal 进货——本地终端同一个 crate。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ssh_session/lifecycle.rs（行 9–12）
use nebula_terminal::event::{Event as TerminalEvent, WindowSize};
use nebula_terminal::event_loop::{Msg, StreamProcessor};
use nebula_terminal::sync::FairMutex;
use nebula_terminal::term::Term;
```

驱动主体叫 pump。起手三步与本地事件循环同款。先建 StreamProcessor——VT 转义序列的解析就在这条流水线上（[第 2 章](./02-vt-grid.md)）。然后按初始尺寸校准，把 shell 确认前积压的输出先喂进 Term。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ssh_session/lifecycle.rs（行 428–444）
async fn pump<H: SshEventHost>(
    channel: &mut ShellChannel,
    hook_token: String,
    initial_size: WindowSize,
    terminal: &FairMutex<Term<H>>,
    event_proxy: &H,
    input: &mut mpsc::UnboundedReceiver<Msg>,
) -> Result<(), SessionError> {
    let mut stream = StreamProcessor::default();
    stream.resize(initial_size);
    stream.set_remote_hook_token(hook_token);
    while let Some(message) = channel.pending.pop_front() {
        if let ChannelMsg::Data { data } | ChannelMsg::ExtendedData { data, .. } = message {
            stream.feed(&mut *terminal.lock(), event_proxy, data.as_ref());
            event_proxy.send_event(TerminalEvent::Wakeup);
        }
    }
```

主循环把四条 Msg 与 channel 输出一起 select。这是本章最承重的一段。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ssh_session/lifecycle.rs（行 445–475）
    let mut eof_deadline = None;
    loop {
        let sync_deadline = stream.next_sync_timeout();
        tokio::select! {
            message = input.recv() => match message {
                Some(Msg::Input(bytes)) => network("channel write", channel.data(bytes.as_ref())).await?,
                Some(Msg::Resize(size)) => {
                    // SSH has no local EventLoop to apply the grid half of a
                    // resize. Keep the terminal model in lockstep with the
                    // stream and the remote PTY, just as the local event loop
                    // does before calling ResizePseudoConsole.
                    terminal.lock().resize(size);
                    stream.resize(size);
                    event_proxy.send_event(TerminalEvent::Wakeup);
                    network("channel resize", channel.window_change(u32::from(size.num_cols), u32::from(size.num_lines),
                        u32::from(size.cell_width) * u32::from(size.num_cols),
                        u32::from(size.cell_height) * u32::from(size.num_lines))).await?;
                },
                Some(Msg::ResizeGrid(size)) => {
                    terminal.lock().resize(size);
                    stream.resize(size);
                    event_proxy.send_event(TerminalEvent::Wakeup);
                },
                Some(Msg::Shutdown) | None => return Ok(()),
            },
            message = channel.wait() => match message {
                Some(ChannelMsg::Data { data }) | Some(ChannelMsg::ExtendedData { data, .. }) => {
                    stream.feed(&mut *terminal.lock(), event_proxy, data.as_ref());
                    event_proxy.send_event(TerminalEvent::Wakeup);
                },
                Some(ChannelMsg::ExitStatus { .. }) => return Ok(()),
```

逐条对账四条消息：

1. Input：键盘字节直接 channel.data 写向远端。本地路径里这一步是写 PTY master；载荷与语义没变，出口换了。
2. Resize：锁 Term 重排网格、校准 stream、window_change 通知远端 PTY。注释自己点名了血缘——与本地事件循环调 ResizePseudoConsole 之前的做法一致。上游也是同一条链：GPUI 壳的 prepaint 回写裁定行列后（[第 5 章](./05-gpui-shell.md)），经同一个 Notifier 发出 Msg::Resize；对 Term 来说，消息从哪种传输来没有区别。
3. ResizeGrid：只动本地网格那一半，远端连 window_change 都不发。本地拖拽期间「网格跟手、子进程落定」的双节奏合同（[第 5 章](./05-gpui-shell.md)），在远端原样生效。
4. Shutdown：直接 return，收尾统一在 finish 里 terminal.lock().exit()、发 Wakeup——与本地循环同一种 UI 通知。

输出方向同理：channel 的 Data 与 ExtendedData 都走 stream.feed 进 Term。这正是本地 pty_read 分块读之后的同一个入口——字节落进同一张网格与单元格，Term 记下 damage，渲染只重画坏区（[第 2 章](./02-vt-grid.md)）。远端 vim 的局部刷新之所以流畅，走的正是和本地 vim 完全相同的那条最短路径。

组装式现在可以写全。**传输层无关 = 事件循环的 Msg 协议 + StreamProcessor 喂 Term + FairMutex 共享 + 新增的双向 channel 搬运**——新写的只有最后一项。

两处边角补完这块拼图。其一，消息从 std 线程世界跨进 tokio 世界有一座小桥。Msg::Shutdown 在桥头就地转成取消信号。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ssh_session/lifecycle.rs（行 139–154）
    tokio::task::spawn_blocking(move || {
        while !input_tx.is_closed() {
            match receiver.recv_timeout(Duration::from_millis(100)) {
                Ok(Msg::Shutdown) | Err(RecvTimeoutError::Disconnected) => {
                    let _ = cancel_tx.send(true);
                    break;
                },
                Ok(message) => {
                    if input_tx.send(message).is_err() {
                        break;
                    }
                },
                Err(RecvTimeoutError::Timeout) => {},
            }
        }
    });
```

其二，会话句柄同型。spawn_session_at 持有 Arc&lt;FairMutex&lt;Term&lt;H>>>，返回 EventLoopSender——与本地 Notifier 是同一 sender 类型。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ssh_session.rs（行 534–554）
/// Start an SSH pane and optionally move its fresh interactive shell to a
/// known remote working directory. The directory is sent only after the shell
/// channel is ready; it never participates in address parsing or authentication.
pub fn spawn_session_at<H: SshEventHost>(
    destination: String,
    initial_remote_cwd: Option<String>,
    initial_size: WindowSize,
    terminal: Arc<FairMutex<Term<H>>>,
    event_proxy: H,
) -> io::Result<EventLoopSender> {
    let (sender, receiver) = EventLoopSender::standalone()?;
    runtime()?.spawn(lifecycle::run(
        destination,
        initial_remote_cwd,
        initial_size,
        terminal,
        event_proxy,
        receiver,
    ));
    Ok(sender)
}
```

注意类型参数 H 不是随便起的：spawn_session_at 对 H 只有一个要求——实现 SshEventHost。这个 trait 是本章最后一块积木，先按下，讲完连接与路由再回来拆。

## 连接是资产：russh 连接复用

「一个 SSH 连接只能开一个会话」的直觉来自命令行的使用模型：敲一次 ssh 得到一个 shell，要第二个就再敲一次，认证也再来一轮。模型没错，只是它描述的是 ssh 命令行程序的用法，不是 SSH 协议的能力。协议本来就允许一条已认证连接上多路复用任意多个 channel；Pebrel 用 Rust 的 SSH 实现库 russh 落实了这件事。

**russh 连接复用**：一条已认证的 SSH 连接上按需开 channel——终端 shell、SFTP 子系统、一次性 exec 各开各的，互不干扰；连接建立与认证只发生一次。代价结构值得算一笔：TCP 握手加密钥交换、再过一轮认证（若开了 MFA 还要人工点一次），是秒级且可能要人参与的昂贵操作；开一个 channel 只是连接上的一条消息，毫秒级。**连接是昂贵资产，channel 是廉价耗材**。

仓库把这条原则落成一个全局池。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ssh_session.rs（行 519–522）
fn connection_pool() -> &'static tokio::sync::Mutex<HashMap<String, SharedSession>> {
    static POOL: OnceLock<tokio::sync::Mutex<HashMap<String, SharedSession>>> = OnceLock::new();
    POOL.get_or_init(|| tokio::sync::Mutex::new(HashMap::new()))
}
```

池键是身份的最小摘要。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ssh_session.rs（行 275–277）
    fn pool_key(&self) -> String {
        format!("{}@{}:{}", self.user, self.host.to_ascii_lowercase(), self.port)
    }
```

命中且未关闭就整条拿走，Connect 与 Authenticate 阶段直接跳过。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ssh_session.rs（行 636–650）
    let key = route.pool_key();
    let existing =
        if unattended { None } else { connection_pool().lock().await.get(&key).cloned() };
    if let Some(existing) = existing {
        if !existing.is_closed() {
            info!("复用已认证 SSH 连接: {key}");
            return Ok(AcquiredSession {
                key,
                session: existing,
                reused: true,
                jump_sessions: Vec::new(),
            });
        }
        evict_pooled_session(&key, &existing).await;
    }
```

三类负载在同一条已认证连接上各开各的 channel。后台跑命令的 exec_capture 文档写得直白。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ssh_session.rs（行 919–922）
/// 在目标主机上跑一条命令并收集它的标准输出，脚本经标准输入送入。
///
/// 走连接池里已认证的传输，所以不会触发第二次认证或 MFA；开的是独立 exec
/// 通道，交互终端里**不会**出现任何回显——用户看不到我们在后台问了什么。
```

SFTP 面板走同一个池、同一种开法。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ssh_session.rs（行 970–973）
    // SFTP 面板自己有加载态，不参与终端 pane 的连接卡片。
    let session = authenticated_session(&destination, &profile, None::<&NoopSshEventHost>).await?;
    let channel = lifecycle::network("SFTP channel", session.channel_open_session()).await?;
    channel.request_subsystem(true, "sftp").await?;
```

终端 pane、SFTP、后台 exec 三者共用一条连接：认证一次，MFA 最多点一次，之后全是 channel。复用的瞬时性还有个用户可见的副作用，写在连接阶段的文档里。池命中时 Connect 与 Authenticate 阶段不上报——「复用是瞬时的，连接卡片也就不会浮出来」。

池也会失效自愈：shell channel 打不开时记日志 SSH pooled channel failed; reconnecting，驱逐池键后整条重连；驱逐前用 Arc::ptr_eq 校验池里躺着的确实是这条连接，防止误杀后来者。连接本身有 15 秒 keepalive、连续 3 次无响应判死的保活配置兜底。

## 路由即身份：jump 路由

「跳板只是命令行参数拼接」的直觉同样有来处：OpenSSH 的 -J 与 ProxyCommand 在命令行里看起来就是字符串拼接，spawn 一个 ssh.exe 把参数传对，确实能连上。Pebrel 没有 spawn ssh.exe，它用 russh 自己实现客户端，于是路径解析成了一等公民的数据结构。

**jump 路由**：ssh_session/route.rs 把「经哪些跳板、走什么代理到达目标」解析成一份类型化的连接计划 ResolvedRoute；连接建立之前计划先定型，之后一切（开流、认证、入池）都按计划执行。计划的运输段是一个四变体枚举：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ssh_session/route.rs（行 6–19）
pub(super) struct ResolvedRoute {
    pub destination: SshDestination,
    pub profile: SshProfileAuth,
    pub transport: RouteTransport,
    #[cfg(test)]
    pub known_hosts_path: Option<std::path::PathBuf>,
}

pub(super) enum RouteTransport {
    Direct,
    Server(ProxyServer),
    Command(String),
    Jump(Box<ResolvedRoute>),
}
```

看 Jump 变体的类型：它装的又是一整个 ResolvedRoute——跳板自己也是一条完整路由，递归由此而来。字符串拼接给不出这个结构，也给不出两个护栏。护栏一，深度有界。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ssh_session/route.rs（行 175–192）
    let transport = if let Some(spec) = jump {
        crate::ssh_profiles::validate_ssh_destination(&spec)
            .map_err(|_| "跳板地址无效，仅支持单个 SSH 别名或 user@host:port".to_owned())?;
        if depth >= 2 {
            return Err("跳板链过深，最多支持 2 级跳板".to_owned());
        }
        let (jump_destination, jump_profile) = resolve_host(&spec)?;
        RouteTransport::Jump(Box::new(build_route(
            jump_destination,
            jump_profile,
            global,
            depth + 1,
            None,
            network,
            ancestors,
            resolve_host,
            load_secret,
        )?))
```

depth 以 u8 递归计数，第 3 级跳板直接报错。护栏二，环路有界。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ssh_session/route.rs（行 108–112）
    let endpoint = (destination.host.to_ascii_lowercase(), destination.port);
    if ancestors.contains(&endpoint) {
        return Err("跳板链存在循环或将目标主机自身用作跳板".to_owned());
    }
    ancestors.push(endpoint);
```

ancestors 记录途经的每个 (host, port)，重复出现即拒绝——A 跳 B 再跳 A，或者「经自己到达自己」，都活不过解析。

最能杀死「拼接」直觉的是这一条：路由参与池键。连接池的键不只是 user@host:port，还叠加一份路由指纹。指纹的算法是逐跳喂 SHA-256，每一跳先打一个类型标段。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ssh_session/route.rs（行 45–64）
            match &current.transport {
                RouteTransport::Jump(jump) => {
                    digest.update(b"jump");
                    current = jump;
                },
                RouteTransport::Direct => {
                    digest.update(b"direct");
                    break;
                },
                RouteTransport::Server(server) => {
                    digest.update(b"proxy");
                    digest.update(server.identity());
                    break;
                },
                RouteTransport::Command(command) => {
                    digest.update(b"command");
                    digest.update(command);
                    break;
                },
            }
```

指纹缀在池键末尾。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ssh_session/route.rs（行 70）
        format!("{}|route:{fingerprint}", self.destination.pool_key())
```

后果可判定：同一台目标、同一份凭据，直连与经跳板是两个池键、两条连接——路径不同，身份就不同。字符串拼接式的实现根本不存在「池键」这个概念，自然也守不住这条界。

四种运输段最终汇入同一个握手函数 open_transport。数一数它调用 client::connect_stream（russh 的「在现成字节流上建会话」入口）的位置：恰好 4 处，Server、Jump、Command、Direct 各一。**字节流是唯一接缝**——传输怎么来无关紧要，russh 只认流。Jump 分支最能体现这一点。它先在跳板的已认证连接上开一条 direct-tcpip 转发 channel。这条 channel 再变成流，喂给目标主机的 russh 会话。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ssh_session.rs（行 736–746）
        RouteTransport::Jump(jump) => {
            let spec = &jump.destination.original;
            info!("经跳板 {spec} 连接 {}:{}", destination.host, destination.port);
            let acquired = Box::pin(authenticated_route(
                jump,
                None::<&NoopSshEventHost>,
                unattended,
                allow_host_key_prompt,
            ))
            .await
            .map_err(|err| format!("连接跳板 {spec} 失败: {err}"))?;
```

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ssh_session.rs（行 747–767）
            let channel = lifecycle::network(
                "jump channel",
                acquired.session.channel_open_direct_tcpip(
                    destination.host.clone(),
                    u32::from(destination.port),
                    "127.0.0.1",
                    0,
                ),
            )
            .await
            .map_err(|err| {
                format!(
                    "经跳板 {spec} 转发到 {}:{} 失败: {err}",
                    destination.host, destination.port
                )
            })?;
            jump_sessions = acquired.jump_sessions;
            jump_sessions.push(acquired.session);
            handshake
                .connect(client::connect_stream(config, channel.into_stream(), handler))
                .await?
```

跳板连接先递归地完整建立、认证、入池，再被用作字节管道。Direct 分支对照着看，接缝感更清楚：TCP 直连也只是「另一种流」。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ssh_session.rs（行 779–787）
        RouteTransport::Direct => {
            let stream = lifecycle::network(
                "TCP connection",
                tokio::net::TcpStream::connect((destination.host.as_str(), destination.port)),
            )
            .await?;
            stream.set_nodelay(true)?;
            handshake.connect(client::connect_stream(config, stream, handler)).await?
        },
```

## SshEventHost：协议逻辑与宿主接线的接缝

还剩 spawn_session_at 签名里那个 H。SSH 会话跑在共享的 tokio Runtime 上（线程数钳制在 2 到 4，线程名 nebula-ssh），而宿主是两个事件驱动的 UI 壳：旧的 winit 壳与 GPUI 壳。异步协议逻辑不该知道宿主是谁，宿主也不该重复连接语义。接缝是一个 trait。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ssh_session.rs（行 62–75）
/// 直连 SSH 会话的宿主回调抽象：终端事件泵（[`EventListener`]）+ 连接
/// 阶段上报。旧壳 `EventProxy`（winit 事件循环）与 GPUI 会话代理都实现
/// 它，[`spawn_session`] 因此对 UI 壳无感——同一条 russh 业务路径服务
/// 两个壳，不产生第二套连接语义。
///
/// [`EventListener`]: nebula_terminal::event::EventListener
pub trait SshEventHost:
    nebula_terminal::event::EventListener + Clone + Send + Sync + 'static
{
    /// 连接阶段变化（连接卡片/横幅的数据源）。默认丢弃。
    fn ssh_stage(&self, stage: SshStage) {
        let _ = stage;
    }
}
```

**SshEventHost**：把 russh 的异步事件桥接到宿主 UI 的回调抽象——终端事件泵（supertrait EventListener）白送。新增的方法只有 ssh_stage 一条连接阶段上报，默认丢弃。设计值得细看两处。其一，supertrait 选 EventListener 不是顺手。Term 的事件泵本来就靠它发 Wakeup。SshEventHost 继承它，spawn_session_at 就能把同一个 event_proxy 既交给 Term、又交给连接阶段——不需要第二套通知机制。其二，ssh_stage 有默认实现，不关心连接进度的调用方零成本。阶段枚举 SshStage 的文档还顺带驳了「进度条是估算的」这类想象。每个取值都对应一个真实调用点（Resolve → Connect → Authenticate → OpenShell → Ready / Failed），不是百分比。

两个壳各自实现同一接缝。旧 winit 壳把阶段投递进自己的事件类型。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ssh_session.rs（行 77–84）
#[cfg(feature = "legacy-shell")]
impl SshEventHost for EventProxy {
    fn ssh_stage(&self, stage: SshStage) {
        // [`EventProxy`] 自带 `tab_id`，后台 runtime 不需要知道 pane id
        // 或 window id（固有 `send_event(EventType)`，非 trait 方法）。
        self.send_event(crate::event::EventType::SshConnect(stage));
    }
}
```

GPUI 壳的代理则投递进一条独立的阶段流。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/terminal/session.rs（行 30–40）
impl EventListener for EventProxy {
    fn send_event(&self, event: Event) {
        self.events.send(event);
    }
}

impl crate::ssh_session::SshEventHost for EventProxy {
    fn ssh_stage(&self, stage: crate::ssh_session::SshStage) {
        let _ = self.stages.unbounded_send(stage);
    }
}
```

于是「一条业务路径服务两个壳」有机械证据：两个壳各调 spawn_session_at 恰好一次。GPUI 侧的模块文档把合同写死。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/terminal/session.rs（行 1–6）
//! PTY 会话接线：`Term` + `EventLoop` + ConPTY，全部来自 `nebula_terminal`。
//!
//! 与 `nebula_app::window_context::create_pane` 相同的模式，只是事件出口换成
//! futures channel，让 GPUI 前台任务可以 `await` 事件。SSH 会话复用同一
//! `TerminalSession` 形状：传输层换成 `ssh_session::spawn_session`（russh
//! 直连，与旧壳同一条业务路径），事件与输入协议不变。
```

没有 UI 的路径也各有归属——exec_capture 与 open_sftp 传的是 None 加一个空体实现，阶段上报整体关掉。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ssh_session.rs（行 86–90）
#[derive(Clone)]
struct NoopSshEventHost;

impl nebula_terminal::event::EventListener for NoopSshEventHost {}
impl SshEventHost for NoopSshEventHost {}
```

顺带一提认证侧的一块小合同。agent 身份选择模块（agent.rs）给自己的约束是「发现可回退；签名失败不可回退」——探不到 agent 端点可以降级试私钥；签名一旦出错这条传输就作废。因为 russh 还在等一个永远不会来的签名，任何补救都救不回这个状态。它的全部预算是四个常量：总发现 3 秒、单端点 1.5 秒、读 .pub 偏好键 1 秒、selector 文件上限 64 KiB。折算体感：3 秒总预算不够你输错一次密码，但它本来就不等人——它只够「探一圈系统 agent 端点」；每台主机每次新连 agent、从不加载私钥、从不转发、从不持久化身份，模块文档把这四条「从不」列成了合同。远端 channel 上还会设置 NEBULA_REMOTE_HOOK_TOKEN 一类环境变量——NEBULA_ 前缀又是命名双轨的遗迹（[第 1 章](./01-repo-map.md)）。

## 演练：画出两条数据路径

现在合上书，先自己画一遍。取一张纸，左边画本地 pane 的数据路径，右边画远端 pane 的。要标出四件事：字节从哪进来、经谁喂给 Term、UI 怎么知道该重画、resize 谁同步谁。画完对照下面这张拼版图（指向正文引用的锁定源码）。

```text
# 拼版：本地与远端两条数据路径（各段出处见正文引用）
本地 pane                        远端 pane
────────                         ────────
键盘字节                          键盘字节
  │ Msg::Input（同一枚举）          │ Msg::Input（同一枚举）
  ▼                                ▼
事件循环 I/O 线程                 pump（共享 tokio Runtime 上的任务）
  │ 写 PTY master                  │ channel.data() → 网络
  ▼                                ▼   → sshd → 远端 PTY → shell
ConPTY/Unix PTY ← shell          channel.wait() → Data/ExtendedData
  │ 可读分块读                      │
  └──────► stream.feed(Term) ◄────┘     同一入口
              ▼
     网格与单元格记账 + damage
              ▼
     Wakeup → 渲染只重画坏区

resize：Msg::Resize               resize：Msg::Resize
  → ResizePseudoConsole             → terminal.resize + channel.window_change
  （ConPTY 对账吸收重放）             （远端 PTY 同步，无 conhost 可对账）

分叉点：pane 创建层（create_pane vs create_ssh_pane；spawn vs spawn_ssh）
汇合点：Term + Msg 协议 + StreamProcessor（nebula_terminal，零改动复用）
```

两条路径的分叉发生在会话边界（pane 创建那一层），边界以下各走各的搬运，边界以上同一段代码。对照探针把每个论断钉死（在 `courses/pebrel-course/companion` 目录执行）：

```bash
node scripts/probe-06-ssh-session.mjs
```

27 条断言分六组。A 组证「远端不建本地 PTY」——四行文档合同、两个 ConPTY 开关、全树负扫描、分叉点、shell_pid=0；B 组证「channel 喂同一协议栈」（同源 import、四消息 pump、feed 双入口、句柄同型）；C 组证连接池与复用；D 组证路由四变体、二级上限、池键指纹、connect_stream 恰好 4 处；E 组证 SshEventHost 双壳实现；F 组证 agent 预算常量。末行 summary 打印整条证据链的行号摘要。

## 验证：先猜后跑

三项验证，每项先落笔再执行。

一、grep 计数。在锁定 clone 根目录执行，先猜数字再看输出。

```bash
grep -c "client::connect_stream(" nebula_app/src/ssh_session.rs
```

答案是 4。如果你猜的是 1——「直连嘛，一条 TCP」——就漏了代理、跳板、自定义命令三种运输段。四种运输、四个流、一个握手函数：字节流是唯一接缝的机械证据。

二、池键推理。同一台目标 user@host:port，同一份凭据：pane 甲直连，pane 乙经跳板机到达。先猜两个离散值再看下一行的答案：连接池里有几条到该目标的连接？两个 pane 的连接会互相复用吗？

答案：恰好 2 条，互不复用。池键缀有路由指纹——甲的键以 direct 段的 SHA-256 结尾，乙的以 jump 段结尾，键不同即身份不同。乙那条路径里，跳板机自己还会以自己的 user@jump:port 键入池。回看「路由即身份」一节的 format 那一行。

三、纸上手术（定向破坏）。不改 clone、不改探针，在纸面上完成：把 route.rs 行 178 的 `if depth >= 2 {` 改成 `if depth >= 3 {`。先写两个离散预测再往下读。

预测一：探针 27 条里红几条？答案是恰好 1 条——「有界深度」那条断言查的就是 `if depth >= 2 {` 这个字符串，改了即红。你可能预期「路由即身份」那条也红，它居然还绿：指纹只对每一跳的运输类型与身份做哈希，根本不关心深度上限是几；它守的是「同目标不同路径不共享连接」，不是「路径最多几跳」。

预测二：真实世界暴露什么？build_route 的递归失去唯一的深度护栏，三级以上的跳板链会被放行。每多一级，递归栈多一层、连接多一条、延迟多一段。而错误消息「跳板链过深，最多支持 2 级跳板」从此变成谎言：拒绝的门槛与文案不再互相作证。没有崩溃，没有报错，只有上限悄悄松了——这正是「护栏是常量不是注释」的反面教材。

（在纸面上）把那行改回去，27 条恢复全绿。

## 迁移自查

1. 假设要新增第四种运输段——比如经串口线连一台交换机。按本章结构列出要动的位置与不许动的位置，并说明为什么 Term 与渲染一行都不用改。（回看 RouteTransport 四变体与 open_transport 的接缝。）
2. 一台开了 MFA 的服务器：第一个 pane 连 shell，SFTP 面板随后上传，宿主又在后台 exec_capture 跑了一条命令。认证发生几次？MFA 弹几次？若此时第一个 pane 被关掉，剩下两条 channel 会跟着死吗？（回看连接复用一节的池命中分支与自愈分支。）
3. 管理员把「经跳板 A 再经跳板 B 到达目标 C」配给了你，同时你还有一个直连 C 的旧配置。两个 pane 同时打开，到 C 的 SSH 连接有几条？到 A 的呢？为什么不会出现「直连 pane 意外骑上跳板连接」？（回看路由指纹的逐跳标段。）

<details>
<summary>参考答案</summary>

1. 动的位置：route.rs 给 RouteTransport 加一个变体并在 build_route 解析它；ssh_session.rs 的 open_transport 加第五处 client::connect_stream（串口也是一种字节流）；路由指纹的 match 加一个标段。不许动的位置：Term、网格、渲染、Msg 枚举、pump 的消息分支——它们只认字节与消息，不认运输。这正是传输层无关的验收口径：新运输的成本被关在会话边界以下。
2. 认证一次（第一个 pane 建立连接时），MFA 弹一次；SFTP 与 exec 走池复用，各开独立 channel，不再触发认证。关掉第一个 pane 只关闭它自己的 shell channel，连接与其余 channel 不受影响；连接的生死由 keepalive 与池的自愈管理，不与任何单个 channel 绑定。
3. 到 C 两条（直连键与 jump 指纹键不同），到 A 一条（跳板段按自己的身份入池，只建一次）。直连 pane 骑不上跳板连接，因为两者池键不同——池按 route.pool_key() 精确匹配，指纹在键尾，路径不同就取不到同一条。

</details>

## 收束

远端 pane 里的 vim 之所以和本地一个手感，不是有人为远端另写了一套渲染，而是同一套渲染压根没被惊动。分叉发生在 pane 创建那一层：本地 fork PTY，远端递归建路由再开 channel。边界以上是同一段 Term、同一枚 Msg、同一个 feed 入口、同一种 Wakeup 通知。三个直觉也各有下场。「需要另一套渲染」倒在负扫描下——远端会话全树零本地 PTY 符号，ConPTY 专属补偿只剩两个显式关闭的开关；「一个连接一个会话」倒在连接池下——终端、SFTP、exec 共用一条已认证连接，各开各的 channel；「跳板是参数拼接」倒在路由的数据结构下——四变体运输计划、二级上限、环路护栏、进池键的逐跳指纹。这四样，字符串拼接一样都给不出。

本章新增四块积木：传输层无关——会话边界以下换字节来源、边界以上零改动的架构原则；russh 连接复用——一条已认证连接上按需开 channel 的入口模型；jump 路由——把到达路径解析成类型化计划、以指纹参与连接身份的规则；SshEventHost——协议逻辑与宿主接线之间那条回调接缝。

下一站（[第 7 章](./07-sftp-engine.md)）：同一条连接上的 SFTP 为什么慢——单在途 READ 上限的账，从本章的 channel 与复用算起。
