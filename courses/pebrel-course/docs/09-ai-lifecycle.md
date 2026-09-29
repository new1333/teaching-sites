---
title: 第 9 章 事件归一与门控排序：从原始载荷到类型化状态机
---

# 事件归一与门控排序：从原始载荷到类型化状态机

## 工具箱

管道的另一端等着三块旧积木：一块管通道，两块管身份。

- **pane 生命周期** — workspace 用 panes + SplitTree + focused 三件套管理 pane，pane id 终生不复用，关闭由 remove_leaf 裁定；追 pane 相关 bug 的事件时间线骨架（[第 5 章](./05-gpui-shell.md)）。
- **命名管道桥** — AI CLI 事件进入宿主的物理通道：CLI 钩子唤起 pebrel-hook，把 `nebula-hook/1` 信封一次写进命名管道，载荷 1 MiB、转发 2 秒封顶（[第 8 章](./08-ai-hook-bridge.md)）。
- **GPUI Entity** — 界面代码的基本单元：实体持状态，Context 提供更新入口，看到 `.update()` 与 `cx` 即在操作实体（[第 5 章](./05-gpui-shell.md)）。

## 钩子：一份数据，三种方言

同一个工作区开三个 pane：左边 claude、中间 codex、右边 kimi。三个徽标行为一模一样——提交提示后亮「工作中」，权限询问时转「等待输入」，回合结束弹完成通知。可这三个 CLI 塞进钩子载荷里的 JSON 毫无亲缘：claude 寄来 `{"hook_event_name": "Stop", "session_id": "…"}`；codex 的 notify 机制寄来 `{"type": "agent-turn-complete", "thread-id": "…"}`；kimi 有自己的 `hook_event_name` 拼法。UI 只认一套状态，中间必须有一位翻译官。

这位翻译官住在 `nebula_app/src/ai_hook`，但它干的远不止翻译。钩子进程是一个个被 OS 独立调度的短命进程，完成事件完全可能跑到它所总结的工具事件前面；一个重放的旧载荷也可能冒充新消息。翻译官因此配了一道门：每个事件批次先按规则裁定时序，裁决者叫 GateVerdict，拒绝必须携带原因。它还持一张档位表，记下每家 CLI 的钩子到底能报告什么——缺的能力才允许退回去看屏幕。归一、门控、分档，就是本章的三块新积木：类型化事件、门控排序、能力集分层。

## 原理：五层流水线，一扇门

### 地图先钉边界

照例先查所有权地图——判断一个改动应落在哪个 crate 的权威查表入口（[第 1 章](./01-repo-map.md)）。`ai_hook` 这一行的合同把本章的全部主题写进了两栏：

```text
# Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:docs/architecture.md:28
| `nebula_app/src/ai_hook` | Normalized provider facts, bounded ordering, one shared pane lifecycle and owned installation policy; Windows adapters | Screen keyword rules or a separate state machine per UI shell |
```

owns 一栏三个短语正好是本章三节：归一化事实、有界排序、一条共享的 pane 生命周期。禁区一栏两个「不许变成」：不许长出屏幕关键词规则，也不许每个 UI 壳各养一台状态机。模块自己的文档头则把依赖流写成一行：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ai_hook.rs:1-9
//! AI lifecycle integration. The dependency flow is:
//! transport -> protocol/payload -> typed events -> ordering -> pane lifecycle.
//!
//! UI adapters render the shared lifecycle and deliver its notifications. They
//! never reinterpret a completed hook by scanning terminal prose. Screen evidence
//! is an explicit fallback for capabilities absent from the active integration.
//!
//! `PEBREL_HOOK_LOG` (legacy `NEBULA_HOOK_LOG`) diagnoses bridge delivery without
//! payloads; `GateVerdict` explains rejected events in application debug logs.
```

五层各有自己的文件：`win/transport.rs` 收管道字节，`protocol.rs` 拆信封，`payload.rs` 做有界抽取，`event.rs` 产出类型化事件，`ordering.rs` 裁定时序，`lifecycle.rs` 持有每个 pane 的状态机。数据只朝一个方向流，任何一层都不许回头改上游。

### parse_envelope：拆开信封

先拆信封。命名管道桥这块积木运来的货，是一行 `nebula-hook/1 source=<s> pane=<n>` 头加原样 JSON——搬运工不重编码，全部 JSON 工作都推到了宿主侧。推开这扇门的就是 `parse_envelope`，全管线唯一的信封入口：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ai_hook/protocol.rs:16-29
/// Parse one pipe message: a `nebula-hook/1 source=<s> pane=<n>` header line,
/// then the hook's raw JSON payload verbatim (the helper never re-encodes;
/// all JSON work happens here, off the turn's hot path).
pub(super) fn parse_envelope(bytes: &[u8]) -> Option<AiHookEvent> {
    let received_at_ms = unix_time_ms();
    let received_sequence = RECEIVE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let nl = bytes.iter().position(|&b| b == b'\n')?;
    let header = std::str::from_utf8(&bytes[..nl]).ok()?.trim();
    let raw = &bytes[nl + 1..];

    let mut fields = header.split_whitespace();
    if fields.next() != Some("nebula-hook/1") {
        return None;
    }
```

