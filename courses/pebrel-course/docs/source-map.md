# 源码阅读地图

按理解依赖排序（不按目录遍历）。全部路径相对锁定 commit `360613aa6eedfa4e441d658d98db502e8a81442b`；引用纪律与许可声明见[关于页](./about.md)。

| 路径 | 角色 | 一句话 |
|---|---|---|
| docs/architecture.md | map | 所有权地图：每块面积的 owns / must-not-become 合同与依赖方向 |
| Cargo.toml | manifest | workspace 成员、发布体积预算与 GPUI 固定基线的完整决策记录 |
| nebula_gpui/src/main.rs | entry | 入口：一行调用 run_shell |
| nebula_terminal/src/term/mod.rs | domain | VT 核心状态机与 TermMode |
| nebula_terminal/src/tty/mod.rs | adapter | Pty 抽象与平台分支 |
| nebula_terminal/src/event_loop.rs | domain | PTY I/O 主循环与 ConPTY resize 对账 |
| nebula_split/src/lib.rs | domain | 分屏树纯函数合同 |
| nebula_app/src/gpui_shell/workspace.rs | view | GPUI 工作区与 pane 生命周期合同 |
| nebula_app/src/ssh_session.rs | capability | SSH 远端终端：传输层无关的会话驱动 |
| nebula_app/src/ssh_sftp/transfer.rs | capability | SFTP 多句柄分段并发传输引擎 |
| nebula_hook/src/main.rs | tool | AI CLI 钩子桥进程的全部设计约束 |
| nebula_app/src/ai_hook.rs | capability | AI 事件管线分层依赖流 |
| nebula_app/src/agent_detection/claude.toml | data | 屏幕证据规则样例（区域 + 优先级 + 负向证据） |
| nebula_app/src/session.rs | capability | 会话快照版本化与恢复护栏 |
| nebula_config/src/lib.rs | domain | 配置字段级诊断与 SerdeReplace |
| docs/lua-configuration.md | doc | Lua 配置官方手册 |
| nebula_app/src/math/mod.rs | domain | 原生 TeX 管线分层与共享常量 |
| nebula-completions/src/lib.rs | domain | 独立补全引擎自述 |

配套探针：`companion/scripts/probe-*.mjs` 每章一个，聚合入口 `node scripts/run-all.mjs`（在 companion 目录）。
