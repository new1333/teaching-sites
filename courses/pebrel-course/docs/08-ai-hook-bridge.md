---
title: 第 8 章 钩子桥进程：AI CLI 事件的隐形搬运工
---

# 钩子桥进程：AI CLI 事件的隐形搬运工

## 工具箱

本章要调用的旧积木只有两块；钩子桥自己的机制，从零建立。

- **命名双轨** — 新名 Pebrel、PEBREL_* 与旧名 nebula_*、NEBULA_* 并存的兼容约定；引用代码用 crate 现名，见到旧前缀按兼容层理解（[第 1 章](./01-repo-map.md)）。
- **所有权地图** — 落点查表入口：拿改动描述对 architecture.md 的 owns / must-not-become 两栏，读出落点 crate 与禁区（[第 1 章](./01-repo-map.md)）。

## 钩子：宿主是怎么知道的

在 Pebrel 的一个 pane 里启动 Claude Code，让它修一个 bug。它干活时 pane 的状态标记是「工作中」；它停下来等你审阅，标记变成「等待输入」；回合结束时你不在，宿主还能给出一条完成通知。可 Claude Code 从头到尾只往自己的 stdout 打字——它没有到终端的任何直连线路。

信息走的是一条暗道。Claude Code 这类 CLI 提供钩子机制：在回合事件发生时，比如你提交提示、工具调用结束、回合停止，执行一个外部程序。Pebrel 装进去的那个程序叫 pebrel-hook，一个 492 行、零第三方依赖的小进程。它不画界面、不读键盘，每次唤起主要做三件事：从 stdin 或末位参数接过原始载荷；按一个环境变量里写的地址，把载荷写进一条命名管道；然后以退出码 0 退出。

这就是本章的主角：命名管道桥——被 CLI 钩子反复唤起的小进程，经一条按名字寻址的命名管道，把原始载荷转交给常驻宿主的接收端。整条桥由两部分组成：nebula_hook crate（搬运工本体）与 nebula_app/src/ai_hook（宿主侧的接收、解析与安装）。

拿工具箱里的所有权地图查一下落点。architecture.md 给 nebula_hook 的合同有两栏。owns 一栏写 Small process/lifecycle hook bridge；must not become 一栏写 An application dependency container——它永远不许长成一个依赖容器。这个 crate 本身也是命名双轨的活标本：package 名叫 nebula_hook，编译出的二进制却叫 pebrel-hook，就在下文引用的 Cargo.toml 里。

三个线索已经摆在桌上：环境变量、命名管道、退出码。本章的问题随之成型：一个住进别人会话的小进程，如何同时做到隐形、作用域正确、并且永远有界？

## 原理：三条写进模块注释的约束