头行不是 `nebula-hook/1` 直接作废；`source=` 与 `pane=` 从头行读出，pane 号的出身是环境变量哨兵——宿主给每个 pane 注入 `PEBREL_PANE_ID`，钩子签进信封（[第 8 章](./08-ai-hook-bridge.md)）。进入解析的时刻还盖了两枚自己的章：`received_at_ms`（宿主此刻）与 `received_sequence`（进程内严格自增的接收序号）。后者特意不冒充 provider 顺序，只用于稳定批处理——这个区分在门控一节还要用上。

载荷本体按 source 分支读形状。以 claude 为例：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ai_hook/protocol.rs:114-131
    let (kind, message) = match source.as_str() {
        // 第二道串台门。第一道在 nebula_hook 里靠环境变量判断调用方是不是别家
        // 的 hook runner；那种门会被上游改名静默失效，所以这里独立再拦一次：
        // 别家 runner 的载荷用 camelCase 字段名，claude 从不这样发。
        "claude" if payload.get("hookEventName").is_some() => return None,
        "claude" => match payload.get("hook_event_name").and_then(Value::as_str) {
            Some("SessionStart") => (AiHookKind::SessionStart, None),
            Some("UserPromptSubmit") => (AiHookKind::PromptSubmit, None),
            Some("PreToolUse")
                if payload.get("tool_name").and_then(Value::as_str) == Some("AskUserQuestion") =>
            {
                (AiHookKind::NeedsAttention, attention_message(&payload))
            },
            Some("PreToolUse" | "PostToolUse" | "PostToolUseFailure") => {
                (AiHookKind::ToolComplete, None)
            },
            Some("Stop") => (AiHookKind::TurnDone, None),
            Some("StopFailure") => (AiHookKind::TurnDone, context_string(&payload, &["error"])),
```

注意两个形状细节。其一，camelCase 的 `hookEventName` 是别家 hook runner 的笔迹，见了就丢——这是串台问题在解析层的第二道门，不依赖任何会被上游改名搞哑的环境变量。其二，会话身份的候选键按 source 收紧：claude 与 kimi 只认 snake_case 的 `session_id`，codex 的 notify 只认 `thread-id`。把别家的会话 id 错当 claude 的，交给 `claude --resume` 就是一个不存在的会话。codex 的 notify 载荷则是第三种方言：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ai_hook/protocol.rs:172-181
        "codex" => match payload.get("type").and_then(Value::as_str) {
            Some("agent-turn-complete") => (
                AiHookKind::TurnDone,
                payload
                    .get("last-assistant-message")
                    .and_then(Value::as_str)
                    .map(|m| truncate(m, TURN_RESULT_MAX_CHARS)),
            ),
            _ => return None,
        },
```

同一个「回合结束」，claude 写在 `hook_event_name: "Stop"`，codex notify 写在 `type: "agent-turn-complete"`——两行分支殊途同归到同一个类型。形状不认识的载荷（如 SubagentStop 这类噪音）一律 `return None`，在解析层就地蒸发，永远到不了门。抽取也有界：消息截到 300 字符，注意力上下文 16 KiB 封顶、深度 6 层；键名含 token、secret、password 的一律换成脱敏占位。这是「有界转发」在宿主侧的续篇——桥上有界的是载荷与时间，这里是有界的记忆与脱敏。

调用点只有一处，在传输层读完管道之后：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ai_hook/win/transport.rs:126-139
                if buf.len() > (1 << 20) {
                    break;
                }
            }
            if buf.len() <= (1 << 20)
                && let Some(mut event) = parse_envelope(&buf)
            {
                event.client_pid = client_pid;
                // agent 的进程身份：helper 的父进程往往是执行 hook 命令的
                // shell，agent 在更上一层，所以要沿祖先链找。用它区分嵌套
                // 子代理，见 `AiHookEvent::agent_pid`。
                event.agent_pid = client_pid
                    .and_then(crate::process_tree::nearest_agent_ancestor)
                    .map(|(pid, _)| pid);
```

`1 << 20` 又出现了——桥侧给载荷钉的 1 MiB 上限，宿主侧用同一个数字再守一次，超限的字节根本不进解析器。`client_pid` 不是载荷自报的，是内核对「谁连着这条管道」的回答（`GetNamedPipeClientProcessId`），自报的 pid 可以伪造，内核的不行；`agent_pid` 再沿祖先链上溯，用来区分嵌套子代理。SSH pane 的变体 `parse_remote_envelope` 复用同一解析，但 pane 身份一律用本地 PTY 通道覆盖，远端载荷改不了路由。

### 类型化事件：六个变体收拢所有方言

**类型化事件**——把异构 CLI 的原始载荷归一成 Rust 类型系统里的一个有界枚举，UI 只消费类型、绝不解析文本。它是这条管线的中间表示（IR），全部家当只有六个变体：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ai_hook/event.rs:1-20
//! Normalized provider facts. No terminal scanning, I/O or pane mutation.

use super::payload::{MESSAGE_MAX_CHARS, truncate};

/// What a lifecycle event means for the pane's turn state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AiHookKind {
    /// Agent process/session became live; usually the earliest session-id edge.
    SessionStart,
    /// The user submitted a prompt: a turn is running.
    PromptSubmit,
    /// A tool completed; clears a stale permission/question wait.
    ToolComplete,
    /// The turn finished; the CLI waits for the next instruction.
    TurnDone,
    /// An explicit permission request or input question is blocking the CLI.
    NeedsAttention,
    /// Agent session shut down and no longer owns the pane.
    SessionEnd,
}
```

变体数与 CLI 数量无关：再接十个 CLI，这个枚举还是六个。每个变体带着人话文档——SessionStart 是「会话活了」，TurnDone 是「回合结束、CLI 等下一条指令」，NeedsAttention 是「明确卡在等人」。模块头一句话宣示纯度：No terminal scanning, I/O or pane mutation——这一层只陈述归一后的事实，不看屏幕、不做 I/O、不动 pane。

「UI 应该扫描终端文本判断 AI 状态」这个直觉值得先说句公道话：屏幕文本是永远在场的最后信息源，盯着输出做判断几乎是所有监控脚本的默认手段。但它的失效模式在这套系统里写进了合同。模块头写明：UI 适配器绝不靠扫描终端散文重新解释一个已完成的钩子。屏幕只作为缺失能力的显式回退（explicit fallback），下一节展开。地图禁区里那条 Screen keyword rules 禁的也是同一件事：关键词规则不许搬进钩子层。

### 能力集分层：六个布尔记下每家的短板

**能力集分层**——把「每家 CLI 的钩子能报告什么」写成一张显式档位表；钩子优先提供结构化事件，屏幕证据只作为缺失能力的回退层。先看 Providers 有多不对称：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ai_hook/event.rs:35-52
/// Provider 的 Hook 能力并不对称。这里描述 Nebula 当前实际安装的桥接能力，
/// 避免上层把“有生命周期 Hook”误当成“也有权限上下文或事件顺序保证”。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AiHookCapabilities {
    /// The installed bridge reports turn starts as well as completions.
    pub lifecycle: bool,
    /// The bridge also reports explicit waiting/resumption. This is separate
    /// from turn boundaries: Pi's extension has no permission callback.
    pub attention_events: bool,
    pub attention_context: bool,
    pub background_tasks: bool,
    /// Nebula 自己的 bridge 是否为事件盖了单调序号。**没有任何 provider 提供
    /// 原生顺序字段**：opencode/pi 的序号由我们注入的 plugin/extension 生成
    /// （启动纪元 × 1e6 + 自增），claude/codex 的 hook 完全没有顺序信息，只能
    /// 依赖本地到达顺序。名字里是 bridge 而不是 provider，正是这个原因。
    pub bridge_sequence: bool,
    pub serialized_delivery: bool,
}
```

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ai_hook/event.rs:62-79
pub fn capabilities_for(source: &str) -> AiHookCapabilities {
    match source {
        "claude" => AiHookCapabilities {
            lifecycle: true,
            attention_events: true,
            attention_context: true,
            background_tasks: true,
            bridge_sequence: false,
            serialized_delivery: false,
        },
        "opencode" => AiHookCapabilities {
            lifecycle: true,
            attention_events: true,
            attention_context: true,
            background_tasks: false,
            bridge_sequence: true,
            serialized_delivery: true,
        },
```

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ai_hook/event.rs:88-97
        // Codex notify 当前只给 turn-complete；没有 permission payload，也没有
        // 可验证的 provider sequence。接收顺序只能代表本机实际到达顺序。
        "codex" => AiHookCapabilities {
            lifecycle: false,
            attention_events: false,
            attention_context: false,
            background_tasks: false,
            bridge_sequence: false,
            serialized_delivery: false,
        },
```

两张极端档位夹着一张全 false：claude 什么都能报但没有序号；opencode 连「发送端保证串行」都能承诺；codex 的 notify 档位一片 false——它只会说「回合完了」，连回合开始都不说。事件级还有一个合并口：`AiHookEvent::capabilities()` 以 `capabilities_for` 为底，若信封头声明了已安装的原生 codex hooks（`codex_hooks` 字段），lifecycle 上调为 true。所以 codex 不是永远的低能档，装了原生钩子就升档。

这张表同时证伪了「多支持一个 CLI 就是多写一堆 if」。公道话先讲：方言确实不同，解析处当然要分支，`protocol.rs` 里那一排 match 臂就是分支本尊。但分支只住在解析这一层，产出是六个变体的有界枚举；下游的排序、生命周期、两个 UI 壳对「source 是谁」的全部了解，都收进这六个布尔里。codex notify 全 false 也照走同一条管线。生命周期层看到 lifecycle=false，把覆盖档降为「只有完成」，缺的能力交给回退层补，而不是在 UI 里撒一把 `if source == "codex"`。加一个 CLI 的成本是一段解析分支加一行档位，if 堆不会随 CLI 数量在 UI 里增殖。

### 门控排序：GateVerdict 的七种裁决

**门控排序**——ordering 层对每个事件做的时序裁定：过一道全进程共用的门，合规的放行，不合规的连同拒绝原因一起扔下。裁决的形状不是 bool，是枚举：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ai_hook/ordering.rs:78-101
/// 事件门的判定结果。带原因，而不只是一个 bool——「通知没出现」这类问题事后
/// 唯一的线索就是这个原因，日志里必须说得出是哪一条规则拦的。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GateVerdict {
    Accepted,
    /// 同一个 `event_id` 已经处理过。
    DuplicateEventId,
    /// bridge 序号不比上一次大（重放或迟到）。
    StaleSequence,
    /// 没有序号，但 provider 时间戳比上一次早。
    StaleTime,
    /// 完全没有身份元数据的终态事件，在短窗口内重复抵达。
    DuplicateFingerprint,
    /// 该 session 已经 SessionEnd，只有 SessionStart 能复活。
    AfterSessionEnd,
    /// Done 之后抵达的 ToolComplete，且没有任何证据证明它更新。
    UnorderedAfterDone,
}

impl GateVerdict {
    pub fn accepted(self) -> bool {
        self == Self::Accepted
    }
}
```

一个 Accepted，六条拒绝原因。为什么必须是枚举：注释写得直白——「通知没出现」是这套链路里最难查的故障，事后唯一的线索就是「哪条规则拦的」。

「事件到达顺序天然可信」的直觉也在这里交代。公道话：单看一个 CLI，钩子按回合顺序同步唤起，顺序确实是对的；本地命名管道又是 FIFO。但每个钩子是一次独立的进程唤起，跨进程没有全局时钟——OS 先调度谁，谁的事件就先进管道。上表的 `bridge_sequence` 文档已经点名：没有任何 provider 提供原生顺序字段；claude 与 codex 的 hook 甚至完全没有顺序信息。所以门不能信到达序，只能拿证据说话：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ai_hook/ordering.rs:129-144
        let provider_order = event
            .bridge_sequence
            .zip(state.last_bridge_sequence)
            .map(|(current, previous)| current.cmp(&previous));
        let time_order = event
            .occurred_at_ms
            .zip(state.last_occurred_at_ms)
            .map(|(current, previous)| current.cmp(&previous));
        if provider_order.is_some_and(|order| order != std::cmp::Ordering::Greater) {
            return GateVerdict::StaleSequence;
        }
        if provider_order.is_none() && time_order == Some(std::cmp::Ordering::Less) {
            return GateVerdict::StaleTime;
        }
        let strictly_newer = provider_order == Some(std::cmp::Ordering::Greater)
            || (provider_order.is_none() && time_order == Some(std::cmp::Ordering::Greater));
```

每条流（按 source + session + pane + 进程身份为键）记住上一次的 bridge 序号与时间戳。有 bridge 序号时，它必须严格更大，否则是重放或迟到（StaleSequence）；没有序号时，时间戳更早也拒（StaleTime）；`strictly_newer` 留给终态守卫用。记忆本身有界：最多 512 条流、每条 64 个已见 `event_id`、无身份元数据的终态指纹只在 1.5 秒窗口内去重——折算体感，够一个 pane 的正常回合用，又不会为已经结束的会话无限记账。这是「有界转发」的第三个回声：状态也有界。

门是全进程一扇，且按 pane id 记账：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ai_hook/ordering.rs:226-233
/// 在最终 Pane 已解析后调用。全进程共用一扇门，关闭/跨窗口移动期间不会为
/// 每个 view 留下互相矛盾的事件缓存；pane id 在本进程生命周期内不复用。
///
/// 返回带原因的判定：调用方必须把原因记进日志。事件被静默丢掉是这套链路里最
/// 难查的一类故障——用户看到的只是「通知没出现」。
pub(crate) fn accept_for_pane(event: &AiHookEvent, pane_id: u64) -> GateVerdict {
    EVENT_GATE.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).verdict(event, pane_id)
}
```

这里正是 pane 生命周期积木的一次真实调用。门敢把流状态按 pane id 记账、敢共用一扇门，前提是那块积木的接口承诺——pane id 终生不复用，关闭由 remove_leaf 一次性裁定（[第 5 章](./05-gpui-shell.md)）。id 若会复用，新 pane 会继承旧 pane 的门内记忆，迟到事件就能冒充新会话。分发口把这条承诺落成路由合同：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/workspace/windowing.rs:932-941
pub(crate) fn dispatch_ai_events(events: Vec<crate::ai_hook::AiHookEvent>, cx: &mut App) {
    let mut handled = Vec::new();
    for event in crate::ai_hook::reorder_batch(events) {
        // 明确 pane id 是严格路由合同：pane 已关闭时，迟到 Hook 必须丢弃；
        // 只有发送端确实没有 NEBULA_PANE_ID 时才允许落到 MRU 窗口。
        let target = match event.pane {
            Some(pane_id) => entry_with_pane(pane_id, cx),
            None => entries_by_mru(cx).into_iter().next(),
        };
        let Some(entry) = target else { continue };
```

署名 pane 已关闭的事件在这里就地丢弃，连门都不用进。

### 承重推演：TurnDone 先到，迟到的 ToolComplete 怎么判

规则齐了，示范一次完整裁决。场景：claude pane，回合里的 PostToolUse 钩子和 Stop 钩子都已发出。假设 Stop 的信封先过门（它的进程恰好先被调度），TurnDone 被接受，流状态进入 Done。随后迟到的 PostToolUse（归一后是 ToolComplete）抵达。逐步过 `verdict()`：

1. event_id 去重：claude 的 PostToolUse 载荷不带 `event_id`，此路不通。
2. bridge 序号：claude 能力档 `bridge_sequence: false`，事件没有序号，`provider_order` 为 None。
3. 时间戳：载荷里也没有可靠时间字段，`time_order` 为 None，于是 `strictly_newer` 为 false。
4. 指纹去重：只对「无身份元数据的终态事件」生效（TurnDone、NeedsAttention、SessionEnd），ToolComplete 不在集合。
5. 流状态守卫：当前 Done。Done 臂的条件——`kind == ToolComplete && !strictly_newer && !(serialized_delivery && bridge_sequence.is_some())`——三项全部成立，claude 的 `serialized_delivery` 是 false，逃生口不存在。

裁决：GateVerdict::UnorderedAfterDone。适配器把它记进日志，pane 徽标停在「完成」，迟到的工具事件把状态拉回「工作中」的假动作被挡下。

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ai_hook/ordering.rs:166-177
            // Permission granted 后 PostToolUse 合法地把 Blocked 拉回 Working。
            StreamLifecycle::Blocked => {},
            // Done 后的无序 ToolComplete 最常见于迟到 Hook。只有 bridge
            // sequence/time 明确证明更新，或发送端保证串行时才允许恢复。
            StreamLifecycle::Done
                if event.kind == AiHookKind::ToolComplete
                    && !strictly_newer
                    && !(event.capabilities().serialized_delivery
                        && event.bridge_sequence.is_some()) =>
            {
                return GateVerdict::UnorderedAfterDone;
            },
```

换一个输入结论就翻面：同一形状发生在 opencode 上，`serialized_delivery: true` 且事件带 bridge 序号。若迟到的 ToolComplete 序号比 TurnDone 的更大，`strictly_newer` 成立，Done 臂守卫不成立，事件被接受、流回到 Active——发送端保证串行且序号证明更新，迟到不等于过期。若序号更小，第 2 步就 StaleSequence 出局。还有一个更早的补救：同一批次里两个事件都带序号时，根本轮不到门操心——

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ai_hook/ordering.rs:235-251
/// 同一 pump 批次内，只有一组事件全部带 bridge sequence 时才按该序号
/// 重排；不同会话仍占据原来的交错槽位。跨批次的旧序号由事件门拒绝。
pub(crate) fn reorder_batch(events: Vec<AiHookEvent>) -> Vec<AiHookEvent> {
    let keys = events.iter().map(|event| event.stream_key(event.pane)).collect::<Vec<_>>();
    let mut groups: HashMap<AiHookStreamKey, VecDeque<AiHookEvent>> = HashMap::new();
    for (key, event) in keys.iter().cloned().zip(events) {
        groups.entry(key).or_default().push_back(event);
    }
    for group in groups.values_mut() {
        if group.len() > 1 && group.iter().all(|event| event.bridge_sequence.is_some()) {
            let mut ordered = group.drain(..).collect::<Vec<_>>();
            ordered.sort_by_key(|event| event.bridge_sequence);
            group.extend(ordered);
        }
    }
    keys.into_iter().filter_map(|key| groups.get_mut(&key).and_then(VecDeque::pop_front)).collect()
}
```

`dispatch_ai_events` 先 `reorder_batch` 再逐个送门：同一条流的整批事件都带序号才按序号排，不同会话保持原来的交错槽位。批次内重排、跨批次拒旧——两层合起来，就是门控排序的全部。

### 一个生命周期，两个 UI 壳

排序之后，事件落到每个 pane 自己的状态机。lifecycle 层的模块头是能力集分层的最后一块拼图：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ai_hook/lifecycle.rs:1-4
//! One pane's Agent lifecycle, shared by both UI shells.
//!
//! Hook events are facts; screen matches are observations with limited authority.
//! Command ownership ends at the shell boundary, never because output goes quiet.
```

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/ai_hook/lifecycle.rs:28-30
/// Owns status and arbitration. Adapters may submit facts but cannot set fields.
#[derive(Debug, Clone)]
pub(crate) struct AgentActivity {
```

Hook 事件是事实，屏幕匹配是权限有限的观察。AgentActivity 独占状态与仲裁，适配器只能提交事实、不能伸手改字段。两个入口泾渭分明：`apply_hook(event)` 收钩子事实，`observe_screen(detection)` 收屏幕回退。回退只在钩子覆盖不足时放行；覆盖档已是完整生命周期时，连看都不看屏幕。GPUI 壳的适配器先过门再消费：

```rust
// Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:nebula_app/src/gpui_shell/terminal/view/agent_activity.rs:44-53
        let verdict = crate::ai_hook::accept_for_pane(event, self.pane_id);
        if !verdict.accepted() {
            log::debug!(
                "ai_hook: pane={} source={} dropped {verdict:?}",
                self.pane_id,
                event.source
            );
            return false;
        }
        self.agent_activity.apply_hook(event);
```

这段代码本身就是 GPUI Entity 积木的调用现场：`handle_ai_hook(&mut self, cx: &mut Context<Self>)` 是 TerminalView 实体上的方法，AgentActivity 是它持有的字段。`cx.emit(...)` 与 `cx.notify()` 把状态变化交还框架调度（[第 5 章](./05-gpui-shell.md)）。legacy 壳（`window_context/agent_activity.rs`）走同一个 `accept_for_pane`、同一个 `apply_hook`——一扇门、一台状态机、两个壳，地图禁区里「不许每个 UI 壳各养一台状态机」就此守住了。

组装式到此收拢：类型化事件 + 能力集分层 ⇒ 下游单一状态机；门控排序 + pane id 不复用 ⇒ 全进程一扇门。新能力全部由旧积木组装而来，没有一块另起炉灶。

## 演练：五层逐层核对

以下操作都在课程的锁定 clone（`.course/repo` @ 360613aa）上做，全程只读。

1. 先猜再数：`AiHookKind` 有几个变体？`GateVerdict` 呢？先落笔，再打开 `nebula_app/src/ai_hook/event.rs` 与 `ordering.rs` 数。预期 6 与 7（1 接受 + 6 拒绝）。
2. 走一遍文件地图：`ls nebula_app/src/ai_hook/` 应看到 event / ordering / payload / protocol / lifecycle（还有 bridges、installation 等，本章不用）。再看 `win/transport.rs` 与两个壳的 `agent_activity.rs`（`gpui_shell/terminal/view/` 与 `window_context/`）。
3. 核对调用点：`grep -rn "accept_for_pane" nebula_app/src` 。预期四处：ordering.rs 定义、ai_hook.rs 再导出、两个壳的适配器各一次。
4. 跑本章探针，在课程根目录执行 `node companion/scripts/probe-09-ai-lifecycle.mjs`。预期 37 项全 ok：

```text
# companion/scripts/probe-09-ai-lifecycle.mjs 运行输出（节选）
ok   [ai-lifecycle] GateVerdict 恰 7 个变体：Accepted + 6 条拒绝原因（实测 7 个）
ok   [ai-lifecycle] 6 条拒绝路径各有 return GateVerdict::<X>; 拒绝点（实测 6/6），全文件 return GateVerdict:: 恰 6 处
ok   [ai-lifecycle] 能力集按 source 显式分档（capabilities_for）：claude 全生命周期但 bridge_sequence=false；opencode 是唯一 serialized_delivery=true；codex notify 连 lifecycle 都没有
ok   [ai-lifecycle] 批次分发口（windowing.rs:931）：dispatch_ai_events 先 reorder_batch 再按 pane id 严格路由——pane 已关闭时迟到 Hook 必须丢弃
PASS  [ai-lifecycle] 37/37 checks
```

## 验证：押三注，再对答案

### 纸面推演：重放的完成通知

场景：kimi 的 Stop 事件（归一为 TurnDone），载荷没有 `event_id`、没有序号、没有时间戳；同一 pane 在 0.5 秒内收到两份一模一样的信封。第一份已被接受，流状态 Done。第二份的裁决，二选一落笔：DuplicateFingerprint 还是 Accepted？再加一注：若第二份迟到 5 秒才来，裁决变不变？

答案：0.5 秒内是 DuplicateFingerprint——终态事件、三种身份元数据全无、指纹相同且落在 1.5 秒窗口内，四项条件齐。5 秒后翻成 Accepted：指纹仍在，但窗口已过，去重证据失效；接受后不过把 Done 再置一次 Done，无害。窗口不是容错，是「无身份证据时愿意装作认识多久」的明码标价。

### 定向破坏：改一个常量

把 `.course/repo/nebula_app/src/ai_hook/ordering.rs` 第 11 行的 `1_500` 改成 `1_000`。先预言：探针 37 项里恰好几项红？GateVerdict 变体计数那条红不红？

在课程根目录执行 `node companion/scripts/probe-09-ai-lifecycle.mjs`，观察：恰好 1 项红——钉住 `DUPLICATE_WINDOW_MS` 逐字值的有界去重常量断言；变体计数、六条 return 计数、重排断言全部仍绿，它们钉的是结构存在性，与这个数值无关。红的那条守的是「正文引用与锁定源码逐字一致」的事实合同：正文写了 1_500，源码一旦改值，引用与现实脱钩，检查立即变色。复原并确认：`git -C .course/repo checkout -- nebula_app/src/ai_hook/ordering.rs`，重跑回到 37/37。

### 变体：数一数逃生口

`grep -n "serialized_delivery" nebula_app/src/ai_hook/event.rs nebula_app/src/ai_hook/ordering.rs`。event.rs 里应为 8 处命中（字段定义 1 处、档位表 7 档各 1 处），ordering.rs 里恰好 1 处——就是 Done 臂逃生口那一个。全仓库能解开 UnorderedAfterDone 的证据只有这一种：发送端保证串行且带序号。

三注分别核对三件事：规则的可推导性——你能从源码推出裁决；引用合同的刚性——数字脱钩会被机械查出；逃生口的收敛性——特殊放行只在一个条件上收口。

## 自查：把输入换掉

1. codex 的 notify 载荷（`type: agent-turn-complete`，无 turn id、无序号、无时间戳）在同一 pane 半秒内重复抵达两次。第二份的 GateVerdict 是什么？依据是哪几项条件？
2. 一条署名 claude 的信封，载荷字段全是 camelCase（`hookEventName`）。它会死在哪一层？应用日志里会出现 `dropped {verdict:?}` 吗？
3. 用户关掉了 pane 7，半秒后一个署名 pane=7 的迟到 TurnDone 抵达。它死在哪一步？为什么门内的流状态不会因此产生矛盾？

<details>
<summary>参考答案</summary>

1. DuplicateFingerprint。事件被合成为 TurnDone（终态）、`event_id` 与 `bridge_sequence` 与 `occurred_at_ms` 全无、指纹相同、半秒在 1.5 秒窗口内——与 kimi 的推演同形，因为条件只看身份元数据与终态，不看 source。
2. 死在 protocol 解析层的第二道串台门：`"claude" if payload.get("hookEventName").is_some() => return None`。它从未成为事件，所以不会有任何 verdict 日志——这也是为什么解析层与门要各留一层证据。
3. 死在 `dispatch_ai_events` 的路由：`entry_with_pane(7)` 找不到目标，`continue` 丢弃，事件根本不进 `accept_for_pane`。pane id 终生不复用意味着「7 号 pane 的流状态」是一个稳定的记账键，关掉的 pane 不会有新事件来混淆它；全进程一扇门因此不需要为每个 view 维护缓存。

</details>

## 收束：翻译官的三条规则

开篇的问题现在可以整段回答了。三种方言进一门、一套状态出一片的翻译官，靠三条规则工作：先把所有载荷归一成六个变体的类型化事件，方言差异被锁死在解析层；再让每个事件过 GateVerdict 的门控排序，迟到、重放、会话后残响各自有具名的拒绝原因，全进程一扇门按不复用的 pane id 记账；最后用能力集分层把每家 CLI 的短板写进显式档位表，钩子给不了的能力才允许屏幕回退。UI 两个壳只消费同一台生命周期状态机，从未解析过一个字节的方言，也从未扫描过一行终端散文。

本章交出三块积木：类型化事件，异构事件源的中间表示；门控排序，带原因的时序裁定；能力集分层，「该加钩子还是加屏幕规则」的决策依据。回退层自己长什么样——去一行：（[第 10 章](./10-screen-evidence.md)）。

迁移自查三问，以后再遇到「把外部事件流接进 UI」就先答它们：方言在哪里归一，UI 看不看得见第二种方言？乱序的裁决在哪一层，拒绝带不带原因？各来源能力不齐时，靠什么降级而不是靠 if 堆？有一问答不上来，先别画管线图。
