# 关于本课程

本课程是一场锁定版本的源码走读：对象是 [Pebrel](https://github.com/Kuddev/pebrel)（原名 Nebula）——一个 Rust + GPUI 的 GPU 加速终端模拟器，兼作 SSH/SFTP 工作区与 AI CLI（Claude Code / Codex 等）会话宿主。全书 16 章覆盖其九 crate workspace 的 15 个可教学特性，每章配一个可在锁定 clone 上复跑的只读静态探针。

**主线问题**：一个 GPU 加速终端如何同时成为 SSH 工作区与 AI CLI 会话的家？全书就是它的答案。

- 输入：仓库 [Kuddev/pebrel](https://github.com/Kuddev/pebrel)，锁定 commit `360613aa6eedfa4e441d658d98db502e8a81442b`
- 章节数：16 章全部完成（15 个教学特性 + 1 个全书对账复盘）
- 验证物：`companion/scripts/` 下 15 个探针共 398 条断言，`pnpm probes` 一键全绿

## 引用与许可

本课程逐字引用 Pebrel 的源码片段（含 TOML 规则与文档注释）。被引用片段依 [GPL-3.0](https://www.gnu.org/licenses/gpl-3.0.txt) 授权使用：出处标注为 `Kuddev/pebrel@360613aa6eedfa4e441d658d98db502e8a81442b:路径`，与锁定 commit 逐字一致（CRLF 行尾按内容归一）。Pebrel 及其贡献者保留全部版权；本课程的讲解文字独立成文，引用块内代码的许可以 GPL-3.0 为准。

## 内容时效

本课程全部事实锚定上述锁定 commit（主分支后续演进不自动生效）。第 10 章引用的屏幕证据 TOML 规则注释含日期化演化记录（如 2026-08-22 的恒假条件修正），正文已按时点标注；该章引用的注释内行号（如 `ai_agents.rs:528`）属改名前的历史锚点，实际语义位置以正文说明为准。

## 能力阶梯

- 学完[第 1 章](./01-repo-map.md)，你能用所有权地图判断任意改动的落点 crate 与禁区
- 学完[第 2 章](./02-vt-grid.md)，你能追踪一条 CSI/OSC 序列从字节流到单元格状态变化的完整路径
- 学完[第 3 章](./03-pty-event-loop.md)，你能讲清本地 shell 输出跨线程进入 UI 的每一步与平台分叉点
- 学完[第 4 章](./04-split-tree.md)，你能把交互式布局规则读成可独立测试的纯函数
- 学完[第 5 章](./05-gpui-shell.md)，你能解释多 pane 工作区的组装、resize 合同与资源清理合同
- 学完[第 6 章](./06-ssh-session.md)，你能解释同一个 Term/渲染栈为何既吃 ConPTY 又吃 SSH channel
- 学完[第 7 章](./07-sftp-engine.md)，你能算出给定 RTT 与分块下的单句柄吞吐上限
- 学完[第 8 章](./08-ai-hook-bridge.md)，你能设计不打扰宿主 CLI 语义的跨进程事件桥
- 学完[第 9 章](./09-ai-lifecycle.md)，你能对乱序事件样例推出 GateVerdict 的裁决
- 学完[第 10 章](./10-screen-evidence.md)，你能为未适配 CLI 编写含负向证据的状态推断规则
- 学完[第 11 章](./11-session-persistence.md)，你能设计崩溃安全的版本化快照与恢复护栏
- 学完[第 12 章](./12-lua-config.md)，你能说明「执行本地受信代码」的配置边界与离线校验原理
- 学完[第 13 章](./13-native-math.md)，你能读出排版编译管线的分层与共享常量合同
- 学完[第 14 章](./14-answer-reader.md)，你能识别「复用入口」与「复制实现」两种结构
- 学完[第 15 章](./15-completion-engine.md)，你能为假想补全源指出需要实现的 trait 方法
- 学完[第 16 章](./16-review.md)，你能对任一假想改动走通「落点 → 禁区 → 影响面」三问