nebula_hook/src/main.rs 的模块文档把设计约束按优先级写成三条：INVISIBLE、SCOPED、BOUNDED。先读原文，再逐条拆开。引用块首行的 仓库@SHA:路径 标注，让你能把每一段贴回锁定源码逐字对读，全书统一这个格式。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_hook/src/main.rs:9-23
//! Design constraints, in order:
//!
//! 1. INVISIBLE: a Stop hook's exit code is meaningful to claude (non-zero
//!    surfaces an error banner, 2 even blocks the turn), and kimi's `Stop` is
//!    likewise a blockable event. Every path — including panic — must exit 0,
//!    fast. Claude and kimi also write the payload to our stdin, so those modes
//!    drain stdin within a bounded invocation even when the message goes nowhere.
//!    A caller retaining stdin or a stalled receiver must not leave this helper
//!    running indefinitely and holding the installed executable open.
//! 2. SCOPED: the hook config is global (settings.json / kimi's config.toml),
//!    but the effect must be Nebula-only. The scope guard is the environment:
//!    NEBULA_NOTIFY_PIPE only exists for processes spawned inside Nebula.
//!    Anywhere else it forwards nothing and exits without affecting the caller.
//! 3. BOUNDED: pure std, no JSON handling (Pebrel parses), one pipe write.
//!    Forwarding has a deadline; startup and notification latency depend on the host.
```

### 隐形合同：连 panic 都要退 0

先替直觉说句公道话。「失败要暴露给用户」在大多数工程里是对的，静默吞错通常要挨批评。但这个进程的失败语义不属于 Pebrel，而属于调用它的 CLI。看注释原文的两句话：Stop 钩子的退出码对 claude 有意义——非零会在界面上弹出错误横幅，退出码 2 甚至直接阻断整个回合；kimi 的 Stop 同样是可阻断事件。换句话说，钩子一旦崩溃，用户看到的是「我的 AI 工具坏了」。把自己的诊断便利排在用户的任务前面，才是这里真正的坏味道。

于是有隐形合同——这个进程的任何执行路径，包括 panic，都必须以退出码 0 快速结束，绝不把故障暴露给调用方。载体是 main() 的三段式结构：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_hook/src/main.rs:169-197
fn main() {
    // Constraint 1: never leak a failure to the calling CLI.
    let args: Vec<String> = std::env::args().skip(1).collect();
    let forwarding_args = args.clone();
    let (done, finished) = std::sync::mpsc::sync_channel(1);
    // Bound the entire forwarding operation, including stdin drain and pipe
    // writes. A read-only timeout would still leave a blocked writer alive.
    // This one-shot process never joins a stuck worker: returning from main
    // retires all of its threads and handles. The provider sees exit code 0.
    if std::thread::Builder::new()
        .name("hook-forward".into())
        .spawn(move || {
            let _ = std::panic::catch_unwind(|| run(&forwarding_args));
            let _ = done.send(());
        })
        .is_ok()
    {
        let _ = finished.recv_timeout(FORWARD_TIMEOUT);
    }
    // A user-owned notifier is independent of our best-effort transport. Never
    // wait for it and do not suppress it when the Pebrel pipe is unavailable.
    chain_notifier(&args);
    // Cursor 的提交前 Hook 有响应合同；传输失败也不能阻止用户提交。
    if args.first().is_some_and(|source| source == "cursor")
        && native_event(&args) == Some("prompt")
    {
        let _ = std::io::stdout().lock().write_all(b"{\"continue\":true}\n");
    }
}
```

退出码 0 由三道保险合围出来：

