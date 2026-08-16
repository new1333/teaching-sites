# 关于本课程

这门课回答一个问题：**JS 是怎么接入原生 GUI 的**——Electron 那类桌面端背后的原理，而不是框架 API 的用法。

输入是主题句「JS 接入 GUI 的原理（Electron 式桌面端），要原理不要调包」。全书 13 章（3 原理 + 10 实验），围绕一个伴生实验场展开：你会在 `companion/` 里从零构建一个 mini-Electron 内核——模拟原生层（事件队列、runLoop、窗口管理器）、嵌入运行时、binding 桥、异步任务队列、IPC 通道（invoke/handle 与 send/on）、事件分发，最终用 `createApp` 组装出「点按钮改状态刷新界面」的完整回路，55 条原理断言全程背书。真机篇两章带你走出模拟：手工组装 WebAssembly 模块真的跨一次语言边界，再把内核接上真实键盘跑可交互终端 App，并用 Bun FFI 直调 user32.dll 弹出一扇如假包换的系统窗口。

跑法：

- 聚合站预览：项目根目录 `pnpm dev`，从课程中心进入本课。
- 单课预览：`cd courses/js-gui-course && pnpm install && pnpm docs:dev`。
- 实验场门槛：`cd companion && npm install && npm test`（另有 `npm run typecheck`）。
- 可运行 demo：`npm run demo`（+ 加一、q 退出）；`bun src/app/native-window.mjs --msgbox` 真系统弹窗。
