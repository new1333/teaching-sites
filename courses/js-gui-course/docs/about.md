# 关于本课程

这门课回答一个问题：**JS 是怎么接入原生 GUI 的**——Electron 那类桌面端背后的原理，而不是框架 API 的用法。

输入是主题句「JS 接入 GUI 的原理（Electron 式桌面端），要原理不要调包」。全书 11 章（3 原理 + 8 实验），围绕一个伴生实验场展开：你会在 `companion/` 里从零构建一个 mini-Electron 内核——模拟原生层（事件队列、runLoop、窗口管理器）、嵌入运行时、binding 桥、异步任务队列、IPC 通道（invoke/handle 与 send/on）、事件分发，最终用 `createApp` 组装出「点按钮改状态刷新界面」的完整回路，45 条原理断言全程背书。

跑法：

- 聚合站预览：项目根目录 `pnpm dev`，从课程中心进入本课。
- 单课预览：`cd courses/js-gui-course && pnpm install && pnpm docs:dev`。
- 实验场门槛：`cd companion && npm install && npm test`（另有 `npm run typecheck`）。