1. 全部转发工作搬进子线程并包进 catch_unwind（main.rs:181）。run() 里任何一处 panic 都会就地展开栈——catch_unwind 把它接住，线程正常收尾，main 照常走到返回。
2. 主线程只等 FORWARD_TIMEOUT（main.rs:186）。2 秒内没等到完成信号也直接返回，绝不 join 卡死的 worker。注释写明：从 main 返回就回收了它的全部线程与句柄，The provider sees exit code 0。
3. 输出侧另有两笔小合同。走 stdin 的 CLI 必须读完管道，否则未读的管道会在 CLI 侧变成 hook write error；cursor 的 prompt 事件必须回写一行 {"continue":true}，否则用户的提交动作被卡住。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_hook/src/main.rs:219-225
/// 载荷通道。claude 与 kimi 都把事件 JSON 写到我们的 stdin（kimi 的 `[[hooks]]`
/// command 与 claude 的 hook 同形态，事件经 stdin 传入）；走 stdin 的 source 必须
/// 无论如何都抽干管道（约束 1：未读的管道会在 CLI 侧变成 hook write error）。
/// 其余 CLI 把载荷追加为末位参数。
fn payload_on_stdin(source: &str) -> bool {
    matches!(source, "claude" | "kimi" | "copilot" | "grok" | "cursor")
}
```

对比一下你手里已有的清理积木：GPUI 侧的资源清理合同是「显式 shutdown 先行、Drop 兜底」的双保险，因为它常驻、对象关系复杂。这里的答案更极端——退出本身就是清理。一次性进程没有「谁负责释放」的问题，main 返回即全部回收。

那失败去哪了？被有意吞掉的失败需要旁路取证。宿主把 NEBULA_HOOK_LOG 指向一个文件时，每次调用追加一行 NDJSON：时间、来源、pane、字节数、去向，绝不记载荷内容。去向有六种取值：sent、not-hosted、pipe-unavailable、payload-too-large、remote-osc、foreign-runner。后几种取值在下文各自的位置出现。

探针在这条约束上钉了三根钉子：模块文档的 Every path — including panic — must exit 0 逐字存在；catch_unwind 那一行逐字存在；recv_timeout 与 The provider sees exit code 0. 逐字存在。注意钉住的是什么：不是「意图良好」，而是可逐字复核的事实。

### 环境变量哨兵：全局配置，局部效果

SCOPED 约束面对的难题就藏在注释里那句话：the hook config is global。钩子配置写在用户级的 settings.json 与 config.toml 里，跨终端、跨工具。那么钩子进程怎么知道「现在宿主是谁、在不在」？

直觉会往两个方向走，两个方向都值得先说公道话。全局配置像是对的——配置本来就住在全局，把管道地址也写进一份全局配置，查一次就知道找谁。轮询也像是老实办法——定期探测宿主是否还在。但各做一个反事实：靠全局配置，同一台机器开两个 Pebrel 实例时事件该进谁？在别的终端里跑的 claude，事件凭什么进 Pebrel？靠轮询，每个回合事件都要烧一次发现成本，而这个进程的全部预算是毫秒级的冷启动。

实际的机制是环境变量哨兵——宿主用自己的环境变量向钩子进程指明管道地址，变量只存在于 Pebrel 生出的进程里，作用域由进程继承关系天然圈定。宿主侧的定义与注入点如下：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ai_hook.rs:41-53
/// Environment variable carrying this instance's pipe name into child shells
/// (ConPTY merges the current process environment, so setting it process-wide
/// before the first PTY spawn covers every pane).
pub const PIPE_ENV: &str = "PEBREL_NOTIFY_PIPE";
pub const LEGACY_PIPE_ENV: &str = "NEBULA_NOTIFY_PIPE";
/// Per-pane identity, injected into each pane's PTY environment.
pub const PANE_ENV: &str = "PEBREL_PANE_ID";
pub const LEGACY_PANE_ENV: &str = "NEBULA_PANE_ID";
/// Absolute path of `nebula-hook.exe`, exported so the opencode Bun plugin
/// (which cannot resolve nebula.exe's install dir on its own) can shell out to
/// the bridge. Same process-wide scope as [`PIPE_ENV`].
pub const HOOK_EXE_ENV: &str = "PEBREL_HOOK_EXE";
pub const LEGACY_HOOK_EXE_ENV: &str = "NEBULA_HOOK_EXE";
```

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ai_hook/win/transport.rs:32-38
fn spawn_pipe_server(sink: impl Fn(AiHookEvent) -> bool + Send + 'static) {
    let name = format!(r"\\.\pipe\pebrel-notify-{}", std::process::id());
    // SAFETY: single-threaded startup; no other thread reads the env yet.
    unsafe {
        std::env::set_var(PIPE_ENV, &name);
        std::env::set_var(LEGACY_PIPE_ENV, &name);
    };
```

启动时机是关键：管道名赶在第一个 PTY 之前写进宿主的进程环境。pane 里的 shell 住在一个 PTY 伪终端里——内核提供的成对设备，让 shell 以为面对真实终端（[第 3 章](./03-pty-event-loop.md)）。Windows 的 ConPTY 会合并宿主的进程环境，于是这张环境表一路传到每个 pane 里的 shell、shell 里的 CLI，再到 CLI 唤起的钩子。管道名带着宿主的进程号（pebrel-notify-{pid}），按实例唯一：两个 Pebrel 同时开，各自的钩子只会找到各自的管道。

钩子侧的读取收敛在一个函数里：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_hook/src/main.rs:77-86
fn hook_env(name: &str) -> Option<std::ffi::OsString> {
    aliased_env(name, |name| std::env::var_os(name))
}

fn aliased_env(
    suffix: &str,
    mut read: impl FnMut(&str) -> Option<std::ffi::OsString>,
) -> Option<std::ffi::OsString> {
    read(&format!("PEBREL_{suffix}")).or_else(|| read(&format!("NEBULA_{suffix}")))
}
```

这里正是命名双轨积木的一次调用：先读新名 PEBREL_{suffix}，落空才回退旧名 NEBULA_{suffix}（main.rs:85）。宿主侧把两个前缀设成同一个值，是为了照顾仍在使用的旧版 pebrel-hook 二进制——它们只认旧名。空串另有专门语义，测试把它钉死了：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_hook/src/main.rs:385-390
        values.insert("PEBREL_NOTIFY_PIPE", "".into());
        assert_eq!(
            super::aliased_env("NOTIFY_PIPE", |name| values.get(name).cloned()),
            Some("".into()),
            "an explicit empty scope must not fall through to a legacy host"
        );
```

一个显式置空的哨兵表示「明确不在本宿主」，不许穿透回旧名——否则想关掉转发的宿主，会把事件漏给另一个还在用旧名的实例。

变量不存在时的行为也定了型：转发分支由 hook_env("NOTIFY_PIPE") 驱动，取不到就整体跳过，静默退出，退出码仍是 0。Outcome 枚举给这种去向起了名字：NotHosted，注释说这是最常见的一种，也是设计如此。你在系统终端里跑 claude、钩子照常唤起时，走的正是这条分支——事件不泄漏，会话不受影响。

管道本身怎么用？命名管道在这套代码里就是一个可以打开的路径：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_hook/src/main.rs:297-313
    // 本地 Pane 使用命名管道；远端 Pane 没有本地管道时，把同一信封写入控制终端的私有 OSC。
    let mut outcome = Outcome::NotHosted;
    if let Some(pipe) = hook_env("NOTIFY_PIPE") {
        // The server accepts one connection at a time and re-creates the pipe
        // instance in between, so a raced connect fails for microseconds.
        // Retry briefly, then give up silently: notifications are best-effort.
        outcome = Outcome::PipeUnavailable;
        for _ in 0..20 {
            match std::fs::OpenOptions::new().write(true).open(&pipe) {
                Ok(mut file) => {
                    let _ = file.write_all(&message);
                    outcome = Outcome::Sent;
                    break;
                },
                Err(_) => std::thread::sleep(std::time::Duration::from_millis(5)),
            }
        }
```

以写模式 open 管道名、write_all 一次写完，没有任何专用 API。宿主的接收端每次只接受一个连接、收完重建管道实例，竞态窗口只有微秒级；钩子侧用 20 次重试、每次隔 5ms 吸收它，总预算约 100ms。通知是尽力而为，重试用尽就记 pipe-unavailable 退场。

写进管道的不是裸载荷，而是一个信封：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_hook/src/main.rs:249-255
/// 侧信道信封：一行 `nebula-hook/1 source=<s> pane=<p>` 头加原始载荷。helper 不重
/// 编码，Nebula 侧按 source 路由到对应 provider 的解析分支。
fn envelope(source: &str, pane: &str, contract: &str, payload: &[u8]) -> Vec<u8> {
    let mut message = format!("nebula-hook/1 source={source} pane={pane}{contract}\n").into_bytes();
    message.extend_from_slice(payload);
    message
}
```

信封头一行声明协议版本、来源与 pane，载荷原样贴在后头，helper 不做任何重编码。pane 号来自另一个哨兵 PEBREL_PANE_ID：宿主为每个 pane 单独写环境表（nebula_app/src/agent_env.rs:76），钩子读到后签进信封。这个 id 恰好是分屏树的一片树叶。布局内核是一棵纯数据布局树，树叶集合不变式保证 pane id 集合与树叶一一对应（[第 4 章](./04-split-tree.md)）。署名总能对回一棵真实的树，宿主据此把事件送进对应 pane 生命周期的时间线（[第 5 章](./05-gpui-shell.md)）。

### 有界转发：1 MiB 与 2 秒

「转发越快越好」的方向感是对的，但推出的结论不是「不设上限」，而是「处处有界」。Cargo.toml 的注释把这次序说透了：这个二进制每个回合事件启动一次，进程启动本身就是延迟预算，零依赖等于最小导入，冷启动小于 15ms。快是目标，界是手段。

反事实先行。没有载荷上限：一个异常大的载荷会占住内存与管道，而宿主不该为一条通知付出这种代价。没有超时：一个停摆的接收端会让 write_all 永远阻塞，helper 变成不死进程。注释还点了第三重后果——挂死的 helper 会一直占着已安装的可执行文件，升级时换不掉。

两个常量把界画出来：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_hook/src/main.rs:43-46
use std::io::{Read, Write};

const MAX_PAYLOAD_BYTES: usize = 1 << 20;
const FORWARD_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);
```

1 << 20 是 1_048_576 字节，整 1 MiB——不是十进制的 1_000_000。超限的判定与处理在 read_payload：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_hook/src/main.rs:199-208
fn read_payload(mut reader: impl Read) -> std::io::Result<Option<Vec<u8>>> {
    let mut bytes = Vec::with_capacity(4096);
    reader.by_ref().take((MAX_PAYLOAD_BYTES + 1) as u64).read_to_end(&mut bytes)?;
    if bytes.len() > MAX_PAYLOAD_BYTES {
        std::io::copy(&mut reader, &mut std::io::sink())?;
        Ok(None)
    } else {
        Ok(Some(bytes))
    }
}
```

注意 take 的参数是 MAX_PAYLOAD_BYTES + 1。多读这一个字节，一次有界读取就能区分两种情况：读完恰好不超限，整段转发；读到第 N+1 个字节，必然超限。不需要先读 N 个再试探余量。超限后的动作有两个：把余量全部抽干——CLI 侧的管道不能留着没读；然后整体丢弃，记 payload-too-large，绝不转发截断的 JSON。宿主不该收到半行必然解析失败的载荷。

2 秒超时罩住的范围在 main() 的注释里写死：整个转发操作，含抽干与写管道，而不只是读。只给读设超时，会留下一个卡死的写者。超时到点后的处置你已经见过——主线程返回，worker 不 join，进程退出。

探针在这条约束上钉了五根钉子。载荷上限 1 << 20 逐字；超时 Duration::from_secs(2) 逐字；注释 Bound the entire forwarding operation 逐字；take(MAX_PAYLOAD_BYTES + 1) 与 copy 到 sink 逐字；payload-too-large 字符串逐字。

### 一张空的依赖表

BOUNDED 的第一条是 pure std。整个 Cargo.toml 如下，一共就这么几行：

```toml
# Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_hook/Cargo.toml
[package]
name = "nebula_hook"
version = "0.6.0"
license = "GPL-3.0-or-later"
description = "Tiny bridge: AI-CLI lifecycle hooks -> Nebula named pipe"
publish = false
edition.workspace = true
rust-version.workspace = true

# Pure std on purpose: this binary runs once per AI turn event, so process
# startup IS the latency budget. No deps = minimal imports = <15 ms cold.

[[bin]]
name = "pebrel-hook"
path = "src/main.rs"
```

没有 [dependencies] 表。实测的 section 只有两个：package 与 bin。这不是疏忽，是写进治理文档的合同。docs/project-constraints.md 明说：nebula-settings、nebula-split 与 nebula_hook 保留既有的零生产依赖契约。architecture.md 的禁区措辞说的是同一件事——不得变成 an application dependency container。

把这本书到目前为止建立的机制摊开，逐个问「它会不会出现在这个进程的 use 里」，能看清这张空依赖表的分量。VT 转义序列的解析、网格与单元格、TermMode 位域、damage 追踪，全部住在 nebula_terminal（[第 2 章](./02-vt-grid.md)）。事件循环与 FairMutex 在那边管 I/O 线程的调度，ConPTY 对账管 resize 重放（[第 3 章](./03-pty-event-loop.md)）。nebula_split 的纯数据布局树与切割次序合同（[第 4 章](./04-split-tree.md)）在这里没有对应物。GPUI 侧的 GPUI Entity 与 prepaint 回写（[第 5 章](./05-gpui-shell.md)）同样缺席。SSH 的 russh 连接复用、jump 路由与 SshEventHost（[第 6 章](./06-ssh-session.md)）也不在这个进程里。SFTP 的单在途 READ 上限、多句柄分段、进度/取消接缝（[第 7 章](./07-sftp-engine.md)）更是两个世界。治理工具也大多用不上：SHA 钉版钉的是 GPUI 那类 fork 依赖，这里没有依赖表可钉；ratchet 预算约束的是旧文件的只减不增，这个单文件不靠预算就守住了体积。crate 依赖方向图里它是一片孤叶：读它的行为只需要 std 的语义，不需要先懂任何邻居。

### --chain：给被占用的槽位让路

codex 的 notify 机制只有一个槽位，而槽位可能已经被占——比如 OpenAI 自家的 computer-use notifier。模块文档给出了成因与对策：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_hook/src/main.rs:35-37
//! `--chain` exists because codex has a single `notify` slot which may
//! already be taken (e.g. OpenAI's own computer-use notifier): we forward to
//! Nebula and then invoke the original program with the same payload.
```

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_hook/src/main.rs:332-342
fn chain_notifier(args: &[String]) {
    // Chain mode: keep a pre-existing codex notifier working. Runs even
    // outside Nebula — the original program must keep firing everywhere.
    let strs: Vec<&str> = args.iter().map(String::as_str).collect();
    if let ["codex", "--chain", prog, rest @ ..] = &strs[..] {
        if !rest.is_empty() {
            let (fixed, json) = rest.split_at(rest.len() - 1);
            let _ = std::process::Command::new(prog).args(fixed).args(json).spawn();
        }
    }
}
```

参数形如 nebula-hook codex --chain 原程序 固定参数 json。钩子先照常转发给 Pebrel，再把原程序用同一载荷 spawn 一遍。两个细节都在注释里：是 spawn 不是 wait——用户的原通知器不受我们等待的拖累；并且 Runs even outside Nebula——在不在 Pebrel 里，原程序都必须照常工作。这是隐形合同的另一面：我们的通道是尽力而为，不许挤压用户已有的东西。

### 两条旁路：远端与串台

以下两段超出本章主线，能定位即可，不展开机制。

其一，远端通道。SSH pane 里没有本地命名管道，同一段 run() 的 else 分支改走控制终端。做法是把信封 base64 编码后，包进一条 OSC 转义序列写进 /dev/tty——OSC 是 VT 转义序列家族的一员（[第 2 章](./02-vt-grid.md)），形如 `ESC ]777;nebula-hook;token;base64载荷 BEL`。字节流顺着既有的 SSH 通道回到宿主——搭的是 russh 连接复用的便车；无论这条连接是直连还是经 jump 路由多跳，中间环节对它透明。哨兵换成了 32 位十六进制的 REMOTE_HOOK_TOKEN，消息上限收紧到 64 KiB。同一信封、两种物理通道，是传输层无关原则在事件入口的缩影（[第 6 章](./06-ssh-session.md)）。

其二，串台门。别家 agent 的 hook runner 会读取同一份 ~/.claude/settings.json，于是 Pebrel 装给 claude 的钩子会在 Grok Build 的事件上触发。把 Grok 的事件当 claude 上报有两个后果：pane 贴错 provider 身份；别家的 session id 拿去 claude --resume 一个不存在的会话。FOREIGN_HOOK_RUNNERS 记录这些 runner 独有的环境变量，当前是 GROK_HOOK_NAME 与 GROK_HOOK_EVENT，命中即退场。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_hook/src/main.rs:278-284
    // 串台门。放在读完 stdin 之后：约束 1 要求 stdin 模式的 source 无论如何都把
    // stdin 抽干（未读的管道会在 CLI 侧变成 hook write error），所以先读再退。
    // Grok 同时读取 Claude 与 Cursor 配置；这些借用的入口不能认领 Grok 会话。
    if matches!(source.as_str(), "claude" | "cursor") && foreign_hook_runner().is_some() {
        log_outcome(source, "", payload.len(), &Outcome::ForeignRunner);
        return;
    }
```

