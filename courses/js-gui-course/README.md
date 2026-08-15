# JS 接入原生 GUI 的原理——从零理解 Electron 式桌面端

一门「要原理不要调包」的课程：从消息循环、运行时嵌入、binding 层、异步桥、进程模型、IPC 到事件回流，最后组装一个可测试的 mini-Electron 内核。

## 怎么跑

- 聚合站：项目根 `pnpm dev`，从课程中心进入本课。
- 单课：`cd courses/js-gui-course && pnpm install && pnpm docs:dev`。
- 实验场：`cd companion && npm install && npm test`（`npm run typecheck` 查类型）。

## 章节目录

1. 桌面 GUI 程序的骨架：窗口与消息循环
2. 手写最小消息循环
3. JS 没有 GUI：运行时是被嵌入的
4. binding 层：JS 怎么调用「另一个语言」
5. 窗口对象：宿主给你的遥控器
6. 单线程遇多线程：异步桥
7. 为什么是两个进程
8. IPC：invoke/handle 与 send/on
9. 反方向：native 事件进 JS
10. 组装 mini-Electron
11. 回望：Electron、Tauri 与原生绑定的同一原理

## 终点里程碑

一个约 500-600 行、可测试的 mini-Electron 内核：模拟原生层（事件队列、runLoop、窗口管理器）+ 嵌入运行时与 binding 桥 + 异步任务队列 + IPC 通道 + 事件分发 + createApp 组装。验证：companion 的 45 条课程自设原理断言全绿、`tsc --noEmit` 通过；你能讲清从 JS 一行调用到窗口出现、从用户点击到状态更新的完整链路，以及 Electron/Tauri/原生绑定各自的权衡。