值得抄一句源码里的自白：这道门会静默失效——变量一旦改名或停止导出，门就永远不再命中，而且没有任何报错。所以宿主侧对载荷形状的校验独立再拦一层，不把这道门当唯一防线。

## 演练：在锁定源码上核对

以下操作都在课程的锁定 clone（.course/repo @ 360613aa）上做，全程只读；定向破坏那一步除外，破坏后复原。

1. 先猜再打开 nebula_hook/Cargo.toml：写下你预测的依赖表数量，再打开数一数。预期是 0；探针的实测口径是「section 只有 package, bin」。
2. 核对导入面：`grep -n "^use " nebula_hook/src/main.rs`。预期 4 条，全部以 std:: 或 super:: 开头。
3. 走读退出链：打开 main.rs 的 169-197 行，按顺序找到 catch_unwind（:181）、recv_timeout（:186）与 chain_notifier（:190）。给三处各写一句话：它守的是哪条约束的哪个失效模式。
4. 跑本章探针，在 companion 目录执行 `node scripts/probe-08-ai-hook-bridge.mjs`。预期 19 项全 ok：

```text
# companion/scripts/probe-08-ai-hook-bridge.mjs 运行输出（节选）
ok   [ai-hook-bridge] nebula_hook/Cargo.toml 不含任何依赖表（实测 section：package, bin）
ok   [ai-hook-bridge] main.rs 全部 use 导入仅 std/super（实测 4 条）
ok   [ai-hook-bridge] MAX_PAYLOAD_BYTES 逐字 = 1 << 20（即 1_048_576 字节 = 1 MiB，不是 1_000_000）
ok   [ai-hook-bridge] FORWARD_TIMEOUT 逐字 = Duration::from_secs(2)
ok   [ai-hook-bridge] 钩子侧统一走 aliased_env：先读 PEBREL_{suffix}， miss 才回退 NEBULA_{suffix}（main.rs:85 逐字）
PASS  [ai-hook-bridge] 19/19 checks
```

## 验证：先猜，再跑，再破坏

### 纸面推演：停摆的接收端

场景：管道存在且能连上，但宿主接收端停摆不读；载荷 500 KB。先落笔写下三个离散预测，再对答案。

- 退出码：0、非 0、永久卡死，三选一。
- 耗时量级：约 2 秒、远大于 2 秒，二选一。
- 侧信道日志：有一行、没有日志，二选一。

答案：0；约 2 秒；没有日志。解释：主线程 recv_timeout(FORWARD_TIMEOUT) 到点返回，worker 不被 join，进程退出回收一切——前两项由 main() 的结构直接推出。第三项最刁：写日志的 log_outcome 排在卡住的 write_all 之后，永远执行不到。若你预测「有一行 pipe-unavailable」——那是连不上管道、重试 20 次用尽的分支；本场景是「连上了但读端停摆」，两个分支不同。

### 定向破坏：改一个常量

把 .course/repo/nebula_hook/src/main.rs 第 45 行的 1 << 20 改成 1 << 10。先预言：探针 19 项里恰好几项变红？哪一项必然仍绿？

在课程根目录执行 `node companion/scripts/probe-08-ai-hook-bridge.mjs`，观察：恰好 1 项红——MAX_PAYLOAD_BYTES 的逐字断言；FORWARD_TIMEOUT 断言仍绿，它钉在第 46 行，没有被波及。

解释：这项检查守的不是性能或风格，而是「正文引用与锁定源码逐字一致」的事实合同。正文写了 1 << 20，源码改动后引用与现实脱钩，检查立即变红；未动的第 46 行不受牵连，说明各项断言互相独立、各守各的事实。复原并确认：`git -C .course/repo checkout -- nebula_hook/src/main.rs`，重跑探针回到 19/19。

### 变体：双前缀的收敛点

`grep -n "PEBREL_" nebula_hook/src/main.rs`。预期生产代码里恰好 1 处（:85，aliased_env 里的 format!），其余命中都在测试模块。如果这个数字变大，说明双前缀回退散落到了多个函数——对兼容层来说那才是危险的形状：每多一处，漏改一处就多一个。

三项验证分别核对三件事：约束的可推导性——你能从源码推出行为；引用合同的刚性——引用与现实脱钩会被机械查出；兼容层的收敛性——双轨只在一个点收口。

## 自查：换一个输入

1. 用户在系统自带的终端（不是 Pebrel）里跑 claude，全局钩子已装，NEBULA_HOOK_LOG 指向文件。一次 Stop 事件后：日志那行的 outcome 是什么？退出码是多少？stdin 读没读？
2. 某个 pane 的 PEBREL_PANE_ID 设成了 `7","outcome":"sent`（混入引号）。侧信道写出的那一行还能是合法的一行 NDJSON 吗？哪段代码在负责？
3. codex 的 notify 槽位已被占用，用户配置了 --chain，并且这次在 Pebrel 之外跑 codex。原通知器会响吗？Pebrel 收得到事件吗？

<details>
<summary>参考答案</summary>

1. outcome 是 not-hosted：环境变量哨兵不存在，转发分支整体跳过。退出码仍是 0——隐形合同不因「未托管」而豁免。stdin 仍会被抽干：约束 1 要求走 stdin 的 source 无论如何都读完管道，哪怕消息无处可去。
2. 能。escape_json 对引号、反斜杠与控制字符逐个转义，注入的引号和换行都进不了字段边界；配套测试专门用敌意 pane 值钉住了「整行只有一行、结论字段在最后」。
3. 原通知器会响：chain_notifier 在 Pebrel 之外也执行，spawn 不等待。Pebrel 收不到：没有哨兵，转发走 not-hosted。--chain 的设计正是让这两件事互不拖累。

</details>

## 收束：搬运工交货

回到开篇的问题：宿主怎么知道 Claude Code 开始等人？每个回合事件都短暂唤起一次 pebrel-hook——它在环境变量哨兵里找到本实例的命名管道，把署着 pane 号的信封一次写入，两秒内必定返回，任何路径都以退出码 0 收场。CLI 侧无感，用户任务无扰，这就是隐形搬运工的全部工作。

本章交出四块积木：命名管道桥，AI CLI 事件进入宿主的物理通道；环境变量哨兵，用进程继承圈定作用域的发现机制；隐形合同，辅助进程对调用方的退出码纪律；有界转发，载荷与时间的双界。这些信封到了宿主手里怎么拆开、归一、排序，去向一行：（[第 9 章](./09-ai-lifecycle.md)）。

迁移自查只有三问，以后再遇到「要住进别人会话的辅助进程」就先答它们：退出码合同是什么？作用域哨兵是什么？载荷与时间的界在哪？有一问答不上来，先别写代码。
